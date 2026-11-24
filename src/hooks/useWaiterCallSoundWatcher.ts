import { useEffect, useRef } from 'react'

import { startAlert, stopAlert, stopAlertNow } from '@/lib/sound'
import { loadSoundSettings } from '@/services/soundSettings'
import {
  fetchPendingWaiterCalls,
  subscribeWaiterCalls,
} from '@/services/waiterCalls'

const POLL_MS = 15_000

/**
 * The Call Waiter sound watcher (migration 0038), the sibling of
 * useOrderSoundWatcher — mounted beside it in AppLayout, so the
 * service bell rings on every panel page, not just the Waiter page.
 * It polls the pending calls every 15 s and refetches on the
 * realtime ping, on its OWN channel ('waiter-call-sound-watcher'):
 * the strip components subscribe as 'waiter-calls', and a second
 * subscriber on an already-subscribed channel would collide.
 *
 * Rules (mirroring the order watcher's baseline discipline):
 * - The first successful load only sets the baseline — calls that
 *   were already waiting when the panel opened never start the
 *   bell on this device.
 * - A call that arrives AFTER the baseline joins the alert set;
 *   the 'waiter' loop in lib/sound rings (every ~3 s, 5-minute
 *   safety cap) while the set is non-empty, and soft-stops when
 *   the last such call is attended.
 * - While the master or the waiterCall event toggle is off the
 *   watcher does nothing (loop hard-stopped, baseline dropped, so
 *   switching back on re-baselines silently). Settings are re-read
 *   on every tick, so toggles apply without a reload.
 * - A failed poll keeps the last good state; unmount (or a
 *   restaurant switch) stops the loop.
 */
export function useWaiterCallSoundWatcher(restaurantId: string | null): void {
  /** Every call id pending at the last successful tick. */
  const knownRef = useRef<Set<string>>(new Set())
  /** Call ids counted toward the bell (arrived after the baseline,
   * still pending). */
  const alertingRef = useRef<Set<string>>(new Set())
  const baselinedRef = useRef(false)
  const runningRef = useRef(false)

  useEffect(() => {
    if (!restaurantId) return
    knownRef.current = new Set()
    alertingRef.current = new Set()
    baselinedRef.current = false
    let cancelled = false

    const tick = async () => {
      if (runningRef.current) return
      const settings = loadSoundSettings(restaurantId)
      if (!settings.master || !settings.waiterCall) {
        // Off means fully idle — silence now, re-baseline on switch-on.
        stopAlertNow('waiter')
        knownRef.current = new Set()
        alertingRef.current.clear()
        baselinedRef.current = false
        return
      }
      runningRef.current = true
      try {
        const calls = await fetchPendingWaiterCalls(restaurantId)
        if (cancelled) return
        const pendingIds = new Set(calls.map((call) => call.id))
        if (!baselinedRef.current) {
          // Baseline: everything already waiting stays silent here.
          knownRef.current = pendingIds
          baselinedRef.current = true
          return
        }
        // New arrivals join the alert set; attended calls drop out.
        for (const id of pendingIds) {
          if (!knownRef.current.has(id)) alertingRef.current.add(id)
        }
        for (const id of [...alertingRef.current]) {
          if (!pendingIds.has(id)) alertingRef.current.delete(id)
        }
        knownRef.current = pendingIds
        if (alertingRef.current.size > 0) {
          startAlert('waiter')
        } else {
          stopAlert('waiter')
        }
      } catch {
        // Keep the last good state; the next poll/realtime ping retries.
      } finally {
        runningRef.current = false
      }
    }

    void tick()
    const timer = window.setInterval(() => {
      void tick()
    }, POLL_MS)
    const unsubscribe = subscribeWaiterCalls(
      restaurantId,
      () => {
        void tick()
      },
      'waiter-call-sound-watcher',
    )
    return () => {
      cancelled = true
      window.clearInterval(timer)
      unsubscribe()
      stopAlertNow('waiter')
    }
  }, [restaurantId])
}
