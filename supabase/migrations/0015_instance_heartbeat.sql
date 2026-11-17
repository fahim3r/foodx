-- ============================================================================
-- FoodX migration 0015 — Phase 8 step 2: instance heartbeat support
-- (PHASE8_STEP2_HEARTBEAT_DESIGN.md)
--
-- What this adds:
--   * dev_clients.instance_token_hash — SHA-256 hex of the per-instance
--     token an installation uses to phone home. Only the hash is stored;
--     the plaintext token is shown once in the Developer Panel when it is
--     generated and then lives only in that deployment's env
--     (VITE_FOODX_INSTANCE_TOKEN). NULL = no token issued yet.
--   * dev_clients.last_seen_at — written by the instance-heartbeat Edge
--     Function (service role) on every accepted heartbeat. NULL = the
--     instance has never checked in; the panel labels its version
--     "as registered" until then and "last reported" afterwards.
--   * dev_heartbeats — append-only check-in history (one row per accepted
--     heartbeat). RLS: developers may SELECT; there is deliberately NO
--     insert/update/delete policy for anon/authenticated — only the Edge
--     Function's service role writes here, and nothing ever updates or
--     deletes history.
--
-- dev_clients already has developer select/insert/update policies from
-- 0014, which cover the two new columns (token generation updates
-- instance_token_hash from the Developer Panel).
-- ============================================================================

alter table public.dev_clients
  add column if not exists instance_token_hash text,
  add column if not exists last_seen_at timestamptz;

create table if not exists public.dev_heartbeats (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.dev_clients (id) on delete cascade,
  version text not null,
  domain text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists dev_heartbeats_client_created_idx
  on public.dev_heartbeats (client_id, created_at desc);

alter table public.dev_heartbeats enable row level security;

drop policy if exists dev_heartbeats_select_developer on public.dev_heartbeats;
create policy dev_heartbeats_select_developer on public.dev_heartbeats
  for select to authenticated using (public.is_developer());
