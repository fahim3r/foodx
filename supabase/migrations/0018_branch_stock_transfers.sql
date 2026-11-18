-- FoodX migration 0018 — Phase 7 Step 2B: branch stock + transfers
-- (§40 branches, §41 branch inventory).
--
-- Today stock is restaurant-wide: inventory_items.current_quantity,
-- changed only through the SECURITY DEFINER functions from 0003/0004,
-- with stock_movements as the append-only audit trail. This migration
-- adds a per-branch layer WITHOUT changing the global totals:
--
--   1. stock_movements.branch_id — which branch a movement hit.
--   2. branch_stock — quantity per (branch, item). Written ONLY by
--      the definer functions below (SELECT-only RLS, mirroring
--      stock_movements); the app reads it directly.
--   3. apply_stock_movement() gains p_branch_id (default null →
--      the restaurant's main branch) and keeps branch_stock in sync
--      with the global quantity for every non-transfer movement.
--   4. deduct_stock_for_order() passes the order's branch;
--      restock_for_order() credits the branch the SALE debited.
--   5. stock_transfers + stock_transfer_items (§41 flow:
--      REQUESTED → APPROVED → RECEIVED, plus REJECTED / CANCELLED).
--      Receiving is one definer function, receive_stock_transfer():
--      it checks the source branch holds enough, writes the
--      TRANSFER_OUT / TRANSFER_IN movements and moves branch_stock —
--      all in one transaction, so a failed receive changes nothing.
--      Transfers never touch the global current_quantity.
--   6. Backfill: each item's current quantity lands on its
--      restaurant's main branch (restaurants without a main branch
--      are skipped; backfill_branch_stock() covers a main branch
--      created later, and only fills rows that do not exist yet).
--
-- Idempotent: safe to re-run.

-- --- 1. movements learn their branch ----------------------------------------

alter table public.stock_movements
  add column if not exists branch_id uuid
    references public.branches (id) on delete set null;

-- --- 2. branch_stock ---------------------------------------------------------

