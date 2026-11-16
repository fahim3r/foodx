-- ============================================================================
-- FoodX — Phase 5 (Digital Ordering)
-- Migration 0007: per-restaurant domains, public storefront, online orders
-- ============================================================================
-- WHAT THIS ADDS:
--   - restaurant_domains: one row per custom domain a restaurant owns
--     (e.g. addabuzz.com). The app resolves the hostname to a restaurant
--     and serves the public menu at the domain root; /panel on the same
--     domain serves the admin app.
--   - orders.source ('POS' | 'QR' | 'ONLINE') + guest contact columns
--     (customer_name / customer_phone / delivery_address / delivery_fee)
--     so an online order carries who placed it and where it goes.
--   - orders.type gains 'pickup' (the existing 'dine_in' / 'takeaway' /
--     'delivery' CHECK is widened — NO separate delivery_type column:
--     the existing `type` already is the delivery type).
--   - restaurant_settings gains delivery_enabled / delivery_fee /
--     min_order_amount.
--   - tables gains nfc_value (the URL written to the table's NFC tag —
--     the same URL as the table QR code).
--   - Three SECURITY DEFINER functions (all granted to anon +
--     authenticated — the public storefront has no login):
--       resolve_restaurant_by_domain, place_online_order,
--       get_online_order_status.
--   - A public view restaurant_storefronts (restaurant info for the
--     storefront; the storefront never reads the base tables).
--   - Anon SELECT policies on the five menu tables (categories,
--     products, product_variants, product_modifiers, modifiers): a
--     public menu must be readable without login. None of these tables
--     carries a sensitive column (products has no cost_price), so a
--     plain `using (true)` anon policy is safe — menus are public data
--     by design.
--
-- SERVER-SIDE PRICING (the Phase 2 rule, unchanged): place_online_order
-- re-reads every price from the database and computes all totals itself;
-- the client sends only ids + quantities. The totals formula mirrors
-- computeOrderTotals() in src/services/pos.ts exactly (subtotal −
-- discounts, tax + service charge on the taxable amount, delivery fee
-- added after tax — the fee itself is not taxed).
--
-- STOCK: place_online_order deducts recipe ingredients INLINE (insert a
-- SALE movement + update the item quantity per ingredient, same shape as
-- deduct_stock_for_order). It CANNOT call deduct_stock_for_order() or
-- apply_stock_movement(): both verify current_restaurant_id(), which is
-- NULL for an anonymous caller (no profile), so they would raise
-- "belongs to another restaurant". The function already validated the
-- restaurant by slug, so the inline deduction is equally safe.
--
-- IDEMPOTENT where practical (IF NOT EXISTS, conditional DO blocks).
-- 0 DROP TABLE / DELETE FROM / TRUNCATE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- restaurant_domains
-- ----------------------------------------------------------------------------
create table if not exists public.restaurant_domains (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references public.restaurants (id) on delete cascade,
  -- Stored LOWERCASE + trimmed (the service normalises on write, and
  -- resolve_restaurant_by_domain() lowercases the lookup too).
  domain        text        not null,
  -- One primary per restaurant: enforced in the service (setting a new
  -- primary clears the old one), not by the database.
  is_primary    boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (domain)
);

create index if not exists idx_restaurant_domains_restaurant_id
  on public.restaurant_domains (restaurant_id);

alter table public.restaurant_domains enable row level security;

drop policy if exists restaurant_domains_select on public.restaurant_domains;
create policy restaurant_domains_select on public.restaurant_domains
  for select to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop policy if exists restaurant_domains_insert on public.restaurant_domains;
create policy restaurant_domains_insert on public.restaurant_domains
  for insert to authenticated
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists restaurant_domains_update on public.restaurant_domains;
create policy restaurant_domains_update on public.restaurant_domains
  for update to authenticated
  using (restaurant_id = public.current_restaurant_id())
  with check (restaurant_id = public.current_restaurant_id());

