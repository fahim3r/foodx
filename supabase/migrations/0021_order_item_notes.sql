-- FoodX migration 0021 — Roadmap Wave 1 (gap 5): per-item kitchen notes.
--
-- order_items.note: a free-text note attached to ONE order line
-- ("less spicy", "no onion"), captured in the POS cart, shown on
-- the KDS, printed on the kitchen ticket and the customer
-- receipt, and carried through the Phase 9 offline queue inside
-- the snapshotted order input. Nullable: orders placed before
-- this migration (and storefront orders, whose RPC does not set
-- it) simply have no note. No constraint on length — the POS
-- caps input at 200 chars.
--
-- Idempotent: safe to re-run.

alter table public.order_items add column if not exists note text;
