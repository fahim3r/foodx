// FoodX — App router.
//
// Hostname-based routing:
// - Platform hosts (foodx.bond, www.foodx.bond, *.vercel.app, localhost)
//   — one router (PlatformRoutes):
//   - /panel/* → the admin app (AdminRoutes, mounted as a descendant;
//     its route paths are relative on purpose — see the note there).
//     Signed in → Dashboard, signed out → Login page.
//   - /devpanel* → the Developer Panel (Phase 8): its own sign-in gate
//     plus the developer allow-list; fully separated from /panel (§88).
//   - Legacy admin URLs (/login, /pos, /orders, …) redirect to their
//     /panel/* equivalents, query string included.
//   - / (no ?store= / ?table=) → the FoodX marketing landing page.
//     The live demo moved to demo.foodx.bond, which is NOT a platform
//     host: it resolves through restaurant_domains like a real client
//     domain (owner's decision 2026-11-18).
//   - Anything else → the public storefront: the FoodX Demo
//     restaurant (DEFAULT_DEMO_STORE_SLUG) by default, or
//     ?store=<slug> to preview another restaurant (and
//     ?store=<slug>&table=<code> to pre-select a table).
// - Any other hostname: resolved with resolve_restaurant_by_domain().
//   A match serves that restaurant's public storefront at / and the
//   admin app under /panel, locked to that restaurant. No match renders
//   an honest "domain not connected" page (never the admin login).
//
// The storefront needs no login and no router of its own (it uses plain
// links only).
import { useEffect, useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AuthProvider } from './AuthProvider'
import { isNetworkError } from '@/lib/errors'
import { loadDomainCache, saveDomainCache } from '@/services/catalogCache'
import ProtectedRoute from './ProtectedRoute'
import LoginPage from '@/modules/auth/LoginPage'
import ResetPasswordPage from '@/modules/auth/ResetPasswordPage'
import UpdatePasswordPage from '@/modules/auth/UpdatePasswordPage'
import DashboardPage from '@/modules/dashboard/DashboardPage'
import CustomersPage from '@/modules/customers/CustomersPage'
import BusinessPage from '@/modules/business/BusinessPage'
import DeliveryPage from '@/modules/delivery/DeliveryPage'
import InventoryPage from '@/modules/inventory/InventoryPage'
import KdsPage from '@/modules/kds/KdsPage'
import ServePage from '@/modules/serve/ServePage'
import DisplayPage from '@/modules/display/DisplayPage'
import ReservationsPage from '@/modules/reservations/ReservationsPage'
import MenuPage from '@/modules/menu/MenuPage'
import OrderDetailPage from '@/modules/orders/OrderDetailPage'
import OrdersPage from '@/modules/orders/OrdersPage'
import PosPage from '@/modules/pos/PosPage'
import WaiterPage from '@/modules/waiter/WaiterPage'
import RolesPage from '@/modules/roles/RolesPage'
import SettingsPage from '@/modules/settings/SettingsPage'
import HealthPage from '@/modules/health/HealthPage'
import ModuleGate from '@/components/ModuleGate'
import SetupPage from '@/modules/settings/SetupPage'
import StaffPage from '@/modules/staff/StaffPage'
import BranchesPage from '@/modules/branches/BranchesPage'
import TablesPage from '@/modules/tables/TablesPage'
import DevPanelPage from '@/modules/devpanel/DevPanelPage'
import LandingPage from '@/modules/landing/LandingPage'
import DomainNotConnectedPage from '@/modules/storefront/DomainNotConnectedPage'
import StorefrontPage from '@/modules/storefront/StorefrontPage'
import {
  DEFAULT_DEMO_STORE_SLUG,
  isPlatformHost,
  resolveDomain,
} from '@/services/storefront'
import type { ResolvedDomain } from '@/types'

/** The admin app: public auth pages + the protected pages. When
 * lockedRestaurantId is set (panel on a restaurant domain), the
 * protected area only serves the account whose profile points at that
 * restaurant (enforced in ProtectedRoute).
 *
 * NOTE: the route paths here are RELATIVE (no leading slash) on
 * purpose. AdminRoutes is mounted two ways — as a descendant of
 * /panel/* on the platform hosts, and under basename /panel on a
 * restaurant domain — and relative paths resolve correctly under both.
 * Absolute paths would match the wrong place in one of the two
 * mountings. The same rule applies to navigation inside the admin
 * (ProtectedRoute, the auth pages): relative where the target is a
 * sibling admin page. */
