-- ============================================================================
-- FoodX — Phase 7 (Business)
-- Migration 0013: expense categories, expenses, cashier shifts, shift
-- cash movements, daily closings
-- ============================================================================
-- Tables added (5): expense_categories, expenses, cashier_shifts,
-- shift_cash_movements, daily_closings.
--
-- WHAT ALREADY EXISTS (not rebuilt here):
--   - order_payments (0002) — the sales payment record; method check
--     ('cash','card','bkash','nagad','bank','due') is reused verbatim
--     below for expenses.
--   - purchase_orders (0003) — RECEIVED totals feed purchases in P&L.
--   - branches (0001) — new tables carry a nullable branch_id like
--     delivery_drivers / delivery_zones (0011).
--
-- MASTER PROMPT BASIS: §36 expense fields + the 12 categories (§36 list
-- is seeded per restaurant by the service on first use — no global seed
-- here), §37 basic accounting (P&L is computed live by the service, no
-- ledger table), §38 cashier shift (expected cash is computed from DB
-- data at close and stored; difference is stored, never hidden),
-- §46 financial integrity (expenses are VOIDED, never hard-deleted —
-- this migration deliberately creates NO delete policy on expenses;
-- shift_cash_movements are append-only: select + insert policies only).
--
-- EXPECTED CASH (computed in src/services/business.ts):
--   opening_cash
--   + cash order_payments received during [opened_at, closed_at)
--   − non-voided cash expenses created in the same window
--   + movements (CASH_IN +, CASH_OUT −, ADJUSTMENT signed)
--
-- ISOLATION MODEL — same as 0001–0011: every table carries
-- restaurant_id, scoped with current_restaurant_id(); movements are
-- additionally tied to their shift.
--
-- IDEMPOTENT: safe to run more than once (IF NOT EXISTS / DROP … IF
-- EXISTS before CREATE for policies, triggers and indexes).
-- 0 DELETE FROM / TRUNCATE. No existing data is modified.
-- ============================================================================

-- ============================================================================
-- 1. Tables
-- ============================================================================

create table if not exists public.expense_categories (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants (id) on delete cascade,
  name          text        not null,
  is_system     boolean     not null default false,
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, name)
);

create table if not exists public.expenses (
  id              uuid          primary key default gen_random_uuid(),
  restaurant_id   uuid          not null references public.restaurants (id) on delete cascade,
  branch_id       uuid          references public.branches (id) on delete set null,
  category_id     uuid          not null references public.expense_categories (id) on delete restrict,
  amount          numeric(12,2) not null check (amount > 0),
  expense_date    date          not null default current_date,
  payment_method  text          not null default 'cash'
    check (payment_method in ('cash', 'card', 'bkash', 'nagad', 'bank', 'due')),
  notes           text,
  attachment_url  text,
  created_by      uuid          references public.profiles (id) on delete set null,
  is_voided       boolean       not null default false,
  voided_at       timestamptz,
  voided_by       uuid          references public.profiles (id) on delete set null,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now()
);

create table if not exists public.cashier_shifts (
  id            uuid          primary key default gen_random_uuid(),
  restaurant_id uuid          not null references public.restaurants (id) on delete cascade,
  branch_id     uuid          references public.branches (id) on delete set null,
  opened_by     uuid          references public.profiles (id) on delete set null,
  opening_cash  numeric(12,2) not null default 0 check (opening_cash >= 0),
  status        text          not null default 'OPEN'
    check (status in ('OPEN', 'CLOSED')),
  opened_at     timestamptz   not null default now(),
  closed_by     uuid          references public.profiles (id) on delete set null,
  closed_at     timestamptz,
  expected_cash numeric(12,2),
  actual_cash   numeric(12,2),
  difference    numeric(12,2),
  notes         text,
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now()
);

-- One OPEN shift per cashier per restaurant.
create unique index if not exists cashier_shifts_one_open_per_user
  on public.cashier_shifts (restaurant_id, opened_by)
  where status = 'OPEN';

create table if not exists public.shift_cash_movements (
  id         uuid          primary key default gen_random_uuid(),
  shift_id   uuid          not null references public.cashier_shifts (id) on delete cascade,
  type       text          not null
    check (type in ('CASH_IN', 'CASH_OUT', 'ADJUSTMENT')),
  amount     numeric(12,2) not null
    check ((type in ('CASH_IN', 'CASH_OUT') and amount > 0)
        or (type = 'ADJUSTMENT' and amount <> 0)),
  reason     text          not null,
  created_by uuid          references public.profiles (id) on delete set null,
  created_at timestamptz   not null default now()
);

