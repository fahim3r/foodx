# FoodX — Database

Phase 1 (Foundation) + Phase 2 (Core Restaurant). Schema source of
truth: `supabase/migrations/0001_foundation.sql` and
`supabase/migrations/0002_core.sql`. A shorter guide also lives in
[`supabase/README.md`](supabase/README.md). If this document and a
migration disagree, the migration wins.

One master codebase, **one separate database per restaurant** — not
multi-tenant SaaS. Each restaurant gets its own Supabase project; Row
Level Security below is a second layer of defence *inside* one
restaurant's database. See [ARCHITECTURE.md](ARCHITECTURE.md#1-deployment-model-one-database-per-restaurant).

> **Current state:** migration `0001_foundation.sql` **has been applied**
> to the live Supabase project (`foodx`, Singapore). Migration
> `0002_core.sql` has **not yet been applied** — until it is, the menu /
> tables / POS / orders / kitchen pages show "Database setup is pending"
> notices and their tables do not exist there. Apply it via the Dashboard
> SQL editor (see [README.md](README.md#database-setup)).

## Schema overview

22 tables. All ids are `uuid` (`gen_random_uuid()`), all tables have
`created_at timestamptz not null default now()`, and every table except
`permissions`, `role_permissions`, `user_roles`, `audit_logs`,
`product_modifiers`, `order_payments`, and `order_status_history` has an
`updated_at` maintained by the `set_updated_at()` trigger.

```
restaurants 1──* branches
restaurants 1──* profiles
restaurants 1──* roles
restaurants 1──1 restaurant_settings
restaurants 1──* feature_flags
restaurants 1──* audit_logs
profiles    1──* user_roles *──1 roles
roles       1──* role_permissions *──1 permissions (global lookup)
profiles    *──1 branches (branch_id, optional)
user_roles  *──1 branches (branch_id, optional, per-assignment scope)
restaurants 1──* kitchen_stations
restaurants 1──* categories 1──* products
restaurants 1──* modifiers *──* products (product_modifiers)
products    1──* product_variants
restaurants 1──* tables
restaurants 1──* orders 1──* order_items 1──* order_item_modifiers
orders      1──* order_payments
orders      1──* order_status_history
```

### `restaurants`

One row per restaurant deployment. The root of everything.

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK, `gen_random_uuid()` | |
| `name` | `text` NOT NULL | Display name, e.g. "FoodX Demo Restaurant" |
| `slug` | `text` NOT NULL UNIQUE | URL-safe identifier, auto-derived from the name in the Settings form (`slugify`); must be unique across the database |
| `default_currency` | `text` NOT NULL DEFAULT `'BDT'` | |
| `timezone` | `text` NOT NULL DEFAULT `'Asia/Dhaka'` | |
| `status` | `text` NOT NULL DEFAULT `'active'` | Free-form status string; no check constraint yet |
| `license_id` | `text` NULL | Reserved for the licensing model; **not set or used by the app in Phase 1** |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` via trigger |

### `branches`

Physical locations of a restaurant. Multi-branch support is later-phase
work — in Phase 1 the table exists but **no UI or service touches it**.

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `restaurant_id` | `uuid` NOT NULL → `restaurants(id)` ON DELETE CASCADE | |
| `name` | `text` NOT NULL | |
| `code` | `text` NULL | Short branch code, e.g. `MAIN` |
| `address` | `text` NULL | |
| `phone` | `text` NULL | |
| `is_main` | `boolean` NOT NULL DEFAULT `false` | Exactly one main branch per restaurant is the convention; **not enforced by a constraint** |
| `status` | `text` NOT NULL DEFAULT `'active'` | |
| `created_at` / `updated_at` | `timestamptz` | |

### `profiles`

One row per user, keyed to the auth account. This is the row RLS pivots
on: `profiles.restaurant_id` decides which restaurant a user belongs to.

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK → `auth.users(id)` ON DELETE CASCADE | Same id as the Supabase Auth user |
| `restaurant_id` | `uuid` NULL → `restaurants(id)` ON DELETE SET NULL | NULL until the user completes restaurant setup |
| `branch_id` | `uuid` NULL → `branches(id)` ON DELETE SET NULL | Optional branch assignment |
| `full_name` | `text` NULL | From sign-up (`user_metadata.full_name`) or setup |
| `phone` | `text` NULL | Not collected by the UI in Phase 1 |
| `avatar_url` | `text` NULL | Not collected by the UI in Phase 1 |
| `is_active` | `boolean` NOT NULL DEFAULT `true` | Deactivation flag; **not enforced anywhere in Phase 1** |
| `created_at` / `updated_at` | `timestamptz` | |

**No trigger creates a profile on signup.** The app creates it with an
upsert (`linkProfileToRestaurant`) when the user completes restaurant
setup on the Settings page. A signed-in user without a profile sees a
"no profile" notice in the layout. If a profile-creation trigger is
added later, keep the upsert path working — Settings setup relies on it.

### `roles`

System default roles (`restaurant_id IS NULL`, `is_system = true`) plus
restaurant-specific roles.

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `restaurant_id` | `uuid` NULL → `restaurants(id)` ON DELETE CASCADE | NULL = system default role, visible to every restaurant |
| `name` | `text` NOT NULL | Machine key, e.g. `cashier` |
| `display_name` | `text` NULL | Human label, e.g. "Cashier" |
| `description` | `text` NULL | |
| `is_system` | `boolean` NOT NULL DEFAULT `false` | True for the 12 seeded roles |
| `created_at` / `updated_at` | `timestamptz` | |

Uniqueness: `(restaurant_id, name)` — but a plain unique constraint
allows duplicate NULLs, so the migration enforces it with a unique index
on `(coalesce(restaurant_id, '00000000-0000-0000-0000-000000000000'::uuid), name)`.
One NULL per system role name.

### `permissions`

Global lookup table of granular permission keys. **Not restaurant-scoped.**

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `key` | `text` NOT NULL UNIQUE | `<module>.<action>`, e.g. `orders.create` |
| `module` | `text` NOT NULL | Grouping for the Roles matrix, e.g. `orders` |
| `description` | `text` NULL | |
| `created_at` / `updated_at` | `timestamptz` | |

39 permissions are seeded by the migration (see
[Roles and permissions](#roles-and-permissions)). No write policy exists
— only `service_role` / migrations may change this table.

### `role_permissions`

Join table: which permissions a role grants. **Seeded empty** — the
migration assigns no permissions to any role. The Roles page therefore
shows an all-dash matrix until assignments are made (later-phase admin
work). No `updated_at` column.

| Column | Notes |
| --- | --- |
| `role_id` | `uuid` NOT NULL → `roles(id)` ON DELETE CASCADE |
| `permission_id` | `uuid` NOT NULL → `permissions(id)` ON DELETE CASCADE |
| PK | `(role_id, permission_id)` |

### `user_roles`

Join table: which roles a user holds, optionally scoped to a branch.

| Column | Notes |
| --- | --- |
| `user_id` | `uuid` NOT NULL → `profiles(id)` ON DELETE CASCADE |
| `role_id` | `uuid` NOT NULL → `roles(id)` ON DELETE CASCADE |
| `branch_id` | `uuid` NULL → `branches(id)` ON DELETE SET NULL — role applies only at this branch when set |
| PK | `(user_id, role_id)` — note: a user cannot hold the same role at two different branches under this key; that is a known Phase 1 limitation |

No `UPDATE` policy exists on this table: change assignments by
INSERT / DELETE.

### `restaurant_settings`

One row per restaurant (`restaurant_id` UNIQUE). Holds branding, currency,
and charge configuration edited on the Settings page.

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `restaurant_id` | `uuid` NOT NULL UNIQUE → `restaurants(id)` ON DELETE CASCADE | |
| `branding_name` | `text` NULL | Display name; falls back to `restaurants.name` |
| `logo_url` | `text` NULL | Shown in the sidebar when set |
| `favicon_url` | `text` NULL | **Exists in the schema but the Settings form does not edit it in Phase 1** |
| `primary_color` | `text` NOT NULL DEFAULT `'#ea580c'` | Applied as CSS variables (`--primary`, `--ring`) |
| `secondary_color` | `text` NOT NULL DEFAULT `'#16a34a'` | Stored; used by the Settings preview, not yet by the layout |
| `currency` | `text` NOT NULL DEFAULT `'BDT'` | Mirrors `restaurants.default_currency`; the Settings form writes both |
| `tax_rate` | `numeric(5,2)` NOT NULL DEFAULT `0` | Percent, 0–100 in the form |
| `service_charge_rate` | `numeric(5,2)` NOT NULL DEFAULT `0` | Percent, 0–100 in the form |
| `receipt_footer` | `text` NULL | Printed at the bottom of receipts (no receipts exist yet) |
| `created_at` / `updated_at` | `timestamptz` | |

### `feature_flags`

Per-restaurant feature toggles for later phases. **Nothing reads or
writes this table in Phase 1.**

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `restaurant_id` | `uuid` NOT NULL → `restaurants(id)` ON DELETE CASCADE | |
| `flag_key` | `text` NOT NULL | Intended keys (not seeded): `online_ordering`, `delivery`, `loyalty`, `accounting`, `nfc`, `multi_branch` |
| `enabled` | `boolean` NOT NULL DEFAULT `false` | |
| `created_at` / `updated_at` | `timestamptz` | |
| UNIQUE | `(restaurant_id, flag_key)` | One row per flag per restaurant |

Flags are created at restaurant provisioning time, not by the migration.

### `audit_logs`

Append-only audit trail. **Nothing writes to this table in Phase 1** —
the first audited action must add its log call with the action, not after.

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `restaurant_id` | `uuid` NULL → `restaurants(id)` ON DELETE CASCADE | NULL allowed for system events |
| `user_id` | `uuid` NULL | Actor; no FK (the user may be deleted) |
| `action` | `text` NOT NULL | e.g. `order.voided` — agree the vocabulary when the first writer lands |
| `entity` | `text` NULL | e.g. `orders` |
| `entity_id` | `text` NULL | Id of the affected row, as text |
| `before_data` / `after_data` | `jsonb` NULL | State snapshots for the change |
| `ip_address` | `text` NULL | |
| `created_at` | `timestamptz` NOT NULL DEFAULT `now()` | No `updated_at` — rows are never updated |

No UPDATE or DELETE policy exists: audit rows cannot be altered through
RLS. There is intentionally **no trigger-based auditing** in Phase 1;
audit entries are written explicitly by application code.

## Phase 2 tables (Core Restaurant)

Source of truth: `supabase/migrations/0002_core.sql`.

### `kitchen_stations`

Where an order item is prepared (e.g. "Main Kitchen", "Drinks Station").
Products point at a station; the KDS groups live orders by station.

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `restaurant_id` | `uuid` NOT NULL → `restaurants(id)` ON DELETE CASCADE | |
| `name` | `text` NOT NULL | |
| `sort_order` | `integer` NOT NULL DEFAULT `0` | KDS shows stations in this order |
| `is_active` | `boolean` NOT NULL DEFAULT `true` | |
| `created_at` / `updated_at` | `timestamptz` | |

### `categories`

Menu categories (e.g. Starters, Main Course, Drinks).

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `restaurant_id` | `uuid` NOT NULL → `restaurants(id)` ON DELETE CASCADE | |
| `name` | `text` NOT NULL | |
| `name_bn` | `text` NULL | Bangla name, shown when the UI language is Bangla |
| `sort_order` | `integer` NOT NULL DEFAULT `0` | |
| `is_active` | `boolean` NOT NULL DEFAULT `true` | Inactive categories are hidden from the POS |
| `created_at` / `updated_at` | `timestamptz` | |

### `modifiers`

Paid or free add-ons offered on products (e.g. Extra Cheese ৳40).

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `restaurant_id` | `uuid` NOT NULL → `restaurants(id)` ON DELETE CASCADE | |
| `name` | `text` NOT NULL | |
| `name_bn` | `text` NULL | |
| `price` | `numeric(12,2)` NOT NULL DEFAULT `0`, CHECK `price >= 0` | Added per unit on the order line |
| `is_active` | `boolean` NOT NULL DEFAULT `true` | |
| `created_at` / `updated_at` | `timestamptz` | |

### `products`

Sellable items. Prices are the source the POS re-reads at order time —
the client never decides what an order costs.

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `restaurant_id` | `uuid` NOT NULL → `restaurants(id)` ON DELETE CASCADE | |
| `category_id` | `uuid` NULL → `categories(id)` ON DELETE SET NULL | NULL = uncategorised |
| `kitchen_station_id` | `uuid` NULL → `kitchen_stations(id)` ON DELETE SET NULL | NULL = unassigned on the KDS |
| `name` | `text` NOT NULL | |
| `name_bn` | `text` NULL | |
| `description` | `text` NULL | |
| `price` | `numeric(12,2)` NOT NULL DEFAULT `0`, CHECK `price >= 0` | Base price, before variant adjustment |
| `image_url` | `text` NULL | |
| `is_available` | `boolean` NOT NULL DEFAULT `true` | Unavailable products cannot be ordered (the POS refuses them) |
| `sort_order` | `integer` NOT NULL DEFAULT `0` | |
| `created_at` / `updated_at` | `timestamptz` | |

### `product_variants`

Size/option variants of a product (e.g. Grilled Chicken Quarter/Half/
Full). `price_adjustment` is added to the product price, per unit.

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `product_id` | `uuid` NOT NULL → `products(id)` ON DELETE CASCADE | |
| `name` | `text` NOT NULL | |
| `price_adjustment` | `numeric(12,2)` NOT NULL DEFAULT `0` | May be negative (a smaller size) |
| `sort_order` | `integer` NOT NULL DEFAULT `0` | |
| `is_active` | `boolean` NOT NULL DEFAULT `true` | |
| `created_at` / `updated_at` | `timestamptz` | |

### `product_modifiers`

Junction: which modifiers a product offers. PK `(product_id, modifier_id)`.

### `tables`

Dine-in tables. `status` is kept in sync by the order flow: occupied
when an order is placed for the table, available again when the order
reaches a terminal status and no other active order uses the table.

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `restaurant_id` | `uuid` NOT NULL → `restaurants(id)` ON DELETE CASCADE | |
| `branch_id` | `uuid` NULL → `branches(id)` ON DELETE SET NULL | |
| `name` | `text` NOT NULL | UNIQUE per restaurant — e.g. `T1` |
| `seats` | `integer` NOT NULL DEFAULT `4`, CHECK `seats > 0` | |
| `status` | `text` NOT NULL DEFAULT `'available'`, CHECK in `available / occupied / reserved / cleaning` | |
| `qr_code` | `text` NULL | The table's QR value (e.g. `addabuzz-t1`); a QR *image* is not generated yet |
| `created_at` / `updated_at` | `timestamptz` | |

A table cannot be deleted while it has an active order — the service
refuses it (`table_has_active_orders`); the database does not enforce
this, the service does.

### `orders`

One row per order. Money columns are `numeric(12,2)`; totals are
computed by the service from database prices, never from client values.

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | Client-generated (idempotency — see below) |
| `restaurant_id` | `uuid` NOT NULL → `restaurants(id)` ON DELETE CASCADE | |
| `branch_id` | `uuid` NULL → `branches(id)` ON DELETE SET NULL | Default branch = the main branch |
| `table_id` | `uuid` NULL → `tables(id)` ON DELETE SET NULL | NULL for takeaway/delivery |
| `order_number` | `integer` NOT NULL | Sequential per restaurant; UNIQUE `(restaurant_id, order_number)` |
| `type` | `text` NOT NULL DEFAULT `'dine_in'`, CHECK in `dine_in / takeaway / delivery` | |
| `status` | `text` NOT NULL DEFAULT `'DRAFT'`, CHECK in the 9 valid statuses (see state machine) | |
| `subtotal` | `numeric(12,2)` NOT NULL DEFAULT `0` | Sum of line totals, before discount |
| `discount_amount` | `numeric(12,2)` NOT NULL DEFAULT `0` | Flat discount, capped at the subtotal |
| `tax_amount` | `numeric(12,2)` NOT NULL DEFAULT `0` | On (subtotal − discount), at the settings tax rate |
| `service_charge_amount` | `numeric(12,2)` NOT NULL DEFAULT `0` | On (subtotal − discount), at the settings service-charge rate |
| `total_amount` | `numeric(12,2)` NOT NULL DEFAULT `0` | (subtotal − discount) + tax + service charge |
| `notes` | `text` NULL | Kitchen notes from the POS |
| `created_by` | `uuid` NULL | Actor; no FK (the user may be deleted) |
| `created_at` / `updated_at` | `timestamptz` | |

### Order state machine

```
DRAFT → CONFIRMED → SENT_TO_KITCHEN → PREPARING → READY → SERVED → COMPLETED
CANCELLED from any non-terminal status (DRAFT … SERVED)
REFUNDED from COMPLETED only
```

- The `status` CHECK constraint restricts the column to the 9 valid
  values. Allowed *transitions* are enforced in the service layer
  (`ORDER_TRANSITIONS` in `src/types/index.ts`, checked by
  `advanceOrderStatus` in `src/services/orders.ts`) — the database does
  not have a transition trigger.
- Every transition writes an `order_status_history` row.
- The POS places an order directly as CONFIRMED with a history row
  `DRAFT → CONFIRMED` ("Order placed").

### `order_items`

One row per product line on an order. Prices are **snapshots**: the
order stays correct and readable even if the product is later renamed,
repriced, or deleted (`product_id` is then SET NULL, the snapshot stays).

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | Client-generated (idempotency) |
| `order_id` | `uuid` NOT NULL → `orders(id)` ON DELETE CASCADE | |
| `product_id` | `uuid` NULL → `products(id)` ON DELETE SET NULL | |
| `variant_id` | `uuid` NULL → `product_variants(id)` ON DELETE SET NULL | |
| `product_name` | `text` NOT NULL | Snapshot of the product name |
| `variant_name` | `text` NULL | Snapshot of the variant name |
| `quantity` | `integer` NOT NULL DEFAULT `1`, CHECK `quantity > 0` | |
| `unit_price` | `numeric(12,2)` NOT NULL | Snapshot: product price + variant adjustment + modifier prices, per unit |
| `total_price` | `numeric(12,2)` NOT NULL | `unit_price × quantity` |
| `created_at` / `updated_at` | `timestamptz` | |

UPDATE is allowed only while the parent order is `DRAFT` (RLS). There
is no DELETE policy — placed order items are history.

### `order_item_modifiers`

Modifiers chosen on one order item, with price snapshots. No
`updated_at`; no UPDATE/DELETE policy (history).

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `order_item_id` | `uuid` NOT NULL → `order_items(id)` ON DELETE CASCADE | |
| `modifier_id` | `uuid` NULL → `modifiers(id)` ON DELETE SET NULL | |
| `modifier_name` | `text` NOT NULL | Snapshot |
| `price` | `numeric(12,2)` NOT NULL | Snapshot, per unit |
| `created_at` | `timestamptz` | |

### `order_payments`

Money received against an order. Split payments are allowed (several
rows per order). Append-only: SELECT + INSERT policies only.

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | Client-generated (idempotency) |
| `order_id` | `uuid` NOT NULL → `orders(id)` ON DELETE CASCADE | |
| `method` | `text` NOT NULL, CHECK in `cash / card / bkash / nagad / bank / due` | `due` = put on tab / pay later; it counts as "due", not "paid" |
| `amount` | `numeric(12,2)` NOT NULL, CHECK `amount > 0` | Must not exceed the order's remaining balance (enforced by the service) |
| `reference` | `text` NULL | e.g. a bKash TrxID |
| `received_by` | `uuid` NULL | Actor; no FK |
| `created_at` | `timestamptz` | No `updated_at` |

### `order_status_history`

Audit trail of every order status change. Append-only: SELECT + INSERT
policies only.

| Column | Type / default | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `order_id` | `uuid` NOT NULL → `orders(id)` ON DELETE CASCADE | |
| `from_status` | `text` NULL | Previous status; the app always sets it (the placement row is `DRAFT → CONFIRMED`) |
| `to_status` | `text` NOT NULL | |
| `changed_by` | `uuid` NULL | Actor; no FK |
| `note` | `text` NULL | Cancel/refund reason, or "Order placed" |
| `created_at` | `timestamptz` | No `updated_at` |

## Row Level Security

RLS is enabled on **all 22 tables**. Every policy is `TO authenticated`
— the `anon` role has no direct table access at all; it can only
authenticate. All policies are defined in `0001_foundation.sql`; the
summary below is not a substitute for reading them.

### The helper: `public.current_restaurant_id()`

```sql
-- SECURITY DEFINER, STABLE, LANGUAGE sql
-- Returns profiles.restaurant_id for auth.uid(), or NULL.
```

Because it runs as the function owner it bypasses RLS, so policies can
call it without recursing into the `profiles` policy. Policies never
query `profiles` directly and never query their own table.
`EXECUTE` is granted to `authenticated` and revoked from `anon`. A user
with no profile gets `NULL`, and every restaurant-scoped policy then
evaluates to deny.

### Policy summary

| Table | SELECT | INSERT | UPDATE | DELETE |
| --- | --- | --- | --- | --- |
| `restaurants` | Own restaurant only (`id = current_restaurant_id()`) | Any authenticated user (`WITH CHECK true`) — **bootstrap exception**: a restaurant must be created before its creator has a profile pointing at it | Own restaurant only | Own restaurant only |
| `branches` | Own restaurant | Own restaurant | Own restaurant | Own restaurant |
| `profiles` | Own row, or any profile of own restaurant | Own row only (`id = auth.uid()`) | Own row only | Own row only |
| `roles` | System roles (`restaurant_id IS NULL`) + own restaurant's roles | Own restaurant only (system roles cannot be created through RLS) | Own restaurant only | Own restaurant only |
| `permissions` | All authenticated users | — (no policy; service role only) | — | — |
| `role_permissions` | Scoped through the linked role (system role or own restaurant's role) | Own restaurant's roles only | — (no policy) | Own restaurant's roles only |
| `user_roles` | Own assignments, or assignments scoped through a system/own-restaurant role | Own restaurant's roles only | — (no policy; change by INSERT/DELETE) | Own restaurant's roles only |
| `restaurant_settings` | Own restaurant | Own restaurant | Own restaurant | Own restaurant |
| `feature_flags` | Own restaurant | Own restaurant | Own restaurant | Own restaurant |
| `audit_logs` | Own restaurant | Own restaurant, or `restaurant_id IS NULL` for system events | — (insert-only) | — (insert-only) |
| `kitchen_stations` | Own restaurant | Own restaurant | Own restaurant | Own restaurant |
| `categories` | Own restaurant | Own restaurant | Own restaurant | Own restaurant |
| `modifiers` | Own restaurant | Own restaurant | Own restaurant | Own restaurant |
| `products` | Own restaurant | Own restaurant | Own restaurant | Own restaurant |
| `product_variants` | Scoped through the parent product's restaurant | Same | Same | Same |
| `product_modifiers` | Scoped through the parent product's restaurant | Same | — (no policy) | Same |
| `tables` | Own restaurant | Own restaurant | Own restaurant | Own restaurant |
| `orders` | Own restaurant | Own restaurant | Own restaurant | — (**no DELETE policy**: financial history is never hard-deleted) |
| `order_items` | Scoped through the parent order's restaurant | Same | Only while the parent order is `DRAFT` | — (no DELETE policy) |
| `order_item_modifiers` | Scoped through the order item's order | Same | — (append-only) | — (append-only) |
| `order_payments` | Scoped through the parent order's restaurant | Same | — (append-only) | — (append-only) |
| `order_status_history` | Scoped through the parent order's restaurant | Same | — (append-only) | — (append-only) |

Notes and sharp edges:

- **The `restaurants` INSERT exception is real.** Any authenticated user
  can insert a restaurant row. That is required for first-time setup, but
  it means restaurant creation is not restricted to an admin role — the
  app flow (Settings setup mode) is the only gate in Phase 1. When a
  provisioning/licensing flow lands, revisit this policy.
- **`profiles` UPDATE/DELETE are self-only.** An admin cannot edit or
  deactivate another user's profile through RLS in Phase 1; staff
  management (Phase 5) will need a policy or service-role path for that.
- **System roles are read-only through RLS.** Nobody can create, edit,
  or delete a `restaurant_id IS NULL` role via the app; only migrations /
  service role can.
- **Cascades:** deleting a restaurant cascades to branches, roles,
  settings, feature flags, and audit logs. Profiles survive with
  `restaurant_id` set to NULL (ON DELETE SET NULL). Deleting an auth
  user cascades to their profile (`profiles.id` → `auth.users` ON DELETE
  CASCADE) and from there to their `user_roles` rows.

### Indexes

Besides primary keys and unique constraints, the migration adds indexes
on every foreign key used in policies or lookups: `branches.restaurant_id`,
`profiles.restaurant_id`, `profiles.branch_id`, `roles.restaurant_id`,
`role_permissions.role_id`, `role_permissions.permission_id`,
`user_roles.user_id`, `user_roles.role_id`,
`restaurant_settings.restaurant_id`, `feature_flags.restaurant_id`,
`feature_flags (restaurant_id, flag_key)`,
`audit_logs.restaurant_id`, `audit_logs (restaurant_id, created_at desc)`,
`audit_logs.user_id`. Plus the `roles` coalesce unique index described
above. Add an index with any new foreign key or any column a policy or
list query filters on.

## Roles and permissions

### The 12 system default roles

Seeded by the migration (`restaurant_id NULL`, `is_system = true`):

| `name` | Display name |
| --- | --- |
| `super_admin` | Super Admin |
| `restaurant_owner` | Restaurant Owner |
| `branch_manager` | Branch Manager |
| `admin` | Admin |
| `manager` | Manager |
| `accountant` | Accountant |
| `cashier` | Cashier |
| `waiter` | Waiter |
| `kitchen_staff` | Kitchen Staff |
| `inventory_manager` | Inventory Manager |
| `delivery_staff` | Delivery Staff |
| `receptionist` | Receptionist |

Restaurants may also create their own roles (the Roles page lists them
as "Custom role"); role creation UI does not exist yet.

### The 39 permissions

Seeded by the migration, grouped by module. Keys are `<module>.<action>`.

| Module | Keys |
| --- | --- |
| `orders` (5) | `orders.view`, `orders.create`, `orders.edit`, `orders.cancel`, `orders.refund` |
| `inventory` (4) | `inventory.view`, `inventory.adjust`, `inventory.purchase`, `inventory.transfer` |
| `reports` (2) | `reports.view`, `reports.export` |
| `staff` (4) | `staff.view`, `staff.create`, `staff.edit`, `staff.delete` |
| `settings` (2) | `settings.view`, `settings.manage` |
| `tables` (2) | `tables.view`, `tables.manage` |
| `products` (4) | `products.view`, `products.create`, `products.edit`, `products.delete` |
| `customers` (4) | `customers.view`, `customers.create`, `customers.edit`, `customers.delete` |
| `purchases` (3) | `purchases.view`, `purchases.create`, `purchases.edit` |
| `expenses` (4) | `expenses.view`, `expenses.create`, `expenses.edit`, `expenses.delete` |
| `kitchen` (2) | `kitchen.view`, `kitchen.manage` |
| `delivery` (3) | `delivery.view`, `delivery.manage`, `delivery.assign` |

**Important:** these keys describe *future* modules. The tables and pages
for orders, inventory, products, etc. do not exist yet, and **no
permission is assigned to any role** — `role_permissions` is seeded
empty, so the Roles page matrix is all dashes until an admin assigns
them. Nothing in the app checks permissions yet; enforcement is Phase 5
work. Do not treat the existence of a key as proof the feature exists.

## Migration versioning

- Files live in `supabase/migrations/` and are applied **in filename
  order**.
- Naming: `NNNN_name.sql`, zero-padded sequence — `0001_foundation.sql`
  is the first. The next migration is `0002_<name>.sql`.
- **Never edit a migration after it has been applied to a shared
  database.** Fix a mistake with a new migration, not an edit. (The one
  exception is a migration that has only ever run locally and never
  reached a shared project.)
- The migration is written to be idempotent where practical
  (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING` on the seeds),
  so re-running it against a database that already has the schema is
  safe. One caveat, noted in the file itself: the roles seed relies on
  the coalesce unique index to match `ON CONFLICT DO NOTHING`; if the
  migration ever ran against a database where those rows exist under a
  different constraint, re-running would raise a duplicate-key error
  instead of skipping — delete the duplicate rows first.
- Apply with the Supabase CLI (`supabase db push` after
  `supabase link --project-ref <ref>`) or by pasting the file into the
  Dashboard SQL editor, in order. The SQL editor runs as `postgres`,
  which bypasses RLS.
- Requires Postgres 13+ (`gen_random_uuid()` is built-in; no extension
  needed) and assumes the Supabase `auth` schema (`auth.users`) exists.

## Demo seed data

`supabase/seed.sql` — **development only, never production.** Creates,
with fixed UUIDs (re-runs are safe via `ON CONFLICT DO NOTHING`):

| Row | Id |
| --- | --- |
| Restaurant "FoodX Demo Restaurant" (slug `foodx-demo`, BDT, Asia/Dhaka, active) | `11111111-1111-1111-1111-111111111111` |
| Branch "Main Branch" (code `MAIN`, Dhaka, `is_main = true`) | `22222222-2222-2222-2222-222222222222` |
| `restaurant_settings` for that restaurant (defaults, receipt footer "Thank you for dining with FoodX Demo Restaurant!") | `33333333-3333-3333-3333-333333333333` |

It creates **no auth users, profiles, roles, or permissions** — those
come from the migration (roles/permissions) or Supabase Auth (users).
Run it as `postgres` / service role (Dashboard SQL editor), after the
migration; `supabase db reset` applies migrations + seed locally.

### Removing the demo data

Delete the restaurant — branches, settings, feature flags and audit logs
cascade from it. Or, in order (children before parents):

```sql
delete from public.restaurant_settings
 where restaurant_id = '11111111-1111-1111-1111-111111111111';
delete from public.branches
 where id = '22222222-2222-2222-2222-222222222222';
delete from public.restaurants
 where id = '11111111-1111-1111-1111-111111111111';
```

### Phase 2 demo seed (`supabase/seed_phase2.sql`)

Development only, never production. Adds, for the demo restaurant only
(fixed UUIDs, `ON CONFLICT DO NOTHING`):

| Rows | Ids |
| --- | --- |
| 2 kitchen stations (Main Kitchen, Drinks Station) | `44444444-…-444444444441/2` |
| 3 categories (Starters, Main Course, Drinks) | `55555555-…-555555555551/2/3` |
| 8 products (BDT prices, station + category mapping) | `66666666-…-666666666661…8` |
| 5 product variants (Grilled Chicken sizes, Beef Biryani sizes) | `77777777-…-777777777771…5` |
| 3 modifiers (Extra Cheese 40, Extra Chicken 80, No Onion 0) | `88888888-…-888888888881/2/3` |
| 6 tables (T1–T6, seats 2–8, all available) | `99999999-…-999999999991…6` |

It creates **no orders, payments, or financial history**. Run it after
`seed.sql`, as `postgres` / service role. Removal SQL is in the file
header; deleting the demo restaurant cascades everything.

## Sync and data-integrity notes

These rules apply now and constrain the Phase 9 offline/sync design —
record them here so a later phase does not accidentally break them.

- **No hard delete of financial history.** `orders`, `order_items`,
  `order_payments`, and `order_status_history` have **no DELETE policy**
  at all; `order_payments` and `order_status_history` have no UPDATE
  policy either. Corrections go through void/refund/cancel records
  (status changes), never `DELETE`. `audit_logs` is already insert-only
  for the same reason, and `user_roles` changes by INSERT/DELETE only
  because assignments are not history.
- **Audit everything that moves money.** Every order, payment, refund,
  void, stock adjustment, and purchase must write an `audit_logs` row
  with `before_data` / `after_data` at the same time as the change —
  ideally in the same transaction. The table and the insert-only policy
  already exist; the writers do not yet. **Exception (Phase 2):** order
  status changes are audited in `order_status_history` instead — that
  table is the order's own audit trail, and it is written by every
  status change today. A future `audit_logs` writer for orders must not
  duplicate it silently; decide the vocabulary first.
- **Idempotency for future sync.** Phase 9 (offline-first / LAN +
  cloud sync) will need idempotency keys on every client-created
  mutation (e.g. a client-generated UUID per order/payment, stored on the
  row, with a unique constraint) so a retried sync cannot double-post.
  **Do not design a syncable table without an idempotency key.**
  `gen_random_uuid()` primary keys are not idempotency keys — the client
  must generate and send the key, and the server must dedupe on it.
- **Money is `numeric`, never float.** `restaurant_settings.tax_rate`
  and `service_charge_rate` are already `numeric(5,2)`. Future amount
  columns must be `numeric` too.
- **Timestamps are `timestamptz`.** Store UTC; display in the
  restaurant's `timezone` (`Asia/Dhaka` by default).
- **`updated_at` is trigger-maintained.** Every table with an
  `updated_at` column has a `BEFORE UPDATE` trigger calling
  `set_updated_at()`. New tables with `updated_at` must get the same
  trigger; do not set `updated_at` from application code.
- **One restaurant, one currency (per deployment).** `currency` lives on
  both `restaurants.default_currency` and `restaurant_settings.currency`;
  the Settings form writes both and they must stay in sync. A future
  multi-currency feature must not silently diverge them.
