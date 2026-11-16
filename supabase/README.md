# FoodX — Supabase

Database layer for FoodX (Phase 1: Foundation; Phase 2: Core Restaurant;
Phase 3: Inventory). One master codebase, one separate database per
restaurant — **not** multi-tenant SaaS. Row Level Security below is a
second layer of defence inside a single restaurant's database.

## Files

| File | Purpose |
| --- | --- |
| `migrations/0001_foundation.sql` | Core tables, RLS, indexes, system roles + permissions seed |
| `migrations/0002_core.sql` | Menu, tables, orders, payments, kitchen display |
| `migrations/0003_inventory.sql` | Stock, recipes, suppliers, purchases, movements |
| `seed.sql` | Demo data only — never run against production |
| `seed_phase2.sql` | Demo menu + tables for the demo restaurant only — never run against production |
| `seed_phase3.sql` | Demo stock, recipes + supplier for the demo restaurant only — never run against production |

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
later migration, in order — `migrations/0002_core.sql` and
`migrations/0003_inventory.sql` are applied the same way. (The SQL editor
runs as `postgres`, which bypasses RLS, so the seed inserts in the
migration succeed.)

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
- Phase 2 child rows are scoped through their parent: `product_variants`
  and `product_modifiers` through the product's restaurant;
  `order_items`, `order_payments`, and `order_status_history` through
  the order's restaurant; `order_item_modifiers` through the order
  item's order.
- Financial history is never hard-deleted: there is **no DELETE policy**
  on `orders`, `order_items`, `order_payments`, or
  `order_status_history`. `order_items` may only be UPDATED while the
  parent order is `DRAFT`. `order_payments` and `order_status_history`
  are append-only (no `UPDATE` policy either).
- Stock history is never hard-deleted either: `stock_movements` has **no
  INSERT / UPDATE / DELETE policy at all** — rows are created only by
  the SECURITY DEFINER functions `apply_stock_movement()` and
  `deduct_stock_for_order()`. Stock quantities change only through
  movements; the app never updates `inventory_items.current_quantity`
  directly. A sale is never blocked for stock reasons — deduction may
  take stock negative, and negatives are highlighted in the stock list.
  Receiving a purchase order is full receipt only; partial receiving is
  not implemented. Cancelling an order does not restock ingredients
  (not implemented).
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

## Demo seed — Phase 2 (`seed_phase2.sql`)

Adds a demo menu and tables for the demo restaurant only (fixed UUIDs,
repeat-safe): 2 kitchen stations, 3 categories, 8 products, 5 variants,
3 modifiers, 6 tables (T1–T6). It creates **no orders or payments**.
Run it only against a local/development project, as `postgres` /
`service_role`, after `seed.sql`. Removal SQL is in the file header;
deleting the demo restaurant cascades everything.

## Demo seed — Phase 3 (`seed_phase3.sql`)

Adds demo stock for the demo restaurant only (fixed UUIDs, repeat-safe):
9 inventory items, 15 recipe lines for 6 demo products, 1 supplier
(Dhaka Fresh Foods). It creates **no stock movements or purchase
orders** — the seeded quantities are opening stock, not movements. Run
it only against a local/development project, as `postgres` /
`service_role`, after `seed.sql` and `seed_phase2.sql`. Removal SQL is
in the file header; deleting the demo restaurant cascades everything.

## Feature flags

`feature_flags` is per-restaurant (`UNIQUE (restaurant_id, flag_key)`).
Intended keys for later phases (created at restaurant provisioning time,
not seeded): `online_ordering`, `delivery`, `loyalty`, `accounting`,
`nfc`, `multi_branch`.
