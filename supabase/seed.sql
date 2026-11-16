-- ============================================================================
-- FoodX — Demo seed data (supabase/seed.sql)
-- ============================================================================
-- DEMO DATA ONLY. Run this only against a local / development Supabase
-- project, NEVER against production.
--
-- What it creates (fixed UUIDs, so re-running is safe):
--   * Restaurant "FoodX Demo Restaurant"  (slug 'foodx-demo')
--   * Branch     "Main Branch"            (is_main = true)
--   * One restaurant_settings row for that restaurant (all defaults)
--
-- It does NOT create auth users, profiles, roles, or permissions — the
-- migration (0001_foundation.sql) already seeds the system roles and
-- permissions, and auth users must be created through Supabase Auth.
--
-- HOW TO REMOVE IT (run in this order — children before parents):
--   delete from public.restaurant_settings
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
--   delete from public.branches
--    where id = '22222222-2222-2222-2222-222222222222';
--   delete from public.restaurants
--    where id = '11111111-1111-1111-1111-111111111111';
-- (Deleting the restaurant alone also works: branches, settings,
-- feature_flags and audit_logs all cascade from restaurants.)
--
-- Run as postgres / service_role (e.g. the Dashboard SQL editor), which
-- bypasses RLS. Do not run it as an authenticated app user.
-- ============================================================================

insert into public.restaurants
  (id, name, slug, default_currency, timezone, status)
values
  ('11111111-1111-1111-1111-111111111111',
   'FoodX Demo Restaurant', 'foodx-demo', 'BDT', 'Asia/Dhaka', 'active')
on conflict (id) do nothing;

insert into public.branches
  (id, restaurant_id, name, code, address, phone, is_main, status)
values
  ('22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   'Main Branch', 'MAIN', 'Dhaka, Bangladesh', null, true, 'active')
on conflict (id) do nothing;

insert into public.restaurant_settings
  (id, restaurant_id, branding_name, primary_color, secondary_color,
   currency, tax_rate, service_charge_rate, receipt_footer)
values
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   'FoodX Demo Restaurant', '#ea580c', '#16a34a',
   'BDT', 0, 0, 'Thank you for dining with FoodX Demo Restaurant!')
on conflict (id) do nothing;
