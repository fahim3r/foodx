import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { elapsedMinutes, useNow } from '@/lib/time'
import {
  attendWaiterCall,
  fetchPendingWaiterCalls,
  subscribeWaiterCalls,
  type PendingWaiterCall,
} from '@/services/waiterCalls'

const POLL_MS = 15_000

/**
 * Pending "Call waiter" alerts (migration 0038), shared by the
 * Waiter page (top of the page) and the POS (under the live-order
 * carousel). Initial fetch + realtime subscription + a 15 s poll
 * fallback — the same live idiom as the KDS/sound watcher, so the
 * strip keeps working even if Realtime drops. Renders nothing when
 * no table is calling: no empty box on a quiet day.
 */
export default function WaiterCallsStrip({
  restaurantId,
  userId,
}: {
  restaurantId: string
  userId: string
}) {
  const { t } = useTranslation()
  const now = useNow(POLL_MS)
  const [calls, setCalls] = useState<PendingWaiterCall[]>([])
  const [attendingId, setAttendingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setCalls(await fetchPendingWaiterCalls(restaurantId))
    } catch {
      // Keep the last good list; the next poll/realtime ping retries.
    }
  }, [restaurantId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, POLL_MS)
    const unsubscribe = subscribeWaiterCalls(restaurantId, () => {
      void refresh()
    })
    return () => {
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [restaurantId, refresh])

  const attend = async (call: PendingWaiterCall) => {
    if (attendingId) return
    setAttendingId(call.id)
    try {
      await attendWaiterCall(call.id, userId)
      setCalls((current) => current.filter((c) => c.id !== call.id))
    } catch {
      // Leave the call up; a retry (or the next refresh) settles it.
      void refresh()
    } finally {
      setAttendingId(null)
    }
  }

  if (calls.length === 0) return null

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <Bell className="size-4" />
        {t('waiterCalls.title')}
      </p>
      <ul className="flex flex-col gap-2">
        {calls.map((call) => {
          const minutes = elapsedMinutes(call.createdAt, now)
          return (
            <li
              key={call.id}
              className="flex items-center justify-between gap-2 text-sm text-amber-900"
            >
              <span>
                <span className="font-medium">
                  {t('waiterCalls.calling', { table: call.tableName })}
                </span>{' '}
                ·{' '}
                {minutes < 1
                  ? t('waiterCalls.agoNow')
                  : t('waiterCalls.agoMinutes', { minutes })}
              </span>
              <Button
                type="button"
                size="sm"
                disabled={attendingId === call.id}
                onClick={() => void attend(call)}
              >
                {t('waiterCalls.done')}
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
