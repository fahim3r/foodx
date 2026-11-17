// FoodX instance-heartbeat Edge Function (Phase 8 step 2).
//
// Deployed on the REGISTRY Supabase project. A client installation POSTs
// { instance_id, token, version, domain? } with the registry project's
// anon key in the apikey/Authorization headers. The function:
//   1. finds the client by client_code and compares SHA-256(token) with
//      dev_clients.instance_token_hash (constant-time compare),
//   2. appends a dev_heartbeats row and stamps last_seen_at + the
//      reported version on the client (service role — RLS bypassed,
//      which is why the token check above must be exact),
//   3. answers with everything the instance caches locally: effective
//      license status (computed expiry, same rule as the Developer
//      Panel), the client's feature flags, and the newest published
//      release targeted at it.
//
// Suspension is data, not a transport error: a suspended client still
// gets HTTP 200 with its license state in the body. Unknown instance,
// missing token and wrong token all get the same generic 401.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const FEATURE_KEYS = [
  'online_ordering',
  'delivery',
  'loyalty',
  'accounting',
  'nfc',
  'multi_branch',
] as const

// Instances run on arbitrary client domains, so the endpoint is open
// to every origin — the per-instance token is the actual auth.
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

// Minimal semver compare (x.y.z, missing parts = 0). Mirrors
// compareVersions in src/services/devpanel.ts — kept in sync manually;
// both are covered by the Phase 8 step 2 acceptance test.
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

interface HeartbeatBody {
  instance_id?: unknown
  token?: unknown
  version?: unknown
  domain?: unknown
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: HeartbeatBody
  try {
    body = (await req.json()) as HeartbeatBody
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const instanceId = typeof body.instance_id === 'string' ? body.instance_id : ''
  const token = typeof body.token === 'string' ? body.token : ''
  const version = typeof body.version === 'string' ? body.version : ''
  const domain = typeof body.domain === 'string' ? body.domain : null
  if (!instanceId || !token || !version) {
    return json({ error: 'missing_fields' }, 400)
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: client, error: clientError } = await admin
    .from('dev_clients')
    .select('id, status, instance_token_hash')
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
  const { error: insertError } = await admin.from('dev_heartbeats').insert({
    client_id: client.id,
    version,
    domain,
    user_agent: req.headers.get('user-agent'),
  })
  if (insertError) return json({ error: 'registry_error' }, 500)
  await admin
    .from('dev_clients')
    .update({ last_seen_at: now.toISOString(), version })
    .eq('id', client.id)

  // Current license: newest row that is not CANCELLED/RENEWED, with the
  // panel's computed-expiry rule applied (ACTIVE past expiry = EXPIRED).
  const { data: licenseRows } = await admin
    .from('dev_licenses')
    .select('status, plan, start_date, expiry_date')
    .eq('client_id', client.id)
    .not('status', 'in', '(CANCELLED,RENEWED)')
    .order('created_at', { ascending: false })
    .limit(1)
  const licenseRow = licenseRows?.[0] ?? null
  let license: {
    status: string
    plan: string
    start_date: string
    expiry_date: string | null
  } | null = null
  if (licenseRow) {
    const today = now.toISOString().slice(0, 10)
    const effective =
      licenseRow.status === 'ACTIVE' &&
      licenseRow.expiry_date !== null &&
      licenseRow.expiry_date < today
        ? 'EXPIRED'
        : licenseRow.status
    license = {
      status: effective,
      plan: licenseRow.plan,
      start_date: licenseRow.start_date,
      expiry_date: licenseRow.expiry_date,
    }
  }

  const { data: featureRows } = await admin
    .from('dev_client_features')
    .select('feature_key, is_enabled')
    .eq('client_id', client.id)
  const features: Record<string, boolean> = {}
  for (const key of FEATURE_KEYS) features[key] = false
  for (const row of featureRows ?? []) {
    if (row.feature_key in features) features[row.feature_key] = row.is_enabled
  }

  const { data: releaseRows } = await admin
    .from('dev_releases')
    .select('version, release_notes, required_migrations, target_client_ids')
    .eq('status', 'PUBLISHED')
  let latestRelease: {
    version: string
    release_notes: string
    required_migrations: string[]
  } | null = null
  for (const row of releaseRows ?? []) {
    // target_client_ids: null/empty = all clients (mirrors the
    // Developer Panel's latestPublishedRelease in devpanel.ts).
    const targets = row.target_client_ids ?? []
    if (targets.length > 0 && !targets.includes(client.id)) {
      continue
    }
    if (
      latestRelease === null ||
      compareVersions(row.version, latestRelease.version) > 0
    ) {
      latestRelease = {
        version: row.version,
        release_notes: row.release_notes,
        required_migrations: row.required_migrations ?? [],
      }
    }
  }

  return json({
    ok: true,
    server_time: now.toISOString(),
    client_status: client.status,
    license,
    features,
    latest_release: latestRelease,
  })
})
