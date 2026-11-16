// FoodX — Phase 1 domain types (mirror supabase/migrations/0001_foundation.sql)
// Phase 2 types below mirror supabase/migrations/0002_core.sql.

export interface Profile {
  id: string
  restaurant_id: string | null
  branch_id: string | null
  full_name: string | null
  phone: string | null
  avatar_url: string | null
  is_active: boolean
}

export interface Restaurant {
  id: string
  name: string
  slug: string
  default_currency: string
  timezone: string
  status: string
  license_id: string | null
}

export interface RestaurantSettings {
  id: string
  restaurant_id: string
  branding_name: string | null
  logo_url: string | null
  favicon_url: string | null
  primary_color: string
  secondary_color: string
  currency: string
  tax_rate: number
  service_charge_rate: number
  receipt_footer: string | null
}

export interface Role {
  id: string
  restaurant_id: string | null
  name: string
  display_name: string | null
  description: string | null
  is_system: boolean
}

export interface Permission {
  id: string
  key: string
  module: string
  description: string | null
}

export interface RolePermission {
  role_id: string
  permission_id: string
}

/** Combined restaurant + settings form values used by the Settings page. */
export interface RestaurantFormValues {
  name: string
  slug: string
  currency: string
  timezone: string
  branding_name: string
  logo_url: string
  primary_color: string
  secondary_color: string
  tax_rate: number
  service_charge_rate: number
  receipt_footer: string
}

// ---------------------------------------------------------------------------
// Phase 2 — Core Restaurant (mirror supabase/migrations/0002_core.sql)
// ---------------------------------------------------------------------------

export type OrderStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'SENT_TO_KITCHEN'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED'

export type OrderType = 'dine_in' | 'takeaway' | 'delivery'

export type PaymentMethod = 'cash' | 'card' | 'bkash' | 'nagad' | 'bank' | 'due'

export type TableStatus = 'available' | 'occupied' | 'reserved' | 'cleaning'

/** The order state machine. CANCELLED / REFUNDED are terminal. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SENT_TO_KITCHEN', 'CANCELLED'],
  SENT_TO_KITCHEN: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['SERVED', 'CANCELLED'],
  SERVED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
}

export function canTransitionOrderStatus(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to)
}

/** Statuses after which an order no longer occupies a table. */
export const TERMINAL_ORDER_STATUSES: OrderStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
]

export interface KitchenStation {
  id: string
  restaurant_id: string
  name: string
  sort_order: number
  is_active: boolean
}

export interface Category {
  id: string
  restaurant_id: string
  name: string
  name_bn: string | null
  sort_order: number
  is_active: boolean
}

export interface Modifier {
  id: string
  restaurant_id: string
  name: string
  name_bn: string | null
  price: number
  is_active: boolean
}

export interface ProductVariant {
  id: string
  product_id: string
  name: string
  price_adjustment: number
  sort_order: number
  is_active: boolean
}

export interface ProductModifierLink {
  product_id: string
  modifier_id: string
}

export interface Product {
  id: string
  restaurant_id: string
  category_id: string | null
  kitchen_station_id: string | null
  name: string
  name_bn: string | null
  description: string | null
  price: number
  image_url: string | null
  is_available: boolean
  sort_order: number
}

/** A product with its variants and its offered modifiers attached. */
export interface ProductWithDetails extends Product {
  variants: ProductVariant[]
  modifiers: Modifier[]
}

export interface DiningTable {
  id: string
  restaurant_id: string
  branch_id: string | null
  name: string
  seats: number
  status: TableStatus
  qr_code: string | null
}

export interface Order {
  id: string
  restaurant_id: string
  branch_id: string | null
  table_id: string | null
  order_number: number
  type: OrderType
  status: OrderStatus
  subtotal: number
  discount_amount: number
  tax_amount: number
  service_charge_amount: number
  total_amount: number
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string | null
  variant_id: string | null
  product_name: string
  variant_name: string | null
  quantity: number
  unit_price: number
  total_price: number
  created_at: string
  updated_at: string
}

export interface OrderItemModifier {
  id: string
  order_item_id: string
  modifier_id: string | null
  modifier_name: string
  price: number
  created_at: string
}

/** An order item with its modifiers attached. */
export interface OrderItemWithModifiers extends OrderItem {
  modifiers: OrderItemModifier[]
}

export interface OrderPayment {
  id: string
  order_id: string
  method: PaymentMethod
  amount: number
  reference: string | null
  received_by: string | null
  created_at: string
}

export interface OrderStatusHistory {
  id: string
  order_id: string
  from_status: OrderStatus | null
  to_status: OrderStatus
  changed_by: string | null
  note: string | null
  created_at: string
}

/** Full order detail: order + items (+ modifiers) + payments + history. */
export interface OrderDetail extends Order {
  items: OrderItemWithModifiers[]
  payments: OrderPayment[]
  history: OrderStatusHistory[]
}

/** One cart line as the POS builds it (prices are NOT sent — the service
 * re-reads them from the database at order time). */
export interface PosOrderLineInput {
  productId: string
  variantId?: string | null
  modifierIds: string[]
  quantity: number
}

export interface CreateOrderInput {
  restaurantId: string
  branchId?: string | null
  tableId?: string | null
  type: OrderType
  notes?: string
  discountAmount: number
  lines: PosOrderLineInput[]
}

/** Money totals for an order, computed from DB prices. */
export interface OrderTotals {
  subtotal: number
  discountAmount: number
  taxAmount: number
  serviceChargeAmount: number
  totalAmount: number
}

/** A kitchen-station group on the KDS: one station's items per order. */
export interface KitchenStationGroup {
  stationId: string | null
  stationName: string | null
  orders: KitchenOrder[]
}

/** An order as the KDS sees it: only its items for one station. */
export interface KitchenOrder {
  order: Order
  items: OrderItemWithModifiers[]
}
