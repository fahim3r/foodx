// FoodX — Orders list (protected).
// Status filter + one card per order, linking to the order detail page.
// Table names come from the tables service (orders only carry table_id).
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useEasyMode } from '@/hooks/useEasyMode'
import { isMissingTableError } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { fetchOrders } from '@/services/orders'
import { elapsedChipClass, elapsedMinutes, useNow } from '@/lib/time'
import { fetchTables } from '@/services/tables'
import {
  TERMINAL_ORDER_STATUSES,
  type Order,
  type OrderSource,
  type OrderStatus,
  type OrderType,
} from '@/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'

const STATUSES: OrderStatus[] = [
  'DRAFT',
  'CONFIRMED',
  'SENT_TO_KITCHEN',
  'PREPARING',
  'READY',
  'SERVED',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
]

const STATUS_KEYS: Record<OrderStatus, string> = {
  DRAFT: 'orders.statusDraft',
  CONFIRMED: 'orders.statusConfirmed',
  SENT_TO_KITCHEN: 'orders.statusSentToKitchen',
  PREPARING: 'orders.statusPreparing',
  READY: 'orders.statusReady',
  SERVED: 'orders.statusServed',
  COMPLETED: 'orders.statusCompleted',
  CANCELLED: 'orders.statusCancelled',
  REFUNDED: 'orders.statusRefunded',
}

function ElapsedChip({
  createdAt,
  now,
}: {
  createdAt: string
  now: number
}) {
  const { t } = useTranslation()
  const minutes = elapsedMinutes(createdAt, now)
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${elapsedChipClass(minutes)}`}
    >
      {t('orders.elapsedMinutes', { minutes })}
    </span>
  )
}

export default function OrdersPage() {
  const { t } = useTranslation()
  const {
    restaurant,
    settings,
    loading: authLoading,
    dbPending,
  } = useAuth()
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ALL'>('ALL')
  const now = useNow()
  const [orders, setOrders] = useState<Order[]>([])
  const [tableNames, setTableNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [missingTables, setMissingTables] = useState(false)

  const currency =
    settings?.currency ?? restaurant?.default_currency ?? 'BDT'

  const statusLabel = (status: OrderStatus) => t(STATUS_KEYS[status])

  const typeLabel = (type: OrderType) =>
    type === 'dine_in'
      ? t('orders.dineIn')
      : type === 'takeaway'
        ? t('orders.takeaway')
        : type === 'pickup'
          ? t('orders.pickup')
          : t('orders.delivery')

  const { easy } = useEasyMode()
  const sourceLabel = (source: OrderSource) => t(`orders.source${source}`)

  const load = useCallback(async () => {
    if (!restaurant) return
    setLoading(true)
    setLoadError(false)
    setMissingTables(false)
    try {
      const [fetchedOrders, tables] = await Promise.all([
        fetchOrders(restaurant.id, { status: statusFilter }),
        fetchTables(restaurant.id),
      ])
      setOrders(fetchedOrders)
      const names: Record<string, string> = {}
      for (const table of tables) {
        names[table.id] = table.name
      }
      setTableNames(names)
    } catch (error) {
      // Logged for diagnosis — the UI only ever shows the friendly
      // message, never the raw error.
      console.error('[Orders] load failed', error)
      if (isMissingTableError(error)) {
        setMissingTables(true)
      } else {
        setLoadError(true)
      }
    } finally {
      setLoading(false)
    }
  }, [restaurant, statusFilter])

  useEffect(() => {
    if (authLoading) return
    if (!restaurant) {
      setLoading(false)
      return
    }
    void load()
  }, [authLoading, restaurant, load])

  if (authLoading || loading) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  if (dbPending || missingTables) {
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

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('common.error')}</CardTitle>
          <CardDescription>{t('orders.loadFailed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void load()}>{t('common.retry')}</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-bold tracking-tight">
          {t('orders.title')}
        </h2>
        <p className="text-muted-foreground">{t('orders.subtitle')}</p>
      </header>

      <div className="flex flex-col gap-2">
        <Label htmlFor="statusFilter">{t('orders.filterStatus')}</Label>
        <select
          id="statusFilter"
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as OrderStatus | 'ALL')
          }
          className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        >
          <option value="ALL">{t('orders.filterAll')}</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent>
            <p className="text-muted-foreground">
              {statusFilter === 'ALL'
                ? t('orders.noOrders')
                : t('orders.noOrdersForStatus')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {orders.map((order) => (
            <Link key={order.id} to={`/orders/${order.id}`} className="block">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle>
                    {t('orders.orderNumber', { number: order.order_number })}
                    {order.token_number != null && (
                      <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 align-middle text-xs font-semibold text-orange-700">
                        {t('orders.token', { number: order.token_number })}
                      </span>
                    )}
                  </CardTitle>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {statusLabel(order.status)}
                  </span>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span>{typeLabel(order.type)}</span>
                  {!easy && (
                    <span className="text-muted-foreground">
                      {t('orders.source')}: {sourceLabel(order.source)}
                    </span>
                  )}
                  {order.table_id && (
                    <span>
                      {t('orders.table')}{' '}
                      {tableNames[order.table_id] ??
                        order.table_id.slice(0, 8)}
                    </span>
                  )}
                  <span className="font-semibold">
                    {formatMoney(order.total_amount, currency)}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(order.created_at).toLocaleString()}
                  </span>
                  {!TERMINAL_ORDER_STATUSES.includes(order.status) && (
                    <ElapsedChip createdAt={order.created_at} now={now} />
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
