// FoodX report-backup Edge Function (Phase 8 R3).
//
// Deployed on the REGISTRY Supabase project. The vendor's backup
// script (scripts/backup-client.sh) POSTs one report per backup run:
// { instance_id, token, status: 'success' | 'failed', size_bytes?,
// note? } with the registry project's anon key in the apikey /
// Authorization headers. Authentication is the per-instance token,
// checked exactly like instance-heartbeat (SHA-256 hash, constant-
// time compare). On a valid report the function appends a
// dev_backup_reports history row and stamps the client's
// last_backup_at / last_backup_status (service role — RLS bypassed,
// which is why the token check must be exact).
//
// The report is the ONLY way backup state reaches the registry: no
// panel button can run a backup from a browser, and none pretends
// to (§59, §82). Unknown instance, missing token and wrong token
// all get the same generic 401.

import { createClient } from 'jsr:@supabase/supabase-js@2'

// The script runs on vendor machines, so the endpoint is open to
// every origin — the per-instance token is the actual auth.
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

interface ReportBody {
  instance_id?: unknown
  token?: unknown
  status?: unknown
  size_bytes?: unknown
  note?: unknown
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: ReportBody
  try {
    body = (await req.json()) as ReportBody
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const instanceId = typeof body.instance_id === 'string' ? body.instance_id : ''
  const token = typeof body.token === 'string' ? body.token : ''
  if (!instanceId || !token) {
    return json({ error: 'missing_fields' }, 400)
  }
  if (body.status !== 'success' && body.status !== 'failed') {
    return json({ error: 'invalid_status' }, 400)
  }
  const status = body.status
  const sizeBytes =
    typeof body.size_bytes === 'number' &&
    Number.isInteger(body.size_bytes) &&
    body.size_bytes >= 0
      ? body.size_bytes
      : null
  const note =
    typeof body.note === 'string' && body.note.length > 0
      ? body.note.slice(0, 500)
      : null

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: client, error: clientError } = await admin
    .from('dev_clients')
    .select('id, instance_token_hash')
    .eq('client_code', instanceId)
    .maybeSingle()
  if (clientError) return json({ error: 'registry_error' }, 500)
  if (!client || !client.instance_token_hash) {
    return json({ error: 'unauthorized' }, 401)
  }
  const tokenHash = await sha256Hex(token)
  if (!timingSafeEqual(tokenHash, client.instance_token_hash)) {
    return json({ error: 'unauthorized' }, 401)
  }

  const now = new Date()
  const { error: insertError } = await admin.from('dev_backup_reports').insert({
    client_id: client.id,
    status,
    size_bytes: sizeBytes,
    note,
  })
  if (insertError) return json({ error: 'registry_error' }, 500)
  await admin
    .from('dev_clients')
    .update({ last_backup_at: now.toISOString(), last_backup_status: status })
    .eq('id', client.id)

  return json({ ok: true, server_time: now.toISOString() })
})
