// FoodX — App router.
//
// Hostname-based routing (Phase 5):
// - Platform hosts (foodx.bond, www.foodx.bond, *.vercel.app, localhost):
//   the admin app at /, plus the storefront preview via ?store=<slug>
//   (and ?store=<slug>&table=<code> to pre-select a table).
// - Any other hostname: resolved with resolve_restaurant_by_domain().
//   A match serves that restaurant's public storefront at / and the
//   admin app under /panel, locked to that restaurant. No match renders
//   an honest "domain not connected" page (never the admin login).
//
// The storefront needs no login and no router of its own (it uses plain
// links only); the admin app keeps its existing routes, under basename
// /panel on a restaurant domain.
import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AuthProvider } from './AuthProvider'
import ProtectedRoute from './ProtectedRoute'
import LoginPage from '@/modules/auth/LoginPage'
import ResetPasswordPage from '@/modules/auth/ResetPasswordPage'
import UpdatePasswordPage from '@/modules/auth/UpdatePasswordPage'
import DashboardPage from '@/modules/dashboard/DashboardPage'
import CustomersPage from '@/modules/customers/CustomersPage'
import InventoryPage from '@/modules/inventory/InventoryPage'
import KdsPage from '@/modules/kds/KdsPage'
import MenuPage from '@/modules/menu/MenuPage'
import OrderDetailPage from '@/modules/orders/OrderDetailPage'
import OrdersPage from '@/modules/orders/OrdersPage'
import PosPage from '@/modules/pos/PosPage'
import RolesPage from '@/modules/roles/RolesPage'
import SettingsPage from '@/modules/settings/SettingsPage'
import TablesPage from '@/modules/tables/TablesPage'
import DomainNotConnectedPage from '@/modules/storefront/DomainNotConnectedPage'
import StorefrontPage from '@/modules/storefront/StorefrontPage'
import { isPlatformHost, resolveDomain } from '@/services/storefront'
import type { ResolvedDomain } from '@/types'

/** The admin app: public auth pages + the protected pages. When
 * lockedRestaurantId is set (panel on a restaurant domain), the
 * protected area only serves the account whose profile points at that
 * restaurant (enforced in ProtectedRoute). */
function AdminRoutes({
  lockedRestaurantId,
}: {
  lockedRestaurantId?: string
}) {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/update-password" element={<UpdatePasswordPage />} />
      <Route
        element={<ProtectedRoute lockedRestaurantId={lockedRestaurantId} />}
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/pos" element={<PosPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:id" element={<OrderDetailPage />} />
        <Route path="/kds" element={<KdsPage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/tables" element={<TablesPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/roles" element={<RolesPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function HostRouter() {
  const { t } = useTranslation()
  const [hostname] = useState(() => window.location.hostname)
  const [pathname] = useState(() => window.location.pathname)
  const [search] = useState(
    () => new URLSearchParams(window.location.search),
  )
  const platform = isPlatformHost(hostname)
  const previewSlug = search.get('store')
  const tableCode = search.get('table')
  // undefined = resolution not finished yet (non-platform hosts only).
  const [resolved, setResolved] = useState<ResolvedDomain | null | undefined>(
    undefined,
  )
  const [resolveFailed, setResolveFailed] = useState(false)

  useEffect(() => {
    if (platform) return
    let cancelled = false
    void resolveDomain(hostname)
      .then((result) => {
        if (!cancelled) setResolved(result)
      })
      .catch((error: unknown) => {
        console.error('[App] domain resolution failed', error)
        if (!cancelled) setResolveFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [hostname, platform])

  // Platform host: admin app, or the storefront preview when
  // ?store=<slug> is present.
  if (platform) {
    if (previewSlug) {
      return <StorefrontPage slug={previewSlug} tableCode={tableCode} />
    }
    return (
      <BrowserRouter>
        <AdminRoutes />
      </BrowserRouter>
    )
  }

  // Restaurant domain: resolve first.
  if (resolveFailed) {
    return <DomainNotConnectedPage hostname={hostname} loadFailed />
  }
  if (resolved === undefined) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-4">
        <p className="text-muted-foreground">{t('common.loading')}</p>
      </main>
    )
  }
  if (resolved === null) {
    return <DomainNotConnectedPage hostname={hostname} />
  }

  // /panel/* on the restaurant's own domain: the admin app, locked to
  // this restaurant. Everything else is the public storefront.
  if (pathname === '/panel' || pathname.startsWith('/panel/')) {
    return (
      <BrowserRouter basename="/panel">
        <AdminRoutes lockedRestaurantId={resolved.restaurant_id} />
      </BrowserRouter>
    )
  }
  return <StorefrontPage slug={resolved.slug} tableCode={tableCode} />
}

export default function App() {
  return (
    <AuthProvider>
      <HostRouter />
    </AuthProvider>
  )
}
