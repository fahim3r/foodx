-- ============================================================================
-- FoodX migration 0020 — Phase 8 R5: remove the vendor registry schema
-- from client deployments.
--
-- The registry (dev_* tables + is_developer()) now lives in the
-- vendor-only registry project (foodx-registry); the Developer Panel
-- reaches it through the registry client (VITE_FOODX_REGISTRY_URL /
-- VITE_FOODX_REGISTRY_ANON_KEY), never through a deployment's own
-- database. Client deployments therefore no longer carry these
-- tables. The registry project itself never applies client
-- migrations, so this drop cannot touch the live registry.
--
-- Drops are dependency-ordered (children first). dev_heartbeats has
-- no policies of its own besides the developer select; dropping the
-- tables removes their policies, triggers and indexes with them.
-- ============================================================================

drop table if exists public.dev_heartbeats;
drop table if exists public.dev_support_notes;
drop table if exists public.dev_client_features;
drop table if exists public.dev_licenses;
drop table if exists public.dev_releases;
drop table if exists public.dev_clients;
drop table if exists public.dev_developers;

drop function if exists public.is_developer();
