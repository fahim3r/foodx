import { useEffect, useState } from 'react'

/**
 * Browser connectivity state (Phase 9). Tracks navigator.onLine and
 * the online/offline events. This is a hint, not a proof — a captive
 * portal can claim "online" while the API is unreachable — so the
 * sync runner treats its own failures as the real signal; this hook
 * only drives the POS badge and the direct-to-queue placement path.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(
    () => typeof navigator === 'undefined' || navigator.onLine,
  )
  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    setOnline(navigator.onLine)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])
  return online
}
