# FoodX

FoodX is a restaurant management platform — one master codebase, deployed
per restaurant with **a separate database per restaurant**. It is a licensed,
self-contained deployment model, **not multi-tenant SaaS**: each restaurant
runs its own app instance against its own Supabase project, and no
restaurant's data ever shares a database with another's.

> **Status: Phase 5 — Digital Ordering.** This repository contains the
> app shell, authentication, restaurant setup, branding settings, a
> read-only roles & permissions view, the full core restaurant flow
> (menu, tables, POS, orders, KDS), inventory with recipes and
> purchases, customers with loyalty and coupons, and now digital
> ordering: each restaurant gets its own domain serving a public
> menu + online ordering, the admin runs under `/panel` on the same
> domain, tables get real QR codes + NFC values, and online/QR orders
> flow into Orders/KDS. See [What Phase 5 adds](#what-phase-5-adds)
> and [What is not built yet](#what-is-not-built-yet).

## Tech stack

| Layer | Choice |
| --- | --- |
| Build / framework | Vite 8 + React 19 + TypeScript 7 (strict) |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite`), shadcn-style UI components (Radix primitives, `class-variance-authority`, `clsx`, `tailwind-merge`) |
| Routing | react-router-dom 7 |
| Backend / database | Supabase (Postgres + Auth + PostgREST), `@supabase/supabase-js` v2 |
| i18n | i18next + react-i18next — English (`en`) and Bangla (`bn`), 681 keys each |
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

The schema lives in `supabase/migrations/` — `0001_foundation.sql`
(Phase 1), `0002_core.sql` (Phase 2), `0003_inventory.sql` (Phase 3),
`0004_cancel_restock.sql` (cancel-restock fix), `0005_customers.sql`
(Phase 4), `0006_fix_customers_schema.sql` (corrective — see
[DATABASE.md](DATABASE.md#phase-4-tables-customers)), and
`0007_digital_ordering.sql` (Phase 5). **Migrations 0001–0006 have
been applied to the live Supabase project; migration 0007 has not yet
been applied**, so until it is, the storefront / domains / online
ordering show a friendly error instead of crashing — pages that need
the tables degrade gracefully. Apply migration 0007 to make Phase 5
fully functional. When applying a migration from the dashboard, always
paste from the **fresh raw GitHub URL** and verify the new tables'
**columns** afterwards, not just their names (a stale paste once
applied a draft of 0005 — fixed by 0006).

### Option A — Supabase CLI (recommended)

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Apply migrations in filename order. For a new restaurant, apply all of
`0001_foundation.sql` through `0007_digital_ordering.sql`.

### Option B — Dashboard SQL editor

Supabase Dashboard → SQL Editor → New query, paste the full contents of
`supabase/migrations/0001_foundation.sql`, and run it. Repeat in filename
order for each later migration (`0002_core.sql` next). The SQL editor runs as `postgres`, which
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

### Demo seed data, Phase 2 (development only)

`supabase/seed_phase2.sql` adds a demo menu and tables for the demo
restaurant only: 2 kitchen stations, 3 categories, 8 products, 5
variants, 3 modifiers, 6 tables (T1–T6). It creates **no orders or
payments**. Run it after `seed.sql`, only against a local/development
project. **Never run it against production.** Removal SQL is in the file
header.

### Demo seed data, Phase 3 / 4 / 5 (development only)

`supabase/seed_phase3.sql` (demo stock, recipes + supplier),
`supabase/seed_phase4.sql` (demo customers + coupon) and
`supabase/seed_phase5.sql` (one demo domain row,
`demo.foodx.bond`, for the demo restaurant — not a real DNS record,
for code-path testing only) follow the same rule: demo restaurant
only, local/development only, **never run against production**.

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
2. Apply `supabase/migrations/0001_foundation.sql` through
   `supabase/migrations/0007_digital_ordering.sql` (see above).
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
- **Dashboard** (`/`) — today's sales, orders today and active tables,
  now read from the real Phase 2 tables (orders + tables). When there is
  no data yet it shows honest `0`s with a "No data yet" badge. No fake
  numbers, no mock charts.
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
- **i18n** — full English + Bangla UI, 469 keys, no missing keys in either
  language. Fallback language is English.
- **PWA manifest** — installable manifest (name, icons, theme colour
  `#ea580c`). The service worker currently precaches **nothing**
  (`workbox.globPatterns: []`); offline support is deferred.

## What Phase 2 adds

- **Menu** (`/menu`) — categories, products (price, availability,
  kitchen station, image URL), product variants (size/option with price
  adjustment), modifiers (paid add-ons), kitchen stations. Products keep
  working when their category or station is deleted (the link is set to
  NULL); past orders keep price/name snapshots.
- **Tables** (`/tables`) — table grid with live status (available /
  occupied / reserved / cleaning), create/edit, status change, delete
  (refused while the table has an active order). Each table has a QR
  code *value*; a QR *image* is not generated yet and the page says so.
- **POS** (`/pos`) — the order-taking screen: pick dine-in (table),
  takeaway, or delivery; browse categories/products with search; add
  items with variants, modifiers, and quantities; flat discount; tax +
  service charge from the restaurant settings; live total. **Prices are
  never trusted from the client** — the service re-reads product prices
  from the database at order time and computes every total. Placing an
  order creates the order + items + status history (`DRAFT → CONFIRMED`)
  and marks a dine-in table occupied. Payments: cash, card, bKash,
  Nagad, bank, due; split payments allowed; a payment may not exceed
  the remaining balance. The order summary is shown on screen — printing
  is not implemented yet and the page says so.
- **Orders** (`/orders`, `/orders/:id`) — list with a status filter,
  order detail (items with snapshots, payments, status history), and
  the state machine: `DRAFT → CONFIRMED → SENT_TO_KITCHEN → PREPARING →
  READY → SERVED → COMPLETED`, plus `CANCELLED` (reason required, from
  any non-terminal status) and `REFUNDED` (reason required, from
  `COMPLETED` only). Invalid moves are refused. Completing or
  cancelling an order frees its table when nothing else uses it.
- **Kitchen display** (`/kds`) — live orders in `SENT_TO_KITCHEN` /
  `PREPARING` / `READY`, grouped by kitchen station, oldest first, with
  waiting time. Kitchen advances `PREPARING → READY`. Live updates via
  Supabase Realtime with a 30-second poll and a manual refresh as the
  safety net.
- **Database** — 12 new tables, RLS on all of them, order-number
  uniqueness per restaurant, price/name snapshots on order items, and
  append-only payment + status-history tables (see
  [DATABASE.md](DATABASE.md#phase-2-tables-core-restaurant)).

## What Phase 3 adds

- **Inventory** (`/inventory`, nav "Inventory") — five tabs: Items,
  Recipes, Suppliers, Purchases, Movements.
- **Stock items** — name, unit (kg / litre / pcs — free text),
  low-stock threshold, cost price, active flag. The item form has **no
  quantity field**: stock quantities change only through movements (see
  below). Low stock is highlighted amber; negative stock red, with a
  warning that purchases/sales need checking. Total stock value is
  shown (quantity × cost price, summed).
- **Recipes** — each menu product links to ingredients with a quantity
  per serving (e.g. Chicken Burger = 1 Bun + 0.15 kg Chicken + 0.02 kg
  Cheese). The recipe tab shows how many servings the current stock
  allows; a product with no recipe is not stock-limited.
- **Stock movements (audit trail)** — every stock change writes a
  `stock_movements` row (who, when, type, signed quantity, reason,
  reference). The table is **append-only**: no UPDATE/DELETE policy at
  all, and rows are created only by the two database functions — a
  wrong movement is corrected by a new ADJUSTMENT / WASTE movement,
  never by editing history. Types: PURCHASE, SALE, ADJUSTMENT, WASTE,
  TRANSFER_IN, TRANSFER_OUT.
- **Adjust / Waste** — manual correction or spoilage, both with a
  **required reason** (silent corrections are refused).
- **Suppliers** — name, phone, email, address; a supplier with any
  purchase order cannot be deleted.
- **Purchase orders** — DRAFT → ORDERED → RECEIVED, CANCELLED from
  DRAFT or ORDERED only. Receiving is **full receipt only**: every line
  at its ordered quantity, one PURCHASE movement per line. Partial
  receiving is **not implemented** and the page says so. Receiving is
  idempotent per line (a retried receive cannot double-add stock).
- **POS stock deduction** — placing an order deducts recipe ingredients
  via `deduct_stock_for_order()` (idempotent — a retried placement
  cannot double-deduct). The POS shows products with 0 servable
  servings as **Out of stock** (cannot be added) and 1–4 servable with
  an "Only N left" badge. A sale is never blocked for stock reasons:
  deduction may take stock negative, and negatives are highlighted in
  the stock list. **Cancelling an order restocks ingredients**: one
  RESTOCK movement per item, exactly reversing the SALE deduction
  (`restock_for_order()`, idempotent — a retried cancel cannot
  double-restock). Refunds do NOT restock — a refunded order was
  already served, its food is gone.
- **Dashboard** — a low-stock line links to `/inventory` (real count,
  honest "All stock levels are OK" state; hidden entirely when the
  Phase 3 tables are not applied yet).
- **Database** — 6 new tables, RLS on all of them, and three SECURITY
  DEFINER functions (`apply_stock_movement`, `deduct_stock_for_order`,
  `restock_for_order`)
  (see [DATABASE.md](DATABASE.md#phase-3-tables-inventory)).

## What Phase 4 adds

- **Customers** (`/customers`, nav "Customers") — three tabs:
  Customers, Loyalty, Coupons.
- **Customer records** — name (required), phone, email, address,
  notes. The list shows total spent, visit count and points balance
  per customer; clicking a row opens the detail view (profile, points
  balance, loyalty transaction history, order history with number /
  date / total / status). Customers are **deactivated, never
  hard-deleted** (two-step confirm); a deactivated customer cannot be
  attached at the POS. Phone is unique per restaurant (multiple
  customers may have no phone). Search by name, phone or email.
- **Loyalty points** — a balance is **always computed**
  (`SUM(loyalty_transactions.points)`), never stored; there is no
  balance column anywhere. Points are earned **only when an order
  completes**: `floor(total / 100) × earn rate`, idempotent (one EARN
  per order — a retried completion cannot double-award). The rates live
  in `restaurant_settings` and are edited in Settings → Loyalty
  (defaults: 1 point per ৳100, 1 point = ৳1). The Loyalty tab lists
  per-customer balances, recent transactions across the restaurant,
  and a manual adjust form (points +/−, **reason required** — every
  adjustment is audited as an ADJUSTMENT transaction).
- **Coupons** — code (stored UPPERCASE), PERCENT (0 < value ≤ 100) or
  FIXED, minimum order amount, valid from/to dates, max uses (empty =
  unlimited), active flag. Usage is **computed, never stored**
  (COUNT of redemptions on non-cancelled orders). Coupons are
  **deactivated, never hard-deleted** when they have redemptions.
- **POS integration** — attach a customer (search by phone or name),
  apply a coupon code (validated: active, in its date window, under
  its usage limit, order meets the minimum), and redeem points (capped
  at the customer's balance AND at the remaining total after manual +
  coupon discounts). The order summary shows the three discount lines
  separately (manual, coupon, loyalty). All three are **optional** —
  an order with none attached works exactly as before. **Discount
  order: manual first, then coupon, then loyalty**, each clamped so
  the total never goes below 0; the POS preview uses the same
  `computeOrderTotals()` as `createOrder()`, so preview and placed
  order always agree.
- **Cancel / refund and points** — cancelling an order **returns its
  redeemed points** (one REVERSAL, idempotent); earned points are
  untouched (nothing was earned — the order never completed).
  Refunding an order **reverses its earned points** (one REVERSAL,
  idempotent) — the money came back, so the points for it come back
  too. Refunds still do NOT restock (Phase 3 rule). Both reversals are
  best-effort and never fail the cancel/refund.
- **Database** — 4 new tables (`customers`, `loyalty_transactions`,
  `coupons`, `coupon_redemptions`), 5 new columns on `orders`, 2 new
  columns on `restaurant_settings`; RLS on all of them;
  `loyalty_transactions` and `coupon_redemptions` are **append-only**
  (see [DATABASE.md](DATABASE.md#phase-4-tables-customers)).

## What Phase 5 adds

- **One domain per restaurant** — the customer-facing decision: each
  restaurant gets its own domain (e.g. `addabuzz.com`). The root of
  that domain serves the restaurant's public menu + online ordering
  with **no login**; the same domain under `/panel` serves the FoodX
  admin (login, locked to that restaurant — an account for a different
  restaurant sees an honest notice, never the admin). `foodx.bond`
  stays the platform's main domain. Each restaurant owns its domain
  and points DNS at Vercel; the Developer connects it in Vercel and
  maps it in the system (see [DEPLOYMENT.md](DEPLOYMENT.md)).
- **Hostname routing** (`src/app/App.tsx`) — platform hosts
  (`foodx.bond`, `www.foodx.bond`, `*.vercel.app`, `localhost`) run
  one router: `/` serves the public storefront of the **FoodX Demo
  restaurant** (the platform domain is the demo landing page —
  `DEFAULT_DEMO_STORE_SLUG` in `src/services/storefront.ts`),
  `/panel/*` serves the admin app (signed in → Dashboard, signed out
  → Login page), `/devpanel*` serves a placeholder page for the
  Developer Panel (the real panel is Phase 8 work), and the old admin
  URLs (`/login`, `/pos`, `/orders`, …) redirect to their `/panel/*`
  equivalents, query string included. Any other hostname is resolved
  with `resolve_restaurant_by_domain()` — a match serves the storefront
  at `/` and the admin under `/panel` (basename `/panel` + the panel
  lock in `ProtectedRoute`); no match renders an honest "domain not
  connected" page with a link to foodx.bond (never the admin login).
  `AdminRoutes` uses relative route paths on purpose, so the same
  component works mounted as a descendant of `/panel/*` (platform)
  and under basename `/panel` (restaurant domain).
- **Storefront** (`src/modules/storefront/StorefrontPage.tsx`, no auth,
  no app layout) — restaurant header (logo, name, own primary colour),
  language toggle, category chips + search, product list with variant
  picker and modifier checkboxes, availability badges from the
  inventory service (0 = "Out of stock", 1–4 = "Only N left"), cart
  with quantities, and checkout (name + phone required; Dine-in only
  when `?table=` is present, Pickup, Delivery only when enabled).
  **No second pricing engine**: the cart preview is priced from the
  loaded catalog with the same `computeOrderTotals()` the POS uses,
  and placement sends only ids + quantities — the server re-reads
  every price. After placing, the confirmation screen shows the big
  order number, the total, a "pay at the restaurant" note, and a live
  status line polled every 30 seconds.
- **Public preview** — on a platform host, `?store=<slug>` opens the
  storefront for that slug (and `?store=<slug>&table=<code>` pre-selects
  a table), so any restaurant's storefront can be tested without a
  real restaurant domain. Without `?store=`, the platform root shows
  the FoodX Demo restaurant. Menus are public data by design.
- **Server-side online ordering** — three `SECURITY DEFINER` functions
  (granted to `anon` + `authenticated`):
  `resolve_restaurant_by_domain(p_domain)` (id/slug/name only),
  `place_online_order(...)` (validates the restaurant, delivery type
  and rules, every item, re-reads prices, computes totals exactly like
  `computeOrderTotals`, creates the order + items + modifiers + one
  history row, links/creates the customer by phone, deducts stock,
  returns order id + number — all in one atomic function; no payment
  row, the order is unpaid), and `get_online_order_status(...)`
  (returns status + total only when the phone matches). All failures
  raise short machine-readable codes (`unknown_restaurant`,
  `invalid_item`, `table_not_found`, `delivery_not_available`,
  `min_order_not_met`, …). **No anti-spam/CAPTCHA on the public order
  endpoint in v1** — rate limiting is later work.
- **QR codes + NFC** (`/tables`) — each table now gets a **real QR
  code image** (generated locally with the `qrcode` library, no
  network call), a "Print QR" button (print-friendly view with the
  restaurant + table name), and the NFC value with a copy button and a
  "Save NFC value" button. The URL is
  `https://<primary domain>/?table=<qr value>` when a primary domain
  is set, otherwise the platform preview URL
  (`https://www.foodx.bond/?store=<slug>&table=<code>`).
- **Domains + delivery in Settings** — a Domains section lists the
  restaurant's domains (primary badge, set-primary, delete), an
  add-domain form, and the DNS instructions (A @ → 216.198.79.1,
  CNAME www → `e933cba5c7a21370.vercel-dns-017.com`, proxy OFF) plus
  the note that the Developer must also add the domain in Vercel. A
  Delivery card sets delivery on/off, the delivery fee, and the
  minimum order for delivery/pickup (0 = no minimum). All money
  inputs are `type="text"` + `inputMode="decimal"` with string state,
  parsed + `roundMoney` on submit (the Phase 3 lesson).
- **Online orders in the admin** — Orders list + detail show the order
  source (POS / QR / Online) and, on the detail, the customer
  name/phone/address (read-only). KDS shows online/QR orders exactly
  like POS orders (its query never filtered by source). A new order
  type, `pickup`, is handled everywhere the type is labelled (POS
  key added; the POS selector itself is unchanged).
- **Honest limits** — online payment is **NOT implemented**: v1 is
  pay at the restaurant (cash/card on delivery/pickup). Coupons and
  loyalty **redemption** are POS-only in v1; online orders still
  **earn** loyalty points when they complete (via `completeOrder` →
  `awardLoyaltyPoints`).
- **Database** — 1 new table (`restaurant_domains`), new columns on
  `orders` (`source`, `customer_name`, `customer_phone`,
  `delivery_address`, `delivery_fee`; `type` widened to include
  `pickup`), on `restaurant_settings` (`delivery_enabled`,
  `delivery_fee`, `min_order_amount`) and on `tables` (`nfc_value`);
  a public `restaurant_storefronts` view (anon + authenticated
  SELECT); anon SELECT policies on the menu tables (none carries a
  sensitive column — `products` has no `cost_price`); the three
  functions above (see
  [DATABASE.md](DATABASE.md#phase-5-tables-digital-ordering)).

## What is not built yet

Everything below is planned for later phases and is **not** in this repo.
Do not assume it exists.

| Area | Status |
| --- | --- |
| Kitchen display (KDS), inventory, purchases, expenses | KDS built (Phase 2); inventory + purchases built (Phase 3); expenses not started |
| Customers, loyalty, coupons | Built (Phase 4); delivery settings + online ordering built (Phase 5); online payment not started |
| Online payment | Not started — v1 is pay at the restaurant |
| Rate limiting / anti-spam on the public order endpoint | Not started (later work) |
| Reports / analytics | Not started (recharts is installed but unused) |
| Role editing / assigning permissions to roles | Read-only view only; the `role_permissions` table is seeded **empty** — the matrix shows all dashes until assignments are made (a later phase) |
| Branch management UI | The `branches` table exists; no UI or service touches it yet |
| Staff/user management UI | Not started |
| Feature flags UI | The `feature_flags` table exists; nothing reads or writes it yet |
| Audit log UI | The `audit_logs` table exists (insert-only); nothing writes to it yet |
| Offline-first / LAN mode / cloud sync | Reserved for Phase 9; PWA is manifest-only now |
| Developer Panel (separate from Restaurant Admin) | Not started |
| Docker packaging | Not started |

The 9-phase plan is: 1 Foundation → 2 Core Restaurant → 3 Inventory
→ 4 Customers → 5 Digital Ordering (this repo) → 6 Delivery → 7 Business
→ 8 Developer Platform → 9 Production Hardening. Phase numbers in code
comments refer to this plan.

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
│   │   │                       #   /update-password; protected /, /pos, /orders,
│   │   │                       #   /kds, /menu, /inventory, /tables, /customers,
│   │   │                       #   /settings, /roles
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
│   │       ├── en.json         # 571 keys
│   │       └── bn.json         # 571 keys (same key set as en)
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
│   │   ├── customers/          # CustomersPage (customers, loyalty, coupons)
│   │   ├── dashboard/          # DashboardPage (honest empty states)
│   │   ├── inventory/          # InventoryPage (items, recipes, suppliers,
│   │   │                       #   purchase orders, movements)
│   │   ├── kds/                # KdsPage (live kitchen display)
│   │   ├── menu/               # MenuPage (categories, products, stations,
│   │   │                       #   modifiers)
│   │   ├── orders/             # OrdersPage, OrderDetailPage
│   │   ├── pos/                # PosPage (order-taking screen)
│   │   ├── roles/              # RolesPage (read-only list + permission matrix)
│   │   ├── settings/           # SettingsPage (setup mode + edit mode)
│   │   └── tables/             # TablesPage (table grid + status)
│   ├── services/               # Supabase data access, one file per domain
│   │   ├── auth.ts             # signIn, signUp, signOut, password reset, onAuthStateChange
│   │   ├── inventory.ts        # stock items, movements, POS availability
│   │   ├── kds.ts              # live kitchen orders (Realtime)
│   │   ├── menu.ts             # categories / products / variants / modifiers
│   │   ├── orders.ts           # order list, detail, status machine
│   │   ├── pos.ts              # order placement (server-side pricing) + payments
│   │   ├── purchases.ts        # purchase orders (state machine, full receipt)
│   │   ├── coupons.ts          # coupon CRUD + validation + redemption
│   │   ├── customers.ts        # customer CRUD + stats + order history
│   │   ├── loyalty.ts          # balances (SUM), earn / redeem / reversal / adjust
│   │   ├── recipes.ts          # product → ingredient lines
│   │   ├── restaurant.ts       # profiles / restaurants / restaurant_settings queries
│   │   ├── roles.ts            # roles / permissions / role_permissions reads
│   │   ├── suppliers.ts        # supplier CRUD
│   │   └── tables.ts           # table queries + status changes
│   ├── stores/                 # Placeholder — filled in by later phases
│   ├── types/
│   │   └── index.ts            # Domain types mirroring migrations 0001–0005
│   └── index.css
├── supabase/
│   ├── README.md               # Database guide (migration, RLS, seed)
│   ├── migrations/
│   │   ├── 0001_foundation.sql # 10 tables, RLS, indexes, roles + permissions seed
│   │   ├── 0002_core.sql       # Menu, tables, orders, payments, kitchen display
│   │   ├── 0003_inventory.sql  # Stock, recipes, suppliers, purchases, movements
│   │   ├── 0004_cancel_restock.sql # Cancel restocks: RESTOCK + restock_for_order()
│   │   └── 0005_customers.sql  # Customers, loyalty, coupons, redemptions
│   ├── seed.sql                # Demo restaurant + branch (dev only)
│   ├── seed_phase2.sql         # Demo menu + tables (dev only)
│   ├── seed_phase3.sql         # Demo stock, recipes, supplier (dev only)
│   └── seed_phase4.sql         # Demo customers + coupon (dev only)
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
  the **same key set** (currently 469 keys each, verified in sync).
- The switcher lives in the topbar (`AppLayout`); the choice is stored in
  `localStorage` under `foodx.language` and applied on next load.
- Adding a string: add the key to **both** locale files, in the same
  section (`app`, `auth`, `common`, `dashboard`, `layout`, `nav`,
  `placeholder`, `roles`, `settings`).
- Currency formatting on the Dashboard uses the restaurant's currency
  (default `BDT`); the Settings form offers BDT, USD, EUR, INR.

## Brand assets

FoodX logo: geometric X mark, primary orange `#ea580c`, secondary deep
charcoal `#1C1917`, cream `#FFF6ED`. Tagline: "Every order. Under control."
/ "প্রতিটি অর্ডার, নিয়ন্ত্রণে।" Dark variants (black background) are kept
as source material for a future dark mode and are not shipped yet.

Performance rules for the logo (so it never slows the site down):

- Source files are 2048×2048 PNGs — never ship those. Regenerate with
  `scripts/build_brand_assets.py` (removes the cream background, trims,
  resizes to the exact display size, saves WebP).
- In-app images live in `src/assets/brand/` so Vite emits them with a
  content hash (long-term caching): `logo-mark.webp` 128px / 6.3 KB
  (sidebar + favicon fallback), `logo-wordmark.webp` 480px / 24.7 KB
  (login page only — no other page downloads it).
- Stable-URL files live in `public/`: `favicon.png` 64px,
  `apple-touch-icon.png` 180px, `pwa-192.png` / `pwa-512.png` (manifest
  icons; fetched only on install), `brand/logo-lockup.png` 1200px
  (og-image — fetched only by link-preview crawlers, never by visitors).
- The restaurant's own logo (Settings → Branding → Logo URL) always
  overrides the FoodX mark in the sidebar.
- **Sidebar layout (Fahim's rule, 2026-11-16):** top = the restaurant's
  logo ONLY (wider when no name is shown); the name appears next to it
  only when a display name is set in Settings → Branding (`branding_name`
  — empty means logo only). When no logo is set, the first letter of the
  restaurant name shows in a tile — never the FoodX mark. Bottom = the
  FoodX **wordmark image** + tagline (never the X icon + typed "FoodX").
- **Receipt & invoice branding (Fahim's rule, 2026-11-16):** on every
  receipt and invoice, the restaurant's logo goes on top and the FoodX
  mark sits small underneath it ("Powered by FoodX"). Build this in when
  receipt printing / invoicing lands (Phase 7); POS printing is not
  implemented yet.
- **The FoodX logo is immutable for restaurants:** it is a bundled asset
  in `src/assets/brand/` — there is no setting anywhere that can change
  it. Only the developer (a code change) can ever swap it. Restaurant
  admins can only change their own restaurant's logo, name and colours.

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
