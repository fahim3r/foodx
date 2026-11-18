// FoodX — Reports + Profit & Loss panels (Phase 7, Step 2A §39).
// Read-only views computed by src/services/business.ts. Every table
// exports CSV (exactly the rows on screen) and can be printed via
// the browser print flow (Save-as-PDF) — §39 "PDF where appropriate".
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
import { escapeHtml, printHtml } from '@/lib/print'
import { useLicenseState } from '@/hooks/useLicenseState'
import { isModuleEnabled } from '@/services/heartbeat'
import {
  fetchBranchSales,
  fetchCategorySales,
  fetchCustomerReport,
  fetchDailySalesSeries,
  fetchDeliverySummary,
  fetchExpenseByCategory,
  fetchInventoryReport,
  fetchItemMargins,
  fetchKitchenReport,
  fetchLoyaltyReport,
  fetchPaymentBreakdown,
  fetchProductSales,
  fetchProfitLoss,
  fetchPurchaseReport,
  fetchRefundVoidReport,
  fetchShiftReport,
  fetchStaffSales,
  fetchSupplierBalances,
  fetchSupplierPayables,
  fetchTaxDiscountReport,
  makeRange,
  toDateString,
  type BranchSalesRow,
  type CategorySalesRow,
  type CustomerReportRow,
  type DailySalesPoint,
  type DeliverySummary,
  type ExpenseByCategoryRow,
  type InventoryReport,
  type ItemMarginRow,
  type KitchenReport,
  type LoyaltyReport,
  type PaymentBreakdownRow,
  type ProductSalesRow,
  type ProfitLoss,
  type PurchaseReportRow,
  type RefundVoidReport,
  type ReportRange,
  type ShiftReportRow,
  type StaffSalesRow,
  type SupplierBalanceRow,
  type SupplierPayableRow,
  type TaxDiscountReport,
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

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'custom'

const PRESETS: Preset[] = ['today', 'yesterday', 'week', 'month', 'lastMonth', 'custom']

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
    case 'lastMonth': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1)
      const last = new Date(today.getFullYear(), today.getMonth(), 0)
      return { from: toDateString(first), to: toDateString(last) }
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

const SELECT_CLASS =
  'flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

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

