// FoodX — Dashboard (protected), Advanced mode (Dashboard
// modernisation W1 + W2). Layout, top to bottom: header strip
// (time-of-day greeting, restaurant name, date, quick actions —
// the online/offline status moved to a header badge in AppLayout,
// 2026-11-23), the KPI row with vs-yesterday
// trend chips, the live operations strip, the hourly sales chart
// beside the payment-mix donut, the 7-day chart full width, the
// top-items list beside the আজকের পালা (today's shift) card, and
// the recent-orders list beside the alerts card (rearranged
// 2026-11-23 at the user's request — the alerts card used to sit
// full width under the KPI row, and the 7-day chart shared a row
// with the shift card). In Easy Mode the panel home is
// EasyHomePage instead — the switch below is unchanged and this
// page's redesign never touches it.
//
// Refresh model (design §4, user Q1): the LIGHT group — today's
// orders + tables, open-order counts, expenses, trend inputs, the
// alerts sources and recent orders — re-fetches every 30 s and on
// window focus (the KDS poll idiom). The HEAVY group — the 7-day
// series, payment breakdown and top products — loads on mount,
// re-runs every 5 minutes, and re-runs when the light poll sees
// today's order count change. Failed sources keep the honest
// patterns from before: core widgets fall back to zero states,
// Phase 7 widgets hide.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
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
import { useLicenseState } from '@/hooks/useLicenseState'
import { usePermissions } from '@/hooks/usePermissions'
import { formatMoney, roundMoney } from '@/lib/money'
import {
  fetchDailySalesSeries,
  fetchDayTotals,
  fetchPaymentBreakdown,
  fetchSupplierBalances,
  type SupplierBalanceRow,
  fetchProductSales,
  fetchTodayExpenseTotal,
  makeRange,
  toDateString,
  type DailySalesPoint,
  type DayTotals,
  type PaymentBreakdownRow,
  type ProductSalesRow,
} from '@/services/business'
import { isModuleEnabled } from '@/services/heartbeat'
import { fetchLowStockItems } from '@/services/inventory'
import type { InventoryItem, Order } from '@/types'
import { isModuleOn } from '@/services/modules'
import {
  fetchOpenOrderCounts,
  fetchOrders,
  fetchTodayOrders,
  type OpenOrderCounts,
} from '@/services/orders'
import { fetchTables } from '@/services/tables'
import EasyHomePage from './EasyHomePage'
import HourlySalesCard from './HourlySalesCard'
import OpsStrip from './OpsStrip'
import PaymentMixCard from './PaymentMixCard'
import RecentOrdersCard from './RecentOrdersCard'
import ShiftCard from './ShiftCard'
import TopItemsCard from './TopItemsCard'
import LiveTablesCard from './LiveTablesCard'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const LIGHT_POLL_MS = 30_000
const HEAVY_POLL_MS = 300_000

/** Vs-yesterday trend chip (design §3 row 2). Both inputs share
 * one definition (see the loaders), so the % is honest. When
 * yesterday was 0 there is no meaningful %: the chip shows today's
 * delta instead (or a plain dash when both days are 0). For
 * expenses, up is bad — `invert` flips the colour meaning. */
