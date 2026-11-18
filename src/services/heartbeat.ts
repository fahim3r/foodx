// FoodX — instance heartbeat + license state (Phase 8 step 2).
//
// A configured deployment phones home to the vendor registry (the
// instance-heartbeat Edge Function, see supabase/functions/instance-
// heartbeat): it reports its version and receives its license state,
// feature flags and the latest release. The response is cached in
// localStorage so the panel works fully offline (§5); validation is
// advisory — per §53 a license problem raises warnings but never
// blocks POS or other local operations.
//
// Configuration resolution (landing/onboarding step 2):
//   1. the instance_config row, loaded after sign-in by
//      src/services/activation.ts and cached in localStorage next to
//      the license cache (deployments activated in-panel), then
//   2. the VITE_FOODX_* env values (vendor-provisioned deployments).
// The registry anon key always comes from env — it is a public key,
// set once in the vendor's deploy template; activation stores only
// the registry URL, instance id and token in instance_config.
// Unconfigured deployments skip everything: no calls, no banners,
// no module gates.

import { APP_VERSION } from '@/lib/version'
import type {
  DevClientStatus,
  DevFeatureKey,
  LicensePlan,
  LicenseStatus,
} from '@/types'

const REGISTRY_URL = import.meta.env.VITE_FOODX_REGISTRY_URL as
  | string
  | undefined
const REGISTRY_ANON_KEY = import.meta.env.VITE_FOODX_REGISTRY_ANON_KEY as
  | string
  | undefined
const INSTANCE_ID = import.meta.env.VITE_FOODX_INSTANCE_ID as
  | string
  | undefined
const INSTANCE_TOKEN = import.meta.env.VITE_FOODX_INSTANCE_TOKEN as
  | string
  | undefined

const INSTANCE_CONFIG_KEY = 'foodx.instance_config'

/** The activation-written config, cached by activation.ts. */
export interface InstanceConfigCache {
  registry_url: string
  instance_id: string
  instance_token: string
}