function printTable(
  restaurantName: string,
  title: string,
  rangeLabel: string,
  header: string[],
  rows: string[][],
) {
  const head = header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const body = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`,
    )
    .join('')
  printHtml(
    title,
    `<h1>${escapeHtml(restaurantName)}</h1><p class="muted">${escapeHtml(title)} · ${escapeHtml(rangeLabel)}</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`,
  )
}

// ---------------------------------------------------------------------------
// Reports tab
// ---------------------------------------------------------------------------

type ReportKey =
  | 'overview'
  | 'cashier'
  | 'waiter'
  | 'branch'
  | 'kitchen'
  | 'customer'
  | 'loyalty'
  | 'inventory'
  | 'purchase'
  | 'supplier'
  | 'tax'
  | 'margin'
  | 'refundVoid'
  | 'shift'

const REPORT_KEYS: ReportKey[] = [
  'overview',
  'cashier',
  'waiter',
  'branch',
  'kitchen',
  'customer',
  'loyalty',
  'inventory',
  'purchase',
  'supplier',
  'tax',
  'margin',
  'refundVoid',
  'shift',
]

export default function ReportsPanel({
  restaurantId,
  currency,
  restaurantName,
}: {
  restaurantId: string
  currency: string
  restaurantName: string
}) {
  const { t } = useTranslation()
  const rangeState = useReportRange()
  const { range } = rangeState
  const [report, setReport] = useState<ReportKey>('overview')
  // Vendor feature flag (§60): loyalty off removes the loyalty
  // report from the picker; if it was selected, fall back.
  const licenseView = useLicenseState()
  const loyaltyEnabled = isModuleEnabled(licenseView, 'loyalty')
  const visibleReportKeys = REPORT_KEYS.filter(
    (key) => key !== 'loyalty' || loyaltyEnabled,
  )

  useEffect(() => {
    if (!loyaltyEnabled && report === 'loyalty') setReport('overview')
  }, [loyaltyEnabled, report])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const [series, setSeries] = useState<DailySalesPoint[]>([])
  const [products, setProducts] = useState<ProductSalesRow[]>([])
  const [categories, setCategories] = useState<CategorySalesRow[]>([])
  const [payments, setPayments] = useState<PaymentBreakdownRow[]>([])
  const [delivery, setDelivery] = useState<DeliverySummary | null>(null)
  const [staffRows, setStaffRows] = useState<StaffSalesRow[]>([])
  const [branchRows, setBranchRows] = useState<BranchSalesRow[]>([])
  const [kitchen, setKitchen] = useState<KitchenReport | null>(null)
  const [customerRows, setCustomerRows] = useState<CustomerReportRow[]>([])
  const [loyalty, setLoyalty] = useState<LoyaltyReport | null>(null)
  const [inventory, setInventory] = useState<InventoryReport | null>(null)
  const [purchaseRows, setPurchaseRows] = useState<PurchaseReportRow[]>([])
  const [balances, setBalances] = useState<SupplierBalanceRow[]>([])
  const [tax, setTax] = useState<TaxDiscountReport | null>(null)
  const [margins, setMargins] = useState<ItemMarginRow[]>([])
  const [refundVoid, setRefundVoid] = useState<RefundVoidReport | null>(null)
  const [shiftRows, setShiftRows] = useState<ShiftReportRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      switch (report) {
        case 'overview': {
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
          break
        }
        case 'cashier':
          setStaffRows(await fetchStaffSales(restaurantId, range))
          break
        case 'waiter':
          setStaffRows(await fetchStaffSales(restaurantId, range, true))
          break
        case 'branch':
          setBranchRows(await fetchBranchSales(restaurantId, range))
          break
        case 'kitchen':
          setKitchen(await fetchKitchenReport(restaurantId, range))
          break
        case 'customer':
          setCustomerRows(await fetchCustomerReport(restaurantId, range))
          break
        case 'loyalty':
          setLoyalty(await fetchLoyaltyReport(restaurantId, range))
          break
        case 'inventory':
          setInventory(await fetchInventoryReport(restaurantId, range))
          break
        case 'purchase':
          setPurchaseRows(await fetchPurchaseReport(restaurantId, range))
          break
        case 'supplier':
          setBalances(await fetchSupplierBalances(restaurantId))
          break
        case 'tax':
          setTax(await fetchTaxDiscountReport(restaurantId, range))
          break
        case 'margin':
          setMargins(await fetchItemMargins(restaurantId, range))
          break
        case 'refundVoid':
          setRefundVoid(await fetchRefundVoidReport(restaurantId, range))
          break
        case 'shift':
          setShiftRows(await fetchShiftReport(restaurantId, range))
          break
      }
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [restaurantId, range, report])

  useEffect(() => {
    void load()
  }, [load])

  const money = (n: number) => formatMoney(n, currency)
  const rangeLabel = `${range.fromDate} → ${range.toDate}`
  const printProps = { restaurantName, rangeLabel }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <RangePicker state={rangeState} />
        <div className="space-y-1">
          <Label>{t('reports.pickerLabel')}</Label>
          <select
            value={report}
            onChange={(e) => setReport(e.target.value as ReportKey)}
            className={SELECT_CLASS}
          >
            {visibleReportKeys.map((key) => (
              <option key={key} value={key}>
                {t(`reports.report_${key}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {loading ? (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      ) : failed ? (
        <p className="text-sm text-destructive">{t('business.loadError')}</p>
      ) : (
        <>
          {report === 'overview' && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>{t('reports.salesChart')}</CardTitle>
                  <CardDescription>{rangeLabel}</CardDescription>
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
                  rows={products.map((p) => [p.name, String(p.quantity), money(p.amount)])}
                  empty={products.length === 0}
                  {...printProps}
                />
                <ReportTable
                  title={t('reports.categorySales')}
                  exportName="category-sales"
                  header={[t('reports.colCategory'), t('reports.colQty'), t('reports.colAmount')]}
                  rows={categories.map((c) => [c.name, String(c.quantity), money(c.amount)])}
                  empty={categories.length === 0}
                  {...printProps}
                />
                <ReportTable
                  title={t('reports.paymentBreakdown')}
                  exportName="payment-breakdown"
                  header={[t('reports.colMethod'), t('reports.colCount'), t('reports.colAmount')]}
                  rows={payments.map((p) => [
                    methodLabel(t, p.method),
                    String(p.count),
                    money(p.amount),
                  ])}
                  empty={payments.length === 0}
                  {...printProps}
                />
                <Card>
                  <CardHeader>
                    <CardTitle>{t('reports.deliverySummary')}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">{t('reports.deliveryOrders')}</p>
                      <p className="text-lg font-semibold">{delivery?.orders ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('reports.deliveryCompleted')}</p>
                      <p className="text-lg font-semibold">{delivery?.completed ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('reports.deliveryFees')}</p>
                      <p className="text-lg font-semibold">{money(delivery?.fees ?? 0)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('reports.codCollected')}</p>
                      <p className="text-lg font-semibold">{money(delivery?.codTotal ?? 0)}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}

          {(report === 'cashier' || report === 'waiter') && (
            <div className="space-y-3">
              {report === 'waiter' && (
                <p className="text-sm text-muted-foreground">{t('reports.waiterNote')}</p>
              )}
              <ReportTable
                title={t(`reports.report_${report}`)}
                exportName={`${report}-sales`}
                header={[
                  t('reports.colStaff'),
                  t('reports.colOrders'),
                  t('reports.colAmount'),
                  t('reports.colAvgTicket'),
                ]}
                rows={staffRows.map((r) => [
                  r.name,
                  String(r.orders),
                  money(r.sales),
                  money(r.avgTicket),
                ])}
                empty={staffRows.length === 0}
                {...printProps}
              />
            </div>
          )}

          {report === 'branch' && (
            <ReportTable
              title={t('reports.report_branch')}
              exportName="branch-sales"
              header={[t('reports.colBranch'), t('reports.colOrders'), t('reports.colAmount')]}
              rows={branchRows.map((r) => [r.name, String(r.orders), money(r.sales)])}
              empty={branchRows.length === 0}
              {...printProps}
            />
          )}

          {report === 'kitchen' && kitchen && (
            <div className="grid gap-6 lg:grid-cols-2">
              <ReportTable
                title={t('reports.report_kitchen')}
                exportName="kitchen-stations"
                header={[t('reports.colStation'), t('reports.colItems'), t('reports.colOrders')]}
                rows={kitchen.stations.map((s) => [s.name, String(s.items), String(s.orders)])}
                empty={kitchen.stations.length === 0}
                {...printProps}
              />
              <ReportTable
                title={t('reports.kitchenTiming')}
                exportName="kitchen-timing"
                header={[t('reports.colMetric'), t('reports.colValue')]}
                rows={[
                  [t('reports.kitchenCompleted'), String(kitchen.completedOrders)],
                  [
                    t('reports.kitchenAvg'),
                    kitchen.avgCompletionMinutes === null
                      ? '—'
                      : `${kitchen.avgCompletionMinutes} ${t('reports.unitMinutes')}`,
                  ],
                ]}
                empty={false}
                {...printProps}
              />
            </div>
          )}

          {report === 'customer' && (
            <ReportTable
              title={t('reports.report_customer')}
              exportName="customer-report"
              header={[
                t('reports.colCustomer'),
                t('reports.colOrders'),
                t('reports.colSpent'),
                t('reports.colPoints'),
              ]}
              rows={customerRows.map((r) => [
                r.name,
                String(r.orders),
                money(r.spent),
                String(r.pointsBalance),
              ])}
              empty={customerRows.length === 0}
              {...printProps}
            />
          )}

          {report === 'loyalty' && loyalty && (
            <div className="grid gap-6 lg:grid-cols-2">
              <ReportTable
                title={t('reports.report_loyalty')}
                exportName="loyalty-summary"
                header={[t('reports.colMetric'), t('reports.colPoints')]}
                rows={[
                  [t('reports.loyaltyEarned'), String(loyalty.earned)],
                  [t('reports.loyaltyRedeemed'), String(loyalty.redeemed)],
                  [t('reports.loyaltyAdjustments'), String(loyalty.adjustments)],
                ]}
                empty={false}
                {...printProps}
              />
              <ReportTable
                title={t('reports.loyaltyTopHolders')}
                exportName="loyalty-top-holders"
                header={[t('reports.colCustomer'), t('reports.colPoints')]}
                rows={loyalty.topHolders.map((h) => [h.name, String(h.balance)])}
                empty={loyalty.topHolders.length === 0}
                {...printProps}
              />
            </div>
          )}

          {report === 'inventory' && inventory && (
            <div className="space-y-6">
              <ReportTable
                title={t('reports.report_inventory')}
                exportName="inventory-summary"
                header={[t('reports.colMetric'), t('reports.colValue')]}
                rows={[[t('reports.invStockValue'), money(inventory.stockValue)]]}
                empty={false}
                {...printProps}
              />
              <div className="grid gap-6 lg:grid-cols-2">
                <ReportTable
                  title={t('reports.invLowStock')}
                  exportName="low-stock"
                  header={[t('reports.colProduct'), t('reports.colQty'), t('reports.colThreshold')]}
                  rows={inventory.lowStock.map((i) => [
                    i.name,
                    String(i.quantity),
                    String(i.threshold),
                  ])}
                  empty={inventory.lowStock.length === 0}
                  {...printProps}
                />
                <ReportTable
                  title={t('reports.invMovements')}
                  exportName="stock-movements"
                  header={[t('reports.colType'), t('reports.colCount'), t('reports.colQty')]}
                  rows={inventory.movements.map((m) => [
                    m.type,
                    String(m.count),
                    String(m.quantity),
                  ])}
                  empty={inventory.movements.length === 0}
                  {...printProps}
                />
              </div>
            </div>
          )}

          {report === 'purchase' && (
            <ReportTable
              title={t('reports.report_purchase')}
              exportName="purchase-report"
              header={[
                t('reports.colSupplier'),
                t('reports.colStatus'),
                t('reports.colOrders'),
                t('reports.colAmount'),
              ]}
              rows={purchaseRows.map((r) => [
                r.name,
                r.status,
                String(r.orders),
                money(r.total),
              ])}
              empty={purchaseRows.length === 0}
              {...printProps}
            />
          )}

          {report === 'supplier' && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t('reports.supplierCurrentNote')}
              </p>
              <ReportTable
                title={t('reports.report_supplier')}
                exportName="supplier-balances"
                header={[
                  t('reports.colSupplier'),
                  t('reports.colReceived'),
                  t('reports.colPaid'),
                  t('reports.colDue'),
                ]}
                rows={balances.map((b) => [
                  b.name,
                  money(b.receivedTotal),
                  money(b.paidTotal),
                  money(b.due),
                ])}
                empty={balances.length === 0}
                {...printProps}
              />
            </div>
          )}

          {report === 'tax' && tax && (
            <ReportTable
              title={t('reports.report_tax')}
              exportName="tax-discounts"
              header={[t('reports.colMetric'), t('reports.colValue')]}
              rows={[
                [t('reports.colOrders'), String(tax.orders)],
                [t('reports.taxCollected'), money(tax.taxCollected)],
                [t('reports.serviceCollected'), money(tax.serviceChargeCollected)],
                [t('reports.orderDiscounts'), money(tax.orderDiscounts)],
                [t('reports.couponRedemptions'), String(tax.couponRedemptions)],
                [t('reports.couponDiscount'), money(tax.couponDiscount)],
              ]}
              empty={false}
              {...printProps}
            />
          )}

          {report === 'margin' && (
            <ReportTable
              title={t('reports.report_margin')}
              exportName="item-margins"
              header={[
                t('reports.colProduct'),
                t('reports.colPrice'),
                t('reports.colCost'),
                t('reports.colSource'),
                t('reports.colMargin'),
                t('reports.colMarginPct'),
                t('reports.colSoldQty'),
              ]}
              rows={margins.map((m) => [
                m.name,
                money(m.price),
                m.cost === null ? t('reports.marginNoCost') : money(m.cost),
                m.costSource === 'recipe'
                  ? t('reports.marginSourceRecipe')
                  : m.costSource === 'manual'
                    ? t('reports.marginSourceManual')
                    : '—',
                m.margin === null ? '—' : money(m.margin),
                m.marginPct === null ? '—' : `${m.marginPct}%`,
                String(m.soldQty),
              ])}
              empty={margins.length === 0}
              {...printProps}
            />
          )}

          {report === 'refundVoid' && refundVoid && (
            <div className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <ReportTable
                  title={t('reports.refundedTitle')}
                  exportName="refunded-orders"
                  header={[t('reports.colOrderNumber'), t('reports.colDate'), t('reports.colAmount')]}
                  rows={refundVoid.refunded.map((r) => [
                    `#${r.orderNumber}`,
                    new Date(r.at).toLocaleString(),
                    money(r.total),
                  ])}
                  empty={refundVoid.refunded.length === 0}
                  {...printProps}
                />
                <ReportTable
                  title={t('reports.cancelledTitle')}
                  exportName="cancelled-orders"
                  header={[t('reports.colOrderNumber'), t('reports.colDate'), t('reports.colAmount')]}
                  rows={refundVoid.cancelled.map((r) => [
                    `#${r.orderNumber}`,
                    new Date(r.at).toLocaleString(),
                    money(r.total),
                  ])}
                  empty={refundVoid.cancelled.length === 0}
                  {...printProps}
                />
              </div>
              <ReportTable
                title={t('reports.voidedExpensesTitle')}
                exportName="voided-expenses"
                header={[t('reports.colMetric'), t('reports.colValue')]}
                rows={[
                  [t('reports.colCount'), String(refundVoid.voidedExpenses)],
                  [t('reports.colAmount'), money(refundVoid.voidedExpenseTotal)],
                  [t('reports.refundedTitle'), money(refundVoid.refundedTotal)],
                  [t('reports.cancelledTitle'), money(refundVoid.cancelledTotal)],
                ]}
                empty={false}
                {...printProps}
              />
            </div>
          )}

          {report === 'shift' && (
            <ReportTable
              title={t('reports.report_shift')}
              exportName="shift-report"
              header={[
                t('reports.colCashier'),
                t('reports.colOpened'),
                t('reports.colClosed'),
                t('reports.colExpected'),
                t('reports.colActual'),
                t('reports.colDifference'),
              ]}
              rows={shiftRows.map((s) => [
                s.cashier,
                new Date(s.openedAt).toLocaleString(),
                s.closedAt ? new Date(s.closedAt).toLocaleString() : '—',
                s.expected === null ? '—' : money(s.expected),
                s.actual === null ? '—' : money(s.actual),
                s.difference === null ? '—' : money(s.difference),
              ])}
              empty={shiftRows.length === 0}
              {...printProps}
            />
          )}
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
  restaurantName,
  rangeLabel,
}: {
  title: string
  exportName: string
  header: string[]
  rows: string[][]
  empty: boolean
  restaurantName: string
  rangeLabel: string
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {!empty && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => printTable(restaurantName, title, rangeLabel, header, rows)}
            >
              {t('reports.printButton')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => downloadCsv(`${exportName}.csv`, header, rows)}
            >
              {t('reports.exportCsv')}
            </Button>
          </div>
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
  restaurantName,
}: {
  restaurantId: string
  currency: string
  restaurantName: string
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

  const rangeLabel = `${range.fromDate} → ${range.toDate}`
  const printProps = { restaurantName, rangeLabel }

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
                {rangeLabel} · {t('reports.plOrders')}: {pl.ordersCount}
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
              {...printProps}
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
              {...printProps}
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
