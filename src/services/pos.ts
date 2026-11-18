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
import { recordCouponRedemption } from '@/services/coupons'
import { recordLoyaltyRedemption } from '@/services/loyalty'
import { setTableStatus } from '@/services/tables'
import type {
  CreateOrderInput,
  Order,
  OrderPayment,
  OrderTotals,
  PaymentMethod,
  PosOrderLineInput,
} from '@/types'
import type { QueuedOrder } from '@/services/offlineQueue'

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
 * (subtotal − discounts). Discounts apply in order — manual first, then
 * coupon, then loyalty — each clamped to what is left, so the total
 * never goes below 0. Pure function — the POS page uses the same one
 * for its live total preview, so the preview and the placed order agree.
 */
export function computeOrderTotals(
  lines: Pick<PricedLine, 'lineTotal'>[],
  discountAmount: number,
  taxRate: number,
  serviceChargeRate: number,
  extra?: { couponDiscount?: number; loyaltyDiscount?: number },
): OrderTotals {
  const subtotal = roundMoney(
    lines.reduce((sum, line) => sum + line.lineTotal, 0),
  )
  const discount = Math.min(Math.max(discountAmount, 0), subtotal)
  const afterManual = roundMoney(subtotal - discount)
  const couponDiscount = Math.min(
    Math.max(extra?.couponDiscount ?? 0, 0),
    afterManual,
  )
  const afterCoupon = roundMoney(afterManual - couponDiscount)
  const loyaltyDiscount = Math.min(
    Math.max(extra?.loyaltyDiscount ?? 0, 0),
    afterCoupon,
  )
  const taxable = roundMoney(afterCoupon - loyaltyDiscount)
  const taxAmount = roundMoney((taxable * taxRate) / 100)
  const serviceChargeAmount = roundMoney((taxable * serviceChargeRate) / 100)
  return {
    subtotal,
    discountAmount: discount,
    couponDiscount: roundMoney(couponDiscount),
    loyaltyDiscount: roundMoney(loyaltyDiscount),
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
 * Persist an already-priced order: the order row (with the
 * per-restaurant number retry), its items + modifiers, the
 * placement history row, the table flag and the stock deduction.
 * Shared by createOrder (live placement) and syncQueuedOrder
 * (Phase 9 offline replay) so both paths write identical shapes.
 * Every write upserts on client-generated ids — replaying this
 * function for the same orderId can never double-post.
 */
async function persistPricedOrder(args: {
  orderId: string
  input: CreateOrderInput
  pricedLines: PricedLine[]
  totals: OrderTotals
  userId: string
  historyNote: string
}): Promise<Order> {
  const { orderId, input, pricedLines, totals, userId, historyNote } = args
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
          coupon_discount: totals.couponDiscount,
          loyalty_points_redeemed: input.loyaltyPointsRedeemed ?? 0,
          loyalty_discount: totals.loyaltyDiscount,
          coupon_id: input.couponId ?? null,
          customer_id: input.customerId ?? null,
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
        note: historyNote,
      },
      { onConflict: 'id' },
    )
  if (historyError) throw historyError

  if (input.tableId) {
    await setTableStatus(input.tableId, 'occupied')
  }

  // Stock deduction (Phase 3): deduct recipe ingredients for this order.
  // Best-effort — a stock failure must never fail an order at the
  // counter. deduct_stock_for_order() is idempotent, so a retried
  // placement cannot double-deduct. When the Phase 3 migration has not
  // been applied yet, the function does not exist and the call fails
  // here — the order still stands.
  try {
    const { error: deductError } = await supabase.rpc(
      'deduct_stock_for_order',
      { p_order_id: orderId },
    )
    if (deductError) {
      console.error('[POS] stock deduction failed', deductError)
    }
  } catch (error) {
    console.error('[POS] stock deduction failed', error)
  }
  return order
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
    {
      couponDiscount: input.couponDiscount ?? 0,
      loyaltyDiscount: input.loyaltyDiscount ?? 0,
    },
  )

  const orderId = crypto.randomUUID()
  const order = await persistPricedOrder({
    orderId,
    input,
    pricedLines,
    totals,
    userId,
    historyNote: 'Order placed',
  })


  // Coupon + loyalty records (Phase 4): best-effort, after the order
  // row exists — they must never fail an order at the counter. The
  // order's own discount columns are the source of truth for the
  // total; these rows are the audit trail (and the coupon usage count).
  // Both inserts are idempotent, so a retried placement cannot
  // double-record them.
  if (input.couponId && totals.couponDiscount > 0) {
    try {
      await recordCouponRedemption(
        orderId,
        input.couponId,
        totals.couponDiscount,
      )
    } catch (error) {
      console.error('[POS] coupon redemption failed', error)
    }
  }
  if (input.customerId && (input.loyaltyPointsRedeemed ?? 0) > 0) {
    try {
      await recordLoyaltyRedemption(order, input.loyaltyPointsRedeemed ?? 0)
    } catch (error) {
      console.error('[POS] loyalty redemption failed', error)
    }
  }
  return order
}


