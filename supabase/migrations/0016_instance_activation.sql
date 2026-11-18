-- ============================================================================
-- FoodX migration 0016 — Landing/onboarding build, Step 2:
-- license-key activation support (LANDING_ONBOARDING_DESIGN.md)
--
-- What this adds:
--   * public.instance_config — single-row table (id = 1) holding this
--     deployment's registry identity, written by the in-panel license
--     activation flow (src/services/activation.ts):
--       registry_url   — the vendor registry (Supabase project URL)
--       instance_id    — the registry client_code (e.g. 'CL-001').
--                        TEXT, not uuid: the heartbeat protocol looks
--                        clients up by client_code (migrations
--                        0014/0015). The design draft said uuid; the
--                        protocol wins.
--       instance_token — the per-instance token, returned ONCE by the
--                        registry's instance-activate function.
--       activated_at   — when activation completed.
--     One deployment serves one restaurant business (§1), so this is
--     deployment-wide, not per-restaurant. Deployments provisioned by
--     the vendor with env vars (VITE_FOODX_*) keep working without a
--     row here — the heartbeat service treats env as fallback config.
--   * public.is_restaurant_admin() — helper for the RLS below: the
--     caller's profile carries an admin-level role (super_admin,
--     restaurant_owner, admin) in user_roles.
--   * restaurant_settings.onboarding_completed — first-run wizard flag.
--     Defaults false for NEW restaurants; this migration sets it TRUE
--     for every existing row so current restaurants (demo, AddaBuzz,
--     Panel Test) are never pushed through the wizard retroactively.
--
-- ACCESS MODEL for instance_config:
--   The instance token is a credential: anon gets NOTHING (storefront
--   visitors must never read it), and only admin-level profiles may
--   select/insert/update the row. There is deliberately no DELETE
--   policy — re-activation is a vendor token rotation (Phase 8 step 2),
--   which updates the row, never deletes it.
-- ============================================================================

create or replace function public.is_restaurant_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.name in ('super_admin', 'restaurant_owner', 'admin')
  );
$$;

create table if not exists public.instance_config (
  id             int primary key check (id = 1),
  registry_url   text,
  instance_id    text,
  instance_token text,
  activated_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists trg_instance_config_updated_at on public.instance_config;
create trigger trg_instance_config_updated_at
  before update on public.instance_config
  for each row execute function public.set_updated_at();

alter table public.instance_config enable row level security;

drop policy if exists instance_config_select_admin on public.instance_config;
create policy instance_config_select_admin on public.instance_config
  for select to authenticated using (public.is_restaurant_admin());

drop policy if exists instance_config_insert_admin on public.instance_config;
create policy instance_config_insert_admin on public.instance_config
  for insert to authenticated with check (public.is_restaurant_admin());

drop policy if exists instance_config_update_admin on public.instance_config;
create policy instance_config_update_admin on public.instance_config
  for update to authenticated
  using (public.is_restaurant_admin())
  with check (public.is_restaurant_admin());

alter table public.restaurant_settings
  add column if not exists onboarding_completed boolean not null default false;

-- Existing restaurants have long finished their first run.
update public.restaurant_settings set onboarding_completed = true;
