// FoodX — loyalty points service.
//
// THE RULE: a customer's balance is ALWAYS SUM(loyalty_transactions.points)
// — there is no balance column anywhere, so it can never drift.
// Transactions are append-only (SELECT + INSERT policies only): a wrong
// entry is corrected by a new ADJUSTMENT / REVERSAL row, never by editing.
//
// Points are earned only when an order COMPLETES (awardLoyaltyPoints,
// called best-effort from completeOrder) and redeemed only at the POS
// (recordLoyaltyRedemption, called best-effort from createOrder). One
// EARN and one REDEEM per order, enforced by the DB partial unique index
// — the pre-checks below are the fast path, the index is the guarantee.
import { supabase } from '@/lib/supabase'
import { isUniqueViolationError } from '@/lib/errors'
import { fetchSettings } from '@/services/restaurant'
import type {
  LoyaltyRates,
  LoyaltyTransaction,
  LoyaltyTransactionWithOrder,
  Order,
  RestaurantSettings,
} from '@/types'

/** Loyalty rates from a settings row, with the v1 defaults (1 point per
 * 100 currency units, 1 point = 1 currency unit) when the row — or a
 * rate — is missing. */
export function readLoyaltyRates(
  settings: RestaurantSettings | null,
): LoyaltyRates {
  const earnPer100 = Number(settings?.loyalty_earn_per_100 ?? 1)
  const pointValue = Number(settings?.loyalty_point_value ?? 1)
  return {
    earnPer100:
      Number.isFinite(earnPer100) && earnPer100 > 0 ? earnPer100 : 1,
    pointValue:
      Number.isFinite(pointValue) && pointValue > 0 ? pointValue : 1,
  }
}

export async function fetchLoyaltyRates(
  restaurantId: string,
): Promise<LoyaltyRates> {
  return readLoyaltyRates(await fetchSettings(restaurantId))
}

/** A customer's current balance: the sum of every transaction. */
export async function fetchCustomerBalance(
  customerId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('loyalty_transactions')
    .select('points')
    .eq('customer_id', customerId)
  if (error) throw error
  return ((data ?? []) as { points: number }[]).reduce(
    (sum, row) => sum + Number(row.points),
    0,
  )
}

type LoyaltyRow = LoyaltyTransaction & {
  orders: { order_number: number } | null
  customers: { name: string } | null
}

function mapLoyaltyRows(
  rows: Array<Partial<LoyaltyRow> & LoyaltyTransaction>,
): LoyaltyTransactionWithOrder[] {
  return rows.map((row) => ({
    ...row,
    order_number: row.orders?.order_number ?? null,
    customer_name: row.customers?.name ?? null,
    orders: undefined,
    customers: undefined,
  })) as LoyaltyTransactionWithOrder[]
}

/** One customer's loyalty history, newest first. Tries the order /
 * customer join first; falls back to a plain select if the embed fails. */
export async function fetchLoyaltyTransactions(
  customerId: string,
  limit = 100,
): Promise<LoyaltyTransactionWithOrder[]> {
  const joined = await supabase
    .from('loyalty_transactions')
    .select('*, orders(order_number), customers(name)')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (!joined.error) return mapLoyaltyRows(joined.data ?? [])
  const { data, error } = await supabase
    .from('loyalty_transactions')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return mapLoyaltyRows(data ?? [])
}

/** Recent loyalty activity across a restaurant, newest first. */
export async function fetchRecentLoyaltyTransactions(
  restaurantId: string,
  limit = 50,
): Promise<LoyaltyTransactionWithOrder[]> {
  const joined = await supabase
    .from('loyalty_transactions')
    .select('*, orders(order_number), customers(name)')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (!joined.error) return mapLoyaltyRows(joined.data ?? [])
  const { data, error } = await supabase
    .from('loyalty_transactions')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return mapLoyaltyRows(data ?? [])
}

async function fetchOrderNumber(orderId: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('order_number')
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw error
  return data ? Number(data.order_number) : null
}

/**
 * Award points for a completed order. Returns the points awarded (0
 * when there is no customer, the order is too small, or the EARN
 * already exists). A retried completion racing this one hits the unique
 * index and is treated as already-awarded, not as a failure.
 */
export async function awardLoyaltyPoints(order: Order): Promise<number> {
  if (!order.customer_id) return 0
  const rates = await fetchLoyaltyRates(order.restaurant_id)
  const { data: existing, error: existingError } = await supabase
    .from('loyalty_transactions')
    .select('id')
    .eq('order_id', order.id)
    .eq('type', 'EARN')
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) return 0
  const points = Math.floor(
    Math.floor(Number(order.total_amount) / 100) * rates.earnPer100,
  )
  if (points <= 0) return 0
  const { error } = await supabase.from('loyalty_transactions').insert({
    id: crypto.randomUUID(),
    restaurant_id: order.restaurant_id,
    customer_id: order.customer_id,
    order_id: order.id,
    type: 'EARN',
    points,
    reason: `Earned — order #${order.order_number}`,
    created_by: order.created_by ?? null,
  })
  if (error) {
    if (isUniqueViolationError(error)) return 0
    throw error
  }
  return points
}

