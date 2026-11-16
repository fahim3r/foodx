-- ============================================================================
-- FoodX — Phase 2 (Core Restaurant)
-- Migration 0002: menu, tables, orders, payments, kitchen display
-- ============================================================================
-- Tables added (11): kitchen_stations, categories, modifiers, products,
-- product_variants, product_modifiers, tables, orders, order_items,
-- order_item_modifiers, order_payments, order_status_history.
--
-- ISOLATION MODEL — same as 0001 (see its header): every restaurant-
-- scoped row carries a restaurant_id and policies allow a signed-in user
-- to touch only rows whose restaurant_id matches profiles.restaurant_id
-- via public.current_restaurant_id(). Child rows (variants, order items,
-- payments, history) are scoped through their parent row with EXISTS —
-- they never query profiles directly and never query their own table.
--
-- ORDER STATE MACHINE (enforced in the service layer; the CHECK below
-- only restricts `status` to the valid set):
--   DRAFT → CONFIRMED → SENT_TO_KITCHEN → PREPARING → READY → SERVED
--   → COMPLETED
--   CANCELLED from any non-terminal state (DRAFT..SERVED)
--   REFUNDED from COMPLETED only
-- Every transition writes an order_status_history row.
--
-- FINANCIAL RULES
--   - Money is numeric(12,2), never float. Prices are snapshotted on
--     order_items (unit_price) and order_item_modifiers (price) at order
--     time; the server re-reads product prices from the DB and computes
--     totals — it never trusts client-passed prices.
--   - No hard delete of financial history: there is NO DELETE policy on
--     orders, order_items, order_payments, or order_status_history.
--     Corrections go through CANCELLED / REFUNDED status changes.
--   - order_items may only be UPDATED while the parent order is DRAFT.
--   - order_number is sequential per restaurant (service computes
--     MAX(order_number)+1); uniqueness is enforced by
--     orders_restaurant_number_unique, and the service retries once on
--     a 23505 collision.
--   - Idempotency: the app generates order/payment ids client-side
--     (crypto.randomUUID()), so a retried request cannot double-post.
--     Primary keys are NOT the idempotency mechanism — the client id is.
--
-- IDEMPOTENT where practical (CREATE TABLE IF NOT EXISTS, DROP POLICY IF
-- EXISTS, CREATE INDEX IF NOT EXISTS, ON CONFLICT DO NOTHING).
-- Requires Postgres 13+ and the Supabase auth schema (as 0001 does).
-- ============================================================================

-- ============================================================================
-- Tables
-- ============================================================================

