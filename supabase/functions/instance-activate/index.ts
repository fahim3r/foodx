// FoodX instance-activate Edge Function (landing/onboarding step 2).
//
// Deployed on the REGISTRY Supabase project, next to instance-heartbeat.
// A fresh client installation POSTs { license_key, domain?, version? }
// with the registry project's anon key in the apikey/Authorization
// headers — the license key itself is the credential for this call.
// The function:
//   1. finds the license by key and its client,
//   2. refuses (with a coarse error code, no detail leaks) when the key
//      is unknown, the license is not effectively ACTIVE (computed
//      expiry, same rule as the Developer Panel and the heartbeat
//      function), the client is not ACTIVE, or the client already has
//      an instance token (already_activated — re-activation stays a
//      vendor action: rotate the token in the Developer Panel),
//   3. on success generates the per-instance token (same fx_ format as
//      the Developer Panel's generateInstanceToken), stores only its
//      SHA-256 hash on dev_clients, fills the client's domain if it was
//      empty, and returns { instance_id, token } exactly once — the
//      caller stores the token in its own instance_config table.

import { createClient } from 'jsr:@supabase/supabase-js@2'

// Instances run on arbitrary client domains, so the endpoint is open
// to every origin — the license key is the actual auth.
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

interface ActivateBody {
  license_key?: unknown
  domain?: unknown
  version?: unknown
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: ActivateBody
  try {
    body = (await req.json()) as ActivateBody
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  const licenseKey =
    typeof body.license_key === 'string' ? body.license_key.trim() : ''
  const domain = typeof body.domain === 'string' ? body.domain : null
  const version = typeof body.version === 'string' ? body.version : null
  if (!licenseKey) return json({ error: 'missing_fields' }, 400)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: license, error: licenseError } = await admin
    .from('dev_licenses')
    .select('id, client_id, status, plan, start_date, expiry_date')
    .eq('license_key', licenseKey)
    .maybeSingle()
  if (licenseError) return json({ error: 'registry_error' }, 500)
  if (!license) return json({ error: 'invalid_key' }, 404)

  const { data: client, error: clientError } = await admin
    .from('dev_clients')
    .select('id, client_code, status, instance_token_hash, domain')
    .eq('id', license.client_id)
    .maybeSingle()
  if (clientError) return json({ error: 'registry_error' }, 500)
  if (!client) return json({ error: 'registry_error' }, 500)
  if (client.status !== 'ACTIVE') {
    return json({ error: 'client_not_active' }, 403)
  }
  if (client.instance_token_hash) {
    return json({ error: 'already_activated' }, 409)
  }

  // Computed expiry, same rule as the Developer Panel and
  // instance-heartbeat: an ACTIVE license past expiry_date is EXPIRED.
  const today = new Date().toISOString().slice(0, 10)
  const effectiveStatus =
    license.status === 'ACTIVE' &&
    license.expiry_date !== null &&
    license.expiry_date < today
      ? 'EXPIRED'
      : license.status
  if (effectiveStatus !== 'ACTIVE') {
    return json({ error: 'license_not_active' }, 403)
  }

  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const token =
    'fx_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  const tokenHash = await sha256Hex(token)

  const updates: {
    instance_token_hash: string
    domain?: string
    version?: string
  } = { instance_token_hash: tokenHash }
  if (!client.domain && domain) updates.domain = domain
  if (version) updates.version = version

  // The is-null guard closes the race between two simultaneous
  // activations: only the first update lands; the loser affects no
  // rows and is told the instance is already activated.
  const { data: updated, error: updateError } = await admin
    .from('dev_clients')
    .update(updates)
    .eq('id', client.id)
    .is('instance_token_hash', null)
    .select('id')
  if (updateError) return json({ error: 'registry_error' }, 500)
  if (!updated || updated.length === 0) {
    return json({ error: 'already_activated' }, 409)
  }

  return json({
    ok: true,
    instance_id: client.client_code,
    token,
    license: {
      status: effectiveStatus,
      plan: license.plan,
      start_date: license.start_date,
      expiry_date: license.expiry_date,
    },
  })
})
