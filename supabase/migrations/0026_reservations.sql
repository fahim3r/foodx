-- Migration 0026: reservations (RestoraPOS gap roadmap, Wave 3 gap 8b).
--
-- A reservation is a booking record, not an order: guest name/phone
-- are snapshots (walk-in guests may not be customers), reserved_for
-- is the expected arrival time, and the lifecycle is
-- BOOKED -> ARRIVED -> SEATED, with CANCELLED / NO_SHOW exits.
-- There is NO delete policy (§46: records are cancelled via status,
-- never deleted). v1 deliberately does NOT flip tables.status —
-- the table is a note of intent; staff seat the party themselves.
-- Overlapping bookings for the same table are a soft warning in the
-- UI, not a database block (restaurants overbook on purpose).

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid references public.tables(id) on delete set null,
  guest_name text not null,
  guest_phone text,
  reserved_for timestamptz not null,
  party_size integer not null default 1 check (party_size > 0),
  status text not null default 'BOOKED'
    check (status in ('BOOKED', 'ARRIVED', 'SEATED', 'CANCELLED', 'NO_SHOW')),
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reservations_restaurant_time_idx
  on public.reservations (restaurant_id, reserved_for);

alter table public.reservations enable row level security;

drop policy if exists reservations_select on public.reservations;
create policy reservations_select on public.reservations
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists reservations_insert on public.reservations;
create policy reservations_insert on public.reservations
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists reservations_update on public.reservations;
create policy reservations_update on public.reservations
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());