create table if not exists public.kitchen_stations (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants (id) on delete cascade,
  name          text        not null,
  sort_order    integer     not null default 0,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.categories (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants (id) on delete cascade,
  name          text        not null,
  name_bn       text,
  sort_order    integer     not null default 0,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.modifiers (
  id            uuid          primary key default gen_random_uuid(),
  restaurant_id uuid          not null references public.restaurants (id) on delete cascade,
  name          text          not null,
  name_bn       text,
  price         numeric(12,2) not null default 0 check (price >= 0),
  is_active     boolean       not null default true,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now()
);

create table if not exists public.products (
  id                uuid          primary key default gen_random_uuid(),
  restaurant_id     uuid          not null references public.restaurants (id) on delete cascade,
  category_id       uuid          references public.categories (id) on delete set null,
  kitchen_station_id uuid         references public.kitchen_stations (id) on delete set null,
  name              text          not null,
  name_bn           text,
  description       text,
  price             numeric(12,2) not null default 0 check (price >= 0),
  image_url         text,
  is_available      boolean       not null default true,
  sort_order        integer       not null default 0,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);

create table if not exists public.product_variants (
  id               uuid          primary key default gen_random_uuid(),
  product_id       uuid          not null references public.products (id) on delete cascade,
  name             text          not null,
  price_adjustment numeric(12,2) not null default 0,
  sort_order       integer       not null default 0,
  is_active        boolean       not null default true,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now()
);

create table if not exists public.product_modifiers (
  product_id  uuid not null references public.products (id) on delete cascade,
  modifier_id uuid not null references public.modifiers (id) on delete cascade,
  primary key (product_id, modifier_id)
);

create table if not exists public.tables (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants (id) on delete cascade,
  branch_id     uuid        references public.branches (id) on delete set null,
  name          text        not null,
  seats         integer     not null default 4 check (seats > 0),
  status        text        not null default 'available'
    check (status in ('available', 'occupied', 'reserved', 'cleaning')),
  qr_code       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, name)
);

create table if not exists public.orders (
  id                    uuid          primary key default gen_random_uuid(),
  restaurant_id         uuid          not null references public.restaurants (id) on delete cascade,
  branch_id             uuid          references public.branches (id) on delete set null,
  table_id              uuid          references public.tables (id) on delete set null,
  order_number          integer       not null,
  type                  text          not null default 'dine_in'
    check (type in ('dine_in', 'takeaway', 'delivery')),
  status                text          not null default 'DRAFT'
    check (status in (
      'DRAFT', 'CONFIRMED', 'SENT_TO_KITCHEN', 'PREPARING', 'READY',
      'SERVED', 'COMPLETED', 'CANCELLED', 'REFUNDED'
    )),
  subtotal              numeric(12,2) not null default 0 check (subtotal >= 0),
  discount_amount       numeric(12,2) not null default 0 check (discount_amount >= 0),
  tax_amount            numeric(12,2) not null default 0 check (tax_amount >= 0),
  service_charge_amount numeric(12,2) not null default 0 check (service_charge_amount >= 0),
  total_amount          numeric(12,2) not null default 0 check (total_amount >= 0),
  notes                 text,
  created_by            uuid,
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now(),
  unique (restaurant_id, order_number)
);

create table if not exists public.order_items (
  id           uuid          primary key default gen_random_uuid(),
  order_id     uuid          not null references public.orders (id) on delete cascade,
  product_id   uuid          references public.products (id) on delete set null,
  variant_id   uuid          references public.product_variants (id) on delete set null,
  -- Snapshots taken at order time: the order keeps working (and readable)
  -- even if the product is later renamed, repriced, or deleted.
  product_name text          not null,
  variant_name text,
  quantity     integer       not null default 1 check (quantity > 0),
  unit_price   numeric(12,2) not null check (unit_price >= 0),
  total_price  numeric(12,2) not null check (total_price >= 0),
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now()
);

create table if not exists public.order_item_modifiers (
  id            uuid          primary key default gen_random_uuid(),
  order_item_id uuid          not null references public.order_items (id) on delete cascade,
  modifier_id   uuid          references public.modifiers (id) on delete set null,
  -- Snapshot: modifier name and price at order time.
  modifier_name text          not null,
  price         numeric(12,2) not null check (price >= 0),
  created_at    timestamptz   not null default now()
);

create table if not exists public.order_payments (
  id          uuid          primary key default gen_random_uuid(),
  order_id    uuid          not null references public.orders (id) on delete cascade,
  method      text          not null
    check (method in ('cash', 'card', 'bkash', 'nagad', 'bank', 'due')),
  amount      numeric(12,2) not null check (amount > 0),
  reference   text,
  received_by uuid,
  created_at  timestamptz   not null default now()
);

create table if not exists public.order_status_history (
  id          uuid        primary key default gen_random_uuid(),
  order_id    uuid        not null references public.orders (id) on delete cascade,
  from_status text,
  to_status   text        not null,
  changed_by  uuid,
  note        text,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- updated_at triggers (all tables that have an updated_at column)
-- set_updated_at() is defined in 0001_foundation.sql.
-- ----------------------------------------------------------------------------
drop trigger if exists trg_kitchen_stations_updated_at on public.kitchen_stations;
create trigger trg_kitchen_stations_updated_at
  before update on public.kitchen_stations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_categories_updated_at on public.categories;
create trigger trg_categories_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

drop trigger if exists trg_modifiers_updated_at on public.modifiers;
create trigger trg_modifiers_updated_at
  before update on public.modifiers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists trg_product_variants_updated_at on public.product_variants;
create trigger trg_product_variants_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

drop trigger if exists trg_tables_updated_at on public.tables;
create trigger trg_tables_updated_at
  before update on public.tables
  for each row execute function public.set_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists trg_order_items_updated_at on public.order_items;
create trigger trg_order_items_updated_at
  before update on public.order_items
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.kitchen_stations      enable row level security;
alter table public.categories           enable row level security;
alter table public.modifiers            enable row level security;
alter table public.products             enable row level security;
alter table public.product_variants     enable row level security;
alter table public.product_modifiers    enable row level security;
alter table public.tables               enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_item_modifiers enable row level security;
alter table public.order_payments       enable row level security;
alter table public.order_status_history enable row level security;

-- --- kitchen_stations --------------------------------------------------------
drop policy if exists kitchen_stations_select on public.kitchen_stations;
create policy kitchen_stations_select on public.kitchen_stations
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists kitchen_stations_insert on public.kitchen_stations;
create policy kitchen_stations_insert on public.kitchen_stations
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists kitchen_stations_update on public.kitchen_stations;
create policy kitchen_stations_update on public.kitchen_stations
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists kitchen_stations_delete on public.kitchen_stations;
create policy kitchen_stations_delete on public.kitchen_stations
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- categories --------------------------------------------------------------
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists categories_insert on public.categories;
create policy categories_insert on public.categories
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists categories_delete on public.categories;
create policy categories_delete on public.categories
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- modifiers ---------------------------------------------------------------
drop policy if exists modifiers_select on public.modifiers;
create policy modifiers_select on public.modifiers
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists modifiers_insert on public.modifiers;
create policy modifiers_insert on public.modifiers
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists modifiers_update on public.modifiers;
create policy modifiers_update on public.modifiers
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists modifiers_delete on public.modifiers;
create policy modifiers_delete on public.modifiers
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- products ----------------------------------------------------------------
drop policy if exists products_select on public.products;
create policy products_select on public.products
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists products_insert on public.products;
create policy products_insert on public.products
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists products_update on public.products;
create policy products_update on public.products
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists products_delete on public.products;
create policy products_delete on public.products
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- product_variants --------------------------------------------------------
-- Scoped through the parent product's restaurant.
drop policy if exists product_variants_select on public.product_variants;
create policy product_variants_select on public.product_variants
  for select to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_variants.product_id
        and p.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists product_variants_insert on public.product_variants;
create policy product_variants_insert on public.product_variants
  for insert to authenticated
  with check (
    exists (
      select 1 from public.products p
      where p.id = product_variants.product_id
        and p.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists product_variants_update on public.product_variants;
create policy product_variants_update on public.product_variants
  for update to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_variants.product_id
        and p.restaurant_id = public.current_restaurant_id()
    )
  )
  with check (
    exists (
      select 1 from public.products p
      where p.id = product_variants.product_id
        and p.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists product_variants_delete on public.product_variants;
create policy product_variants_delete on public.product_variants
  for delete to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_variants.product_id
        and p.restaurant_id = public.current_restaurant_id()
    )
  );

-- --- product_modifiers -------------------------------------------------------
-- Junction table: scoped through the parent product's restaurant.
drop policy if exists product_modifiers_select on public.product_modifiers;
create policy product_modifiers_select on public.product_modifiers
  for select to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_modifiers.product_id
        and p.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists product_modifiers_insert on public.product_modifiers;
create policy product_modifiers_insert on public.product_modifiers
  for insert to authenticated
  with check (
    exists (
      select 1 from public.products p
      where p.id = product_modifiers.product_id
        and p.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists product_modifiers_delete on public.product_modifiers;
create policy product_modifiers_delete on public.product_modifiers
  for delete to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_modifiers.product_id
        and p.restaurant_id = public.current_restaurant_id()
    )
  );

-- --- tables ------------------------------------------------------------------
drop policy if exists tables_select on public.tables;
create policy tables_select on public.tables
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists tables_insert on public.tables;
create policy tables_insert on public.tables
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists tables_update on public.tables;
create policy tables_update on public.tables
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists tables_delete on public.tables;
create policy tables_delete on public.tables
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- orders ------------------------------------------------------------------
-- No DELETE policy: financial records are never hard-deleted. A wrong
-- order is CANCELLED or REFUNDED, never removed.
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists orders_insert on public.orders;
create policy orders_insert on public.orders
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists orders_update on public.orders;
create policy orders_update on public.orders
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

-- --- order_items -------------------------------------------------------------
-- Scoped through the parent order. UPDATE only while the parent order is
-- DRAFT (placed orders are history). No DELETE policy.
drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists order_items_insert on public.order_items;
create policy order_items_insert on public.order_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists order_items_update on public.order_items;
create policy order_items_update on public.order_items
  for update to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.restaurant_id = public.current_restaurant_id()
        and o.status = 'DRAFT'
    )
  )
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.restaurant_id = public.current_restaurant_id()
        and o.status = 'DRAFT'
    )
  );

