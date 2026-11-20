// FoodX — Kitchen Display (KDS) page (protected).
// Shows live kitchen orders grouped by kitchen station, oldest first.
// Live updates come from a Supabase Realtime subscription (best-effort);
// a 30s poll is the safety net, plus a manual Refresh button. READY
// orders show no action here — the Orders page marks them served.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import EasyHelpLine from '@/components/EasyHelpLine'
import { useAuth } from '@/hooks/useAuth'
import { isMissingTableError } from '@/lib/errors'
import { elapsedMinutes } from '@/lib/time'
import {
  advanceKitchenStatus,
  fetchKitchenOrders,
  subscribeKitchenOrders,
} from '@/services/kds'
import { fetchTables } from '@/services/tables'
import type { KitchenStationGroup, Order } from '@/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const POLL_MS = 30_000

export default function KdsPage() {
  const { t } = useTranslation()
  const { user, restaurant, loading: authLoading, dbPending } = useAuth()
  const [groups, setGroups] = useState<KitchenStationGroup[]>([])
  const [tableNames, setTableNames] = useState<Map<string, string>>(new Map())
  const [now, setNow] = useState(() => Date.now())
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<'missing' | 'failed' | null>(null)
  const [updateError, setUpdateError] = useState(false)
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refetch = useCallback(async () => {
    if (!restaurant) return
    try {
      const [kitchenGroups, tables] = await Promise.all([
        fetchKitchenOrders(restaurant.id),
        fetchTables(restaurant.id),
      ])
      if (!mountedRef.current) return
      setGroups(kitchenGroups)
      setTableNames(new Map(tables.map((table) => [table.id, table.name])))
      setNow(Date.now())
      setLoadError(null)
    } catch (error) {
      // Logged for diagnosis (visible in the browser console) — the UI
      // only ever shows the friendly message, never the raw error.
      console.error('[KDS] load failed', error)
      if (!mountedRef.current) return
      setLoadError(isMissingTableError(error) ? 'missing' : 'failed')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [restaurant])

  // Initial load + Realtime subscription + 30s poll safety net.
  useEffect(() => {
    if (!restaurant) {
      setLoading(false)
      return
    }
    setLoading(true)
    void refetch()
    const unsubscribe = subscribeKitchenOrders(() => {
      void refetch()
    })
    const timer = window.setInterval(() => {
      void refetch()
    }, POLL_MS)
    return () => {
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [restaurant, refetch])

  const handleAdvance = async (
    order: Order,
    toStatus: 'PREPARING' | 'READY',
  ) => {
    if (!user) return
    setUpdateError(false)
    setUpdatingOrderId(order.id)
    try {
      await advanceKitchenStatus(order, toStatus, user.id)
      await refetch()
    } catch (error) {
      console.error('[KDS] update failed', error)
      setUpdateError(true)
    } finally {
      setUpdatingOrderId(null)
    }
  }

  if (authLoading || loading) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  if (dbPending || loadError === 'missing') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('layout.dbPendingTitle')}</CardTitle>
          <CardDescription>{t('layout.dbPendingBody')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!restaurant) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('layout.noProfileTitle')}</CardTitle>
          <CardDescription>{t('layout.noProfileBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/settings">{t('layout.goToSettings')}</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (loadError === 'failed' && groups.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('common.error')}</CardTitle>
          <CardDescription>{t('kds.loadFailed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => {
              setLoading(true)
              void refetch()
            }}
          >
            {t('common.retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('kds.title')}</h2>
          <p className="text-muted-foreground">{t('kds.subtitle')}</p>
          <EasyHelpLine labelKey="easy.help.kds" />
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900">
            <span className="size-2 rounded-full bg-emerald-500" />
            {t('kds.live')}
          </span>
          <Button variant="outline" onClick={() => void refetch()}>
            {t('kds.refresh')}
          </Button>
        </div>
      </header>

      {updateError && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t('kds.updateFailed')}
        </p>
      )}
      {loadError === 'failed' && groups.length > 0 && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t('kds.loadFailed')}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="text-muted-foreground">{t('kds.noOrders')}</p>
      ) : (
        groups.map((group) => (
          <section
            key={group.stationId ?? 'unassigned'}
            className="flex flex-col gap-4"
          >
            <h3 className="text-lg font-semibold">
              {group.stationName ?? t('kds.unassigned')}
            </h3>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.orders.map(({ order, items }) => {
                const typeLabel =
                  order.type === 'dine_in'
                    ? t('kds.dineIn')
                    : order.type === 'takeaway'
                      ? t('kds.takeaway')
                      : order.type === 'pickup'
                        ? t('kds.pickup')
                        : t('kds.delivery')
                const tableName = order.table_id
                  ? tableNames.get(order.table_id)
                  : undefined
                const meta = [typeLabel]
                if (tableName) meta.push(t('kds.table', { name: tableName }))
                meta.push(
                  t('kds.waiting', {
                    minutes: elapsedMinutes(order.created_at, now),
                  }),
                )
                meta.push(t('kds.itemCount', { count: items.length }))
                return (
                  <Card key={order.id}>
                    <CardHeader>
                      <CardTitle>
                        {t('kds.orderNumber', { number: order.order_number })}
                        {order.token_number != null && (
                          <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 align-middle text-xs font-semibold text-orange-700">
                            {t('orders.token', {
                              number: order.token_number,
                            })}
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription>{meta.join(' · ')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="flex flex-col gap-2">
                        {items.map((item) => (
                          <li key={item.id}>
                            <p className="text-sm font-medium">
                              {item.quantity} × {item.product_name}
                              {item.variant_name
                                ? ` (${item.variant_name})`
                                : ''}
                            </p>
                            {item.modifiers.map((modifier) => (
                              <p
                                key={modifier.id}
                                className="pl-4 text-sm text-muted-foreground"
                              >
                                + {modifier.modifier_name}
                              </p>
                            ))}
                            {item.note && (
                              <p className="pl-4 text-sm font-semibold text-amber-700">
                                {item.note}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                    {order.status === 'SENT_TO_KITCHEN' && (
                      <CardFooter>
                        <Button
                          onClick={() =>
                            void handleAdvance(order, 'PREPARING')
                          }
                          disabled={updatingOrderId === order.id}
                        >
                          {t('kds.startPreparing')}
                        </Button>
                      </CardFooter>
                    )}
                    {order.status === 'PREPARING' && (
                      <CardFooter>
                        <Button
                          onClick={() => void handleAdvance(order, 'READY')}
                          disabled={updatingOrderId === order.id}
                        >
                          {t('kds.markReady')}
                        </Button>
                      </CardFooter>
                    )}
                  </Card>
                )
              })}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
