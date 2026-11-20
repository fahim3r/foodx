// FoodX — orders data service: list, detail, status machine, cancel,
// refund. Every status change is validated against ORDER_TRANSITIONS
// (see src/types) and writes an order_status_history row. Financial
// records are never deleted — a wrong order is CANCELLED or REFUNDED.
import { supabase } from '@/lib/supabase'
import { guardedErrorCode } from '@/services/pin'
import {
  awardLoyaltyPoints,
  reverseLoyaltyEarn,
  reverseLoyaltyRedemption,
} from '@/services/loyalty'
import { fetchOrderPayments, summarizePayments } from '@/services/pos'
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
/** The To Serve board (gap 2): today's token orders that are READY
 * (waiting to be called) or SERVED (handed over), token order.
 * Dine-in orders carry no token (migration 0023), so they join the
 * board through a second query: every READY dine-in order (the page
 * presents those by table), plus dine-in orders served today so the
 * served column stays complete. */
export async function fetchServeBoard(
  restaurantId: string,
  tokenDay: string,
): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('token_day', tokenDay)
    .not('token_number', 'is', null)
    .in('status', ['READY', 'SERVED'])
    .order('token_number', { ascending: true })
  if (error) throw error
  const { data: dineInData, error: dineInError } = await supabase
    .from('orders')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('type', 'dine_in')
    .or(`status.eq.READY,and(status.eq.SERVED,updated_at.gte.${tokenDay})`)
    .order('created_at', { ascending: true })
  if (dineInError) throw dineInError
  return [...((data ?? []) as Order[]), ...((dineInData ?? []) as Order[])]
}

export async function markOrderServed(
  order: Order,
  userId: string,
): Promise<Order> {
  return advanceOrderStatus(order, 'SERVED', userId)
}

/** SERVED → COMPLETED: the order is done and the table frees up.
 * Completing awards loyalty points (one EARN per order, idempotent).
 * Best-effort — an award failure is logged and never fails the
 * completion.
 *
 * Payment gate (audit fix, user rule 2026-11-20): an order cannot be
 * completed while it still has a balance — the money must be collected,
 * or the remainder explicitly recorded as a 'due' payment, first.
 * Throws Error('payment_required') while the balance is above zero;
 * the check runs before the status change and before any loyalty
 * award, so a blocked completion changes nothing. */
export async function completeOrder(
  order: Order,
  userId: string,
): Promise<Order> {
  const payments = await fetchOrderPayments(order.id)
  const summary = summarizePayments(payments, Number(order.total_amount))
  if (summary.balance > 0) throw new Error('payment_required')
  const completed = await advanceOrderStatus(order, 'COMPLETED', userId)
  try {
    await awardLoyaltyPoints(completed)
  } catch (error) {
    console.error('[Orders] loyalty award failed', error)
  }
  return completed
}

/**
 * Cancel an order from any non-terminal status. A reason is required —
 * it is stored on the history row, so a cancelled order always explains
 * itself. Throws Error('cancel_reason_required') without one.
 *
 * Cancelling restocks: the SALE deduction is reversed with one RESTOCK
 * movement per item (restock_for_order(), idempotent). It also returns
 * any points the order redeemed (one REVERSAL, idempotent). Both are
 * best-effort — a failure is logged and never fails the cancel.
 * Refunds do NOT restock: a refunded order was already served, its
 * food is gone.
 */
/**
 * Cancel an order (gap 6): the transition runs through the
 * cancel_order_guarded RPC, which verifies the restaurant's manager
 * PIN server-side when one is set and performs the status change,
 * history row, restock and table release itself. The loyalty
 * reversal stays here, best-effort as before. `userId` is kept for
 * signature compatibility — the RPC records auth.uid() itself.
 */
