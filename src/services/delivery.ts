// FoodX — delivery data service (Phase 6): drivers, zones, the delivery
// board, driver assignment and the delivery status machine. Every status
// change is validated against DELIVERY_TRANSITIONS (see src/types) and
// writes a delivery_status_history row. The linked order keeps its own
// state machine — this service only completes it, through the orders
// service, when a delivery is DELIVERED.
import { supabase } from '@/lib/supabase'
import { completeOrder, markOrderServed } from '@/services/orders'
import {
  canTransitionDeliveryStatus,
  TERMINAL_ORDER_STATUSES,
  type DeliveryBoardEntry,
  type DeliveryDriver,
  type DeliveryOrder,
  type DeliveryStatus,
  type DeliveryZone,
  type Order,
} from '@/types'

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

export async function fetchDeliveryDrivers(
  restaurantId: string,
): Promise<DeliveryDriver[]> {
  const { data, error } = await supabase
    .from('delivery_drivers')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as DeliveryDriver[]
}

export async function createDeliveryDriver(
  restaurantId: string,
  values: {
    name: string
    phone: string
    email?: string
    vehicle_type?: string
    vehicle_number?: string
    branch_id?: string
    notes?: string
  },
): Promise<DeliveryDriver> {
  const { data, error } = await supabase
    .from('delivery_drivers')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      branch_id: values.branch_id || null,
      name: values.name.trim(),
      phone: values.phone.trim(),
      email: values.email?.trim() || null,
      vehicle_type: values.vehicle_type?.trim() || null,
      vehicle_number: values.vehicle_number?.trim() || null,
      notes: values.notes?.trim() || null,
    })
    .select()
    .single()
  if (error) throw error
  return data as DeliveryDriver
}

export async function updateDeliveryDriver(
  driverId: string,
  patch: Partial<
    Pick<
      DeliveryDriver,
      | 'name'
      | 'phone'
      | 'email'
      | 'vehicle_type'
      | 'vehicle_number'
      | 'status'
      | 'is_active'
      | 'notes'
    >
  >,
): Promise<DeliveryDriver> {
  const { data, error } = await supabase
    .from('delivery_drivers')
    .update(patch)
    .eq('id', driverId)
    .select()
    .single()
  if (error) throw error
  return data as DeliveryDriver
}

