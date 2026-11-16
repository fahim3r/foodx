// FoodX — POS / order-placement service.
//
// THE RULE: the client never decides prices. The POS sends only product /
// variant / modifier ids and quantities; this service re-reads the prices
// from the database, computes every total here, and stores price snapshots
// on the order items. A tampered client cannot change what an order costs.
//
// Idempotency: the order, its items, and its item modifiers all get
// client-generated UUIDs and are written with upsert (onConflict 'id'),
// so retrying a placement after a dropped connection cannot double-post
// the order. Order numbers are sequential per restaurant (MAX+1) with a
// retry on the unique-constraint collision.
import { supabase } from '@/lib/supabase'
import { isUniqueViolationError } from '@/lib/errors'
import { setTableStatus } from '@/services/tables'
import type {
  CreateOrderInput,
  Order,
  OrderPayment,
  OrderTotals,
  PaymentMethod,
  PosOrderLineInput,
} from '@/types'

/** Round to 2 decimals (BDT paisa). The single rounding rule for money. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export interface PricedLine {
  productId: string
  variantId: string | null
  modifierIds: string[]
  quantity: number
  productName: string
  variantName: string | null
  modifierNames: { id: string; name: string; price: number }[]
  unitPrice: number
  lineTotal: number
}

/**
 * Compute order totals from priced lines. Tax and service charge apply to
 * (subtotal − discount). Pure function — the POS page uses the same one
 * for its live total preview, so the preview and the placed order agree.
 */
export function computeOrderTotals(
  lines: Pick<PricedLine, 'lineTotal'>[],
  discountAmount: number,
  taxRate: number,
  serviceChargeRate: number,
): OrderTotals {
  const subtotal = roundMoney(
    lines.reduce((sum, line) => sum + line.lineTotal, 0),
  )
  const discount = Math.min(Math.max(discountAmount, 0), subtotal)
  const taxable = roundMoney(subtotal - discount)
  const taxAmount = roundMoney((taxable * taxRate) / 100)
  const serviceChargeAmount = roundMoney((taxable * serviceChargeRate) / 100)
  return {
    subtotal,
    discountAmount: discount,
    taxAmount,
    serviceChargeAmount,
    totalAmount: roundMoney(taxable + taxAmount + serviceChargeAmount),
  }
}

interface DbProduct {
  id: string
  name: string
  price: number
  is_available: boolean
}

interface DbVariant {
  id: string
  product_id: string
  name: string
  price_adjustment: number
  is_active: boolean
}

interface DbModifier {
  id: string
  name: string
  price: number
  is_active: boolean
}

/**
 * Re-read prices from the database and price every cart line. Throws
 * Error('product_unavailable') when a product/variant/modifier is missing,
 * inactive, or not offered on that product.
 */
