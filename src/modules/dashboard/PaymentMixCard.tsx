// FoodX — payment mix donut (Dashboard modernisation W2, design
// §3 row 5). Replaces the W1-era breakdown list: a Recharts donut
// of today's payments by method, with the per-method list under it
// (method · count · amount · share %). Shares are composed
// client-side from fetchPaymentBreakdown — the same source the
// list used, so the figures still match Reports exactly. Money
// widget: the page renders it only for reports.view holders, and
// only once the Phase 7 inputs have loaded (the page's gate).
import { useTranslation } from 'react-i18next'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { formatMoney, roundMoney } from '@/lib/money'
import type { PaymentBreakdownRow } from '@/services/business'
import type { PaymentMethod } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const METHOD_COLORS: Record<PaymentMethod, string> = {
  cash: '#0ea5e9',
  card: '#8b5cf6',
  bkash: '#e2136e',
  nagad: '#f97316',
  bank: '#10b981',
  due: '#f59e0b',
}

export default function PaymentMixCard({
  payments,
  currency,
}: {
  payments: PaymentBreakdownRow[]
  currency: string
}) {
  const { t } = useTranslation()
  const total = roundMoney(payments.reduce((sum, row) => sum + row.amount, 0))
  const methodLabel = (method: PaymentMethod) =>
    t(`pos.method${method.charAt(0).toUpperCase()}${method.slice(1)}`)
  const slices = payments.map((row) => ({
    ...row,
    name: methodLabel(row.method),
    share: total > 0 ? Math.round((row.amount / total) * 100) : 0,
  }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.paymentBreakdown')}</CardTitle>
      </CardHeader>
      <CardContent>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('dashboard.noPaymentsYet')}
          </p>
        ) : (
          <>
            <div className="relative h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip
                    formatter={(value, name) => [
                      formatMoney(Number(value ?? 0), currency),
                      name,
                    ]}
                  />
                  <Pie
                    data={slices}
                    dataKey="amount"
                    nameKey="name"
                    innerRadius="65%"
                    outerRadius="90%"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {slices.map((slice) => (
                      <Cell
                        key={slice.method}
                        fill={METHOD_COLORS[slice.method]}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="text-lg font-bold">
                  {formatMoney(total, currency)}
                </p>
              </div>
            </div>
            <div className="mt-2 divide-y">
              {slices.map((row) => (
                <div
                  key={row.method}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block size-2.5 rounded-full"
                      style={{ backgroundColor: METHOD_COLORS[row.method] }}
                    />
                    {row.name}
                    {' · '}
                    {row.count}
                  </span>
                  <span className="font-medium">
                    {formatMoney(row.amount, currency)}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {row.share}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
