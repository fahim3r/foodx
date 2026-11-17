-- ============================================================================
-- FoodX — Migration 0010: remove orphan trigger functions (drift cleanup)
-- ============================================================================
-- WHY THIS MIGRATION EXISTS:
-- A schema audit on 2026-11-17 (repo migrations 0001–0009 checked against
-- the live database, table by table and function by function) found two
-- functions in the live database that exist in NO migration in this repo:
--
--   public.set_customers_updated_at()
--   public.set_coupons_updated_at()
--
-- Both are leftovers of the stale-draft apply that migration 0006 exists
-- to correct. Verified live on 2026-11-17 before writing this migration:
--   - Both bodies are byte-for-byte the same logic as the generic
--     public.set_updated_at() defined in 0001 (set new.updated_at = now()).
--   - NO trigger anywhere in the live database executes either function.
--     trg_customers_updated_at and trg_coupons_updated_at both execute
--     public.set_updated_at(), exactly as 0005 and 0006 define them.
--   - Nothing else in the schema depends on them.
--
-- So the drift is in the DATABASE, not in this repo: the repo is the
-- intended state, and this migration brings the live database back to
-- exactly that state by dropping the two orphans. (The alternative —
-- committing the orphans into the repo — would preserve dead code.)
--
-- IDEMPOTENT: every statement is a no-op on a database that is already
-- in the intended state, including fresh installs that run 0001–0010
-- in order. No table data is touched.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Drop the orphan functions (live-only leftovers of the stale draft)
-- ----------------------------------------------------------------------------
drop function if exists public.set_customers_updated_at();
drop function if exists public.set_coupons_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Re-assert the intended updated_at triggers, exactly as in 0005/0006,
--    so the live state after this migration is self-evidently the repo
--    state even if a draft variant of a trigger ever reappears.
-- ----------------------------------------------------------------------------
drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_coupons_updated_at on public.coupons;
create trigger trg_coupons_updated_at
  before update on public.coupons
  for each row execute function public.set_updated_at();
