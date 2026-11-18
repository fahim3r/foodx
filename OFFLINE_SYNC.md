# FoodX — Offline sync (Phase 9 v1)

Master prompt §5 requires core POS work to continue during a
temporary internet outage and to reconcile on reconnect without
duplicates. v1 implements the device-level slice of that: the
offline order queue. The §4 local LAN server is NOT part of v1 —
deployments stay cloud-hosted; see "Limits" below.

## How it works

1. **Queueing.** When the POS has no connectivity (or a placement
   fails with a network error), the order is captured into
   `localStorage` under `foodx.offline_queue.<restaurantId>`
   (`src/services/offlineQueue.ts`). Each entry carries what §5
   asks of a synchronized transaction:
   - **Unique ID** — the order UUID, generated at queue time. It
     is also the idempotency key for the whole entry.
   - **Device ID** — a UUID generated once per browser/device
     (`foodx.device_id`).
   - **Timestamp** — when the order was queued.
   - **Source** — `pos_offline`.
   - **Sync status** — `queued` or `failed` (with a reason).
   The entry stores the placement input (ids + quantities), the
   priced snapshot from the catalog loaded on the device (names
   and prices as charged, §69), the computed totals, the tax /
   service-charge rates in force, and any payments taken at the
   counter (each with its own UUID idempotency key).
2. **At the counter.** The cashier sees a queued-order card with a
   local reference (`OFF-XXXXXXXX`) — never a fake order number;
   the real sequential number is assigned at sync. Payments can
   be recorded against the entry and the receipt prints from the
   snapshot (the receipt shows the local reference).
3. **Sync.** A runner (`src/hooks/useOfflineSync`, mounted in
   AppLayout) replays the queue on panel mount, on the browser's
   `online` event, when the queue changes, and every 60 seconds
   while entries wait. Each entry goes through
   `pos.syncQueuedOrder`:
   - every product / variant / modifier in the snapshot must
     still exist for the restaurant;
   - the totals are recomputed from the snapshot lines with the
     captured rates and must match the queued totals exactly;
   - the queued payments must be positive and within the total.
   The order is then written by the same `persistPricedOrder`
   the live path uses — order number from the usual MAX+1 retry,
   stock deduction via the idempotent RPC — and the payments are
   upserted under their queued ids. Because every write upserts
   on the entry's UUIDs, a retried or interrupted sync can never
   create a duplicate order or payment.
   The placement history row records the offline origin:
   "Offline order - placed <time> on device <id>; synced <time>".
4. **Failures.** A validation failure marks the entry `failed`
   with a reason; it stays in the POS queue panel (POS header →
   queue chip) until a manager resolves it — re-check the menu,
   then remove the entry or re-enter the order. Nothing is ever
   silently dropped. Network or auth failures simply stop the
   run and retry later; the queue is never cleared on sign-out,
   so an expired session during a long outage loses nothing.

## The pricing decision (D1)

§68 says the server must never trust client-submitted prices;
§69 says orders keep price snapshots. Offline, the customer has
already paid the snapshot price when sync runs — re-pricing
would falsify the sale and the cash record. v1 therefore honours
the charged snapshot, guarded by the recompute-and-compare check
above: the snapshot must be internally consistent (lines ×
quantities × captured rates = queued totals), every referenced
menu row must still exist, and the snapshot originates from the
restaurant's own loaded catalog on an authenticated device. A
tampered queue entry fails validation instead of posting.

## The app shell

The PWA precaches the built app shell (vite.config.ts), so the
panel opens offline and the queue survives reloads. Menu and
other data are still fetched live: a POS opened cold while
offline shows the shell but cannot start an order until it has
loaded its catalog once. Caching the catalog for a fully
offline cold start is v2.

## Limits (honest list)

- Only POS order placement + payments + receipt printing work
  offline. KDS/realtime, status changes on synced orders, table
  management beyond the synced order's occupied flag, inventory
  adjustments, shift open/close and expenses need connectivity.
- Customer attach, coupon redemption and loyalty redemption are
  disabled while offline (they need live validation); manual
  discounts work. An order carrying those extras is not queued —
  the cashier is told to remove them first.
- The queue lives in one browser's localStorage. Clearing site
  data deletes unsynced orders — do not clear it during an
  outage. Two POS tabs on one device share the queue file;
  per-placement UUIDs prevent double-posting.
- No local LAN server and no multi-device sync (§4) yet: two
  counters offline at once each hold their own queue and sync
  independently when back online; order numbers are assigned in
  sync order.
