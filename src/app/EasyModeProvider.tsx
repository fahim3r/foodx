import {
  createContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react'

import { useAuth } from '@/hooks/useAuth'

export interface EasyModeContextValue {
  easy: boolean
}

export const EasyModeContext = createContext<EasyModeContextValue | null>(null)

/**
 * Easy Mode v2 (wave E1): the mode is a RESTAURANT-WIDE setting —
 * `restaurant_settings.easy_mode` (migration 0034) — read here from
 * the workspace settings the AuthProvider already loads, so the
 * counter tablet, the owner's phone and the waiter's phone all show
 * the same panel. (v1 kept it in per-device localStorage; that
 * storage key is no longer read.) There is deliberately no setter
 * in this context: the only way to change the mode is the Settings
 * switch, which is owner/admin-only and manager-PIN gated
 * (EasyModeCard). The presentation effects are unchanged from v1:
 * the `easy-mode` class on <html> raises the root font size to
 * 112.5% (Tailwind is rem-based, so everything grows), the sidebar
 * swaps to the easy subset + labels, the POS simplifies, and the
 * panel home becomes Easy Home. It is still NOT a permission: it
 * changes no data and no access.
 */
export function EasyModeProvider({ children }: { children: ReactNode }) {
  const { settings } = useAuth()
  const easy = settings?.easy_mode === true

  useEffect(() => {
    document.documentElement.classList.toggle('easy-mode', easy)
    return () => {
      document.documentElement.classList.remove('easy-mode')
    }
  }, [easy])

  const value = useMemo<EasyModeContextValue>(() => ({ easy }), [easy])

  return (
    <EasyModeContext.Provider value={value}>{children}</EasyModeContext.Provider>
  )
}
