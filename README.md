# FoodX

FoodX is a restaurant management platform — one master codebase, deployed
per restaurant with **a separate database per restaurant**. It is a licensed,
self-contained deployment model, **not multi-tenant SaaS**: each restaurant
runs its own app instance against its own Supabase project, and no
restaurant's data ever shares a database with another's.

> **Status: Phase 8 — Developer Platform (Steps 1 + 2).** This repository contains the
> app shell, authentication, restaurant setup, branding settings, a
> read-only roles & permissions view, the full core restaurant flow
> (menu, tables, POS, orders, KDS), inventory with recipes and
> purchases, customers with loyalty and coupons, digital ordering
> (each restaurant gets its own domain serving a public menu + online
> ordering, the admin runs under `/panel` on the same domain, tables
> get real QR codes + NFC values, and online/QR orders flow into
> Orders/KDS), and now delivery management: drivers, zones, a
> delivery board with driver assignment and a tracked delivery
> status lifecycle, and now business: expenses with categories,
> cashier shifts with daily closing, reports and a live profit &
> loss, and now the developer platform (Step 1): a vendor-only
> registry of client deployments — clients, licenses, releases,
> per-client feature flags — at `/devpanel`, fully separated from
> the restaurant admin. See [What Phase 8 adds](#what-phase-8-adds)
> and [What is not built yet](#what-is-not-built-yet).

## Tech stack

| Layer | Choice |
| --- | --- |
| Build / framework | Vite 8 + React 19 + TypeScript 7 (strict) |
| Styling | Tailwind CSS v4 (via `@tailwindcss/vite`), shadcn-style UI components (Radix primitives, `class-variance-authority`, `clsx`, `tailwind-merge`) |
| Routing | react-router-dom 7 |
| Backend / database | Supabase (Postgres + Auth + PostgREST), `@supabase/supabase-js` v2 |
| i18n | i18next + react-i18next — English (`en`) and Bangla (`bn`), 981 keys each |
| Icons | lucide-react |
| PWA | vite-plugin-pwa — **manifest only** in Phase 1 (see below) |
| Lint | oxlint (`npm run lint`) |
| Charts | recharts — dashboard and reports charts |

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
`0007_digital_ordering.sql` (Phase 5), `0008` / `0009`
(place_online_order corrective fixes), `0010_remove_orphan_trigger_functions.sql`
(drift cleanup — two orphan trigger functions dropped), and
`0011_delivery.sql` (Phase 6),
`0012_storefront_zone_picker.sql` (Phase 6 step 2) and
`0013_business.sql` (Phase 7). **Migrations
0001–0013 have been applied to the live Supabase project**
(verified 2026-11-17: all tables, functions and RLS policies match
this repo). Pages that need
tables from a migration that has not been applied yet degrade
gracefully instead of crashing. When applying a migration from the dashboard, always
paste from the **fresh raw GitHub URL** and verify the new tables'
**columns** afterwards, not just their names (a stale paste once
applied a draft of 0005 — fixed by 0006).

### Option A — Supabase CLI (recommended)

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Apply migrations in filename order. For a new restaurant, apply all of
`0001_foundation.sql` through `0013_business.sql`.

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

### Demo seed data, Phase 3 / 4 / 5 / 6 (development only)

`supabase/seed_phase3.sql` (demo stock, recipes + supplier),
`supabase/seed_phase4.sql` (demo customers + coupon) and
`supabase/seed_phase5.sql` (one demo domain row,
`demo.foodx.bond`, for the demo restaurant — not a real DNS record,
for code-path testing only) and `supabase/seed_phase6.sql` (two demo
drivers + two demo zones for the demo restaurant) follow the same
rule: demo restaurant only, local/development only, **never run
against production**.

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
  one router: `/` serves the **FoodX marketing landing page**
  (the demo restaurant moved to `demo.foodx.bond`, a normal
  restaurant-domain mapping — see the landing section below; a
  `?store=<slug>` on the root still previews a storefront),
  `/panel/*` serves the admin app (signed in → Dashboard, signed out
  → Login page), `/devpanel*` serves the Developer Panel (Phase 8), and the old admin
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

## What Phase 6 adds

- **Delivery tables** (`0011_delivery.sql`) — `delivery_drivers`
  (restaurant-scoped, optional branch / profile link, status
  AVAILABLE / ON_DELIVERY / OFFLINE), `delivery_zones` (fee,
  minimum order, estimated minutes), `delivery_orders` (the 1:1
  dispatch record for an order: driver, zone, COD amount snapshot,
  per-step timestamps) and `delivery_status_history` (append-only).
  Standard repo isolation: RLS with `restaurant_id =
  current_restaurant_id()`, child rows scoped through the parent
  order with EXISTS. Existing delivery orders are backfilled a
  PENDING row (cod_amount = order total).
- **Delivery service** (`src/services/delivery.ts`) — driver / zone
  CRUD, the board query (creates the PENDING dispatch row on first
  sight so POS and pre-Phase-6 delivery orders are never invisible),
  `assignDriver` and `advanceDeliveryStatus`, validated against
  `DELIVERY_TRANSITIONS` with a history row per change. DELIVERED
  frees the driver and completes the linked order through the
  orders service (READY → SERVED → COMPLETED as needed); FAILED /
  CANCELLED free the driver but never auto-cancel the order.
- **Delivery page** (`/panel/delivery`) — board with customer,
  address, COD, driver and zone per order; assign / re-assign a
  driver (with optional zone); advance buttons per status; Drivers
  and Zones tabs with full CRUD (money as text + decimal, two-step
  delete). Sidebar entry + EN/BN i18n.
- **Storefront zone picker (step 2, `0012_storefront_zone_picker.sql`):**
  at checkout the customer picks a delivery zone; `place_online_order`
  validates it server-side (`invalid_zone`) and the zone's fee +
  minimum replace the settings values for that order. The choice is
  stored on `orders.delivery_zone_id` and the board pre-fills its
  dispatch row from it. Restaurants without zones keep the settings
  fee, unchanged. Still not built: a separate driver app — drivers
  are managed from the panel and `fetchDriverDeliveries` backs a
  simple driver view.

## What Phase 7 adds

- **Business tables** (`0013_business.sql`) — `expense_categories`
  (the §36 twelve, seeded per restaurant by the service on first
  use), `expenses` (category, amount, date, payment method, branch,
  notes; **voided, never hard-deleted** — there is deliberately no
  DELETE policy on the table), `cashier_shifts` (opening cash,
  expected cash computed at close, counted actual, difference),
  `shift_cash_movements` (append-only CASH_IN / CASH_OUT /
  ADJUSTMENT, reason required) and `daily_closings` (one snapshot
  per restaurant per day). Standard repo isolation.
- **Business service** (`src/services/business.ts`) — expense CRUD +
  void, category management, shift open/close (expected cash =
  opening + cash payments received in the shift window − non-voided
  cash expenses recorded in the window + movements, always
  recomputed from DB rows, never client-passed), daily closing
  snapshots, and the report queries: P&L, daily sales series,
  product / category sales, payment breakdown, expense-by-category,
  delivery summary, supplier payables (RECEIVED purchase totals;
  since Step 2A, recorded supplier payments are subtracted —
  migration `0017_supplier_payments.sql` adds `supplier_payments`,
  again with no DELETE policy, plus a manual `products.cost_price`
  fallback for margin reporting).
- **Business page** (`/panel/business`) — tabs: Expenses (period /
  category filters, add / edit / void, category manager), Shifts &
  Closing (open shift, live expected cash, movements, close with
  the difference shown, shift history, daily closing), Reports
  (Recharts daily-sales chart, product / category / payment /
  delivery tables, CSV export of exactly what is on screen) and
  Profit & Loss (sales − purchases − expenses − refunds, computed
  live). Sidebar entry + EN/BN i18n.
- **Dashboard** — today's expenses and net-today cards, a 7-day
  sales chart, today's payment breakdown and top products (the
  widgets stay hidden until the Phase 7 tables exist, like the
  earlier phase widgets).
- **Step 2A (2026-11-18):** the full §39 report list is now in the
  Reports tab behind a picker — overview, cashier, waiter (orders
  grouped by creator, filtered to the waiter role; orders record no
  separate waiter field), branch, kitchen (items per station +
  average completion time), customer, loyalty, inventory, purchase,
  supplier balances (received − paid = due), tax & discounts,
  refunds & voids, shifts — plus the §28 **item margin** report
  (recipe cost first, manual `products.cost_price` as fallback, no
  cost data shown honestly). Every table prints via the browser
  print flow (Save-as-PDF covers §39's "PDF where appropriate") and
  still exports CSV. Supplier payments are recorded from the
  Inventory → Suppliers tab. **Receipt + kitchen ticket printing**
  (§62) is built: POS prints the placed order's receipt, the order
  detail page reprints receipt and kitchen ticket — restaurant logo
  on top, small "Powered by FoodX" underneath (branding rule below);
  the browser print dialog picks the printer (no per-device printer
  routing yet).
- **Step 2B (2026-11-18):** branches are manageable and stock is
  tracked per branch (§40–§41). Migration
  `0018_branch_stock_transfers.sql` adds `branch_stock` (written
  only by the stock functions, like `stock_movements`),
  `stock_movements.branch_id`, and `stock_transfers` /
  `stock_transfer_items` (no DELETE policies — the transfer history
  is the audit trail). `apply_stock_movement()` now also moves the
  branch quantity (the order's branch for sales, the main branch by
  default), so the global total stays the single source the rest of
  the app reads. Receiving a transfer runs in one database function:
  it refuses when the source branch lacks the stock, writes the
  TRANSFER_OUT / TRANSFER_IN movements, and never changes global
  totals. UI: a **Branches page** (`/panel/branches`, CRUD, one main
  branch enforced) and an Inventory **Transfers tab** (per-branch
  stock viewer, transfer request → approve → receive flow). Not
  covered: per-branch menus, delivery zones or printer routing.

## What Phase 8 adds

### Step 2 — instance heartbeat (migration `0015`)

- **Registry additions** (`0015_instance_heartbeat.sql`) —
  `dev_clients.instance_token_hash` (only the SHA-256 hash of the
  per-instance token is stored; the plaintext is shown once in the
  Developer Panel and then lives only in that deployment's env) and
  `dev_clients.last_seen_at`, plus `dev_heartbeats`, an append-only
  check-in history only the Edge Function's service role writes.
- **Edge Function** (`supabase/functions/instance-heartbeat`) —
  deployed on the registry project. An instance POSTs its client
  code, token and version (with the registry's public anon key); the
  function validates the token hash, records the heartbeat, and
  answers with the effective license state (same computed-expiry
  rule as the panel), the client's feature flags, and the newest
  published release targeted at it. CORS is open by design — the
  token is the auth.
- **Instance side** (`src/services/heartbeat.ts`,
  `src/lib/version.ts`) — configured per deployment via
  `VITE_FOODX_REGISTRY_URL`, `VITE_FOODX_REGISTRY_ANON_KEY`,
  `VITE_FOODX_INSTANCE_ID`, `VITE_FOODX_INSTANCE_TOKEN` (see
  `.env.example`). Unconfigured deployments do nothing. The panel
  heartbeats on load and every 6 hours and caches the response, so
  everything works offline; a license problem raises a warning
  banner but never blocks POS (§53). Settings gains a **License &
  updates** card (§42) with a manual "Check now". The Delivery and
  Business modules are gated by the pulled feature flags (§60).
  Update *execution* remains a vendor-operated deploy — the panel
  only detects and displays new releases (§56).

- **Feature-flag enforcement completed** (Phase 8 remainder R1) —
  all six §60 flags now have real effects, still under the §53
  rule (only an explicit `false` from the registry gates; POS is
  never blocked): **online_ordering** off replaces the storefront
  checkout with an "ordering unavailable" notice (the menu stays
  browsable; the storefront reads the same-origin license cache,
  and the server-side order RPC itself is not gated);
  **loyalty** off hides the Customers → Loyalty tab and the
  loyalty report (points data is untouched); **multi_branch**
  off hides the Branches page and the Inventory → Transfers tab.
  **nfc** has no module in the app yet, so the flag stays
  informational and the Developer Panel says so next to the
  toggles.

- **Registry moved to a vendor-only project** (Phase 8 remainder
  R5) — the registry no longer lives inside the demo deployment's
  database. A separate Supabase project (`foodx-registry`) holds
  the `dev_*` tables, the developer allow-list and the
  `instance-heartbeat` / `instance-activate` functions; its schema
  is `supabase/registry/bootstrap.sql` (migrations 0014 + 0015
  adapted: developer identities reference `auth.users`, since the
  registry project has no restaurant `profiles` table). The
  Developer Panel and its sign-in gate use a dedicated registry
  client (`src/lib/registry.ts`, built from the
  `VITE_FOODX_REGISTRY_*` env vars every deployment already
  carries); the gate also offers sign-up, though an account alone
  grants nothing until it is added to `dev_developers`. Migration
  `0020_remove_registry_schema.sql` drops the `dev_*` tables from
  client deployments, so a client database never carries the
  vendor registry again. The registry project never applies
  client migrations.

- **License limits enforced** (Phase 8 remainder R2) — the §52
  `max_branches` / `max_users` on a license (columns exist since
  migration 0014; editable in the Developer Panel license form)
  now take effect. Each heartbeat also reports the deployment's
  branch and user counts; the registry stores the latest counts
  on the client record (`last_branch_count` / `last_user_count`,
  added by the R2 amendment in `supabase/registry/bootstrap.sql`)
  and returns the active license's limits, which the panel
  caches with the rest of the license state. Enforcement is soft
  and creation-only (§53): the Branches page refuses to create a
  branch beyond `max_branches` and the Staff page refuses to
  create an account beyond `max_users`, each with a clear
  message; existing data above a lowered limit is never deleted,
  editing is never blocked, and a deployment that has not
  checked in enforces nothing. The Developer Panel client detail
  shows reported usage against the limits (§72). `max_devices`
  remains a recorded license field only — the app keeps no
  device registry, so nothing enforces it.

- **Backup status reporting** (Phase 8 remainder R3) — a browser
  app cannot back up its own database, so §59 is implemented as
  a vendor procedure plus reporting, never a fake button. The
  vendor runs `scripts/backup-client.sh` (pg_dump of the client's
  database using the connection string from the vendor's vault,
  stored under a dated path on the vendor machine; scheduling is
  a vendor ops choice). After every run — success OR failure —
  the script calls the registry's `report-backup` Edge Function
  (authenticated by the client's instance token, like the
  heartbeat), which appends a `dev_backup_reports` history row
  and stamps `last_backup_at` / `last_backup_status` on the
  client record (registry schema: the R3 amendment in
  `supabase/registry/bootstrap.sql`). The Developer Panel's
  deployment-health card now shows real backup counts (fresh
  <48h / stale / failed / never reported), and the client detail
  shows the last backup plus the recent report history (§72).
  There is deliberately no "Backup now" button in the panel —
  it could not run one honestly.

- **Update execution + rollback** (Phase 8 remainder R4) —
  version 1.0.0 is the first real release. How an update flows
  (§56): the vendor promotes `main` → `release/stable` on GitHub
  when a release is ready (real client Vercel projects track
  `release/stable` as their production branch, so half-finished
  work on `main` never reaches a restaurant); each client
  project has a Vercel Deploy Hook whose URL is stored ONLY in
  the registry (`dev_clients.deploy_hook_url`). Two trigger
  paths, both server-side via registry Edge Functions so the
  hook URL never reaches a client browser: the Developer Panel's
  **Deploy update** button (`trigger-update`, developer-JWT
  authenticated, allow-list re-checked in the function) and the
  client panel's **Update now** button on the update banner
  (`request-update`, instance-token authenticated). The client
  path enforces the §56 order: it refuses with `backup_required`
  unless the client's last reported backup is a success no older
  than 7 days — backup first, then update. The vendor path
  reports the last backup state in its response instead, since
  the vendor owns the backups. Confirmation is the next
  heartbeat reporting the new version; the Developer Panel shows
  the client as update-pending until then and derives "Last
  update" (§72) from the heartbeat history. **Rollback (§58):**
  application rollback is Vercel's instant rollback to the
  previous deployment in the client's project (Deployments →
  ⋯ → Rollback — seconds, no rebuild); database rollback is
  restoring the pre-update backup (§59: run the backup script
  before every update; restore with `psql < dump.sql` against
  the client database, then roll the application back to the
  matching version). If the post-update heartbeat does not
  report the new version within the expected window, treat the
  update as failed: roll the application back first, restore
  the database only if a migration is implicated, and note the
  failure on the client's support record. There is deliberately
  no in-app rollback button — rollback is a vendor operation on
  vendor infrastructure. (The demo project itself keeps tracking
  `main` — it is the development deployment; the hook on it
  points at `main`.)


- **Developer registry tables** (`0014_devpanel.sql`) — `dev_clients`
  (the §51 client record: code, restaurant, owner, contact, domain,
  instance URL, Supabase ref, registered version, plan, status),
  `dev_licenses` (§52: `LIC-` key generated by the database,
  MONTHLY / QUARTERLY / HALF_YEARLY / YEARLY / LIFETIME plans —
  LIFETIME must have no expiry date; at most one ACTIVE license per
  client), `dev_releases` (§55: semver, notes, required migrations,
  target clients), `dev_client_features` (§60 per-client flags —
  vendor-registry scope, distinct from the per-restaurant
  `feature_flags` table), `dev_support_notes` (§72, append-only) and
  `dev_developers`, the developer allow-list. Every policy on these
  tables requires `public.is_developer()`; `dev_developers` itself is
  readable only by developers and writable only through SQL, so
  membership is a deliberate vendor action. Restaurant users get
  nothing from these tables (§88).
- **Developer service** (`src/services/devpanel.ts`) — developer gate
  check, client CRUD + suspend / activate, license create / activate /
  suspend / cancel and renewal (the old row is marked RENEWED and a
  new row created — history is kept), computed license expiry (an
  ACTIVE license past its expiry date reads EXPIRED; no cron needed),
  release draft / publish / archive, semver comparison for
  update-pending clients, per-client feature toggles, support notes.
- **Developer Panel page** (`/devpanel`) — replaces the earlier
  placeholder. Its own sign-in gate (fully separated from `/panel`),
  an allow-list check with an honest locked notice for
  non-developers, and tabs: Dashboard (§50 totals, license counts,
  current version, update-pending, clients without a license;
  deployment / backup health honestly shown as not reported yet),
  Clients (list, create / edit, detail with features + support
  notes), Licenses and Releases. EN/BN i18n.
- **Not in this step (Step 2):** instances reporting home —
  heartbeat, live license validation with offline grace (§53),
  update detection / execution (§56), rollback (§58), backup status
  (§59) and client instances pulling their feature flags (§60).
  Until then, versions and statuses in the panel are **as
  registered** by the developer, and the UI says so.

## What Phase 9 adds (v1 — offline order queue)

Phase 9 (Production Hardening) starts with the §5 offline-first
slice. Full design + rationale: OFFLINE_SYNC.md.

- **Offline order queue** (`src/services/offlineQueue.ts`): when
  the POS loses connectivity, orders are captured on the device
  (localStorage, per restaurant) with a UUID idempotency key,
  device ID, timestamp, source and sync status, the priced
  snapshot as charged, and any payments taken at the counter.
- **Sync** (`src/hooks/useOfflineSync.ts` + `pos.syncQueuedOrder`):
  on reconnect the queue replays automatically — existence +
  totals validation first, then the same idempotent write path
  as a live order (order number assigned at sync, stock deducted
  by the idempotent RPC). Validation failures are parked in the
  POS queue panel with a reason, never silently dropped.
- **Counter UX**: offline badge, queue chip + panel in the POS,
  a queued-order card with a local reference (OFF-…, never a fake
  order number), payments against the entry, and receipt printing
  from the snapshot. Customer / coupon / loyalty are disabled
  while offline (they need live validation).
- **App shell precache**: the PWA now precaches the built shell,
  so the panel opens offline and the queue survives reloads.
- **Catalog cache (v2)** (`src/services/catalogCache.ts`): the
  workspace (profile / restaurant / settings) and the POS
  catalog (categories, products with variants + modifiers,
  tables, branches, availability) are saved to localStorage on
  every successful online load. A POS opened cold while offline
  restores both and sells from the saved menu, with a
  "menu saved at <time>" note (stronger wording past 24 hours);
  sync validation stays server-side, exactly as in v1. LAN
  mode and multi-device sync (§4) remain future work.

## Landing page, demo subdomain & client onboarding

The sales/delivery flow on top of the 9 phases (owner's product
decision, 2026-11-17/18; design: LANDING_ONBOARDING_DESIGN in the
project notes):

- **Step 1 — landing + demo subdomain.** `foodx.bond` root is the
  FoodX marketing landing page (`src/modules/landing/LandingPage.tsx`,
  EN/BN, honest content only — no invented pricing or testimonials).
  The live demo moved to **demo.foodx.bond**: a `restaurant_domains`
  row maps it to the demo restaurant, so the ordinary client-domain
  machinery serves its storefront and its `/panel`. A public demo
  account (demo@foodx.bond, restaurant_owner on the demo restaurant)
  is printed on the landing page so prospects can explore the panel.
- **Step 2 — license-key activation + onboarding wizard**
  (migration `0016_instance_activation.sql`):
  - Registry Edge Function `instance-activate` — POST a license key;
    it validates the license (computed expiry) and client, refuses
    re-activation (`already_activated` — rotation stays a vendor
    action), generates the instance token, stores only its hash, and
    returns `{ instance_id, token }` once.
  - `instance_config` (single row, admin-role RLS only, anon denied)
    stores the deployment's registry URL / client code / token;
    `src/services/activation.ts` writes it and `heartbeat.ts` resolves
    config as instance_config → env vars → inert.
  - `/panel/setup` wizard — restaurants with
    `restaurant_settings.onboarding_completed = false` are routed
    here first (0016 marks all pre-existing restaurants true):
    restaurant info → license activation (the same form also lives in
    Settings → License) → done. Skippable; never a lock (§53).
- **Step 3 — staff management** (`/panel/staff`): the admin creates
  staff logins with a role, changes roles, resets passwords and
  deactivates/reactivates accounts. All of it runs through the
  `manage-staff` Edge Function in the client project (creating logins
  needs the Auth Admin API; profiles/user_roles RLS is self-only).
  The function verifies the caller's JWT, requires an admin-level
  role, and scopes everything to the caller's restaurant; nobody can
  modify themselves, and the last active admin cannot be demoted or
  deactivated. Deactivation also bans the Auth user, so a disabled
  account really cannot sign in. No migration was needed.

## What is not built yet

Everything below is planned for later phases and is **not** in this repo.
Do not assume it exists.

| Area | Status |
| --- | --- |
| Kitchen display (KDS), inventory, purchases, expenses | KDS built (Phase 2); inventory + purchases built (Phase 3); expenses built (Phase 7) |
| Customers, loyalty, coupons | Built (Phase 4); delivery settings + online ordering built (Phase 5); online payment not started |
| Delivery management | Built (Phase 6): drivers, zones, board, assignment, status history, storefront zone picker; separate driver app not started |
| Online payment | Not started — v1 is pay at the restaurant |
| Rate limiting / anti-spam on the public order endpoint | Not started (later work) |
| Reports / analytics | Built (Phase 7 + Step 2A): full §39 list (P&L, sales, cashier, waiter, branch, kitchen, customer, loyalty, inventory, purchase, supplier balances, tax, discounts, refunds/voids, shifts), §28 item margins, CSV export + print/PDF |
| Role editing / assigning permissions to roles | Read-only view only; the `role_permissions` table is seeded **empty** — the matrix shows all dashes until assignments are made (a later phase) |
| Branch management UI | Built (Phase 7 Step 2B): Branches page CRUD + per-branch stock and transfers (§40–§41) |
| Staff/user management UI | Built (Landing Step 3): `/panel/staff` via the manage-staff Edge Function (create, role, activate/deactivate, password reset) |
| Feature flags UI | The `feature_flags` table exists; nothing reads or writes it yet |
| Audit log UI | The `audit_logs` table exists (insert-only); nothing writes to it yet |
| Offline-first / LAN mode / cloud sync | v1+v2 built (Phase 9): offline POS order queue + sync, app-shell precache, workspace + catalog cache for offline cold start (see OFFLINE_SYNC.md); LAN mode / multi-device sync not started |
| Developer Panel (separate from Restaurant Admin) | Built (Phase 8 complete): registry in its own Supabase project, heartbeat validation, feature flags + license limits enforced, backup reporting, deploy-hook updates with a backup gate, rollback runbook above |
| Docker packaging | Not started |

The 9-phase plan is: 1 Foundation → 2 Core Restaurant → 3 Inventory
→ 4 Customers → 5 Digital Ordering → 6 Delivery → 7 Business
→ 8 Developer Platform (this repo) → 9 Production Hardening. Phase numbers in code
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
  mark sits small underneath it ("Powered by FoodX"). Receipt and
  kitchen-ticket printing landed in Phase 7 Step 2A following this
  rule (restaurant logo on top, the Powered-by line underneath).
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

## Self-KIOSK setup (counter tablet)

Any storefront becomes a self-order kiosk by opening it with
`?kiosk=1` — e.g. `https://demo.foodx.bond/?kiosk=1` (on a client
deployment, that client's own domain). Kiosk mode is pickup-only,
shows oversized menu tiles, hides the staff-login and footer
links, and after each order shows the customer a big token
number ("pay at the counter"); the screen resets itself after
~8 seconds for the next customer. Staff leave kiosk mode by
pressing and holding the restaurant name/logo in the header for
3 seconds, which reveals an "Exit kiosk mode" button.

Locking the tablet itself is the device's job — the web app
cannot (and does not pretend to) stop someone leaving the
browser:

- Android: Settings → Security → Screen pinning (or the
  tablet's kiosk app), Chrome menu → "Add to Home screen".
- iPad: Settings → Accessibility → Guided Access, then
  triple-click the side button inside the kiosk page.
- Put the tablet in fullscreen (panel header toggle, or the
  browser's fullscreen) and keep it plugged in.

## License

No license file yet — the license decision is pending. Do not assume a
license; do not add one without the maintainer's decision.
