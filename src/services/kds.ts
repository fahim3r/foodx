// FoodX — kitchen display (KDS) data service. The KDS shows live orders
// in SENT_TO_KITCHEN / PREPARING / READY, grouped by kitchen station
// (each order appears under every station its items belong to).
// Live updates come from Supabase Realtime on orders + order_items; the
// page also polls every 30s and offers a manual refresh, so the display
// keeps working even if Realtime is unavailable.
import { supabase } from '@/lib/supabase'
import { fetchStations } from '@/services/menu'
import { advanceOrderStatus } from '@/services/orders'
import type {
  KitchenOrder,
  KitchenStationGroup,
  Order,
  OrderItem,
  OrderItemModifier,
  OrderItemWithModifiers,
  OrderStatus,
} from '@/types'

const KDS_STATUSES: OrderStatus[] = ['SENT_TO_KITCHEN', 'PREPARING', 'READY']

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
    Order & {
      order_items: Array<
        OrderItem & {
          order_item_modifiers: OrderItemModifier[]
          products: { kitchen_station_id: string | null } | null
        }
      >
    }
  >) {
    const byStation = new Map<string | null, OrderItemWithModifiers[]>()
    for (const item of row.order_items ?? []) {
      const stationId = item.products?.kitchen_station_id ?? null
      const list = byStation.get(stationId) ?? []
      list.push({
        id: item.id,
        order_id: item.order_id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_name: item.product_name,
        variant_name: item.variant_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        created_at: item.created_at,
        updated_at: item.updated_at,
        modifiers: [...(item.order_item_modifiers ?? [])],
      })
      byStation.set(stationId, list)
    }
    const { order_items: _items, ...order } = row
    void _items
    for (const [stationId, items] of byStation) {
      const list = groups.get(stationId) ?? []
      list.push({ order: order as Order, items })
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
 * Subscribe to live order changes for the KDS. Returns an unsubscribe
 * function. The channel listens to orders and order_items; the caller
 * re-fetches on every event (and also polls, so a missed event is not
 * fatal).
 */
export function subscribeKitchenOrders(onChange: () => void): () => void {
  const channel = supabase
    .channel('kds-orders')
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
