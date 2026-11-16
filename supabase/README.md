# FoodX — Supabase

Database layer for FoodX (Phase 1: Foundation). One master codebase, one
separate database per restaurant — **not** multi-tenant SaaS. Row Level
Security below is a second layer of defence inside a single restaurant's
database.

## Files

| File | Purpose |
| --- | --- |
| `migrations/0001_foundation.sql` | Core tables, RLS, indexes, system roles + permissions seed |
| `seed.sql` | Demo data only — never run against production |

## Applying the migration

### Option A — Supabase CLI (recommended)

```bash
# from the repo root, once, to link the project:
supabase link --project-ref <your-project-ref>

# apply pending migrations:
supabase db push
```

New migrations go in `migrations/` as `NNNN_name.sql` and are applied in
filename order. Never edit `0001_foundation.sql` after it has been applied
to a shared database — add a new migration instead.

### Option B — Dashboard SQL editor

Open the Supabase Dashboard → SQL Editor → New query, paste the full
contents of `migrations/0001_foundation.sql`, and run it. Repeat for each
later migration, in order. (The SQL editor runs as `postgres`, which
bypasses RLS, so the seed inserts in the migration succeed.)

## RLS isolation model

- Every restaurant-scoped row carries a `restaurant_id`. A signed-in user
  may only read/write rows whose `restaurant_id` matches the
  `restaurant_id` on their own `profiles` row.
- The lookup is `public.current_restaurant_id()` — a `SECURITY DEFINER`,
  `STABLE` SQL function that reads `profiles` for `auth.uid()`. Because it
  runs as the function owner it bypasses RLS, so policies can call it
  without recursing into the `profiles` policy (policies never query
  `profiles` directly, and never query their own table).
- A user with no profile gets `NULL` from the helper, and every scoped
  policy then denies access.
- `profiles`: a user always sees their own row, plus other profiles of
  their own restaurant; they may only insert/update/delete their own row.
- `roles` with `restaurant_id IS NULL` are system default roles: readable
  by every authenticated user, writable by nobody through RLS (only
  `service_role` / migrations may change them). Restaurant-specific roles
  are scoped like any other table.
- `permissions` is a global lookup table: `SELECT` for authenticated
  users only; no write policy (service_role only).
- `role_permissions` / `user_roles` are scoped through the linked `role`
  (system role or own restaurant's role). `user_roles` has no `UPDATE`
  policy — change assignments by `INSERT`/`DELETE`.
- `audit_logs` is insert-only through RLS: authenticated users may
  `INSERT` (own restaurant, or `NULL` restaurant for system events) and
  `SELECT` their own restaurant's rows. There is no `UPDATE`/`DELETE`
  policy, so audit rows cannot be altered.
- `restaurants.INSERT` is open to any authenticated user (`WITH CHECK
  true`) as a bootstrap exception: a restaurant must be created *before*
  its creator has a profile pointing at it. `UPDATE`/`DELETE` require the
  row to be the caller's own restaurant.

## Seeded data (in the migration, idempotent)

- **12 system roles** (`restaurant_id NULL`, `is_system true`):
  `super_admin`, `restaurant_owner`, `branch_manager`, `admin`, `manager`,
  `accountant`, `cashier`, `waiter`, `kitchen_staff`,
  `inventory_manager`, `delivery_staff`, `receptionist`.
- **39 permissions** (`<module>.<action>`): orders 5, inventory 4,
  reports 2, staff 4, settings 2, tables 2, products 4, customers 4,
  purchases 3, expenses 4, kitchen 2, delivery 3.
- **No `role_permissions` are assigned in the migration** — assigning
  permissions to roles is runtime / admin-panel work.

## Demo seed (`seed.sql`)

Creates one demo restaurant (`FoodX Demo Restaurant`, slug `foodx-demo`),
one branch (`Main Branch`, `is_main true`), and its
`restaurant_settings` row, using fixed UUIDs so it is repeat-safe
(`ON CONFLICT DO NOTHING`). It creates **no auth users**.

Run it only against a local/development project, as `postgres` /
`service_role` (Dashboard SQL editor), after the migration:

```bash
supabase db reset   # applies migrations + seed.sql (local dev only)
# or paste seed.sql into the Dashboard SQL editor and run it
```

### Removing the demo data

Run these in order (children before parents), or simply delete the
restaurant — branches, settings, feature flags and audit logs cascade:

```sql
delete from public.restaurant_settings
 where restaurant_id = '11111111-1111-1111-1111-111111111111';
delete from public.branches
 where id = '22222222-2222-2222-2222-222222222222';
delete from public.restaurants
 where id = '11111111-1111-1111-1111-111111111111';
```

## Feature flags

`feature_flags` is per-restaurant (`UNIQUE (restaurant_id, flag_key)`).
Intended keys for later phases (created at restaurant provisioning time,
not seeded): `online_ordering`, `delivery`, `loyalty`, `accounting`,
`nfc`, `multi_branch`.
