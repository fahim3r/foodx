// FoodX — customer data service.
// Customers are never hard-deleted: a customer leaves by deactivation
// (is_active = false). Their orders, loyalty history and points stay
// readable, because financial records are never deleted.
import { supabase } from '@/lib/supabase'
import type { Customer, CustomerStats, Order } from '@/types'

export async function fetchCustomers(
  restaurantId: string,
  search?: string,
): Promise<Customer[]> {
  let query = supabase
    .from('customers')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true })
  const q = search?.trim()
  if (q) {
    // PostgREST OR across name / phone / email.
    query = query.or(
      `name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`,
    )
  }
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Customer[]
}

export async function fetchCustomerById(
  customerId: string,
): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .maybeSingle()
  if (error) throw error
  return data as Customer | null
}

export async function fetchCustomerByPhone(
  restaurantId: string,
  phone: string,
): Promise<Customer | null> {
  const trimmed = phone.trim()
  if (!trimmed) return null
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('phone', trimmed)
    .maybeSingle()
  if (error) throw error
  return data as Customer | null
}

export async function createCustomer(
  restaurantId: string,
  values: {
    name: string
    phone?: string
    email?: string
    address?: string
    notes?: string
  },
): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      name: values.name.trim(),
      phone: values.phone?.trim() || null,
      email: values.email?.trim() || null,
      address: values.address?.trim() || null,
      notes: values.notes?.trim() || null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Customer
}

export async function updateCustomer(
  customerId: string,
  patch: Partial<
    Pick<
      Customer,
      'name' | 'phone' | 'email' | 'address' | 'notes' | 'is_active'
    >
  >,
): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .update(patch)
    .eq('id', customerId)
    .select()
    .single()
  if (error) throw error
  return data as Customer
}

/** Deactivate a customer. Their history stays — this only hides them
 * from the active list and from the POS picker. */
export async function deactivateCustomer(customerId: string): Promise<Customer> {
  return updateCustomer(customerId, { is_active: false })
}

/** Lifetime numbers for one customer, computed from their orders.
 * Cancelled / refunded orders do not count as visits or spending. */
export async function fetchCustomerStats(
  customerId: string,
): Promise<CustomerStats> {
  const { data, error } = await supabase
    .from('orders')
    .select('total_amount, created_at')
    .eq('customer_id', customerId)
    .not('status', 'in', '("CANCELLED","REFUNDED")')
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as Pick<Order, 'total_amount' | 'created_at'>[]
  return {
    orderCount: rows.length,
    totalSpent: rows.reduce((sum, row) => sum + Number(row.total_amount), 0),
    lastOrderAt: rows[0]?.created_at ?? null,
  }
}

/** Per-customer lifetime numbers for a whole restaurant, in two queries
 * (orders + loyalty transactions, aggregated here) — so the customer
 * list does not need one query per row. */
export async function fetchCustomerSummaries(
  restaurantId: string,
): Promise<
  Map<string, { orderCount: number; totalSpent: number; points: number }>
> {
  const [{ data: orders, error: ordersError }, { data: txns }] =
    await Promise.all([
      supabase
        .from('orders')
        .select('customer_id, total_amount')
        .eq('restaurant_id', restaurantId)
        .not('customer_id', 'is', null)
        .not('status', 'in', '("CANCELLED","REFUNDED")'),
      supabase
        .from('loyalty_transactions')
        .select('customer_id, points')
        .eq('restaurant_id', restaurantId),
    ])
  if (ordersError) throw ordersError
  const summaries = new Map<
    string,
    { orderCount: number; totalSpent: number; points: number }
  >()
  const get = (customerId: string) => {
    let entry = summaries.get(customerId)
    if (!entry) {
      entry = { orderCount: 0, totalSpent: 0, points: 0 }
      summaries.set(customerId, entry)
    }
    return entry
  }
  for (const row of (orders ?? []) as {
    customer_id: string
    total_amount: number
  }[]) {
    const entry = get(row.customer_id)
    entry.orderCount += 1
    entry.totalSpent += Number(row.total_amount)
  }
  for (const row of (txns ?? []) as {
    customer_id: string
    points: number
  }[]) {
    get(row.customer_id).points += Number(row.points)
  }
  return summaries
}

/** A customer's orders, newest first (all statuses — the detail view
 * shows cancelled / refunded orders too, marked as such). */
export async function fetchCustomerOrders(
  customerId: string,
): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Order[]
}
