-- Migration 0024 — manager PIN gate for cancel / refund (roadmap gap 6).
--
-- A restaurant may set a manager PIN (Settings). While one is set,
-- cancelling or refunding an order requires it: the two guarded RPCs
-- below verify the PIN server-side (SHA-256 of restaurant_id + ':' +
-- pin, via pgcrypto) and perform the transition + history + restock
-- themselves, so the check cannot be skipped by a tampered client.
-- With NO PIN set the gate is off and the RPCs behave exactly like
-- the old client flow (opt-in per restaurant). The hash lives in
-- restaurant_secrets, which has RLS enabled and NO policies — the
-- only way in or out is through these SECURITY DEFINER functions.
-- A forgotten PIN is recovered by an admin removing it in Settings
-- (remove_manager_pin is admin-gated at the database level).

create extension if not exists pgcrypto;

create table if not exists public.restaurant_secrets (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  manager_pin_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.restaurant_secrets enable row level security;

-- Whether the caller's restaurant has a manager PIN set.
create or replace function public.manager_pin_is_set()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.restaurant_secrets s
    where s.restaurant_id = public.current_restaurant_id()
  );
$$;

-- Set or change the PIN (restaurant admins only).
create or replace function public.set_manager_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_restaurant_admin() then
    raise exception 'not_admin';
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'pin_invalid';
  end if;
  insert into public.restaurant_secrets (restaurant_id, manager_pin_hash)
  values (
    public.current_restaurant_id(),
    encode(digest(public.current_restaurant_id()::text || ':' || p_pin, 'sha256'), 'hex')
  )
  on conflict (restaurant_id) do update
    set manager_pin_hash = excluded.manager_pin_hash,
        updated_at = now();
end;
$$;

-- Remove the PIN (restaurant admins only) — also the recovery path
-- for a forgotten PIN.
create or replace function public.remove_manager_pin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_restaurant_admin() then
    raise exception 'not_admin';
  end if;
  delete from public.restaurant_secrets
  where restaurant_id = public.current_restaurant_id();
end;
$$;

-- Cancel an order, verifying the manager PIN when one is set.
-- Mirrors the client flow it replaces: transition validation,
-- history row, best-effort restock, table release.
create or replace function public.cancel_order_guarded(
  p_order_id uuid,
  p_pin text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order public.orders%rowtype;
  v_hash text;
  v_note text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null
     or v_order.restaurant_id <> public.current_restaurant_id() then
    raise exception 'not_allowed';
  end if;
  if v_order.status not in
     ('DRAFT', 'CONFIRMED', 'SENT_TO_KITCHEN', 'PREPARING', 'READY', 'SERVED') then
    raise exception 'invalid_status_transition';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'cancel_reason_required';
  end if;

  select s.manager_pin_hash into v_hash
  from public.restaurant_secrets s
  where s.restaurant_id = v_order.restaurant_id;
  if v_hash is not null then
    if p_pin is null or btrim(p_pin) = '' then
      raise exception 'pin_required';
    end if;
    if encode(digest(v_order.restaurant_id::text || ':' || p_pin, 'sha256'), 'hex') <> v_hash then
      raise exception 'pin_incorrect';
    end if;
  end if;

  v_note := btrim(p_reason)
    || case when v_hash is not null then ' (PIN verified)' else '' end;

  update public.orders set status = 'CANCELLED' where id = p_order_id;
  insert into public.order_status_history
    (id, order_id, from_status, to_status, changed_by, note)
  values
    (gen_random_uuid(), p_order_id, v_order.status, 'CANCELLED', auth.uid(), v_note);

  begin
    perform public.restock_for_order(p_order_id);
  exception when others then
    null; -- best-effort, exactly like the client flow
  end;

  if v_order.table_id is not null then
    if not exists (
      select 1 from public.orders
      where table_id = v_order.table_id
        and status not in ('COMPLETED', 'CANCELLED', 'REFUNDED')
    ) then
      update public.tables set status = 'available' where id = v_order.table_id;
    end if;
  end if;
end;
$$;

-- Refund an order, verifying the manager PIN when one is set.
-- p_note is the full history note the client composes today
-- ("Refunded <amount> — <reason>").
create or replace function public.refund_order_guarded(
  p_order_id uuid,
  p_pin text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_order public.orders%rowtype;
  v_hash text;
  v_note text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null
     or v_order.restaurant_id <> public.current_restaurant_id() then
    raise exception 'not_allowed';
  end if;
  if v_order.status <> 'COMPLETED' then
    raise exception 'invalid_status_transition';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'refund_reason_required';
  end if;

  select s.manager_pin_hash into v_hash
  from public.restaurant_secrets s
  where s.restaurant_id = v_order.restaurant_id;
  if v_hash is not null then
    if p_pin is null or btrim(p_pin) = '' then
      raise exception 'pin_required';
    end if;
    if encode(digest(v_order.restaurant_id::text || ':' || p_pin, 'sha256'), 'hex') <> v_hash then
      raise exception 'pin_incorrect';
    end if;
  end if;

  v_note := btrim(p_note)
    || case when v_hash is not null then ' (PIN verified)' else '' end;

  update public.orders set status = 'REFUNDED' where id = p_order_id;
  insert into public.order_status_history
    (id, order_id, from_status, to_status, changed_by, note)
  values
    (gen_random_uuid(), p_order_id, v_order.status, 'REFUNDED', auth.uid(), v_note);
end;
$$;

grant execute on function public.manager_pin_is_set() to authenticated;
grant execute on function public.set_manager_pin(text) to authenticated;
grant execute on function public.remove_manager_pin() to authenticated;
grant execute on function public.cancel_order_guarded(uuid, text, text) to authenticated;
grant execute on function public.refund_order_guarded(uuid, text, text) to authenticated;
