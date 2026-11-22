import { useEffect, useRef } from 'react'

import {
  isSelfPlacedOrder,
  playCancelledSound,
  playCompleteSound,
  startAlert,
  stopAlert,
  stopAlertNow,
  stopAllAlerts,
} from '@/lib/sound'
import { subscribeKitchenOrders } from '@/services/kds'
import { fetchOpenOrders, fetchOrderById } from '@/services/orders'
import { loadSoundSettings } from '@/services/soundSettings'
import type { OrderStatus } from '@/types'

const POLL_MS = 15_000

/**
 * The Sound Effects watcher (design D5; v1.1 addendum §7b), mounted
 * once in AppLayout beside useOfflineSync, so it runs on every panel
 * page. It polls fetchOpenOrders every 15 s and also refetches on
 * the realtime ping — the same realtime-plus-poll idiom the KDS
 * uses, but on its OWN channel ('sound-order-watcher', passed to
 * subscribeKitchenOrders): the KDS page's channel name is fixed at
 * 'kds-orders', and a second subscriber on an already-subscribed
 * channel throws, which would break whichever mounted second.
 *
 * Rules (design D5/D7 + §4 guards + §7b):
 * - The first successful load after sound is switched on only sets
 *   the baseline — orders already open never start an alert loop.
 * - v1.1: the new-order doorbell and the ready triple are LOOPING
 *   alerts (lib/sound startAlert): the 'new' loop runs while at
 *   least one un-acted new order exists — an order counts as acted
 *   on once its status moves past the status it arrived with, or it
 *   leaves the open list; the 'ready' loop runs while at least one
 *   alerted order still sits READY. When the last tracked order
 *   clears, stopAlert lets the loop finish its 5 s minimum, then
 *   it stops. Each loop is per-kind, not per-order.
 * - Orders this tab placed itself (noteSelfPlacedOrder) never start
 *   the 'new' loop on this device; their READY transition still
 *   alerts (design D7).
 * - Leaving the open list (v1.1): an order that disappears gets ONE
 *   one-off fetchOrderById check of its final status — COMPLETED
 *   plays the success motif, CANCELLED plays the soft failed tone,
 *   anything else stays silent. At most one of each plays per tick,
 *   however many orders closed together.
 * - While the master toggle is off the watcher does nothing at all
 *   (no fetch, loops hard-stopped), and switching off also drops
 *   the baseline, so switching back on re-baselines silently
 *   instead of replaying everything that arrived meanwhile. The
 *   same hard stop applies per-event: if an event toggle is off,
 *   its loop is cut immediately and its tracking cleared. Settings
 *   are re-read on every tick, so toggles apply without a reload
 *   (SoundCard also stops loops the moment a toggle is switched
 *   off — this per-tick check is the backstop).
 * - A failed poll keeps the last good state.
 * - Unmount (or a restaurant switch) stops every loop.
 */
