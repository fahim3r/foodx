-- ============================================================================
-- FoodX — Phase 4 (Customers)
-- Migration 0005: customers, loyalty, coupons
-- ============================================================================
-- Tables added (4): customers, loyalty_transactions, coupons,
-- coupon_redemptions.
-- Columns added: orders.customer_id / coupon_id / coupon_discount /
-- loyalty_points_redeemed / loyalty_discount; restaurant_settings.
-- loyalty_earn_per_100 / loyalty_point_value.
--
-- ISOLATION MODEL — same as 0001/0002/0003: every restaurant-scoped row
-- carries a restaurant_id and policies allow a signed-in user to touch
-- only rows whose restaurant_id matches profiles.restaurant_id via
-- public.current_restaurant_id(). coupon_redemptions is scoped through
-- its parent order with EXISTS (same pattern as purchase_order_items
-- in 0003).
--
-- LOYALTY RULES (the heart of this phase — read before changing):
--   - A customer's points balance is ALWAYS computed as
--     SUM(loyalty_transactions.points) — there is no balance column
--     anywhere, so it can never drift.
--   - Points are earned only when an order COMPLETES (awardLoyaltyPoints
--     in the loyalty service, called best-effort from completeOrder).
--     One EARN per order, enforced by a partial unique index below.
--   - Points are redeemed only at the POS (one REDEEM per order, same
--     index). Cancelling an order returns redeemed points with a
--     REVERSAL; refunding reverses the EARN with a REVERSAL.
--   - loyalty_transactions is append-only: SELECT + INSERT policies
--     only. No UPDATE / DELETE policy — a wrong entry is corrected by
--     a new ADJUSTMENT / REVERSAL row, never by editing.
--   - coupon_redemptions is append-only too (SELECT + INSERT only).
--     One coupon per order in v1 (UNIQUE order_id).
--   - Coupons are deactivated (is_active = false), never hard-deleted:
--     there is no delete policy on coupons at all.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table if not exists public.customers (
  id            uuid          primary key default gen_random_uuid(),
  restaurant_id uuid          not null references public.restaurants (id) on delete cascade,
  name          text          not null,
  phone         text,
  email         text,
  address       text,
  notes         text,
  is_active     boolean       not null default true,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now(),
  -- Postgres allows several NULL phones in a unique index, so the phone
  -- stays optional while a real phone number stays unique per restaurant.
  unique (restaurant_id, phone)
);

create table if not exists public.loyalty_transactions (
  id            uuid          primary key default gen_random_uuid(),
  restaurant_id uuid          not null references public.restaurants (id) on delete cascade,
  customer_id   uuid          not null references public.customers (id) on delete cascade,
  order_id      uuid          references public.orders (id) on delete set null,
  type          text          not null
    check (type in ('EARN', 'REDEEM', 'ADJUSTMENT', 'REVERSAL')),
  -- Signed: EARN / REVERSAL positive, REDEEM negative, ADJUSTMENT either.
  points        integer       not null check (points <> 0),
  reason        text,
  created_by    uuid,
  created_at    timestamptz   not null default now()
);

-- One EARN and one REDEEM per order (idempotency at the DB level).
create unique index if not exists idx_loyalty_transactions_order_type
  on public.loyalty_transactions (order_id, type)
  where order_id is not null and type in ('EARN', 'REDEEM');

create table if not exists public.coupons (
  id               uuid          primary key default gen_random_uuid(),
  restaurant_id    uuid          not null references public.restaurants (id) on delete cascade,
  -- Codes are stored UPPERCASE (the service uppercases + trims on write).
  code             text          not null check (code <> '' and code = upper(code)),
  type             text          not null check (type in ('PERCENT', 'FIXED')),
  value            numeric(12,2) not null check (value > 0),
  min_order_amount numeric(12,2) not null default 0,
  valid_from       date,
  valid_to         date,
  max_uses         integer,
  is_active        boolean       not null default true,
  created_at       timestamptz   not null default now(),
  updated_at       timestamptz   not null default now(),
  unique (restaurant_id, code)
);

