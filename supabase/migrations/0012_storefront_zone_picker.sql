-- ============================================================================
-- FoodX — Phase 6 step 2 (Storefront Zone Picker)
-- Migration 0012: customers pick a delivery zone at storefront checkout.
--
--   1. orders.delivery_zone_id — the zone the customer picked, stored on
--      the order itself so the delivery board can pre-fill the dispatch
--      row (delivery_orders.zone_id) when it is created later. ON DELETE
--      SET NULL: deleting a zone never deletes an order.
--   2. An anon SELECT policy on delivery_zones — same public-data
--      pattern as the five menu tables in migration 0007 (zones carry
--      no sensitive columns and are shown at checkout by design); the
--      client filters by restaurant_id + is_active.
--   3. place_online_order() gains p_zone_id (default null). The old
--      7-argument signature is DROPPED first: two overloads would make
--      PostgREST's named-argument calls ambiguous. With a zone, the
--      function validates it server-side (must belong to the resolved
--      restaurant and be active, else 'invalid_zone') and the zone's
--      fee + min_order_amount replace the restaurant_settings values
--      for that order. Without a zone the behavior is byte-for-byte
--      the migration 0009 behavior. The function body below is the
--      0009 text with only the marked changes.
--
-- IDEMPOTENT where practical (IF NOT EXISTS / duplicate_object guard;
-- the function redefinition is a no-op when re-run).
-- 0 DROP TABLE / DELETE FROM / TRUNCATE.
-- ============================================================================

alter table public.orders
  add column if not exists delivery_zone_id uuid
    references public.delivery_zones (id) on delete set null;

do $$
begin
  create policy delivery_zones_select_anon on public.delivery_zones
    for select to anon using (true);
exception when duplicate_object then null;
end $$;

-- The old 7-argument signature goes away BEFORE the 8-argument version
-- is created, so exactly one place_online_order exists afterwards.
drop function if exists public.place_online_order(text, text, text, text, text, text, jsonb);

create or replace function public.place_online_order(
  p_slug text,
  p_table_code text,
  p_delivery_type text,
  p_customer_name text,
  p_customer_phone text,
  p_delivery_address text,
  p_items jsonb,
  p_zone_id uuid default null
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
  stock_row record;
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

  -- --- a chosen delivery zone overrides the settings fee + minimum
  -- (Phase 6 step 2, migration 0012): the zone must belong to this
  -- restaurant and be active; its fee and minimum then replace the
  -- settings values for this order. No zone = settings, as before. ---
  if p_delivery_type = 'delivery' and p_zone_id is not null then
    select z.fee, z.min_order_amount
    into v_delivery_fee, v_min_order_amount
    from public.delivery_zones z
    where z.id = p_zone_id
      and z.restaurant_id = v_restaurant_id
      and z.is_active = true;
    if not found then
      raise exception 'invalid_zone';
    end if;
  end if;

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
    end if;
    begin
      v_product_id := (v_item ->> 'product_id')::uuid;
      v_variant_id := nullif(v_item ->> 'variant_id', '')::uuid;
    exception when others then
      raise exception 'invalid_item';
    end;
    if v_product_id is null then
      raise exception 'invalid_item';
    end if;

    select p.price, p.name into v_product_price, v_product_name
    from public.products p
    where p.id = v_product_id
      and p.restaurant_id = v_restaurant_id
      and p.is_available = true;
    if v_product_price is null then
      raise exception 'invalid_item';
    end if;

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
    select coalesce(max(o.order_number), 0) + 1 into v_order_number
    from public.orders o
    where o.restaurant_id = v_restaurant_id;
    begin
      insert into public.orders (
        id, restaurant_id, table_id, order_number, type, source, status,
        subtotal, discount_amount, tax_amount, service_charge_amount,
        total_amount, delivery_fee, delivery_zone_id,
        customer_id, customer_name, customer_phone, delivery_address,
        notes, created_by
      ) values (
        v_order_id, v_restaurant_id, v_table_id, v_order_number,
        p_delivery_type, v_source, 'CONFIRMED',
        v_subtotal, 0, v_tax_amount, v_service_charge_amount,
        v_total_amount,
        case when p_delivery_type = 'delivery' then v_delivery_fee else 0 end,
        case when p_delivery_type = 'delivery' then p_zone_id else null end,
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
  for stock_row in
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
      v_restaurant_id, stock_row.item_id, 'SALE', -stock_row.total_needed,
      'order', v_order_id, 'Sale — order #' || v_order_number, null
    );
    update public.inventory_items
    set current_quantity = current_quantity - stock_row.total_needed
    where id = stock_row.item_id;
  end loop;

  return query select v_order_id, v_order_number, v_table_name;
end;
$$;

grant execute on function public.place_online_order(text, text, text, text, text, text, jsonb, uuid) to anon, authenticated;
