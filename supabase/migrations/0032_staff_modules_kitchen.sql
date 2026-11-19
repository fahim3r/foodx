-- 0032: per-staff module access + auto-send-to-kitchen setting
-- (user request 2026-11-19, after modifications v2).
--
-- 1. profiles.modules: a jsonb array of panel module keys the staff
--    member may open (null = no per-staff restriction; the role's
--    permissions alone decide, as before). Written only by the
--    manage-staff Edge Function (service role) — profiles RLS stays
--    self-only, so staff cannot widen their own access.
-- 2. restaurant_settings.auto_send_to_kitchen: when true, newly
--    placed orders go straight to SENT_TO_KITCHEN instead of waiting
--    at CONFIRMED for a manual "Send to kitchen" click. Default
--    false — existing behaviour unless the restaurant opts in.

alter table public.profiles
  add column if not exists modules jsonb;

alter table public.restaurant_settings
  add column if not exists auto_send_to_kitchen boolean not null default false;
