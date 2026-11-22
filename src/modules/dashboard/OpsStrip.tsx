// FoodX — live operations strip (Dashboard modernisation W1,
// design §3 row 4). One slim full-width card of count buckets, each
// a link to its page. Counts only — no money — so every role sees
// it. Counts come from fetchOpenOrderCounts (status-only, not
// day-bound) plus the tables read; a bucket whose source has not
// loaded (or failed) shows "—", never a 0 presented as fact. The
// delivery bucket renders only when the caller says the delivery
// module + vendor flag are on.
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { OpenOrderCounts } from '@/services/orders'
import { Card, CardContent } from '@/components/ui/card'

export default function OpsStrip({
  counts,
  occupiedTables,
  totalTables,
  tablesKnown,
  deliveryOn,
  navTo,
}: {
  counts: OpenOrderCounts | null
  occupiedTables: number
  totalTables: number
  tablesKnown: boolean
  deliveryOn: boolean
  navTo: (to: string) => string
}) {
  const { t } = useTranslation()

  const buckets: {
    key: string
    label: string
    value: string
    to: string
  }[] = [
    {
      key: 'new',
      label: t('dashboard.opsNew'),
      value: counts ? String(counts.newOrders) : '—',
      to: '/orders',
    },
    {
      key: 'kitchen',
      label: t('dashboard.opsInKitchen'),
      value: counts ? String(counts.inKitchen) : '—',
      to: '/kds',
    },
    {
      key: 'ready',
      label: t('dashboard.opsReady'),
      value: counts ? String(counts.ready) : '—',
      to: '/serve',
    },
    {
      key: 'served',
      label: t('dashboard.opsServed'),
      value: counts ? String(counts.served) : '—',
      to: '/orders',
    },
    {
      key: 'tables',
      label: t('dashboard.opsTables'),
      value: tablesKnown ? `${occupiedTables}/${totalTables}` : '—',
      to: '/tables',
    },
    ...(deliveryOn
      ? [
          {
            key: 'delivery',
            label: t('dashboard.opsDelivery'),
            value: counts ? String(counts.delivery) : '—',
            to: '/delivery',
          },
        ]
      : []),
  ]

  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-sm font-medium text-muted-foreground">
          {t('dashboard.opsTitle')}
        </p>
        <div
          className={`mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 ${deliveryOn ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}
        >
          {buckets.map((bucket) => (
            <Link
              key={bucket.key}
              to={navTo(bucket.to)}
              className="rounded-lg bg-muted/50 px-3 py-2 transition-colors hover:bg-accent"
            >
              <p className="text-2xl font-bold">{bucket.value}</p>
              <p className="text-sm text-muted-foreground">{bucket.label}</p>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
