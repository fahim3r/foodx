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
  loyalty_earn_per_100: number
  loyalty_point_value: number
  delivery_enabled: boolean
  delivery_fee: number
  min_order_amount: number
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
  loyalty_earn_per_100: number
  loyalty_point_value: number
  delivery_enabled: boolean
  delivery_fee: number
  min_order_amount: number
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

export type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'pickup'

/** Where an order came from: the counter POS, a table QR scan, or the
 * public online storefront. */
export type OrderSource = 'POS' | 'QR' | 'ONLINE'

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
  /** The URL written to the table's NFC tag (same URL as the QR code). */
  nfc_value: string | null
}

export interface Order {
  id: string
  restaurant_id: string
  branch_id: string | null
  table_id: string | null
  order_number: number
  type: OrderType
  source: OrderSource
  status: OrderStatus
  subtotal: number
  discount_amount: number
  tax_amount: number
  service_charge_amount: number
  total_amount: number
  /** Delivery fee charged on this order (0 unless type is 'delivery'). */
  delivery_fee: number
  customer_id: string | null
  /** Guest contact for QR / online orders (the POS leaves these null —
   * its customers live on the customer record instead). */
  customer_name: string | null
  customer_phone: string | null
  delivery_address: string | null
  coupon_id: string | null
  coupon_discount: number
  loyalty_points_redeemed: number
  loyalty_discount: number
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
  customerId?: string | null
  couponId?: string | null
  couponDiscount?: number
  loyaltyPointsRedeemed?: number
  loyaltyDiscount?: number
  lines: PosOrderLineInput[]
}

/** Money totals for an order, computed from DB prices. Discounts apply
 * in this order: manual, then coupon, then loyalty — each clamped to
 * what is left, so the total never goes below 0. */
