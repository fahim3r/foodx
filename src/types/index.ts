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
  modules: string[] | null
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

export interface RestaurantModules {
  loyalty?: boolean
  reservations?: boolean
  business?: boolean
  customers?: boolean
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
  onboarding_completed: boolean
  modules: RestaurantModules | null
  auto_send_to_kitchen: boolean
  /** Easy Mode v2 (migration 0034): restaurant-wide simple panel. */
  easy_mode: boolean
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
export type OrderSource = 'POS' | 'QR' | 'ONLINE' | 'THIRD_PARTY'

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
  /** Manual cost (migration 0017) — margin-report fallback when the
   * product has no recipe; null = no manual cost recorded. */
  cost_price: number | null
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
  /** Zone the customer picked online (migration 0012); null for POS
   * orders and restaurants without zones. The delivery board pre-fills
   * its dispatch row from this. */
  delivery_zone_id?: string | null
  /** Aggregator reference for THIRD_PARTY orders (migration 0022):
   * the platform's own order id and the platform name. Null otherwise. */
  external_order_id: string | null
  third_party_company: string | null
  /** Per-day counter token (migration 0023): set on every non-dine-in
   * order, null for dine-in. token_day is the restaurant-local date
   * the token belongs to (YYYY-MM-DD). */
  token_number: number | null
  token_day: string | null
  /** Set when this order was merged into another order (migration
   * 0025); the order itself is CANCELLED. Null for normal orders. */
  merged_into_id: string | null
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

/** Per-item kitchen progress (migration 0036). A station bucket's
 * state on the KDS is the aggregate of its items' states. */
export type KitchenItemStatus = 'PENDING' | 'PREPARING' | 'READY'

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
  /** Per-item kitchen note (migration 0021); null when none. */
  note: string | null
  /** Per-item kitchen progress (migration 0036). */
  kitchen_status: KitchenItemStatus
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
export type ReservationStatus =
  | 'BOOKED'
  | 'ARRIVED'
  | 'SEATED'
  | 'CANCELLED'
  | 'NO_SHOW'

/** A table booking (migration 0026). Guest fields are snapshots —
 * walk-in guests may not exist as customers. */
export interface Reservation {
  id: string
  restaurant_id: string
  table_id: string | null
  guest_name: string
  guest_phone: string | null
  reserved_for: string
  party_size: number
  status: ReservationStatus
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface PosOrderLineInput {
  productId: string
  variantId?: string | null
  modifierIds: string[]
  quantity: number
  /** Per-item kitchen note ("less spicy") — Roadmap Wave 1, gap 5. */
  note?: string
}

export interface CreateOrderInput {
  restaurantId: string
  branchId?: string | null
  tableId?: string | null
  type: OrderType
  /** Defaults to 'POS' when omitted. Third-party entry passes
   * 'THIRD_PARTY' with the aggregator fields below (migration 0022). */
  source?: OrderSource
  externalOrderId?: string | null
  thirdPartyCompany?: string | null
  /** Guest contact written to orders.customer_name / customer_phone
   * (third-party entry and POS delivery; the normal counter flow
   * leaves them null and attaches a customer record instead). */
  customerName?: string | null
  customerPhone?: string | null
  /** Delivery address written to orders.delivery_address (POS
   * delivery orders; the online flow passes its address to
   * place_online_order instead). */
  deliveryAddress?: string | null
  /** Delivery zone picked at the counter (orders.delivery_zone_id)
   * and that zone's fee (orders.delivery_fee). The fee joins the
   * order total after tax / service charge — the same rule
   * place_online_order applies online. */
  deliveryZoneId?: string | null
  deliveryFee?: number
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
  /** Delivery fee included in totalAmount (0 / absent unless a
   * delivery zone was picked). Never taxed — added last, exactly
   * like place_online_order. */
  deliveryFee?: number
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
  /** Branch the movement hit (migration 0018); null on movements
   * written before 0018 and on restaurants without branches. */
  branch_id: string | null
}

export type StockTransferStatus =
  | 'REQUESTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'RECEIVED'
  | 'CANCELLED'

/** A branch-to-branch stock transfer (migration 0018, §41). Stock
 * moves only at receive time, inside receive_stock_transfer(). */
export interface StockTransfer {
  id: string
  restaurant_id: string
  from_branch_id: string
  to_branch_id: string
  status: StockTransferStatus
  notes: string | null
  requested_by: string | null
  approved_by: string | null
  approved_at: string | null
  received_by: string | null
  received_at: string | null
  created_at: string
  updated_at: string
}

export interface StockTransferItem {
  id: string
  restaurant_id: string
  transfer_id: string
  inventory_item_id: string
  quantity: number
}

export interface StockTransferWithItems extends StockTransfer {
  items: StockTransferItem[]
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

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'ORDERED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CLOSED'
  | 'CANCELLED'

export interface PurchaseOrder {
  id: string
  restaurant_id: string
  supplier_id: string
  status: PurchaseOrderStatus
  order_date: string
  total_amount: number
  /** Money value of what has actually arrived (migration 0035):
   * Σ received_quantity × unit_cost, maintained by the receive
   * service. Equals total_amount exactly on a RECEIVED order. */
  received_amount: number
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

/** Purchase-order state machine. RECEIVED, CLOSED and CANCELLED are
 * final; CANCELLED only from DRAFT or ORDERED (a PO with goods in is
 * ended by closing the remainder, never cancelled). The receive
 * service derives PARTIALLY_RECEIVED / RECEIVED from the lines; this
 * table guards advancePurchaseOrderStatus. Enforced by the purchases
 * service. */
export const PURCHASE_ORDER_TRANSITIONS: Record<
  PurchaseOrderStatus,
  PurchaseOrderStatus[]
> = {
  DRAFT: ['ORDERED', 'CANCELLED'],
  ORDERED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['RECEIVED', 'CLOSED'],
  RECEIVED: [],
  CLOSED: [],
  CANCELLED: [],
}

/** An order as the KDS sees it: only its items for one station. */
export interface KitchenOrder {
  order: Order
  items: OrderItemWithModifiers[]
  /** This station bucket's own progress (migration 0036): the
   * aggregate of its items' effective kitchen states. The order
   * becomes Ready only when every bucket is READY. */
  stationStatus: KitchenItemStatus
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
  zoneId?: string | null
  items: OnlineOrderLineInput[]
}

export interface PlacedOnlineOrder {
  orderId: string
  orderNumber: number
  tableName: string | null
  tokenNumber: number | null
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

// ---------------------------------------------------------------------------
// Phase 7 — Business (migration 0013)
// ---------------------------------------------------------------------------

/** The twelve expense categories from §36, seeded per restaurant by the
 * business service the first time categories are loaded. Stored as data
 * (expense_categories rows); the UI localises the system names. */
export const DEFAULT_EXPENSE_CATEGORY_NAMES = [
  'Rent',
  'Salary',
  'Utilities',
  'Gas',
  'Electricity',
  'Internet',
  'Marketing',
  'Packaging',
  'Transportation',
  'Maintenance',
  'Supplies',
  'Other',
] as const

export interface ExpenseCategory {
  id: string
  restaurant_id: string
  name: string
  is_system: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Expense {
  id: string
  restaurant_id: string
  branch_id: string | null
  category_id: string
  amount: number
  /** date (yyyy-mm-dd) the expense belongs to. */
  expense_date: string
  payment_method: PaymentMethod
  notes: string | null
  attachment_url: string | null
  created_by: string | null
  /** §46: expenses are voided, never hard-deleted. */
  is_voided: boolean
  voided_at: string | null
  voided_by: string | null
  created_at: string
  updated_at: string
}

/** Money paid to a supplier (migration 0017). No delete by design —
 * corrections are edits, like expenses (§46 pattern). */
export interface SupplierPayment {
  id: string
  restaurant_id: string
  supplier_id: string
  purchase_order_id: string | null
  amount: number
  payment_method: PaymentMethod
  /** date (yyyy-mm-dd) the payment was made. */
  paid_on: string
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CashierShiftStatus = 'OPEN' | 'CLOSED'

export interface CashierShift {
  id: string
  restaurant_id: string
  branch_id: string | null
  opened_by: string | null
  opening_cash: number
  status: CashierShiftStatus
  opened_at: string
  closed_by: string | null
  closed_at: string | null
  /** Computed from DB data at close; never client-supplied. */
  expected_cash: number | null
  actual_cash: number | null
  /** actual − expected, stored at close. */
  difference: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type CashMovementType = 'CASH_IN' | 'CASH_OUT' | 'ADJUSTMENT'

/** Append-only cash drawer movement during a shift (§38). */
export interface ShiftCashMovement {
  id: string
  shift_id: string
  type: CashMovementType
  /** Positive for CASH_IN / CASH_OUT; signed for ADJUSTMENT. */
  amount: number
  reason: string
  created_by: string | null
  created_at: string
}

/** One day's closing snapshot (§37 daily closing). */
export interface DailyClosing {
  id: string
  restaurant_id: string
  branch_id: string | null
  closing_date: string
  total_sales: number
  total_purchases: number
  total_expenses: number
  total_refunds: number
  cash_expected: number | null
  cash_actual: number | null
  difference: number | null
  closed_by: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Phase 8 — Developer Platform, Step 1: manual registry (migration 0014).
// Vendor-side records only: these describe client DEPLOYMENTS (their own
// databases/domains), never restaurant data (§1, §51, §52, §55, §60, §72).
// ---------------------------------------------------------------------------

export type DevClientStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE'

/** A registered FoodX client deployment (§51 client record). */
export interface DevClient {
  id: string
  client_code: string
  restaurant_name: string
  owner_name: string | null
  contact_email: string | null
  contact_phone: string | null
  domain: string | null
  instance_url: string | null
  /** Which Supabase project the deployment uses — informational (§51). */
  instance_supabase_ref: string | null
  /** Registered version until the instance first checks in; after that
   * the instance-heartbeat function overwrites it with the REPORTED
   * version on every check-in (Phase 8 step 2). last_seen_at tells the
   * two apart: null = as registered, set = last reported. */
  version: string | null
  plan: string | null
  status: DevClientStatus
  notes: string | null
  /** SHA-256 hash of the instance token (migration 0015); the plaintext
   *  token itself is never stored. Null = no token issued. */
  instance_token_hash: string | null
  /** Last accepted heartbeat (migration 0015). Null = never checked in. */
  last_seen_at: string | null
  /** Self-reported branch/user counts from the latest heartbeat
   * (Phase 8 R2); null = never reported. The Developer Panel shows
   * them against the license limits in the support view (§72). */
  last_branch_count: number | null
  last_user_count: number | null
  /** Latest backup report from the vendor's backup script
   * (Phase 8 R3); null = no backup ever reported. Written only by
   * the report-backup function (instance-token authenticated). */
  last_backup_at: string | null
  last_backup_status: 'success' | 'failed' | null
  /** The client's Vercel Deploy Hook URL (Phase 8 R4). A
   * capability secret that lives ONLY in the registry: the
   * trigger-update / request-update functions POST it server-side
   * and it is never sent to a client deployment's browser. */
  deploy_hook_url: string | null
  created_at: string
  updated_at: string
}

export type LicensePlan =
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'HALF_YEARLY'
  | 'YEARLY'
  | 'LIFETIME'

export const LICENSE_PLANS: LicensePlan[] = [
  'MONTHLY',
  'QUARTERLY',
  'HALF_YEARLY',
  'YEARLY',
  'LIFETIME',
]

export type LicenseStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'RENEWED'
  | 'CANCELLED'

/** One license row (§52). Renewal creates a new row; history is kept. */
export interface DevLicense {
  id: string
  client_id: string
  license_key: string
  plan: LicensePlan
  start_date: string
  /** NULL for LIFETIME licenses — they never expire (§52). */
  expiry_date: string | null
  status: LicenseStatus
  max_branches: number | null
  max_users: number | null
  max_devices: number | null
  features: Record<string, boolean>
  created_at: string
  updated_at: string
}

export type DevReleaseStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

/** A software release the developer can roll out to clients (§55). */
export interface DevRelease {
  id: string
  version: string
  release_notes: string | null
  required_migrations: string[]
  compatibility: string | null
  /** NULL = all clients (§55 target clients). */
  target_client_ids: string[] | null
  status: DevReleaseStatus
  published_at: string | null
  created_at: string
  updated_at: string
}

/** Vendor-registered feature keys (§60) — same vocabulary as the
 * per-restaurant feature_flags table in 0001, different scope: these
 * are per client DEPLOYMENT and, in Step 1, are not yet pulled by the
 * client instance (see devpanel service notes). */
export type DevFeatureKey =
  | 'online_ordering'
  | 'delivery'
  | 'loyalty'
  | 'accounting'
  | 'nfc'
  | 'multi_branch'

export const DEV_FEATURE_KEYS: DevFeatureKey[] = [
  'online_ordering',
  'delivery',
  'loyalty',
  'accounting',
  'nfc',
  'multi_branch',
]

export interface DevClientFeature {
  id: string
  client_id: string
  feature_key: DevFeatureKey
  is_enabled: boolean
  created_at: string
  updated_at: string
}

/** Append-only support history entry for a client (§72). */
export interface DevSupportNote {
  id: string
  client_id: string
  note: string
  created_by: string | null
  created_at: string
}

/** One accepted instance heartbeat (migration 0015). Written only by the
 *  instance-heartbeat Edge Function; append-only history. */
export interface DevHeartbeat {
  id: string
  client_id: string
  version: string
  domain: string | null
  user_agent: string | null
  created_at: string
}

/** One backup run reported by the vendor's backup script
 * (Phase 8 R3, §59). Append-only history; the client's latest
 * state is mirrored on DevClient.last_backup_*. */
export interface DevBackupReport {
  id: string
  client_id: string
  status: 'success' | 'failed'
  size_bytes: number | null
  note: string | null
  created_at: string
}

export type DevTicketStatus = 'open' | 'in_progress' | 'resolved'

export type DevTicketCategory =
  | 'order_payment'
  | 'printer_hardware'
  | 'menu_settings'
  | 'other'

/** One support ticket filed by a client deployment through the
 * submit-ticket Edge Function (Help section H1, registry migration
 * 0002). client_id is resolved server-side from the instance token —
 * the client never sends it. sender_* are plain text, not foreign
 * keys: client users live in the CLIENT project's Auth, while the
 * registry's auth.users holds only developers. */
export interface DevSupportTicket {
  id: string
  client_id: string
  title: string
  category: DevTicketCategory
  message: string
  sender_name: string | null
  sender_email: string | null
  status: DevTicketStatus
  created_at: string
  updated_at: string
}

/** DevPanel needs-attention alert kinds (DevPanel search + alerts).
 * Derived client-side from registry rows — never stored. The order
 * of the union mirrors the severity order in the service. */
export type DevAlertKind =
  | 'license_expired'
  | 'backup_failed'
  | 'never_checked_in'
  | 'checkin_stale'
  | 'no_license'
  | 'license_expiring'
  | 'backup_outdated'
  | 'update_pending'

/** One derived alert naming one client (DevPanel search + alerts). */
export interface DevClientAlert {
  clientId: string
  kind: DevAlertKind
  /** §3-Q5 order; lower = more urgent. */
  severity: number
  /** Age of the condition in whole days, when an age applies. For
   * license_expiring this carries the days LEFT instead (the row
   * renders it with the days-left wording). */
  sinceDays: number | null
  /** Extra for the row text, e.g. "1.0.0 → 1.0.1" for update_pending
   * or the effective status for a not-active license. */
  detail: string | null
}

/** Check-in health buckets — the Dashboard health card's 24h lines,
 * shared by the card, the Clients Health filter and the alerts. */
export type DevClientHealth = 'fresh' | 'stale' | 'never'

/** Backup state against the §56 update gate (last success ≤ 7 days). */
export type DevBackupGateState = 'ok' | 'failed' | 'stale' | 'never'

export type DevClientSort = 'registered' | 'name' | 'stalest' | 'expiry'

/** The Clients-tab toolbar state (DevPanel search + alerts). */
export interface DevClientFilters {
  status: 'ALL' | DevClientStatus
  license: 'ALL' | 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'LIFETIME' | 'NONE'
  health: 'ALL' | DevClientHealth
  version: 'ALL' | 'CURRENT' | 'PENDING'
  attentionOnly: boolean
  sort: DevClientSort
}


// --- HRM (modifications v2, item 10) --------------------------------------

export type EmployeeStatus = 'active' | 'inactive'

export interface Employee {
  id: string
  restaurant_id: string
  profile_id: string | null
  full_name: string
  phone: string | null
  designation: string | null
  monthly_salary: number | null
  join_date: string | null
  status: EmployeeStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export type AttendanceStatus = 'present' | 'absent' | 'leave' | 'half_day'

export interface AttendanceRecord {
  id: string
  restaurant_id: string
  employee_id: string
  day: string
  status: AttendanceStatus
  note: string | null
  marked_by: string | null
  created_at: string
  updated_at: string
}
