// FoodX — Help section support tickets (Help wave H2).
//
// submitTicket POSTs to the registry's submit-ticket Edge Function
// (Help wave H1). The auth follows the proven R3/R4 pattern: the
// registry anon key travels in the request headers as the caller
// credential, and the instance token travels in the request BODY —
// a raw instance token sent as the header credential is rejected
// by the gateway before the function ever runs. The function
// hashes the token, resolves the client server-side and stamps
// the ticket with that client, so one client can never file a
// ticket as another.
//
// Configuration comes from the heartbeat's own resolution
// (instance_config cache, then env provisioning, then inert) via
// registryCallConfig — there is deliberately no second config
// path. An unconfigured deployment gets a plain 'unconfigured'
// result and the UI falls back to the WhatsApp / email buttons.

import { registryCallConfig } from '@/services/heartbeat'

export type TicketCategory =
  | 'order_payment'
  | 'printer_hardware'
  | 'menu_settings'
  | 'other'

export const TICKET_CATEGORIES: readonly TicketCategory[] = [
  'order_payment',
  'printer_hardware',
  'menu_settings',
  'other',
]

export interface SubmitTicketInput {
  title: string
  category: TicketCategory
  message: string
  senderName: string | null
  senderEmail: string | null
}

export type SubmitTicketResult =
  | { ok: true; ticketId: string }
  | {
      ok: false
      /** Machine code the UI maps to a plain-language i18n string. */
      code: 'unconfigured' | 'unauthorized' | 'too_many_tickets' | 'failed'
      /** Plain-language message from the function, shown as-is
       * when it returned one instead of a machine code. */
      message?: string
    }

// Error values that are machine codes rather than sentences. Any
// other string the function returns in its error field is a
// plain-language message for the sender (its title / message
// validation works that way by design) and passes through as-is.
const MACHINE_ERROR_CODES: ReadonlySet<string> = new Set([
  'missing_fields',
  'invalid_category',
  'registry_error',
  'invalid_json',
  'method_not_allowed',
])

export async function submitTicket(
  input: SubmitTicketInput,
): Promise<SubmitTicketResult> {
  const config = registryCallConfig()
  if (!config) return { ok: false, code: 'unconfigured' }
  try {
    const res = await fetch(
      `${config.registryUrl}/functions/v1/submit-ticket`,
      {
        method: 'POST',
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instance_token: config.token,
          title: input.title,
          category: input.category,
          message: input.message,
          sender_name: input.senderName,
          sender_email: input.senderEmail,
        }),
      },
    )
    const data = (await res.json().catch(() => null)) as {
      ok?: unknown
      ticket_id?: unknown
      error?: unknown
    } | null
    if (res.ok && data?.ok === true && typeof data.ticket_id === 'string') {
      return { ok: true, ticketId: data.ticket_id }
    }
    const serverError = typeof data?.error === 'string' ? data.error : null
    if (serverError === 'too_many_tickets') {
      return { ok: false, code: 'too_many_tickets' }
    }
    if (serverError === 'unauthorized') {
      return { ok: false, code: 'unauthorized' }
    }
    if (serverError && !MACHINE_ERROR_CODES.has(serverError)) {
      return { ok: false, code: 'failed', message: serverError }
    }
    return { ok: false, code: 'failed' }
  } catch {
    return { ok: false, code: 'failed' }
  }
}
