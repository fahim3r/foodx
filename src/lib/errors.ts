// FoodX — friendly error mapping.
// Supabase/PostgREST errors are technical by nature; the UI must never show
// them raw. These helpers translate them into i18n keys / friendly states.

/** Map a Supabase Auth error message to an `auth.errors.*` i18n key. */
export function authErrorKey(message: string | undefined): string {
  const m = (message ?? '').toLowerCase()
  if (m.includes('invalid login credentials')) return 'auth.errors.invalidCredentials'
  if (m.includes('email not confirmed')) return 'auth.errors.emailNotConfirmed'
  if (m.includes('user already registered')) return 'auth.errors.userExists'
  if (m.includes('password should be at least')) return 'auth.errors.passwordTooShort'
  if (m.includes('email rate limit exceeded') || m.includes('rate limit'))
    return 'auth.errors.rateLimited'
  if (m.includes('expired') || m.includes('invalid') || m.includes('token'))
    return 'auth.errors.linkInvalid'
  return 'auth.errors.generic'
}

/**
 * True when a PostgREST error is a unique-violation on the restaurants
 * slug — i.e. the chosen restaurant URL name is already taken. In the
 * Settings save flow this is the only plain insert with a unique
 * constraint, so code 23505 here always means the slug is taken.
 */
export function isSlugTakenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; message?: unknown }
  if (e.code === '23505') return true
  const message = typeof e.message === 'string' ? e.message : ''
  return /restaurants_slug_key/i.test(message)
}

/**
 * True when a PostgREST error means the Phase 1 tables have not been
 * created in the live database yet (migrations not applied). The app
 * degrades gracefully in that case instead of showing raw errors.
 */
export function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; message?: unknown }
  if (e.code === 'PGRST205' || e.code === '42P01') return true
  const message = typeof e.message === 'string' ? e.message : ''
  return (
    /relation .* does not exist/i.test(message) ||
    /could not find the table/i.test(message)
  )
}
