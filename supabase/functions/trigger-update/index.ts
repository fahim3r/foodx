// FoodX trigger-update Edge Function (Phase 8 R4).
//
// Deployed on the REGISTRY Supabase project. The Developer Panel's
// "Deploy update" button calls this with the developer's registry
// session JWT: Authorization: Bearer <access token>, apikey:
// <registry anon key>, body { client_id }. The function verifies
// the JWT, confirms the caller is on the dev_developers allow-list
// (the same gate as every registry policy), then POSTs the client's
// Vercel Deploy Hook server-side.
//
// Unlike request-update (the client's own button), the vendor path
// does NOT enforce the 7-day backup gate: the vendor runs the
// backups and owns the §56 order — but the response reports the
// client's last backup state so the panel can warn before firing.
// The hook URL never leaves the registry.

import { createClient } from 'jsr:@supabase/supabase-js@2'

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

interface TriggerBody {
  client_id?: unknown
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const authHeader = req.headers.get('Authorization') ?? ''

  // Who is calling? The caller's own JWT, verified by Auth.
  const caller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const {
    data: { user },
    error: userError,
  } = await caller.auth.getUser()
  if (userError || !user) return json({ error: 'unauthenticated' }, 401)

  const admin = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )
  const { data: developer, error: devError } = await admin
    .from('dev_developers')
    .select('profile_id')
    .eq('profile_id', user.id)
    .maybeSingle()
  if (devError) return json({ error: 'registry_error' }, 500)
  if (!developer) return json({ error: 'not_developer' }, 403)

  let body: TriggerBody
  try {
    body = (await req.json()) as TriggerBody
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const clientId = typeof body.client_id === 'string' ? body.client_id : ''
  if (!clientId) return json({ error: 'missing_fields' }, 400)

  const { data: client, error: clientError } = await admin
    .from('dev_clients')
    .select('id, deploy_hook_url, last_backup_at, last_backup_status')
    .eq('id', clientId)
    .maybeSingle()
  if (clientError) return json({ error: 'registry_error' }, 500)
  if (!client) return json({ error: 'client_not_found' }, 404)
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
  return json({
    ok: true,
    update_triggered: true,
    last_backup_at: client.last_backup_at,
    last_backup_status: client.last_backup_status,
  })
})
