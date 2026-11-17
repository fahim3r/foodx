-- ============================================================================
-- FoodX — Phase 6 (Delivery)
-- Migration 0011: delivery drivers, zones, delivery orders, status history
-- ============================================================================
-- Tables added (4): delivery_drivers, delivery_zones, delivery_orders,
-- delivery_status_history.
--
-- WHAT ALREADY EXISTS (not rebuilt here):
--   - orders.type includes 'delivery' (0002) and 'pickup' (0007);
--     orders.source is POS / QR / ONLINE (0007).
--   - orders carries customer_name / customer_phone / delivery_address /
--     delivery_fee (0007); restaurant_settings carries delivery_enabled /
--     delivery_fee / min_order_amount (0007).
--   This migration adds the operational layer on top: who delivers, to
--   which zone, in what delivery state, with a full audit history.
--
-- ISOLATION MODEL — same as 0001/0002/0003: drivers and zones carry a
-- restaurant_id and are scoped directly; delivery_orders and its history
-- are child rows scoped through the parent order with EXISTS (they never
-- query profiles directly and never query their own table).
--
-- DELIVERY STATE MACHINE (enforced in the service layer; the CHECK below
-- only restricts `status` to the valid set — same split as orders):
--   PENDING → ASSIGNED → PICKED_UP → OUT_FOR_DELIVERY → DELIVERED
--   FAILED from PICKED_UP / OUT_FOR_DELIVERY
--   CANCELLED from PENDING / ASSIGNED
-- Every transition writes a delivery_status_history row. DELIVERED frees
-- the driver (back to AVAILABLE) and completes the linked order through
-- the existing order service path; FAILED / CANCELLED free the driver but
-- never auto-cancel the order itself (a manager decides that in Orders).
--
-- FINANCIAL RULES:
--   - Money is numeric(12,2), never float.
--   - delivery_orders.cod_amount is a snapshot of the amount to collect
--     on delivery, taken from orders.total_amount when the delivery row
--     is created. The service re-reads the order total from the DB; it
--     never trusts a client-passed amount.
--
-- IDEMPOTENT: safe to run more than once (IF NOT EXISTS / DROP … IF
-- EXISTS before CREATE for policies and triggers; the backfill uses
-- ON CONFLICT DO NOTHING / NOT EXISTS guards). No existing data is
-- modified except the additive backfill in section 5.
-- ============================================================================

-- ============================================================================
-- 1. Tables
-- ============================================================================

