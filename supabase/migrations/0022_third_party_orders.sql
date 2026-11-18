-- Migration 0022 — third-party (aggregator) order entry (roadmap gap 1).
--
-- A counter worker re-keys an order that arrived on an aggregator
-- platform (Foodpanda etc.) into the POS. The order records WHERE it
-- came from: orders.source gains 'THIRD_PARTY', the platform name and
-- the platform's own order id are kept on the order, and the guest
-- contact reuses the existing customer_name / customer_phone columns.
-- Aggregator orders are counter pickups by the platform's rider: the
-- POS stores them as takeaway, and no delivery_orders dispatch row is
-- ever created for them (the delivery board only lists orders whose
-- type is 'delivery', and it must stay that way).

alter table public.orders
  add column if not exists external_order_id text;

alter table public.orders
  add column if not exists third_party_company text;

alter table public.orders
  drop constraint if exists orders_source_check;

alter table public.orders
  add constraint orders_source_check
  check (source in ('POS', 'QR', 'ONLINE', 'THIRD_PARTY'));
