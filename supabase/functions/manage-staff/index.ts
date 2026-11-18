// FoodX manage-staff Edge Function (landing/onboarding step 3).
//
// Deployed in each CLIENT Supabase project. The restaurant panel's
// Staff page calls it with the admin's own session JWT; creating and
// managing logins needs the Auth Admin API, and the profiles /
// user_roles RLS policies are self-only, so none of this can happen
// from the browser (see STEP3_STAFF_MANAGEMENT_DESIGN.md).
//
// For every call the function:
//   1. verifies the caller's JWT and loads their profile,
//   2. requires an admin-level role (super_admin / restaurant_owner /
//      admin — the same set as public.is_restaurant_admin()),
//   3. scopes every action to the caller's restaurant: a target from
//      another restaurant reads as not found.
//
// Actions: list | create | set_role | set_active | reset_password.
// Guards: nobody can modify themselves here, and the restaurant's
// last active admin can never be demoted or deactivated, so the
// panel cannot lock its owner out. Deactivation also bans the Auth
// user — profiles.is_active alone would not block sign-in.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const ADMIN_ROLES = ['super_admin', 'restaurant_owner', 'admin']

// Panels run on arbitrary client domains; the caller's JWT is the
// actual auth.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function fail(code: string, status: number): Response {
  return json({ error: code }, status)
}

interface StaffRow {
  id: string
  email: string | null
  full_name: string | null
  phone: string | null
  branch_id: string | null
  is_active: boolean
  roles: { id: string; name: string; display_name: string | null }[]
  last_sign_in_at: string | null
}

// deno-lint-ignore no-explicit-any
type Admin = any

async function loadStaff(
  admin: Admin,
  restaurantId: string,
): Promise<StaffRow[]> {
  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, full_name, phone, branch_id, is_active')
    .eq('restaurant_id', restaurantId)
    .order('full_name', { ascending: true })
  if (error) throw error
  const ids = (profiles ?? []).map((p: { id: string }) => p.id)

  const rolesByUser = new Map<
    string,
    { id: string; name: string; display_name: string | null }[]
  >()
  if (ids.length > 0) {
    const { data: assignments } = await admin
      .from('user_roles')
      .select('user_id, roles (id, name, display_name)')
      .in('user_id', ids)
    for (const row of assignments ?? []) {
      const role = (row as { roles: unknown }).roles as {
        id: string
        name: string
        display_name: string | null
      } | null
      if (!role) continue
      const userId = (row as { user_id: string }).user_id
      const list = rolesByUser.get(userId) ?? []
      list.push(role)
      rolesByUser.set(userId, list)
    }
  }

  const authById = new Map<
    string,
    { email: string | null; last_sign_in_at: string | null }
  >()
  const { data: userList } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  })
  for (const u of userList?.users ?? []) {
    authById.set(u.id, {
      email: u.email ?? null,
      last_sign_in_at: u.last_sign_in_at ?? null,
    })
  }

  return (profiles ?? []).map(
    (p: {
      id: string
      full_name: string | null
      phone: string | null
      branch_id: string | null
      is_active: boolean
    }) => ({
      id: p.id,
      email: authById.get(p.id)?.email ?? null,
      full_name: p.full_name,
      phone: p.phone,
      branch_id: p.branch_id,
      is_active: p.is_active,
      roles: rolesByUser.get(p.id) ?? [],
      last_sign_in_at: authById.get(p.id)?.last_sign_in_at ?? null,
    }),
  )
}