export interface OrderTotals {
  subtotal: number
  discountAmount: number
  couponDiscount: number
  loyaltyDiscount: number
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

// ---------------------------------------------------------------------------
// Phase 3 — Inventory (mirror supabase/migrations/0003_inventory.sql)
// ---------------------------------------------------------------------------

export type StockMovementType =
  | 'PURCHASE'
  | 'SALE'
  | 'ADJUSTMENT'
  | 'WASTE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'RESTOCK'

/** One stock item (ingredient / raw material). current_quantity changes
 * ONLY through stock_movements via apply_stock_movement() — the item
 * edit form has no quantity field and updateInventoryItem's patch type
 * excludes it on purpose. */
export interface InventoryItem {
  id: string
  restaurant_id: string
  name: string
  unit: string
  current_quantity: number
  low_stock_threshold: number
  cost_price: number
  is_active: boolean
  created_at: string
  updated_at: string
}

/** One recipe line: how much of an ingredient one serving uses. */
export interface ProductRecipe {
  id: string
  restaurant_id: string
  product_id: string
  inventory_item_id: string
  quantity_per_unit: number
  created_at: string
}

/** A recipe line with its ingredient attached. */
export interface ProductRecipeWithItem extends ProductRecipe {
  item: InventoryItem
}

/** One audited stock change. Append-only: created only by
 * apply_stock_movement() / deduct_stock_for_order(). */
export interface StockMovement {
  id: string
  restaurant_id: string
  inventory_item_id: string
  movement_type: StockMovementType
  quantity_change: number
  reference_type: string | null
  reference_id: string | null
  reason: string | null
  created_by: string | null
  created_at: string
}

/** A stock movement with its item's name + unit attached. */
export interface StockMovementWithItem extends StockMovement {
  item_name: string
  item_unit: string
}

export interface Supplier {
  id: string
  restaurant_id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type PurchaseOrderStatus = 'DRAFT' | 'ORDERED' | 'RECEIVED' | 'CANCELLED'

export interface PurchaseOrder {
  id: string
  restaurant_id: string
  supplier_id: string
  status: PurchaseOrderStatus
  order_date: string
  total_amount: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PurchaseOrderItem {
  id: string
  purchase_order_id: string
  inventory_item_id: string
  quantity: number
  unit_cost: number
  received_quantity: number
}

/** A purchase-order line with its item's name + unit attached. */
export interface PurchaseOrderItemWithItem extends PurchaseOrderItem {
  item_name: string
  item_unit: string
}

/** A purchase order with its supplier name and lines attached. */
export interface PurchaseOrderWithDetails extends PurchaseOrder {
  supplier_name: string
  items: PurchaseOrderItemWithItem[]
}

/** Purchase-order state machine. RECEIVED is final; CANCELLED only from
 * DRAFT or ORDERED. Enforced by the purchases service. */
export const PURCHASE_ORDER_TRANSITIONS: Record<
  PurchaseOrderStatus,
  PurchaseOrderStatus[]
> = {
  DRAFT: ['ORDERED', 'CANCELLED'],
  ORDERED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
}

/** An order as the KDS sees it: only its items for one station. */
export interface KitchenOrder {
  order: Order
  items: OrderItemWithModifiers[]
}

// ---------------------------------------------------------------------------
// Phase 4 — Customers (mirror supabase/migrations/0005_customers.sql)
// ---------------------------------------------------------------------------

export interface Customer {
  id: string
  restaurant_id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Per-customer lifetime numbers, computed from orders (never stored). */
export interface CustomerStats {
  orderCount: number
  totalSpent: number
  lastOrderAt: string | null
}

/** One loyalty transaction. Append-only: balances are always
 * SUM(points) over these rows — there is no balance column anywhere. */
export type LoyaltyTransactionType = 'EARN' | 'REDEEM' | 'ADJUSTMENT' | 'REVERSAL'

export interface LoyaltyTransaction {
  id: string
  restaurant_id: string
  customer_id: string
  order_id: string | null
  type: LoyaltyTransactionType
  points: number
  reason: string | null
  created_by: string | null
  created_at: string
}

/** A loyalty transaction with its order number / customer name attached. */
export interface LoyaltyTransactionWithOrder extends LoyaltyTransaction {
  order_number: number | null
  customer_name: string | null
}

/** Loyalty rates from restaurant_settings. Defaults: 1 point per 100
 * currency units of order total, 1 point = 1 currency unit on redeem. */
export interface LoyaltyRates {
  earnPer100: number
  pointValue: number
}

export type CouponType = 'PERCENT' | 'FIXED'

export interface Coupon {
  id: string
  restaurant_id: string
  code: string
  type: CouponType
  value: number
  min_order_amount: number
  valid_from: string | null
  valid_to: string | null
  max_uses: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/** A coupon with its usage count attached (uses counts redemptions on
 * non-cancelled orders only — the count is computed, never stored). */
export interface CouponWithUsage extends Coupon {
  uses: number
}

export interface CouponRedemption {
  id: string
  coupon_id: string
  order_id: string
  discount_amount: number
  created_at: string
}

// ---------------------------------------------------------------------------
// Phase 5 — Digital Ordering (mirror supabase/migrations/0007_digital_ordering.sql)
// ---------------------------------------------------------------------------

/** One custom domain owned by a restaurant (e.g. addabuzz.com). */
export interface RestaurantDomain {
  id: string
  restaurant_id: string
  domain: string
  is_primary: boolean
  created_at: string
  updated_at: string
}

/** What resolve_restaurant_by_domain() returns for a hostname. */
export interface ResolvedDomain {
  restaurant_id: string
  slug: string
  name: string
}

/** One row of the public restaurant_storefronts view — the only
 * restaurant info the storefront is allowed to read. */
export interface StorefrontInfo {
  restaurant_id: string
  slug: string
  name: string
  default_currency: string
  timezone: string
  branding_name: string | null
  logo_url: string | null
  primary_color: string | null
  currency: string | null
  tax_rate: number
  service_charge_rate: number
  delivery_enabled: boolean
  delivery_fee: number
  min_order_amount: number
}

/** One line of an online order as the storefront sends it (ids +
 * quantity only — place_online_order() re-reads all prices). */
export interface OnlineOrderLineInput {
  productId: string
  variantId?: string | null
  modifierIds: string[]
  quantity: number
}

export interface PlaceOnlineOrderInput {
  slug: string
  tableCode?: string | null
  deliveryType: OrderType
  customerName: string
  customerPhone: string
  deliveryAddress?: string | null
  items: OnlineOrderLineInput[]
}

export interface PlacedOnlineOrder {
  orderId: string
  orderNumber: number
  tableName: string | null
}

export interface OnlineOrderStatus {
  status: OrderStatus
  totalAmount: number
}

// ---------------------------------------------------------------------------
// Phase 6 — Delivery
// ---------------------------------------------------------------------------

export type DeliveryDriverStatus = 'AVAILABLE' | 'ON_DELIVERY' | 'OFFLINE'

export interface DeliveryDriver {
  id: string
  restaurant_id: string
  branch_id: string | null
  user_id: string | null
  name: string
  phone: string
  email: string | null
  vehicle_type: string | null
  vehicle_number: string | null
  status: DeliveryDriverStatus
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface DeliveryZone {
  id: string
  restaurant_id: string
  branch_id: string | null
  name: string
  fee: number
  min_order_amount: number
  estimated_minutes: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type DeliveryStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'FAILED'
  | 'CANCELLED'

/** The delivery state machine. DELIVERED / FAILED / CANCELLED are
 * terminal for the delivery (the linked order has its own machine). */
export const DELIVERY_TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['OUT_FOR_DELIVERY', 'FAILED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
  FAILED: [],
  CANCELLED: [],
}

export function canTransitionDeliveryStatus(
  from: DeliveryStatus,
  to: DeliveryStatus,
): boolean {
  return (DELIVERY_TRANSITIONS[from] ?? []).includes(to)
}

export const TERMINAL_DELIVERY_STATUSES: DeliveryStatus[] = [
  'DELIVERED',
  'FAILED',
  'CANCELLED',
]

/** The dispatch record for one delivery order (1:1 with orders). */
export interface DeliveryOrder {
  order_id: string
  driver_id: string | null
  zone_id: string | null
  status: DeliveryStatus
  /** Snapshot of the amount to collect on delivery (= order total while
   * the order is unpaid), taken when this row is created. */
  cod_amount: number
  delivery_notes: string | null
  assigned_at: string | null
  picked_up_at: string | null
  out_for_delivery_at: string | null
  delivered_at: string | null
  failed_at: string | null
  created_at: string
  updated_at: string
}

/** One delivery status change. Append-only. */
export interface DeliveryStatusHistory {
  id: string
  delivery_order_id: string
  from_status: DeliveryStatus | null
  to_status: DeliveryStatus
  changed_by: string | null
  created_at: string
}

/** A row on the delivery board: the order, its dispatch record (null
 * until dispatch has created one), and the assigned driver's name. */
export interface DeliveryBoardEntry {
  order: Order
  delivery: DeliveryOrder | null
  driver_name: string | null
  zone_name: string | null
}
