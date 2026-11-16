// FoodX — ProtectedRoute: redirects unauthenticated users to /login.
// Renders the app layout (sidebar + topbar) around the protected page.
//
// Panel lock (Phase 5): when lockedRestaurantId is set, this route runs
// under /panel on a restaurant's own domain, and only the account whose
// profile points at that restaurant may manage it. A signed-in account
// for another restaurant (or with no restaurant linked) sees an honest
// notice instead of the admin — it can never see another restaurant's
// data through this domain.
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import AppLayout from '@/layouts/AppLayout'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function ProtectedRoute({
  lockedRestaurantId,
}: {
  lockedRestaurantId?: string
}) {
  const { user, profile, loading, signOut } = useAuth()
  const { t } = useTranslation()

  if (loading) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-4">
        <p className="text-muted-foreground">{t('common.loading')}</p>
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (lockedRestaurantId) {
    const wrongRestaurant =
      profile?.restaurant_id && profile.restaurant_id !== lockedRestaurantId
    const noRestaurant = !profile?.restaurant_id
    if (wrongRestaurant || noRestaurant) {
      return (
        <main className="flex min-h-svh items-center justify-center bg-background px-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>
                {t(
                  wrongRestaurant
                    ? 'panel.wrongRestaurantTitle'
                    : 'panel.noRestaurantTitle',
                )}
              </CardTitle>
              <CardDescription>
                {t(
                  wrongRestaurant
                    ? 'panel.wrongRestaurantBody'
                    : 'panel.noRestaurantBody',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                variant="outline"
                onClick={() => void signOut()}
              >
                {t('auth.signOut')}
              </Button>
            </CardContent>
          </Card>
        </main>
      )
    }
  }

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  )
}
