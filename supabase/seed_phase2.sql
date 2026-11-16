-- ============================================================================
-- FoodX — Phase 2 demo seed (supabase/seed_phase2.sql)
-- ============================================================================
-- DEMO DATA ONLY, for the DEMO restaurant only. Approved 2026-11-17 to
-- run against production as well, so the FoodX Demo restaurant — the
-- public landing page on foodx.bond — has a demo menu for client demos.
-- Never run it for any other restaurant.
--
-- What it creates (fixed UUIDs, so re-running is safe), all under the demo
-- restaurant 11111111-1111-1111-1111-111111111111 ("FoodX Demo Restaurant",
-- from supabase/seed.sql — run that file first):
--   * 2 kitchen stations  (Main Kitchen, Drinks Station)
--   * 3 categories        (Starters, Main Course, Drinks)
--   * 8 products          (with BDT prices, station + category mapping)
--   * 5 product variants  (Grilled Chicken sizes, Beef Biryani sizes)
--   * 3 modifiers         (Extra Cheese, Extra Chicken, No Onion)
--   * 6 tables            (T1–T6, seats 2–8, all available)
--
-- It does NOT create orders, payments, or any financial history.
--
-- HOW TO REMOVE IT (children before parents):
--   delete from public.product_modifiers
--    where product_id in (select id from public.products
--                         where restaurant_id = '11111111-1111-1111-1111-111111111111');
--   delete from public.product_variants
--    where product_id in (select id from public.products
--                         where restaurant_id = '11111111-1111-1111-1111-111111111111');
--   delete from public.order_item_modifiers
--    where order_item_id in (select id from public.order_items
--                            where order_id in (select id from public.orders
--                                               where restaurant_id = '11111111-1111-1111-1111-111111111111'));
--   delete from public.order_items
--    where order_id in (select id from public.orders
--                       where restaurant_id = '11111111-1111-1111-1111-111111111111');
--   delete from public.order_payments
--    where order_id in (select id from public.orders
--                       where restaurant_id = '11111111-1111-1111-1111-111111111111');
--   delete from public.order_status_history
--    where order_id in (select id from public.orders
--                       where restaurant_id = '11111111-1111-1111-1111-111111111111');
--   delete from public.orders
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
--   delete from public.products
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
--   delete from public.modifiers
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
--   delete from public.categories
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
--   delete from public.kitchen_stations
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
--   delete from public.tables
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
-- (Deleting the demo restaurant itself also cascades everything above.)
--
-- Run as postgres / service_role (e.g. the Dashboard SQL editor), which
-- bypasses RLS. Do not run it as an authenticated app user.
-- ============================================================================

-- 2 kitchen stations ---------------------------------------------------------
insert into public.kitchen_stations
  (id, restaurant_id, name, sort_order, is_active)
values
  ('44444444-4444-4444-4444-444444444441',
   '11111111-1111-1111-1111-111111111111', 'Main Kitchen', 1, true),
  ('44444444-4444-4444-4444-444444444442',
   '11111111-1111-1111-1111-111111111111', 'Drinks Station', 2, true)
on conflict (id) do nothing;

-- 3 categories ---------------------------------------------------------------
insert into public.categories
  (id, restaurant_id, name, name_bn, sort_order, is_active)
values
  ('55555555-5555-5555-5555-555555555551',
   '11111111-1111-1111-1111-111111111111', 'Starters', 'স্টার্টার', 1, true),
  ('55555555-5555-5555-5555-555555555552',
   '11111111-1111-1111-1111-111111111111', 'Main Course', 'মেইন কোর্স', 2, true),
  ('55555555-5555-5555-5555-555555555553',
   '11111111-1111-1111-1111-111111111111', 'Drinks', 'পানীয়', 3, true)
on conflict (id) do nothing;

-- 8 products -----------------------------------------------------------------
insert into public.products
  (id, restaurant_id, category_id, kitchen_station_id,
   name, name_bn, description, price, is_available, sort_order)
