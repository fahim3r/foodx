-- ============================================================================
-- FoodX REGISTRY migration 0002 — Help section H1: support tickets
-- (HELP_SECTION_DESIGN.md §3). Run in the vendor-only registry project
-- (foodx-registry), NOT in client deployments. The same table is part
-- of supabase/registry/bootstrap.sql so a fresh registry includes it.
--
-- dev_support_tickets: support tickets filed BY client deployments,
-- with a lifecycle (open → in_progress → resolved). Tickets are not
-- support notes: dev_support_notes is the developer's append-only
-- history, while tickets arrive from clients and are worked by the
-- developer in the DevPanel Tickets tab.
--
-- ACCESS MODEL:
--   RLS is enabled. Developers (public.is_developer()) may SELECT and
--   UPDATE (status changes) as `authenticated`. There is deliberately
--   NO insert policy and NO anon policy at all: rows are created only
--   by the submit-ticket Edge Function with the service role, which
--   stamps the client_id it resolved from the instance token — a
--   client never touches this table directly and can never file a
--   ticket as another client. sender_name / sender_email are plain
--   text, not foreign keys: client users live in the CLIENT project's
--   Auth, not the registry's.
--   updated_at is maintained by the shared public.set_updated_at()
--   trigger, the same helper every other registry table uses.
-- ============================================================================

create table if not exists public.dev_support_tickets (
  id               uuid        primary key default gen_random_uuid(),
  client_id        uuid        not null references public.dev_clients (id) on delete cascade,
  title            text        not null,
  category         text        not null default 'other',
  message          text        not null,
  sender_name      text,
  sender_email     text,
  status           text        not null default 'open',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint dev_support_tickets_status_check
    check (status in ('open', 'in_progress', 'resolved')),
  constraint dev_support_tickets_category_check
    check (category in ('order_payment', 'printer_hardware', 'menu_settings', 'other'))
);

create index if not exists idx_dev_support_tickets_queue
  on public.dev_support_tickets (status, created_at desc);
create index if not exists idx_dev_support_tickets_client
  on public.dev_support_tickets (client_id, created_at desc);

drop trigger if exists trg_dev_support_tickets_updated_at on public.dev_support_tickets;
create trigger trg_dev_support_tickets_updated_at
  before update on public.dev_support_tickets
  for each row execute function public.set_updated_at();

alter table public.dev_support_tickets enable row level security;

drop policy if exists dev_support_tickets_select on public.dev_support_tickets;
create policy dev_support_tickets_select on public.dev_support_tickets
  for select to authenticated using (public.is_developer());
drop policy if exists dev_support_tickets_update on public.dev_support_tickets;
create policy dev_support_tickets_update on public.dev_support_tickets
  for update to authenticated using (public.is_developer()) with check (public.is_developer());

-- Data API privileges (newer Supabase defaults grant none on
-- SQL-created tables): developers read + update status as
-- `authenticated`; the submit-ticket function writes as
-- `service_role`. anon gets nothing, on purpose.
grant select, update on public.dev_support_tickets to authenticated;
grant select, insert, update, delete on public.dev_support_tickets to service_role;
