import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Set VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_ANON_KEY in your .env file (see .env.example).',
  )
}

/**
 * Shared Supabase client, created once from
 * `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
 * Import { supabase } from '@/lib/supabase' — or use the relative
 * path 'src/lib/supabase' until a path alias is configured.
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey)