create table if not exists public.coupon_redemptions (
  id              uuid          primary key default gen_random_uuid(),
  coupon_id       uuid          not null references public.coupons (id) on delete restrict,
  order_id        uuid          not null unique references public.orders (id) on delete cascade,
  discount_amount numeric(12,2) not null check (discount_amount >= 0),
  created_at      timestamptz   not null default now()
);

-- ----------------------------------------------------------------------------
-- Columns on existing tables
-- ----------------------------------------------------------------------------

alter table public.orders
  add column if not exists customer_id uuid references public.customers (id) on delete set null,
  add column if not exists coupon_id uuid references public.coupons (id) on delete set null,
  add column if not exists coupon_discount numeric(12,2) not null default 0,
  add column if not exists loyalty_points_redeemed integer not null default 0,
  add column if not exists loyalty_discount numeric(12,2) not null default 0;

-- Loyalty rates, per restaurant (never hardcoded in the earn math):
-- points earned per 100 currency units of order total, and the currency
-- value of one point on redemption. Defaults: 1 point per ৳100, 1 point = ৳1.
alter table public.restaurant_settings
  add column if not exists loyalty_earn_per_100 numeric(12,2) not null default 1,
  add column if not exists loyalty_point_value numeric(12,2) not null default 1;

-- ----------------------------------------------------------------------------
-- updated_at triggers (set_updated_at() is defined in 0001_foundation.sql)
-- ----------------------------------------------------------------------------
drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_coupons_updated_at on public.coupons;
create trigger trg_coupons_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table public.customers            enable row level security;
alter table public.loyalty_transactions enable row level security;
alter table public.coupons              enable row level security;
alter table public.coupon_redemptions   enable row level security;

-- --- customers ---------------------------------------------------------------
drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- --- loyalty_transactions ----------------------------------------------------
-- Append-only: SELECT + INSERT policies only. No UPDATE / DELETE policy —
-- a wrong entry is corrected by a new ADJUSTMENT / REVERSAL row.
drop policy if exists loyalty_transactions_select on public.loyalty_transactions;
create policy loyalty_transactions_select on public.loyalty_transactions
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists loyalty_transactions_insert on public.loyalty_transactions;
create policy loyalty_transactions_insert on public.loyalty_transactions
  for insert to authenticated
  with check (
    restaurant_id = public.current_restaurant_id()
    and exists (
      select 1 from public.customers c
      where c.id = loyalty_transactions.customer_id
        and c.restaurant_id = public.current_restaurant_id()
    )
  );

-- --- coupons -----------------------------------------------------------------
-- No delete policy by design: a coupon is deactivated (is_active =
-- false), never hard-deleted — redemptions must keep pointing at it.
drop policy if exists coupons_select on public.coupons;
create policy coupons_select on public.coupons
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists coupons_insert on public.coupons;
create policy coupons_insert on public.coupons
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists coupons_update on public.coupons;
create policy coupons_update on public.coupons
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

-- --- coupon_redemptions ------------------------------------------------------
-- Append-only: SELECT + INSERT only. Scoped through the parent order
-- (same pattern as purchase_order_items in 0003).
drop policy if exists coupon_redemptions_select on public.coupon_redemptions;
create policy coupon_redemptions_select on public.coupon_redemptions
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = coupon_redemptions.order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists coupon_redemptions_insert on public.coupon_redemptions;
create policy coupon_redemptions_insert on public.coupon_redemptions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.orders o
      where o.id = coupon_redemptions.order_id
        and o.restaurant_id = public.current_restaurant_id()
    )
    and exists (
      select 1 from public.coupons c
      where c.id = coupon_redemptions.coupon_id
        and c.restaurant_id = public.current_restaurant_id()
    )
  );

-- ============================================================================
-- Indexes
-- ============================================================================
create index if not exists idx_customers_restaurant_id
  on public.customers (restaurant_id);

create index if not exists idx_loyalty_transactions_customer_id
  on public.loyalty_transactions (customer_id);

create index if not exists idx_loyalty_transactions_order_id
  on public.loyalty_transactions (order_id);

create index if not exists idx_coupons_restaurant_id
  on public.coupons (restaurant_id);

create index if not exists idx_coupon_redemptions_coupon_id
  on public.coupon_redemptions (coupon_id);
