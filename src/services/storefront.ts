// FoodX — public storefront data service (Phase 5).
// Everything here is callable WITHOUT login: the storefront runs on the
// anonymous key. Menu reads go through the same menu/inventory services
// the POS uses (the anon SELECT policies from migration 0007 make them
// work for anonymous callers); order placement and status go through
// SECURITY DEFINER functions, which validate everything server-side.
//
// Hostnames: on the platform hosts below, / serves the public
// storefront of the demo restaurant (DEFAULT_DEMO_STORE_SLUG, or
// ?store=<slug> to preview another restaurant), /panel serves the
// admin app, and /devpanel is the Developer Panel placeholder (Phase 8).
// Any other hostname is resolved with resolve_restaurant_by_domain():
// a match serves that restaurant's storefront at / and the admin app
// under /panel.
import { supabase } from '@/lib/supabase'
import { fetchProductAvailability } from '@/services/inventory'
import {
  fetchCategories,
  fetchProductsWithDetails,
} from '@/services/menu'
import type {
  Category,
  DeliveryZone,
  OnlineOrderStatus,
  OrderStatus,
  PlaceOnlineOrderInput,
  PlacedOnlineOrder,
  ProductWithDetails,
  ResolvedDomain,
  StorefrontInfo,
} from '@/types'

/** Hostnames that serve the admin app (everything else is a
 * restaurant domain, resolved with resolve_restaurant_by_domain). */
export const PLATFORM_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'foodx.bond',
  'www.foodx.bond',
  'foodx-one.vercel.app',
])

export function isPlatformHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  return PLATFORM_HOSTS.has(host) || host.endsWith('.vercel.app')
}

/**
 * The restaurant whose storefront is the landing page on the platform
 * hosts (foodx.bond / www.foodx.bond) — the FoodX Demo restaurant,
 * used for client demos (Fahim's decision 2026-11-17). ?store=<slug>
 * still overrides it to preview any other restaurant.
 */
export const DEFAULT_DEMO_STORE_SLUG = 'foodx-demo'

/** The host the storefront preview lives on (platform host). */
export const PREVIEW_HOST = 'www.foodx.bond'

/**
 * Resolve a hostname to its restaurant (or null when the domain is not
 * connected to any FoodX restaurant). Public: no login needed.
 */
export async function resolveDomain(
  hostname: string,
): Promise<ResolvedDomain | null> {
  const { data, error } = await supabase
    .rpc('resolve_restaurant_by_domain', {
      p_domain: hostname.trim().toLowerCase(),
    })
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return data as ResolvedDomain
}

/** Public restaurant info for a slug, read through the
 * restaurant_storefronts view (never the base tables). */
export async function fetchStorefront(
  slug: string,
): Promise<StorefrontInfo | null> {
  const { data, error } = await supabase
    .from('restaurant_storefronts')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw error
  return data as StorefrontInfo | null
}

export interface StorefrontMenu {
  categories: Category[]
  products: ProductWithDetails[]
}

/** The public menu: categories + products with variants/modifiers.
 * Same queries as the POS (anon policies make them work logged out). */
export async function fetchStorefrontMenu(
  restaurantId: string,
): Promise<StorefrontMenu> {
  const [categories, products] = await Promise.all([
    fetchCategories(restaurantId),
    fetchProductsWithDetails(restaurantId),
  ])
  return { categories, products }
}

/**
 * The restaurant's active delivery zones, for the checkout zone
 * picker (migration 0012). Public: the anon SELECT policy on
 * delivery_zones makes this work logged out. Ordered the way the
 * panel orders them (sort_order, then name).
 */
export async function fetchPublicZones(
  restaurantId: string,
): Promise<DeliveryZone[]> {
  const { data, error } = await supabase
    .from('delivery_zones')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as DeliveryZone[]
}

/** Servings the current stock allows per product (same as the POS). */
export async function fetchStorefrontAvailability(
  restaurantId: string,
): Promise<Map<string, number>> {
  return fetchProductAvailability(restaurantId)
}

/**
 * The public URL of a restaurant's storefront: its primary domain when
 * one is set, otherwise the platform preview URL (?store=<slug>).
 */
export function buildStorefrontUrl(
  domain: string | null | undefined,
  slug: string,
): string {
  if (domain) return `https://${domain}/`
  return `https://${PREVIEW_HOST}/?store=${encodeURIComponent(slug)}`
}

/**
 * The URL a table's QR code (and NFC tag) points to. On the
 * restaurant's own domain it is the domain root with ?table=<qr value>;
 * without a primary domain it is the platform preview URL with
 * ?store=<slug>&table=<qr value> so the QR stays usable for testing.
 */
export function buildTableQrUrl(
  domain: string | null | undefined,
  slug: string,
  tableQrValue: string,
): string {
  const table = encodeURIComponent(tableQrValue)
  if (domain) return `https://${domain}/?table=${table}`
  return `https://${PREVIEW_HOST}/?store=${encodeURIComponent(slug)}&table=${table}`
}

/** Short machine-readable errors place_online_order() can raise. */
const ONLINE_ORDER_ERRORS = [
  'unknown_restaurant',
  'invalid_delivery_type',
  'customer_required',
  'empty_order',
  'invalid_item',
  'table_not_found',
  'delivery_not_available',
  'delivery_address_required',
  'min_order_not_met',
  'invalid_zone',
] as const

/**
 * Place an online order through the server-side function (it re-reads
 * prices, computes totals, creates the order + items, links the
 * customer by phone, and deducts stock — atomically). Throws
 * Error(<one of ONLINE_ORDER_ERRORS>) on a validation failure, so the
 * UI can map it to a friendly message.
 */
export async function placeOnlineOrder(
  input: PlaceOnlineOrderInput,
): Promise<PlacedOnlineOrder> {
  const { data, error } = await supabase
    .rpc('place_online_order', {
      p_slug: input.slug,
      p_table_code: input.tableCode ?? null,
      p_delivery_type: input.deliveryType,
      p_customer_name: input.customerName.trim(),
      p_customer_phone: input.customerPhone.trim(),
      p_delivery_address: input.deliveryAddress?.trim() || null,
      p_zone_id: input.zoneId ?? null,
      p_items: input.items.map((line) => ({
        product_id: line.productId,
        variant_id: line.variantId ?? null,
        modifier_ids: line.modifierIds,
        quantity: line.quantity,
      })),
    })
    .maybeSingle()
  if (error) {
    const message = error.message ?? ''
    const known = ONLINE_ORDER_ERRORS.find((code) =>
      message.includes(code),
    )
    throw new Error(known ?? 'place_failed')
  }
  if (!data) throw new Error('place_failed')
  const row = data as {
    order_id: string
    order_number: number
    table_name: string | null
  }
  return {
    orderId: row.order_id,
    orderNumber: row.order_number,
    tableName: row.table_name,
  }
}

/**
 * A guest's order status (status + total only) — the phone must match
 * the order's customer phone. Returns null when nothing matches.
 */
export async function getOnlineOrderStatus(
  slug: string,
  orderNumber: number,
  phone: string,
): Promise<OnlineOrderStatus | null> {
  const { data, error } = await supabase
    .rpc('get_online_order_status', {
      p_slug: slug,
      p_order_number: orderNumber,
      p_phone: phone.trim(),
    })
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as { status: OrderStatus; total_amount: number }
  return { status: row.status, totalAmount: Number(row.total_amount) }
}
