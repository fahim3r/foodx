// FoodX — coupon data service.
// A coupon's usage count is ALWAYS computed from coupon_redemptions
// joined to their orders (redemptions on cancelled orders do not count)
// — there is no stored used_count on the coupon, so it can never drift.
// Coupons are deactivated (is_active = false), never hard-deleted:
// there is no delete function and no delete RLS policy on coupons.
import { supabase } from '@/lib/supabase'
import { isUniqueViolationError } from '@/lib/errors'
import { roundMoney } from '@/lib/money'
import type { Coupon, CouponType, CouponWithUsage } from '@/types'

/** How many times a coupon has been used (redemptions on cancelled
 * orders do not count). */
export async function fetchCouponUsage(couponId: string): Promise<number> {
  const { data, error } = await supabase
    .from('coupon_redemptions')
    .select('order_id')
    .eq('coupon_id', couponId)
  if (error) throw error
  const orderIds = ((data ?? []) as { order_id: string }[]).map(
    (row) => row.order_id,
  )
  if (orderIds.length === 0) return 0
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, status')
    .in('id', orderIds)
  if (ordersError) throw ordersError
  return ((orders ?? []) as { status: string }[]).filter(
    (order) => order.status !== 'CANCELLED',
  ).length
}

/** All coupons of a restaurant, each with its computed usage count. */
export async function fetchCoupons(
  restaurantId: string,
): Promise<CouponWithUsage[]> {
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('code', { ascending: true })
  if (error) throw error
  const coupons = (data ?? []) as Coupon[]
  if (coupons.length === 0) return []
  const couponIds = coupons.map((coupon) => coupon.id)
  const { data: redemptions, error: redemptionsError } = await supabase
    .from('coupon_redemptions')
    .select('coupon_id, order_id')
    .in('coupon_id', couponIds)
  if (redemptionsError) throw redemptionsError
  const rows = (redemptions ?? []) as {
    coupon_id: string
    order_id: string
  }[]
  const orderIds = [...new Set(rows.map((row) => row.order_id))]
  const cancelledOrderIds = new Set<string>()
  if (orderIds.length > 0) {
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, status')
      .in('id', orderIds)
    if (ordersError) throw ordersError
    for (const order of (orders ?? []) as { id: string; status: string }[]) {
      if (order.status === 'CANCELLED') cancelledOrderIds.add(order.id)
    }
  }
  const uses = new Map<string, number>()
  for (const row of rows) {
    if (cancelledOrderIds.has(row.order_id)) continue
    uses.set(row.coupon_id, (uses.get(row.coupon_id) ?? 0) + 1)
  }
  return coupons.map((coupon) => ({
    ...coupon,
    uses: uses.get(coupon.id) ?? 0,
  }))
}

/** Find a coupon by code (input is uppercased + trimmed), with its
 * usage count attached. Returns null when no such coupon exists. */
export async function fetchCouponByCode(
  restaurantId: string,
  code: string,
): Promise<CouponWithUsage | null> {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return null
  const { data, error } = await supabase
    .from('coupons')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('code', normalized)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const coupon = data as Coupon
  return { ...coupon, uses: await fetchCouponUsage(coupon.id) }
}

export interface CouponValues {
  code: string
  type: CouponType
  value: number
  minOrderAmount?: number
  validFrom?: string | null
  validTo?: string | null
  maxUses?: number | null
}

function validateCouponValues(values: {
  code: string
  type: CouponType
  value: number
  minOrderAmount: number
  validFrom: string | null
  validTo: string | null
  maxUses: number | null
}): void {
  if (!values.code) throw new Error('invalid_coupon_code')
  if (!Number.isFinite(values.value) || values.value <= 0) {
    throw new Error('invalid_coupon_value')
  }
  if (values.type === 'PERCENT' && values.value > 100) {
    throw new Error('invalid_coupon_value')
  }
  if (!Number.isFinite(values.minOrderAmount) || values.minOrderAmount < 0) {
    throw new Error('invalid_coupon_value')
  }
  if (
    values.maxUses !== null &&
    (!Number.isInteger(values.maxUses) || values.maxUses <= 0)
  ) {
    throw new Error('invalid_coupon_value')
  }
  if (
    values.validFrom &&
    values.validTo &&
    values.validTo < values.validFrom
  ) {
    throw new Error('invalid_coupon_dates')
  }
}

