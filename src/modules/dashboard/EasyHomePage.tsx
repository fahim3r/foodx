// FoodX — Easy Home (Easy Mode v2, wave E1; design §4). Replaces
// the dashboard while easy mode is on: today's picture in four big
// cards, an alert card only when something needs attention, and
// big task tiles instead of module names. Same data and same
// permission rules as the normal dashboard — the financial cards
// ride on reports.view exactly like the Wave-2 dashboard widgets,
// and every tile mirrors the sidebar's own gates (role permission,
// per-staff modules, restaurant module toggles, vendor flags).
// There is deliberately NO support / WhatsApp tile here (D4
// revised): help lives inside Settings, never on this screen.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import {
  BellRing,
  CalendarCheck,
  ChefHat,
  ClipboardList,
  Package,
  Receipt,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useLicenseState } from '@/hooks/useLicenseState'
import { usePermissions } from '@/hooks/usePermissions'
import { formatMoney, roundMoney } from '@/lib/money'
import { ELAPSED_ALERT_MINUTES, elapsedMinutes, useNow } from '@/lib/time'
import {
  fetchSupplierBalances,
  fetchTodayExpenseTotal,
  type SupplierBalanceRow,
} from '@/services/business'
import { isModuleEnabled } from '@/services/heartbeat'
import { fetchLowStockItems } from '@/services/inventory'
import { isModuleOn } from '@/services/modules'
import {
  fetchOrders,
  fetchPaymentsForOrders,
  fetchTodayOrders,
} from '@/services/orders'
import { summarizePayments } from '@/services/pos'
import {
  TERMINAL_ORDER_STATUSES,
  type InventoryItem,
  type Order,
  type OrderPayment,
} from '@/types'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

/** Per-device "the welcome guide has been seen" marker (design
 * §9): the guide auto-opens on a device's FIRST visit to easy
 * mode; closing it writes this key, and from then on it stays
 * closed until the "How it works" button re-opens it. */
function guideSeenKey(restaurantId: string): string {
  return `foodx.easy_guide_seen.${restaurantId}`
}

