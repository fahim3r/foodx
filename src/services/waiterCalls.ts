// FoodX — "Call waiter" data service (migration 0038).
// A dine-in customer taps Call waiter on the public storefront; the
// call lands here as a PENDING waiter_calls row and the panel
// (Waiter page + POS strip, and the sound watcher) reacts live.
//
// The public side runs on the anon key, and tables/waiter_calls have
// no anon policies, so — exactly like place_online_order — the
// customer flow goes through SECURITY DEFINER functions:
// request_waiter_call() validates the table server-side and is
// idempotent (one pending call per table), waiter_call_pending()
// answers the single boolean the button polls, and
// resolve_table_by_code() maps the QR code (the only table identity
// the storefront holds) to the table id. Staff reads and the attend
// write use the normal authenticated client under RLS.
import { supabase } from '@/lib/supabase'
import type { WaiterCall } from '@/types'

/** A pending call as the staff surfaces consume it: the row plus
 * the table's display name, flattened from the join. */
export interface PendingWaiterCall {
  id: string
  restaurantId: string
  tableId: string
  tableName: string
  createdAt: string
}

/**
 * Resolve a table's QR code (the storefront's ?table= value) to its
 * id within the restaurant. Returns null when the code matches no
 * table — the storefront then simply never shows the button.
 */
export async function resolveTableIdByCode(
  restaurantId: string,
  tableCode: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('resolve_table_by_code', {
    p_restaurant_id: restaurantId,
    p_table_code: tableCode,
  })
  if (error) throw error
  return (data as string | null) ?? null
}

/**
 * Ask for a waiter at this table. Idempotent server-side: when a
 * call is already pending for the table, that same call comes back
 * and nothing new is created. Throws Error('table_not_found') when
 * the table does not belong to the restaurant.
 */
export async function requestWaiterCall(
  restaurantId: string,
  tableId: string,
): Promise<WaiterCall> {
  const { data, error } = await supabase
    .rpc('request_waiter_call', {
      p_restaurant_id: restaurantId,
      p_table_id: tableId,
    })
    .maybeSingle()
  if (error) {
    const message = error.message ?? ''
    throw new Error(message.includes('table_not_found') ? 'table_not_found' : 'call_failed')
  }
  if (!data) throw new Error('call_failed')
  return data as WaiterCall
}

/** Whether this table currently has a call waiting (customer poll). */
export async function waiterCallPending(
  restaurantId: string,
  tableId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('waiter_call_pending', {
    p_restaurant_id: restaurantId,
    p_table_id: tableId,
  })
  if (error) throw error
  return data === true
}

/** The restaurant's pending calls, oldest first (staff surfaces). */
export async function fetchPendingWaiterCalls(
  restaurantId: string,
): Promise<PendingWaiterCall[]> {
  const { data, error } = await supabase
    .from('waiter_calls')
    .select('id, restaurant_id, table_id, created_at, tables(name)')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as unknown as {
    id: string
    restaurant_id: string
    table_id: string
    created_at: string
    tables: { name: string } | null
  }[]
  return rows.map((row) => ({
    id: row.id,
    restaurantId: row.restaurant_id,
    tableId: row.table_id,
    tableName: row.tables?.name ?? '',
    createdAt: row.created_at,
  }))
}

/** Mark a call attended (the strip's Done button). */
export async function attendWaiterCall(
  id: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from('waiter_calls')
    .update({
      status: 'DONE',
      attended_by: userId,
      attended_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

/**
 * Realtime ping for waiter_calls of one restaurant — the same
 * subscribe shape as subscribeKitchenOrders (own channel name, so
 * the strip and the sound watcher never collide), with the
 * restaurant filter applied server-side. Returns an unsubscribe.
 */
export function subscribeWaiterCalls(
  restaurantId: string,
  onChange: () => void,
  channelName = 'waiter-calls',
): () => void {
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'waiter_calls',
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      () => onChange(),
    )
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}