async function countOtherActiveAdmins(
  admin: Admin,
  restaurantId: string,
  excludeUserId: string,
): Promise<number> {
  const { data: assignments } = await admin
    .from('user_roles')
    .select('user_id, roles!inner (name)')
    .in('roles.name', ADMIN_ROLES)
  const adminIds = new Set<string>()
  for (const row of assignments ?? []) {
    const userId = (row as { user_id: string }).user_id
    if (userId !== excludeUserId) adminIds.add(userId)
  }
  if (adminIds.size === 0) return 0
  const { data: profiles } = await admin
    .from('profiles')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .in('id', [...adminIds])
  return profiles?.length ?? 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') return fail('method_not_allowed', 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) return fail('unauthorized', 401)
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } =
    await userClient.auth.getUser()
  if (userError || !userData.user) return fail('unauthorized', 401)
  const callerId = userData.user.id

  const admin = createClient(url, serviceKey)

  const { data: callerProfile } = await admin
    .from('profiles')
    .select('id, restaurant_id')
    .eq('id', callerId)
    .maybeSingle()
  if (!callerProfile?.restaurant_id) return fail('not_admin', 403)
  const restaurantId = callerProfile.restaurant_id as string

  const { data: callerRoles } = await admin
    .from('user_roles')
    .select('roles (name)')
    .eq('user_id', callerId)
  const isAdmin = (callerRoles ?? []).some((row: { roles: unknown }) => {
    const role = (row as { roles: { name: string } | null }).roles
    return role !== null && ADMIN_ROLES.includes(role.name)
  })
  if (!isAdmin) return fail('not_admin', 403)

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return fail('invalid_json', 400)
  }
  const action = typeof body.action === 'string' ? body.action : ''

  try {
    if (action === 'list') {
      return json({ staff: await loadStaff(admin, restaurantId) })
    }

    if (action === 'create') {
      const email =
        typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const password =
        typeof body.password === 'string' ? body.password : ''
      const fullName =
        typeof body.full_name === 'string' ? body.full_name.trim() : ''
      const phone =
        typeof body.phone === 'string' && body.phone.trim()
          ? body.phone.trim()
          : null
      const roleId = typeof body.role_id === 'string' ? body.role_id : ''
      const branchId =
        typeof body.branch_id === 'string' && body.branch_id
          ? body.branch_id
          : null
      if (!email.includes('@') || password.length < 6 || !fullName || !roleId) {
        return fail('validation', 422)
      }
      const { data: role } = await admin
        .from('roles')
        .select('id, restaurant_id')
        .eq('id', roleId)
        .maybeSingle()
      if (!role || (role.restaurant_id && role.restaurant_id !== restaurantId)) {
        return fail('invalid_role', 422)
      }
      if (branchId) {
        const { data: branch } = await admin
          .from('branches')
          .select('id')
          .eq('id', branchId)
          .eq('restaurant_id', restaurantId)
          .maybeSingle()
        if (!branch) return fail('validation', 422)
      }
      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName },
        })
      if (createError || !created.user) {
        const message = createError?.message ?? ''
        if (/already|registered|exists/i.test(message)) {
          return fail('email_taken', 409)
        }
        return fail('server_error', 500)
      }
      const newId = created.user.id
      const { error: profileError } = await admin.from('profiles').insert({
        id: newId,
        restaurant_id: restaurantId,
        full_name: fullName,
        phone,
        branch_id: branchId,
        is_active: true,
      })
      if (profileError) {
        // Roll back the orphan login so the email can be retried.
        await admin.auth.admin.deleteUser(newId)
        return fail('server_error', 500)
      }
      const { error: roleError } = await admin.from('user_roles').insert({
        user_id: newId,
        role_id: roleId,
        branch_id: branchId,
      })
      if (roleError) return fail('server_error', 500)
      const staff = await loadStaff(admin, restaurantId)
      return json({ staff, created_id: newId })
    }

    // All remaining actions target an existing staff member.
    const targetId = typeof body.user_id === 'string' ? body.user_id : ''
    if (!targetId) return fail('validation', 422)
    const { data: target } = await admin
      .from('profiles')
      .select('id, restaurant_id, branch_id, is_active')
      .eq('id', targetId)
      .maybeSingle()
    if (!target || target.restaurant_id !== restaurantId) {
      return fail('wrong_restaurant', 404)
    }
    if (targetId === callerId) return fail('cannot_modify_self', 422)

    if (action === 'set_role') {
      const roleId = typeof body.role_id === 'string' ? body.role_id : ''
      const { data: role } = await admin
        .from('roles')
        .select('id, restaurant_id, name')
        .eq('id', roleId)
        .maybeSingle()
      if (!role || (role.restaurant_id && role.restaurant_id !== restaurantId)) {
        return fail('invalid_role', 422)
      }
      const targetIsAdmin = await admin
        .from('user_roles')
        .select('roles (name)')
        .eq('user_id', targetId)
      const wasAdmin = (targetIsAdmin.data ?? []).some(
        (row: { roles: unknown }) => {
          const r = (row as { roles: { name: string } | null }).roles
          return r !== null && ADMIN_ROLES.includes(r.name)
        },
      )
      if (
        wasAdmin &&
        !ADMIN_ROLES.includes(role.name as string) &&
        target.is_active &&
        (await countOtherActiveAdmins(admin, restaurantId, targetId)) === 0
      ) {
        return fail('last_admin', 422)
      }
      await admin.from('user_roles').delete().eq('user_id', targetId)
      const { error: insertError } = await admin.from('user_roles').insert({
        user_id: targetId,
        role_id: roleId,
        branch_id: target.branch_id,
      })
      if (insertError) return fail('server_error', 500)
      return json({ staff: await loadStaff(admin, restaurantId) })
    }

    if (action === 'set_active') {
      const isActive = body.is_active === true
      if (!isActive && target.is_active) {
        const { data: targetRoles } = await admin
          .from('user_roles')
          .select('roles (name)')
          .eq('user_id', targetId)
        const isTargetAdmin = (targetRoles ?? []).some(
          (row: { roles: unknown }) => {
            const r = (row as { roles: { name: string } | null }).roles
            return r !== null && ADMIN_ROLES.includes(r.name)
          },
        )
        if (
          isTargetAdmin &&
          (await countOtherActiveAdmins(admin, restaurantId, targetId)) === 0
        ) {
          return fail('last_admin', 422)
        }
      }
      const { error: updateError } = await admin
        .from('profiles')
        .update({ is_active: isActive })
        .eq('id', targetId)
      if (updateError) return fail('server_error', 500)
      const { error: banError } = await admin.auth.admin.updateUserById(
        targetId,
        { ban_duration: isActive ? 'none' : '876000h' },
      )
      if (banError) return fail('server_error', 500)
      return json({ staff: await loadStaff(admin, restaurantId) })
    }

    if (action === 'reset_password') {
      const password =
        typeof body.new_password === 'string' ? body.new_password : ''
      if (password.length < 6) return fail('validation', 422)
      const { error: pwError } = await admin.auth.admin.updateUserById(
        targetId,
        { password },
      )
      if (pwError) return fail('server_error', 500)
      return json({ ok: true })
    }

    return fail('unknown_action', 400)
  } catch {
    return fail('server_error', 500)
  }
})
