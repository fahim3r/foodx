-- 0038_waiter_calls.sql
-- Call Waiter (user request, 2026-11-24; design:
-- WAITER_CALL_DESIGN.md): a dine-in customer at a table taps
-- "Call waiter" on the public storefront; the panel (Waiter page +
-- POS) shows the call live with a looping service-bell sound until
-- a staff member marks it Done.
--
-- Shape, following the codebase's established patterns:
--  - The storefront runs on the ANON key and tables have no anon
--    policy (0002/0007), so — exactly like place_online_order —
--    everything public goes through SECURITY DEFINER functions:
--    request_waiter_call() creates the call, waiter_call_pending()
--    answers the one boolean the customer's button polls, and
--    resolve_table_by_code() maps the QR code (?table=<qr value>,
--    the only table identity the storefront ever holds) to the
--    table id the other two functions take. It returns the id only,
--    for an exact code match inside the restaurant.
--  - One PENDING call per table, enforced twice: the RPC returns
--    the open call unchanged on a repeat tap, and a partial unique
--    index makes a racing double-tap collapse onto the same row.
--  - Staff read/attend through normal RLS policies scoped by
--    current_restaurant_id() (the 0002 tables pattern). There is
--    NO insert or delete policy for anyone: rows are born only in
--    the RPC and never deleted — attending flips status to DONE.
--  - waiter_calls joins supabase_realtime with the same guarded
--    DO block 0002 used for orders/order_items, so re-running
--    this migration cannot fail on the publication.
--
-- Idempotent: safe to re-run.

create table if not exists public.waiter_calls (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id uuid not null references public.tables (id) on delete cascade,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'DONE')),
  created_at timestamptz not null default now(),
  attended_by uuid references auth.users (id),
  attended_at timestamptz
);

create index if not exists waiter_calls_restaurant_status_idx
  on public.waiter_calls (restaurant_id, status, created_at);

-- At most one open call per table (see the header note).
create unique index if not exists waiter_calls_one_pending_per_table
  on public.waiter_calls (restaurant_id, table_id)
  where status = 'PENDING';

alter table public.waiter_calls enable row level security;

drop policy if exists waiter_calls_select on public.waiter_calls;
create policy waiter_calls_select on public.waiter_calls
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists waiter_calls_update on public.waiter_calls;
create policy waiter_calls_update on public.waiter_calls
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

-- --- request a call -----------------------------------------------------------
-- Validates the table exactly like place_online_order validates its
-- dine-in table (must exist, must belong to the restaurant), then
-- returns the table's open call — creating it when none is pending.
create or replace function public.request_waiter_call(
  p_restaurant_id uuid,
  p_table_id uuid
)
returns table (
  id uuid,
  restaurant_id uuid,
  table_id uuid,
  status text,
  created_at timestamptz,
  attended_by uuid,
  attended_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call public.waiter_calls;
begin
  if not exists (
    select 1 from public.tables t
    where t.id = p_table_id
      and t.restaurant_id = p_restaurant_id
  ) then
    raise exception 'table_not_found';
  end if;

  select * into v_call
  from public.waiter_calls wc
  where wc.restaurant_id = p_restaurant_id
    and wc.table_id = p_table_id
    and wc.status = 'PENDING'
  order by wc.created_at asc
  limit 1;
  if found then
    return query select
      v_call.id, v_call.restaurant_id, v_call.table_id, v_call.status,
      v_call.created_at, v_call.attended_by, v_call.attended_at;
    return;
  end if;

  begin
    insert into public.waiter_calls (restaurant_id, table_id)
    values (p_restaurant_id, p_table_id)
    returning * into v_call;
  exception when unique_violation then
    -- A simultaneous tap won the race; return its call instead.
    select * into v_call
    from public.waiter_calls wc
    where wc.restaurant_id = p_restaurant_id
      and wc.table_id = p_table_id
      and wc.status = 'PENDING'
    order by wc.created_at asc
    limit 1;
  end;

  return query select
    v_call.id, v_call.restaurant_id, v_call.table_id, v_call.status,
    v_call.created_at, v_call.attended_by, v_call.attended_at;
end;
$$;

grant execute on function public.request_waiter_call(uuid, uuid) to anon, authenticated;

-- --- is a call pending? -------------------------------------------------------
-- The only thing the customer's button polls after tapping: a bare
-- boolean, nothing about the call or the restaurant leaks.
create or replace function public.waiter_call_pending(
  p_restaurant_id uuid,
  p_table_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.waiter_calls wc
    where wc.restaurant_id = p_restaurant_id
      and wc.table_id = p_table_id
      and wc.status = 'PENDING'
  );
$$;

grant execute on function public.waiter_call_pending(uuid, uuid) to anon, authenticated;

-- --- resolve a table QR code ---------------------------------------------------
-- The storefront knows a table only by its QR code (the ?table=
-- value); this maps it to the table id inside the restaurant, the
-- same lookup place_online_order does internally. Returns NULL
-- when the code matches no table of the restaurant.
create or replace function public.resolve_table_by_code(
  p_restaurant_id uuid,
  p_table_code text
)
returns uuid
language sql
security definer
set search_path = public
as $$
  select t.id
  from public.tables t
  where t.restaurant_id = p_restaurant_id
    and t.qr_code = btrim(coalesce(p_table_code, ''))
  limit 1;
$$;

grant execute on function public.resolve_table_by_code(uuid, text) to anon, authenticated;

-- --- realtime -------------------------------------------------------------------
-- The panel's waiter-call strip + sound watcher listen to this
-- table; guarded exactly like 0002's orders/order_items block.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'waiter_calls'
    ) then
      execute 'alter publication supabase_realtime add table public.waiter_calls';
    end if;
  end if;
end
$$;
