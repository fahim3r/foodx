import { useCallback, useEffect, useRef } from 'react'
import { isNetworkError } from '@/lib/errors'
import {
  loadQueue,
  removeEntry,
  updateEntry,
  OFFLINE_QUEUE_UPDATED_EVENT,
} from '@/services/offlineQueue'
import { syncQueuedOrder } from '@/services/pos'

const VALIDATION_FAILURES = new Set([
  'sync_product_missing',
  'sync_totals_mismatch',
  'sync_payment_exceeds',
])

/** After this many non-transient attempts an entry is parked as
 * failed so one bad entry cannot block the queue forever. */
const MAX_ATTEMPTS = 5

function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; message?: unknown; status?: unknown }
  if (e.code === 'PGRST301' || e.status === 401) return true
  const message = typeof e.message === 'string' ? e.message : ''
  return /jwt|not authenticated/i.test(message)
}

/**
 * The Phase 9 sync runner. Mounted once in AppLayout: replays the
 * offline queue for the current restaurant whenever the panel
 * mounts, the browser comes back online, the queue changes, and
 * every 60 seconds while entries wait.
 *
 * Per entry: success removes it. A validation failure marks it
 * 'failed' (visible in the POS queue panel, never dropped) and the
 * run continues. A network or auth failure stops the run — the
 * entries stay queued for the next trigger; the queue is NEVER
 * cleared on sign-out, so a long outage plus an expired session
 * loses nothing.
 */
export function useOfflineSync(
  restaurantId: string | null,
  userId: string | null,
): void {
  const runningRef = useRef(false)

  const runSync = useCallback(async () => {
    if (!restaurantId || !userId || runningRef.current) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    const waiting = loadQueue(restaurantId).filter((e) => e.status === 'queued')
    if (waiting.length === 0) return
    runningRef.current = true
    try {
      for (const entry of waiting) {
        try {
          await syncQueuedOrder(entry, userId)
          removeEntry(restaurantId, entry.id)
        } catch (error) {
          const message = error instanceof Error ? error.message : ''
          if (VALIDATION_FAILURES.has(message)) {
            updateEntry(restaurantId, entry.id, {
              status: 'failed',
              failureReason: message,
              attempts: entry.attempts + 1,
              lastAttemptAt: new Date().toISOString(),
            })
            continue
          }
          if (isNetworkError(error) || isAuthError(error)) break
          const attempts = entry.attempts + 1
          if (attempts >= MAX_ATTEMPTS) {
            updateEntry(restaurantId, entry.id, {
              status: 'failed',
              failureReason: 'sync_failed',
              attempts,
              lastAttemptAt: new Date().toISOString(),
            })
            continue
          }
          updateEntry(restaurantId, entry.id, {
            attempts,
            lastAttemptAt: new Date().toISOString(),
          })
          break
        }
      }
    } finally {
      runningRef.current = false
    }
  }, [restaurantId, userId])

  useEffect(() => {
    void runSync()
    const interval = window.setInterval(() => void runSync(), 60_000)
    const trigger = () => void runSync()
    window.addEventListener('online', trigger)
    window.addEventListener(OFFLINE_QUEUE_UPDATED_EVENT, trigger)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('online', trigger)
      window.removeEventListener(OFFLINE_QUEUE_UPDATED_EVENT, trigger)
    }
  }, [runSync])
}
