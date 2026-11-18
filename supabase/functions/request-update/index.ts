// FoodX request-update Edge Function (Phase 8 R4).
//
// Deployed on the REGISTRY Supabase project. A client deployment's
// panel calls this from its "Update Now" button:
// { instance_id, token } with the registry anon key in the apikey /
// Authorization headers. Authentication is the per-instance token,
// checked exactly like instance-heartbeat / report-backup.
//
// §56 order is enforced BEFORE anything is triggered: the client's
// last reported backup must exist, be a success, and be no older
// than 7 days — otherwise 409 backup_required and nothing deploys.
// With the gate passed, the function POSTs the client's Vercel
// Deploy Hook server-side; the hook URL lives only in the registry
// and is never sent to the client browser. The deploy itself is
// just a redeploy of the client's production branch (release/stable
// for real clients); the next heartbeat reporting the new version
// is the health check that confirms the update (§56/§58).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BACKUP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

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

interface RequestBody {
  instance_id?: unknown
  token?: unknown
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const instanceId = typeof body.instance_id === 'string' ? body.instance_id : ''
  const token = typeof body.token === 'string' ? body.token : ''
  if (!instanceId || !token) return json({ error: 'missing_fields' }, 400)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: client, error: clientError } = await admin
    .from('dev_clients')
    .select(
      'id, status, instance_token_hash, deploy_hook_url, last_backup_at, last_backup_status',
    )
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
  if (client.status !== 'ACTIVE') {
    return json({ error: 'client_not_active' }, 403)
  }
  // §56: Backup → … → Update. No recent verified backup, no update.
  const backupFresh =
    client.last_backup_status === 'success' &&
    client.last_backup_at &&
    Date.now() - new Date(client.last_backup_at).getTime() <= BACKUP_MAX_AGE_MS
  if (!backupFresh) return json({ error: 'backup_required' }, 409)
  if (!client.deploy_hook_url) return json({ error: 'no_deploy_hook' }, 409)

  let hookRes: Response
  try {
    hookRes = await fetch(client.deploy_hook_url, { method: 'POST' })
  } catch {
    return json({ error: 'hook_failed' }, 502)
  }
  if (!hookRes.ok) {
    return json({ error: 'hook_failed', hook_status: hookRes.status }, 502)
  }
  return json({ ok: true, update_triggered: true })
})
