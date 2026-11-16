# FoodX — Deployment

One master codebase, deployed per restaurant with **a separate
database per restaurant** (licensed deployments, not multi-tenant
SaaS). This guide covers the frontend (Vercel), the database
(Supabase, per restaurant), and — since Phase 5 — connecting a
restaurant's own domain so customers order on it directly.

## Frontend — Vercel

Deployment target is the **old Vercel account, team "New
Bangladesh"** (the project is deployed from the website, not from
this repo's tooling).

1. Import this repository into Vercel (framework preset: Vite).
2. Set the two environment variables in the project settings:
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Deploy. Build command is `npm run build`; output directory is
   `dist/`.

A `vercel.json` in the repo rewrites every path to `/index.html`
(SPA fallback), so deep links like `/inventory` or `/orders/<id>`
work on a hard load.

## Database — Supabase (per restaurant)

Each licensed deployment gets **its own Supabase project** (its own
database). To provision a new restaurant:

1. Create a new Supabase project (region: Singapore for Bangladesh
   deployments, unless the customer needs otherwise).
2. Apply `supabase/migrations/0001_foundation.sql` through
   `supabase/migrations/0007_digital_ordering.sql`, in filename
   order — via the Supabase CLI (`supabase db push`) or the
   Dashboard SQL Editor (paste from the **fresh raw GitHub URL**
   every time, and verify the new tables' **columns** afterwards,
   not just their names — migration 0005 was once applied from a
   stale draft, fixed by 0006).
3. Point the restaurant's Vercel deployment at that project with the
   two env vars above.
4. Create the first user via Supabase Auth (Dashboard →
   Authentication → Add user, or the in-app sign-up page), then sign
   in and complete restaurant setup on the Settings page.

There is no automated provisioning yet — that is later-phase work.

## Connecting a restaurant domain (Phase 5)

Each restaurant gets its **own domain** (e.g. `addabuzz.com`).
Customers order directly on it — the root serves the public menu +
online ordering with no login — and the software is managed on the
same domain under `/panel` (e.g. `addabuzz.com/panel` → FoodX admin
login, locked to that restaurant). `foodx.bond` stays the platform's
main domain. Each restaurant owns its domain and points DNS at
Vercel; the Developer connects it in Vercel and maps it in the
system.

### Steps

1. **Buy the domain** (or use one the restaurant already owns) at
   any registrar.
2. **Set the DNS records** at the registrar (proxy OFF — Cloudflare
   proxy must be off, or Vercel cannot verify the domain):

   | Type | Name | Value |
   | --- | --- | --- |
   | A | `@` | `216.198.79.1` |
   | CNAME | `www` | `e933cba5c7a21370.vercel-dns-017.com` |

   These are the values Vercel shows for this project (the same
   values used for `foodx.bond`). DNS can take minutes to hours to
   propagate; check with `dig` or an online DNS checker before
   moving on.
3. **Add the domain in Vercel (manual, Developer).** Vercel project
   → Settings → Domains → add the domain (apex and `www`). Vercel
   provisions the TLS certificate automatically once DNS resolves.
   Until this step is done, the domain will not serve the app at
   all — the app's own domain mapping alone is not enough.
4. **Add the mapping in the app.** Sign in to the restaurant's admin
   → Settings → Domains → add the same domain. Mark it **primary**
   if it is the domain QR codes and NFC tags should point at (the
   first domain added is not automatically primary — set it
   explicitly). The platform hosts (`foodx.bond`,
   `www.foodx.bond`, `foodx-one.vercel.app`) are rejected here; a
   domain already connected to another restaurant is rejected too.
5. **Verify the storefront loads.** Open `https://<domain>/` — it
   should show the restaurant's menu, not the admin login. Open
   `https://<domain>/panel` — it should show the FoodX admin login.
   Scan a table QR code — it should open the table's menu on the
   restaurant's own domain.

### How routing works

The app decides what to serve from `window.location.hostname`
(see [ARCHITECTURE.md](ARCHITECTURE.md#12-domain-routing-phase-5)):

- Platform hosts (`foodx.bond`, `www.foodx.bond`, `*.vercel.app`,
  `localhost`) serve the public storefront of the **FoodX Demo
  restaurant** at `/` (the platform domain is the demo landing page),
  the admin app under `/panel`, and a Developer Panel placeholder at
  `/devpanel` (the real panel is Phase 8 work). `?store=<slug>` still
  previews any other restaurant's storefront (public data, for
  testing without a real domain).
- Any other hostname is resolved with
  `resolve_restaurant_by_domain()`. A match serves the storefront
  at `/` and the admin under `/panel` (locked to that restaurant);
  no match shows a "domain not connected" page, never the admin
  login.

### Troubleshooting

- **Domain shows the admin login instead of the menu:** the domain
  is not mapped in Settings → Domains, or the mapping points at a
  different restaurant. Check the row exists and the slug matches.
- **Domain shows a Vercel 404 / "domain not configured":** step 3
  was skipped — add the domain in Vercel and wait for DNS.
- **QR codes still point at `www.foodx.bond`:** no primary domain
  is set — set one in Settings → Domains. QR codes generated before
  a primary is set use the preview URL; re-print them after setting
  the primary.
- **Certificate warning:** Vercel provisions the certificate
  automatically once DNS resolves; if it stays pending, the DNS
  records (or the Cloudflare proxy) are wrong — re-check step 2.
