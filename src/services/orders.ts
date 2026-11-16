// FoodX — orders data service: list, detail, status machine, cancel,
// refund. Every status change is validated against ORDER_TRANSITIONS
// (see src/types) and writes an order_status_history row. Financial
// records are never deleted — a wrong order is CANCELLED or REFUNDED.
import { supabase } from '@/lib/supabase'
import { setTableStatus } from '@/services/tables'
import {
  canTransitionOrderStatus,
  TERMINAL_ORDER_STATUSES,
  type Order,
  type OrderDetail,
  type OrderItemWithModifiers,
  type OrderPayment,
  type OrderStatus,
  type OrderStatusHistory,
} from '@/types'

export async function fetchOrders(
  restaurantId: string,
  opts?: { status?: OrderStatus | 'ALL'; limit?: number },
): Promise<Order[]> {
  let query = supabase
    .from('orders')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 50)
  if (opts?.status && opts.status !== 'ALL') {
    query = query.eq('status', opts.status)
  }
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Order[]
}

export async function fetchOrderById(orderId: string): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw error
  return data as Order | null
}

export async function fetchOrderDetail(orderId: string): Promise<OrderDetail> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      '*, order_items(*, order_item_modifiers(*)), order_payments(*), order_status_history(*)',
    )
    .eq('id', orderId)
    .single()
  if (error) throw error
  const row = data as Order & {
    order_items: Array<
      OrderItemWithModifiers & { order_item_modifiers: OrderItemWithModifiers['modifiers'] }
    >
    order_payments: OrderPayment[]
    order_status_history: OrderStatusHistory[]
  }
  const byCreated = (a: { created_at: string }, b: { created_at: string }) =>
    a.created_at.localeCompare(b.created_at)
  return {
    ...row,
    items: (row.order_items ?? [])
      .map((item) => ({
        ...item,
        modifiers: [...(item.order_item_modifiers ?? [])].sort(byCreated),
      }))
      .sort(byCreated),
    payments: [...(row.order_payments ?? [])].sort(byCreated),
    history: [...(row.order_status_history ?? [])].sort(byCreated),
    order_items: undefined,
    order_payments: undefined,
    order_status_history: undefined,
  } as OrderDetail
}

/** Release a table when its order reaches a terminal status — but only
 * when no other active order still uses the table. */
async function releaseTableIfFree(tableId: string): Promise<void> {
  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .eq('table_id', tableId)
    .not('status', 'in', `(${TERMINAL_ORDER_STATUSES.map((s) => `"${s}"`).join(',')})`)
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) {
    await setTableStatus(tableId, 'available')
  }
}

/**
 * Move an order along the state machine. Throws
 * Error('invalid_status_transition') for a move the machine forbids.
 * Every successful move writes a history row and, on terminal statuses,
 * frees the table when nothing else uses it.
 */
export async function advanceOrderStatus(
  order: Order,
  toStatus: OrderStatus,
  userId: string,
  note?: string,
): Promise<Order> {
  if (!canTransitionOrderStatus(order.status, toStatus)) {
    throw new Error('invalid_status_transition')
  }
  const { data, error } = await supabase
    .from('orders')
    .update({ status: toStatus })
    .eq('id', order.id)
    .select()
    .single()
  if (error) throw error
  const updated = data as Order
  const { error: historyError } = await supabase
    .from('order_status_history')
    .insert({
      id: crypto.randomUUID(),
      order_id: order.id,
      from_status: order.status,
      to_status: toStatus,
      changed_by: userId,
      note: note?.trim() || null,
    })
  if (historyError) throw historyError
  if (order.table_id && TERMINAL_ORDER_STATUSES.includes(toStatus)) {
    await releaseTableIfFree(order.table_id)
  }
  return updated
}

/** CONFIRMED → SENT_TO_KITCHEN: the kitchen starts work on this order. */
export async function sendOrderToKitchen(
  order: Order,
  userId: string,
): Promise<Order> {
  return advanceOrderStatus(order, 'SENT_TO_KITCHEN', userId)
}

/** READY → SERVED: the food left the kitchen / was handed over. */
export async function markOrderServed(
  order: Order,
  userId: string,
): Promise<Order> {
  return advanceOrderStatus(order, 'SERVED', userId)
}

/** SERVED → COMPLETED: the order is done and the table frees up. */
export async function completeOrder(
  order: Order,
  userId: string,
): Promise<Order> {
  return advanceOrderStatus(order, 'COMPLETED', userId)
}

/**
 * Cancel an order from any non-terminal status. A reason is required —
 * it is stored on the history row, so a cancelled order always explains
 * itself. Throws Error('cancel_reason_required') without one.
 */
export async function cancelOrder(
  order: Order,
  userId: string,
  reason: string,
): Promise<Order> {
  if (!reason.trim()) throw new Error('cancel_reason_required')
  return advanceOrderStatus(order, 'CANCELLED', userId, reason.trim())
}

/**
 * Refund a completed order. Only COMPLETED → REFUNDED is allowed; the
 * reason and the refunded amount are stored on the history row. (Full
 * refund accounting — negative payment rows — is later-phase work; the
 * refund here is a status + an auditable note, never a deletion.)
 */
export async function refundOrder(
  order: Order,
  userId: string,
  reason: string,
  amount?: number,
): Promise<Order> {
  if (!reason.trim()) throw new Error('refund_reason_required')
  const note =
    amount !== undefined && Number.isFinite(amount)
      ? `Refunded ${amount} — ${reason.trim()}`
      : `Refunded — ${reason.trim()}`
  return advanceOrderStatus(order, 'REFUNDED', userId, note)
}

/** Today's orders for the dashboard (non-cancelled, newest first). */
export async function fetchTodayOrders(
  restaurantId: string,
): Promise<Order[]> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', start.toISOString())
    .not('status', 'in', '("CANCELLED","REFUNDED")')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Order[]
}