create table if not exists public.daily_closings (
  id            uuid          primary key default gen_random_uuid(),
  restaurant_id uuid          not null references public.restaurants (id) on delete cascade,
  branch_id     uuid          references public.branches (id) on delete set null,
  closing_date  date          not null,
  total_sales   numeric(12,2) not null default 0,
  total_purchases numeric(12,2) not null default 0,
  total_expenses  numeric(12,2) not null default 0,
  total_refunds   numeric(12,2) not null default 0,
  cash_expected numeric(12,2),
  cash_actual   numeric(12,2),
  difference    numeric(12,2),
  closed_by     uuid          references public.profiles (id) on delete set null,
  created_at    timestamptz   not null default now()
);

-- One closing per restaurant + branch + date (branch null coalesced).
create unique index if not exists daily_closings_unique_day
  on public.daily_closings (restaurant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), closing_date);

create index if not exists expenses_restaurant_date_idx
  on public.expenses (restaurant_id, expense_date);
create index if not exists cashier_shifts_restaurant_status_idx
  on public.cashier_shifts (restaurant_id, status);
create index if not exists shift_cash_movements_shift_idx
  on public.shift_cash_movements (shift_id, created_at);

-- ============================================================================
-- 2. updated_at triggers (tables that carry updated_at)
-- ============================================================================

drop trigger if exists trg_expense_categories_updated_at on public.expense_categories;
create trigger trg_expense_categories_updated_at
  before update on public.expense_categories
  for each row execute function public.set_updated_at();

drop trigger if exists trg_expenses_updated_at on public.expenses;
create trigger trg_expenses_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

drop trigger if exists trg_cashier_shifts_updated_at on public.cashier_shifts;
create trigger trg_cashier_shifts_updated_at
  before update on public.cashier_shifts
  for each row execute function public.set_updated_at();

-- ============================================================================
-- 3. Row Level Security
-- ============================================================================

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
alter table public.cashier_shifts enable row level security;
alter table public.shift_cash_movements enable row level security;
alter table public.daily_closings enable row level security;

-- expense_categories: full CRUD for restaurant members.
drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());
drop policy if exists expense_categories_insert on public.expense_categories;
create policy expense_categories_insert on public.expense_categories
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());
drop policy if exists expense_categories_update on public.expense_categories;
create policy expense_categories_update on public.expense_categories
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());
drop policy if exists expense_categories_delete on public.expense_categories;
create policy expense_categories_delete on public.expense_categories
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- expenses: select / insert / update only — NO delete policy (§46:
-- financial records are voided, never hard-deleted).
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());
drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

-- cashier_shifts: full CRUD for restaurant members (the UI offers no
-- delete; the policy matches the other operational tables).
drop policy if exists cashier_shifts_select on public.cashier_shifts;
create policy cashier_shifts_select on public.cashier_shifts
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());
drop policy if exists cashier_shifts_insert on public.cashier_shifts;
create policy cashier_shifts_insert on public.cashier_shifts
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());
drop policy if exists cashier_shifts_update on public.cashier_shifts;
create policy cashier_shifts_update on public.cashier_shifts
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());
drop policy if exists cashier_shifts_delete on public.cashier_shifts;
create policy cashier_shifts_delete on public.cashier_shifts
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

-- shift_cash_movements: append-only (select + insert), scoped through
-- the parent shift with EXISTS (the movements table carries no
-- restaurant_id of its own).
drop policy if exists shift_cash_movements_select on public.shift_cash_movements;
create policy shift_cash_movements_select on public.shift_cash_movements
  for select to authenticated
  using (exists (
    select 1 from public.cashier_shifts s
    where s.id = shift_id
      and s.restaurant_id = public.current_restaurant_id()
  ));
drop policy if exists shift_cash_movements_insert on public.shift_cash_movements;
create policy shift_cash_movements_insert on public.shift_cash_movements
  for insert to authenticated
  with check (exists (
    select 1 from public.cashier_shifts s
    where s.id = shift_id
      and s.restaurant_id = public.current_restaurant_id()
  ));

-- daily_closings: select / insert / update (re-closing a day updates
-- the snapshot through the unique index; no delete).
drop policy if exists daily_closings_select on public.daily_closings;
create policy daily_closings_select on public.daily_closings
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());
drop policy if exists daily_closings_insert on public.daily_closings;
create policy daily_closings_insert on public.daily_closings
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());
drop policy if exists daily_closings_update on public.daily_closings;
create policy daily_closings_update on public.daily_closings
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());
