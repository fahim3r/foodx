// FoodX — purchase order service (supplier purchases).
//
// STATE MACHINE: DRAFT → ORDERED → RECEIVED, CANCELLED from DRAFT or
// ORDERED only. Enforced here (PURCHASE_ORDER_TRANSITIONS) — the
// database CHECK only restricts the column to the valid set.
//
// RECEIVING IS FULL ONLY: receivePurchaseOrder() receives every line at
// its ordered quantity. Partial receiving is NOT implemented — the UI
// says so, and this function has no per-line quantity parameter. Do not
// fake it.
//
// IDEMPOTENCY: receiving checks for existing PURCHASE movements with
// reference_id = the purchase order id and skips lines that already
// have one, so a retried receive cannot double-add stock.
import { supabase } from '@/lib/supabase'
import { applyMovement } from '@/services/inventory'
import {
  PURCHASE_ORDER_TRANSITIONS,
  type PurchaseOrder,
  type PurchaseOrderItem,
  type PurchaseOrderItemWithItem,
  type PurchaseOrderStatus,
  type PurchaseOrderWithDetails,
} from '@/types'

export interface PurchaseOrderLineInput {
  inventoryItemId: string
  quantity: number
  unitCost: number
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function canTransition(
  from: PurchaseOrderStatus,
  to: PurchaseOrderStatus,
): boolean {
  return (PURCHASE_ORDER_TRANSITIONS[from] ?? []).includes(to)
}

export async function fetchPurchaseOrders(
  restaurantId: string,
): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as PurchaseOrder[]
}

export async function fetchPurchaseOrderDetail(
  purchaseOrderId: string,
): Promise<PurchaseOrderWithDetails> {
  const { data: order, error: orderError } = await supabase
    .from('purchase_orders')
    .select('*, suppliers(name)')
    .eq('id', purchaseOrderId)
    .single()
  if (orderError) throw orderError
  const { data: lines, error: linesError } = await supabase
    .from('purchase_order_items')
    .select('*, inventory_items(name, unit)')
    .eq('purchase_order_id', purchaseOrderId)
    .order('created_at', { ascending: true })
  if (linesError) throw linesError
  const orderRow = order as PurchaseOrder & {
    suppliers: { name: string } | null
  }
  const lineRows = (lines ?? []) as Array<
    PurchaseOrderItem & {
      inventory_items: { name: string; unit: string } | null
    }
  >
  return {
    ...orderRow,
    supplier_name: orderRow.suppliers?.name ?? '—',
    items: lineRows.map((row) => ({
      ...row,
      item_name: row.inventory_items?.name ?? '—',
      item_unit: row.inventory_items?.unit ?? '',
      inventory_items: undefined,
    })) as PurchaseOrderItemWithItem[],
    suppliers: undefined,
  } as PurchaseOrderWithDetails
}

export async function createPurchaseOrder(
  restaurantId: string,
  values: {
    supplierId: string
    orderDate?: string
    notes?: string
    lines: PurchaseOrderLineInput[]
  },
): Promise<PurchaseOrder> {
  if (!values.supplierId) throw new Error('supplier_required')
  const validLines = values.lines.filter(
    (line) =>
      line.inventoryItemId &&
      Number.isFinite(line.quantity) &&
      line.quantity > 0 &&
      Number.isFinite(line.unitCost) &&
      line.unitCost >= 0,
  )
  if (validLines.length === 0) throw new Error('empty_order')

  const orderId = crypto.randomUUID()
  const totalAmount = roundMoney(
    validLines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0),
  )
  const { data, error } = await supabase
    .from('purchase_orders')
    .insert({
      id: orderId,
      restaurant_id: restaurantId,
      supplier_id: values.supplierId,
      status: 'DRAFT',
      order_date: values.orderDate || new Date().toISOString().slice(0, 10),
      total_amount: totalAmount,
      notes: values.notes?.trim() || null,
    })
    .select()
    .single()
  if (error) throw error

  const { error: linesError } = await supabase
    .from('purchase_order_items')
    .insert(
      validLines.map((line) => ({
        id: crypto.randomUUID(),
        purchase_order_id: orderId,
        inventory_item_id: line.inventoryItemId,
        quantity: line.quantity,
        unit_cost: roundMoney(line.unitCost),
        received_quantity: 0,
      })),
    )
  if (linesError) throw linesError
  return data as PurchaseOrder
}

/** Move a purchase order to a new status. Throws
 * Error('invalid_transition') when the move is not allowed. */
export async function advancePurchaseOrderStatus(
  order: PurchaseOrder,
  to: PurchaseOrderStatus,
): Promise<PurchaseOrder> {
  if (!canTransition(order.status, to)) {
    throw new Error('invalid_transition')
  }
  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ status: to })
    .eq('id', order.id)
    .select()
    .single()
  if (error) throw error
  return data as PurchaseOrder
}

/**
 * Receive a purchase order IN FULL: every line at its ordered quantity.
 * Stock increases by one PURCHASE movement per line (reference_type
 * 'purchase_order'). Lines that already have such a movement are
 * skipped, so a retried receive cannot double-add. The order must be
 * ORDERED; anything else throws Error('invalid_transition').
 */
export async function receivePurchaseOrder(
  order: PurchaseOrder,
): Promise<PurchaseOrder> {
  if (order.status !== 'ORDERED') {
    throw new Error('invalid_transition')
  }
  const detail = await fetchPurchaseOrderDetail(order.id)

  // Which lines already have a PURCHASE movement for this order?
  const { data: existing, error: existingError } = await supabase
    .from('stock_movements')
    .select('inventory_item_id')
    .eq('reference_type', 'purchase_order')
    .eq('reference_id', order.id)
    .eq('movement_type', 'PURCHASE')
  if (existingError) throw existingError
  const alreadyReceived = new Set(
    ((existing ?? []) as { inventory_item_id: string }[]).map(
      (row) => row.inventory_item_id,
    ),
  )

  for (const line of detail.items) {
    if (alreadyReceived.has(line.inventory_item_id)) continue
    await applyMovement(line.inventory_item_id, {
      type: 'PURCHASE',
      delta: Number(line.quantity),
      reason: null,
      referenceType: 'purchase_order',
      referenceId: order.id,
    })
  }

  // Mark every line fully received (while the order is still ORDERED —
  // the RLS update policy allows it in DRAFT / ORDERED only).
  for (const line of detail.items) {
    const { error } = await supabase
      .from('purchase_order_items')
      .update({ received_quantity: Number(line.quantity) })
      .eq('id', line.id)
    if (error) throw error
  }

  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ status: 'RECEIVED' })
    .eq('id', order.id)
    .select()
    .single()
  if (error) throw error
  return data as PurchaseOrder
}

export async function deletePurchaseOrder(
  orderId: string,
): Promise<void> {
  // Only a DRAFT order may be deleted; anything further along is
  // history (cancel it instead). Lines cascade.
  const { error } = await supabase
    .from('purchase_orders')
    .delete()
    .eq('id', orderId)
    .eq('status', 'DRAFT')
  if (error) throw error
}
