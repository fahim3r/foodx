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