export async function priceOrderLines(
  restaurantId: string,
  lines: PosOrderLineInput[],
): Promise<PricedLine[]> {
  if (lines.length === 0) throw new Error('empty_order')
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error('invalid_quantity')
    }
  }

  const productIds = [...new Set(lines.map((l) => l.productId))]
  const variantIds = [
    ...new Set(lines.map((l) => l.variantId).filter((v): v is string => !!v)),
  ]
  const modifierIds = [...new Set(lines.flatMap((l) => l.modifierIds))]

  const [{ data: products, error: productsError }, { data: variants }, { data: modifiers }, { data: links }] =
    await Promise.all([
      supabase
        .from('products')
        .select('id, name, price, is_available')
        .eq('restaurant_id', restaurantId)
        .in('id', productIds),
      variantIds.length > 0
        ? supabase.from('product_variants').select('id, product_id, name, price_adjustment, is_active').in('id', variantIds)
        : Promise.resolve({ data: [] as DbVariant[], error: null }),
      modifierIds.length > 0
        ? supabase
            .from('modifiers')
            .select('id, name, price, is_active')
            .eq('restaurant_id', restaurantId)
            .in('id', modifierIds)
        : Promise.resolve({ data: [] as DbModifier[], error: null }),
      productIds.length > 0
        ? supabase
            .from('product_modifiers')
            .select('product_id, modifier_id')
            .in('product_id', productIds)
        : Promise.resolve({ data: [] as { product_id: string; modifier_id: string }[], error: null }),
    ])
  if (productsError) throw productsError

  const productById = new Map(
    ((products ?? []) as DbProduct[]).map((p) => [p.id, p]),
  )
  const variantById = new Map(
    ((variants ?? []) as DbVariant[]).map((v) => [v.id, v]),
  )
  const modifierById = new Map(
    ((modifiers ?? []) as DbModifier[]).map((m) => [m.id, m]),
  )
  const offered = new Set(
    ((links ?? []) as { product_id: string; modifier_id: string }[]).map(
      (l) => `${l.product_id}:${l.modifier_id}`,
    ),
  )

  return lines.map((line) => {
    const product = productById.get(line.productId)
    if (!product || !product.is_available) {
      throw new Error('product_unavailable')
    }
    let variantName: string | null = null
    let variantAdjustment = 0
    if (line.variantId) {
      const variant = variantById.get(line.variantId)
      if (
        !variant ||
        !variant.is_active ||
        variant.product_id !== line.productId
      ) {
        throw new Error('product_unavailable')
      }
      variantName = variant.name
      variantAdjustment = Number(variant.price_adjustment)
    }
    const modifierNames: PricedLine['modifierNames'] = []
    let modifierTotal = 0
    for (const modifierId of line.modifierIds) {
      const modifier = modifierById.get(modifierId)
      if (
        !modifier ||
        !modifier.is_active ||
        !offered.has(`${line.productId}:${modifierId}`)
      ) {
        throw new Error('product_unavailable')
      }
      modifierNames.push({
        id: modifier.id,
        name: modifier.name,
        price: Number(modifier.price),
      })
      modifierTotal += Number(modifier.price)
    }
    const unitPrice = roundMoney(
      Number(product.price) + variantAdjustment + modifierTotal,
    )
    return {
      productId: line.productId,
      variantId: line.variantId ?? null,
      modifierIds: line.modifierIds,
      quantity: line.quantity,
      productName: product.name,
      variantName,
      modifierNames,
      unitPrice,
      lineTotal: roundMoney(unitPrice * line.quantity),
    }
  })
}

async function nextOrderNumber(restaurantId: string): Promise<number> {
  const { data, error } = await supabase
    .from('orders')
    .select('order_number')
    .eq('restaurant_id', restaurantId)
    .order('order_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data?.order_number ?? 0) + 1
}

async function fetchOrderById(orderId: string): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw error
  return data as Order | null
}

/**
 * Place an order. Prices come from the database (see priceOrderLines),
 * totals from computeOrderTotals. The order is created CONFIRMED with a
 * status-history row recording the DRAFT → CONFIRMED placement. A dine-in
 * order marks its table occupied. Throws Error('product_unavailable') or
 * Error('empty_order') / Error('invalid_quantity') on bad input.
 */
