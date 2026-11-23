// FoodX — kitchen display (KDS) data service. The KDS shows live orders
// in SENT_TO_KITCHEN / PREPARING / READY, grouped by kitchen station
// (each order appears under every station its items belong to).
// Since migration 0036 each station bucket carries its OWN progress:
// items store a per-item kitchen_status, a bucket's state is the
// aggregate of its items, and the order-level status is derived from
// the buckets (Ready only when every station is Ready) and written
// through advanceOrderStatus, so every other surface keeps reading
// orders.status exactly as before.
// Live updates come from Supabase Realtime on orders + order_items; the
// page also polls every 30s and offers a manual refresh, so the display
// keeps working even if Realtime is unavailable.
import { supabase } from '@/lib/supabase'
import { fetchStations } from '@/services/menu'
import { advanceOrderStatus } from '@/services/orders'
import type {
  KitchenItemStatus,
  KitchenOrder,
  KitchenStationGroup,
  Order,
  OrderItem,
  OrderItemModifier,
  OrderItemWithModifiers,
  OrderStatus,
} from '@/types'

const KDS_STATUSES: OrderStatus[] = ['SENT_TO_KITCHEN', 'PREPARING', 'READY']

const ITEM_STATUS_RANK: Record<KitchenItemStatus, number> = {
  PENDING: 0,
  PREPARING: 1,
  READY: 2,
}

/** An item's effective state is never behind its order's status: an
 * order pushed to PREPARING by an order-level surface (the POS
 * carousel) shows every bucket as Preparing even though no item row
 * was ever written. The floor only raises; a stored state is never
 * lowered by it. */
const ORDER_STATUS_FLOOR: Partial<Record<OrderStatus, KitchenItemStatus>> = {
  SENT_TO_KITCHEN: 'PENDING',
  PREPARING: 'PREPARING',
  READY: 'READY',
}

function effectiveItemStatus(
  item: OrderItem,
  orderStatus: OrderStatus,
): KitchenItemStatus {
  const stored = item.kitchen_status ?? 'PENDING'
  const floor = ORDER_STATUS_FLOOR[orderStatus] ?? 'PENDING'
  return ITEM_STATUS_RANK[stored] >= ITEM_STATUS_RANK[floor] ? stored : floor
}

/** A bucket's state: all items READY → READY; any item started but not
 * all READY → PREPARING; all PENDING → PENDING. */
function bucketStatus(
  items: OrderItem[],
  orderStatus: OrderStatus,
): KitchenItemStatus {
  if (items.length === 0) return 'PENDING'
  const states = items.map((item) => effectiveItemStatus(item, orderStatus))
  if (states.every((s) => s === 'READY')) return 'READY'
  if (states.some((s) => s !== 'PENDING')) return 'PREPARING'
  return 'PENDING'
}

/** The order status the buckets imply: all READY → READY; any bucket
 * started → PREPARING; all PENDING → SENT_TO_KITCHEN. */
function deriveOrderStatus(bucketStates: KitchenItemStatus[]): OrderStatus {
  if (bucketStates.length > 0 && bucketStates.every((s) => s === 'READY')) {
    return 'READY'
  }
  if (bucketStates.some((s) => s !== 'PENDING')) return 'PREPARING'
  return 'SENT_TO_KITCHEN'
}

type OrderItemWithStation = OrderItem & {
  order_item_modifiers?: OrderItemModifier[]
  products: { kitchen_station_id: string | null } | null
}

/** Group one order's items into station buckets by each product's
 * CURRENT kitchen_station_id (null product / no station → the
 * Unassigned bucket, which counts as a full station). */
function bucketItems(
  items: OrderItemWithStation[],
): Map<string | null, OrderItemWithStation[]> {
  const byStation = new Map<string | null, OrderItemWithStation[]>()
  for (const item of items) {
    const stationId = item.products?.kitchen_station_id ?? null
    const list = byStation.get(stationId) ?? []
    list.push(item)
    byStation.set(stationId, list)
  }
  return byStation
}

/** Fresh read of one order + all its items (with station joins). */
async function fetchOrderWithItems(orderId: string): Promise<{
  order: Order
  items: OrderItemWithStation[]
}> {
  const { data, error } = await supabase
    .from('orders')
    .select('*, order_items(*, products(kitchen_station_id))')
    .eq('id', orderId)
    .single()
  if (error) throw error
  const row = data as Order & { order_items: OrderItemWithStation[] }
  const { order_items: items, ...order } = row
  return { order: order as Order, items: items ?? [] }
}