export function readInstanceConfigCache(): InstanceConfigCache | null {
  try {
    const raw = window.localStorage.getItem(INSTANCE_CONFIG_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as InstanceConfigCache
    if (
      typeof parsed.registry_url !== 'string' ||
      typeof parsed.instance_id !== 'string' ||
      typeof parsed.instance_token !== 'string'
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function storeInstanceConfigCache(config: InstanceConfigCache): void {
  try {
    window.localStorage.setItem(INSTANCE_CONFIG_KEY, JSON.stringify(config))
  } catch {
    // Storage full/blocked — the DB row remains the source of truth and
    // activation.ts reloads it on the next panel load.
  }
  window.dispatchEvent(new Event(LICENSE_UPDATED_EVENT))
}

interface ResolvedConfig {
  registryUrl: string
  anonKey: string
  instanceId: string
  token: string
}

/**
 * Effective registry config: the activation-written instance_config
 * cache wins; env provisioning is the fallback. The anon key is
 * env-only in both modes (public key, part of the deploy template).
 */
function resolveConfig(): ResolvedConfig | null {
  if (!REGISTRY_ANON_KEY) return null
  const cached = readInstanceConfigCache()
  if (cached) {
    return {
      registryUrl: cached.registry_url,
      anonKey: REGISTRY_ANON_KEY,
      instanceId: cached.instance_id,
      token: cached.instance_token,
    }
  }
  if (REGISTRY_URL && INSTANCE_ID && INSTANCE_TOKEN) {
    return {
      registryUrl: REGISTRY_URL,
      anonKey: REGISTRY_ANON_KEY,
      instanceId: INSTANCE_ID,
      token: INSTANCE_TOKEN,
    }
  }
  return null
}

const CACHE_KEY = 'foodx.license_state'
export const LICENSE_UPDATED_EVENT = 'foodx-license-updated'
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000
const EXPIRING_WITHIN_DAYS = 7

export interface HeartbeatLicense {
  status: LicenseStatus
  plan: LicensePlan
  start_date: string
  expiry_date: string | null
}

export interface HeartbeatRelease {
  version: string
  release_notes: string
  required_migrations: string[]
}

export interface LicenseStateCache {
  fetched_at: string
  server_time: string
  client_status: DevClientStatus
  license: HeartbeatLicense | null
  features: Record<DevFeatureKey, boolean>
  latest_release: HeartbeatRelease | null
}

export type LicenseWarningReason =
  | 'expired'
  | 'suspended'
  | 'no_license'
  | 'client_suspended'
  | 'stale'

export interface LicenseView {
  display: 'UNCONFIGURED' | 'UNKNOWN' | 'OK' | 'EXPIRING' | 'WARNING'
  reason: LicenseWarningReason | null
  cache: LicenseStateCache | null
  updateAvailable: boolean
}

export function isHeartbeatConfigured(): boolean {
  return resolveConfig() !== null
}

export function heartbeatInstanceId(): string | null {
  return resolveConfig()?.instanceId ?? null
}

export function readLicenseCache(): LicenseStateCache | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LicenseStateCache
    if (typeof parsed.fetched_at !== 'string' || !parsed.features) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * POST one heartbeat to the registry and cache the response. Returns
 * true on success; on any failure the previous cache is kept untouched
 * (offline-first) and false is returned.
 */
export async function runHeartbeat(): Promise<boolean> {
  const config = resolveConfig()
  if (!config) return false
  try {
    const res = await fetch(
      `${config.registryUrl}/functions/v1/instance-heartbeat`,
      {
        method: 'POST',
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instance_id: config.instanceId,
          token: config.token,
          version: APP_VERSION,
          domain: window.location.hostname,
        }),
      },
    )
    if (!res.ok) return false
    const data = (await res.json()) as {
      server_time: string
      client_status: DevClientStatus
      license: HeartbeatLicense | null
      features: Record<DevFeatureKey, boolean>
      latest_release: HeartbeatRelease | null
    }
    const cache: LicenseStateCache = {
      fetched_at: new Date().toISOString(),
      server_time: data.server_time,
      client_status: data.client_status,
      license: data.license,
      features: data.features,
      latest_release: data.latest_release,
    }
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
    } catch {
      // Storage full/blocked — the view just stays UNKNOWN this session.
    }
    window.dispatchEvent(new Event(LICENSE_UPDATED_EVENT))
    return true
  } catch {
    return false
  }
}

// Minimal semver compare (x.y.z, missing parts = 0). Mirrors
// compareVersions in src/services/devpanel.ts and the Edge Function.
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Derive what the UI should show from the cache + the local clock. */
export function getLicenseView(now: Date = new Date()): LicenseView {
  if (!isHeartbeatConfigured()) {
    return {
      display: 'UNCONFIGURED',
      reason: null,
      cache: null,
      updateAvailable: false,
    }
  }
  const cache = readLicenseCache()
  if (!cache) {
    return { display: 'UNKNOWN', reason: null, cache: null, updateAvailable: false }
  }
  const updateAvailable =
    cache.latest_release !== null &&
    compareVersions(cache.latest_release.version, APP_VERSION) > 0
  if (cache.client_status === 'SUSPENDED') {
    return { display: 'WARNING', reason: 'client_suspended', cache, updateAvailable }
  }
  if (!cache.license) {
    return { display: 'WARNING', reason: 'no_license', cache, updateAvailable }
  }
  if (cache.license.status === 'SUSPENDED') {
    return { display: 'WARNING', reason: 'suspended', cache, updateAvailable }
  }
  if (cache.license.status === 'EXPIRED') {
    return { display: 'WARNING', reason: 'expired', cache, updateAvailable }
  }
  const ageMs = now.getTime() - new Date(cache.fetched_at).getTime()
  if (ageMs > STALE_AFTER_MS) {
    return { display: 'WARNING', reason: 'stale', cache, updateAvailable }
  }
  if (cache.license.status === 'ACTIVE' && cache.license.expiry_date) {
    const daysLeft = Math.ceil(
      (new Date(`${cache.license.expiry_date}T00:00:00`).getTime() -
        now.getTime()) /
        (24 * 60 * 60 * 1000),
    )
    if (daysLeft <= EXPIRING_WITHIN_DAYS) {
      return { display: 'EXPIRING', reason: null, cache, updateAvailable }
    }
  }
  return { display: 'OK', reason: null, cache, updateAvailable }
}

/**
 * Vendor feature gate for a module (§60). Unconfigured deployments and
 * "no successful heartbeat yet" never gate — only an explicit false
 * from the registry closes a module.
 */
export function isModuleEnabled(
  view: LicenseView,
  key: DevFeatureKey,
): boolean {
  if (!view.cache) return true
  return view.cache.features[key] === true
}
