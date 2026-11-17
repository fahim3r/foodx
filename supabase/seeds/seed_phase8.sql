-- ============================================================================
-- FoodX — Phase 8 Step 1 seed: register the FoodX demo deployment itself
-- as the first registry client (CL-001), give it a LIFETIME license, set
-- its registered feature flags, and add the developer to the allow-list.
--
-- APPLY MANUALLY in the SQL Editor (same pattern as seed_phase6/7).
-- The developer allow-list insert needs ONE profile id — the two
-- candidate profiles in this database are listed in the comment above
-- that insert; replace the placeholder with the chosen one before
-- running. Nothing else in this file needs editing.
--
-- Feature flags below mirror what the demo deployment actually runs
-- today: online ordering, delivery, loyalty, accounting and NFC are
-- built; multi-branch is registered OFF (branches exist in the schema
-- but there is no branch management UI yet).
-- ============================================================================

-- 1) The demo deployment as client CL-001 --------------------------------
insert into public.dev_clients (
  id, client_code, restaurant_name, owner_name, contact_email,
  contact_phone, domain, instance_url, instance_supabase_ref,
  version, plan, status, notes
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
  'CL-001',
  'FoodX Demo Restaurant',
  null,
  null,
  null,
  'foodx.bond',
  'https://foodx.bond',
  'xudsjwydcbzagoezvgkq',
  '0.0.0',
  'LIFETIME',
  'ACTIVE',
  'Own demo deployment — the foodx.bond sales demo. Version is the codebase package version; no numbered release published yet.'
)
on conflict (id) do nothing;

-- 2) Its LIFETIME license (no expiry, per §52) ----------------------------
insert into public.dev_licenses (
  id, client_id, plan, start_date, expiry_date, status, features
) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
  'LIFETIME',
  current_date,
  null,
  'ACTIVE',
  '{}'::jsonb
)
on conflict (id) do nothing;

-- 3) Registered feature flags (§60) ---------------------------------------
insert into public.dev_client_features (id, client_id, feature_key, is_enabled) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'online_ordering', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa12', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'delivery', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa13', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'loyalty', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa14', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'accounting', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa15', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'nfc', true),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa16', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'multi_branch', false)
on conflict (client_id, feature_key) do nothing;

-- 4) First support note (§72) ---------------------------------------------
insert into public.dev_support_notes (id, client_id, note) values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa21',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
  'Registry created with Phase 8 Step 1 (migration 0014). Demo deployment registered as CL-001.'
)
on conflict (id) do nothing;

-- 5) Developer allow-list — CHOOSE ONE profile id before running ---------
-- Candidate profiles in this database (verified 2026-11-17):
--   AddaBuzz account   : 6f0a7ebf-13dc-4bc1-ba0f-b0cdfb43b299
--   Panel Test account : 5522518b-0b71-49d6-bb4f-db8b8765126e
-- Replace the placeholder below with the chosen id, then run this insert.
-- (dev_developers has no app-side write path by design; SQL only.)
--
-- insert into public.dev_developers (profile_id, note) values (
--   '00000000-0000-0000-0000-000000000000',
--   'FoodX vendor / developer'
-- )
-- on conflict (profile_id) do nothing;
