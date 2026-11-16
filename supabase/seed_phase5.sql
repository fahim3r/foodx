-- ============================================================================
-- FoodX — Phase 5 demo seed (DEV ONLY — NEVER run against production)
-- One demo domain row for the FoodX Demo Restaurant, for code-path
-- testing of the storefront + domain resolution. demo.foodx.bond is NOT
-- a real DNS record; it only exercises the resolve + storefront code
-- through the ?store= preview affordance.
-- ============================================================================

insert into public.restaurant_domains (restaurant_id, domain, is_primary)
values ('11111111-1111-1111-1111-111111111111', 'demo.foodx.bond', true)
on conflict (domain) do nothing;