export default function EasyHomePage() {
  const { t } = useTranslation()
  const { profile, restaurant, settings } = useAuth()
  const { can, isAdminLevel, ready: permissionsReady } = usePermissions()
  const licenseView = useLicenseState()
  const { pathname } = useLocation()
  const now = useNow()

  // Same panel-root derivation as the sidebar (AppLayout): links
  // are right under both mountings (basename /panel on restaurant
  // domains, descendant /panel/* routes on platform hosts).
  const panelBase =
    pathname === '/panel' || pathname.startsWith('/panel/') ? '/panel' : ''
  const navTo = (to: string) =>
    to === '/' ? panelBase || '/' : `${panelBase}${to}`

  const currency = settings?.currency ?? restaurant?.default_currency ?? 'BDT'
  // Financial figures are report data (audit wave 2 rule, kept for
  // Easy Home): they wait for permissions to settle AND require
  // reports.view — a waiter sees the running-orders card only.
  const showFinancials = permissionsReady && can('reports.view')

  const [loading, setLoading] = useState(true)
  const [todayOrders, setTodayOrders] = useState<Order[]>([])
  const [recentOrders, setRecentOrders] = useState<Order[]>([])
  const [payments, setPayments] = useState<OrderPayment[]>([])
  const [todayExpenses, setTodayExpenses] = useState<number | null>(null)
  const [lowStockItems, setLowStockItems] = useState<InventoryItem[] | null>(
    null,
  )
  const [duesRows, setDuesRows] = useState<SupplierBalanceRow[] | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)
  const [guideChecked, setGuideChecked] = useState(false)

  // First visit to easy mode on this device: the welcome guide
  // starts OPEN (design §9). Once the restaurant is known, check
  // the seen marker exactly once; closing the guide (below)
  // writes it, so later visits start closed.
  useEffect(() => {
    if (!restaurant || guideChecked) return
    let seen = true
    try {
      seen = localStorage.getItem(guideSeenKey(restaurant.id)) === '1'
    } catch {
      // Storage unavailable: treat as seen rather than nagging on
      // every visit.
      seen = true
    }
    if (!seen) setGuideOpen(true)
    setGuideChecked(true)
  }, [restaurant, guideChecked])

  const closeGuide = () => {
    setGuideOpen(false)
    if (!restaurant) return
    try {
      localStorage.setItem(guideSeenKey(restaurant.id), '1')
    } catch {
      // Storage unavailable: the guide may auto-open again on the
      // next visit — acceptable, it is one tap to close.
    }
  }

  useEffect(() => {
    if (!restaurant) return
    let cancelled = false
    void (async () => {
      try {
        const [today, recent] = await Promise.all([
          fetchTodayOrders(restaurant.id),
          fetchOrders(restaurant.id, { limit: 100 }),
        ])
        if (cancelled) return
        setTodayOrders(today)
        setRecentOrders(recent)
        const orderPayments = await fetchPaymentsForOrders(
          today.map((order) => order.id),
        )
        if (!cancelled) setPayments(orderPayments)
      } catch (error: unknown) {
        // Missing tables (migration not applied) or a network
        // error: stay on the honest zero states, like the dashboard.
        console.error('[EasyHome] could not load today’s orders', error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    void fetchTodayExpenseTotal(restaurant.id)
      .then((total) => {
        if (!cancelled) setTodayExpenses(total)
      })
      .catch(() => {
        // Business tables not applied: the expense card hides.
      })
    void fetchLowStockItems(restaurant.id)
      .then((items) => {
        if (!cancelled) setLowStockItems(items)
      })
      .catch(() => {
        // Inventory tables not applied: the alert line hides.
      })
    void fetchSupplierBalances(restaurant.id)
      .then((rows) => {
        if (!cancelled) setDuesRows(rows)
      })
      .catch(() => {
        // Business tables not applied: the alert line hides.
      })
    return () => {
      cancelled = true
    }
  }, [restaurant])

  const todaySales = roundMoney(
    todayOrders.reduce((sum, order) => sum + Number(order.total_amount), 0),
  )
  const runningOrders = recentOrders.filter(
    (order) => !TERMINAL_ORDER_STATUSES.includes(order.status),
  )
  const staleCount = runningOrders.filter(
    (order) => elapsedMinutes(order.created_at, now) >= ELAPSED_ALERT_MINUTES,
  ).length

  // পাওনা বাকি: what customers still owe on today's orders — the
  // recorded "due" part plus the not-yet-paid balance, per order.
  const paymentsByOrder = new Map<string, OrderPayment[]>()
  for (const payment of payments) {
    const list = paymentsByOrder.get(payment.order_id) ?? []
    list.push(payment)
    paymentsByOrder.set(payment.order_id, list)
  }
  let dueTotal = 0
  for (const order of todayOrders) {
    const summary = summarizePayments(
      paymentsByOrder.get(order.id) ?? [],
      Number(order.total_amount),
    )
    dueTotal += Math.max(0, summary.due + summary.balance)
  }
  dueTotal = roundMoney(dueTotal)

  const duesOwed = (duesRows ?? []).filter((row) => row.due > 0)
  const duesTotal = roundMoney(
    duesOwed.reduce((sum, row) => sum + row.due, 0),
  )
  const hasLowStock = lowStockItems !== null && lowStockItems.length > 0
  const hasDues = showFinancials && duesOwed.length > 0
  const showAlerts = hasLowStock || hasDues || staleCount > 0

  // Task tiles mirror the sidebar's gates for the same routes
  // (AppLayout): role permission, per-staff module restriction
  // (admin-level bypasses), restaurant module toggle, vendor flag.
  const staffModules: string[] | null = Array.isArray(profile?.modules)
    ? profile.modules
    : null
  const staffOk = (key: string): boolean =>
    isAdminLevel || staffModules === null || staffModules.includes(key)
  const businessOk =
    can('reports.view') &&
    isModuleOn(settings, 'business') &&
    isModuleEnabled(licenseView, 'accounting') &&
    staffOk('business')
  const tiles = [
    {
      key: 'newOrder',
      to: '/pos',
      icon: ShoppingCart,
      label: t('easy.nav.newOrder'),
      show: can('orders.create') && staffOk('pos'),
    },
    {
      key: 'collect',
      to: '/orders',
      icon: Wallet,
      label: t('easy.tile.collectMoney'),
      show: can('orders.view') && staffOk('orders'),
    },
    {
      key: 'expense',
      to: '/business',
      icon: Receipt,
      label: t('easy.tile.addExpense'),
      show: businessOk,
    },
    {
      key: 'kitchen',
      to: '/kds',
      icon: ChefHat,
      label: t('easy.nav.kitchen'),
      show: can('kitchen.view') && staffOk('kds'),
    },
    {
      key: 'serve',
      to: '/serve',
      icon: BellRing,
      label: t('easy.nav.serve'),
      show: can('kitchen.view') && staffOk('serve'),
    },
    {
      key: 'dayEnd',
      to: '/business',
      icon: CalendarCheck,
      label: t('easy.tile.dayEnd'),
      show: businessOk,
    },
  ].filter((tile) => tile.show)

  const cards = [
    {
      key: 'sales',
      financial: true,
      icon: ShoppingBag,
      label: t('easy.home.todaySales'),
      value: formatMoney(todaySales, currency),
    },
    {
      key: 'running',
      financial: false,
      icon: ClipboardList,
      label: t('easy.home.runningOrders'),
      value: String(runningOrders.length),
    },
    ...(todayExpenses !== null
      ? [
          {
            key: 'expenses',
            financial: true,
            icon: Receipt,
            label: t('easy.home.todayExpenses'),
            value: formatMoney(todayExpenses, currency),
          },
        ]
      : []),
    {
      key: 'due',
      financial: true,
      icon: TrendingUp,
      label: t('easy.home.dueLeft'),
      value: formatMoney(dueTotal, currency),
    },
  ].filter((card) => !card.financial || showFinancials)

  if (!restaurant) {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h2 className="text-2xl font-bold tracking-tight">
            {t('easy.nav.today')}
          </h2>
          <p className="text-muted-foreground">{t('easy.home.helpLine')}</p>
        </header>
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.gettingStartedTitle')}</CardTitle>
            <CardDescription>
              {t('dashboard.gettingStartedBody')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to={navTo('/settings')}>
                {t('dashboard.setupRestaurant')}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-bold tracking-tight">
          {t('easy.nav.today')}
        </h2>
        <p className="text-muted-foreground">{t('easy.home.helpLine')}</p>
      </header>

      {!permissionsReady || loading ? (
        <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
          {[0, 1].map((index) => (
            <Card key={index}>
              <CardHeader className="pb-2">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="h-10 w-32 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map(({ key, icon: Icon, label, value }) => (
              <Card key={key}>
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-base font-medium">
                    {label}
                  </CardTitle>
                  <Icon className="size-5 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <p className="text-4xl font-bold">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {showAlerts && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {t('easy.home.alertsTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-base">
                {hasLowStock && (
                  <p className="flex items-center gap-2">
                    <Package className="size-5 shrink-0 text-amber-700" />
                    {t('dashboard.lowStockHint', {
                      count: lowStockItems?.length ?? 0,
                    })}
                  </p>
                )}
                {hasDues && (
                  <p className="flex items-center gap-2">
                    <Wallet className="size-5 shrink-0 text-amber-700" />
                    {t('easy.supplierDues')}
                    {': '}
                    {formatMoney(duesTotal, currency)}
                  </p>
                )}
                {staleCount > 0 && (
                  <p className="flex items-center gap-2">
                    <ClipboardList className="size-5 shrink-0 text-amber-700" />
                    {t('easy.home.staleOrders', { count: staleCount })}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map(({ key, to, icon: Icon, label }) => (
              <Link
                key={key}
                to={navTo(to)}
                className="flex items-center gap-3 rounded-xl border bg-card p-5 text-lg font-semibold shadow-sm transition-colors hover:bg-accent"
              >
                <Icon className="size-7 shrink-0 text-primary" />
                {label}
              </Link>
            ))}
          </div>

          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => (guideOpen ? closeGuide() : setGuideOpen(true))}
              aria-expanded={guideOpen}
            >
              {t('easy.guide.title')}
            </Button>
            {guideOpen && (
              <Card className="mt-4">
                <CardContent className="flex flex-col gap-4 pt-6">
                  <div className="grid gap-4 sm:grid-cols-3">
                    {[
                      t('easy.guide.step1'),
                      t('easy.guide.step2'),
                      t('easy.guide.step3'),
                    ].map((step, index) => (
                      <div
                        key={step}
                        className="rounded-lg bg-muted p-4 text-center"
                      >
                        <p className="text-2xl font-bold text-primary">
                          {index + 1}
                        </p>
                        <p className="mt-1 font-medium">{step}</p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={closeGuide}
                    >
                      {t('easy.guide.close')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  )
}
