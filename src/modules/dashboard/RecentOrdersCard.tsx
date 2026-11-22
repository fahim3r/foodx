// FoodX — recent orders (Dashboard modernisation W2, design §3
// row 7). The latest 8 orders (any day, newest first) from
// fetchOrders; a row click opens the order detail. Visible to
// every role — the totals in the rows are the same figures the
// Orders page already shows these roles (design §7), so nothing
// new is exposed. Open orders carry a ticking elapsed chip, the
// Orders page idiom; table / customer labels match that page too.
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { formatMoney } from '@/lib/money'
import { elapsedChipClass, elapsedMinutes, useNow } from '@/lib/time'
import {
  TERMINAL_ORDER_STATUSES,
  type Order,
  type OrderStatus,
  type OrderType,
} from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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

const STATUS_TONES: Record<OrderStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  CONFIRMED: 'bg-sky-100 text-sky-800',
  SENT_TO_KITCHEN: 'bg-amber-100 text-amber-800',
  PREPARING: 'bg-amber-100 text-amber-800',
  READY: 'bg-emerald-100 text-emerald-800',
  SERVED: 'bg-emerald-100 text-emerald-800',
  COMPLETED: 'bg-muted text-muted-foreground',
  CANCELLED: 'bg-red-100 text-red-800',
  REFUNDED: 'bg-red-100 text-red-800',
}

export default function RecentOrdersCard({
  orders,
  tableNames,
  currency,
  loading,
  navTo,
}: {
  orders: Order[] | null
  tableNames: Record<string, string>
  currency: string
  loading: boolean
  navTo: (to: string) => string
}) {
  const { t } = useTranslation()
  const now = useNow()

  const typeLabel = (type: OrderType) =>
    type === 'dine_in'
      ? t('orders.dineIn')
      : type === 'takeaway'
        ? t('orders.takeaway')
        : type === 'pickup'
          ? t('orders.pickup')
          : t('orders.delivery')

  if (loading && orders === null) {
    return (
      <Card aria-hidden="true">
        <CardHeader className="pb-2">
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="h-10 animate-pulse rounded bg-muted" />
          ))}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.recentTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {!orders || orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('orders.noOrders')}
          </p>
        ) : (
          <div className="divide-y">
            {orders.map((order) => {
              const minutes = elapsedMinutes(order.created_at, now)
              const open = !TERMINAL_ORDER_STATUSES.includes(order.status)
              const place = order.table_id
                ? `${t('orders.table')} ${tableNames[order.table_id] ?? order.table_id.slice(0, 8)}`
                : order.customer_name
              return (
                <Link
                  key={order.id}
                  to={navTo(`/orders/${order.id}`)}
                  className="-mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors hover:bg-accent"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {t('orders.orderNumber', {
                        number: order.order_number,
                      })}
                      <span className="font-normal text-muted-foreground">
                        {' · '}
                        {typeLabel(order.type)}
                        {place ? ` · ${place}` : ''}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(order.created_at).toLocaleString()}
                      {open && (
                        <span
                          className={`ml-2 rounded-full px-2 py-0.5 font-medium ${elapsedChipClass(minutes)}`}
                        >
                          {t('orders.elapsedMinutes', { minutes })}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold">
                      {formatMoney(order.total_amount, currency)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONES[order.status]}`}
                    >
                      {t(STATUS_KEYS[order.status])}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
