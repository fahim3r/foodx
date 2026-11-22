// FoodX — purchase order service (supplier purchases).
//
// STATE MACHINE: DRAFT → ORDERED → PARTIALLY_RECEIVED → RECEIVED,
// CLOSED from PARTIALLY_RECEIVED (the remainder will never arrive),
// CANCELLED from DRAFT or ORDERED only. Enforced here
// (PURCHASE_ORDER_TRANSITIONS) — the database CHECK only restricts
// the column to the valid set.
//
// RECEIVING (migration 0035): a PO is received in as many receipts
// as it takes via receivePurchaseOrderLines() — each receipt names
// the per-line quantities that actually arrived, writes one PURCHASE
// stock movement per line (the movements ARE the receipt log), and
// maintains received_amount on the PO. A line can never receive more
// than its remaining quantity: validated here against a FRESH
// re-read of the detail, and hard-blocked in the database by the
// received_quantity <= quantity CHECK. receivePurchaseOrder() is the
// one-click "receive all" built on top of it.
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

/** One line of a single receipt event: how much of this PO line
 * arrived this time. Quantities of 0 (or lines not listed) are
 * left untouched. */
export interface PurchaseOrderReceiveLine {
  purchaseOrderItemId: string
  quantity: number
}

/** One past receipt, read from the PURCHASE stock movements — the
 * movements are the receipt log (design §3-Q6, no separate table). */
export interface PurchaseOrderReceipt {
  id: string
  inventory_item_id: string
  item_name: string
  item_unit: string
  quantity: number
  created_by: string | null
  created_at: string
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
  // NOTE: purchase_order_items has no created_at column — do not order by it
  // (PostgREST 42703). Line order is display-only.
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
 * Record ONE receipt against a purchase order: the per-line
 * quantities that arrived this time. The PO must be ORDERED or
 * PARTIALLY_RECEIVED. The detail is re-read fresh — the caller's
 * snapshot is never trusted — and every quantity is validated
 * against the line's remaining quantity (quantity −
 * received_quantity): an invalid quantity throws
 * Error('invalid_quantity'), receiving more than remains throws
 * Error('over_receipt'), and a receipt with no positive line at
 * all throws Error('empty_receipt'). One PURCHASE stock movement
 * is written per received line, received_quantity is incremented,
 * received_amount is recomputed, and the PO lands on RECEIVED when
 * nothing remains, else PARTIALLY_RECEIVED.
 */
export async function receivePurchaseOrderLines(
  order: PurchaseOrder,
  lines: PurchaseOrderReceiveLine[],
): Promise<PurchaseOrder> {
  const detail = await fetchPurchaseOrderDetail(order.id)
  if (
    detail.status !== 'ORDERED' &&
    detail.status !== 'PARTIALLY_RECEIVED'
  ) {
    throw new Error('invalid_transition')
  }
  const lineById = new Map(detail.items.map((line) => [line.id, line]))

  // Aggregate first, so a line listed twice is validated (and
  // received) once, at its combined quantity.
  const requestedByLineId = new Map<string, number>()
  for (const entry of lines) {
    requestedByLineId.set(
      entry.purchaseOrderItemId,
      (requestedByLineId.get(entry.purchaseOrderItemId) ?? 0) +
        Number(entry.quantity),
    )
  }

  const accepted: { line: PurchaseOrderItemWithItem; quantity: number }[] =
    []
  for (const [purchaseOrderItemId, quantity] of requestedByLineId) {
    if (quantity === 0) continue
    const line = lineById.get(purchaseOrderItemId)
    if (!line || !Number.isFinite(quantity) || quantity < 0) {
      throw new Error('invalid_quantity')
    }
    const remaining =
      Number(line.quantity) - Number(line.received_quantity)
    if (quantity > remaining) {
      throw new Error('over_receipt')
    }
    accepted.push({ line, quantity })
  }
  if (accepted.length === 0) {
    throw new Error('empty_receipt')
  }

  // Stock first: one PURCHASE movement per received line (the
  // movements are the receipt log).
  for (const { line, quantity } of accepted) {
    await applyMovement(line.inventory_item_id, {
      type: 'PURCHASE',
      delta: quantity,
      reason: null,
      referenceType: 'purchase_order',
      referenceId: order.id,
    })
  }

  // Then the line quantities (the widened RLS policy allows this
  // while the PO is ORDERED or PARTIALLY_RECEIVED — the status is
  // flipped only at the end).
  const receivedByLineId = new Map(
    accepted.map(({ line, quantity }) => [line.id, quantity]),
  )
  for (const { line, quantity } of accepted) {
    const { error } = await supabase
      .from('purchase_order_items')
      .update({
        received_quantity: Number(line.received_quantity) + quantity,
      })
      .eq('id', line.id)
    if (error) throw error
  }

  const receivedAmount = roundMoney(
    detail.items.reduce((sum, line) => {
      const received =
        Number(line.received_quantity) +
        (receivedByLineId.get(line.id) ?? 0)
      return sum + received * Number(line.unit_cost)
    }, 0),
  )
  const allReceived = detail.items.every(
    (line) =>
      Number(line.received_quantity) +
        (receivedByLineId.get(line.id) ?? 0) >=
      Number(line.quantity),
  )

  const { data, error } = await supabase
    .from('purchase_orders')
    .update({
      status: allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED',
      received_amount: receivedAmount,
    })
    .eq('id', order.id)
    .select()
    .single()
  if (error) throw error
  return data as PurchaseOrder
}

