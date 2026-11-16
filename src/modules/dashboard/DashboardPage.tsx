// FoodX — Dashboard (protected). Shows real data when the Phase 2
// tables exist (today's sales / orders from orders, active tables from
// tables); falls back to honest zero states when there is no data yet or
// the migration has not been applied. No fake numbers, no mock charts.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ClipboardList, ShoppingBag, Table2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { formatMoney } from '@/lib/money'
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
    return () => {
      cancelled = true
    }
  }, [restaurant])

  const hasData = todaySales > 0 || ordersToday > 0 || occupiedTables > 0

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