drop policy if exists restaurant_domains_delete on public.restaurant_domains;
create policy restaurant_domains_delete on public.restaurant_domains
  for delete to authenticated
  using (restaurant_id = public.current_restaurant_id());

drop trigger if exists trg_restaurant_domains_updated_at on public.restaurant_domains;
create trigger trg_restaurant_domains_updated_at
  before update on public.restaurant_domains
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- orders: source + guest contact columns; type gains 'pickup'
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists source text not null default 'POS',
  add column if not exists customer_name text,
  add column if not exists customer_phone text,
  add column if not exists delivery_address text,
  add column if not exists delivery_fee numeric(12,2) not null default 0;

-- Source CHECK, added only when no source check exists yet.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%source in%'
  ) then
    alter table public.orders
      add constraint orders_source_check
      check (source in ('POS', 'QR', 'ONLINE'));
  end if;
end $$;

-- Widen the existing type CHECK ('dine_in','takeaway','delivery') to also
-- allow 'pickup'. The old constraint is dropped by name lookup (same
-- pattern as 0004), then the four-value check is added.
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.orders'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%type in%';
  if cname is not null then
    execute format('alter table public.orders drop constraint %I', cname);
  end if;
end $$;

alter table public.orders
  add constraint orders_type_check
  check (type in ('dine_in', 'takeaway', 'delivery', 'pickup'));

-- ----------------------------------------------------------------------------
-- restaurant_settings: delivery options
-- ----------------------------------------------------------------------------
alter table public.restaurant_settings
  add column if not exists delivery_enabled boolean not null default false,
  add column if not exists delivery_fee numeric(12,2) not null default 0,
  add column if not exists min_order_amount numeric(12,2) not null default 0;

-- ----------------------------------------------------------------------------
-- tables: NFC tag value (same URL as the table QR code)
-- ----------------------------------------------------------------------------
alter table public.tables
  add column if not exists nfc_value text;

-- ============================================================================
-- Public storefront view
-- ============================================================================
-- The storefront reads restaurant info ONLY through this view, never the
-- base tables. A view runs with the owner's privileges (security_invoker
-- is off by default), so granting SELECT on the view is enough — no
-- grants on restaurants / restaurant_settings are needed, and their RLS
-- (authenticated-only) does not block the public read.
create or replace view public.restaurant_storefronts as
select
  r.id as restaurant_id,
  r.slug,
  r.name,
  r.default_currency,
  r.timezone,
  s.branding_name,
  s.logo_url,
  s.primary_color,
  s.currency,
  s.tax_rate,
  s.service_charge_rate,
  s.delivery_enabled,
  s.delivery_fee,
  s.min_order_amount
from public.restaurants r
left join public.restaurant_settings s
  on s.restaurant_id = r.id;

grant select on public.restaurant_storefronts to anon, authenticated;

-- ============================================================================
-- Anon SELECT policies on the menu tables (the public menu)
-- ============================================================================
-- Menus are public data by design. These tables carry no sensitive
-- column (products has no cost_price), so `using (true)` is safe. The
-- existing authenticated policies stay in place alongside these.
drop policy if exists categories_select_anon on public.categories;
create policy categories_select_anon on public.categories
  for select to anon
  using (true);

drop policy if exists products_select_anon on public.products;
create policy products_select_anon on public.products
  for select to anon
  using (true);

drop policy if exists product_variants_select_anon on public.product_variants;
create policy product_variants_select_anon on public.product_variants
  for select to anon
  using (true);

drop policy if exists product_modifiers_select_anon on public.product_modifiers;
create policy product_modifiers_select_anon on public.product_modifiers
  for select to anon
  using (true);

drop policy if exists modifiers_select_anon on public.modifiers;
create policy modifiers_select_anon on public.modifiers
  for select to anon
  using (true);

