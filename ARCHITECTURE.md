# FoodX — Architecture

Phase 1 (Foundation). This document records the architecture decisions as
they stand in the code today, and what is deliberately deferred. If the
code and this document disagree, the code wins — fix the document.

For the database schema and RLS detail, see [DATABASE.md](DATABASE.md).
For setup and running the app, see [README.md](README.md).

## 1. Deployment model: one database per restaurant

FoodX is **not multi-tenant SaaS**. The model is:

- **One master codebase** (this repo).
- **One Supabase project (one Postgres database) per restaurant.**
- **One frontend deployment per restaurant**, pointed at that restaurant's
  Supabase project with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

### Why

- **Isolation by construction.** A bug or a bad query in one restaurant
  cannot leak or corrupt another restaurant's data, because the data lives
  in different databases, not different rows of one table.
- **Licensing fits the model.** Each deployment is a licensed install for
  one restaurant; there is no shared "platform" account that all
  restaurants log into.
- **Simple operations.** Backup, restore, export, or delete for one
  restaurant is a whole-project operation in Supabase — no per-tenant
  filtering to get wrong.
- **Offline/LAN later.** Phase 9 plans offline-first / LAN operation with
  cloud sync. Syncing one restaurant's database is a tractable problem;
  syncing slices of a shared multi-tenant database is not.

### Cost of this choice

Provisioning a restaurant is currently manual (create Supabase project →
apply migration → set env vars → create first user). There is no
self-service signup and no admin provisioning UI yet; that is later-phase
work. Row Level Security still exists inside each database as a second
layer of defence (see §3), not as the primary isolation mechanism.

## 2. Why Vite + React + Supabase

| Decision | Reason |
| --- | --- |
| Vite 8 + React 19 | Fast dev server and build, small production bundle, large ecosystem. The POS runs on phones in a restaurant, so bundle size and first-load speed matter. |
| TypeScript 7, `strict: true` (plus `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`, `verbatimModuleSyntax`) | Catches data-shape mistakes at build time; `npm run build` runs `tsc -b` before Vite, so a type error fails the build. |
| Tailwind CSS v4 | Utility-first styling with a single theme definition in `src/index.css` (`@theme`), including the FoodX brand palette (orange scale, `--color-brand-*`) and light/dark design tokens. No separate CSS framework to keep in sync. |
| shadcn-style UI (`src/components/ui/`) | Small, copy-in components (button, card, input, label) built on Radix primitives — no heavy component library, full control over markup and styling. Config in `components.json`. |
| Supabase (Postgres + Auth + PostgREST) | One managed service gives us the database, auth, and a typed REST API without writing or hosting a backend server. Auth is email/password via Supabase Auth; data access is PostgREST through `@supabase/supabase-js`. No custom API server exists in Phase 1, and none is planned for the core POS — Edge Functions are reserved for later phases if a server-side step is ever needed. |
| react-router-dom 7 | Client-side routing for the protected app shell. Routes are declared in one place (`src/app/App.tsx`). |
| i18next + react-i18next | English + Bangla from day one; the restaurant staff audience is Bangla-first. See §6. |
| vite-plugin-pwa (manifest only) | Installability (add to home screen) now; offline behaviour later. See §8. |

What was **not** chosen: no state-management library yet (see §5), no
backend framework, no ORM (SQL migrations are the source of truth for the
schema), no component library beyond Radix primitives.

## 3. Isolation and security model

### Two layers

1. **Database-per-restaurant** (primary isolation — §1).
2. **Row Level Security inside each database** (second layer). Every
   restaurant-scoped row carries a `restaurant_id`, and policies allow a
   signed-in user to touch only rows whose `restaurant_id` matches the
   `restaurant_id` on their own `profiles` row.

### How RLS avoids recursion

