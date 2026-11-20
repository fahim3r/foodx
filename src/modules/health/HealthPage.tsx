import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { supabase } from '@/lib/supabase'
import { APP_VERSION } from '@/lib/version'
import { loadPosCache } from '@/services/catalogCache'
import {
  compareVersions,
  readLicenseCache,
  runHeartbeat,
} from '@/services/heartbeat'
import {
  loadQueue,
  queueCounts,
  OFFLINE_QUEUE_UPDATED_EVENT,
  type QueuedOrder,
} from '@/services/offlineQueue'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function readWorkspaceSavedAt(userId: string): string | null {
  try {
    const raw = localStorage.getItem(`foodx.workspace_cache.${userId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { savedAt?: unknown }
    return typeof parsed.savedAt === 'string' ? parsed.savedAt : null
  } catch {
    return null
  }
}

function daysUntil(dateIso: string): number {
  const ms = new Date(dateIso).getTime() - Date.now()
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}

/**
 * System health (§67, modifications v2 item 3): one read-only page
 * composing the signals the app already has — connectivity, the
 * offline queue, the license cache, this device's caches/storage,
 * and an honest backup card (backup status is vendor-side only;
 * the client cannot see it, so the page says exactly that — §82).
 */
export default function HealthPage() {
  const { t } = useTranslation()
  const { user, restaurant } = useAuth()
  const online = useOnlineStatus()
  const [tick, setTick] = useState(0)
  const [checking, setChecking] = useState(false)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(
    null,
  )
  const [counts, setCounts] = useState<{ branches: number | null; users: number | null }>(
    { branches: null, users: null },
  )

  useEffect(() => {
    let cancelled = false
    if (navigator.storage?.estimate) {
      navigator.storage
        .estimate()
        .then((est) => {
          if (!cancelled && typeof est.usage === 'number') {
            setStorage({ usage: est.usage, quota: est.quota ?? 0 })
          }
        })
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [])

  // Branches / users in use (audit wave 3): counted locally from
  // this restaurant's own rows — plain row reads whose length is
  // the count, with the PostgREST error checked explicitly. (The
  // earlier head-count version read the count header off the
  // response and silently stayed on "—" whenever that came back
  // empty.) The registry is never called for this; the max side
  // comes from the cached license limits below.
  useEffect(() => {
    let cancelled = false
    if (!restaurant) return
    void (async () => {
      const [branches, users] = await Promise.allSettled([
        supabase
          .from('branches')
          .select('id')
          .eq('restaurant_id', restaurant.id),
        supabase
          .from('profiles')
          .select('id')
          .eq('restaurant_id', restaurant.id),
      ])
      if (cancelled) return
      const rowCount = (
        result: PromiseSettledResult<{ data: unknown[] | null; error: unknown }>,
      ): number | null => {
        if (result.status !== 'fulfilled') return null
        if (result.value.error) {
          console.error('[Health] in-use count failed', result.value.error)
          return null
        }
        return (result.value.data ?? []).length
      }
      setCounts({
        branches: rowCount(branches),
        users: rowCount(users),
      })
    })()
    return () => {
      cancelled = true
    }
  }, [restaurant, tick])

  const cache = readLicenseCache()
  const queue: QueuedOrder[] = restaurant ? loadQueue(restaurant.id) : []
  const qc = queueCounts(queue)
  const failed = queue.filter((entry) => entry.status === 'failed')
  const posCache = restaurant ? loadPosCache(restaurant.id) : null
  const workspaceSavedAt = user ? readWorkspaceSavedAt(user.id) : null
  const license = cache?.license ?? null
  const updatePending =
    cache?.latest_release != null &&
    compareVersions(cache.latest_release.version, APP_VERSION) > 0
  const standalone =
    typeof window !== 'undefined' &&
    window.matchMedia('(display-mode: standalone)').matches

  const handleCheckNow = useCallback(async () => {
    setChecking(true)
    try {
      await runHeartbeat()
    } finally {
      setChecking(false)
      setTick((value) => value + 1)
    }
  }, [])

  const statusLine = (ok: boolean) => (
    <span
      className={
        ok
          ? 'font-medium text-emerald-600 dark:text-emerald-400'
          : 'font-medium text-amber-600 dark:text-amber-400'
      }
    >
      {ok ? t('health.ok') : t('health.attention')}
    </span>
  )

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Activity className="size-6" />
          {t('health.title')}
        </h2>
        <p className="text-muted-foreground">{t('health.subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            {t('health.connection')}
            {statusLine(online)}
          </CardTitle>
          <CardDescription>
            {online ? t('health.online') : t('health.offline')}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t('health.lastCheck')}:{' '}
          {cache
            ? new Date(cache.fetched_at).toLocaleString()
            : t('health.never')}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            {t('health.queue')}
            {statusLine(qc.failed === 0)}
          </CardTitle>
          <CardDescription>
            {t('health.queueWaiting', { count: qc.waiting })} ·{' '}
            {t('health.queueFailed', { count: qc.failed })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {qc.waiting + qc.failed === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('health.queueEmpty')}
            </p>
          )}
          {failed.length > 0 && (
            <ul className="space-y-2">
              {failed.map((entry) => (
                <li key={entry.id} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">
                    {entry.id.slice(0, 8).toUpperCase()} ·{' '}
                    {new Date(entry.queuedAt).toLocaleString()}
                  </p>
                  <p className="text-destructive">
                    {entry.failureReason
                      ? t(`offline.fail_${entry.failureReason}`, {
                          defaultValue: t('offline.failedSync'),
                        })
                      : t('offline.failedSync')}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {(qc.waiting > 0 || qc.failed > 0) && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                window.dispatchEvent(new Event(OFFLINE_QUEUE_UPDATED_EVENT))
              }
            >
              <RefreshCw className="size-4" />
              {t('health.retryNow')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            {t('health.license')}
            {statusLine(
              cache != null &&
                cache.client_status === 'ACTIVE' &&
                license?.status === 'ACTIVE',
            )}
          </CardTitle>
          <CardDescription>
            {cache && license
              ? `${license.status} · ${license.plan}`
              : t('health.never')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          {license?.expiry_date ? (
            <p>
              {t('health.licenseExpires')}:{' '}
              {new Date(license.expiry_date).toLocaleDateString()} (
              {t('health.daysLeft', {
                count: daysUntil(license.expiry_date),
              })}
              )
            </p>
          ) : (
            license && <p>{t('health.licenseLifetime')}</p>
          )}
          <p>
            {t('health.branchesUse')}: {counts.branches ?? '—'} /{' '}
            {cache?.limits?.max_branches ?? t('health.unlimited')}
          </p>
          <p>
            {t('health.usersUse')}: {counts.users ?? '—'} /{' '}
            {cache?.limits?.max_users ?? t('health.unlimited')}
          </p>
          <p>
            {updatePending
              ? t('health.updatePending', {
                  version: cache?.latest_release?.version ?? '',
                })
              : t('health.updateNone')}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleCheckNow()}
            disabled={checking}
          >
            <RefreshCw className="size-4" />
            {checking ? t('common.loading') : t('health.checkNow')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('health.device')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>
            {t('health.version')}: {APP_VERSION}
          </p>
          <p>
            {t('health.storage')}:{' '}
            {storage
              ? `${formatBytes(storage.usage)} / ${formatBytes(storage.quota)}`
              : t('health.storageUnknown')}
          </p>
          <p>
            {t('health.menuCache')}:{' '}
            {posCache
              ? new Date(posCache.savedAt).toLocaleString()
              : t('health.menuCacheNone')}
          </p>
          <p>
            {t('health.workspaceCache')}:{' '}
            {workspaceSavedAt
              ? new Date(workspaceSavedAt).toLocaleString()
              : t('health.menuCacheNone')}
          </p>
          <p>
            {t('health.displayMode')}:{' '}
            {standalone ? t('health.standalone') : t('health.browser')}
          </p>
          <p className="break-all">
            {t('health.userAgent')}: {navigator.userAgent}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('health.backup')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('health.backupBody')}</p>
        </CardContent>
      </Card>
    </div>
  )
}