export async function cancelOrder(
  order: Order,
  userId: string,
  reason: string,
  pin?: string,
): Promise<Order> {
  void userId
  if (!reason.trim()) throw new Error('cancel_reason_required')
  const { error } = await supabase.rpc('cancel_order_guarded', {
    p_order_id: order.id,
    p_pin: pin?.trim() || null,
    p_reason: reason.trim(),
  })
  if (error) throw new Error(guardedErrorCode(error))
  try {
    await reverseLoyaltyRedemption(order.id)
  } catch (loyaltyError) {
    console.error('[Orders] loyalty reversal after cancel failed', loyaltyError)
  }
  const updated = await fetchOrderById(order.id)
  return updated ?? { ...order, status: 'CANCELLED' }
}

/**
 * Refund a completed order. Only COMPLETED → REFUNDED is allowed; the
 * reason and the refunded amount are stored on the history row. (Full
 * refund accounting — negative payment rows — is later-phase work; the
 * refund here is a status + an auditable note, never a deletion.)
 *
 * Refunding reverses the points the order earned (one REVERSAL,
 * idempotent): the money came back, so the points for it come back too.
 * Best-effort — a reversal failure is logged and never fails the
 * refund. Refunds do NOT restock: the food was already served.
 */
export async function refundOrder(
  order: Order,
  userId: string,
  reason: string,
  amount?: number,
  pin?: string,
): Promise<Order> {
  void userId
  if (!reason.trim()) throw new Error('refund_reason_required')
  const note =
    amount !== undefined && Number.isFinite(amount)
      ? `Refunded ${amount} — ${reason.trim()}`
      : `Refunded — ${reason.trim()}`
  const { error } = await supabase.rpc('refund_order_guarded', {
    p_order_id: order.id,
    p_pin: pin?.trim() || null,
    p_note: note,
  })
  if (error) throw new Error(guardedErrorCode(error))
  try {
    await reverseLoyaltyEarn(order.id)
  } catch (loyaltyError) {
    console.error('[Orders] loyalty reversal after refund failed', loyaltyError)
  }
  const updated = await fetchOrderById(order.id)
  return updated ?? { ...order, status: 'REFUNDED' }
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

/** Statuses an order can be merged from / into (roadmap gap 3). */
export const MERGEABLE_STATUSES: OrderStatus[] = [
  'CONFIRMED',
  'SENT_TO_KITCHEN',
  'PREPARING',
  'READY',
  'SERVED',
]

/**
 * Orders this one could merge into: same restaurant, open, not a
 * delivery order, not the order itself, oldest first. The page sorts
 * same-table candidates to the top.
 */
export async function fetchMergeCandidates(
  restaurantId: string,
  excludeOrderId: string,
): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .in('status', MERGEABLE_STATUSES)
    .neq('type', 'delivery')
    .neq('id', excludeOrderId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Order[]
}

/** Map a merge_orders failure to a stable error code for the UI. */
export function mergeErrorCode(error: unknown): string {
  const raw = (error as { message?: unknown } | null | undefined)?.message
  const message =
    typeof raw === 'string'
      ? raw
      : error instanceof Error
        ? error.message
        : String(error)
  if (message.includes('pin_incorrect')) return 'pin_incorrect'
  if (message.includes('pin_required')) return 'pin_required'
  if (message.includes('merge_same_order')) return 'merge_same_order'
  if (message.includes('merge_invalid_status')) return 'merge_invalid_status'
  if (message.includes('merge_delivery_not_supported')) {
    return 'merge_delivery_not_supported'
  }
  if (message.includes('merge_loyalty_coupon_not_supported')) {
    return 'merge_loyalty_coupon_not_supported'
  }
  return 'merge_failed'
}

/**
 * Merge the source order into the target (migration 0025 RPC — the
 * move is atomic in the database). When the restaurant has a manager
 * PIN set, the RPC verifies it. Throws an Error whose message is a
 * stable code (see mergeErrorCode).
 */
export async function mergeOrders(
  sourceId: string,
  targetId: string,
  pin?: string,
): Promise<void> {
  const { error } = await supabase.rpc('merge_orders', {
    p_source_id: sourceId,
    p_target_id: targetId,
    p_pin: pin?.trim() || null,
  })
  if (error) throw new Error(mergeErrorCode(error))
}
