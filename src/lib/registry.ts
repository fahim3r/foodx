import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabase'

const registryUrl = import.meta.env.VITE_FOODX_REGISTRY_URL as
  | string
  | undefined
const registryAnonKey = import.meta.env.VITE_FOODX_REGISTRY_ANON_KEY as
  | string
  | undefined

/**
 * Client for the vendor registry project (Phase 8 R5). The registry
 * (dev_* tables, developer allow-list, instance-heartbeat /
 * instance-activate functions) lives in its own Supabase project,
 * separate from every client deployment; the Developer Panel and
 * its sign-in gate talk to it through this client, using the same
 * env vars the heartbeat already used.
 *
 * When the registry env is not configured, this falls back to the
 * deployment's own client (the pre-R5 layout, where the registry
 * lived inside the demo project) so nothing breaks before the
 * vendor sets the variables.
 */
export const registrySupabase: SupabaseClient =
  registryUrl && registryAnonKey
    ? createClient(registryUrl, registryAnonKey)
    : supabase

/** True when this deployment points at a separate registry project. */
export const registryConfigured = Boolean(registryUrl && registryAnonKey)
