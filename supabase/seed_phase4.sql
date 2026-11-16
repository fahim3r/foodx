-- ============================================================================
-- FoodX — Phase 4 demo seed (supabase/seed_phase4.sql)
-- ============================================================================
-- DEMO DATA ONLY, for the DEMO restaurant only. Run this only against a
-- local / development Supabase project, NEVER against production.
--
-- What it creates (fixed UUIDs, so re-running is safe), all under the demo
-- restaurant 11111111-1111-1111-1111-111111111111 ("FoodX Demo Restaurant",
-- from supabase/seed.sql — run that file and seed_phase2.sql /
-- seed_phase3.sql first):
--   * 2 customers (Rahim Uddin, Nasrin Akter)
--   * 1 coupon (WELCOME10 — 10% off, no minimum, valid 2026)
--
-- It does NOT create loyalty transactions, coupon redemptions, or orders.
-- Points are earned only by completing real orders; a coupon is used only
-- by applying it at the POS.
--
-- HOW TO REMOVE IT:
--   delete from public.coupons
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
--   delete from public.customers
--    where restaurant_id = '11111111-1111-1111-1111-111111111111';
-- (Deleting the demo restaurant itself also cascades everything above.)
--
-- Run as postgres / service_role (e.g. the Dashboard SQL editor), which
-- bypasses RLS. Do not run it as an authenticated app user.
-- ============================================================================

-- 2 customers ---------------------------------------------------------------
insert into public.customers
  (id, restaurant_id, name, phone, email, address, notes)
values
  ('33333333-3333-3333-3333-333333333331',
   '11111111-1111-1111-1111-111111111111',
   'Rahim Uddin', '01711111111', 'rahim@example.com',
   'House 12, Road 5, Dhanmondi, Dhaka', 'Regular — likes extra spicy.'),
  ('33333333-3333-3333-3333-333333333332',
   '11111111-1111-1111-1111-111111111111',
   'Nasrin Akter', '01822222222', 'nasrin@example.com',
   'Flat 3B, Gulshan 1, Dhaka', null)
on conflict (id) do nothing;

-- 1 coupon ------------------------------------------------------------------
insert into public.coupons
  (id, restaurant_id, code, type, value, min_order_amount,
   valid_from, valid_to, max_uses, is_active)
values
  ('44444444-4444-4444-4444-444444444441',
   '11111111-1111-1111-1111-111111111111',
   'WELCOME10', 'PERCENT', 10, 0,
   '2026-01-01', '2026-12-31', null, true)
on conflict (id) do nothing;
