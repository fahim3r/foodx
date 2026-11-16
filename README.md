# FoodX

FoodX is a restaurant management platform — one master codebase, deployed
per restaurant with **a separate database per restaurant**. It is a licensed,
self-contained deployment model, **not multi-tenant SaaS**: each restaurant
runs its own app instance against its own Supabase project, and no
restaurant's data ever shares a database with another's.

> **Status: Phase 1 — Foundation.** This repository currently contains the
> app shell, authentication, restaurant setup, branding settings, and a
> read-only roles & permissions view. There is no ordering, menu, table,
> inventory, billing, kitchen, or reporting functionality yet — see
> [What is not built yet](#what-is-not-built-yet).

## Tech stack

| Layer | Choice |
| --- | --- |
| Build / framework | Vite 8 + React 19 + TypeScript 7 (strict) |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite`), shadcn-style UI components (Radix primitives, `class-variance-authority`, `clsx`, `tailwind-merge`) |
| Routing | react-router-dom 7 |
| Backend / database | Supabase (Postgres + Auth + PostgREST), `@supabase/supabase-js` v2 |
| i18n | i18next + react-i18next — English (`en`) and Bangla (`bn`), 150 keys each |
| Icons | lucide-react |
| PWA | vite-plugin-pwa — **manifest only** in Phase 1 (see below) |
| Lint | oxlint (`npm run lint`) |
| Charts | recharts is installed for future dashboard charts but **not used yet** |

## Prerequisites

- **Node.js 24** (check with `node --version`). npm ships with it.
- A Supabase project (one per restaurant deployment). The live project for
  this deployment is `foodx` (Singapore) — see [Database setup](#database-setup).
- No other services are required to run the app locally.

## Run locally

```bash
npm install
cp .env.example .env   # then fill in your own Supabase values
npm run dev            # Vite dev server, default http://localhost:5173
```

Other scripts:

```bash
npm run build    # tsc -b && vite build  (typecheck + production build)
npm run preview  # serve the production build locally
npm run lint     # oxlint
```

### Environment variables

`.env` is gitignored — never commit real keys. Copy `.env.example` and set:

| Variable | Meaning |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL, e.g. `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase **anon** (public) key |

The app throws a clear error at startup if either variable is missing
(`src/lib/supabase.ts`). Only the anon key is used in the browser; the
service-role key is never needed by the app and must never be put in `.env`
or shipped to the client.

## Database setup

The schema lives in `supabase/migrations/0001_foundation.sql`. **The
migrations have not yet been applied to the live Supabase project**, so
until they are, the app starts, lets you sign in, and shows a friendly
"Database setup is pending" notice instead of crashing — pages that need
the tables (Dashboard, Settings, Roles) degrade gracefully. Apply the
migration to make the app fully functional.

### Option A — Supabase CLI (recommended)

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### Option B — Dashboard SQL editor

Supabase Dashboard → SQL Editor → New query, paste the full contents of
`supabase/migrations/0001_foundation.sql`, and run it. Repeat in filename
order for each later migration. The SQL editor runs as `postgres`, which
bypasses RLS, so the seed inserts inside the migration succeed.

> **Never edit `0001_foundation.sql` after it has been applied to a shared
> database.** Add a new migration instead — see
> [DATABASE.md](DATABASE.md#migration-versioning).

### Demo seed data (development only)

`supabase/seed.sql` creates one demo restaurant ("FoodX Demo Restaurant",
slug `foodx-demo`), one "Main Branch", and its settings row, using fixed
UUIDs so re-running is safe. It creates **no auth users**.

```bash
supabase db reset   # local dev only: applies migrations + seed.sql
# or paste seed.sql into the Dashboard SQL editor and run it
```

**Never run the seed against production.** To remove it, delete the demo
restaurant (branches, settings, feature flags and audit logs cascade from
it) — exact SQL is in [DATABASE.md](DATABASE.md#demo-seed-data) and in the
seed file itself.

## Deploy

### Vercel (frontend)

Deployment target is the **old Vercel account, team "New Bangladesh"**
(the project is deployed from the website, not from this repo's tooling).

1. Import this repository into Vercel (framework preset: Vite).
2. Set the two environment variables in the project settings:
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Deploy. Build command is `npm run build`; output directory is `dist/`.

### Supabase (per restaurant)

Each licensed deployment gets **its own Supabase project** (its own
database). To provision a new restaurant:

1. Create a new Supabase project (region: Singapore for Bangladesh
   deployments, unless the customer needs otherwise).
2. Apply `supabase/migrations/0001_foundation.sql` (see above).
3. Point the restaurant's Vercel deployment at that project with the two
   env vars above.
4. Create the first user via Supabase Auth (Dashboard → Authentication →
   Add user, or the in-app sign-up page), then sign in and complete
   restaurant setup on the Settings page.

There is no automated provisioning yet — that is later-phase work.

## What Phase 1 includes

- **Auth** — email/password sign-in and sign-up (Supabase Auth), password
  reset by email (`/reset-password` → `/update-password`), sign-out.
  Session persistence is Supabase's built-in handling. No social login.
- **App shell** — sidebar + topbar layout (`AppLayout`), mobile sidebar,
  user menu, EN/বাং language switcher (choice saved in localStorage as
  `foodx.language`).
- **Dashboard** (`/`) — honest empty states only. Today's sales, orders
  today and active tables all show `0` with a "No data yet" badge, because
  the modules that produce that data do not exist yet. No fake numbers,
  no mock charts.
- **Settings** (`/settings`) — restaurant info (name, slug, currency,
  timezone), branding (display name, logo URL, primary/secondary colours
  with live preview), tax rate, service-charge rate, receipt footer.
  If no restaurant exists yet, the page runs in **setup mode**: it creates
  the restaurant, links the signed-in user's profile to it, and creates
  the settings row.
- **Roles & permissions** (`/roles`, read-only) — lists the 12 system
  default roles plus any restaurant roles, and a roles × permissions
  matrix. Editing is explicitly marked **"Not implemented"** — it is not
  faked.
- **Branding via CSS variables** — the restaurant's primary colour from
  `restaurant_settings` is applied as `--primary` / `--ring` /
  `--sidebar-primary` on the layout root, so the theme follows the
  restaurant everywhere. Defaults: orange `#ea580c`, green `#16a34a`.
- **Database** — 10 tables, RLS isolation, 12 system roles, 39 permissions
  (see [DATABASE.md](DATABASE.md)).
- **i18n** — full English + Bangla UI, 150 keys, no missing keys in either
  language. Fallback language is English.
- **PWA manifest** — installable manifest (name, icons, theme colour
  `#ea580c`). The service worker currently precaches **nothing**
  (`workbox.globPatterns: []`); offline support is deferred.

## What is not built yet

Everything below is planned for later phases and is **not** in this repo.
Do not assume it exists.

| Area | Status |
| --- | --- |
| Orders, menu/products, tables, billing | Not started |
| Kitchen display (KDS), inventory, purchases, expenses | Not started |
| Customers, loyalty, delivery, online ordering | Not started |
| Reports / analytics | Not started (recharts is installed but unused) |
| Role editing / assigning permissions to roles | Read-only view only; the `role_permissions` table is seeded **empty** — the matrix shows all dashes until assignments are made (a later phase) |
| Branch management UI | The `branches` table exists; no UI or service touches it yet |
| Staff/user management UI | Not started |
| Feature flags UI | The `feature_flags` table exists; nothing reads or writes it yet |
| Audit log UI | The `audit_logs` table exists (insert-only); nothing writes to it yet |
| Offline-first / LAN mode / cloud sync | Reserved for Phase 9; PWA is manifest-only now |
| Developer Panel (separate from Restaurant Admin) | Not started |
| Docker packaging | Not started |

The 9-phase plan is: 1 Foundation (this repo) → 2 Core POS → 3 Menu &
Tables → 4 Inventory → 5 Staff & Roles → 6 Reports → 7 Customer &
Loyalty → 8 Online & Delivery → 9 Production Hardening. Phase numbers in
code comments refer to this plan.

## Project structure

```
foodx/
├── index.html                  # Entry HTML, <title>FoodX</title>, theme-color #ea580c
├── vite.config.ts              # @ alias, Tailwind plugin, PWA manifest
├── components.json             # shadcn-style component config (Tailwind v4, @/components)
├── public/
│   ├── favicon.svg             # App icon (also the PWA manifest icon)
│   └── icons.svg
├── src/
│   ├── main.tsx                # Entry: StrictMode, i18n import, <App />
│   ├── index.css               # Tailwind v4 theme, brand palette, light/dark tokens
│   ├── app/
│   │   ├── App.tsx             # Router: public /login, /reset-password,
│   │   │                       #   /update-password; protected /, /settings, /roles
│   │   ├── AuthProvider.tsx    # Session + workspace (profile/restaurant/settings)
│   │   │                       #   context; dbPending graceful-degradation flag
│   │   └── ProtectedRoute.tsx  # Redirects to /login when signed out
│   ├── components/
│   │   └── ui/                 # button, card, input, label (shadcn-style)
│   ├── hooks/
│   │   └── useAuth.ts          # useAuth() — access the AuthProvider context
│   ├── i18n/
│   │   ├── index.ts            # i18next init; language from localStorage, fallback en
│   │   └── locales/
│   │       ├── en.json         # 150 keys
│   │       └── bn.json         # 150 keys (same key set as en)
│   ├── layouts/
│   │   └── AppLayout.tsx       # Sidebar + topbar, branding CSS variables,
│   │                           #   language switcher, dbPending / no-profile notices
│   ├── lib/
│   │   ├── supabase.ts         # Single shared Supabase client (anon key)
│   │   ├── errors.ts           # Friendly error mapping (auth errors → i18n keys;
│   │   │                       #   isMissingTableError() for the pending-DB state)
│   │   └── utils.ts            # cn() class-name helper
│   ├── modules/                # One folder per feature area (page + its logic)
│   │   ├── auth/               # LoginPage (sign-in/sign-up), ResetPasswordPage,
│   │   │                       #   UpdatePasswordPage
│   │   ├── dashboard/          # DashboardPage (honest empty states)
│   │   ├── roles/              # RolesPage (read-only list + permission matrix)
│   │   └── settings/           # SettingsPage (setup mode + edit mode)
│   ├── services/               # Supabase data access, one file per domain
│   │   ├── auth.ts             # signIn, signUp, signOut, password reset, onAuthStateChange
│   │   ├── restaurant.ts       # profiles / restaurants / restaurant_settings queries
│   │   └── roles.ts            # roles / permissions / role_permissions reads
│   ├── stores/                 # Placeholder — filled in by later phases
│   ├── types/
│   │   └── index.ts            # Domain types mirroring migration 0001
│   └── index.css
├── supabase/
│   ├── README.md               # Database guide (migration, RLS, seed)
│   ├── migrations/
│   │   └── 0001_foundation.sql # 10 tables, RLS, indexes, roles + permissions seed
│   └── seed.sql                # Demo restaurant + branch (dev only)
└── .env.example                # Template for the two VITE_SUPABASE_* variables
```

Module layout rule: each feature area lives under `src/modules/<area>/`
and talks to Supabase only through `src/services/`. Pages never call the
Supabase client directly (except the shared client in `src/lib/supabase.ts`
and the auth subscription in `AuthProvider`).

## i18n notes

- Languages: English (`en`, default) and Bangla (`bn`). Every user-facing
  string goes through `useTranslation()` — no hardcoded UI text.
- Files: `src/i18n/locales/en.json` and `bn.json`. Both files must keep
  the **same key set** (currently 150 keys each, verified in sync).
- The switcher lives in the topbar (`AppLayout`); the choice is stored in
  `localStorage` under `foodx.language` and applied on next load.
- Adding a string: add the key to **both** locale files, in the same
  section (`app`, `auth`, `common`, `dashboard`, `layout`, `nav`,
  `placeholder`, `roles`, `settings`).
- Currency formatting on the Dashboard uses the restaurant's currency
  (default `BDT`); the Settings form offers BDT, USD, EUR, INR.

## Contributing / development rules

These rules come from the project brief and are enforced in this repo:

1. **No fake functionality.** If a feature is not implemented, say so in
   the UI ("Not implemented", "No data yet") — never show mock data,
   placeholder numbers, or a button that pretends to work.
2. **No hardcoded UI text** — everything through i18n, in both `en` and `bn`.
3. **Never edit an applied migration.** New schema changes go in a new
   numbered migration file.
4. **No secrets in the repo.** `.env` is gitignored; only `.env.example`
   (with placeholder values) is committed. Never put the Supabase
   service-role key in the app.
5. **RLS is the security boundary.** All data access goes through the
   anon key + RLS; never bypass RLS from the app, and never query another
   restaurant's rows.
6. **Keep it simple and light.** This is a POS used on phones in a
   restaurant — small bundle, no unnecessary dependencies.
7. **Typecheck before you claim a build works:** `npm run build` runs
   `tsc -b` first; `npm run lint` runs oxlint.

## License

No license file yet — the license decision is pending. Do not assume a
license; do not add one without the maintainer's decision.
