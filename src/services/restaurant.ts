// FoodX — restaurant / profile / settings data service.
// All queries are scoped by RLS to the caller's own restaurant. When the
// Phase 1 migration has not been applied yet, PostgREST returns a
// "table does not exist" error — callers detect that with
// isMissingTableError() and show a friendly pending-setup notice.
import { supabase } from '@/lib/supabase'
import type {
  Profile,
  Restaurant,
  RestaurantFormValues,
  RestaurantSettings,
} from '@/types'

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data as Profile | null
}

export async function fetchRestaurant(restaurantId: string): Promise<Restaurant | null> {
  const { data, error } = await supabase
    .from('restaurants')
    .select('*')
    .eq('id', restaurantId)
    .maybeSingle()
  if (error) throw error
  return data as Restaurant | null
}

export async function fetchSettings(
  restaurantId: string,
): Promise<RestaurantSettings | null> {
  const { data, error } = await supabase
    .from('restaurant_settings')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (error) throw error
  return data as RestaurantSettings | null
}

export async function createRestaurant(
  values: Pick<RestaurantFormValues, 'name' | 'slug' | 'currency' | 'timezone'>,
): Promise<Restaurant> {
  const { data, error } = await supabase
    .from('restaurants')
    .insert({
      name: values.name,
      slug: values.slug,
      default_currency: values.currency,
      timezone: values.timezone,
    })
    .select()
    .single()
  if (error) throw error
  return data as Restaurant
}

export async function updateRestaurant(
  restaurantId: string,
  patch: Partial<Pick<Restaurant, 'name' | 'slug' | 'default_currency' | 'timezone'>>,
): Promise<Restaurant> {
  const { data, error } = await supabase
    .from('restaurants')
    .update(patch)
    .eq('id', restaurantId)
    .select()
    .single()
  if (error) throw error
  return data as Restaurant
}

export async function linkProfileToRestaurant(
  userId: string,
  restaurantId: string,
  fullName?: string,
): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: userId,
        restaurant_id: restaurantId,
        full_name: fullName ?? null,
      },
      { onConflict: 'id' },
    )
    .select()
    .single()
  if (error) throw error
  return data as Profile
}

export async function upsertSettings(
  restaurantId: string,
  values: Pick<
    RestaurantFormValues,
    | 'branding_name'
    | 'logo_url'
    | 'primary_color'
    | 'secondary_color'
    | 'currency'
    | 'tax_rate'
    | 'service_charge_rate'
    | 'receipt_footer'
  >,
): Promise<RestaurantSettings> {
  const { data, error } = await supabase
    .from('restaurant_settings')
    .upsert(
      {
        restaurant_id: restaurantId,
        branding_name: values.branding_name || null,
        logo_url: values.logo_url || null,
        primary_color: values.primary_color,
        secondary_color: values.secondary_color,
        currency: values.currency,
        tax_rate: values.tax_rate,
        service_charge_rate: values.service_charge_rate,
        receipt_footer: values.receipt_footer || null,
      },
      { onConflict: 'restaurant_id' },
    )
    .select()
    .single()
  if (error) throw error
  return data as RestaurantSettings
}
