// FoodX — restaurant domains data service (Phase 5).
// A restaurant owns its domain (e.g. addabuzz.com): the domain's root
// serves the public storefront, /panel on the same domain serves the
// admin app. Domains are stored lowercase + trimmed. The platform hosts
// (foodx.bond, the Vercel URL, localhost) can never be added as a
// restaurant domain — they belong to the platform itself.
import { supabase } from '@/lib/supabase'
import { isUniqueViolationError } from '@/lib/errors'
import { PLATFORM_HOSTS } from '@/services/storefront'
import type { RestaurantDomain } from '@/types'

const DOMAIN_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidDomain(value: string): boolean {
  return DOMAIN_PATTERN.test(normalizeDomain(value))
}

export async function fetchDomains(
  restaurantId: string,
): Promise<RestaurantDomain[]> {
  const { data, error } = await supabase
    .from('restaurant_domains')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('is_primary', { ascending: false })
    .order('domain', { ascending: true })
  if (error) throw error
  return (data ?? []) as RestaurantDomain[]
}

export async function getPrimaryDomain(
  restaurantId: string,
): Promise<RestaurantDomain | null> {
  const { data, error } = await supabase
    .from('restaurant_domains')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('is_primary', true)
    .maybeSingle()
  if (error) throw error
  return data as RestaurantDomain | null
}

/**
 * Add a domain for a restaurant. Throws Error('invalid_domain') for a
 * malformed host, Error('platform_domain') for a platform host, and
 * Error('domain_taken') when another restaurant already owns it.
 */
export async function addDomain(
  restaurantId: string,
  domain: string,
): Promise<RestaurantDomain> {
  const normalized = normalizeDomain(domain)
  if (!isValidDomain(normalized)) throw new Error('invalid_domain')
  if (
    PLATFORM_HOSTS.has(normalized) ||
    normalized.endsWith('.vercel.app')
  ) {
    throw new Error('platform_domain')
  }
  const { data, error } = await supabase
    .from('restaurant_domains')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      domain: normalized,
      is_primary: false,
    })
    .select()
    .single()
  if (error) {
    if (isUniqueViolationError(error)) throw new Error('domain_taken')
    throw error
  }
  return data as RestaurantDomain
}

/**
 * Make one domain the primary (the one QR codes + links use). Clears
 * the primary flag on the restaurant's other domains first.
 */
export async function setPrimaryDomain(
  restaurantId: string,
  domainId: string,
): Promise<RestaurantDomain> {
  const { error: clearError } = await supabase
    .from('restaurant_domains')
    .update({ is_primary: false })
    .eq('restaurant_id', restaurantId)
    .neq('id', domainId)
  if (clearError) throw clearError
  const { data, error } = await supabase
    .from('restaurant_domains')
    .update({ is_primary: true })
    .eq('id', domainId)
    .eq('restaurant_id', restaurantId)
    .select()
    .single()
  if (error) throw error
  return data as RestaurantDomain
}

export async function deleteDomain(domainId: string): Promise<void> {
  const { error } = await supabase
    .from('restaurant_domains')
    .delete()
    .eq('id', domainId)
  if (error) throw error
}
