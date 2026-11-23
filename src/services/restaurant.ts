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

export interface Branch {
  id: string
  restaurant_id: string
  name: string
  code: string | null
  address: string | null
  phone: string | null
  is_main: boolean
  status: string
}

/** Branches of a restaurant, main branch first. Phase 2 has no branch
 * management UI — the POS uses the main (or first) branch as the default
 * branch for new orders. */
export async function fetchBranches(
  restaurantId: string,
): Promise<Branch[]> {
  const { data, error } = await supabase
    .from('branches')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('is_main', { ascending: false })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Branch[]
}

/**
 * Create the caller's first restaurant and return its id.
 *
 * The id is generated here, not by the database, and the insert does NOT
 * ask PostgREST to return the row: the restaurants SELECT policy only
 * shows the caller's own restaurant, which is decided by the profile —
 * and the profile is linked to the new restaurant only in the next step
 * (linkProfileToRestaurant). So `.select().single()` here would always
 * fail with "no rows returned" even though the insert itself succeeded,
 * and the save would report a failure while leaving an orphaned row.
 * The caller links the profile next, then re-reads the row through RLS.
 */
export async function createRestaurant(
  values: Pick<RestaurantFormValues, 'name' | 'slug' | 'currency' | 'timezone'>,
): Promise<string> {
  const id = crypto.randomUUID()
  const { error } = await supabase.from('restaurants').insert({
    id,
    name: values.name,
    slug: values.slug,
    default_currency: values.currency,
    timezone: values.timezone,
  })
  if (error) throw error
  return id
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
    | 'loyalty_earn_per_100'
    | 'loyalty_point_value'
    | 'delivery_enabled'
    | 'delivery_fee'
    | 'min_order_amount'
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
        loyalty_earn_per_100: values.loyalty_earn_per_100,
        loyalty_point_value: values.loyalty_point_value,
        delivery_enabled: values.delivery_enabled,
        delivery_fee: values.delivery_fee,
        min_order_amount: values.min_order_amount,
      },
      { onConflict: 'restaurant_id' },
    )
    .select()
    .single()
  if (error) throw error
  return data as RestaurantSettings
}

/** Partial settings update (onboarding wizard, migration 0016): only
 * the given columns change, unlike upsertSettings which rewrites the
 * whole settings form. */
export async function updateSettingsPartial(
  restaurantId: string,
  patch: Partial<
    Pick<
      RestaurantSettings,
      | 'currency'
      | 'tax_rate'
      | 'branding_name'
      | 'glass_backdrop_url'
      | 'onboarding_completed'
      | 'delivery_enabled'
      | 'delivery_fee'
      | 'modules'
      | 'auto_send_to_kitchen'
      | 'easy_mode'
    >
  >,
): Promise<void> {
  const { error } = await supabase
    .from('restaurant_settings')
    .update(patch)
    .eq('restaurant_id', restaurantId)
  if (error) throw error
}

/** Branch contact update (onboarding wizard step 1 writes the main
 * branch's phone/address — branches are where contact fields live). */
export async function updateBranchContact(
  branchId: string,
  patch: { phone: string | null; address: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('branches')
    .update(patch)
    .eq('id', branchId)
  if (error) throw error
}

/** Create the main branch (onboarding wizard step 1, when the
 * deployment was seeded without one): the POS needs a branch, and
 * the wizard's phone/address need a home. */
export async function createMainBranch(
  restaurantId: string,
  values: { name: string; phone: string | null; address: string | null },
): Promise<void> {
  const { error } = await supabase.from('branches').insert({
    id: crypto.randomUUID(),
    restaurant_id: restaurantId,
    name: values.name,
    phone: values.phone,
    address: values.address,
    is_main: true,
    status: 'active',
  })
  if (error) throw error
}

export interface BranchInput {
  name: string
  code: string | null
  address: string | null
  phone: string | null
  isMain: boolean
  status: 'active' | 'inactive'
}

/** Branch management (Phase 7 Step 2B, §40). When the new branch is
 * the main branch, any previous main branch is demoted first so a
 * restaurant keeps exactly one main branch. */
export async function createBranch(
  restaurantId: string,
  values: BranchInput,
): Promise<Branch> {
  if (values.isMain) {
    const { error: demoteError } = await supabase
      .from('branches')
      .update({ is_main: false })
      .eq('restaurant_id', restaurantId)
      .eq('is_main', true)
    if (demoteError) throw demoteError
  }
  const { data, error } = await supabase
    .from('branches')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      name: values.name.trim(),
      code: values.code?.trim() || null,
      address: values.address?.trim() || null,
      phone: values.phone?.trim() || null,
      is_main: values.isMain,
      status: values.status,
    })
    .select()
    .single()
  if (error) throw error
  return data as Branch
}

export async function updateBranch(
  restaurantId: string,
  branchId: string,
  values: BranchInput,
): Promise<void> {
  if (values.isMain) {
    const { error: demoteError } = await supabase
      .from('branches')
      .update({ is_main: false })
      .eq('restaurant_id', restaurantId)
      .eq('is_main', true)
      .neq('id', branchId)
    if (demoteError) throw demoteError
  }
  const { error } = await supabase
    .from('branches')
    .update({
      name: values.name.trim(),
      code: values.code?.trim() || null,
      address: values.address?.trim() || null,
      phone: values.phone?.trim() || null,
      is_main: values.isMain,
      status: values.status,
    })
    .eq('id', branchId)
  if (error) throw error
}

/**
 * Fill branch_stock rows for the main branch from the global totals
 * (migration 0018). Only fills rows that do not exist yet — safe to
 * call after creating a main branch; returns how many rows were added.
 */
export async function backfillBranchStock(): Promise<number> {
  const { data, error } = await supabase.rpc('backfill_branch_stock')
  if (error) throw error
  return Number(data ?? 0)
}
