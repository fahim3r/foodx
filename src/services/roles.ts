// FoodX — roles & permissions data service (read-only for Phase 1).
// Roles include the 12 system default roles (restaurant_id NULL) seeded by
// migration 0001 plus any roles of the caller's own restaurant.
import { supabase } from '@/lib/supabase'
import type { Permission, Role, RolePermission } from '@/types'

export async function fetchRoles(): Promise<Role[]> {
  const { data, error } = await supabase
    .from('roles')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Role[]
}

export async function fetchPermissions(): Promise<Permission[]> {
  const { data, error } = await supabase
    .from('permissions')
    .select('*')
    .order('module', { ascending: true })
    .order('key', { ascending: true })
  if (error) throw error
  return (data ?? []) as Permission[]
}

export async function fetchRolePermissions(): Promise<RolePermission[]> {
  const { data, error } = await supabase.from('role_permissions').select('*')
  if (error) throw error
  return (data ?? []) as RolePermission[]
}