create table if not exists public.delivery_drivers (
  id             uuid        primary key default gen_random_uuid(),
  restaurant_id  uuid        not null references public.restaurants (id) on delete cascade,
  branch_id      uuid        references public.branches (id) on delete set null,
  user_id        uuid        references public.profiles (id) on delete set null,
  name           text        not null,
  phone          text        not null,
  email          text,
  vehicle_type   text,
  vehicle_number text,
  status         text        not null default 'OFFLINE'
    check (status in ('AVAILABLE', 'ON_DELIVERY', 'OFFLINE')),
  is_active      boolean     not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.delivery_zones (
  id                uuid          primary key default gen_random_uuid(),
  restaurant_id     uuid          not null references public.restaurants (id) on delete cascade,
  branch_id         uuid          references public.branches (id) on delete set null,
  name              text          not null,
  fee               numeric(12,2) not null default 0 check (fee >= 0),
  min_order_amount  numeric(12,2) not null default 0 check (min_order_amount >= 0),
  estimated_minutes integer       check (estimated_minutes is null or estimated_minutes > 0),
  is_active         boolean       not null default true,
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now(),
  unique (restaurant_id, name)
);

-- 1:1 operational extension of an order of type 'delivery'. The order row
-- stays the financial / kitchen record; this row is the dispatch record.
create table if not exists public.delivery_orders (
  order_id              uuid          primary key references public.orders (id) on delete cascade,
  driver_id             uuid          references public.delivery_drivers (id) on delete set null,
  zone_id               uuid          references public.delivery_zones (id) on delete set null,
  status                text          not null default 'PENDING'
    check (status in (
      'PENDING', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY',
      'DELIVERED', 'FAILED', 'CANCELLED'
    )),
  cod_amount            numeric(12,2) not null default 0 check (cod_amount >= 0),
  delivery_notes        text,
  assigned_at           timestamptz,
  picked_up_at          timestamptz,
  out_for_delivery_at   timestamptz,
  delivered_at          timestamptz,
  failed_at             timestamptz,
  created_at            timestamptz   not null default now(),
  updated_at            timestamptz   not null default now()
);

-- Append-only: rows are never updated or deleted (no UPDATE/DELETE policy).
create table if not exists public.delivery_status_history (
  id                uuid        primary key default gen_random_uuid(),
  delivery_order_id uuid        not null references public.delivery_orders (order_id) on delete cascade,
  from_status       text,
  to_status         text        not null,
  changed_by        uuid,
  created_at        timestamptz not null default now()
);

-- ============================================================================
-- 2. updated_at triggers (set_updated_at() is defined in 0001)
-- ============================================================================

drop trigger if exists trg_delivery_drivers_updated_at on public.delivery_drivers;
create trigger trg_delivery_drivers_updated_at
  before update on public.delivery_drivers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_delivery_zones_updated_at on public.delivery_zones;
create trigger trg_delivery_zones_updated_at
  before update on public.delivery_zones
  for each row execute function public.set_updated_at();

drop trigger if exists trg_delivery_orders_updated_at on public.delivery_orders;
create trigger trg_delivery_orders_updated_at
  before update on public.delivery_orders
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 3. Row Level Security
-- ============================================================================

alter table public.delivery_drivers       enable row level security;
alter table public.delivery_zones         enable row level security;
alter table public.delivery_orders        enable row level security;
alter table public.delivery_status_history enable row level security;

-- --- delivery_drivers -------------------------------------------------------
drop policy if exists delivery_drivers_select on public.delivery_drivers;
create policy delivery_drivers_select on public.delivery_drivers
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists delivery_drivers_insert on public.delivery_drivers;
create policy delivery_drivers_insert on public.delivery_drivers
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists delivery_drivers_update on public.delivery_drivers;
create policy delivery_drivers_update on public.delivery_drivers
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists delivery_drivers_delete on public.delivery_drivers;
create policy delivery_drivers_delete on public.delivery_drivers
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- delivery_zones ---------------------------------------------------------
drop policy if exists delivery_zones_select on public.delivery_zones;
create policy delivery_zones_select on public.delivery_zones
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists delivery_zones_insert on public.delivery_zones;
create policy delivery_zones_insert on public.delivery_zones
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists delivery_zones_update on public.delivery_zones;
create policy delivery_zones_update on public.delivery_zones
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists delivery_zones_delete on public.delivery_zones;
create policy delivery_zones_delete on public.delivery_zones
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- delivery_orders --------------------------------------------------------
-- Scoped through the parent order. No DELETE policy: a dispatch record is
-- history once created (cancel the delivery, do not erase it).
drop policy if exists delivery_orders_select on public.delivery_orders;
create policy delivery_orders_select on public.delivery_orders
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = delivery_orders.order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists delivery_orders_insert on public.delivery_orders;
create policy delivery_orders_insert on public.delivery_orders
  for insert to authenticated
  with check (
    exists (
      select 1 from public.orders o
      where o.id = delivery_orders.order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists delivery_orders_update on public.delivery_orders;
create policy delivery_orders_update on public.delivery_orders
  for update to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = delivery_orders.order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  )
  with check (
    exists (
      select 1 from public.orders o
      where o.id = delivery_orders.order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

-- --- delivery_status_history --------------------------------------------------
-- Append-only: SELECT + INSERT only, no UPDATE/DELETE policy.
-- delivery_orders.order_id IS the parent order's id (it is the PK), so
-- history scopes straight through orders — no nested-RLS join needed.
drop policy if exists delivery_status_history_select on public.delivery_status_history;
create policy delivery_status_history_select on public.delivery_status_history
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = delivery_status_history.delivery_order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists delivery_status_history_insert on public.delivery_status_history;
create policy delivery_status_history_insert on public.delivery_status_history
  for insert to authenticated
  with check (
    exists (
      select 1 from public.orders o
      where o.id = delivery_status_history.delivery_order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

-- ============================================================================
-- 4. Indexes
-- ============================================================================

create index if not exists idx_delivery_drivers_restaurant_id
  on public.delivery_drivers (restaurant_id);

create index if not exists idx_delivery_drivers_restaurant_status
  on public.delivery_drivers (restaurant_id, status);

create index if not exists idx_delivery_zones_restaurant_id
  on public.delivery_zones (restaurant_id);

create index if not exists idx_delivery_orders_driver_id
  on public.delivery_orders (driver_id);

create index if not exists idx_delivery_orders_status
  on public.delivery_orders (status);

create index if not exists idx_delivery_status_history_order_id
  on public.delivery_status_history (delivery_order_id);

create index if not exists idx_delivery_status_history_created
  on public.delivery_status_history (delivery_order_id, created_at);

-- ============================================================================
-- 5. Backfill: one PENDING delivery row for every existing delivery order
-- ============================================================================

insert into public.delivery_orders (order_id, cod_amount)
select o.id, o.total_amount
from public.orders o
where o.type = 'delivery'
on conflict (order_id) do nothing;

insert into public.delivery_status_history (delivery_order_id, from_status, to_status)
select d.order_id, null, 'PENDING'
from public.delivery_orders d
where not exists (
  select 1 from public.delivery_status_history h
  where h.delivery_order_id = d.order_id
);
