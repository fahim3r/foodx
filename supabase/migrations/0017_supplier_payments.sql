-- FoodX migration 0017 — Phase 7 Step 2A: supplier payments + manual
-- product cost.
--
-- 1. supplier_payments: money actually paid to a supplier. Until now
--    the Business module could only show RECEIVED purchase totals
--    ("received, payment tracking not yet built"); this table makes
--    paid / due real. purchase_order_id is nullable — a payment can
--    be on account. Money records are corrected, never erased: the
--    table gets SELECT / INSERT / UPDATE policies and NO delete
--    policy, the same rule as expenses (§46).
-- 2. products.cost_price: a manual per-product cost, used by the
--    item-margin report (§28) only when the product has no recipe —
--    recipes stay the primary cost source; bought-in items (drinks)
--    have no recipe by nature. Nullable: no cost data stays visibly
--    unknown instead of defaulting to a fake zero-margin.
--
-- Idempotent: safe to re-run.

create table if not exists public.supplier_payments (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  supplier_id       uuid not null references public.suppliers (id) on delete restrict,
  purchase_order_id uuid references public.purchase_orders (id) on delete set null,
  amount            numeric(12,2) not null check (amount > 0),
  payment_method    text not null
    check (payment_method in ('cash', 'card', 'bkash', 'nagad', 'bank', 'due')),
  paid_on           date not null default current_date,
  note              text,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists supplier_payments_restaurant_supplier_idx
  on public.supplier_payments (restaurant_id, supplier_id, paid_on desc);

alter table public.supplier_payments enable row level security;

drop policy if exists supplier_payments_select on public.supplier_payments;
create policy supplier_payments_select on public.supplier_payments
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists supplier_payments_insert on public.supplier_payments;
create policy supplier_payments_insert on public.supplier_payments
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists supplier_payments_update on public.supplier_payments;
create policy supplier_payments_update on public.supplier_payments
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

-- No DELETE policy on purpose (money records, §46 pattern).

drop trigger if exists supplier_payments_set_updated_at on public.supplier_payments;
create trigger supplier_payments_set_updated_at
  before update on public.supplier_payments
  for each row execute function public.set_updated_at();

alter table public.products
  add column if not exists cost_price numeric(12,2);