export async function deleteDeliveryDriver(driverId: string): Promise<void> {
  // delivery_orders.driver_id is ON DELETE SET NULL, so past deliveries
  // keep their record and simply lose the driver reference.
  const { error } = await supabase
    .from('delivery_drivers')
    .delete()
    .eq('id', driverId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export async function fetchDeliveryZones(
  restaurantId: string,
): Promise<DeliveryZone[]> {
  const { data, error } = await supabase
    .from('delivery_zones')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as DeliveryZone[]
}

export async function createDeliveryZone(
  restaurantId: string,
  values: {
    name: string
    fee: number
    min_order_amount?: number
    estimated_minutes?: number
    branch_id?: string
  },
): Promise<DeliveryZone> {
  const { data, error } = await supabase
    .from('delivery_zones')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      branch_id: values.branch_id || null,
      name: values.name.trim(),
      fee: values.fee,
      min_order_amount: values.min_order_amount ?? 0,
      estimated_minutes: values.estimated_minutes ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data as DeliveryZone
}

export async function updateDeliveryZone(
  zoneId: string,
  patch: Partial<
    Pick<
      DeliveryZone,
      'name' | 'fee' | 'min_order_amount' | 'estimated_minutes' | 'is_active'
    >
  >,
): Promise<DeliveryZone> {
  const { data, error } = await supabase
    .from('delivery_zones')
    .update(patch)
    .eq('id', zoneId)
    .select()
    .single()
  if (error) throw error
  return data as DeliveryZone
}

export async function deleteDeliveryZone(zoneId: string): Promise<void> {
  // delivery_orders.zone_id is ON DELETE SET NULL (same pattern as
  // drivers above).
  const { error } = await supabase
    .from('delivery_zones')
    .delete()
    .eq('id', zoneId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Delivery orders (dispatch records)
// ---------------------------------------------------------------------------

/** Create the PENDING dispatch row for a delivery order if it has none.
 * cod_amount snapshots the order total re-read from the DB — a
 * client-passed amount is never trusted. */
export async function ensureDeliveryOrder(
  order: Order,
): Promise<DeliveryOrder> {
  const { data: existing, error: fetchError } = await supabase
    .from('delivery_orders')
    .select('*')
    .eq('order_id', order.id)
    .maybeSingle()
  if (fetchError) throw fetchError
  if (existing) return existing as DeliveryOrder
  const { data, error } = await supabase
    .from('delivery_orders')
    .insert({
        order_id: order.id,
        cod_amount: order.total_amount,
        zone_id: order.delivery_zone_id ?? null,
      })
    .select()
    .single()
  if (error) throw error
  const created = data as DeliveryOrder
  const { error: historyError } = await supabase
    .from('delivery_status_history')
    .insert({
      id: crypto.randomUUID(),
      delivery_order_id: order.id,
      from_status: null,
      to_status: 'PENDING',
      changed_by: null,
    })
  if (historyError) throw historyError
  return created
}

/** The delivery board: this restaurant's delivery orders, newest first,
 * each with its dispatch record and driver/zone names resolved. Orders
 * placed before Phase 6 (or at the POS) may have no dispatch row yet —
 * the board creates it on first sight so nothing is invisible, unless
 * the order itself is already in a terminal status. */
export async function fetchDeliveryBoard(
  restaurantId: string,
): Promise<DeliveryBoardEntry[]> {
  const { data: orderRows, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('type', 'delivery')
    .order('created_at', { ascending: false })
    .limit(100)
  if (orderError) throw orderError
  const orders = (orderRows ?? []) as Order[]
  if (orders.length === 0) return []

  const { data: deliveryRows, error: deliveryError } = await supabase
    .from('delivery_orders')
    .select('*')
    .in(
      'order_id',
      orders.map((o) => o.id),
    )
  if (deliveryError) throw deliveryError
  const byOrderId = new Map<string, DeliveryOrder>(
    ((deliveryRows ?? []) as DeliveryOrder[]).map((d) => [d.order_id, d]),
  )

  for (const order of orders) {
    if (byOrderId.has(order.id)) continue
    // Never create a dispatch row for an order that is already
    // finished — a completed/cancelled/refunded order must not
    // (re)appear on the board with a fresh PENDING row.
    if (TERMINAL_ORDER_STATUSES.includes(order.status)) continue
    byOrderId.set(order.id, await ensureDeliveryOrder(order))
  }

  const [drivers, zones] = await Promise.all([
    fetchDeliveryDrivers(restaurantId),
    fetchDeliveryZones(restaurantId),
  ])
  const driverName = new Map(drivers.map((d) => [d.id, d.name]))
  const zoneName = new Map(zones.map((z) => [z.id, z.name]))

  return orders.map((order) => {
    const delivery = byOrderId.get(order.id) ?? null
    return {
      order,
      delivery,
      driver_name: delivery?.driver_id
        ? (driverName.get(delivery.driver_id) ?? null)
        : null,
      zone_name: delivery?.zone_id
        ? (zoneName.get(delivery.zone_id) ?? null)
        : null,
    }
  })
}

async function writeDeliveryHistory(
  delivery: DeliveryOrder,
  toStatus: DeliveryStatus,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from('delivery_status_history').insert({
    id: crypto.randomUUID(),
    delivery_order_id: delivery.order_id,
    from_status: delivery.status,
    to_status: toStatus,
    changed_by: userId,
  })
  if (error) throw error
}

async function setDriverStatus(
  driverId: string | null,
  status: DeliveryDriver['status'],
): Promise<void> {
  if (!driverId) return
  const { error } = await supabase
    .from('delivery_drivers')
    .update({ status })
    .eq('id', driverId)
  if (error) throw error
}

/** PENDING → ASSIGNED (or re-assign while ASSIGNED): attach a driver —
 * and optionally a zone — and mark the driver ON_DELIVERY. */
export async function assignDriver(
  order: Order,
  driverId: string,
  userId: string,
  zoneId?: string,
): Promise<DeliveryOrder> {
  const delivery = await ensureDeliveryOrder(order)
  const reassign = delivery.status === 'ASSIGNED'
  if (delivery.status !== 'PENDING' && !reassign) {
    throw new Error('invalid_status_transition')
  }
  const previousDriverId = delivery.driver_id
  const { data, error } = await supabase
    .from('delivery_orders')
    .update({
      driver_id: driverId,
      zone_id: zoneId ?? delivery.zone_id,
      status: 'ASSIGNED',
      assigned_at: new Date().toISOString(),
    })
    .eq('order_id', order.id)
    .select()
    .single()
  if (error) throw error
  const updated = data as DeliveryOrder
  if (!reassign) {
    await writeDeliveryHistory(delivery, 'ASSIGNED', userId)
  }
  if (previousDriverId && previousDriverId !== driverId) {
    await setDriverStatus(previousDriverId, 'AVAILABLE')
  }
  await setDriverStatus(driverId, 'ON_DELIVERY')
  return updated
}

const TIMESTAMP_FOR_STATUS: Partial<Record<DeliveryStatus, string>> = {
  ASSIGNED: 'assigned_at',
  PICKED_UP: 'picked_up_at',
  OUT_FOR_DELIVERY: 'out_for_delivery_at',
  DELIVERED: 'delivered_at',
  FAILED: 'failed_at',
}

/** Advance the delivery machine. DELIVERED frees the driver and completes
 * the linked order through the orders service (READY → SERVED →
 * COMPLETED as needed); FAILED / CANCELLED free the driver but never
 * auto-cancel the order — a manager decides that in Orders. */
export async function advanceDeliveryStatus(
  order: Order,
  delivery: DeliveryOrder,
  toStatus: DeliveryStatus,
  userId: string,
): Promise<DeliveryOrder> {
  if (!canTransitionDeliveryStatus(delivery.status, toStatus)) {
    throw new Error('invalid_status_transition')
  }
  const patch: Record<string, unknown> = { status: toStatus }
  const timestampColumn = TIMESTAMP_FOR_STATUS[toStatus]
  if (timestampColumn) patch[timestampColumn] = new Date().toISOString()
  const { data, error } = await supabase
    .from('delivery_orders')
    .update(patch)
    .eq('order_id', delivery.order_id)
    .select()
    .single()
  if (error) throw error
  const updated = data as DeliveryOrder
  await writeDeliveryHistory(delivery, toStatus, userId)

  if (toStatus === 'DELIVERED') {
    await setDriverStatus(delivery.driver_id, 'AVAILABLE')
    if (order.status === 'READY') {
      const served = await markOrderServed(order, userId)
      await completeOrder(served, userId)
    } else if (order.status === 'SERVED') {
      await completeOrder(order, userId)
    }
  } else if (toStatus === 'FAILED' || toStatus === 'CANCELLED') {
    await setDriverStatus(delivery.driver_id, 'AVAILABLE')
  }
  return updated
}

/** A driver's own list: their deliveries that are not finished yet.
 * Backs the simple driver view in the panel. */
export async function fetchDriverDeliveries(
  driverId: string,
): Promise<DeliveryOrder[]> {
  const { data, error } = await supabase
    .from('delivery_orders')
    .select('*')
    .eq('driver_id', driverId)
    .not('status', 'in', '("DELIVERED","FAILED","CANCELLED")')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as DeliveryOrder[]
}
