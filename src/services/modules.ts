import type { RestaurantSettings } from '@/types'

/**
 * Restaurant-level module toggles (modifications v2, item 8).
 * These are the RESTAURANT's own operational switches — distinct
 * from the vendor feature flags in the DevPanel (§60): the vendor
 * flag always wins (a restaurant cannot switch on what it has not
 * bought), and the restaurant switch only hides a module locally.
 * Data is never deleted by a toggle; switching back on restores
 * everything exactly as it was.
 *
 * Storage: delivery reads the Phase 6 `delivery_enabled` column;
 * the rest read the `modules` jsonb (migration 0027). A missing
 * settings row or a missing key reads as ON.
 */
export type ModuleKey =
  | 'delivery'
  | 'loyalty'
  | 'reservations'
  | 'business'
  | 'customers'

export function isModuleOn(
  settings: RestaurantSettings | null | undefined,
  key: ModuleKey,
): boolean {
  if (!settings) return true
  if (key === 'delivery') return settings.delivery_enabled !== false
  return settings.modules?.[key] !== false
}
