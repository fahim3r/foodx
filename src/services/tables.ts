// FoodX — tables data service. Tables are branch-scoped; the POS and the
// Tables page both read the live `status` column, which the order flow
// keeps in sync (occupied when an order is placed, available again when
// the order is completed/cancelled and no other active order uses it).
import { supabase } from '@/lib/supabase'
import type { DiningTable, TableStatus } from '@/types'

export async function fetchTables(
  restaurantId: string,
): Promise<DiningTable[]> {
  const { data, error } = await supabase
    .from('tables')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as DiningTable[]
}

export async function createTable(
  restaurantId: string,
  values: {
    branchId?: string | null
    name: string
    seats: number
  },
): Promise<DiningTable> {
  const { data, error } = await supabase
    .from('tables')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      branch_id: values.branchId ?? null,
      name: values.name.trim(),
      seats: values.seats,
      status: 'available',
      qr_code: null,
    })
    .select()
    .single()
  if (error) throw error
  return data as DiningTable
}

export async function updateTable(
  tableId: string,
  patch: Partial<
    Pick<DiningTable, 'branch_id' | 'name' | 'seats' | 'qr_code' | 'nfc_value'>
  >,
): Promise<DiningTable> {
  const { data, error } = await supabase
    .from('tables')
    .update(patch)
    .eq('id', tableId)
    .select()
    .single()
  if (error) throw error
  return data as DiningTable
}

export async function setTableStatus(
  tableId: string,
  status: TableStatus,
): Promise<DiningTable> {
  const { data, error } = await supabase
    .from('tables')
    .update({ status })
    .eq('id', tableId)
    .select()
    .single()
  if (error) throw error
  return data as DiningTable
}

/**
 * Delete a table. Refuses when the table has an active order (an order
 * whose status is not COMPLETED / CANCELLED / REFUNDED) — deleting it
 * would orphan a live order. Throws Error('table_has_active_orders').
 */
export async function deleteTable(tableId: string): Promise<void> {
  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .eq('table_id', tableId)
    .not('status', 'in', '("COMPLETED","CANCELLED","REFUNDED")')
    .limit(1)
  if (error) throw error
  if (data && data.length > 0) {
    throw new Error('table_has_active_orders')
  }
  const { error: deleteError } = await supabase
    .from('tables')
    .delete()
    .eq('id', tableId)
  if (deleteError) throw deleteError
}

/**
 * The earliest open (non-terminal) order's created_at per table —
 * the honest "occupied since" for the Tables page timers (gap 4).
 * Tables carry no occupied-since column; the open order's creation
 * time is the source. Tables with no open order are absent.
 */
export async function fetchOpenOrderStarts(
  restaurantId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('orders')
    .select('table_id, created_at')
    .eq('restaurant_id', restaurantId)
    .not('table_id', 'is', null)
    .not('status', 'in', '(\"COMPLETED\",\"CANCELLED\",\"REFUNDED\")')
    .order('created_at', { ascending: true })
  if (error) throw error
  const starts = new Map<string, string>()
  for (const row of (data ?? []) as {
    table_id: string
    created_at: string
  }[]) {
    if (!starts.has(row.table_id)) starts.set(row.table_id, row.created_at)
  }
  return starts
}

/** Per-table rollup of the open (non-terminal) dine-in orders, for
 * the Dashboard's Live Tables floor view: the earliest open order
 * (the one a click opens), the summed running total, the "occupied
 * since" timestamp and the open-order count. Tables with no open
 * order are absent from the map. */
export interface OpenTableOrderSummary {
  orderId: string
  total: number
  since: string
  count: number
  /** True when any open order for the table has been SERVED —
   * the Live Tables floor only puts food on the table then. */
  served: boolean
  /** Status of the table's earliest open order (live pipeline). */
  status: string
  /** True when the earliest open order is fully paid (non-due
   * payments cover its total) but not yet completed. */
  paid: boolean
}

export async function fetchOpenTableOrders(
  restaurantId: string,
): Promise<Map<string, OpenTableOrderSummary>> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, table_id, total_amount, created_at, status')
    .eq('restaurant_id', restaurantId)
    .not('table_id', 'is', null)
    .not('status', 'in', '("COMPLETED","CANCELLED","REFUNDED")')
    .order('created_at', { ascending: true })
  if (error) throw error
  const byTable = new Map<string, OpenTableOrderSummary>()
  const firstTotals = new Map<string, number>()
  for (const row of (data ?? []) as {
    id: string
    table_id: string
    total_amount: number
    created_at: string
    status: string
  }[]) {
    const existing = byTable.get(row.table_id)
    if (existing) {
      existing.total += Number(row.total_amount) || 0
      existing.count += 1
      existing.served = existing.served || row.status === 'SERVED'
    } else {
      byTable.set(row.table_id, {
        orderId: row.id,
        total: Number(row.total_amount) || 0,
        since: row.created_at,
        count: 1,
        served: row.status === 'SERVED',
        status: row.status,
        paid: false,
      })
      firstTotals.set(row.table_id, Number(row.total_amount) || 0)
    }
  }
  // Payment state for each table's earliest open order: fully paid
  // (ignoring 'due' rows) while the order is still open.
  if (byTable.size > 0) {
    const orderIds = [...byTable.values()].map((entry) => entry.orderId)
    const { data: payments } = await supabase
      .from('order_payments')
      .select('order_id, method, amount')
      .in('order_id', orderIds)
    const paidByOrder = new Map<string, number>()
    for (const payment of (payments ?? []) as {
      order_id: string
      method: string
      amount: number
    }[]) {
      if (payment.method === 'due') continue
      paidByOrder.set(
        payment.order_id,
        (paidByOrder.get(payment.order_id) ?? 0) + (Number(payment.amount) || 0),
      )
    }
    for (const [tableId, entry] of byTable) {
      const paidAmount = paidByOrder.get(entry.orderId) ?? 0
      entry.paid = paidAmount >= (firstTotals.get(tableId) ?? 0) - 0.001
    }
  }
  return byTable
}
