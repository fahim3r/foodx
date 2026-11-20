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

/**
 * Verify a PIN without performing an action (migration 0034). The
 * guarded cancel/refund RPCs check the PIN inside the action; the
 * Easy Mode switch in Settings has no guarded RPC, so it verifies
 * through this function first, then writes the setting. Returns
 * false when no PIN is set or the PIN does not match.
 */
export async function verifyManagerPin(pin: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_manager_pin', {
    p_pin: pin,
  })
  if (error) throw error
  return data === true
}

/** Map a guarded-RPC failure to a stable error code the UI keys on.
 * PostgREST errors are plain objects (not Error instances), so the
 * message is read off the object as well as off real Errors. */
export function guardedErrorCode(error: unknown): string {
  const raw = (
    error as { message?: unknown } | null | undefined
  )?.message
  const message =
    typeof raw === 'string'
      ? raw
      : error instanceof Error
        ? error.message
        : String(error)
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
