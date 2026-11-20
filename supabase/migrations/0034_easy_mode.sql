-- 0034_easy_mode.sql
-- Easy Mode v2, wave E1: the mode becomes a restaurant-wide setting.
-- v1 kept it in per-device localStorage, so the counter tablet and
-- the owner's phone could disagree. It now lives on
-- restaurant_settings (default false — existing deployments wake up
-- in the full panel, exactly as today) and changes only through the
-- Settings switch, which is owner/admin-only and asks for the
-- manager PIN first (design §3/§6).
--
-- verify_manager_pin() exposes migration 0024's hash check on its
-- own: the guarded cancel/refund RPCs verify the PIN inside the
-- action they perform, but a settings write has no guarded RPC, and
-- restaurant_secrets is unreachable from the client by design (RLS
-- on, no policies) — so the switch verifies through this function,
-- then writes via the settings service. Returns false when no PIN
-- is set; the switch treats that case separately (the owner is
-- asked to set a PIN first — a mode change is never PIN-less).

alter table public.restaurant_settings
  add column if not exists easy_mode boolean not null default false;

create or replace function public.verify_manager_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select s.manager_pin_hash into v_hash
  from public.restaurant_secrets s
  where s.restaurant_id = public.current_restaurant_id();
  if v_hash is null then
    return false;
  end if;
  return p_pin is not null
    and encode(
      digest(public.current_restaurant_id()::text || ':' || p_pin, 'sha256'),
      'hex'
    ) = v_hash;
end;
$$;

grant execute on function public.verify_manager_pin(text) to authenticated;
