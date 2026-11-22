// FoodX — hourly sales chart (Dashboard modernisation W2, design
// §3 row 5). Bars per local hour for today so far, bucketed
// client-side from the already-fetched today's orders by
// hourlySalesFromOrders — no query of its own, so the bars always
// sum to the headline "Today's sales" figure above them. Hours
// with no sales render as zero-height bars, never axis gaps.
// Money widget: the page renders it only for reports.view holders.
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatMoney } from '@/lib/money'
import { hourlySalesFromOrders } from '@/services/business'
import type { Order } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function HourlySalesCard({
  orders,
  currency,
  loading,
}: {
  orders: Order[]
  currency: string
  loading: boolean
}) {
  const { t, i18n } = useTranslation()
  const points = useMemo(() => hourlySalesFromOrders(orders), [orders])

  const formatHour = (hour: number): string => {
    const d = new Date()
    d.setHours(hour, 0, 0, 0)
    return new Intl.DateTimeFormat(i18n.language, {
      hour: 'numeric',
    }).format(d)
  }

  if (loading && orders.length === 0) {
    return (
      <Card aria-hidden="true">
        <CardHeader className="pb-2">
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent>
          <div className="h-56 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.hourlyTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('dashboard.hourlyEmpty')}
          </p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={points}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(hour: number) => formatHour(hour)}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value) => [
                    formatMoney(Number(value ?? 0), currency),
                    t('dashboard.todaySales'),
                  ]}
                  labelFormatter={(hour) => formatHour(Number(hour))}
                />
                <Bar dataKey="sales" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
