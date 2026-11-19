import { useEffect, useState } from 'react'

import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  ADMIN_ROLE_NAMES,
  DEFAULT_ROLE_PERMISSIONS,
  fetchMyRoles,
  fetchPermissions,
} from '@/services/roles'

/**
 * Effective UI permissions for the signed-in user (modifications
 * v2, item 4). System roles resolve through the code-level
 * DEFAULT_ROLE_PERMISSIONS; custom roles through their
 * role_permissions rows. Admin-level roles bypass everything.
 *
 * This is a PRESENTATION layer: it hides nav items and buttons.
 * It is not the security boundary — RLS is, exactly as before.
 * While loading (or on any error) `can()` returns true, so a
 * slow or failed lookup can never lock staff out of the panel.
 */
interface PermissionState {
  isAdminLevel: boolean
  keys: Set<string>
}

let cache: { userId: string; state: PermissionState } | null = null

async function loadPermissions(userId: string): Promise<PermissionState> {
  const myRoles = await fetchMyRoles(userId)
  const isAdminLevel = myRoles.some((r) => ADMIN_ROLE_NAMES.includes(r.name))
  if (isAdminLevel) return { isAdminLevel, keys: new Set() }
  const keys = new Set<string>()
  const customRoleIds: string[] = []
  for (const role of myRoles) {
    if (role.restaurant_id === null) {
      for (const key of DEFAULT_ROLE_PERMISSIONS[role.name] ?? []) keys.add(key)
    } else {
      customRoleIds.push(role.id)
    }
  }
  if (customRoleIds.length > 0) {
    const [allPermissions, { data, error }] = await Promise.all([
      fetchPermissions(),
      supabase
        .from('role_permissions')
        .select('role_id, permission_id')
        .in('role_id', customRoleIds),
    ])
    if (error) throw error
    const keyById = new Map(allPermissions.map((p) => [p.id, p.key]))
    for (const row of data ?? []) {
      const key = keyById.get(row.permission_id as string)
      if (key) keys.add(key)
    }
  }
  return { isAdminLevel, keys }
}

export function usePermissions(): {
  ready: boolean
  isAdminLevel: boolean
  can: (key: string) => boolean
} {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [state, setState] = useState<PermissionState | null>(
    () => (cache && userId && cache.userId === userId ? cache.state : null),
  )

  useEffect(() => {
    if (!userId) {
      setState(null)
      return
    }
    if (cache && cache.userId === userId) {
      setState(cache.state)
      return
    }
    let cancelled = false
    loadPermissions(userId)
      .then((loaded) => {
        cache = { userId, state: loaded }
        if (!cancelled) setState(loaded)
      })
      .catch((error: unknown) => {
        console.error('[permissions] load failed; UI stays ungated', error)
        if (!cancelled) setState({ isAdminLevel: false, keys: new Set() })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const can = (key: string): boolean =>
    state === null || state.isAdminLevel || state.keys.has(key)

  return { ready: state !== null, isAdminLevel: state?.isAdminLevel ?? false, can }
}
