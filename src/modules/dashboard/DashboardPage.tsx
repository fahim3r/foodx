// FoodX — Dashboard (protected). Honest empty states only: the orders /
// tables / menu modules do not exist yet in Phase 1, so there is no real
// sales data to show. No fake numbers, no mock charts.
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ClipboardList, ShoppingBag, Table2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
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

  const stats = [
    {
      key: 'sales',
      icon: ShoppingBag,
      label: t('dashboard.todaySales'),
      value: t('dashboard.todaySalesValue', { amount: 0, currency }),
      hint: t('dashboard.todaySalesHint'),
    },
    {
      key: 'orders',
      icon: ClipboardList,
      label: t('dashboard.ordersToday'),
      value: '0',
      hint: t('dashboard.ordersTodayHint'),
    },
    {
      key: 'tables',
      icon: Table2,
      label: t('dashboard.activeTables'),
      value: '0',
      hint: t('dashboard.activeTablesHint'),
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
              <p className="mt-2 inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {t('dashboard.noDataYet')}
              </p>
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
