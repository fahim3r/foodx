import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import EasyHelpLine from '@/components/EasyHelpLine'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fetchServeBoard, markOrderServed } from '@/services/orders'
import { fetchTables } from '@/services/tables'
import { subscribeKitchenOrders } from '@/services/kds'
import { elapsedMinutes, useNow } from '@/lib/time'
import type { DiningTable, Order } from '@/types'

/** The restaurant-local calendar day (YYYY-MM-DD) — the token day. */
function localToday(timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone ?? undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/**
 * To Serve board (roadmap gap 2): the counter screen the RestoraPOS
 * study showed. The kitchen stops at READY; this board is where
 * READY orders wait to be called out and handed over — token orders
 * by their token, dine-in orders (which have no token) by table.
 * Serving reuses the existing READY → SERVED transition. The board
 * is read-mostly and refreshes on a poll + the orders realtime
 * channel, so it can sit open on a counter tablet all day.
 */
export default function ServePage() {
  const { t } = useTranslation()
  const { user, restaurant } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [tables, setTables] = useState<DiningTable[]>([])
  const [loading, setLoading] = useState(true)
  const [servingId, setServingId] = useState<string | null>(null)
  const now = useNow()

  const load = useCallback(async () => {
    if (!restaurant) return
    try {
      const rows = await fetchServeBoard(
        restaurant.id,
        localToday(restaurant.timezone),
      )
      setOrders(rows)
    } catch {
      // Keep the last board on a transient failure — the next poll
      // or realtime event refreshes it.
    } finally {
      setLoading(false)
    }
  }, [restaurant])

  useEffect(() => {
    void load()
  }, [load])

  // Table names label the dine-in cards (audit wave 3): names only,
  // so a failure here never takes the board down with it.
  useEffect(() => {
    if (!restaurant) return
    let cancelled = false
    void (async () => {
      try {
        const rows = await fetchTables(restaurant.id)
        if (!cancelled) setTables(rows)
      } catch {
        // Keep the names already shown; the next mount retries.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [restaurant])

  const tableNameFor = (order: Order): string | null =>
    order.table_id
      ? (tables.find((table) => table.id === order.table_id)?.name ?? null)
      : null

  useEffect(() => {
    const id = window.setInterval(() => void load(), 15000)
    return () => window.clearInterval(id)
  }, [load])

  useEffect(() => subscribeKitchenOrders(() => void load()), [load])

  const handleServe = async (order: Order) => {
    if (!user) return
    setServingId(order.id)
    try {
      await markOrderServed(order, user.id)
      await load()
    } catch {
      // The board refresh shows the true state.
    } finally {
      setServingId(null)
    }
  }

  const ready = orders.filter((o) => o.status === 'READY')
  const served = orders
    .filter((o) => o.status === 'SERVED')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 12)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('serve.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('serve.subtitle')}</p>
        <EasyHelpLine labelKey="easy.help.serve" />
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle>{t('serve.readyTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {ready.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('serve.emptyReady')}
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {ready.map((order) => (
                    <div
                      key={order.id}
                      className="flex flex-col items-center gap-2 rounded-lg border-2 border-orange-500 bg-orange-50 p-4 text-center dark:bg-orange-950"
                    >
                      {order.token_number != null ? (
                        <>
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {t('orders.token', {
                              number: order.token_number,
                            })}
                          </span>
                          <span className="text-5xl font-bold tabular-nums">
                            {order.token_number}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {t('orders.table')}
                          </span>
                          <span className="text-5xl font-bold">
                            {tableNameFor(order) ?? '—'}
                          </span>
                        </>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {t('serve.orderRef', {
                          number: order.order_number,
                        })}{' '}
                        ·{' '}
                        {t('serve.readyFor', {
                          minutes: elapsedMinutes(order.updated_at, now),
                        })}
                      </span>
                      <Button
                        type="button"
                        className="mt-1 w-full"
                        disabled={servingId === order.id}
                        onClick={() => void handleServe(order)}
                      >
                        {t('serve.serveButton')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('serve.servedTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {served.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('serve.emptyServed')}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {served.map((order) => (
                    <li
                      key={order.id}
                      className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm"
                    >
                      <span className="font-semibold tabular-nums">
                        {order.token_number != null
                          ? t('orders.token', {
                              number: order.token_number,
                            })
                          : (tableNameFor(order) ?? t('orders.table'))}
                      </span>
                      <span className="text-muted-foreground">
                        {t('serve.orderRef', {
                          number: order.order_number,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
