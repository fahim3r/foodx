-- ============================================================================
-- FoodX — Phase 1 (Foundation)
-- Migration 0001: core tables, RLS isolation, default roles & permissions
-- ============================================================================
-- ISOLATION MODEL
--   FoodX is NOT multi-tenant SaaS: one master codebase, one separate
--   database per restaurant. RLS is a second layer of defence inside that
--   database: every restaurant-scoped row carries a restaurant_id, and a
--   signed-in user may only touch rows whose restaurant_id matches the
--   restaurant_id on their own profile (profiles.restaurant_id).
--
--   To avoid infinite recursion (a policy on profiles must never query
--   profiles through RLS), the lookup is done by the SECURITY DEFINER
--   helper public.current_restaurant_id(), which bypasses RLS when it
--   reads profiles. Policies on other tables call the helper; they never
--   query profiles directly and never query their own table.
--
--   Exceptions / bootstrap notes:
--   - roles with restaurant_id IS NULL are system default roles: readable
--     by every authenticated user, writable by nobody through RLS
--     (only service_role / migrations may change them).
--   - permissions is a global lookup table: SELECT for authenticated
--     users only; no INSERT/UPDATE/DELETE policy (service_role only).
--   - restaurants INSERT is open to any authenticated user (WITH CHECK
--     true) because a restaurant must be created BEFORE the creator has
--     a profile pointing at it. UPDATE/DELETE require the row to be the
--     caller's own restaurant.
--   - audit_logs is insert-only for normal use: authenticated users may
--     INSERT (own restaurant, or NULL restaurant for system events) and
--     SELECT their own restaurant's rows. No UPDATE/DELETE policy.
--   - If a user has no profile yet, current_restaurant_id() returns NULL
--     and every restaurant-scoped policy evaluates to NULL (deny).
--
--   Requires Postgres 13+ (gen_random_uuid() is built-in; no extension
--   needed). Assumes the Supabase auth schema (auth.users) exists.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- NOTE: public.current_restaurant_id() is defined AFTER the tables below
-- (a LANGUAGE sql function is parsed at creation time, so profiles must
-- exist first). See the "Helper" section just before Row Level Security.

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists public.restaurants (
  id               uuid        primary key default gen_random_uuid(),
  name             text        not null,
  slug             text        not null unique,
  default_currency text        not null default 'BDT',
  timezone         text        not null default 'Asia/Dhaka',
  status           text        not null default 'active',
  license_id       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.branches (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants (id) on delete cascade,
  name          text        not null,
  code          text,
  address       text,
  phone         text,
  is_main       boolean     not null default false,
  status        text        not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.profiles (
  id            uuid        primary key references auth.users (id) on delete cascade,
  restaurant_id uuid        references public.restaurants (id) on delete set null,
  branch_id     uuid        references public.branches (id) on delete set null,
  full_name     text,
  phone         text,
  avatar_url    text,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.roles (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        references public.restaurants (id) on delete cascade,
  name          text        not null,
  display_name  text,
  description   text,
  is_system     boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- NULL restaurant_id means "system default role": one NULL per role name.
-- A plain UNIQUE (restaurant_id, name) would allow duplicate NULL rows,
-- so uniqueness is enforced with COALESCE to the nil UUID.
create unique index if not exists roles_restaurant_name_unique
  on public.roles (coalesce(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

create table if not exists public.permissions (
  id          uuid        primary key default gen_random_uuid(),
  key         text        not null unique,
  module      text        not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id       uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists public.user_roles (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role_id   uuid not null references public.roles (id) on delete cascade,
  branch_id uuid references public.branches (id) on delete set null,
  primary key (user_id, role_id)
);

create table if not exists public.restaurant_settings (
  id                   uuid         primary key default gen_random_uuid(),
  restaurant_id        uuid         not null unique references public.restaurants (id) on delete cascade,
  branding_name        text,
  logo_url             text,
  favicon_url          text,
  primary_color        text         not null default '#ea580c',
  secondary_color      text         not null default '#16a34a',
  currency             text         not null default 'BDT',
  tax_rate             numeric(5,2) not null default 0,
  service_charge_rate  numeric(5,2) not null default 0,
  receipt_footer       text,
  created_at           timestamptz  not null default now(),
  updated_at           timestamptz  not null default now()
);

create table if not exists public.feature_flags (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants (id) on delete cascade,
  flag_key      text        not null,
  enabled       boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, flag_key)
);
-- Intended flag_key values for later phases (not seeded here — flags are
-- per-restaurant, so they are created at restaurant provisioning time):
--   online_ordering, delivery, loyalty, accounting, nfc, multi_branch

create table if not exists public.audit_logs (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        references public.restaurants (id) on delete cascade,
  user_id       uuid,
  action        text        not null,
  entity        text,
  entity_id     text,
  before_data   jsonb,
  after_data    jsonb,
  ip_address    text,
  created_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- updated_at triggers (all tables that have an updated_at column)
-- ----------------------------------------------------------------------------
drop trigger if exists trg_restaurants_updated_at on public.restaurants;
create trigger trg_restaurants_updated_at
  before update on public.restaurants
  for each row execute function public.set_updated_at();

drop trigger if exists trg_branches_updated_at on public.branches;
create trigger trg_branches_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_roles_updated_at on public.roles;
create trigger trg_roles_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_permissions_updated_at on public.permissions;
create trigger trg_permissions_updated_at
  before update on public.permissions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_restaurant_settings_updated_at on public.restaurant_settings;
create trigger trg_restaurant_settings_updated_at
  before update on public.restaurant_settings
  for each row execute function public.set_updated_at();

drop trigger if exists trg_feature_flags_updated_at on public.feature_flags;
create trigger trg_feature_flags_updated_at
  before update on public.feature_flags
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: the caller's restaurant (SECURITY DEFINER, bypasses RLS)
-- ----------------------------------------------------------------------------
-- STABLE, reads only profiles for auth.uid(). Because it runs as the
-- function owner it is not subject to the profiles RLS policies, so
-- calling it from a policy cannot recurse.
create or replace function public.current_restaurant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select restaurant_id
  from public.profiles
  where id = auth.uid()
  limit 1;
$$;

grant execute on function public.current_restaurant_id() to authenticated;
revoke execute on function public.current_restaurant_id() from anon;

alter table public.restaurants         enable row level security;
alter table public.branches            enable row level security;
alter table public.profiles            enable row level security;
alter table public.roles               enable row level security;
alter table public.permissions         enable row level security;
alter table public.role_permissions    enable row level security;
alter table public.user_roles          enable row level security;
alter table public.restaurant_settings enable row level security;
alter table public.feature_flags       enable row level security;
alter table public.audit_logs          enable row level security;

-- --- restaurants -------------------------------------------------------------
-- SELECT/UPDATE/DELETE: only the caller's own restaurant.
-- INSERT: any authenticated user (bootstrap — see header comment).
drop policy if exists restaurants_select on public.restaurants;
create policy restaurants_select on public.restaurants
  for select to authenticated
  using (id = public.current_restaurant_id());

drop policy if exists restaurants_insert on public.restaurants;
create policy restaurants_insert on public.restaurants
  for insert to authenticated
  with check (true);

drop policy if exists restaurants_update on public.restaurants;
create policy restaurants_update on public.restaurants
  for update to authenticated
  using (id = public.current_restaurant_id())
  with check (id = public.current_restaurant_id());

drop policy if exists restaurants_delete on public.restaurants;
create policy restaurants_delete on public.restaurants
  for delete to authenticated
  using (id = public.current_restaurant_id());

-- --- branches ----------------------------------------------------------------
drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists branches_insert on public.branches;
create policy branches_insert on public.branches
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists branches_update on public.branches;
create policy branches_update on public.branches
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists branches_delete on public.branches;
create policy branches_delete on public.branches
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- profiles ----------------------------------------------------------------
-- A user always sees their own row; they also see other profiles of their
-- own restaurant (via the SECURITY DEFINER helper — no self-query, so no
-- recursion). A user may create/update/delete only their own row.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or restaurant_id = public.current_restaurant_id());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (id = auth.uid());

-- --- roles -------------------------------------------------------------------
-- SELECT: system roles (restaurant_id IS NULL) + the caller's own
-- restaurant's roles. INSERT/UPDATE/DELETE: own restaurant only, and
-- never a system role (WITH CHECK restaurant_id = current... excludes
-- NULL, so system roles cannot be created or edited through RLS).
drop policy if exists roles_select on public.roles;
create policy roles_select on public.roles
  for select to authenticated
  using (restaurant_id is null or restaurant_id = public.current_restaurant_id());

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- permissions -------------------------------------------------------------
-- Global lookup table: readable by all authenticated users, writable only
-- by service_role / migrations (no INSERT/UPDATE/DELETE policy).
drop policy if exists permissions_select on public.permissions;
create policy permissions_select on public.permissions
  for select to authenticated
  using (true);

-- --- role_permissions --------------------------------------------------------
-- Scoped through the role: the linked role must be a system role or one
-- of the caller's own restaurant's roles. Querying roles here is safe:
-- the roles policies use only the helper, never role_permissions.
drop policy if exists role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions
  for select to authenticated
  using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and (r.restaurant_id is null or r.restaurant_id = public.current_restaurant_id())
    )
  );

drop policy if exists role_permissions_insert on public.role_permissions;
create policy role_permissions_insert on public.role_permissions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists role_permissions_delete on public.role_permissions;
create policy role_permissions_delete on public.role_permissions
  for delete to authenticated
  using (
    exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.restaurant_id = public.current_restaurant_id()
    )
  );

-- --- user_roles --------------------------------------------------------------
-- A user sees their own assignments; assignments are otherwise scoped
-- through the role (system role or own restaurant's role). INSERT/DELETE
-- only for the caller's own restaurant's roles. (No UPDATE policy:
-- assignments are changed by INSERT/DELETE.)
drop policy if exists user_roles_select on public.user_roles;
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.roles r
      where r.id = user_roles.role_id
        and (r.restaurant_id is null or r.restaurant_id = public.current_restaurant_id())
    )
  );

drop policy if exists user_roles_insert on public.user_roles;
create policy user_roles_insert on public.user_roles
  for insert to authenticated
  with check (
    exists (
      select 1 from public.roles r
      where r.id = user_roles.role_id
        and r.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists user_roles_delete on public.user_roles;
create policy user_roles_delete on public.user_roles
  for delete to authenticated
  using (
    exists (
      select 1 from public.roles r
      where r.id = user_roles.role_id
        and r.restaurant_id = public.current_restaurant_id()
    )
  );

-- --- restaurant_settings -----------------------------------------------------
drop policy if exists restaurant_settings_select on public.restaurant_settings;
create policy restaurant_settings_select on public.restaurant_settings
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists restaurant_settings_insert on public.restaurant_settings;
create policy restaurant_settings_insert on public.restaurant_settings
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists restaurant_settings_update on public.restaurant_settings;
create policy restaurant_settings_update on public.restaurant_settings
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists restaurant_settings_delete on public.restaurant_settings;
create policy restaurant_settings_delete on public.restaurant_settings
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- feature_flags -----------------------------------------------------------
drop policy if exists feature_flags_select on public.feature_flags;
create policy feature_flags_select on public.feature_flags
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists feature_flags_insert on public.feature_flags;
create policy feature_flags_insert on public.feature_flags
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists feature_flags_update on public.feature_flags;
create policy feature_flags_update on public.feature_flags
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists feature_flags_delete on public.feature_flags;
create policy feature_flags_delete on public.feature_flags
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- audit_logs --------------------------------------------------------------
-- Insert-only for authenticated users (own restaurant, or NULL for system
-- events); readable within the caller's own restaurant. No UPDATE/DELETE
-- policy, so audit rows cannot be altered through RLS.
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists audit_logs_insert on public.audit_logs;
create policy audit_logs_insert on public.audit_logs
  for insert to authenticated
  with check (restaurant_id is null or restaurant_id = public.current_restaurant_id());

-- ============================================================================
-- Indexes
-- ============================================================================
create index if not exists idx_branches_restaurant_id
  on public.branches (restaurant_id);

create index if not exists idx_profiles_restaurant_id
  on public.profiles (restaurant_id);

create index if not exists idx_profiles_branch_id
  on public.profiles (branch_id);

create index if not exists idx_roles_restaurant_id
  on public.roles (restaurant_id);

create index if not exists idx_role_permissions_role_id
  on public.role_permissions (role_id);

create index if not exists idx_role_permissions_permission_id
  on public.role_permissions (permission_id);

create index if not exists idx_user_roles_user_id
  on public.user_roles (user_id);

create index if not exists idx_user_roles_role_id
  on public.user_roles (role_id);

create index if not exists idx_restaurant_settings_restaurant_id
  on public.restaurant_settings (restaurant_id);

create index if not exists idx_feature_flags_restaurant_id
  on public.feature_flags (restaurant_id);

create index if not exists idx_feature_flags_restaurant_flag
  on public.feature_flags (restaurant_id, flag_key);

create index if not exists idx_audit_logs_restaurant_id
  on public.audit_logs (restaurant_id);

create index if not exists idx_audit_logs_restaurant_created
  on public.audit_logs (restaurant_id, created_at desc);

create index if not exists idx_audit_logs_user_id
  on public.audit_logs (user_id);

-- ============================================================================
-- Seed data (idempotent — safe to re-run)
-- ============================================================================

-- 12 system default roles (restaurant_id NULL, is_system true).
-- NOTE: role_permissions are NOT assigned here; that is runtime/admin work.
insert into public.roles (restaurant_id, name, display_name, is_system)
values
  (null, 'super_admin',       'Super Admin',       true),
  (null, 'restaurant_owner',  'Restaurant Owner',  true),
  (null, 'branch_manager',    'Branch Manager',    true),
  (null, 'admin',             'Admin',             true),
  (null, 'manager',           'Manager',           true),
  (null, 'accountant',        'Accountant',        true),
  (null, 'cashier',           'Cashier',           true),
  (null, 'waiter',            'Waiter',            true),
  (null, 'kitchen_staff',     'Kitchen Staff',     true),
  (null, 'inventory_manager', 'Inventory Manager', true),
  (null, 'delivery_staff',    'Delivery Staff',    true),
  (null, 'receptionist',      'Receptionist',      true)
on conflict do nothing;
-- The unique index on (COALESCE(restaurant_id, nil-uuid), name) makes the
-- bare ON CONFLICT DO NOTHING above match on re-runs. If this migration is
-- ever applied to a database that already has these rows under a plain
-- unique constraint instead, re-running would raise a duplicate-key error
-- rather than skipping; in that case delete the duplicate rows first.

-- 39 granular permissions, grouped by module.
insert into public.permissions (key, module, description)
values
  ('orders.view',     'orders',    'View orders'),
  ('orders.create',   'orders',    'Create orders'),
  ('orders.edit',     'orders',    'Edit orders'),
  ('orders.cancel',   'orders',    'Cancel orders'),
  ('orders.refund',   'orders',    'Refund orders'),
  ('inventory.view',    'inventory', 'View inventory'),
  ('inventory.adjust',  'inventory', 'Adjust stock levels'),
  ('inventory.purchase','inventory', 'Create purchase orders'),
  ('inventory.transfer','inventory', 'Transfer stock between branches'),
  ('reports.view',    'reports',   'View reports'),
  ('reports.export',  'reports',   'Export reports'),
  ('staff.view',      'staff',     'View staff'),
  ('staff.create',    'staff',     'Add staff'),
  ('staff.edit',      'staff',     'Edit staff'),
  ('staff.delete',    'staff',     'Delete staff'),
  ('settings.view',   'settings',  'View settings'),
  ('settings.manage', 'settings',  'Manage settings'),
  ('tables.view',     'tables',    'View tables'),
  ('tables.manage',   'tables',    'Manage tables'),
  ('products.view',   'products',  'View products'),
  ('products.create', 'products',  'Create products'),
  ('products.edit',   'products',  'Edit products'),
  ('products.delete', 'products',  'Delete products'),
  ('customers.view',   'customers', 'View customers'),
  ('customers.create', 'customers', 'Create customers'),
  ('customers.edit',   'customers', 'Edit customers'),
  ('customers.delete', 'customers', 'Delete customers'),
  ('purchases.view',   'purchases', 'View purchases'),
  ('purchases.create', 'purchases', 'Create purchases'),
  ('purchases.edit',   'purchases', 'Edit purchases'),
  ('expenses.view',    'expenses',  'View expenses'),
  ('expenses.create',  'expenses',  'Create expenses'),
  ('expenses.edit',    'expenses',  'Edit expenses'),
  ('expenses.delete',  'expenses',  'Delete expenses'),
  ('kitchen.view',     'kitchen',   'View kitchen display'),
  ('kitchen.manage',   'kitchen',   'Manage kitchen display'),
  ('delivery.view',    'delivery',  'View deliveries'),
  ('delivery.manage',  'delivery',  'Manage deliveries'),
  ('delivery.assign',  'delivery',  'Assign deliveries')
on conflict (key) do nothing;
