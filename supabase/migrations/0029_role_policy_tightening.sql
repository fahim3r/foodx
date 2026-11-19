-- 0029: Roles/permissions editor (modifications v2, item 4).
-- Tighten the 0001 write policies on roles / role_permissions:
-- creating, renaming, deleting roles and editing the matrix
-- becomes ADMIN-ONLY at the database level too (previously any
-- signed-in staff member of the restaurant could write these
-- tables through the API; no UI existed, but the new editor
-- makes the tables meaningful, so the hole closes first).
-- Reads are unchanged.

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert to authenticated
  with check (
    restaurant_id = public.current_restaurant_id()
    and public.is_restaurant_admin()
  );

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and public.is_restaurant_admin()
  )
  with check (
    restaurant_id = public.current_restaurant_id()
    and public.is_restaurant_admin()
  );

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
  for delete to authenticated
  using (
    restaurant_id = public.current_restaurant_id()
    and public.is_restaurant_admin()
  );

drop policy if exists role_permissions_insert on public.role_permissions;
create policy role_permissions_insert on public.role_permissions
  for insert to authenticated
  with check (
    public.is_restaurant_admin()
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.restaurant_id = public.current_restaurant_id()
    )
  );

drop policy if exists role_permissions_delete on public.role_permissions;
create policy role_permissions_delete on public.role_permissions
  for delete to authenticated
  using (
    public.is_restaurant_admin()
    and exists (
      select 1 from public.roles r
      where r.id = role_permissions.role_id
        and r.restaurant_id = public.current_restaurant_id()
    )
  );
