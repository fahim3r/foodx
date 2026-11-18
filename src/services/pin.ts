import { supabase } from '@/lib/supabase'

/**
 * Manager PIN (roadmap gap 6, migration 0024). The PIN itself is
 * never stored or read by the client — only the three SECURITY
 * DEFINER functions are called. Whether a PIN is set is a boolean;
 * setting/removing is enforced admin-only inside the database.
 */
export async function fetchManagerPinIsSet(): Promise<boolean> {
  const { data, error } = await supabase.rpc('manager_pin_is_set')
  if (error) throw error
  return data === true
}

export async function setManagerPin(pin: string): Promise<void> {
  const { error } = await supabase.rpc('set_manager_pin', { p_pin: pin })
  if (error) throw error
}

export async function removeManagerPin(): Promise<void> {
  const { error } = await supabase.rpc('remove_manager_pin')
  if (error) throw error
}

/** Map a guarded-RPC failure to a stable error code the UI keys on. */
export function guardedErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('pin_incorrect')) return 'pin_incorrect'
  if (message.includes('pin_required')) return 'pin_required'
  if (message.includes('pin_invalid')) return 'pin_invalid'
  if (message.includes('not_admin')) return 'not_admin'
  if (message.includes('invalid_status_transition')) {
    return 'invalid_status_transition'
  }
  if (message.includes('cancel_reason_required')) {
    return 'cancel_reason_required'
  }
  if (message.includes('refund_reason_required')) {
    return 'refund_reason_required'
  }
  return 'guarded_action_failed'
}
