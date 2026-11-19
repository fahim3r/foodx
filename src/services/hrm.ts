import { supabase } from '@/lib/supabase'
import type { AttendanceRecord, AttendanceStatus, Employee } from '@/types'

/**
 * HRM v1 (modifications v2, item 10): employee directory +
 * attendance. The tables are admin-only at the RLS level
 * (migration 0030) — salary privacy is enforced by the
 * database, not just by hiding this tab.
 */

export interface EmployeeInput {
  profile_id: string | null
  full_name: string
  phone: string | null
  designation: string | null
  monthly_salary: number | null
  join_date: string | null
  notes: string | null
}

export async function fetchEmployees(restaurantId: string): Promise<Employee[]> {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('full_name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Employee[]
}

export async function createEmployee(
  restaurantId: string,
  input: EmployeeInput,
): Promise<Employee> {
  const { data, error } = await supabase
    .from('employees')
    .insert({ id: crypto.randomUUID(), restaurant_id: restaurantId, ...input })
    .select()
    .single()
  if (error) throw error
  return data as Employee
}

export async function updateEmployee(
  employeeId: string,
  patch: Partial<EmployeeInput> & { status?: Employee['status'] },
): Promise<void> {
  const { error } = await supabase
    .from('employees')
    .update(patch)
    .eq('id', employeeId)
  if (error) throw error
}

export async function fetchAttendance(
  restaurantId: string,
  fromDay: string,
  toDay: string,
): Promise<AttendanceRecord[]> {
  const { data, error } = await supabase
    .from('attendance')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .gte('day', fromDay)
    .lte('day', toDay)
    .order('day', { ascending: true })
  if (error) throw error
  return (data ?? []) as AttendanceRecord[]
}

export async function markAttendance(
  restaurantId: string,
  employeeId: string,
  day: string,
  status: AttendanceStatus,
  userId: string,
): Promise<void> {
  const { error } = await supabase.from('attendance').upsert(
    {
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      employee_id: employeeId,
      day,
      status,
      marked_by: userId,
    },
    { onConflict: 'employee_id,day' },
  )
  if (error) throw error
}

export interface LinkableProfile {
  id: string
  full_name: string
}

export async function fetchLinkableProfiles(
  restaurantId: string,
): Promise<LinkableProfile[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('restaurant_id', restaurantId)
    .order('full_name', { ascending: true })
  if (error) throw error
  return (data ?? []) as LinkableProfile[]
}