A policy on `profiles` must never query `profiles` through RLS, or
policies recurse. The lookup is therefore a single
`SECURITY DEFINER`, `STABLE` SQL function,
`public.current_restaurant_id()`, which reads `profiles` for `auth.uid()`
as the function owner (bypassing RLS). Policies on other tables call the
helper; they never query `profiles` directly and never query their own
table. A user with no profile gets `NULL` from the helper, and every
scoped policy then denies access. Full policy listing:
[DATABASE.md](DATABASE.md#row-level-security).

### Auth model

- **Supabase Auth, email/password only.** Sign-in, sign-up, password
  reset by email, sign-out — all in `src/services/auth.ts`. No social
  login, no magic links.
- **Session persistence is Supabase's built-in handling**
  (localStorage-backed session, auto-refresh). `AuthProvider` subscribes
  to `onAuthStateChange` and reloads the workspace on sign-in/sign-out.
- **The anon key is the only key the browser ever sees.** All data access
  goes through the anon key + RLS. The service-role key is never used by
  the app and must never be shipped to the client. Migrations and the
  seed run as `postgres` / service role outside the app.
- **There is no profile-creation trigger.** A profile row is created by
  the app (`linkProfileToRestaurant` in `src/services/restaurant.ts`)
  when a user completes restaurant setup on the Settings page. Until
  then, a signed-in user has an auth account but no profile — the layout
  shows a "no profile" notice and points them to Settings. Keep this in
  mind when adding features that assume a profile exists.
- **Authorisation is role-based, but not yet enforced in the UI.**
  The database has roles, permissions, and `role_permissions`
  (see [DATABASE.md](DATABASE.md#roles-and-permissions)), and the Roles
  page displays them — but no route or action checks permissions yet,
  and `role_permissions` is seeded empty. Permission checks are
  later-phase work; do not assume a page is protected just because a permission key
  exists for it. The only access control in Phase 1 is "signed in"
  (`ProtectedRoute`).

### Error handling

Supabase/PostgREST errors are technical; the UI never shows them raw.
`src/lib/errors.ts` maps auth errors to `auth.errors.*` i18n keys
(invalid credentials, email not confirmed, user already registered,
password too short, rate limited, invalid/expired link, generic) and
detects the "tables do not exist" case (`isMissingTableError`, codes
`PGRST205` / `42P01` or matching messages) so the app can show the
"database setup is pending" state instead of an error.

## 4. Code layout

```
src/
├── main.tsx        entry: StrictMode, i18n side-effect import, <App />
├── app/            router + auth context + route guard
├── components/ui/  shadcn-style primitives (button, card, input, label)
├── hooks/          useAuth() — the only hook so far
├── i18n/           i18next init + en.json / bn.json
├── layouts/        AppLayout (sidebar + topbar + notices)
├── lib/            supabase client, error mapping, cn() helper
├── modules/        one folder per feature area (page + its logic)
├── services/       Supabase data access, one file per domain
├── stores/         placeholder — filled in by later phases
└── types/          domain types mirroring migration 0001
```

Rules:

- **Modules own pages; services own data access.** A module
  (`src/modules/<area>/`) renders UI and calls functions from
  `src/services/`; it never calls the Supabase client directly. The only
  exceptions are the shared client itself (`src/lib/supabase.ts`) and the
  auth subscription in `AuthProvider`.
- **One service file per domain.** `auth.ts` (Auth API),
  `restaurant.ts` (profiles / restaurants / restaurant_settings),
  `roles.ts` (roles / permissions / role_permissions, read-only in
  Phase 1). New domains get new files; do not grow one service into a
  catch-all.
- **Types mirror the database.** `src/types/index.ts` is a hand-written
  mirror of migration 0001. When a migration changes a table, update the
  matching type in the same change. (There is no generated-type step yet;
  adding Supabase type generation is a reasonable later improvement.)
- **`@/` path alias** maps to `./src` (configured in both `vite.config.ts`
  and `tsconfig.app.json`). All imports use `@/...`.

## 5. State approach

Deliberately minimal in Phase 1 — there is **no global store library**.
`src/stores/` is an empty placeholder.

- **Session + workspace state** lives in one React context,
  `AuthProvider` (`src/app/AuthProvider.tsx`): `user`, `profile`,
  `restaurant`, `settings`, `loading`, `dbPending`, plus
  `refreshWorkspace()` and `signOut()`. It loads the profile, then the
  restaurant and settings in parallel, after sign-in.
- **Page-local state** is plain `useState`/`useEffect` in each page
  (form values in Settings, role/permission lists in Roles).
- **Server state is fetched on demand**, not cached: every page load
  re-fetches what it needs through the service layer. There is no
  query-caching library yet.
- **Persistence outside the database:** only the language choice
  (`localStorage`, key `foodx.language`). No other client-side persistence
  exists yet.

When later phases add orders, inventory, and offline sync, this is the
area most likely to need a real store (and the `src/stores/` folder is
reserved for it). Do not introduce one for a single page's form state —
lift state to the context or keep it local until a second consumer needs
it.

## 6. i18n approach

- **i18next + react-i18next**, resources bundled as JSON
  (`src/i18n/locales/en.json`, `bn.json`), initialised in
  `src/i18n/index.ts`. Default and fallback language: `en`.
- **150 keys, identical key sets in both files** (verified in sync).
  Sections: `app`, `auth`, `common`, `dashboard`, `layout`, `nav`,
  `placeholder`, `roles`, `settings`.
- Every user-facing string goes through `useTranslation()` — no hardcoded
  UI text. Error messages go through the `auth.errors.*` keys
  (see §3).
- The language switcher is in the topbar (`AppLayout`); it switches
  immediately and persists the choice to `localStorage`
  (`foodx.language`), read back at startup. If storage is unavailable
  (private mode), the switch still works for the session.
- Adding a string: add the key to **both** locale files, in the same
  section. A key missing from `bn.json` silently falls back to English —
  that is the safety net, not the workflow.
- **Currency:** the restaurant currency defaults to `BDT`; the Settings
  form offers BDT, USD, EUR, INR. The Dashboard formats amounts with the
  restaurant's currency. Timezone defaults to `Asia/Dhaka`; the form
  offers Asia/Dhaka, Asia/Kolkata, Asia/Dubai, UTC.

## 7. Branding via CSS variables

Restaurants get their own look without a rebuild:

- `restaurant_settings` stores `branding_name`, `logo_url`,
  `primary_color`, `secondary_color` (defaults `#ea580c` / `#16a34a`).
- `AppLayout` applies the primary colour as `--primary`, `--ring`, and
  `--sidebar-primary` on the layout root, so Tailwind's `primary` colour
  follows the restaurant everywhere (sidebar, buttons, focus rings).
  `SettingsPage` applies the same variables to its own preview card so
  colour changes preview live before saving.
- The sidebar shows the restaurant's logo (if `logo_url` is set) or a
  utensils icon, and the branding name (falling back to the restaurant
  name, then "FoodX").
- The base theme (brand orange scale `--color-brand-*`, light/dark design
  tokens, radius) is defined once in `src/index.css` with Tailwind v4
  `@theme`. Note: the `.dark` token set exists in CSS, but **there is no
  dark-mode toggle in the UI** — the app always renders light today.

Known gaps in branding: `favicon_url` exists in the schema but the
Settings form does not edit it (logo URL only), and the PWA manifest icon
is the static `/favicon.svg` — per-restaurant favicons are not wired up
yet.

## 8. PWA: manifest only, offline deferred

`vite.config.ts` configures `vite-plugin-pwa` with:

- `registerType: 'autoUpdate'`.
- A manifest: name `FoodX`, `display: standalone`, `start_url: /`,
  `theme_color: #ea580c`, icon `/favicon.svg` (SVG, `sizes: any`).
- `workbox.globPatterns: []` — **the service worker precaches nothing.**

That is intentional for Phase 1: the app is installable (add to home
screen) but has no offline behaviour. Offline-first operation, runtime
caching, and cloud sync are **Phase 9** work. Do not present the app as
"works offline" — it does not. When Phase 9 lands, the precache list,
runtime caching strategies, and the sync/idempotency design in
[DATABASE.md](DATABASE.md#sync-and-data-integrity-notes) will need to be
designed together.

## 9. Graceful degradation when the database is not set up

Phase 1 was built while the live Supabase project had no tables yet, so
the app is designed to degrade instead of crash:

- `AuthProvider` catches "table does not exist" errors
  (`isMissingTableError`) and sets `dbPending: true` instead of throwing.
- `AppLayout` shows an amber "Database setup is pending" banner on every
  protected page while `dbPending` is true.
- `SettingsPage` and `RolesPage` render a dedicated pending-state card;
  `SettingsPage` refuses to save while `dbPending`.
- Non-schema errors (network, RLS denial) are **not** swallowed — they
  surface as the page's normal load/save error state.

Once the migration is applied, `dbPending` never triggers in normal use.
Keep the handling: it also protects against a future migration being
missed on a deployment.

## 10. What is intentionally deferred

| Topic | Current state | Planned |
| --- | --- | --- |
| Orders / POS flow | Built in Phase 2: POS, orders, state machine, payments, KDS | — |
| Menu, products, tables | Built in Phase 2: categories, products, variants, modifiers, kitchen stations, tables | — |
| Inventory, purchases, expenses | Built in Phase 3: stock items, recipes, movements, suppliers, purchase orders, POS deduction. Expenses still nothing | Phase 7 (Business) for expenses |
| Staff management, role editing, permission enforcement | Read-only Roles page; `role_permissions` empty; no enforcement | Phase 7 (Business) |
| Reports / analytics | Nothing; recharts installed but unused | Phase 7 (Business) |
| Customers, loyalty | Built in Phase 4: customer records + history, loyalty points (computed balances, earn on complete, redeem at POS, cancel/refund reversals), coupons (PERCENT/FIXED, validity, usage limits), POS integration | — |
| Online ordering, delivery | Built in Phase 5: one domain per restaurant (public storefront + `/panel` admin), QR + NFC per table, online orders into Orders/KDS, delivery settings (fee, minimum order) — pay at the restaurant, no online payment | Phase 6 (Delivery) for courier/delivery management; online payment unscheduled |
| Offline-first / LAN / sync, Docker, production hardening | Manifest-only PWA; no Docker files | Phase 9 |
| Developer Panel (separate from Restaurant Admin) | Nothing | Phase 8 |
| Branch management UI | `branches` table exists; no UI/service | Phase 7 (Business), with multi-branch work |
| Audit logging | `audit_logs` table exists (insert-only); nothing writes to it yet. Order status changes are audited in `order_status_history` (Phase 2), stock changes in `stock_movements` (Phase 3), and loyalty changes in `loyalty_transactions` (Phase 4) instead | When the first audited action lands — write the log call with the action, not after; decide the `audit_logs` vs `order_status_history` / `stock_movements` vocabulary first |
| Feature flags | Table exists; nothing reads/writes it | When the first gated feature lands |
| Global state store | `src/stores/` placeholder | When a second consumer needs shared state |
| Generated DB types | Hand-written mirror in `src/types/index.ts` | Optional improvement |
| Dark mode toggle | Tokens exist in CSS; no toggle | Unscheduled |

## 11. Decisions log

| Decision | Rationale | Where |
| --- | --- | --- |
| Separate DB per restaurant, not multi-tenant | Isolation by construction; fits licensed deployments; simpler backup/sync story | §1, [DATABASE.md](DATABASE.md) |
| RLS as second layer, via `current_restaurant_id()` SECURITY DEFINER helper | Prevents policy recursion; denies by default when no profile exists | §3, [DATABASE.md](DATABASE.md#row-level-security) |
| No custom backend server in Phase 1 | Supabase Auth + PostgREST cover the foundation; avoids hosting/operating a server per restaurant | §2 |
| No fake functionality | Dashboard shows honest `0`s; Roles editing says "Not implemented"; pending-DB state is a notice, not a crash | README, §9 |
| Manifest-only PWA | Installability now; offline/sync is a Phase 9 design problem, not a config flag | §8 |
| React context + local state, no store library | Phase 1 state is small (session + workspace + forms); a store would be premature | §5 |
| Stock changes only through movements | Quantities must never be edited directly — the item form has no quantity field, and the only writer is `apply_stock_movement()` (SECURITY DEFINER). `stock_movements` has no INSERT/UPDATE/DELETE policy at all; corrections are new ADJUSTMENT / WASTE movements | [DATABASE.md](DATABASE.md#phase-3-tables-inventory) |
| A sale is never blocked for stock | POS deduction may take stock negative; negatives are highlighted, not errors. Cancelling an order restocks via RESTOCK movements (`restock_for_order()`, idempotent); refunds do not restock | [DATABASE.md](DATABASE.md#phase-3-tables-inventory) |
| Loyalty balances are computed, never stored | A stored balance drifts the moment a transaction is missed; `SUM(points)` over append-only `loyalty_transactions` is always right. One EARN / one REDEEM per order enforced by a partial unique index; corrections are new ADJUSTMENT / REVERSAL rows | [DATABASE.md](DATABASE.md#phase-4-tables-customers) |
| Discount order is manual → coupon → loyalty | A single rule in `computeOrderTotals()`; the POS preview and `createOrder()` share it, so preview and placed order always agree. Refunding reverses the EARN; cancelling returns the redeemed points | [DATABASE.md](DATABASE.md#phase-4-tables-customers) |
| i18n from day one (en/bn, 150 keys) | Staff audience is Bangla-first; retrofitting i18n later is expensive | §6 |
| One domain per restaurant; admin under `/panel` on the same domain | Customers order directly on the restaurant's own domain (e.g. `addabuzz.com`); the software is managed on the same domain, not a separate admin URL. `foodx.bond` stays the platform's main domain. QR codes point at the restaurant's own domain | §12, [DEPLOYMENT.md](DEPLOYMENT.md) |
| Public menu is anon-readable; online ordering goes through SECURITY DEFINER functions | Customers must order with no login, so the menu tables have anon SELECT policies (checked first: no sensitive column) — but anon never touches `orders`/`customers` directly. `place_online_order()` re-reads prices and computes totals server-side, exactly like the POS, so a tampered client cannot set prices | §12, [DATABASE.md](DATABASE.md#phase-5-tables-digital-ordering) |
| No online payment in v1 | Pay at the restaurant (cash/card on delivery/pickup). Taking money online needs payment-provider work that belongs in a later phase, not bolted onto the first public endpoint | [DATABASE.md](DATABASE.md#phase-5-tables-digital-ordering) |
| Branding as CSS variables from `restaurant_settings` | Per-restaurant theme without rebuilds or per-tenant CSS bundles | §7 |

## 12. Domain routing (Phase 5)

Each restaurant gets its own domain; the app decides what to serve
from `window.location.hostname` at boot (`src/app/App.tsx`).

- **Platform hosts** — `localhost`, `127.0.0.1`, `foodx.bond`,
  `www.foodx.bond`, and any `*.vercel.app` preview host — run one
  router (`PlatformRoutes` in `src/app/App.tsx`): `/` serves the
  public storefront of the **FoodX Demo restaurant** (the platform
  domain is the demo landing page for client demos —
  `DEFAULT_DEMO_STORE_SLUG` in `src/services/storefront.ts`),
  `/panel/*` serves the admin app (signed in → Dashboard, signed out
  → Login page), `/devpanel*` serves a placeholder page for the
  Developer Panel (the real panel is Phase 8 work — no login form, no
  fake data), and the old admin URLs (`/login`, `/pos`, `/orders`, …)
  redirect to their `/panel/*` equivalents, query string included.
  `?store=<slug>` still overrides the demo restaurant to preview any
  other restaurant's storefront (and `?store=<slug>&table=<code>`
  pre-selects a table), so the feature can be tested without a real
  restaurant domain. Menus are public data by design.
- **Restaurant domains** — any other hostname is resolved with
  `resolve_restaurant_by_domain()`. A match serves the storefront at
  `/` and the admin under `/panel` (the same `AdminRoutes` with
  `basename="/panel"`). No match renders an honest "domain not
  connected" page linking to `https://www.foodx.bond` — never the
  admin login.
- **The panel lock** — in panel mode, `ProtectedRoute` takes a
  `lockedRestaurantId`. After login, if the signed-in profile's
  restaurant differs from the resolved one (or the account has no
  restaurant linked), the admin is replaced by an honest notice with
  a sign-out button. The lock is a UI guard on top of RLS: the data
  itself is still isolated by `current_restaurant_id()`, so even a
  lock bug cannot leak another restaurant's rows. Setup mode is also
  blocked in panel mode — a restaurant must be created on the main
  platform first.
- **Storefront** (`src/modules/storefront/StorefrontPage.tsx`) — no
  auth, no router, no `AppLayout`. It loads the restaurant through
  the `restaurant_storefronts` view, the menu through the existing
  menu service (which works anon once the policies exist), and
  availability through the inventory service. The cart preview uses
  the same `computeOrderTotals()` as the POS; placement sends only
  ids + quantities to `place_online_order()`. The QR/NFC URL for a
  table comes from one helper, `buildTableQrUrl()` in
  `src/services/storefront.ts` — the primary domain when one is set,
  otherwise the platform preview URL.
