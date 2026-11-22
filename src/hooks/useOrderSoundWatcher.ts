import { useEffect, useRef } from 'react'

import {
  isSelfPlacedOrder,
  playNewOrderChime,
  playReadyChime,
} from '@/lib/sound'
import { subscribeKitchenOrders } from '@/services/kds'
import { fetchOpenOrders } from '@/services/orders'
import { loadSoundSettings } from '@/services/soundSettings'
import type { OrderStatus } from '@/types'

const POLL_MS = 15_000

/**
 * The Sound Effects watcher (design D5), mounted once in AppLayout
 * beside useOfflineSync, so it runs on every panel page. It polls
 * fetchOpenOrders every 15 s and also refetches on the realtime
 * ping — the same realtime-plus-poll idiom the KDS uses, but on its
 * OWN channel ('sound-order-watcher', passed to
 * subscribeKitchenOrders): the KDS page's channel name is fixed at
 * 'kds-orders', and a second subscriber on an already-subscribed
 * channel throws, which would break whichever mounted second.
 *
 * Rules (design D5/D7 + §4 guards):
 * - The first successful load after sound is switched on only sets
 *   the baseline — orders already open never chime.
 * - A new open-order ID → one doorbell; an ID whose status changes
 *   to READY → one ready triple. Each event chimes exactly once,
 *   and a batch of arrivals still plays a single chime.
 * - Orders this tab placed itself (noteSelfPlacedOrder) skip the
 *   arrival chime on this device; their READY transition chimes.
 * - While the master toggle is off the watcher does nothing at all
 *   (no fetch), and switching off also drops the baseline, so
 *   switching back on re-baselines silently instead of replaying
 *   everything that arrived meanwhile. Settings are re-read on
 *   every tick, so toggles apply without a reload.
 * - A failed poll keeps the last good state.
 */
export function useOrderSoundWatcher(restaurantId: string | null): void {
  const seenRef = useRef<Map<string, OrderStatus>>(new Map())
  const baselinedRef = useRef(false)
  const runningRef = useRef(false)

  useEffect(() => {
    if (!restaurantId) return
    seenRef.current = new Map()
    baselinedRef.current = false
    let cancelled = false

    const tick = async () => {
      if (runningRef.current) return
      if (!loadSoundSettings(restaurantId).master) {
        // Off means fully idle — and the next switch-on re-baselines.
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
        let arrival = false
        let ready = false
        for (const order of orders) {
          const prev = seenRef.current.get(order.id)
          if (prev === undefined) {
            if (order.status === 'READY') ready = true
            else if (!isSelfPlacedOrder(order.id)) arrival = true
          } else if (prev !== 'READY' && order.status === 'READY') {
            ready = true
          }
        }
        seenRef.current = next
        if (arrival) playNewOrderChime()
        if (ready) playReadyChime()
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
    }
  }, [restaurantId])
}
