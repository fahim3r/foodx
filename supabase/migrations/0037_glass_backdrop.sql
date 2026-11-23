-- 0037_glass_backdrop.sql
-- White Glass v4: a restaurant can replace the White Glass theme's
-- built-in backdrop photograph from Settings → Appearance (the
-- controls reveal only while White Glass is the selected theme).
-- The choice is restaurant data like the other branding fields
-- (logo_url, primary_color), so it lives on restaurant_settings;
-- NULL means "use the built-in photo".
--
-- The GlassBackdrop layer (src/components/GlassBackdrop.tsx)
-- applies the same drained-toward-white filter to any image, so a
-- custom photo stays in the theme's white / neutral family.
-- Uploads go to the existing product-images bucket under
-- <restaurant_id>/backdrop/; a pasted link is stored as-is. The
-- settings row is written through the existing
-- updateSettingsPartial path, and fetchSettings selects *, so no
-- other schema or policy change is needed — restaurant_settings
-- already has its RLS policies from 0002.
--
-- Idempotent: safe to re-run.

alter table public.restaurant_settings
  add column if not exists glass_backdrop_url text;
