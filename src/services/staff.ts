// FoodX — staff management service (landing/onboarding step 3).
//
// Thin wrapper over the manage-staff Edge Function: creating logins
// and editing other people's profiles/roles cannot happen from the
// browser (service-role + self-only RLS — see the design doc), so
// every call carries the signed-in admin's session token and the
// function enforces admin + same-restaurant scoping server-side.
// Errors arrive as coarse codes the page maps to i18n messages.

import { supabase } from '@/lib/supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined

export interface StaffRole {
  id: string
  name: string
  display_name: string | null
}

export interface StaffMember {
  id: string
  email: string | null
  full_name: string | null
  phone: string | null
  branch_id: string | null
  is_active: boolean
  modules: string[] | null
  roles: StaffRole[]
  last_sign_in_at: string | null
}

export type StaffErrorCode =
  | 'unauthorized'
  | 'not_admin'
  | 'email_taken'
  | 'invalid_role'
  | 'validation'
  | 'wrong_restaurant'
  | 'cannot_modify_self'
  | 'last_admin'
  | 'server_error'

export class StaffError extends Error {
  code: StaffErrorCode

  constructor(code: StaffErrorCode) {
    super(code)
    this.name = 'StaffError'
    this.code = code
  }
}

interface ManageStaffResponse {
  staff?: StaffMember[]
  created_id?: string
  ok?: boolean
  error?: string
}

async function callManageStaff(
  body: Record<string, unknown>,
): Promise<ManageStaffResponse> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new StaffError('unauthorized')
  }
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/manage-staff`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new StaffError('server_error')
  }
  const payload = (await res
    .json()
    .catch(() => null)) as ManageStaffResponse | null
  if (!res.ok) {
    throw new StaffError((payload?.error as StaffErrorCode) ?? 'server_error')
  }
  return payload ?? {}
}

export async function fetchStaff(): Promise<StaffMember[]> {
  const data = await callManageStaff({ action: 'list' })
  return data.staff ?? []
}

export interface CreateStaffInput {
  email: string
  password: string
  full_name: string
  phone?: string
  role_id: string
  branch_id?: string | null
  modules?: string[] | null
}

export async function createStaff(
  input: CreateStaffInput,
): Promise<StaffMember[]> {
  const data = await callManageStaff({ action: 'create', ...input })
  return data.staff ?? []
}

export async function setStaffRole(
  userId: string,
  roleId: string,
): Promise<StaffMember[]> {
  const data = await callManageStaff({
    action: 'set_role',
    user_id: userId,
    role_id: roleId,
  })
  return data.staff ?? []
}

export async function setStaffActive(
  userId: string,
  isActive: boolean,
): Promise<StaffMember[]> {
  const data = await callManageStaff({
    action: 'set_active',
    user_id: userId,
    is_active: isActive,
  })
  return data.staff ?? []
}

export async function setStaffModules(
  userId: string,
  modules: string[] | null,
): Promise<StaffMember[]> {
  const data = await callManageStaff({
    action: 'set_modules',
    user_id: userId,
    modules,
  })
  return data.staff ?? []
}

export async function resetStaffPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  await callManageStaff({
    action: 'reset_password',
    user_id: userId,
    new_password: newPassword,
  })
}
