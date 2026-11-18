// FoodX — license-key activation (landing/onboarding step 2).
//
// A fresh deployment activates from inside its own panel: the admin
// pastes the vendor-provided license key (LIC-…), this service calls
// the registry's instance-activate Edge Function, stores the returned
// instance identity in the instance_config table (migration 0016) and
// runs a first heartbeat so the license state is validated immediately.
//
// The registry URL + anon key come from env (VITE_FOODX_REGISTRY_URL /
// VITE_FOODX_REGISTRY_ANON_KEY): public values the vendor's deploy
// template sets for every client. Only the per-instance token is
// secret-ish, and it lives in instance_config (admin-only RLS), never
// in env, on this path. Vendor env provisioning (VITE_FOODX_INSTANCE_*)
// remains supported as a fallback — see heartbeat.ts resolution order.

import { supabase } from '@/lib/supabase'
import { APP_VERSION } from '@/lib/version'
import {
  runHeartbeat,
  storeInstanceConfigCache,
  type InstanceConfigCache,
} from '@/services/heartbeat'
import type { LicensePlan, LicenseStatus } from '@/types'

const REGISTRY_URL = import.meta.env.VITE_FOODX_REGISTRY_URL as
  | string
  | undefined
const REGISTRY_ANON_KEY = import.meta.env.VITE_FOODX_REGISTRY_ANON_KEY as
  | string
  | undefined

export interface InstanceConfigRow {
  id: number
  registry_url: string | null
  instance_id: string | null
  instance_token: string | null
  activated_at: string | null
}

/** True when this deployment knows where the vendor registry is. */
export function registryEnvConfigured(): boolean {
  return Boolean(REGISTRY_URL && REGISTRY_ANON_KEY)
}

export async function fetchInstanceConfig(): Promise<InstanceConfigRow | null> {
  const { data, error } = await supabase
    .from('instance_config')
    .select('*')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw error
  return data as InstanceConfigRow | null
}

/**
 * Load the instance_config row into the heartbeat service's local
 * cache. Called on panel load (AppLayout) so heartbeats use the
 * activation-written config. Never throws: a missing table (migration
 * pending), an RLS denial (non-admin profile) or a network failure
 * just leave the env fallback in charge.
 */
export async function refreshInstanceConfig(): Promise<boolean> {
  try {
    const row = await fetchInstanceConfig()
    if (row?.registry_url && row.instance_id && row.instance_token) {
      storeInstanceConfigCache({
        registry_url: row.registry_url,
        instance_id: row.instance_id,
        instance_token: row.instance_token,
      })
      return true
    }
    return false
  } catch {
    return false
  }
}

export type ActivationErrorCode =
  | 'registry_not_configured'
  | 'invalid_key'
  | 'already_activated'
  | 'license_not_active'
  | 'client_not_active'
  | 'config_save_failed'
  | 'network_error'

export class ActivationError extends Error {
  code: ActivationErrorCode
  /** Only for config_save_failed: the token the registry issued, so it
   * is not lost — the vendor can provision it via env instead. */
  issuedToken?: string
  issuedInstanceId?: string

  constructor(
    code: ActivationErrorCode,
    issued?: { token: string; instanceId: string },
  ) {
    super(code)
    this.name = 'ActivationError'
    this.code = code
    if (issued) {
      this.issuedToken = issued.token
      this.issuedInstanceId = issued.instanceId
    }
  }
}

export interface ActivationResult {
  instanceId: string
  license: {
    status: LicenseStatus
    plan: LicensePlan
    start_date: string
    expiry_date: string | null
  } | null
}

interface ActivateResponse {
  ok?: boolean
  instance_id?: string
  token?: string
  error?: string
  license?: ActivationResult['license']
}

/**
 * Exchange a license key for this deployment's instance identity.
 * Throws ActivationError with a coarse code the UI maps to an honest,
 * specific message. On success the config is stored (DB + local
 * cache) and a heartbeat runs, so callers can read the validated
 * license state from the heartbeat cache right away.
 */
export async function activateWithLicenseKey(
  licenseKey: string,
): Promise<ActivationResult> {
  if (!REGISTRY_URL || !REGISTRY_ANON_KEY) {
    throw new ActivationError('registry_not_configured')
  }
  let res: Response
  try {
    res = await fetch(`${REGISTRY_URL}/functions/v1/instance-activate`, {
      method: 'POST',
      headers: {
        apikey: REGISTRY_ANON_KEY,
        Authorization: `Bearer ${REGISTRY_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        license_key: licenseKey.trim(),
        domain: window.location.hostname,
        version: APP_VERSION,
      }),
    })
  } catch {
    throw new ActivationError('network_error')
  }
  const data = (await res.json().catch(() => null)) as ActivateResponse | null
  if (!res.ok || !data?.token || !data.instance_id) {
    switch (data?.error) {
      case 'invalid_key':
        throw new ActivationError('invalid_key')
      case 'already_activated':
        throw new ActivationError('already_activated')
      case 'license_not_active':
        throw new ActivationError('license_not_active')
      case 'client_not_active':
        throw new ActivationError('client_not_active')
      default:
        throw new ActivationError('network_error')
    }
  }
  const config: InstanceConfigCache = {
    registry_url: REGISTRY_URL,
    instance_id: data.instance_id,
    instance_token: data.token,
  }
  const { error } = await supabase.from('instance_config').upsert(
    {
      id: 1,
      registry_url: config.registry_url,
      instance_id: config.instance_id,
      instance_token: config.instance_token,
      activated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )
  if (error) {
    // The registry has burned this key (the token now exists there);
    // hand the issued token back so it can still be provisioned.
    throw new ActivationError('config_save_failed', {
      token: data.token,
      instanceId: data.instance_id,
    })
  }
  storeInstanceConfigCache(config)
  await runHeartbeat()
  return { instanceId: data.instance_id, license: data.license ?? null }
}
