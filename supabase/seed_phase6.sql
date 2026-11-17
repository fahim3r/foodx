-- ============================================================================
-- FoodX — Phase 6 demo seed (DEV ONLY — NEVER run against production)
-- Two drivers and two zones for the FoodX Demo Restaurant, so the
-- delivery board has someone to assign and somewhere to deliver to.
-- Fixed UUIDs + ON CONFLICT DO NOTHING: safe to run more than once.
-- ============================================================================

insert into public.delivery_drivers (id, restaurant_id, name, phone, vehicle_type, vehicle_number, status)
values
  ('66666666-6666-6666-6666-666666666601', '11111111-1111-1111-1111-111111111111', 'Rahim Uddin', '01711000001', 'Motorcycle', 'DHAKA-METRO-LA-11-2233', 'AVAILABLE'),
  ('66666666-6666-6666-6666-666666666602', '11111111-1111-1111-1111-111111111111', 'Karim Ahmed', '01711000002', 'Bicycle', null, 'OFFLINE')
on conflict (id) do nothing;

insert into public.delivery_zones (id, restaurant_id, name, fee, min_order_amount, estimated_minutes)
values
  ('66666666-6666-6666-6666-666666666701', '11111111-1111-1111-1111-111111111111', 'Dhanmondi', 60, 0, 30),
  ('66666666-6666-6666-6666-666666666702', '11111111-1111-1111-1111-111111111111', 'Mirpur', 80, 200, 45)
on conflict (restaurant_id, name) do nothing;
