-- 0027_module_toggles.sql
-- Modifications v2, item 8: restaurant-level module on/off toggles.
-- One jsonb column on restaurant_settings; a missing key reads as ON
-- (isModuleOn in src/services/modules.ts), so existing deployments
-- wake up unchanged. Delivery keeps its Phase 6 delivery_enabled
-- column as its module flag — the Settings Modules card presents
-- all five switches together and the service reads delivery from
-- the column, the rest from this jsonb.
alter table public.restaurant_settings
  add column if not exists modules jsonb not null
  default '{"loyalty":true,"reservations":true,"business":true,"customers":true}'::jsonb;
