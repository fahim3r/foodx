// FoodX — Auth context: session + workspace (profile / restaurant /
// settings) state for the signed-in user.
//
// Session persistence is Supabase's built-in handling; this provider
// subscribes to onAuthStateChange and loads the profile row (plus its
// restaurant and settings) after sign-in. If the Phase 1 tables do not
// exist yet in the live database, `dbPending` is set and the UI shows a
// friendly "database setup pending" notice instead of a raw error.
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { isMissingTableError, isNetworkError } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { onAuthStateChange, signOut as authSignOut } from '@/services/auth'
import {
  loadWorkspaceCache,
  saveWorkspaceCache,
} from '@/services/catalogCache'
import {
  fetchProfile,
  fetchRestaurant,
  fetchSettings,
} from '@/services/restaurant'
import type { Profile, Restaurant, RestaurantSettings } from '@/types'
import type { User } from '@supabase/supabase-js'

export interface AuthContextValue {
  user: User | null
  profile: Profile | null
  restaurant: Restaurant | null
  settings: RestaurantSettings | null
  /** True while the initial session is being resolved. */
  loading: boolean
  /** True when the Phase 1 tables are missing in the live database. */
  dbPending: boolean
  /** Reload profile / restaurant / settings for the current user. */
  refreshWorkspace: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

async function loadWorkspace(
  userId: string,
): Promise<{
  profile: Profile | null
  restaurant: Restaurant | null
  settings: RestaurantSettings | null
}> {
  const profile = await fetchProfile(userId)
  if (!profile?.restaurant_id) {
    return { profile, restaurant: null, settings: null }
  }
  const [restaurant, settings] = await Promise.all([
    fetchRestaurant(profile.restaurant_id),
    fetchSettings(profile.restaurant_id),
  ])
  return { profile, restaurant, settings }
}

/**
 * loadWorkspace + the Phase 9 v2 workspace cache: a successful live
 * load is written through to the cache; a network-error failure
 * falls back to the cached workspace for THIS user, so a cold
 * offline start restores the panel instead of landing on a
 * "no profile" dead end. Missing-table errors are never masked
 * by the cache.
 */
async function loadWorkspaceWithCache(
  userId: string,
): Promise<{
  profile: Profile | null
  restaurant: Restaurant | null
  settings: RestaurantSettings | null
}> {
  try {
    const workspace = await loadWorkspace(userId)
    saveWorkspaceCache(userId, workspace)
    return workspace
  } catch (error) {
    if (
      !isMissingTableError(error) &&
      (isNetworkError(error) || !navigator.onLine)
    ) {
      const cached = loadWorkspaceCache(userId)
      if (cached) return cached
    }
    throw error
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const [settings, setSettings] = useState<RestaurantSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [dbPending, setDbPending] = useState(false)

  const clearWorkspace = useCallback(() => {
    setProfile(null)
    setRestaurant(null)
    setSettings(null)
    setDbPending(false)
  }, [])

  const refreshWorkspace = useCallback(async () => {
    if (!user) return
    try {
      const workspace = await loadWorkspaceWithCache(user.id)
      setProfile(workspace.profile)
      setRestaurant(workspace.restaurant)
      setSettings(workspace.settings)
      setDbPending(false)
    } catch (error) {
      if (isMissingTableError(error)) {
        setDbPending(true)
      } else {
        // Non-schema errors (network, RLS): keep whatever we had and
        // let the page show its own friendly load error.
        throw error
      }
    }
  }, [user])

  // Initial session resolution + live auth state subscription.
  useEffect(() => {
    let cancelled = false
    void supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (cancelled) return
        const sessionUser = data.session?.user ?? null
        setUser(sessionUser)
        if (sessionUser) {
          try {
            const workspace = await loadWorkspaceWithCache(sessionUser.id)
            if (cancelled) return
            setProfile(workspace.profile)
            setRestaurant(workspace.restaurant)
            setSettings(workspace.settings)
          } catch (error) {
            if (!cancelled && isMissingTableError(error)) setDbPending(true)
          }
        }
        if (!cancelled) setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    const unsubscribe = onAuthStateChange((nextUser) => {
      setUser(nextUser)
      if (!nextUser) {
        clearWorkspace()
        setLoading(false)
        return
      }
      setLoading(true)
      void loadWorkspaceWithCache(nextUser.id)
        .then((workspace) => {
          setProfile(workspace.profile)
          setRestaurant(workspace.restaurant)
          setSettings(workspace.settings)
          setDbPending(false)
        })
        .catch((error: unknown) => {
          if (isMissingTableError(error)) setDbPending(true)
        })
        .finally(() => setLoading(false))
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [clearWorkspace])

  const handleSignOut = useCallback(async () => {
    await authSignOut()
    setUser(null)
    clearWorkspace()
  }, [clearWorkspace])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      restaurant,
      settings,
      loading,
      dbPending,
      refreshWorkspace,
      signOut: handleSignOut,
    }),
    [user, profile, restaurant, settings, loading, dbPending, refreshWorkspace, handleSignOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