function TrendChip({
  today,
  yesterday,
  format,
  invert = false,
}: {
  today: number
  yesterday: number
  format: (value: number) => string
  invert?: boolean
}) {
  const { t } = useTranslation()
  let arrow = '—'
  let text: ReactNode
  let tone: 'good' | 'bad' | 'flat' = 'flat'
  if (yesterday === 0) {
    if (today > 0) {
      arrow = '▲'
      tone = invert ? 'bad' : 'good'
      text = (
        <>
          {format(today)}
          <span className="ml-1 font-normal">{t('dashboard.trendNew')}</span>
        </>
      )
    } else {
      text = t('dashboard.trendVsYesterday')
    }
  } else {
    const pct = Math.round(((today - yesterday) / yesterday) * 100)
    arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '—'
    tone = pct === 0 ? 'flat' : (pct > 0) !== invert ? 'good' : 'bad'
    text = (
      <>
        {Math.abs(pct)}%
        <span className="ml-1 font-normal">
          {t('dashboard.trendVsYesterday')}
        </span>
      </>
    )
  }
  const toneClass =
    tone === 'good'
      ? 'bg-emerald-100 text-emerald-800'
      : tone === 'bad'
        ? 'bg-red-100 text-red-800'
        : 'bg-muted text-muted-foreground'
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${toneClass}`}
    >
      {arrow} {text}
    </span>
  )
}

export default function DashboardPage() {
  const { easy } = useEasyMode()
  const { can, ready: permissionsReady } = usePermissions()
  const { t, i18n } = useTranslation()
  const { pathname } = useLocation()
  const licenseView = useLicenseState()
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

  // Same panel-root derivation as the sidebar (AppLayout): links
  // are right under both mountings (basename /panel on restaurant
  // domains, descendant /panel/* routes on platform hosts).
  const panelBase =
    pathname === '/panel' || pathname.startsWith('/panel/') ? '/panel' : ''
  const navTo = (to: string) =>
    to === '/' ? panelBase || '/' : `${panelBase}${to}`

  const deliveryOn =
    isModuleOn(settings, 'delivery') &&
    isModuleEnabled(licenseView, 'delivery')

  // First-load flag for the stat cards (audit wave 3): until the
  // first stats fetch settles, the cards render as skeletons — a
  // real-looking ৳0.00 reads as "no sales today" and misleads.
  const [statsLoading, setStatsLoading] = useState(true)
  const [todaySales, setTodaySales] = useState(0)
  const [ordersToday, setOrdersToday] = useState(0)
  // Today's order rows themselves (W2): the hourly chart buckets
  // them client-side, so they are kept next to the aggregates the
  // light loader already computed from them.
  const [todayOrders, setTodayOrders] = useState<Order[]>([])
  // Lists row (W2): the latest 8 orders of any day (null until the
  // first read lands) and the table-name map their rows label
  // dine-in orders with (built from the light loader's tables read).
  const [recentOrders, setRecentOrders] = useState<Order[] | null>(null)
  const [tableNames, setTableNames] = useState<Record<string, string>>({})
  const [occupiedTables, setOccupiedTables] = useState(0)
  const [totalTables, setTotalTables] = useState(0)
  const [tablesKnown, setTablesKnown] = useState(false)
  const [opsCounts, setOpsCounts] = useState<OpenOrderCounts | null>(null)
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
  // Trend inputs (W1): the 2-day sales series and yesterday's day
  // totals. Null until loaded — a chip renders only when both of
  // its days are known (design §4).
  const [trendSeries, setTrendSeries] = useState<DailySalesPoint[] | null>(
    null,
  )
  const [yesterdayTotals, setYesterdayTotals] = useState<DayTotals | null>(
    null,
  )
  // Heavy group (W2 widgets): 7-day series, today's payment
  // breakdown and top products.
  const [salesSeries, setSalesSeries] = useState<DailySalesPoint[]>([])
  const [paymentsToday, setPaymentsToday] = useState<PaymentBreakdownRow[]>([])
  const [topProducts, setTopProducts] = useState<ProductSalesRow[]>([])

  // Light group: mount + every 30 s + on window focus.
  useEffect(() => {
    if (!restaurant) return
    let cancelled = false
    const restaurantId = restaurant.id
    const todayStr = toDateString(new Date())
    const yesterdayDate = new Date()
    yesterdayDate.setDate(yesterdayDate.getDate() - 1)
    const yesterdayStr = toDateString(yesterdayDate)

    const loadCore = () => {
      void Promise.all([
        fetchTodayOrders(restaurantId),
        fetchTables(restaurantId),
      ])
        .then(([orders, tables]) => {
          if (cancelled) return
          setTodayOrders(orders)
          setTableNames(
            Object.fromEntries(
              tables.map((table) => [table.id, table.name]),
            ),
          )
          setTodaySales(
            orders.reduce((sum, order) => sum + Number(order.total_amount), 0),
          )
          setOrdersToday(orders.length)
          setOccupiedTables(
            tables.filter((table) => table.status === 'occupied').length,
          )
          setTotalTables(tables.length)
          setTablesKnown(true)
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
      // Ops strip counts: a failed read keeps the last counts (or
      // the "—" state) — never a 0 presented as fact.
      void fetchOpenOrderCounts(restaurantId)
        .then((counts) => {
          if (!cancelled) setOpsCounts(counts)
        })
        .catch(() => {
          // Orders table missing: the strip keeps its "—" buckets.
        })
      // Recent orders (W2 lists row): the latest 8 of any day,
      // newest first. A failed read keeps the last list (or the
      // not-yet-loaded state) — never a fake empty list.
      void fetchOrders(restaurantId, { limit: 8 })
        .then((recent) => {
          if (!cancelled) setRecentOrders(recent)
        })
        .catch(() => {
          // Orders table missing: the card keeps its last state.
        })
      // Phase 7 inputs: today's expenses + the trend pair.
      void fetchTodayExpenseTotal(restaurantId)
        .then((total) => {
          if (!cancelled) setTodayExpenses(total)
        })
        .catch(() => {
          // Phase 7 tables not applied: the widgets stay hidden.
        })
      void fetchDailySalesSeries(
        restaurantId,
        makeRange(yesterdayStr, todayStr),
      )
        .then((series) => {
          if (!cancelled) setTrendSeries(series)
        })
        .catch(() => {
          // No series: the trend chips stay absent.
        })
      void fetchDayTotals(restaurantId, yesterdayStr)
        .then((totals) => {
          if (!cancelled) setYesterdayTotals(totals)
        })
        .catch(() => {
          // No totals: the expenses/net chips stay absent.
        })
      // Alerts sources (Phase 3 low stock + Phase 7 supplier
      // balances): each hides independently when its tables are not
      // applied yet — never claim "all OK" without data.
      void fetchLowStockItems(restaurantId)
        .then((lowStock) => {
          if (!cancelled) setLowStockItems(lowStock)
        })
        .catch(() => {
          // Phase 3 tables not applied: leave the list hidden.
        })
      void fetchSupplierBalances(restaurantId)
        .then((rows) => {
          if (!cancelled) setDuesRows(rows)
        })
        .catch(() => {
          // Phase 7 tables not applied: leave the list hidden.
        })
    }

    loadCore()
    const timer = window.setInterval(loadCore, LIGHT_POLL_MS)
    window.addEventListener('focus', loadCore)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', loadCore)
    }
  }, [restaurant])

  // Heavy group (design §4, user Q1): loads on mount, re-runs
  // every 5 minutes, and re-runs when the light poll sees today's
  // order count change (the trigger effect below calls the loader
  // through this ref). One interval, cleaned up on unmount.
  const loadHeavyRef = useRef<() => void>(() => {})
  useEffect(() => {
    if (!restaurant) return
    let cancelled = false
    const restaurantId = restaurant.id

    const loadHeavy = () => {
      const todayStr = toDateString(new Date())
      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - 6)
      void Promise.all([
        fetchDailySalesSeries(
          restaurantId,
          makeRange(toDateString(weekStart), todayStr),
        ),
        fetchPaymentBreakdown(restaurantId, makeRange(todayStr, todayStr)),
        fetchProductSales(restaurantId, makeRange(todayStr, todayStr), 5),
      ])
        .then(([series, payments, products]) => {
          if (cancelled) return
          setSalesSeries(series)
          setPaymentsToday(payments)
          setTopProducts(products)
        })
        .catch(() => {
          // Phase 7 tables not applied: leave the widgets hidden.
        })
    }

    loadHeavyRef.current = loadHeavy
    loadHeavy()
    const timer = window.setInterval(loadHeavy, HEAVY_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [restaurant])

  // Q1 trigger: when the light group's today-order count actually
  // changes (a new order landed, or one was cancelled/refunded),
  // the heavy widgets re-run immediately instead of waiting for
  // the 5-minute tick. The first settled light load only sets the
  // baseline — the mount load above already covers it.
  const heavyBaselineRef = useRef<{ id: string; count: number } | null>(null)
  useEffect(() => {
    if (!restaurant || statsLoading) return
    const baseline = heavyBaselineRef.current
    heavyBaselineRef.current = { id: restaurant.id, count: ordersToday }
    if (
      baseline &&
      baseline.id === restaurant.id &&
      baseline.count !== ordersToday
    ) {
      loadHeavyRef.current()
    }
  }, [ordersToday, statsLoading, restaurant])

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

  // Trend pairs (design §2/§4): sales + orders compare through the
  // SAME series definition on both days; expenses + net compare
  // through day totals on both days (today's net for the trend is
  // the series sales minus today's expenses, so the pair shares
  // one definition — the headline net above stays the displayed
  // figure and is not what the chip measures).
  const todayStr = toDateString(new Date())
  const yesterdayDate = new Date()
  yesterdayDate.setDate(yesterdayDate.getDate() - 1)
  const yesterdayStr = toDateString(yesterdayDate)
  const seriesToday = trendSeries?.find((point) => point.date === todayStr)
  const seriesYesterday = trendSeries?.find(
    (point) => point.date === yesterdayStr,
  )
  const moneyFormat = (value: number) => formatMoney(value, currency)
  const countFormat = (value: number) => String(value)

  const salesChip =
    seriesToday && seriesYesterday ? (
      <TrendChip
        today={seriesToday.sales}
        yesterday={seriesYesterday.sales}
        format={moneyFormat}
      />
    ) : null
  const ordersChip =
    seriesToday && seriesYesterday ? (
      <TrendChip
        today={seriesToday.orders}
        yesterday={seriesYesterday.orders}
        format={countFormat}
      />
    ) : null
  const expensesChip =
    todayExpenses !== null && yesterdayTotals ? (
      <TrendChip
        today={todayExpenses}
        yesterday={yesterdayTotals.expenses}
        format={moneyFormat}
        invert
      />
    ) : null
  const netChip =
    todayExpenses !== null && seriesToday && yesterdayTotals ? (
      <TrendChip
        today={roundMoney(seriesToday.sales - todayExpenses)}
        yesterday={roundMoney(
          yesterdayTotals.sales - yesterdayTotals.expenses,
        )}
        format={moneyFormat}
      />
    ) : null

  const stats: {
    key: string
    icon: typeof ShoppingBag
    label: string
    value: string
    hint?: string
    chip?: ReactNode
  }[] = showFinancials
    ? [
        {
          key: 'sales',
          icon: ShoppingBag,
          label: t('dashboard.todaySales'),
          value: formatMoney(todaySales, currency),
          hint:
            ordersToday > 0
              ? t('dashboard.todaySalesHintHasData', { count: ordersToday })
              : t('dashboard.todaySalesHint'),
          chip: salesChip,
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
          chip: ordersChip,
        },
        ...(todayExpenses !== null
          ? [
              {
                key: 'expenses',
                icon: Wallet,
                label: t('dashboard.todayExpenses'),
                value: formatMoney(todayExpenses, currency),
                chip: expensesChip,
              },
              {
                key: 'net',
                icon: TrendingUp,
                label: t('dashboard.netToday'),
                value: formatMoney(netToday ?? 0, currency),
                hint: t('dashboard.netTodayHint'),
                chip: netChip,
              },
            ]
          : []),
      ]
    : [
        {
          key: 'orders',
          icon: ClipboardList,
          label: t('dashboard.ordersToday'),
          value: String(ordersToday),
          hint:
            ordersToday > 0
              ? t('dashboard.ordersTodayHintHasData', { count: ordersToday })
              : t('dashboard.ordersTodayHint'),
          chip: ordersChip,
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
      ]

  const hour = new Date().getHours()
  const greetingKey =
    hour < 12
      ? 'dashboard.greetingMorning'
      : hour < 17
        ? 'dashboard.greetingAfternoon'
        : 'dashboard.greetingEvening'
  const dateLine = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())

  const chartVisible = showFinancials && todayExpenses !== null

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {name ? t(greetingKey, { name }) : t('dashboard.title')}
          </h2>
          {restaurant && (
            <p className="mt-0.5 font-medium">{restaurant.name}</p>
          )}
          <p className="text-sm text-muted-foreground">{dateLine}</p>
        </div>
        {restaurant && (
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild>
              <Link to={navTo('/pos')}>{t('dashboard.quickNewOrder')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={navTo('/business')}>
                {t('dashboard.quickAddExpense')}
              </Link>
            </Button>
          </div>
        )}
      </header>

      <div
        className={`grid gap-4 sm:grid-cols-2 ${stats.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-2'}`}
      >
        {statsLoading && restaurant ? (
          <>
            {(showFinancials
              ? ['sales', 'orders', 'expenses', 'net']
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
          stats.map(({ key, icon: Icon, label, value, hint, chip }) => (
            <Card key={key}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                <CardTitle className="text-sm font-medium">{label}</CardTitle>
                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{value}</p>
                {hint && (
                  <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
                )}
                {chip && <p className="mt-2">{chip}</p>}
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

      {restaurant && (
        <LiveTablesCard
          restaurantId={restaurant.id}
          currency={currency}
          showFinancials={showFinancials}
          navTo={navTo}
        />
      )}

      {restaurant && (
        <OpsStrip
          counts={opsCounts}
          occupiedTables={occupiedTables}
          totalTables={totalTables}
          tablesKnown={tablesKnown}
          deliveryOn={deliveryOn}
          navTo={navTo}
        />
      )}

      {restaurant && showFinancials && (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div
            className={
              todayExpenses !== null ? 'lg:col-span-2' : 'lg:col-span-3'
            }
          >
            <HourlySalesCard
              orders={todayOrders}
              currency={currency}
              loading={statsLoading}
            />
          </div>
          {todayExpenses !== null && (
            <PaymentMixCard payments={paymentsToday} currency={currency} />
          )}
        </div>
      )}

      {restaurant && chartVisible && (
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.salesLast7Days')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={salesSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(date: string) =>
                      new Intl.DateTimeFormat(i18n.language, {
                        weekday: 'short',
                      }).format(new Date(`${date}T00:00:00`))
                    }
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value) => [
                      formatMoney(Number(value ?? 0), currency),
                      t('dashboard.todaySales'),
                    ]}
                    labelFormatter={(date) =>
                      new Intl.DateTimeFormat(i18n.language, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'short',
                      }).format(new Date(`${String(date)}T00:00:00`))
                    }
                  />
                  <Bar dataKey="sales" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {restaurant && (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {showFinancials && todayExpenses !== null && (
            <div className="lg:col-span-2">
              <TopItemsCard products={topProducts} currency={currency} />
            </div>
          )}
          <div
            className={
              showFinancials && todayExpenses !== null
                ? undefined
                : 'lg:col-span-3'
            }
          >
            <ShiftCard
              restaurantId={restaurant.id}
              userId={user?.id ?? null}
              myName={name}
              currency={currency}
              showOthersCash={showFinancials}
              navTo={navTo}
            />
          </div>
        </div>
      )}

      {restaurant && (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          <div
            className={showAlerts ? 'lg:col-span-2' : 'lg:col-span-3'}
          >
            <RecentOrdersCard
              orders={recentOrders}
              tableNames={tableNames}
              currency={currency}
              loading={statsLoading}
              navTo={navTo}
            />
          </div>
          {showAlerts && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{t('dashboard.alertsTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-6">
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
                      to={navTo('/inventory')}
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
                      to={navTo('/inventory')}
                      className="mt-2 inline-block text-sm font-medium text-primary"
                    >
                      {t('dashboard.viewInventory')} →
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
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
              <Link to={navTo('/settings')}>{t('dashboard.setupRestaurant')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