function AdminRoutes({
  lockedRestaurantId,
}: {
  lockedRestaurantId?: string
}) {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />
      <Route path="update-password" element={<UpdatePasswordPage />} />
      <Route
        element={<ProtectedRoute lockedRestaurantId={lockedRestaurantId} />}
      >
        <Route index element={<DashboardPage />} />
        <Route path="pos" element={<PosPage />} />
        <Route path="waiter" element={<WaiterPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
        <Route path="kds" element={<KdsPage />} />
        <Route path="serve" element={<ServePage />} />
        <Route path="display" element={<DisplayPage />} />
        <Route path="reservations" element={<ModuleGate module="reservations"><ReservationsPage /></ModuleGate>} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="tables" element={<TablesPage />} />
        <Route path="customers" element={<ModuleGate module="customers"><CustomersPage /></ModuleGate>} />
        <Route path="delivery" element={<ModuleGate module="delivery"><DeliveryPage /></ModuleGate>} />
        <Route path="business" element={<ModuleGate module="business"><BusinessPage /></ModuleGate>} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="health" element={<HealthPage />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="branches" element={<BranchesPage />} />
        <Route path="roles" element={<RolesPage />} />
      </Route>
      <Route path="*" element={<Navigate to="." replace />} />
    </Routes>
  )
}

/** Admin paths from before the /panel move (platform hosts only).
 * Visiting one redirects to its /panel/* equivalent, so old links and
 * bookmarks keep working. */
const LEGACY_ADMIN_PATHS = [
  '/login',
  '/reset-password',
  '/update-password',
  '/pos',
  '/orders',
  '/orders/:id',
  '/kds',
  '/menu',
  '/inventory',
  '/tables',
  '/customers',
  '/delivery',
  '/business',
  '/settings',
  '/roles',
] as const

/** Redirect a legacy admin URL to its /panel/* equivalent, keeping
 * the query string (e.g. /orders/abc?x=1 → /panel/orders/abc?x=1). */
function LegacyAdminRedirect() {
  const { pathname, search } = useLocation()
  return <Navigate to={`/panel${pathname}${search}`} replace />
}

/**
 * The platform hosts in one router: /panel/* is the admin app,
 * /devpanel* is the Developer Panel (Phase 8), the legacy
 * admin URLs redirect to their /panel/* equivalents, the root is
 * the marketing landing page, and everything else is the public
 * storefront — the demo restaurant by default, or ?store=<slug>
 * to preview another restaurant. A ?store= or ?table= on the root
 * keeps the old preview behaviour, so existing demo/QR links to
 * the platform host keep landing on the storefront.
 */
function PlatformRoutes({
  previewSlug,
  tableCode,
}: {
  previewSlug: string | null
  tableCode: string | null
}) {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/panel/*" element={<AdminRoutes />} />
        <Route path="/devpanel" element={<DevPanelPage />} />
        <Route path="/devpanel/*" element={<DevPanelPage />} />
        {LEGACY_ADMIN_PATHS.map((path) => (
          <Route
            key={path}
            path={path}
            element={<LegacyAdminRedirect />}
          />
        ))}
        <Route
          path="/"
          element={
            previewSlug || tableCode ? (
              <StorefrontPage
                slug={previewSlug ?? DEFAULT_DEMO_STORE_SLUG}
                tableCode={tableCode}
              />
            ) : (
              <LandingPage />
            )
          }
        />
        <Route
          path="/*"
          element={
            <StorefrontPage
              slug={previewSlug ?? DEFAULT_DEMO_STORE_SLUG}
              tableCode={tableCode}
            />
          }
        />
      </Routes>
    </BrowserRouter>
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
        if (cancelled) return
        if (result) saveDomainCache(hostname, result)
        setResolved(result)
      })
      .catch((error: unknown) => {
        console.error('[App] domain resolution failed', error)
        if (cancelled) return
        // Phase 9 v2.1: offline on a restaurant domain — fall
        // back to the saved resolution so a cold start still
        // opens the panel; the workspace + POS caches take it
        // from there. No saved resolution → the honest
        // load-failed page, as before.
        if (isNetworkError(error) || !navigator.onLine) {
          const cached = loadDomainCache(hostname)
          if (cached) {
            setResolved(cached)
            return
          }
        }
        setResolveFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [hostname, platform])

  // Platform host: one router — /panel/* admin, /devpanel vendor panel,
  // legacy admin redirects, the landing page at the root, and the demo
  // storefront for everything else (?store=<slug> previews another
  // restaurant).
  if (platform) {
    return <PlatformRoutes previewSlug={previewSlug} tableCode={tableCode} />
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
