-- ============================================================================
-- FoodX — Phase 3 demo seed (supabase/seed_phase3.sql)
-- ============================================================================
-- DEMO DATA ONLY, for the DEMO restaurant only. Run this only against a
-- local / development Supabase project, NEVER against production.
--
-- What it creates (fixed UUIDs, so re-running is safe), all under the demo
-- restaurant 11111111-1111-1111-1111-111111111111 ("FoodX Demo Restaurant",
-- from supabase/seed.sql — run that file and seed_phase2.sql first):
--   * 9 inventory items (Chicken, Beef, Rice, Cooking Oil, Potato, Milk,
--     Mango, Bun, Cheese — realistic quantities, units, thresholds, costs)
--   * 15 recipe lines for 6 demo products (Chicken Burger, Beef Biryani,
--     Chicken Biryani, French Fries, Mango Lassi, Grilled Chicken)
--   * 1 supplier (Dhaka Fresh Foods)
--
-- It does NOT create stock movements, purchase orders, or any financial
-- history. Stock starts at the seeded current_quantity values — those
-- are opening stock, not movements.
--
-- HOW TO REMOVE IT (children before parents):
--   delete from public.product_recipes
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
--   delete from public.stock_movements
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
--   delete from public.purchase_order_items
--    where purchase_order_id in (select id from public.purchase_orders
--                                where restaurant_id = '11111111-1111-1111-1111-111111111111');
--   delete from public.purchase_orders
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
--   delete from public.suppliers
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
--   delete from public.inventory_items
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
-- (Deleting the demo restaurant itself also cascades everything above.)
--
-- Run as postgres / service_role (e.g. the Dashboard SQL editor), which
-- bypasses RLS. Do not run it as an authenticated app user.
-- ============================================================================

-- 9 inventory items ----------------------------------------------------------
insert into public.inventory_items
  (id, restaurant_id, name, unit, current_quantity, low_stock_threshold,
   cost_price, is_active)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   '11111111-1111-1111-1111-111111111111', 'Chicken', 'kg', 10, 2, 320, true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
   '11111111-1111-1111-1111-111111111111', 'Beef', 'kg', 8, 2, 750, true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
   '11111111-1111-1111-1111-111111111111', 'Rice', 'kg', 25, 5, 70, true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
   '11111111-1111-1111-1111-111111111111', 'Cooking Oil', 'litre', 8, 2, 180, true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5',
   '11111111-1111-1111-1111-111111111111', 'Potato', 'kg', 15, 3, 40, true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6',
   '11111111-1111-1111-1111-111111111111', 'Milk', 'litre', 6, 2, 90, true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7',
   '11111111-1111-1111-1111-111111111111', 'Mango', 'kg', 4, 1, 120, true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8',
   '11111111-1111-1111-1111-111111111111', 'Bun', 'pcs', 40, 10, 15, true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9',
   '11111111-1111-1111-1111-111111111111', 'Cheese', 'kg', 2, 0.5, 900, true)
on conflict (id) do nothing;

-- 15 recipe lines for 6 demo products ---------------------------------------
-- Product ids are from seed_phase2.sql.
insert into public.product_recipes
  (id, restaurant_id, product_id, inventory_item_id, quantity_per_unit)
values
  -- Chicken Burger (66666666-...-666666666663): 1 bun, 0.15 kg chicken, 0.02 kg cheese
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666663',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa8', 1),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666663',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 0.15),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666663',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa9', 0.02),
  -- Beef Biryani (66666666-...-666666666664): 0.25 kg rice, 0.2 kg beef, 0.03 L oil
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666664',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 0.25),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666664',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 0.2),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666664',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 0.03),
  -- Chicken Biryani (66666666-...-666666666665): 0.25 kg rice, 0.15 kg chicken, 0.03 L oil
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb7',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666665',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 0.25),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb8',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666665',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 0.15),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666665',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 0.03),
  -- French Fries (66666666-...-666666666662): 0.2 kg potato, 0.02 L oil
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666662',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', 0.2),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb11',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666662',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 0.02),
  -- Mango Lassi (66666666-...-666666666668): 0.2 L milk, 0.1 kg mango
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb12',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666668',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa6', 0.2),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb13',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666668',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa7', 0.1),
  -- Grilled Chicken (66666666-...-666666666666): 0.5 kg chicken, 0.02 L oil
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb14',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666666',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 0.5),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb15',
   '11111111-1111-1111-1111-111111111111',
   '66666666-6666-6666-6666-666666666666',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 0.02)
on conflict (id) do nothing;

-- 1 supplier -----------------------------------------------------------------
insert into public.suppliers
  (id, restaurant_id, name, phone, email, address, is_active)
values
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1',
   '11111111-1111-1111-1111-111111111111', 'Dhaka Fresh Foods',
   '01700000000', 'fresh@example.com', 'Karwan Bazar, Dhaka', true)
on conflict (id) do nothing;
