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
import { formatMoney, roundMoney } from '@/lib/money'
import {
  fetchDailySalesSeries,
  fetchPaymentBreakdown,
  fetchProductSales,
  fetchTodayExpenseTotal,
  makeRange,
  toDateString,
  type DailySalesPoint,
  type PaymentBreakdownRow,
  type ProductSalesRow,
} from '@/services/business'
import { fetchLowStockItems } from '@/services/inventory'
import { fetchTodayOrders } from '@/services/orders'
import { fetchTables } from '@/services/tables'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function DashboardPage() {
  const { t } = useTranslation()
  const { profile, user, restaurant, settings } = useAuth()

  const currency = settings?.currency ?? restaurant?.default_currency ?? 'BDT'
  const name = profile?.full_name ?? user?.email ?? ''

  const [todaySales, setTodaySales] = useState(0)
  const [ordersToday, setOrdersToday] = useState(0)
  const [occupiedTables, setOccupiedTables] = useState(0)
  const [totalTables, setTotalTables] = useState(0)
  const [lowStockCount, setLowStockCount] = useState(0)
  const [lowStockLoaded, setLowStockLoaded] = useState(false)
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
    // Low-stock line (Phase 3): hidden entirely when the inventory
    // tables are not applied yet — never claim "all OK" without data.
    void fetchLowStockItems(restaurant.id)
      .then((lowStock) => {
        if (cancelled) return
        setLowStockCount(lowStock.length)
        setLowStockLoaded(true)
      })
      .catch(() => {
        // Phase 3 tables not applied: leave the line hidden.
      })
    return () => {
      cancelled = true
    }
  }, [restaurant])

  const hasData = todaySales > 0 || ordersToday > 0 || occupiedTables > 0
  const netToday =
    todayExpenses !== null ? roundMoney(todaySales - todayExpenses) : null

  const stats = [
    {
      key: 'sales',
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
            icon: Wallet,
            label: t('dashboard.todayExpenses'),
            value: formatMoney(todayExpenses, currency),
            hint: `${t('dashboard.netToday')}: ${formatMoney(netToday ?? 0, currency)}`,
          },
          {
            key: 'net',
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
        {stats.map(({ key, icon: Icon, label, value, hint }) => (
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
        ))}
      </div>

      {lowStockLoaded && restaurant && (
        <Link to="/inventory" className="block">
          <Card
            className={
              lowStockCount > 0 ? 'border-amber-300 bg-amber-50' : undefined
            }
          >
            <CardContent className="flex items-center gap-3 pt-6">
              <Package
                className={
                  lowStockCount > 0
                    ? 'size-5 shrink-0 text-amber-700'
                    : 'size-5 shrink-0 text-muted-foreground'
                }
              />
              <p className="text-sm">
                <span className="font-medium">
                  {t('dashboard.lowStockTitle')}
                  {': '}
                </span>
                {lowStockCount > 0
                  ? t('dashboard.lowStockHint', { count: lowStockCount })
                  : t('dashboard.lowStockNone')}
              </p>
              <span className="ml-auto shrink-0 text-sm font-medium text-primary">
                {t('dashboard.viewInventory')} →
              </span>
            </CardContent>
          </Card>
        </Link>
      )}

      {todayExpenses !== null && (
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

      {todayExpenses !== null && (
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