-- --- order_item_modifiers ----------------------------------------------------
-- Scoped through the order item's parent order. No UPDATE/DELETE policy:
-- modifiers on a placed order are history.
drop policy if exists order_item_modifiers_select on public.order_item_modifiers;
create policy order_item_modifiers_select on public.order_item_modifiers
  for select to authenticated
  using (
    exists (
      select 1 from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_modifiers.order_item_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists order_item_modifiers_insert on public.order_item_modifiers;
create policy order_item_modifiers_insert on public.order_item_modifiers
  for insert to authenticated
  with check (
    exists (
      select 1 from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.id = order_item_modifiers.order_item_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

-- --- order_payments ----------------------------------------------------------
-- Append-only: SELECT + INSERT only, no UPDATE/DELETE policy. A wrong
-- payment is corrected by a refund (status), never edited away.
drop policy if exists order_payments_select on public.order_payments;
create policy order_payments_select on public.order_payments
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_payments.order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists order_payments_insert on public.order_payments;
create policy order_payments_insert on public.order_payments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_payments.order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

-- --- order_status_history ----------------------------------------------------
-- Append-only: SELECT + INSERT only, no UPDATE/DELETE policy.
drop policy if exists order_status_history_select on public.order_status_history;
create policy order_status_history_select on public.order_status_history
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_status_history.order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists order_status_history_insert on public.order_status_history;
create policy order_status_history_insert on public.order_status_history
  for insert to authenticated
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_status_history.order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

-- ============================================================================
-- Indexes
-- ============================================================================
create index if not exists idx_kitchen_stations_restaurant_id
  on public.kitchen_stations (restaurant_id);

create index if not exists idx_categories_restaurant_id
  on public.categories (restaurant_id);

create index if not exists idx_categories_restaurant_sort
  on public.categories (restaurant_id, sort_order);

create index if not exists idx_modifiers_restaurant_id
  on public.modifiers (restaurant_id);

create index if not exists idx_products_restaurant_id
  on public.products (restaurant_id);

create index if not exists idx_products_category_id
  on public.products (category_id);

create index if not exists idx_products_restaurant_sort
  on public.products (restaurant_id, sort_order);

create index if not exists idx_product_variants_product_id
  on public.product_variants (product_id);

create index if not exists idx_product_modifiers_product_id
  on public.product_modifiers (product_id);

create index if not exists idx_product_modifiers_modifier_id
  on public.product_modifiers (modifier_id);

create index if not exists idx_tables_restaurant_id
  on public.tables (restaurant_id);

create index if not exists idx_tables_branch_id
  on public.tables (branch_id);

create index if not exists idx_tables_restaurant_status
  on public.tables (restaurant_id, status);

create index if not exists idx_orders_restaurant_id
  on public.orders (restaurant_id);

create index if not exists idx_orders_restaurant_status
  on public.orders (restaurant_id, status);

create index if not exists idx_orders_restaurant_created
  on public.orders (restaurant_id, created_at desc);

create index if not exists idx_orders_table_id
  on public.orders (table_id);

create index if not exists idx_order_items_order_id
  on public.order_items (order_id);

create index if not exists idx_order_items_product_id
  on public.order_items (product_id);

create index if not exists idx_order_item_modifiers_order_item_id
  on public.order_item_modifiers (order_item_id);

create index if not exists idx_order_payments_order_id
  on public.order_payments (order_id);

create index if not exists idx_order_status_history_order_id
  on public.order_status_history (order_id);

create index if not exists idx_order_status_history_order_created
  on public.order_status_history (order_id, created_at);

-- ============================================================================
-- Realtime (kitchen display)
-- ============================================================================
-- KDS listens to orders / order_items changes over Supabase Realtime.
-- The publication only exists on Supabase projects, so this is guarded:
-- it does nothing on a plain Postgres database without the publication.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
    ) then
      execute 'alter publication supabase_realtime add table public.orders';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_items'
    ) then
      execute 'alter publication supabase_realtime add table public.order_items';
    end if;
  end if;
end
$$;