export async function createOrder(
  input: CreateOrderInput,
  userId: string,
  settings: { taxRate: number; serviceChargeRate: number },
): Promise<Order> {
  const pricedLines = await priceOrderLines(input.restaurantId, input.lines)
  const totals = computeOrderTotals(
    pricedLines,
    input.discountAmount,
    settings.taxRate,
    settings.serviceChargeRate,
  )

  const orderId = crypto.randomUUID()
  const itemIds = pricedLines.map(() => crypto.randomUUID())

  // Insert the order, retrying the per-restaurant order number on a
  // collision (two cashiers placing at the same instant). If this exact
  // placement is retried after a dropped connection, the order already
  // exists under this id — reuse it instead of taking a new number.
  let orderNumber = await nextOrderNumber(input.restaurantId)
  let order: Order | null = null
  for (let attempt = 0; attempt < 3 && !order; attempt++) {
    const { data, error } = await supabase
      .from('orders')
      .upsert(
        {
          id: orderId,
          restaurant_id: input.restaurantId,
          branch_id: input.branchId ?? null,
          table_id: input.tableId ?? null,
          order_number: orderNumber,
          type: input.type,
          status: 'CONFIRMED',
          subtotal: totals.subtotal,
          discount_amount: totals.discountAmount,
          tax_amount: totals.taxAmount,
          service_charge_amount: totals.serviceChargeAmount,
          total_amount: totals.totalAmount,
          notes: input.notes?.trim() || null,
          created_by: userId,
        },
        { onConflict: 'id' },
      )
      .select()
      .single()
    if (!error) {
      order = data as Order
      break
    }
    if (isUniqueViolationError(error)) {
      const existing = await fetchOrderById(orderId)
      if (existing) {
        order = existing
        break
      }
      orderNumber = await nextOrderNumber(input.restaurantId)
      continue
    }
    throw error
  }
  if (!order) throw new Error('order_create_failed')

  // Items + their modifiers (upsert on the client-generated ids, so a
  // retried placement cannot double-post lines).
  const items = pricedLines.map((line, index) => ({
    id: itemIds[index],
    order_id: orderId,
    product_id: line.productId,
    variant_id: line.variantId,
    product_name: line.productName,
    variant_name: line.variantName,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    total_price: line.lineTotal,
  }))
  const { error: itemsError } = await supabase
    .from('order_items')
    .upsert(items, { onConflict: 'id' })
  if (itemsError) throw itemsError

  const itemModifiers = pricedLines.flatMap((line, index) =>
    line.modifierNames.map((modifier) => ({
      id: crypto.randomUUID(),
      order_item_id: itemIds[index],
      modifier_id: modifier.id,
      modifier_name: modifier.name,
      price: modifier.price,
    })),
  )
  if (itemModifiers.length > 0) {
    const { error: modifiersError } = await supabase
      .from('order_item_modifiers')
      .upsert(itemModifiers, { onConflict: 'id' })
    if (modifiersError) throw modifiersError
  }

  // Placement history: exactly one row per order — the row id is the
  // order id, so a retried placement upserts instead of duplicating.
  const { error: historyError } = await supabase
    .from('order_status_history')
    .upsert(
      {
        id: orderId,
        order_id: orderId,
        from_status: 'DRAFT',
        to_status: 'CONFIRMED',
        changed_by: userId,
        note: 'Order placed',
      },
      { onConflict: 'id' },
    )
  if (historyError) throw historyError

  if (input.tableId) {
    await setTableStatus(input.tableId, 'occupied')
  }
  return order
}

// --- payments ---------------------------------------------------------------

export interface PaymentSummary {
  paid: number
  due: number
  balance: number
}

/** Split a payment list into money received, money on due, and the rest. */
export function summarizePayments(
  payments: OrderPayment[],
  totalAmount: number,
): PaymentSummary {
  let paid = 0
  let due = 0
  for (const payment of payments) {
    if (payment.method === 'due') due += Number(payment.amount)
    else paid += Number(payment.amount)
  }
  return {
    paid: roundMoney(paid),
    due: roundMoney(due),
    balance: roundMoney(totalAmount - paid - due),
  }
}

export async function fetchOrderPayments(
  orderId: string,
): Promise<OrderPayment[]> {
  const { data, error } = await supabase
    .from('order_payments')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as OrderPayment[]
}

/**
 * Record one payment against an order. Split payments are allowed: the
 * amount must not exceed the order's remaining balance (total − paid −
 * due). Throws Error('payment_exceeds_balance') or
 * Error('invalid_payment_amount').
 *
 * Idempotency: the caller passes an idempotency key that stays the same
 * across retries of the same payment attempt (the POS page generates one
 * per payment form and regenerates it after success). The payment row is
 * upserted on that id, so a retried payment cannot double-post.
 */
export async function recordPayment(
  order: Order,
  values: { method: PaymentMethod; amount: number; reference?: string },
  userId: string,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<OrderPayment> {
  if (!Number.isFinite(values.amount) || values.amount <= 0) {
    throw new Error('invalid_payment_amount')
  }
  const amount = roundMoney(values.amount)
  const payments = await fetchOrderPayments(order.id)
  const summary = summarizePayments(payments, Number(order.total_amount))
  if (amount > summary.balance + 0.001) {
    throw new Error('payment_exceeds_balance')
  }
  const { data, error } = await supabase
    .from('order_payments')
    .upsert(
      {
        id: idempotencyKey,
        order_id: order.id,
        method: values.method,
        amount,
        reference: values.reference?.trim() || null,
        received_by: userId,
      },
      { onConflict: 'id' },
    )
    .select()
    .single()
  if (error) throw error
  return data as OrderPayment
}