create table if not exists public.branch_stock (
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  branch_id         uuid not null references public.branches (id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items (id) on delete cascade,
  quantity          numeric not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (branch_id, inventory_item_id)
);

create index if not exists branch_stock_restaurant_idx
  on public.branch_stock (restaurant_id, branch_id);

alter table public.branch_stock enable row level security;

-- SELECT only: writes happen inside the definer functions (same rule
-- as stock_movements in 0003).
drop policy if exists branch_stock_select on public.branch_stock;
create policy branch_stock_select on public.branch_stock
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop trigger if exists branch_stock_set_updated_at on public.branch_stock;
create trigger branch_stock_set_updated_at
  before update on public.branch_stock
  for each row execute function public.set_updated_at();

-- --- 3. transfers ------------------------------------------------------------

create table if not exists public.stock_transfers (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  from_branch_id uuid not null references public.branches (id) on delete restrict,
  to_branch_id   uuid not null references public.branches (id) on delete restrict,
  status        text not null default 'REQUESTED'
    check (status in ('REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'CANCELLED')),
  notes         text,
  requested_by  uuid references public.profiles (id) on delete set null,
  approved_by   uuid references public.profiles (id) on delete set null,
  approved_at   timestamptz,
  received_by   uuid references public.profiles (id) on delete set null,
  received_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (from_branch_id <> to_branch_id)
);

create index if not exists stock_transfers_restaurant_idx
  on public.stock_transfers (restaurant_id, created_at desc);

create table if not exists public.stock_transfer_items (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  transfer_id       uuid not null references public.stock_transfers (id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  quantity          numeric not null check (quantity > 0),
  unique (transfer_id, inventory_item_id)
);

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;

drop policy if exists stock_transfers_select on public.stock_transfers;
create policy stock_transfers_select on public.stock_transfers
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists stock_transfers_insert on public.stock_transfers;
create policy stock_transfers_insert on public.stock_transfers
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists stock_transfers_update on public.stock_transfers;
create policy stock_transfers_update on public.stock_transfers
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

-- No DELETE policies: transfers are the §41 audit history.

drop policy if exists stock_transfer_items_select on public.stock_transfer_items;
create policy stock_transfer_items_select on public.stock_transfer_items
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists stock_transfer_items_insert on public.stock_transfer_items;
create policy stock_transfer_items_insert on public.stock_transfer_items
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop trigger if exists stock_transfers_set_updated_at on public.stock_transfers;
create trigger stock_transfers_set_updated_at
  before update on public.stock_transfers
  for each row execute function public.set_updated_at();

-- --- 4. apply_stock_movement(): branch-aware ---------------------------------
-- The 6-argument signature from 0003/0004 is dropped first so calls
-- with six arguments resolve unambiguously to the new 7-argument
-- version (p_branch_id defaults to null → main branch).

drop function if exists public.apply_stock_movement(uuid, text, numeric, text, text, uuid);

create or replace function public.apply_stock_movement(
  p_item_id uuid,
  p_type text,
  p_delta numeric,
  p_reason text default null,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_branch_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_new_quantity numeric;
  v_branch_id uuid;
begin
  if p_type not in ('PURCHASE', 'SALE', 'ADJUSTMENT', 'WASTE', 'TRANSFER_IN', 'TRANSFER_OUT', 'RESTOCK') then
    raise exception 'invalid movement type: %', p_type;
  end if;
  if p_delta = 0 then
    raise exception 'movement quantity must not be zero';
  end if;

  select restaurant_id into v_restaurant_id
  from public.inventory_items
  where id = p_item_id;
  if v_restaurant_id is null then
    raise exception 'inventory item not found';
  end if;
  if v_restaurant_id is distinct from public.current_restaurant_id() then
    raise exception 'inventory item belongs to another restaurant';
  end if;

  -- Resolve the branch: explicit, else the restaurant's main branch,
  -- else null (restaurant has no branches yet — global stock only).
  if p_branch_id is not null then
    if not exists (
      select 1 from public.branches
      where id = p_branch_id and restaurant_id = v_restaurant_id
    ) then
      raise exception 'branch belongs to another restaurant';
    end if;
    v_branch_id := p_branch_id;
  else
    select id into v_branch_id
    from public.branches
    where restaurant_id = v_restaurant_id and is_main
    order by created_at
    limit 1;
  end if;

  insert into public.stock_movements
    (restaurant_id, inventory_item_id, movement_type, quantity_change,
     reference_type, reference_id, reason, created_by, branch_id)
  values
    (v_restaurant_id, p_item_id, p_type, p_delta,
     p_reference_type, p_reference_id, p_reason, auth.uid(), v_branch_id);

  update public.inventory_items
  set current_quantity = current_quantity + p_delta
  where id = p_item_id
  returning current_quantity into v_new_quantity;

  if v_branch_id is not null then
    insert into public.branch_stock
      (restaurant_id, branch_id, inventory_item_id, quantity)
    values
      (v_restaurant_id, v_branch_id, p_item_id, p_delta)
    on conflict (branch_id, inventory_item_id)
    do update set quantity = public.branch_stock.quantity + excluded.quantity,
                  updated_at = now();
  end if;

  return v_new_quantity;
end;
$$;

grant execute on function public.apply_stock_movement(uuid, text, numeric, text, text, uuid, uuid) to authenticated;
revoke execute on function public.apply_stock_movement(uuid, text, numeric, text, text, uuid, uuid) from anon;

-- --- 5. deduct_stock_for_order(): the order's branch -------------------------

create or replace function public.deduct_stock_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_order_number integer;
  v_branch_id uuid;
  v_already_deducted boolean;
  r record;
begin
  select restaurant_id, order_number, branch_id
  into v_restaurant_id, v_order_number, v_branch_id
  from public.orders
  where id = p_order_id;
  if v_restaurant_id is null then
    raise exception 'order not found';
  end if;
  if v_restaurant_id is distinct from public.current_restaurant_id() then
    raise exception 'order belongs to another restaurant';
  end if;

  select exists (
    select 1 from public.stock_movements
    where reference_type = 'order'
      and reference_id = p_order_id
      and movement_type = 'SALE'
  ) into v_already_deducted;
  if v_already_deducted then
    return;
  end if;

  for r in
    select pr.inventory_item_id as item_id,
           sum(oi.quantity * pr.quantity_per_unit) as total_needed
    from public.order_items oi
    join public.product_recipes pr on pr.product_id = oi.product_id
    where oi.order_id = p_order_id
    group by pr.inventory_item_id
  loop
    perform public.apply_stock_movement(
      r.item_id, 'SALE', -r.total_needed,
      'Sale — order #' || v_order_number, 'order', p_order_id, v_branch_id
    );
  end loop;
end;
$$;

grant execute on function public.deduct_stock_for_order(uuid) to authenticated;
revoke execute on function public.deduct_stock_for_order(uuid) from anon;

-- --- 6. restock_for_order(): credit the branch the SALE debited --------------

create or replace function public.restock_for_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_order_number integer;
  v_has_sale boolean;
  v_has_restock boolean;
  r record;
begin
  select restaurant_id, order_number into v_restaurant_id, v_order_number
  from public.orders
  where id = p_order_id;
  if v_restaurant_id is null then
    raise exception 'order not found';
  end if;
  if v_restaurant_id is distinct from public.current_restaurant_id() then
    raise exception 'order belongs to another restaurant';
  end if;

  select exists (
    select 1 from public.stock_movements
    where reference_type = 'order'
      and reference_id = p_order_id
      and movement_type = 'SALE'
  ) into v_has_sale;
  if not v_has_sale then
    return;
  end if;

  select exists (
    select 1 from public.stock_movements
    where reference_type = 'order'
      and reference_id = p_order_id
      and movement_type = 'RESTOCK'
  ) into v_has_restock;
  if v_has_restock then
    return;
  end if;

  for r in
    select inventory_item_id as item_id, quantity_change, branch_id
    from public.stock_movements
    where reference_type = 'order'
      and reference_id = p_order_id
      and movement_type = 'SALE'
  loop
    perform public.apply_stock_movement(
      r.item_id, 'RESTOCK', -r.quantity_change,
      'Restock — order #' || v_order_number || ' cancelled', 'order', p_order_id,
      r.branch_id
    );
  end loop;
end;
$$;

grant execute on function public.restock_for_order(uuid) to authenticated;
revoke execute on function public.restock_for_order(uuid) from anon;

-- --- 7. receive_stock_transfer(): the atomic §41 receive ---------------------

create or replace function public.receive_stock_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transfer record;
  v_from_name text;
  v_to_name text;
  r record;
  v_available numeric;
begin
  select * into v_transfer
  from public.stock_transfers
  where id = p_transfer_id;
  if v_transfer is null then
    raise exception 'transfer_not_found';
  end if;
  if v_transfer.restaurant_id is distinct from public.current_restaurant_id() then
    raise exception 'transfer belongs to another restaurant';
  end if;
  if v_transfer.status <> 'APPROVED' then
    raise exception 'transfer_not_approved';
  end if;

  select name into v_from_name from public.branches where id = v_transfer.from_branch_id;
  select name into v_to_name from public.branches where id = v_transfer.to_branch_id;

  -- Check everything before moving anything (the function body is
  -- one transaction, so a raise here rolls back any partial work).
  for r in
    select inventory_item_id, quantity
    from public.stock_transfer_items
    where transfer_id = p_transfer_id
  loop
    select quantity into v_available
    from public.branch_stock
    where branch_id = v_transfer.from_branch_id
      and inventory_item_id = r.inventory_item_id;
    if coalesce(v_available, 0) < r.quantity then
      raise exception 'insufficient_branch_stock';
    end if;
  end loop;

  for r in
    select inventory_item_id, quantity
    from public.stock_transfer_items
    where transfer_id = p_transfer_id
  loop
    insert into public.stock_movements
      (restaurant_id, inventory_item_id, movement_type, quantity_change,
       reference_type, reference_id, reason, created_by, branch_id)
    values
      (v_transfer.restaurant_id, r.inventory_item_id, 'TRANSFER_OUT', -r.quantity,
       'transfer', p_transfer_id,
       'Transfer to ' || coalesce(v_to_name, ''), auth.uid(), v_transfer.from_branch_id),
      (v_transfer.restaurant_id, r.inventory_item_id, 'TRANSFER_IN', r.quantity,
       'transfer', p_transfer_id,
       'Transfer from ' || coalesce(v_from_name, ''), auth.uid(), v_transfer.to_branch_id);

    update public.branch_stock
    set quantity = quantity - r.quantity, updated_at = now()
    where branch_id = v_transfer.from_branch_id
      and inventory_item_id = r.inventory_item_id;

    insert into public.branch_stock
      (restaurant_id, branch_id, inventory_item_id, quantity)
    values
      (v_transfer.restaurant_id, v_transfer.to_branch_id, r.inventory_item_id, r.quantity)
    on conflict (branch_id, inventory_item_id)
    do update set quantity = public.branch_stock.quantity + excluded.quantity,
                  updated_at = now();
  end loop;

  update public.stock_transfers
  set status = 'RECEIVED', received_by = auth.uid(), received_at = now()
  where id = p_transfer_id;
end;
$$;

grant execute on function public.receive_stock_transfer(uuid) to authenticated;
revoke execute on function public.receive_stock_transfer(uuid) from anon;

-- --- 8. backfill_branch_stock(): fill missing rows from global totals --------
-- For a restaurant whose main branch was created after this
-- migration. Only inserts rows that do not exist yet — it never
-- overwrites quantities that movements have since changed.

create or replace function public.backfill_branch_stock()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid := public.current_restaurant_id();
  v_main_branch uuid;
  v_count integer := 0;
begin
  if v_restaurant_id is null then
    return 0;
  end if;
  select id into v_main_branch
  from public.branches
  where restaurant_id = v_restaurant_id and is_main
  order by created_at
  limit 1;
  if v_main_branch is null then
    return 0;
  end if;
  insert into public.branch_stock
    (restaurant_id, branch_id, inventory_item_id, quantity)
  select v_restaurant_id, v_main_branch, id, current_quantity
  from public.inventory_items
  where restaurant_id = v_restaurant_id and current_quantity <> 0
  on conflict (branch_id, inventory_item_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.backfill_branch_stock() to authenticated;
revoke execute on function public.backfill_branch_stock() from anon;

-- --- 9. backfill existing data ------------------------------------------------

insert into public.branch_stock
  (restaurant_id, branch_id, inventory_item_id, quantity)
select i.restaurant_id, b.id, i.id, i.current_quantity
from public.inventory_items i
join public.branches b
  on b.restaurant_id = i.restaurant_id and b.is_main
where i.current_quantity <> 0
on conflict (branch_id, inventory_item_id) do nothing;
