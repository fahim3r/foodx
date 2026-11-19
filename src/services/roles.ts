// FoodX — roles & permissions data service.
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

// --- Modifications v2, item 4: custom roles + editable matrix ------------
// Enforcement in v1 is UI-level (see usePermissions): the panel
// hides what a role lacks. The database boundary stays what it
// has always been — restaurant membership + admin helpers — and
// migration 0029 makes these two tables admin-writable only.

export const ADMIN_ROLE_NAMES = ['super_admin', 'restaurant_owner', 'admin']

const ALL_PERMISSION_KEYS = [
  'orders.view', 'orders.create', 'orders.edit', 'orders.cancel', 'orders.refund',
  'inventory.view', 'inventory.adjust', 'inventory.purchase', 'inventory.transfer',
  'reports.view', 'reports.export',
  'staff.view', 'staff.create', 'staff.edit', 'staff.delete',
  'settings.view', 'settings.manage',
  'tables.view', 'tables.manage',
  'products.view', 'products.create', 'products.edit', 'products.delete',
  'customers.view', 'customers.create', 'customers.edit', 'customers.delete',
  'purchases.view', 'purchases.create', 'purchases.edit',
  'expenses.view', 'expenses.create', 'expenses.edit', 'expenses.delete',
  'kitchen.view', 'kitchen.manage',
  'delivery.view', 'delivery.manage', 'delivery.assign',
]

/**
 * The vendor's sensible defaults for the 12 system roles. System
 * roles cannot hold rows in role_permissions (the insert policy
 * only allows a restaurant's own roles), so their matrix lives
 * here as a code constant — used for display and UI gating.
 * Admin-level roles bypass gating entirely; they are listed as
 * ALL for display.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: ALL_PERMISSION_KEYS,
  restaurant_owner: ALL_PERMISSION_KEYS,
  admin: ALL_PERMISSION_KEYS,
  branch_manager: ALL_PERMISSION_KEYS.filter(
    (k) => k !== 'staff.delete' && k !== 'settings.manage',
  ),
  manager: [
    'orders.view', 'orders.create', 'orders.edit', 'orders.cancel',
    'tables.view', 'tables.manage',
    'products.view',
    'customers.view', 'customers.create', 'customers.edit',
    'kitchen.view', 'kitchen.manage',
    'delivery.view', 'delivery.manage', 'delivery.assign',
    'inventory.view', 'reports.view',
    'expenses.view', 'expenses.create',
    'staff.view', 'settings.view',
  ],
  accountant: [
    'reports.view', 'reports.export',
    'expenses.view', 'expenses.create', 'expenses.edit', 'expenses.delete',
    'purchases.view',
    'orders.view', 'customers.view', 'inventory.view', 'products.view',
  ],
  cashier: [
    'orders.view', 'orders.create', 'orders.edit', 'orders.cancel',
    'tables.view',
    'customers.view', 'customers.create', 'customers.edit',
    'products.view', 'kitchen.view',
  ],
  waiter: [
    'orders.view', 'orders.create', 'orders.edit',
    'tables.view', 'products.view', 'kitchen.view', 'customers.view',
  ],
  kitchen_staff: [
    'kitchen.view', 'kitchen.manage',
    'orders.view', 'products.view', 'inventory.view',
  ],
  inventory_manager: [
    'inventory.view', 'inventory.adjust', 'inventory.purchase', 'inventory.transfer',
    'purchases.view', 'purchases.create', 'purchases.edit',
    'products.view', 'products.edit',
    'reports.view', 'orders.view', 'expenses.view',
  ],
  delivery_staff: ['delivery.view', 'delivery.manage', 'delivery.assign', 'orders.view'],
  receptionist: [
    'tables.view', 'tables.manage',
    'orders.view', 'orders.create',
    'customers.view', 'customers.create', 'customers.edit',
    'products.view',
  ],
}

export async function createRole(
  restaurantId: string,
  displayName: string,
): Promise<Role> {
  const name =
    displayName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'role'
  const { data, error } = await supabase
    .from('roles')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      name,
      display_name: displayName.trim(),
      description: null,
      is_system: false,
    })
    .select()
    .single()
  if (error) throw error
  return data as Role
}

export async function renameRole(roleId: string, displayName: string): Promise<void> {
  const { error } = await supabase
    .from('roles')
    .update({ display_name: displayName.trim() })
    .eq('id', roleId)
  if (error) throw error
}

export async function countRoleAssignments(roleId: string): Promise<number> {
  const { count, error } = await supabase
    .from('user_roles')
    .select('*', { count: 'exact', head: true })
    .eq('role_id', roleId)
  if (error) throw error
  return count ?? 0
}

export async function deleteRole(roleId: string): Promise<void> {
  const { error: permsError } = await supabase
    .from('role_permissions')
    .delete()
    .eq('role_id', roleId)
  if (permsError) throw permsError
  const { error } = await supabase.from('roles').delete().eq('id', roleId)
  if (error) throw error
}

export async function setRolePermission(
  roleId: string,
  permissionId: string,
  granted: boolean,
): Promise<void> {
  if (granted) {
    const { error } = await supabase
      .from('role_permissions')
      .insert({ role_id: roleId, permission_id: permissionId })
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId)
      .eq('permission_id', permissionId)
    if (error) throw error
  }
}

export interface MyRole {
  id: string
  name: string
  restaurant_id: string | null
}

export async function fetchMyRoles(userId: string): Promise<MyRole[]> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role_id, roles:role_id (id, name, restaurant_id)')
    .eq('user_id', userId)
  if (error) throw error
  const roles: MyRole[] = []
  for (const row of (data ?? []) as unknown as Array<{
    roles: MyRole | MyRole[] | null
  }>) {
    const role = Array.isArray(row.roles) ? row.roles[0] : row.roles
    if (role) roles.push(role)
  }
  return roles
}