/**
 * Record a POS redemption (called best-effort from createOrder).
 * Returns the points recorded (0 when there is no customer, nothing
 * was redeemed, or the REDEEM already exists).
 */
export async function recordLoyaltyRedemption(
  order: Order,
  pointsRedeemed: number,
): Promise<number> {
  if (!order.customer_id || pointsRedeemed <= 0) return 0
  const { error } = await supabase.from('loyalty_transactions').insert({
    id: crypto.randomUUID(),
    restaurant_id: order.restaurant_id,
    customer_id: order.customer_id,
    order_id: order.id,
    type: 'REDEEM',
    points: -pointsRedeemed,
    reason: `Redeemed — order #${order.order_number}`,
    created_by: order.created_by ?? null,
  })
  if (error) {
    if (isUniqueViolationError(error)) return 0
    throw error
  }
  return pointsRedeemed
}

async function hasReversal(orderId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('loyalty_transactions')
    .select('id')
    .eq('order_id', orderId)
    .eq('type', 'REVERSAL')
    .maybeSingle()
  if (error) throw error
  return !!data
}

/**
 * Return redeemed points when an order is cancelled. Returns the points
 * returned (0 when nothing was redeemed or the reversal already
 * exists). Idempotent — a retried cancel cannot return points twice.
 */
export async function reverseLoyaltyRedemption(
  orderId: string,
): Promise<number> {
  const { data: redeem, error: redeemError } = await supabase
    .from('loyalty_transactions')
    .select('id, restaurant_id, customer_id, points')
    .eq('order_id', orderId)
    .eq('type', 'REDEEM')
    .maybeSingle()
  if (redeemError) throw redeemError
  if (!redeem) return 0
  if (await hasReversal(orderId)) return 0
  // REDEEM is stored negative; the reversal is positive.
  const points = -Number(redeem.points)
  if (points <= 0) return 0
  const orderNumber = await fetchOrderNumber(orderId)
  const { error } = await supabase.from('loyalty_transactions').insert({
    id: crypto.randomUUID(),
    restaurant_id: redeem.restaurant_id,
    customer_id: redeem.customer_id,
    order_id: orderId,
    type: 'REVERSAL',
    points,
    reason:
      orderNumber !== null
        ? `Redeemed points returned — order #${orderNumber} cancelled`
        : 'Redeemed points returned — order cancelled',
    created_by: null,
  })
  if (error) {
    if (isUniqueViolationError(error)) return 0
    throw error
  }
  return points
}

/**
 * Reverse earned points when an order is refunded: the money came back,
 * so the points for it must come back too. Returns the points reversed
 * (0 when nothing was earned or the reversal already exists).
 * Idempotent, like reverseLoyaltyRedemption.
 */
export async function reverseLoyaltyEarn(orderId: string): Promise<number> {
  const { data: earn, error: earnError } = await supabase
    .from('loyalty_transactions')
    .select('id, restaurant_id, customer_id, points')
    .eq('order_id', orderId)
    .eq('type', 'EARN')
    .maybeSingle()
  if (earnError) throw earnError
  if (!earn) return 0
  if (await hasReversal(orderId)) return 0
  const points = -Number(earn.points)
  if (points >= 0) return 0
  const orderNumber = await fetchOrderNumber(orderId)
  const { error } = await supabase.from('loyalty_transactions').insert({
    id: crypto.randomUUID(),
    restaurant_id: earn.restaurant_id,
    customer_id: earn.customer_id,
    order_id: orderId,
    type: 'REVERSAL',
    points,
    reason:
      orderNumber !== null
        ? `Earned points reversed — order #${orderNumber} refunded`
        : 'Earned points reversed — order refunded',
    created_by: null,
  })
  if (error) {
    if (isUniqueViolationError(error)) return 0
    throw error
  }
  return points
}

/**
 * Manual points correction (Loyalty tab). A reason is REQUIRED — silent
 * corrections are not allowed. Points must be a non-zero integer
 * (positive = grant, negative = take away). Throws
 * Error('reason_required') / Error('invalid_points') otherwise.
 */
export async function adjustLoyaltyPoints(
  customerId: string,
  points: number,
  reason: string,
  restaurantId: string,
  createdBy?: string | null,
): Promise<LoyaltyTransaction> {
  if (!Number.isInteger(points) || points === 0) {
    throw new Error('invalid_points')
  }
  if (!reason.trim()) throw new Error('reason_required')
  const { data, error } = await supabase
    .from('loyalty_transactions')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      customer_id: customerId,
      order_id: null,
      type: 'ADJUSTMENT',
      points,
      reason: reason.trim(),
      created_by: createdBy ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as LoyaltyTransaction
}
