// FoodX — Reports + Profit & Loss panels (Phase 7).
// Read-only views over orders / order_payments / purchase_orders /
// expenses, computed by src/services/business.ts. CSV export is a
// real client-side download of exactly the rows on screen.
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  fetchCategorySales,
  fetchDailySalesSeries,
  fetchDeliverySummary,
  fetchExpenseByCategory,
  fetchPaymentBreakdown,
  fetchProductSales,
  fetchProfitLoss,
  fetchSupplierPayables,
  makeRange,
  toDateString,
  type CategorySalesRow,
  type DailySalesPoint,
  type DeliverySummary,
  type ExpenseByCategoryRow,
  type PaymentBreakdownRow,
  type ProductSalesRow,
  type ProfitLoss,
  type ReportRange,
  type SupplierPayableRow,
} from '@/services/business'
import type { PaymentMethod } from '@/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom'

const PRESETS: Preset[] = ['today', 'yesterday', 'week', 'month', 'custom']

function presetRange(preset: Preset): { from: string; to: string } {
  const today = new Date()
  const shift = (d: Date, days: number) => {
    const copy = new Date(d)
    copy.setDate(copy.getDate() + days)
    return copy
  }
  switch (preset) {
    case 'yesterday':
      return {
        from: toDateString(shift(today, -1)),
        to: toDateString(shift(today, -1)),
      }
    case 'week':
      return { from: toDateString(shift(today, -6)), to: toDateString(today) }
    case 'month':
      return {
        from: toDateString(new Date(today.getFullYear(), today.getMonth(), 1)),
        to: toDateString(today),
      }
    default:
      return { from: toDateString(today), to: toDateString(today) }
  }
}

function useReportRange() {
  const [preset, setPreset] = useState<Preset>('today')
  const [customFrom, setCustomFrom] = useState(toDateString(new Date()))
  const [customTo, setCustomTo] = useState(toDateString(new Date()))
  const range: ReportRange = useMemo(() => {
    if (preset === 'custom') return makeRange(customFrom, customTo)
    const { from, to } = presetRange(preset)
    return makeRange(from, to)
  }, [preset, customFrom, customTo])
  return { preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo, range }
}

type RangeState = ReturnType<typeof useReportRange>