export function useOrderSoundWatcher(restaurantId: string | null): void {
  const seenRef = useRef<Map<string, OrderStatus>>(new Map())
  /** orderId → the status it arrived with, for 'new'-alert orders. */
  const newAlertRef = useRef<Map<string, OrderStatus>>(new Map())
  /** orderIds currently counted toward the 'ready' alert. */
  const readyAlertRef = useRef<Set<string>>(new Set())
  /** Disappeared orderIds already completion-checked (once each). */
  const completionCheckedRef = useRef<Set<string>>(new Set())
  const baselinedRef = useRef(false)
  const runningRef = useRef(false)

  useEffect(() => {
    if (!restaurantId) return
    seenRef.current = new Map()
    newAlertRef.current = new Map()
    readyAlertRef.current = new Set()
    completionCheckedRef.current = new Set()
    baselinedRef.current = false
    let cancelled = false

    const tick = async () => {
      if (runningRef.current) return
      const settings = loadSoundSettings(restaurantId)
      if (!settings.master) {
        // Off means fully idle — silence now, re-baseline on switch-on.
        stopAllAlerts()
        newAlertRef.current.clear()
        readyAlertRef.current.clear()
        baselinedRef.current = false
        return
      }
      runningRef.current = true
      try {
        const { orders } = await fetchOpenOrders(restaurantId, 50)
        if (cancelled) return
        const next = new Map<string, OrderStatus>()
        for (const order of orders) next.set(order.id, order.status)
        if (!baselinedRef.current) {
          seenRef.current = next
          baselinedRef.current = true
          return
        }
        const prevSeen = seenRef.current
        for (const order of orders) {
          const prev = prevSeen.get(order.id)
          if (prev === undefined) {
            // New arrival. One already at READY alerts as ready
            // (v1 semantics); any other arrival starts/contributes
            // to the 'new' loop unless this tab placed it (D7).
            if (order.status === 'READY') {
              readyAlertRef.current.add(order.id)
            } else if (!isSelfPlacedOrder(order.id)) {
              newAlertRef.current.set(order.id, order.status)
            }
          } else {
            const arrivalStatus = newAlertRef.current.get(order.id)
            if (
              arrivalStatus !== undefined &&
              order.status !== arrivalStatus
            ) {
              // Acted on: its status moved past what it arrived with.
              newAlertRef.current.delete(order.id)
            }
            if (prev !== 'READY' && order.status === 'READY') {
              readyAlertRef.current.add(order.id)
            }
            if (order.status !== 'READY') {
              readyAlertRef.current.delete(order.id)
            }
          }
        }
        // Orders that left the open list: their alert tracking ends,
        // and each gets a single completion check below.
        const disappeared: string[] = []
        for (const id of prevSeen.keys()) {
          if (!next.has(id)) {
            disappeared.push(id)
            newAlertRef.current.delete(id)
            readyAlertRef.current.delete(id)
          }
        }
        seenRef.current = next
        // Loop control, per kind. A disabled event is cut at once
        // (and its tracking dropped); otherwise the loop runs while
        // a tracked order remains, and soft-stops when none do.
        if (!settings.newOrder) {
          stopAlertNow('new')
          newAlertRef.current.clear()
        } else if (newAlertRef.current.size > 0) {
          startAlert('new')
        } else {
          stopAlert('new')
        }
        if (!settings.ready) {
          stopAlertNow('ready')
          readyAlertRef.current.clear()
        } else if (readyAlertRef.current.size > 0) {
          startAlert('ready')
        } else {
          stopAlert('ready')
        }
        // Final-status sounds: one status fetch per disappeared
        // order, once each — COMPLETED plays the success motif,
        // CANCELLED the failed tone, anything else silence. At most
        // one of each per tick, however many orders closed together.
        // (The play helpers re-check their own event toggle, so this
        // block only needs either event switched on to be worth the
        // fetches.)
        if ((settings.complete || settings.cancelled) && disappeared.length > 0) {
          const toCheck = disappeared.filter(
            (id) => !completionCheckedRef.current.has(id),
          )
          for (const id of toCheck) completionCheckedRef.current.add(id)
          if (toCheck.length > 0) {
            void (async () => {
              let anyCompleted = false
              let anyFailed = false
              for (const id of toCheck) {
                try {
                  const order = await fetchOrderById(id)
                  if (order?.status === 'COMPLETED') anyCompleted = true
                  else if (order?.status === 'CANCELLED') anyFailed = true
                } catch {
                  // Best-effort: a failed check just stays silent.
                }
              }
              if (cancelled) return
              if (anyCompleted) playCompleteSound()
              if (anyFailed) playCancelledSound()
            })()
          }
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
    const unsubscribe = subscribeKitchenOrders(() => {
      void tick()
    }, 'sound-order-watcher')
    return () => {
      cancelled = true
      window.clearInterval(timer)
      unsubscribe()
      stopAllAlerts()
    }
  }, [restaurantId])
}
