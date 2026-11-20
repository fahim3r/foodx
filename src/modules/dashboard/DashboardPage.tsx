// FoodX — Dashboard (protected). Shows real data when the Phase 2
// tables exist (today's sales / orders from orders, active tables from
// tables); falls back to honest zero states when there is no data yet or
// the migration has not been applied. No fake numbers, no mock charts.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  ClipboardList,
  Package,
  ShoppingBag,
  Table2,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAuth } from '@/hooks/useAuth'
import { useEasyMode } from '@/hooks/useEasyMode'
import { usePermissions } from '@/hooks/usePermissions'
import { formatMoney, roundMoney } from '@/lib/money'
import {
  fetchDailySalesSeries,
  fetchPaymentBreakdown,
  fetchSupplierBalances,
  type SupplierBalanceRow,
  fetchProductSales,
  fetchTodayExpenseTotal,
  makeRange,
  toDateString,
  type DailySalesPoint,
  type PaymentBreakdownRow,
  type ProductSalesRow,
} from '@/services/business'
import { fetchLowStockItems } from '@/services/inventory'
import type { InventoryItem } from '@/types'
import { fetchTodayOrders } from '@/services/orders'
import { fetchTables } from '@/services/tables'
import EasyHomePage from './EasyHomePage'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function DashboardPage() {
  const { easy } = useEasyMode()
  const { can, ready: permissionsReady } = usePermissions()
  const { t } = useTranslation()
  // Financial figures (audit wave 2): today's sales / expenses /
  // net, the sales chart, payment + product money lists and the
  // supplier-dues alert are report data, so they ride on
  // reports.view — the same key that already gates the Business
  // section. The waiter role does not hold it (owner / admin /
  // manager / accountant do); order counts, table counts and the
  // low-stock alert stay visible to everyone. `ready` is required
  // too: while permissions load, can() fails open and a waiter
  // would briefly see the money cards before they vanished.
  const showFinancials = permissionsReady && can('reports.view')
  const { profile, user, restaurant, settings } = useAuth()

  const currency = settings?.currency ?? restaurant?.default_currency ?? 'BDT'
  const name = profile?.full_name ?? user?.email ?? ''

  // First-load flag for the stat cards (audit wave 3): until the
  // first stats fetch settles, the cards render as skeletons — a
  // real-looking ৳0.00 reads as "no sales today" and misleads.
  const [statsLoading, setStatsLoading] = useState(true)
  const [todaySales, setTodaySales] = useState(0)
  const [ordersToday, setOrdersToday] = useState(0)
  const [occupiedTables, setOccupiedTables] = useState(0)
  const [totalTables, setTotalTables] = useState(0)
  // Alerts panel (Roadmap Wave 1, gap 7): null = not loaded or the
  // source failed — each list hides independently, and an empty
  // state is only ever shown for a list that actually loaded.
  const [lowStockItems, setLowStockItems] = useState<InventoryItem[] | null>(
    null,
  )
  const [duesRows, setDuesRows] = useState<SupplierBalanceRow[] | null>(null)
  // Phase 7 business widgets: null until loaded; stay hidden entirely
  // when the business tables are not applied yet (same honest pattern
  // as the low-stock line).
  const [todayExpenses, setTodayExpenses] = useState<number | null>(null)
  const [salesSeries, setSalesSeries] = useState<DailySalesPoint[]>([])
  const [paymentsToday, setPaymentsToday] = useState<PaymentBreakdownRow[]>([])
  const [topProducts, setTopProducts] = useState<ProductSalesRow[]>([])

  useEffect(() => {
    if (!restaurant) return
    let cancelled = false
    void Promise.all([
      fetchTodayOrders(restaurant.id),
      fetchTables(restaurant.id),
    ])
      .then(([orders, tables]) => {
        if (cancelled) return
        setTodaySales(
          orders.reduce((sum, order) => sum + Number(order.total_amount), 0),
        )
        setOrdersToday(orders.length)
        setOccupiedTables(
          tables.filter((table) => table.status === 'occupied').length,
        )
        setTotalTables(tables.length)
      })
      .catch((error: unknown) => {
        // Missing Phase 2 tables (migration not applied) or a network
        // error: stay on the honest zero states; the layout banner
        // explains the pending-database case.
        console.error('[Dashboard] could not load today’s stats', error)
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false)
      })
    // Business widgets (Phase 7): today's expenses, the 7-day sales
    // series, today's payment breakdown and top products.
    const todayStr = toDateString(new Date())
    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - 6)
    void Promise.all([
      fetchTodayExpenseTotal(restaurant.id),
      fetchDailySalesSeries(
        restaurant.id,
        makeRange(toDateString(weekStart), todayStr),
      ),
      fetchPaymentBreakdown(restaurant.id, makeRange(todayStr, todayStr)),
      fetchProductSales(restaurant.id, makeRange(todayStr, todayStr), 5),
    ])
      .then(([expenses, series, payments, products]) => {
        if (cancelled) return
        setTodayExpenses(expenses)
        setSalesSeries(series)
        setPaymentsToday(payments)
        setTopProducts(products)
      })
      .catch(() => {
        // Phase 7 tables not applied: leave the widgets hidden.
      })
    // Alerts sources (Phase 3 low stock + Phase 7 supplier
    // balances): each hides independently when its tables are not
    // applied yet — never claim "all OK" without data.
    void fetchLowStockItems(restaurant.id)
      .then((lowStock) => {
        if (!cancelled) setLowStockItems(lowStock)
      })
      .catch(() => {
        // Phase 3 tables not applied: leave the list hidden.
      })
    void fetchSupplierBalances(restaurant.id)
      .then((rows) => {
        if (!cancelled) setDuesRows(rows)
      })
      .catch(() => {
        // Phase 7 tables not applied: leave the list hidden.
      })
    return () => {
      cancelled = true
    }
  }, [restaurant])

  // Alerts derivations: low stock sorted by urgency (out of stock
  // first, then the lowest quantity relative to its threshold);
  // dues = suppliers owing money, largest first. Both show 5.
  const lowStockSorted = (lowStockItems ?? [])
    .slice()
    .sort((a, b) => {
      const aq = Number(a.current_quantity)
      const bq = Number(b.current_quantity)
      const aOut = aq <= 0 ? 0 : 1
      const bOut = bq <= 0 ? 0 : 1
      if (aOut !== bOut) return aOut - bOut
      const aRatio =
        Number(a.low_stock_threshold) > 0
          ? aq / Number(a.low_stock_threshold)
          : aq
      const bRatio =
        Number(b.low_stock_threshold) > 0
          ? bq / Number(b.low_stock_threshold)
          : bq
      return aRatio - bRatio
    })
  const duesOwed = (duesRows ?? [])
    .filter((row) => row.due > 0)
    .sort((a, b) => b.due - a.due)
  const duesTotal = roundMoney(
    duesOwed.reduce((sum, row) => sum + row.due, 0),
  )
  const showAlerts =
    lowStockItems !== null || (duesRows !== null && showFinancials)

  // Easy Mode v2 (wave E1): the panel home is Easy Home while the
  // restaurant-wide easy mode is on. All hooks above still run;
  // the normal dashboard simply never renders.
  if (easy) return <EasyHomePage />

  const hasData = todaySales > 0 || ordersToday > 0 || occupiedTables > 0
  const netToday =
    todayExpenses !== null ? roundMoney(todaySales - todayExpenses) : null

  const stats = [
    {
      key: 'sales',
      financial: true,
      icon: ShoppingBag,
      label: t('dashboard.todaySales'),
      value: formatMoney(todaySales, currency),
      hint:
        ordersToday > 0
          ? t('dashboard.todaySalesHintHasData', { count: ordersToday })
          : t('dashboard.todaySalesHint'),
    },
    {
      key: 'orders',
      financial: false,
      icon: ClipboardList,
      label: t('dashboard.ordersToday'),
      value: String(ordersToday),
      hint:
        ordersToday > 0
          ? t('dashboard.ordersTodayHintHasData', { count: ordersToday })
          : t('dashboard.ordersTodayHint'),
    },
    {
      key: 'tables',
      financial: false,
      icon: Table2,
      label: t('dashboard.activeTables'),
      value: String(occupiedTables),
      hint:
        occupiedTables > 0
          ? t('dashboard.activeTablesHintHasData', {
              count: occupiedTables,
              total: totalTables,
            })
          : t('dashboard.activeTablesHint'),
    },
    ...(todayExpenses !== null
      ? [
          {
            key: 'expenses',
            financial: true,
            icon: Wallet,
            label: t('dashboard.todayExpenses'),
            value: formatMoney(todayExpenses, currency),
            hint: `${t('dashboard.netToday')}: ${formatMoney(netToday ?? 0, currency)}`,
          },
          {
            key: 'net',
            financial: true,
            icon: TrendingUp,
            label: t('dashboard.netToday'),
            value: formatMoney(netToday ?? 0, currency),
            hint: t('dashboard.netTodayHint'),
          },
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-bold tracking-tight">{t('dashboard.title')}</h2>
        <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>
        {name && (
          <p className="mt-1 text-sm text-muted-foreground">
            {t('dashboard.welcome', { name })}
          </p>
        )}
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {statsLoading && restaurant ? (
          <>
            {(showFinancials
              ? ['sales', 'orders', 'tables']
              : ['orders', 'tables']
            ).map((key) => (
              <Card key={key} aria-hidden="true">
                <CardHeader className="pb-2">
                  <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                </CardHeader>
                <CardContent>
                  <div className="h-9 w-32 animate-pulse rounded bg-muted" />
                  <div className="mt-2 h-4 w-40 animate-pulse rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          stats
            .filter((stat) => !stat.financial || showFinancials)
            .map(({ key, icon: Icon, label, value, hint }) => (
          <Card key={key}>
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium">{label}</CardTitle>
              <Icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold">{value}</p>
              <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
              {!hasData && (
                <p className="mt-2 inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {t('dashboard.noDataYet')}
                </p>
              )}
            </CardContent>
          </Card>
            ))
        )}
      </div>

      {showAlerts && restaurant && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t('dashboard.alertsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-2">
            {lowStockItems !== null && (
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Package className="size-4 text-amber-700" />
                  {t('dashboard.lowStockTitle')}
                </p>
                {lowStockSorted.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t('dashboard.lowStockNone')}
                  </p>
                ) : (
                  <>
                    <div className="mt-2 divide-y">
                      {lowStockSorted.slice(0, 5).map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 py-1.5 text-sm"
                        >
                          <span>{item.name}</span>
                          {Number(item.current_quantity) <= 0 ? (
                            <span className="font-medium text-red-700">
                              {t('dashboard.alertsOutOfStock')}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {t('dashboard.alertsStockLeft', {
                                qty: Number(item.current_quantity),
                                unit: item.unit,
                                threshold: Number(item.low_stock_threshold),
                              })}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    {lowStockSorted.length > 5 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('dashboard.alertsMore', {
                          count: lowStockSorted.length - 5,
                        })}
                      </p>
                    )}
                  </>
                )}
                <Link
                  to="/inventory"
                  className="mt-2 inline-block text-sm font-medium text-primary"
                >
                  {t('dashboard.viewInventory')} →
                </Link>
              </div>
            )}
            {duesRows !== null && showFinancials && (
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Wallet className="size-4 text-amber-700" />
                  {t('dashboard.alertsDuesTitle')}
                </p>
                {duesOwed.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t('dashboard.alertsDuesNone')}
                  </p>
                ) : (
                  <>
                    <div className="mt-2 divide-y">
                      {duesOwed.slice(0, 5).map((row) => (
                        <div
                          key={row.supplierId}
                          className="flex items-center justify-between gap-2 py-1.5 text-sm"
                        >
                          <span>{row.name}</span>
                          <span className="font-medium">
                            {formatMoney(row.due, currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {duesOwed.length > 5 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('dashboard.alertsMore', {
                          count: duesOwed.length - 5,
                        })}
                      </p>
                    )}
                    <p className="mt-2 text-sm">
                      <span className="text-muted-foreground">
                        {t('dashboard.alertsDuesTotal')}
                        {': '}
                      </span>
                      <span className="font-semibold">
                        {formatMoney(duesTotal, currency)}
                      </span>
                    </p>
                  </>
                )}
                <Link
                  to="/inventory"
                  className="mt-2 inline-block text-sm font-medium text-primary"
                >
                  {t('dashboard.viewInventory')} →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!easy && showFinancials && todayExpenses !== null && (
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.salesLast7Days')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value) => [
                      formatMoney(Number(value ?? 0), currency),
                      t('dashboard.todaySales'),
                    ]}
                  />
                  <Bar dataKey="sales" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {!easy && showFinancials && todayExpenses !== null && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.paymentBreakdown')}</CardTitle>
            </CardHeader>
            <CardContent>
              {paymentsToday.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('dashboard.noPaymentsYet')}
                </p>
              ) : (
                <div className="divide-y">
                  {paymentsToday.map((row) => (
                    <div
                      key={row.method}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span>
                        {t(
                          `pos.method${row.method.charAt(0).toUpperCase()}${row.method.slice(1)}`,
                        )}
                        {' · '}
                        {row.count}
                      </span>
                      <span className="font-medium">
                        {formatMoney(row.amount, currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('dashboard.topProducts')}</CardTitle>
            </CardHeader>
            <CardContent>
              {topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('reports.noData')}
                </p>
              ) : (
                <div className="divide-y">
                  {topProducts.map((row) => (
                    <div
                      key={row.name}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span>
                        {row.name}
                        {' · '}
                        {row.quantity}
                      </span>
                      <span className="font-medium">
                        {formatMoney(row.amount, currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {!restaurant && (
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.gettingStartedTitle')}</CardTitle>
            <CardDescription>{t('dashboard.gettingStartedBody')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/settings">{t('dashboard.setupRestaurant')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.modulesLaterTitle')}</CardTitle>
          <CardDescription>{t('dashboard.modulesLaterBody')}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
