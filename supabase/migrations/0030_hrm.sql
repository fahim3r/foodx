-- 0030: HRM v1 (modifications v2, item 10) — employee directory
-- + attendance. Salary data gets a real database boundary: every
-- policy (read AND write) requires is_restaurant_admin(), so a
-- non-admin login cannot even read the tables through the API.
-- No DELETE policies: people leave via status (§46 pattern).

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  full_name text not null,
  phone text,
  designation text,
  monthly_salary numeric,
  join_date date,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employees_restaurant_idx
  on public.employees (restaurant_id, status);

drop trigger if exists trg_employees_updated_at on public.employees;
create trigger trg_employees_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  day date not null,
  status text not null
    check (status in ('present', 'absent', 'leave', 'half_day')),
  note text,
  marked_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, day)
);

create index if not exists attendance_restaurant_day_idx
  on public.attendance (restaurant_id, day);

drop trigger if exists trg_attendance_updated_at on public.attendance;
create trigger trg_attendance_updated_at
  before update on public.attendance
  for each row execute function public.set_updated_at();

alter table public.employees enable row level security;
alter table public.attendance enable row level security;

drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  for select to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and public.is_restaurant_admin()
  );

drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees
  for insert to authenticated
  with check (
    restaurant_id = public.current_restaurant_id()
    and public.is_restaurant_admin()
  );

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees
  for update to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and public.is_restaurant_admin()
  )
  with check (
    restaurant_id = public.current_restaurant_id()
    and public.is_restaurant_admin()
  );

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and public.is_restaurant_admin()
  );

drop policy if exists attendance_insert on public.attendance;
create policy attendance_insert on public.attendance
  for insert to authenticated
  with check (
    restaurant_id = public.current_restaurant_id()
    and public.is_restaurant_admin()
  );

drop policy if exists attendance_update on public.attendance;
create policy attendance_update on public.attendance
  for update to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and public.is_restaurant_admin()
  )
  with check (
    restaurant_id = public.current_restaurant_id()
    and public.is_restaurant_admin()
  );
