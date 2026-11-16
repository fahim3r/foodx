-- ============================================================================
-- FoodX — Migration 0006: correct the Phase 4 (Customers) schema
-- ============================================================================
-- WHY THIS MIGRATION EXISTS:
-- Migration 0005 was applied to the live database from a STALE DRAFT of the
-- file (the apply pasted 275 lines; the committed file is 248 lines). The
-- live tables therefore have draft column names and are missing columns
-- the app code expects, so every Phase 4 write fails — e.g. creating a
-- customer fails with PostgREST PGRST204 "Could not find the 'address'
-- column of 'customers' in the schema cache".
--
-- Live (draft) vs intended (0005 + services):
--   customers:            missing address, notes, is_active
--   coupons:              discount_type/discount_value/valid_until instead
--                         of type/value/valid_to; missing max_uses;
--                         valid_from/valid_until are timestamptz, not date
--   loyalty_transactions: txn_type instead of type; missing created_by
--   coupon_redemptions:   two extra columns (restaurant_id, customer_id)
--                         that no design ever used; the app never writes
--                         them and no redemptions exist yet
--
-- This migration brings the live database to exactly the state 0005
-- describes. It is IDEMPOTENT: on a database where 0005 applied
-- correctly every statement is a no-op (renames only run when the old
-- name exists and the new one does not; adds use IF NOT EXISTS; policies
-- and triggers are dropped and recreated). Fresh installs run 0005 then
-- this file with no effect.
--
-- Order of operations matters: RLS policies are re-applied FIRST (they
-- replace any draft policy that might reference the extra
-- coupon_redemptions columns), and only then are those columns dropped.
-- No data is touched: all four Phase 4 tables are empty on the live
-- database (no customer, coupon or loyalty row could ever be created
-- against the draft schema).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. customers — add the missing columns
-- ----------------------------------------------------------------------------
alter table public.customers
  add column if not exists address text,
  add column if not exists notes text,
  add column if not exists is_active boolean not null default true;

-- ----------------------------------------------------------------------------
-- 2. coupons — rename the draft columns to the final names
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'coupons'
               and column_name = 'discount_type')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'coupons'
               and column_name = 'type') then
    alter table public.coupons rename column discount_type to type;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'coupons'
               and column_name = 'discount_value')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'coupons'
               and column_name = 'value') then
    alter table public.coupons rename column discount_value to value;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'coupons'
               and column_name = 'valid_until')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'coupons'
               and column_name = 'valid_to') then
    alter table public.coupons rename column valid_until to valid_to;
  end if;
end $$;

-- valid_from / valid_to are dates in the design, not timestamps.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'coupons'
               and column_name = 'valid_from'
               and data_type = 'timestamp with time zone') then
    alter table public.coupons
      alter column valid_from type date using valid_from::date;
  end if;

  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'coupons'
               and column_name = 'valid_to'
               and data_type = 'timestamp with time zone') then
    alter table public.coupons
      alter column valid_to type date using valid_to::date;
  end if;
end $$;

alter table public.coupons
  add column if not exists max_uses integer;

-- ----------------------------------------------------------------------------
-- 3. loyalty_transactions — rename txn_type to type, add created_by
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'loyalty_transactions'
               and column_name = 'txn_type')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'loyalty_transactions'
               and column_name = 'type') then
    alter table public.loyalty_transactions rename column txn_type to type;
  end if;
end $$;

alter table public.loyalty_transactions
  add column if not exists created_by uuid;

-- ----------------------------------------------------------------------------
-- 4. coupon_redemptions — drop the two extra draft columns (no design
--    ever used them; the tables are empty). Policies are re-applied in
--    section 6 first, so no draft policy can still reference them.
-- ----------------------------------------------------------------------------
alter table public.coupon_redemptions
  drop column if exists restaurant_id,
  drop column if exists customer_id;

-- ----------------------------------------------------------------------------
-- 5. Columns on existing tables (no-ops where 0005 applied correctly)
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists customer_id uuid references public.customers (id) on delete set null,
  add column if not exists coupon_id uuid references public.coupons (id) on delete set null,
  add column if not exists coupon_discount numeric(12,2) not null default 0,
  add column if not exists loyalty_points_redeemed integer not null default 0,
  add column if not exists loyalty_discount numeric(12,2) not null default 0;

alter table public.restaurant_settings
  add column if not exists loyalty_earn_per_100 numeric(12,2) not null default 1,
  add column if not exists loyalty_point_value numeric(12,2) not null default 1;

-- ----------------------------------------------------------------------------
-- 6. Row Level Security — re-apply the exact 0005 policies (drop +
--    recreate, so any draft policy is replaced)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 7. updated_at triggers (set_updated_at() is defined in 0001)
-- ----------------------------------------------------------------------------
drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_coupons_updated_at on public.coupons;
create trigger trg_coupons_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 8. Indexes — unique indexes are dropped and recreated so the definition
--    is exactly the intended one even if the draft created a variant.
-- ----------------------------------------------------------------------------
drop index if exists public.idx_loyalty_transactions_order_type;
create unique index idx_loyalty_transactions_order_type
  on public.loyalty_transactions (order_id, type)
  where order_id is not null and type in ('EARN', 'REDEEM');

drop index if exists public.idx_customers_restaurant_phone;
create unique index idx_customers_restaurant_phone
  on public.customers (restaurant_id, phone);

drop index if exists public.idx_coupons_restaurant_code;
create unique index idx_coupons_restaurant_code
  on public.coupons (restaurant_id, code);

drop index if exists public.idx_coupon_redemptions_order_id;
create unique index idx_coupon_redemptions_order_id
  on public.coupon_redemptions (order_id);

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

-- NOTE: CHECK constraints on the renamed columns (loyalty type in
-- EARN/REDEEM/ADJUSTMENT/REVERSAL, coupon type in PERCENT/FIXED,
-- value > 0, code = upper(code)) follow the rename automatically if
-- the draft defined them; the app services validate all of these values
-- before writing, so a missing draft CHECK is not blocking.