export async function fetchKitchenOrders(
  restaurantId: string,
): Promise<KitchenStationGroup[]> {
  const [stations, { data, error }] = await Promise.all([
    fetchStations(restaurantId),
    supabase
      .from('orders')
      .select('*, order_items(*, products(kitchen_station_id), order_item_modifiers(*))')
      .eq('restaurant_id', restaurantId)
      .in('status', KDS_STATUSES)
      .order('created_at', { ascending: true }),
  ])
  if (error) throw error

  const groups = new Map<string | null, KitchenOrder[]>()

  for (const row of (data ?? []) as Array<
    Order & { order_items: OrderItemWithStation[] }
  >) {
    const byStation = bucketItems(row.order_items ?? [])
    const { order_items: _items, ...order } = row
    void _items
    for (const [stationId, stationItems] of byStation) {
      const items: OrderItemWithModifiers[] = stationItems.map((item) => ({
        id: item.id,
        order_id: item.order_id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_name: item.product_name,
        variant_name: item.variant_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        note: item.note,
        kitchen_status: item.kitchen_status ?? 'PENDING',
        created_at: item.created_at,
        updated_at: item.updated_at,
        modifiers: [...(item.order_item_modifiers ?? [])],
      }))
      const list = groups.get(stationId) ?? []
      list.push({
        order: order as Order,
        items,
        stationStatus: bucketStatus(stationItems, row.status),
      })
      groups.set(stationId, list)
    }
  }

  // Stations in their configured order first, unassigned items last.
  const ordered: KitchenStationGroup[] = stations
    .filter((s) => groups.has(s.id))
    .map((s) => ({
      stationId: s.id,
      stationName: s.name,
      orders: groups.get(s.id) ?? [],
    }))
  if (groups.has(null)) {
    ordered.push({
      stationId: null,
      stationName: null,
      orders: groups.get(null) ?? [],
    })
  }
  return ordered
}

/** KDS moves: SENT_TO_KITCHEN → PREPARING → READY. Anything else throws
 * Error('invalid_status_transition') via advanceOrderStatus. */
export async function advanceKitchenStatus(
  order: Order,
  toStatus: 'PREPARING' | 'READY',
  userId: string,
): Promise<Order> {
  return advanceOrderStatus(order, toStatus, userId)
}

/**
 * Advance ONE station bucket of an order (migration 0036): the
 * bucket's items move to their next state (PENDING → PREPARING →
 * READY), then the order and all its items are re-read fresh and the
 * order status is derived from the full bucket set — advanceOrderStatus
 * is called only when the derived status actually moves the order, so
 * a station move that doesn't move the order writes no order history.
 * Returns the fresh order.
 */
export async function advanceKitchenStation(
  order: Order,
  stationId: string | null,
  userId: string,
): Promise<Order> {
  const first = await fetchOrderWithItems(order.id)
  const bucket = bucketItems(first.items).get(stationId) ?? []
  if (bucket.length === 0) return first.order
  const current = bucketStatus(bucket, first.order.status)
  if (current === 'READY') return first.order
  const next: KitchenItemStatus = current === 'PENDING' ? 'PREPARING' : 'READY'
  const { error: updateError } = await supabase
    .from('order_items')
    .update({ kitchen_status: next })
    .in(
      'id',
      bucket.map((item) => item.id),
    )
  if (updateError) throw updateError

  const fresh = await fetchOrderWithItems(order.id)
  const buckets = bucketItems(fresh.items)
  const derived = deriveOrderStatus(
    [...buckets.values()].map((items) =>
      bucketStatus(items, fresh.order.status),
    ),
  )
  if (
    derived !== fresh.order.status &&
    (derived === 'PREPARING' || derived === 'READY')
  ) {
    return advanceOrderStatus(fresh.order, derived, userId)
  }
  return fresh.order
}

/**
 * Subscribe to live order changes for the KDS. Returns an unsubscribe
 * function. The channel listens to orders and order_items; the caller
 * re-fetches on every event (and also polls, so a missed event is not
 * fatal). `channelName` exists for the sound-effects watcher: a
 * second subscriber on an already-subscribed channel throws, so it
 * listens on its own channel ('sound-order-watcher') instead of
 * colliding with the KDS page's fixed 'kds-orders'.
 */
export function subscribeKitchenOrders(
  onChange: () => void,
  channelName = 'kds-orders',
): () => void {
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'orders' },
      () => onChange(),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'order_items' },
      () => onChange(),
    )
    .subscribe()
  return () => {
    void supabase.removeChannel(channel)
  }
}
