-- ============================================================================
-- FoodX — Phase 7 seed (DEV / DEMO ONLY)
-- Demo expense data for the FoodX Demo Restaurant
-- (11111111-1111-1111-1111-111111111111), matching seed_phase6.sql style.
--
-- The 12 system expense categories are normally created by the app
-- itself the first time a restaurant opens the Business page
-- (fetchExpenseCategories). This seed inserts them with fixed ids so
-- the demo expenses below can reference them; ON CONFLICT DO NOTHING
-- keeps it safe if the app already created them by name.
--
-- Apply manually in the Supabase SQL Editor. Idempotent: fixed UUIDs +
-- ON CONFLICT DO NOTHING. Amounts/dates are relative to current_date
-- so the demo always shows data today and yesterday.
-- ============================================================================

insert into public.expense_categories (id, restaurant_id, name, is_system, is_active) values
  ('77777777-7777-7777-7777-777777777701', '11111111-1111-1111-1111-111111111111', 'Rent', true, true),
  ('77777777-7777-7777-7777-777777777702', '11111111-1111-1111-1111-111111111111', 'Salary', true, true),
  ('77777777-7777-7777-7777-777777777703', '11111111-1111-1111-1111-111111111111', 'Utilities', true, true),
  ('77777777-7777-7777-7777-777777777704', '11111111-1111-1111-1111-111111111111', 'Gas', true, true),
  ('77777777-7777-7777-7777-777777777705', '11111111-1111-1111-1111-111111111111', 'Electricity', true, true),
  ('77777777-7777-7777-7777-777777777706', '11111111-1111-1111-1111-111111111111', 'Internet', true, true),
  ('77777777-7777-7777-7777-777777777707', '11111111-1111-1111-1111-111111111111', 'Marketing', true, true),
  ('77777777-7777-7777-7777-777777777708', '11111111-1111-1111-1111-111111111111', 'Packaging', true, true),
  ('77777777-7777-7777-7777-777777777709', '11111111-1111-1111-1111-111111111111', 'Transportation', true, true),
  ('77777777-7777-7777-7777-777777777710', '11111111-1111-1111-1111-111111111111', 'Maintenance', true, true),
  ('77777777-7777-7777-7777-777777777711', '11111111-1111-1111-1111-111111111111', 'Supplies', true, true),
  ('77777777-7777-7777-7777-777777777712', '11111111-1111-1111-1111-111111111111', 'Other', true, true)
on conflict (restaurant_id, name) do nothing;

insert into public.expenses (id, restaurant_id, category_id, amount, expense_date, payment_method, notes) values
  ('88888888-8888-8888-8888-888888888801', '11111111-1111-1111-1111-111111111111',
   (select id from public.expense_categories where restaurant_id = '11111111-1111-1111-1111-111111111111' and name = 'Rent'),
   15000, current_date, 'bank', 'Monthly shop rent'),
  ('88888888-8888-8888-8888-888888888802', '11111111-1111-1111-1111-111111111111',
   (select id from public.expense_categories where restaurant_id = '11111111-1111-1111-1111-111111111111' and name = 'Salary'),
   8000, current_date, 'bank', 'Staff salary advance'),
  ('88888888-8888-8888-8888-888888888803', '11111111-1111-1111-1111-111111111111',
   (select id from public.expense_categories where restaurant_id = '11111111-1111-1111-1111-111111111111' and name = 'Supplies'),
   1250.50, current_date, 'cash', 'Vegetables and spices from market'),
  ('88888888-8888-8888-8888-888888888804', '11111111-1111-1111-1111-111111111111',
   (select id from public.expense_categories where restaurant_id = '11111111-1111-1111-1111-111111111111' and name = 'Packaging'),
   640, current_date, 'cash', 'Takeaway boxes and bags'),
  ('88888888-8888-8888-8888-888888888805', '11111111-1111-1111-1111-111111111111',
   (select id from public.expense_categories where restaurant_id = '11111111-1111-1111-1111-111111111111' and name = 'Marketing'),
   2000, current_date, 'bkash', 'Facebook page promotion'),
  ('88888888-8888-8888-8888-888888888806', '11111111-1111-1111-1111-111111111111',
   (select id from public.expense_categories where restaurant_id = '11111111-1111-1111-1111-111111111111' and name = 'Supplies'),
   430, current_date - 1, 'cash', 'Cooking oil')
on conflict (id) do nothing;
