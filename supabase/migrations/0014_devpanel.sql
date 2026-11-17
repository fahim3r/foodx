-- ============================================================================
-- FoodX — Phase 8 (Developer Platform, Step 1: manual registry)
-- Migration 0014: developer registry — clients, licenses, releases,
-- per-client feature flags, support notes, developer allow-list
-- ============================================================================
-- Tables added (6): dev_developers, dev_clients, dev_licenses,
-- dev_releases, dev_client_features, dev_support_notes.
-- Helper added (1): public.is_developer().
--
-- WHY A REGISTRY IN THIS DATABASE (Step 1 scope, per PHASE8 design):
--   FoodX is NOT a shared SaaS (§1): every client deployment gets its own
--   database, so no client data lives here. These tables hold only the
--   vendor's own registry — which clients exist, where their deployments
--   are, what license/version/plan was registered for them. Statuses here
--   are AS REGISTERED by the developer; client instances do not report
--   home yet (heartbeat/license validation is Phase 8 Step 2), and the UI
--   labels them as such (§82 — no fake live data).
--
-- ACCESS MODEL:
--   These rows belong to the FoodX vendor, not to any restaurant, so the
--   usual restaurant_id = current_restaurant_id() scoping does NOT apply.
--   Instead every policy requires public.is_developer(): the caller's
--   profile id must be present in dev_developers. That table has a SELECT
--   policy only — membership is managed exclusively through SQL by the
--   vendor (bootstrap path), never from the app. Restaurant users,
--   including owners, get nothing from these tables (§88).
--
--   public.feature_flags (0001) is NOT reused: it is per-RESTAURANT
--   in-app flags inside one deployment. dev_client_features is
--   per-CLIENT (per deployment) vendor-side registration — in Step 1 it
--   records what the vendor configured; the client instance does not
--   pull it yet (Step 2).
--
-- LICENSE RULES (§52):
--   - Plans: MONTHLY / QUARTERLY / HALF_YEARLY / YEARLY / LIFETIME.
--   - LIFETIME licenses must have NULL expiry_date (CHECK below).
--   - At most one ACTIVE license per client (partial unique index).
--   - Renewal creates a NEW row; the old row is marked RENEWED/EXPIRED —
--     license history is never edited away (§46 spirit).
--   - An ACTIVE license past its expiry_date is shown as EXPIRED by the
--     service layer (computed), so expiry works without a cron.
--
-- SUPPORT NOTES are append-only (§45/§72): SELECT + INSERT policies,
-- no UPDATE/DELETE policy — notes are a history, not a document.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Developer allow-list + helper
-- ----------------------------------------------------------------------------
create table if not exists public.dev_developers (
  profile_id uuid        primary key references public.profiles (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

create or replace function public.is_developer()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.dev_developers d where d.profile_id = auth.uid()
  );
$$;

-- ----------------------------------------------------------------------------
-- Clients (§51)
-- ----------------------------------------------------------------------------
create table if not exists public.dev_clients (
  id                   uuid        primary key default gen_random_uuid(),
  client_code          text        not null unique,
  restaurant_name      text        not null,
  owner_name           text,
  contact_email        text,
  contact_phone        text,
  domain               text,
  instance_url         text,
  instance_supabase_ref text,
  version              text,
  plan                 text,
  status               text        not null default 'ACTIVE'
                         check (status in ('ACTIVE', 'SUSPENDED', 'INACTIVE')),
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Licenses (§52)
-- ----------------------------------------------------------------------------
create table if not exists public.dev_licenses (
  id           uuid        primary key default gen_random_uuid(),
  client_id    uuid        not null references public.dev_clients (id) on delete cascade,
  license_key  text        not null unique
               default 'LIC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  plan         text        not null
               check (plan in ('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'LIFETIME')),
  start_date   date        not null default current_date,
  expiry_date  date,
  status       text        not null default 'PENDING'
               check (status in ('PENDING', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'RENEWED', 'CANCELLED')),
  max_branches int,
  max_users    int,
  max_devices  int,
  features     jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (plan <> 'LIFETIME' or expiry_date is null)
);

create unique index if not exists uq_dev_licenses_one_active_per_client
  on public.dev_licenses (client_id) where status = 'ACTIVE';

create index if not exists idx_dev_licenses_client
  on public.dev_licenses (client_id);

-- ----------------------------------------------------------------------------
-- Releases (§55)
-- ----------------------------------------------------------------------------
create table if not exists public.dev_releases (
  id                 uuid        primary key default gen_random_uuid(),
  version            text        not null unique,
  release_notes      text,
  required_migrations text[]     not null default '{}',
  compatibility      text,
  target_client_ids  uuid[],
  status             text        not null default 'DRAFT'
                     check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Per-client feature flags (§60) — vendor registry, see header note
-- ----------------------------------------------------------------------------
create table if not exists public.dev_client_features (
  id         uuid        primary key default gen_random_uuid(),
  client_id  uuid        not null references public.dev_clients (id) on delete cascade,
  feature_key text       not null
             check (feature_key in ('online_ordering', 'delivery', 'loyalty', 'accounting', 'nfc', 'multi_branch')),
  is_enabled boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, feature_key)
);

-- ----------------------------------------------------------------------------
-- Support notes (§72) — append-only
-- ----------------------------------------------------------------------------
create table if not exists public.dev_support_notes (
  id         uuid        primary key default gen_random_uuid(),
  client_id  uuid        not null references public.dev_clients (id) on delete cascade,
  note       text        not null,
  created_by uuid        references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_dev_support_notes_client
  on public.dev_support_notes (client_id, created_at desc);

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
drop trigger if exists trg_dev_clients_updated_at on public.dev_clients;
create trigger trg_dev_clients_updated_at
  before update on public.dev_clients
  for each row execute function public.set_updated_at();

drop trigger if exists trg_dev_licenses_updated_at on public.dev_licenses;
create trigger trg_dev_licenses_updated_at
  before update on public.dev_licenses
  for each row execute function public.set_updated_at();

drop trigger if exists trg_dev_releases_updated_at on public.dev_releases;
create trigger trg_dev_releases_updated_at
  before update on public.dev_releases
  for each row execute function public.set_updated_at();

drop trigger if exists trg_dev_client_features_updated_at on public.dev_client_features;
create trigger trg_dev_client_features_updated_at
  before update on public.dev_client_features
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security — developer-only everywhere.
-- dev_developers: SELECT only (membership is SQL-managed, see header).
-- dev_support_notes: SELECT + INSERT only (append-only history).
-- ----------------------------------------------------------------------------
alter table public.dev_developers enable row level security;
alter table public.dev_clients enable row level security;
alter table public.dev_licenses enable row level security;
alter table public.dev_releases enable row level security;
alter table public.dev_client_features enable row level security;
alter table public.dev_support_notes enable row level security;

drop policy if exists dev_developers_select on public.dev_developers;
create policy dev_developers_select on public.dev_developers
  for select to authenticated using (public.is_developer());

drop policy if exists dev_clients_select on public.dev_clients;
create policy dev_clients_select on public.dev_clients
  for select to authenticated using (public.is_developer());
drop policy if exists dev_clients_insert on public.dev_clients;
create policy dev_clients_insert on public.dev_clients
  for insert to authenticated with check (public.is_developer());
drop policy if exists dev_clients_update on public.dev_clients;
create policy dev_clients_update on public.dev_clients
  for update to authenticated using (public.is_developer()) with check (public.is_developer());
drop policy if exists dev_clients_delete on public.dev_clients;
create policy dev_clients_delete on public.dev_clients
  for delete to authenticated using (public.is_developer());

drop policy if exists dev_licenses_select on public.dev_licenses;
create policy dev_licenses_select on public.dev_licenses
  for select to authenticated using (public.is_developer());
drop policy if exists dev_licenses_insert on public.dev_licenses;
create policy dev_licenses_insert on public.dev_licenses
  for insert to authenticated with check (public.is_developer());
drop policy if exists dev_licenses_update on public.dev_licenses;
create policy dev_licenses_update on public.dev_licenses
  for update to authenticated using (public.is_developer()) with check (public.is_developer());
drop policy if exists dev_licenses_delete on public.dev_licenses;
create policy dev_licenses_delete on public.dev_licenses
  for delete to authenticated using (public.is_developer());

drop policy if exists dev_releases_select on public.dev_releases;
create policy dev_releases_select on public.dev_releases
  for select to authenticated using (public.is_developer());
drop policy if exists dev_releases_insert on public.dev_releases;
create policy dev_releases_insert on public.dev_releases
  for insert to authenticated with check (public.is_developer());
drop policy if exists dev_releases_update on public.dev_releases;
create policy dev_releases_update on public.dev_releases
  for update to authenticated using (public.is_developer()) with check (public.is_developer());
drop policy if exists dev_releases_delete on public.dev_releases;
create policy dev_releases_delete on public.dev_releases
  for delete to authenticated using (public.is_developer());

drop policy if exists dev_client_features_select on public.dev_client_features;
create policy dev_client_features_select on public.dev_client_features
  for select to authenticated using (public.is_developer());
drop policy if exists dev_client_features_insert on public.dev_client_features;
create policy dev_client_features_insert on public.dev_client_features
  for insert to authenticated with check (public.is_developer());
drop policy if exists dev_client_features_update on public.dev_client_features;
create policy dev_client_features_update on public.dev_client_features
  for update to authenticated using (public.is_developer()) with check (public.is_developer());
drop policy if exists dev_client_features_delete on public.dev_client_features;
create policy dev_client_features_delete on public.dev_client_features
  for delete to authenticated using (public.is_developer());

drop policy if exists dev_support_notes_select on public.dev_support_notes;
create policy dev_support_notes_select on public.dev_support_notes
  for select to authenticated using (public.is_developer());
drop policy if exists dev_support_notes_insert on public.dev_support_notes;
create policy dev_support_notes_insert on public.dev_support_notes
  for insert to authenticated with check (public.is_developer());