export async function createCoupon(
  restaurantId: string,
  values: CouponValues,
): Promise<Coupon> {
  const normalized: Parameters<typeof validateCouponValues>[0] = {
    code: values.code.trim().toUpperCase(),
    type: values.type,
    value: roundMoney(values.value),
    minOrderAmount: roundMoney(values.minOrderAmount ?? 0),
    validFrom: values.validFrom ?? null,
    validTo: values.validTo ?? null,
    maxUses: values.maxUses ?? null,
  }
  validateCouponValues(normalized)
  const { data, error } = await supabase
    .from('coupons')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      code: normalized.code,
      type: normalized.type,
      value: normalized.value,
      min_order_amount: normalized.minOrderAmount,
      valid_from: normalized.validFrom,
      valid_to: normalized.validTo,
      max_uses: normalized.maxUses,
    })
    .select()
    .single()
  if (error) throw error
  return data as Coupon
}

export async function updateCoupon(
  couponId: string,
  patch: Partial<
    Pick<
      Coupon,
      | 'code'
      | 'type'
      | 'value'
      | 'min_order_amount'
      | 'valid_from'
      | 'valid_to'
      | 'max_uses'
      | 'is_active'
    >
  >,
): Promise<Coupon> {
  // Validate the merged values (a type change alone could make an
  // existing value invalid, e.g. FIXED 500 → PERCENT 500).
  const { data: existing, error: existingError } = await supabase
    .from('coupons')
    .select('*')
    .eq('id', couponId)
    .single()
  if (existingError) throw existingError
  const current = existing as Coupon
  const merged = {
    code: patch.code !== undefined ? patch.code.trim().toUpperCase() : current.code,
    type: patch.type ?? current.type,
    value:
      patch.value !== undefined ? roundMoney(patch.value) : Number(current.value),
    minOrderAmount:
      patch.min_order_amount !== undefined
        ? roundMoney(patch.min_order_amount)
        : Number(current.min_order_amount),
    validFrom: patch.valid_from !== undefined ? patch.valid_from : current.valid_from,
    validTo: patch.valid_to !== undefined ? patch.valid_to : current.valid_to,
    maxUses: patch.max_uses !== undefined ? patch.max_uses : current.max_uses,
  }
  validateCouponValues(merged)
  const { data, error } = await supabase
    .from('coupons')
    .update({
      ...(patch.code !== undefined ? { code: merged.code } : {}),
      ...(patch.type !== undefined ? { type: merged.type } : {}),
      ...(patch.value !== undefined ? { value: merged.value } : {}),
      ...(patch.min_order_amount !== undefined
        ? { min_order_amount: merged.minOrderAmount }
        : {}),
      ...(patch.valid_from !== undefined
        ? { valid_from: merged.validFrom }
        : {}),
      ...(patch.valid_to !== undefined ? { valid_to: merged.validTo } : {}),
      ...(patch.max_uses !== undefined ? { max_uses: merged.maxUses } : {}),
      ...(patch.is_active !== undefined
        ? { is_active: patch.is_active }
        : {}),
    })
    .eq('id', couponId)
    .select()
    .single()
  if (error) throw error
  return data as Coupon
}

/**
 * Check a coupon against an order subtotal (before any discount).
 * Returns an i18n key for the first failing check, or null when the
 * coupon may be used. `now` is injected so the date window is testable.
 */
export function validateCouponForOrder(
  coupon: CouponWithUsage,
  orderSubtotal: number,
  now: Date,
): string | null {
  if (!coupon.is_active) return 'customers.couponInactive'
  const today = now.toISOString().slice(0, 10)
  if (coupon.valid_from && today < coupon.valid_from) {
    return 'customers.couponNotYetValid'
  }
  if (coupon.valid_to && today > coupon.valid_to) {
    return 'customers.couponExpired'
  }
  if (coupon.max_uses !== null && coupon.uses >= coupon.max_uses) {
    return 'customers.couponMaxUsesReached'
  }
  if (orderSubtotal < Number(coupon.min_order_amount)) {
    return 'customers.couponMinOrderNotMet'
  }
  return null
}

/** The money a coupon takes off a subtotal (before other discounts). */
export function computeCouponDiscount(
  coupon: Pick<Coupon, 'type' | 'value'>,
  subtotal: number,
): number {
  const base = Math.max(0, subtotal)
  if (coupon.type === 'PERCENT') {
    return roundMoney((base * Number(coupon.value)) / 100)
  }
  return roundMoney(Math.min(Number(coupon.value), base))
}

/**
 * Record that an order used a coupon (called best-effort from
 * createOrder). Idempotent via the UNIQUE order_id: a retried placement
 * that already has this redemption is ignored, not an error.
 */
export async function recordCouponRedemption(
  orderId: string,
  couponId: string,
  discountAmount: number,
): Promise<void> {
  const { error } = await supabase.from('coupon_redemptions').insert({
    id: crypto.randomUUID(),
    coupon_id: couponId,
    order_id: orderId,
    discount_amount: roundMoney(discountAmount),
  })
  if (error) {
    if (isUniqueViolationError(error)) return
    throw error
  }
}
