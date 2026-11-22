// FoodX — header online/offline status card (Dashboard
// modernisation W1, design §6). A compact card beside the header
// quick actions, driven by useOnlineStatus() plus the Phase 9
// offline queue (loadQueue + queueCounts, re-read whenever the
// queue changes and whenever connectivity flips). The card never
// claims "synced" as a fact — navigator.onLine is a hint; the
// queue counts are the real local truth, so they are what it shows.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import {
  loadQueue,
  queueCounts,
  OFFLINE_QUEUE_UPDATED_EVENT,
} from '@/services/offlineQueue'
import { Card, CardContent } from '@/components/ui/card'

export default function OnlineStatusCard({
  restaurantId,
  posHref,
}: {
  restaurantId: string | null
  posHref: string
}) {
  const { t } = useTranslation()
  const online = useOnlineStatus()
  const [waiting, setWaiting] = useState(0)
  const [failed, setFailed] = useState(0)

  useEffect(() => {
    const read = () => {
      if (!restaurantId) {
        setWaiting(0)
        setFailed(0)
        return
      }
      const counts = queueCounts(loadQueue(restaurantId))
      setWaiting(counts.waiting)
      setFailed(counts.failed)
    }
    read()
    window.addEventListener(OFFLINE_QUEUE_UPDATED_EVENT, read)
    window.addEventListener('online', read)
    window.addEventListener('offline', read)
    return () => {
      window.removeEventListener(OFFLINE_QUEUE_UPDATED_EVENT, read)
      window.removeEventListener('online', read)
      window.removeEventListener('offline', read)
    }
  }, [restaurantId])

  const dotClass = !online
    ? 'bg-red-500'
    : waiting > 0
      ? 'bg-amber-500'
      : 'bg-emerald-500'

  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-3">
        <span
          aria-hidden="true"
          className={`size-3 shrink-0 rounded-full ${dotClass}`}
        />
        <div className="text-sm">
          {online ? (
            waiting > 0 ? (
              <p className="font-medium">
                {t('dashboard.statusSyncing', { count: waiting })}
              </p>
            ) : (
              <p className="font-medium">{t('dashboard.statusOnline')}</p>
            )
          ) : (
            <>
              <p className="font-medium">{t('dashboard.statusOffline')}</p>
              <p className="text-muted-foreground">
                {t('dashboard.statusOfflineHint')}
                {waiting > 0 &&
                  ` · ${t('offline.waitingCount', { count: waiting })}`}
              </p>
            </>
          )}
          {failed > 0 && (
            <Link
              to={posHref}
              className="font-medium text-red-700 hover:underline"
            >
              {t('dashboard.statusNeedsAttention', { count: failed })}
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
