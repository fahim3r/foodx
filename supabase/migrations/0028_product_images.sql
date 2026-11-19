-- 0028: Product image uploads (modifications v2, item 5).
-- Creates the public `product-images` Storage bucket and its
-- object policies. The bucket row insert is idempotent; on a
-- host whose storage schema differs, create the bucket manually
-- in the Dashboard (Storage -> New bucket -> "product-images",
-- public) and re-run only the policy block.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

-- Anyone may READ product images (storefront/kiosk are public).
drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read" on storage.objects
  for select
  using (bucket_id = 'product-images');

-- Signed-in staff may upload/replace/delete ONLY inside their
-- own restaurant's folder: <restaurant_id>/...
drop policy if exists "product_images_insert_own" on storage.objects;
create policy "product_images_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.current_restaurant_id()::text
  );

drop policy if exists "product_images_update_own" on storage.objects;
create policy "product_images_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.current_restaurant_id()::text
  )
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.current_restaurant_id()::text
  );

drop policy if exists "product_images_delete_own" on storage.objects;
create policy "product_images_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = public.current_restaurant_id()::text
  );
