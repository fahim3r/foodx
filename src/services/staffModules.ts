// FoodX — per-staff module access (user request 2026-11-19).
//
// When a staff login is created, the admin ticks which panel modules
// that person may open; the choice is stored on profiles.modules
// (migration 0032) by the manage-staff function. The sidebar then
// shows only those modules — on top of the role permissions, the
// restaurant's own module toggles and the vendor feature flags.
// profiles.modules = null means "no per-staff restriction" (every
// existing account), and admin-level users are never restricted, so
// an owner cannot lock themselves out.

export const STAFF_MODULE_KEYS = [
  'pos',
  'waiter',
  'orders',
  'kds',
  'serve',
  'display',
  'reservations',
  'menu',
  'inventory',
  'tables',
  'customers',
  'delivery',
  'business',
  'branches',
  'settings',
  'health',
  'staff',
  'roles',
] as const

export type StaffModuleKey = (typeof STAFF_MODULE_KEYS)[number]

export const ALL_STAFF_MODULES: StaffModuleKey[] = [...STAFF_MODULE_KEYS]

const WITHOUT_ROLES: StaffModuleKey[] = ALL_STAFF_MODULES.filter(
  (key) => key !== 'roles',
)

// Sensible starting sets per system role — the create form pre-ticks
// these and the admin adjusts before saving. Custom roles start
// unrestricted-by-default-list (all modules) for the same reason.
export const DEFAULT_MODULES_BY_ROLE: Record<string, StaffModuleKey[]> = {
  super_admin: ALL_STAFF_MODULES,
  restaurant_owner: ALL_STAFF_MODULES,
  admin: ALL_STAFF_MODULES,
  branch_manager: WITHOUT_ROLES,
  manager: [
    'pos', 'waiter', 'orders', 'kds', 'serve', 'display',
    'reservations', 'menu', 'inventory', 'tables', 'customers',
    'delivery', 'business', 'branches', 'health',
  ],
  accountant: ['business', 'orders', 'customers', 'inventory'],
  cashier: ['pos', 'orders', 'customers', 'tables'],
  waiter: ['waiter', 'orders', 'tables', 'kds', 'serve'],
  kitchen_staff: ['kds', 'serve', 'display', 'orders'],
  inventory_manager: ['inventory', 'menu', 'business'],
  delivery_staff: ['delivery', 'orders'],
  receptionist: ['reservations', 'tables', 'customers', 'orders'],
}

export function defaultModulesForRole(
  roleName: string | null | undefined,
): StaffModuleKey[] {
  if (!roleName) return [...ALL_STAFF_MODULES]
  return [...(DEFAULT_MODULES_BY_ROLE[roleName] ?? ALL_STAFF_MODULES)]
}