/**
 * Receive a purchase order IN FULL: every line's remaining quantity,
 * in one receipt. Built on receivePurchaseOrderLines(), so it works
 * from ORDERED and from PARTIALLY_RECEIVED alike; anything else
 * throws Error('invalid_transition').
 */
export async function receivePurchaseOrder(
  order: PurchaseOrder,
): Promise<PurchaseOrder> {
  const detail = await fetchPurchaseOrderDetail(order.id)
  if (
    detail.status !== 'ORDERED' &&
    detail.status !== 'PARTIALLY_RECEIVED'
  ) {
    throw new Error('invalid_transition')
  }
  return receivePurchaseOrderLines(
    order,
    detail.items
      .map((line) => ({
        purchaseOrderItemId: line.id,
        quantity:
          Number(line.quantity) - Number(line.received_quantity),
      }))
      .filter((line) => line.quantity > 0),
  )
}

/**
 * Close off a partially received PO whose remainder will never
 * arrive: PARTIALLY_RECEIVED → CLOSED. No movements, no line
 * changes — received_amount already holds exactly the money that
 * counts, and the arrived stock stays in stock.
 */
export async function closePurchaseOrderRemainder(
  order: PurchaseOrder,
): Promise<PurchaseOrder> {
  if (order.status !== 'PARTIALLY_RECEIVED') {
    throw new Error('invalid_transition')
  }
  const { data, error } = await supabase
    .from('purchase_orders')
    .update({ status: 'CLOSED' })
    .eq('id', order.id)
    .select()
    .single()
  if (error) throw error
  return data as PurchaseOrder
}

/**
 * The receipt history of a PO: its PURCHASE stock movements,
 * newest first. Who (created_by) and when (created_at) ride along;
 * resolving created_by to a name is a follow-up nicety (design §4.3).
 */
export async function fetchPurchaseOrderReceipts(
  purchaseOrderId: string,
): Promise<PurchaseOrderReceipt[]> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*, inventory_items(name, unit)')
    .eq('reference_type', 'purchase_order')
    .eq('reference_id', purchaseOrderId)
    .eq('movement_type', 'PURCHASE')
    .order('created_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as Array<{
    id: string
    inventory_item_id: string
    quantity_change: number
    created_by: string | null
    created_at: string
    inventory_items: { name: string; unit: string } | null
  }>).map((row) => ({
    id: row.id,
    inventory_item_id: row.inventory_item_id,
    item_name: row.inventory_items?.name ?? '—',
    item_unit: row.inventory_items?.unit ?? '',
    quantity: Number(row.quantity_change),
    created_by: row.created_by,
    created_at: row.created_at,
  }))
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
