// FoodX — Phase 1 domain types (mirror supabase/migrations/0001_foundation.sql)

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
