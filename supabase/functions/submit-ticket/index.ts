// FoodX submit-ticket Edge Function (Help section H1).
//
// Deployed on the REGISTRY Supabase project. A client deployment's
// Help section POSTs { instance_token, title, category, message,
// sender_name?, sender_email? } with the registry project's anon key
// in the apikey / Authorization headers — the gateway rejects a raw
// instance token as a Bearer value before the function runs (the R4
// lesson), so the instance token travels in the BODY and is the
// actual auth: it is SHA-256 hashed and resolved against
// dev_clients.instance_token_hash exactly like instance-heartbeat.
// The resolved client_id is stamped on the ticket server-side; the
// client never sends its own client_id, so one client cannot file
// a ticket as another.
//
// Form validation errors are plain-language strings: the client UI
// shows them to the sender as-is. Spam guard: at most 10 tickets
// per client per rolling hour — beyond that, 429 and nothing is
// stored. Unknown token: the same generic 401 as the sibling
// functions, nothing stored.

import { createClient } from 'jsr:@supabase/supabase-js@2'

// Instances run on arbitrary client domains, so the endpoint is open
// to every origin — the per-instance token is the actual auth.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TICKET_CATEGORIES = [
  'order_payment',
  'printer_hardware',
  'menu_settings',
  'other',
] as const

const MAX_TICKETS_PER_HOUR = 10
const HOUR_MS = 60 * 60 * 1000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** An optional sender field: a non-empty trimmed string, capped,
 * else null (the sender is whoever was signed in — never required). */
function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v === '' ? null : v.slice(0, max)
}

interface TicketBody {
  instance_token?: unknown
  title?: unknown
  category?: unknown
  message?: unknown
  sender_name?: unknown
  sender_email?: unknown
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: TicketBody
  try {
    body = (await req.json()) as TicketBody
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const instanceToken =
    typeof body.instance_token === 'string' ? body.instance_token : ''
  if (!instanceToken) return json({ error: 'missing_fields' }, 400)

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title === '') {
    return json(
      { error: 'Please write a short title for the problem.' },
      400,
    )
  }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (message === '') {
    return json({ error: 'Please write what happened.' }, 400)
  }
  if (
    typeof body.category !== 'string' ||
    !(TICKET_CATEGORIES as readonly string[]).includes(body.category)
  ) {
    return json({ error: 'invalid_category' }, 400)
  }
  const category = body.category
  const senderName = optionalText(body.sender_name, 200)
  const senderEmail = optionalText(body.sender_email, 320)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  // Resolve the client by the token's hash, exactly like heartbeat:
  // the hash is the lookup key, and a constant-time compare guards
  // the match before anything is written.
  const tokenHash = await sha256Hex(instanceToken)
  const { data: client, error: clientError } = await admin
    .from('dev_clients')
    .select('id, instance_token_hash')
    .eq('instance_token_hash', tokenHash)
    .maybeSingle()
  if (clientError) return json({ error: 'registry_error' }, 500)
  if (
    !client ||
    !client.instance_token_hash ||
    !timingSafeEqual(tokenHash, client.instance_token_hash)
  ) {
    return json({ error: 'unauthorized' }, 401)
  }

  // Spam guard: at most MAX_TICKETS_PER_HOUR tickets per client in
  // the last hour, so a stuck retry loop cannot flood the DevPanel.
  const hourAgo = new Date(Date.now() - HOUR_MS).toISOString()
  const { count, error: countError } = await admin
    .from('dev_support_tickets')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)
    .gte('created_at', hourAgo)
  if (countError) return json({ error: 'registry_error' }, 500)
  if ((count ?? 0) >= MAX_TICKETS_PER_HOUR) {
    return json({ error: 'too_many_tickets' }, 429)
  }

  const { data: ticket, error: insertError } = await admin
    .from('dev_support_tickets')
    .insert({
      client_id: client.id,
      title: title.slice(0, 200),
      category,
      message: message.slice(0, 5000),
      sender_name: senderName,
      sender_email: senderEmail,
    })
    .select('id')
    .single()
  if (insertError) return json({ error: 'registry_error' }, 500)

  return json({ ok: true, ticket_id: ticket.id })
})