-- ============================================================================
-- resolve_restaurant_by_domain(p_domain)
-- ============================================================================
-- Returns the restaurant a hostname belongs to (id, slug, name) — the
-- app boot calls this to decide storefront vs admin. Tries the exact
-- host first, then the host without a leading 'www.'. Only restaurants
-- with status 'active' resolve. Nothing besides id/slug/name leaves.
create or replace function public.resolve_restaurant_by_domain(p_domain text)
returns table (restaurant_id uuid, slug text, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host text := lower(btrim(coalesce(p_domain, '')));
begin
  if v_host = '' then
    return;
  end if;
  return query
  select r.id, r.slug, r.name
  from public.restaurant_domains d
  join public.restaurants r on r.id = d.restaurant_id
  where lower(btrim(d.domain)) = v_host
    and r.status = 'active'
  limit 1;
  if not found then
    if v_host like 'www.%' then
      return query
      select r.id, r.slug, r.name
      from public.restaurant_domains d
      join public.restaurants r on r.id = d.restaurant_id
      where lower(btrim(d.domain)) = substr(v_host, 5)
        and r.status = 'active'
      limit 1;
    end if;
  end if;
end;
$$;

grant execute on function public.resolve_restaurant_by_domain(text) to anon, authenticated;

-- ============================================================================
-- place_online_order(...)
-- ============================================================================
-- The server-side order path for the public storefront (no login, no
-- payment online — the order is unpaid, due = total, paid at the
-- restaurant). Everything happens in ONE function, so placement is
-- atomic: validation, pricing, order + items + modifiers, history,
-- customer link, stock deduction.
--
-- Errors are short machine-readable messages the client maps to i18n:
--   unknown_restaurant | invalid_delivery_type | customer_required |
--   empty_order | invalid_item | table_not_found |
--   delivery_not_available | delivery_address_required |
--   min_order_not_met
-- Delivery types use the same lowercase values as orders.type:
-- 'dine_in' | 'takeaway' | 'delivery' | 'pickup'.
-- p_items is a JSONB array of:
--   {"product_id": uuid, "variant_id": uuid|null,
--    "modifier_ids": [uuid, ...], "quantity": int}
create or replace function public.place_online_order(
  p_slug text,
  p_table_code text,
  p_delivery_type text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_items jsonb
)
returns table (order_id uuid, order_number integer, table_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_restaurant_name text;
  v_tax_rate numeric(5,2);
  v_service_charge_rate numeric(5,2);
  v_delivery_enabled boolean;
  v_delivery_fee numeric(12,2);
  v_min_order_amount numeric(12,2);
  v_table_id uuid;
  v_table_name text;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number integer;
  v_attempt integer := 0;
  v_subtotal numeric(12,2) := 0;
  v_tax_amount numeric(12,2);
  v_service_charge_amount numeric(12,2);
  v_total_amount numeric(12,2);
  v_source text;
  v_item jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_modifier_id uuid;
  v_quantity integer;
  v_product_price numeric(12,2);
  v_product_name text;
  v_variant_adjustment numeric(12,2);
  v_variant_name text;
  v_modifier_price numeric(12,2);
  v_modifier_name text;
  v_unit_price numeric(12,2);
  v_line_total numeric(12,2);
  v_item_id uuid;
  v_items_count integer := 0;
  r record;
begin
  -- --- resolve the restaurant (must exist and be active) ----------------
  select r.id, r.name into v_restaurant_id, v_restaurant_name
  from public.restaurants r
  where r.slug = btrim(coalesce(p_slug, ''))
    and r.status = 'active';
  if v_restaurant_id is null then
    raise exception 'unknown_restaurant';
  end if;

  -- --- validate the delivery type ----------------------------------------
  if coalesce(p_delivery_type, '') not in ('dine_in', 'takeaway', 'delivery', 'pickup') then
    raise exception 'invalid_delivery_type';
  end if;

  -- --- validate the customer (name + phone are required: the restaurant
  -- needs to reach the customer, the phone unlocks the status lookup,
  -- and the phone links the order to a loyalty customer) ------------------
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'customer_required';
  end if;
  if btrim(coalesce(p_customer_phone, '')) = '' then
    raise exception 'customer_required';
  end if;

  -- --- validate the items array ------------------------------------------
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order';
  end if;

  -- --- read the restaurant's pricing + delivery settings -----------------
  select
    coalesce(s.tax_rate, 0),
    coalesce(s.service_charge_rate, 0),
    coalesce(s.delivery_enabled, false),
    coalesce(s.delivery_fee, 0),
    coalesce(s.min_order_amount, 0)
  into
    v_tax_rate,
    v_service_charge_rate,
    v_delivery_enabled,
    v_delivery_fee,
    v_min_order_amount
  from public.restaurant_settings s
  where s.restaurant_id = v_restaurant_id;

  -- --- dine-in needs a real table of this restaurant ---------------------
  if p_delivery_type = 'dine_in' then
    if btrim(coalesce(p_table_code, '')) = '' then
      raise exception 'table_not_found';
    end if;
    select t.id, t.name into v_table_id, v_table_name
    from public.tables t
    where t.restaurant_id = v_restaurant_id
      and t.qr_code = btrim(p_table_code);
    if v_table_id is null then
      raise exception 'table_not_found';
    end if;
  end if;

  -- --- price every line from the database (never trust client prices) ----
  -- First pass: validate + price. Priced lines are re-read in the second
  -- pass below when the order items are written, so the stored prices
  -- are the same values validated here.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_items_count := v_items_count + 1;
    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception when others then
      raise exception 'invalid_item';
    end;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'invalid_item';
    end;
    begin
      v_product_id := (v_item ->> 'product_id')::uuid;
      v_variant_id := nullif(v_item ->> 'variant_id', '')::uuid;
    exception when others then
      raise exception 'invalid_item';
    end;
    if v_product_id is null then
      raise exception 'invalid_item';
    end;

    select p.price, p.name into v_product_price, v_product_name
    from public.products p
    where p.id = v_product_id
      and p.restaurant_id = v_restaurant_id
      and p.is_available = true;
    if v_product_price is null then
      raise exception 'invalid_item';
    end;

    v_unit_price := v_product_price;
    if v_variant_id is not null then
      select pv.price_adjustment, pv.name
      into v_variant_adjustment, v_variant_name
      from public.product_variants pv
      where pv.id = v_variant_id
        and pv.product_id = v_product_id
        and pv.is_active = true;
      if v_variant_adjustment is null then
        raise exception 'invalid_item';
      end if;
      v_unit_price := v_unit_price + v_variant_adjustment;
    end if;

    if jsonb_typeof(coalesce(v_item -> 'modifier_ids', '[]'::jsonb)) <> 'array' then
      raise exception 'invalid_item';
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_item -> 'modifier_ids', '[]'::jsonb)) as value
      where value !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      raise exception 'invalid_item';
    end if;
    for v_modifier_id in
      select value::uuid
      from jsonb_array_elements_text(coalesce(v_item -> 'modifier_ids', '[]'::jsonb)) as value
    loop
      select m.price into v_modifier_price
      from public.modifiers m
      where m.id = v_modifier_id
        and m.restaurant_id = v_restaurant_id
        and m.is_active = true
        and exists (
          select 1 from public.product_modifiers pm
          where pm.product_id = v_product_id
            and pm.modifier_id = v_modifier_id
        );
      if v_modifier_price is null then
        raise exception 'invalid_item';
      end if;
      v_unit_price := v_unit_price + v_modifier_price;
    end loop;

    v_unit_price := round(v_unit_price, 2);
    v_subtotal := v_subtotal + round(v_unit_price * v_quantity, 2);
  end loop;
  v_subtotal := round(v_subtotal, 2);

  -- --- delivery rules (checked after pricing: the minimum is on the
  -- subtotal, before tax) --------------------------------------------------
  if p_delivery_type = 'delivery' then
    if not v_delivery_enabled then
      raise exception 'delivery_not_available';
    end if;
    if btrim(coalesce(p_delivery_address, '')) = '' then
      raise exception 'delivery_address_required';
    end if;
    if v_min_order_amount > 0 and v_subtotal < v_min_order_amount then
      raise exception 'min_order_not_met';
    end if;
  end if;
  if p_delivery_type = 'pickup' and v_min_order_amount > 0 and v_subtotal < v_min_order_amount then
    raise exception 'min_order_not_met';
  end if;

  -- --- totals: same formula as computeOrderTotals() ----------------------
  -- No discounts online (coupons + loyalty redemption are POS-only in
  -- v1). Tax + service charge apply to the subtotal; the delivery fee
  -- is added after tax and is not taxed itself.
  v_tax_amount := round(v_subtotal * v_tax_rate / 100, 2);
  v_service_charge_amount := round(v_subtotal * v_service_charge_rate / 100, 2);
  v_total_amount := round(
    v_subtotal + v_tax_amount + v_service_charge_amount
    + case when p_delivery_type = 'delivery' then v_delivery_fee else 0 end,
    2
  );
  v_source := case when v_table_id is not null then 'QR' else 'ONLINE' end;

  -- --- link or create the customer by phone (never overwrite an
  -- existing customer's name) ----------------------------------------------
  insert into public.customers (restaurant_id, name, phone)
  values (v_restaurant_id, btrim(p_customer_name), btrim(p_customer_phone))
  on conflict (restaurant_id, phone) do nothing
  returning id into v_customer_id;
  if v_customer_id is null then
    select c.id into v_customer_id
    from public.customers c
    where c.restaurant_id = v_restaurant_id
      and c.phone = btrim(p_customer_phone);
  end if;

  -- --- insert the order (CONFIRMED, unpaid — paid at the restaurant).
  -- Order numbers are sequential per restaurant (MAX+1); a collision
  -- retries with a fresh number, up to 3 attempts.
  v_order_id := gen_random_uuid();
  loop
    v_attempt := v_attempt + 1;
    select coalesce(max(order_number), 0) + 1 into v_order_number
    from public.orders
    where restaurant_id = v_restaurant_id;
    begin
      insert into public.orders (
        id, restaurant_id, table_id, order_number, type, source, status,
        subtotal, discount_amount, tax_amount, service_charge_amount,
        total_amount, delivery_fee,
        customer_id, customer_name, customer_phone, delivery_address,
        notes, created_by
      ) values (
        v_order_id, v_restaurant_id, v_table_id, v_order_number,
        p_delivery_type, v_source, 'CONFIRMED',
        v_subtotal, 0, v_tax_amount, v_service_charge_amount,
        v_total_amount,
        case when p_delivery_type = 'delivery' then v_delivery_fee else 0 end,
        v_customer_id, btrim(p_customer_name), btrim(p_customer_phone),
        nullif(btrim(coalesce(p_delivery_address, '')), ''),
        null, null
      );
      exit;
    exception when unique_violation then
      if v_attempt >= 3 then
        raise;
      end if;
    end;
  end loop;

  -- --- second pass: write the priced items + their modifiers -------------
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item ->> 'product_id')::uuid;
    v_variant_id := nullif(v_item ->> 'variant_id', '')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    select p.price, p.name into v_product_price, v_product_name
    from public.products p
    where p.id = v_product_id;
    v_unit_price := v_product_price;
    v_variant_name := null;
    if v_variant_id is not null then
      select pv.price_adjustment, pv.name
      into v_variant_adjustment, v_variant_name
      from public.product_variants pv
      where pv.id = v_variant_id;
      v_unit_price := v_unit_price + v_variant_adjustment;
    end if;
    for v_modifier_id in
      select value::uuid
      from jsonb_array_elements_text(coalesce(v_item -> 'modifier_ids', '[]'::jsonb)) as value
    loop
      select m.price into v_modifier_price
      from public.modifiers m
      where m.id = v_modifier_id;
      v_unit_price := v_unit_price + v_modifier_price;
    end loop;
    v_unit_price := round(v_unit_price, 2);
    v_line_total := round(v_unit_price * v_quantity, 2);

    v_item_id := gen_random_uuid();
    insert into public.order_items (
      id, order_id, product_id, variant_id,
      product_name, variant_name, quantity, unit_price, total_price
    ) values (
      v_item_id, v_order_id, v_product_id, v_variant_id,
      v_product_name, v_variant_name, v_quantity, v_unit_price, v_line_total
    );

    for v_modifier_id in
      select value::uuid
      from jsonb_array_elements_text(coalesce(v_item -> 'modifier_ids', '[]'::jsonb)) as value
    loop
      select m.name, m.price into v_modifier_name, v_modifier_price
      from public.modifiers m
      where m.id = v_modifier_id;
      insert into public.order_item_modifiers (
        id, order_item_id, modifier_id, modifier_name, price
      ) values (
        gen_random_uuid(), v_item_id, v_modifier_id,
        v_modifier_name, v_modifier_price
      );
    end loop;
  end loop;

  -- --- placement history: exactly one row (id = order id) ----------------
  insert into public.order_status_history (
    id, order_id, from_status, to_status, changed_by, note
  ) values (
    v_order_id, v_order_id, 'DRAFT', 'CONFIRMED', null,
    case when v_source = 'QR' then 'Order placed via QR' else 'Order placed online' end
  );

  -- --- dine-in occupies the table (same rule as the POS) ------------------
  if v_table_id is not null then
    update public.tables set status = 'occupied' where id = v_table_id;
  end if;

  -- --- stock deduction, INLINE (see the header comment for why this
  -- cannot call deduct_stock_for_order()): one SALE movement per
  -- ingredient + the quantity update, same shape as that function. -------
  for r in
    select pr.inventory_item_id as item_id,
           sum(oi.quantity * pr.quantity_per_unit) as total_needed
    from public.order_items oi
    join public.product_recipes pr on pr.product_id = oi.product_id
    where oi.order_id = v_order_id
    group by pr.inventory_item_id
  loop
    insert into public.stock_movements (
      restaurant_id, inventory_item_id, movement_type, quantity_change,
      reference_type, reference_id, reason, created_by
    ) values (
      v_restaurant_id, r.item_id, 'SALE', -r.total_needed,
      'order', v_order_id, 'Sale — order #' || v_order_number, null
    );
    update public.inventory_items
    set current_quantity = current_quantity - r.total_needed
    where id = r.item_id;
  end loop;

  return query select v_order_id, v_order_number, v_table_name;
end;
$$;

grant execute on function public.place_online_order(text, text, text, text, text, text, jsonb) to anon, authenticated;

-- ============================================================================
-- get_online_order_status(p_slug, p_order_number, p_phone)
-- ============================================================================
-- Lets a guest check their order's status (the storefront polls this
-- after placement). The phone must match the order's customer_phone —
-- without it a stranger cannot enumerate orders by number. Returns zero
-- rows when nothing matches.
create or replace function public.get_online_order_status(
  p_slug text,
  p_order_number integer,
  p_phone text
)
returns table (status text, total_amount numeric)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select o.status, o.total_amount
  from public.orders o
  join public.restaurants r on r.id = o.restaurant_id
  where r.slug = btrim(coalesce(p_slug, ''))
    and o.order_number = p_order_number
    and o.customer_phone = btrim(coalesce(p_phone, ''));
end;
$$;

grant execute on function public.get_online_order_status(text, integer, text) to anon, authenticated;