values
  ('66666666-6666-6666-6666-666666666661',
   '11111111-1111-1111-1111-111111111111',
   '55555555-5555-5555-5555-555555555551',
   '44444444-4444-4444-4444-444444444441',
   'Chicken Soup', 'চিকেন সুপ', 'Warm chicken soup with herbs', 180, true, 1),
  ('66666666-6666-6666-6666-666666666662',
   '11111111-1111-1111-1111-111111111111',
   '55555555-5555-5555-5555-555555555551',
   '44444444-4444-4444-4444-444444444441',
   'French Fries', 'ফ্রেঞ্চ ফ্রাই', 'Crispy golden fries', 120, true, 2),
  ('66666666-6666-6666-6666-666666666663',
   '11111111-1111-1111-1111-111111111111',
   '55555555-5555-5555-5555-555555555552',
   '44444444-4444-4444-4444-444444444441',
   'Chicken Burger', 'চিকেন বার্গার', 'Grilled chicken patty, fresh bun', 280, true, 1),
  ('66666666-6666-6666-6666-666666666664',
   '11111111-1111-1111-1111-111111111111',
   '55555555-5555-5555-5555-555555555552',
   '44444444-4444-4444-4444-444444444441',
   'Beef Biryani', 'গরুর বিরিয়ানি', 'Fragrant rice with tender beef', 320, true, 2),
  ('66666666-6666-6666-6666-666666666665',
   '11111111-1111-1111-1111-111111111111',
   '55555555-5555-5555-5555-555555555552',
   '44444444-4444-4444-4444-444444444441',
   'Chicken Biryani', 'চিকেন বিরিয়ানি', 'Fragrant rice with chicken', 260, true, 3),
  ('66666666-6666-6666-6666-666666666666',
   '11111111-1111-1111-1111-111111111111',
   '55555555-5555-5555-5555-555555555552',
   '44444444-4444-4444-4444-444444444441',
   'Grilled Chicken', 'গ্রিলড চিকেন', 'Char-grilled whole chicken', 450, true, 4),
  ('66666666-6666-6666-6666-666666666667',
   '11111111-1111-1111-1111-111111111111',
   '55555555-5555-5555-5555-555555555553',
   '44444444-4444-4444-4444-444444444442',
   'Soft Drink', 'সফট ড্রিংক', 'Chilled soft drink', 60, true, 1),
  ('66666666-6666-6666-6666-666666666668',
   '11111111-1111-1111-1111-111111111111',
   '55555555-5555-5555-5555-555555555553',
   '44444444-4444-4444-4444-444444444442',
   'Mango Lassi', 'ম্যাংগো লাচ্ছি', 'Sweet mango yogurt drink', 90, true, 2)
on conflict (id) do nothing;

-- 5 product variants ---------------------------------------------------------
insert into public.product_variants
  (id, product_id, name, price_adjustment, sort_order, is_active)
values
  ('77777777-7777-7777-7777-777777777771',
   '66666666-6666-6666-6666-666666666666', 'Quarter', 0, 1, true),
  ('77777777-7777-7777-7777-777777777772',
   '66666666-6666-6666-6666-666666666666', 'Half', 150, 2, true),
  ('77777777-7777-7777-7777-777777777773',
   '66666666-6666-6666-6666-666666666666', 'Full', 300, 3, true),
  ('77777777-7777-7777-7777-777777777774',
   '66666666-6666-6666-6666-666666666664', 'Regular', 0, 1, true),
  ('77777777-7777-7777-7777-777777777775',
   '66666666-6666-6666-6666-666666666664', 'Large', 60, 2, true)
on conflict (id) do nothing;

-- 3 modifiers ----------------------------------------------------------------
insert into public.modifiers
  (id, restaurant_id, name, name_bn, price, is_active)
values
  ('88888888-8888-8888-8888-888888888881',
   '11111111-1111-1111-1111-111111111111', 'Extra Cheese', 'অতিরিক্ত চিজ', 40, true),
  ('88888888-8888-8888-8888-888888888882',
   '11111111-1111-1111-1111-111111111111', 'Extra Chicken', 'অতিরিক্ত চিকেন', 80, true),
  ('88888888-8888-8888-8888-888888888883',
   '11111111-1111-1111-1111-111111111111', 'No Onion', 'পেঁয়াজ ছাড়া', 0, true)
on conflict (id) do nothing;

-- Which products offer which modifiers ---------------------------------------
insert into public.product_modifiers (product_id, modifier_id)
values
  ('66666666-6666-6666-6666-666666666663', '88888888-8888-8888-8888-888888888881'),
  ('66666666-6666-6666-6666-666666666664', '88888888-8888-8888-8888-888888888882'),
  ('66666666-6666-6666-6666-666666666665', '88888888-8888-8888-8888-888888888882'),
  ('66666666-6666-6666-6666-666666666661', '88888888-8888-8888-8888-888888888883')
on conflict do nothing;

-- 6 tables -------------------------------------------------------------------
insert into public.tables
  (id, restaurant_id, branch_id, name, seats, status, qr_code)
values
  ('99999999-9999-9999-9999-999999999991',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'T1', 2, 'available', 'foodx-demo-t1'),
  ('99999999-9999-9999-9999-999999999992',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'T2', 4, 'available', 'foodx-demo-t2'),
  ('99999999-9999-9999-9999-999999999993',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'T3', 4, 'available', 'foodx-demo-t3'),
  ('99999999-9999-9999-9999-999999999994',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'T4', 4, 'available', 'foodx-demo-t4'),
  ('99999999-9999-9999-9999-999999999995',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'T5', 6, 'available', 'foodx-demo-t5'),
  ('99999999-9999-9999-9999-999999999996',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'T6', 8, 'available', 'foodx-demo-t6')
on conflict (id) do nothing;