function RangePicker({ state }: { state: RangeState }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-end gap-2">
      {PRESETS.map((p) => (
        <Button
          key={p}
          type="button"
          size="sm"
          variant={state.preset === p ? 'default' : 'outline'}
          onClick={() => state.setPreset(p)}
        >
          {t(`reports.preset_${p}`)}
        </Button>
      ))}
      {state.preset === 'custom' && (
        <>
          <div className="space-y-1">
            <Label>{t('reports.from')}</Label>
            <Input
              type="date"
              value={state.customFrom}
              onChange={(e) => state.setCustomFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('reports.to')}</Label>
            <Input
              type="date"
              value={state.customTo}
              onChange={(e) => state.setCustomTo(e.target.value)}
            />
          </div>
        </>
      )}
    </div>
  )
}

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
  const csv = [header, ...rows]
    .map((row) => row.map(escape).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function methodLabel(t: (key: string) => string, method: PaymentMethod): string {
  return t(`pos.method${method.charAt(0).toUpperCase()}${method.slice(1)}`)
}

// ---------------------------------------------------------------------------
// Reports tab
// ---------------------------------------------------------------------------

export default function ReportsPanel({
  restaurantId,
  currency,
}: {
  restaurantId: string
  currency: string
}) {
  const { t } = useTranslation()
  const rangeState = useReportRange()
  const { range } = rangeState
  const [series, setSeries] = useState<DailySalesPoint[]>([])
  const [products, setProducts] = useState<ProductSalesRow[]>([])
  const [categories, setCategories] = useState<CategorySalesRow[]>([])
  const [payments, setPayments] = useState<PaymentBreakdownRow[]>([])
  const [delivery, setDelivery] = useState<DeliverySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const [s, p, c, pay, d] = await Promise.all([
        fetchDailySalesSeries(restaurantId, range),
        fetchProductSales(restaurantId, range),
        fetchCategorySales(restaurantId, range),
        fetchPaymentBreakdown(restaurantId, range),
        fetchDeliverySummary(restaurantId, range),
      ])
      setSeries(s)
      setProducts(p)
      setCategories(c)
      setPayments(pay)
      setDelivery(d)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [restaurantId, range])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <RangePicker state={rangeState} />
      {loading ? (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      ) : failed ? (
        <p className="text-sm text-destructive">{t('business.loadError')}</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('reports.salesChart')}</CardTitle>
              <CardDescription>
                {range.fromDate} → {range.toDate}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value) => [
                        formatMoney(Number(value ?? 0), currency),
                        t('reports.colAmount'),
                      ]}
                    />
                    <Bar dataKey="sales" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <ReportTable
              title={t('reports.productSales')}
              exportName="product-sales"
              header={[t('reports.colProduct'), t('reports.colQty'), t('reports.colAmount')]}
              rows={products.map((p) => [
                p.name,
                String(p.quantity),
                formatMoney(p.amount, currency),
              ])}
              empty={products.length === 0}
            />
            <ReportTable
              title={t('reports.categorySales')}
              exportName="category-sales"
              header={[t('reports.colCategory'), t('reports.colQty'), t('reports.colAmount')]}
              rows={categories.map((c) => [
                c.name,
                String(c.quantity),
                formatMoney(c.amount, currency),
              ])}
              empty={categories.length === 0}
            />
            <ReportTable
              title={t('reports.paymentBreakdown')}
              exportName="payment-breakdown"
              header={[t('reports.colMethod'), t('reports.colCount'), t('reports.colAmount')]}
              rows={payments.map((p) => [
                methodLabel(t, p.method),
                String(p.count),
                formatMoney(p.amount, currency),
              ])}
              empty={payments.length === 0}
            />
            <Card>
              <CardHeader>
                <CardTitle>{t('reports.deliverySummary')}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">
                    {t('reports.deliveryOrders')}
                  </p>
                  <p className="text-lg font-semibold">{delivery?.orders ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">
                    {t('reports.deliveryCompleted')}
                  </p>
                  <p className="text-lg font-semibold">
                    {delivery?.completed ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">
                    {t('reports.deliveryFees')}
                  </p>
                  <p className="text-lg font-semibold">
                    {formatMoney(delivery?.fees ?? 0, currency)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">
                    {t('reports.codCollected')}
                  </p>
                  <p className="text-lg font-semibold">
                    {formatMoney(delivery?.codTotal ?? 0, currency)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function ReportTable({
  title,
  exportName,
  header,
  rows,
  empty,
}: {
  title: string
  exportName: string
  header: string[]
  rows: string[][]
  empty: boolean
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {!empty && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => downloadCsv(`${exportName}.csv`, header, rows)}
          >
            {t('reports.exportCsv')}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="text-sm text-muted-foreground">{t('reports.noData')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {header.map((h) => (
                  <th key={h} className="py-2 pr-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b last:border-0">
                  {row.map((cell, j) => (
                    <td key={j} className="py-2 pr-2">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Profit & Loss tab
// ---------------------------------------------------------------------------

export function ProfitLossPanel({
  restaurantId,
  currency,
}: {
  restaurantId: string
  currency: string
}) {
  const { t } = useTranslation()
  const rangeState = useReportRange()
  const { range } = rangeState
  const [pl, setPl] = useState<ProfitLoss | null>(null)
  const [expenseRows, setExpenseRows] = useState<ExpenseByCategoryRow[]>([])
  const [payables, setPayables] = useState<SupplierPayableRow[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const [plData, exp, pay] = await Promise.all([
        fetchProfitLoss(restaurantId, range),
        fetchExpenseByCategory(restaurantId, range),
        fetchSupplierPayables(restaurantId),
      ])
      setPl(plData)
      setExpenseRows(exp)
      setPayables(pay)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [restaurantId, range])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <RangePicker state={rangeState} />
      {loading ? (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      ) : failed || !pl ? (
        <p className="text-sm text-destructive">{t('business.loadError')}</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('reports.plTitle')}</CardTitle>
              <CardDescription>
                {range.fromDate} → {range.toDate} · {t('reports.plOrders')}:{' '}
                {pl.ordersCount}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <PlLine
                label={t('reports.plSales')}
                value={formatMoney(pl.sales, currency)}
              />
              <PlLine
                label={`− ${t('reports.plPurchases')}`}
                value={formatMoney(pl.purchases, currency)}
              />
              <PlLine
                label={`− ${t('reports.plExpenses')}`}
                value={formatMoney(pl.expenses, currency)}
              />
              <PlLine
                label={`− ${t('reports.plRefunds')}`}
                value={formatMoney(pl.refunds, currency)}
              />
              <div className="flex items-center justify-between border-t pt-3 text-base font-semibold">
                <span>{t('reports.plProfit')}</span>
                <span>{formatMoney(pl.profit, currency)}</span>
              </div>
              <p className="pt-2 text-xs text-muted-foreground">
                {t('reports.plNote')}
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <ReportTable
              title={t('reports.expenseByCategory')}
              exportName="expenses-by-category"
              header={[t('reports.colCategory'), t('reports.colCount'), t('reports.colAmount')]}
              rows={expenseRows.map((r) => [
                r.name,
                String(r.count),
                formatMoney(r.amount, currency),
              ])}
              empty={expenseRows.length === 0}
            />
            <ReportTable
              title={t('reports.payablesTitle')}
              exportName="supplier-payables"
              header={[t('reports.colSupplier'), t('reports.colCount'), t('reports.colReceived')]}
              rows={payables.map((p) => [
                p.name,
                String(p.ordersCount),
                formatMoney(p.receivedTotal, currency),
              ])}
              empty={payables.length === 0}
            />
          </div>
        </>
      )}
    </div>
  )
}

function PlLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
