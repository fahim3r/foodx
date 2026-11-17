import { useEffect, useState } from 'react'

import {
  getLicenseView,
  LICENSE_UPDATED_EVENT,
  type LicenseView,
} from '@/services/heartbeat'

/**
 * Reactive view of the cached license state (Phase 8 step 2). Refreshes
 * whenever a heartbeat completes or another tab updates the cache.
 */
export function useLicenseState(): LicenseView {
  const [view, setView] = useState<LicenseView>(() => getLicenseView())

  useEffect(() => {
    const refresh = () => setView(getLicenseView())
    window.addEventListener(LICENSE_UPDATED_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(LICENSE_UPDATED_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  return view
}