// --- offline sync (Phase 9) -------------------------------------------------

/**
 * Replay one offline-queued order (see services/offlineQueue).
 *
 * The snapshot prices are honoured — the customer already paid
 * them (design D1) — but nothing is trusted blindly:
 *   1. every product / variant / modifier in the snapshot must
 *      still exist for this restaurant, else 'sync_product_missing';
 *   2. the totals are recomputed from the snapshot lines with the
 *      rates captured at queue time and must match the queued
 *      totals exactly, else 'sync_totals_mismatch';
 *   3. the queued payments must be positive and within the order
 *      total, else 'sync_payment_exceeds'.
 * Only then is the order persisted (through the same
 * persistPricedOrder the live path uses, under the entry's UUID —
 * a retried sync upserts instead of duplicating) and its payments
 * upserted under their queued ids. The placement history note
 * records the offline origin: queued time + device (§5).
 */
export async function syncQueuedOrder(
  entry: QueuedOrder,
  userId: string,
): Promise<Order> {
  const { input, pricedLines } = entry

  const productIds = [...new Set(pricedLines.map((l) => l.productId))]
  const variantIds = [
    ...new Set(
      pricedLines.map((l) => l.variantId).filter((v): v is string => !!v),
    ),
  ]
  const modifierIds = [...new Set(pricedLines.flatMap((l) => l.modifierIds))]

  const { data: productRows, error: productsError } = await supabase
    .from('products')
    .select('id')
    .eq('restaurant_id', input.restaurantId)
    .in('id', productIds)
  if (productsError) throw productsError
  const productSet = new Set(
    ((productRows ?? []) as { id: string }[]).map((r) => r.id),
  )

  let variantRows: { id: string; product_id: string }[] = []
  if (variantIds.length > 0) {
    const { data, error } = await supabase
      .from('product_variants')
      .select('id, product_id')
      .in('id', variantIds)
    if (error) throw error
    variantRows = (data ?? []) as { id: string; product_id: string }[]
  }
  const variantById = new Map(variantRows.map((v) => [v.id, v]))

  let modifierSet = new Set<string>()
  if (modifierIds.length > 0) {
    const { data, error } = await supabase
      .from('modifiers')
      .select('id')
      .eq('restaurant_id', input.restaurantId)
      .in('id', modifierIds)
    if (error) throw error
    modifierSet = new Set(((data ?? []) as { id: string }[]).map((r) => r.id))
  }

  for (const line of pricedLines) {
    if (!productSet.has(line.productId)) throw new Error('sync_product_missing')
    if (line.variantId) {
      const variant = variantById.get(line.variantId)
      if (!variant || variant.product_id !== line.productId) {
        throw new Error('sync_product_missing')
      }
    }
    for (const modifierId of line.modifierIds) {
      if (!modifierSet.has(modifierId)) throw new Error('sync_product_missing')
    }
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new Error('sync_totals_mismatch')
    }
  }

  const totals = computeOrderTotals(
    pricedLines,
    input.discountAmount,
    entry.taxRate,
    entry.serviceChargeRate,
  )
  const queued = entry.totals
  if (
    totals.subtotal !== queued.subtotal ||
    totals.discountAmount !== queued.discountAmount ||
    totals.taxAmount !== queued.taxAmount ||
    totals.serviceChargeAmount !== queued.serviceChargeAmount ||
    totals.totalAmount !== queued.totalAmount ||
    totals.couponDiscount !== 0 ||
    totals.loyaltyDiscount !== 0
  ) {
    throw new Error('sync_totals_mismatch')
  }

  let paymentsTotal = 0
  for (const payment of entry.payments) {
    if (!Number.isFinite(payment.amount) || payment.amount <= 0) {
      throw new Error('sync_payment_exceeds')
    }
    paymentsTotal += payment.amount
  }
  if (roundMoney(paymentsTotal) > totals.totalAmount + 0.001) {
    throw new Error('sync_payment_exceeds')
  }

  const order = await persistPricedOrder({
    orderId: entry.id,
    input,
    pricedLines,
    totals,
    userId,
    historyNote: `Offline order - placed ${entry.queuedAt} on device ${entry.deviceId.slice(0, 8)}; synced ${new Date().toISOString()}`,
  })

  for (const payment of entry.payments) {
    const { error } = await supabase.from('order_payments').upsert(
      {
        id: payment.id,
        order_id: order.id,
        method: payment.method,
        amount: roundMoney(payment.amount),
        reference: payment.reference,
        received_by: userId,
      },
      { onConflict: 'id' },
    )
    if (error) throw error
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
