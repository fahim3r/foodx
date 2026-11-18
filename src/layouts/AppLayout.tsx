// FoodX — AppLayout: sidebar + topbar + content area for protected pages.
// Branding colors from restaurant_settings are applied as CSS variables
// on the layout root (falling back to the brand orange / green defaults),
// so the primary color follows the restaurant's branding everywhere.
import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Boxes,
  Building2,
  ChefHat,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Table2,
  Truck,
  UserCog,
  Users,
  Wallet,
  UtensilsCrossed,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useLicenseState } from '@/hooks/useLicenseState'
import {
  isModuleEnabled,
  runHeartbeat,
  requestUpdate,
  type UpdateRequestResult,
} from '@/services/heartbeat'
import { refreshInstanceConfig } from '@/services/activation'
import type { DevFeatureKey } from '@/types'
import logoWordmark from '@/assets/brand/logo-wordmark.webp'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const NAV_ITEMS = [
  { to: '/', key: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/pos', key: 'nav.pos', icon: ShoppingCart, end: false },
  { to: '/orders', key: 'nav.orders', icon: ClipboardList, end: false },
  { to: '/kds', key: 'nav.kds', icon: ChefHat, end: false },
  { to: '/menu', key: 'nav.menu', icon: UtensilsCrossed, end: false },
  { to: '/inventory', key: 'nav.inventory', icon: Boxes, end: false },
  { to: '/tables', key: 'nav.tables', icon: Table2, end: false },
  { to: '/customers', key: 'nav.customers', icon: Users, end: false },
  {
    to: '/delivery',
    key: 'nav.delivery',
    icon: Truck,
    end: false,
    feature: 'delivery' as DevFeatureKey,
  },
  {
    to: '/business',
    key: 'nav.business',
    icon: Wallet,
    end: false,
    feature: 'accounting' as DevFeatureKey,
  },
  {
    to: '/branches',
    key: 'nav.branches',
    icon: Building2,
    end: false,
    feature: 'multi_branch' as DevFeatureKey,
  },
  { to: '/settings', key: 'nav.settings', icon: Settings, end: false },
  { to: '/staff', key: 'nav.staff', icon: UserCog, end: false },
  { to: '/roles', key: 'nav.roles', icon: ShieldCheck, end: false },
] as const

function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  const current = i18n.language?.startsWith('bn') ? 'bn' : 'en'

  const switchTo = (lng: 'en' | 'bn') => {
    void i18n.changeLanguage(lng)
    try {
      window.localStorage.setItem('foodx.language', lng)
    } catch {
      // Storage unavailable (private mode) — language still switches
      // for this session.
    }
  }

  return (
    <div
      className="flex items-center rounded-md border p-0.5"
      role="group"
      aria-label={t('common.language')}
    >
      {(
        [
          { code: 'en', label: 'EN' },
          { code: 'bn', label: 'বাং' },
        ] as const
      ).map(({ code, label }) => (
        <button
          key={code}
          type="button"
          onClick={() => switchTo(code)}
          aria-pressed={current === code}
          className={cn(
            'rounded px-2 py-1 text-xs font-medium transition-colors',
            current === code
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const licenseView = useLicenseState()
  const { t } = useTranslation()
  const { restaurant, settings } = useAuth()
  const { pathname } = useLocation()
  // The admin lives under /panel in both mountings, but the router
  // reports the path differently: under basename /panel (restaurant
  // domain) useLocation() returns the stripped path ("/pos"), while
  // as a descendant of /panel/* (platform hosts) it returns the full
  // path ("/panel/pos"). Derive the prefix from that, so the sidebar
  // links (and their active state) are right in both cases.
  const panelBase =
    pathname === '/panel' || pathname.startsWith('/panel/') ? '/panel' : ''
  const navTo = (to: string) =>
    to === '/' ? panelBase || '/' : `${panelBase}${to}`
  const displayName =
    settings?.branding_name ?? restaurant?.name ?? t('app.name')
  // Sidebar header: the restaurant logo only. The name appears next to it
  // only when a display name is set in Settings → Branding; otherwise
  // just the logo shows.
  const sidebarName = settings?.branding_name?.trim() ?? ''

  return (
    <div className="flex h-full flex-col">
      {/*
        Plain anchor (not a router Link): the logo must go to the panel
        root (/panel) from any admin page, at any depth. A router Link
        to="/" would land on the public storefront on platform hosts,
        and to="/panel" would gain a second /panel under the basename
        mounting on restaurant domains.
      */}
      <a
        href="/panel"
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-5 py-4"
      >
        {settings?.logo_url ? (
          <img
            src={settings.logo_url}
            alt={sidebarName || displayName}
            className="h-9 w-auto max-w-44 shrink-0 rounded-md object-contain"
          />
        ) : (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-base font-bold text-primary-foreground">
            {displayName.charAt(0).toUpperCase()}
          </span>
        )}
        {sidebarName ? (
          <span className="truncate text-lg font-bold tracking-tight">
            {sidebarName}
          </span>
        ) : null}
      </a>
      <nav className="flex flex-col gap-1 px-3 py-2" aria-label={t('layout.nav')}>
        {NAV_ITEMS.filter(
          (item) =>
            !('feature' in item && item.feature) ||
            isModuleEnabled(licenseView, item.feature),
        ).map(({ to, key, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={navTo(to)}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            {t(key)}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto px-5 py-4">
        <img
          src={logoWordmark}
          alt="FoodX"
          width={480}
          height={119}
          className="h-7 w-auto"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">{t('app.tagline')}</p>
      </div>
    </div>
  )
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const licenseView = useLicenseState()

  // Phone home on panel load and every 6 hours while open (Phase 8
  // step 2). The activation-written instance_config is loaded first
  // (landing/onboarding step 2), so heartbeats use it when present;
  // env provisioning stays the fallback. Inert on unconfigured
  // deployments.
  useEffect(() => {
    void refreshInstanceConfig().then(() => runHeartbeat())
    const id = window.setInterval(
      () => {
        void runHeartbeat()
      },
      6 * 60 * 60 * 1000,
    )
    return () => window.clearInterval(id)
  }, [])
  const navigate = useNavigate()
  const { user, profile, restaurant, settings, dbPending, signOut } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateResult, setUpdateResult] =
    useState<UpdateRequestResult | null>(null)

  const handleUpdateNow = async () => {
    setUpdateBusy(true)
    setUpdateResult(null)
    const result = await requestUpdate()
    setUpdateResult(result)
    setUpdateBusy(false)
  }

  const displayName =
    settings?.branding_name ?? restaurant?.name ?? t('app.name')

  const brandingStyle = {
    '--primary': settings?.primary_color ?? '#ea580c',
    '--ring': settings?.primary_color ?? '#ea580c',
    '--sidebar-primary': settings?.primary_color ?? '#ea580c',
  } as CSSProperties

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut()
      void navigate('/login', { replace: true })
    } finally {
      setSigningOut(false)
      setMenuOpen(false)
    }
  }

  const userLabel = profile?.full_name ?? user?.email ?? ''

  return (
    <div style={brandingStyle} className="min-h-svh bg-background">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label={t('layout.closeMenu')}
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 border-r bg-sidebar text-sidebar-foreground transition-transform md:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <SidebarContent onNavigate={() => setSidebarOpen(false)} />
      </aside>

      <div className="flex min-h-svh flex-col md:pl-64">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('layout.menu')}
          >
            <Menu className="size-5" />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
            {displayName}
          </h1>
          <LanguageSwitcher />
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {userLabel.charAt(0).toUpperCase() || '?'}
              </span>
              <span className="hidden max-w-40 truncate sm:inline">{userLabel}</span>
            </Button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label={t('layout.closeMenu')}
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-40 cursor-default"
                />
                <div
                  role="menu"
                  className="absolute right-0 z-50 mt-2 w-64 rounded-md border bg-popover p-2 shadow-md"
                >
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t('layout.signedInAs')}
                  </p>
                  <p className="truncate px-2 pb-2 text-sm font-medium">
                    {user?.email}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    role="menuitem"
                    className="w-full justify-start text-destructive hover:text-destructive"
                    onClick={handleSignOut}
                    disabled={signingOut}
                  >
                    <LogOut className="size-4" />
                    {signingOut ? t('common.loading') : t('auth.signOut')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-5xl">
            {dbPending && (
              <div
                role="alert"
                className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
              >
                <p className="font-semibold">{t('layout.dbPendingTitle')}</p>
                <p className="mt-1">{t('layout.dbPendingBody')}</p>
              </div>
            )}
            {!dbPending && user && !profile && (
              <div
                role="alert"
                className="mb-6 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900"
              >
                <p className="font-semibold">{t('layout.noProfileTitle')}</p>
                <p className="mt-1">{t('layout.noProfileBody')}</p>
                <Button
                  variant="link"
                  size="sm"
                  className="mt-1 h-auto p-0 text-sky-900"
                  onClick={() => void navigate('/settings')}
                >
                  {t('layout.goToSettings')}
                </Button>
              </div>
            )}
            {licenseView.display === 'WARNING' && licenseView.reason && (
              <div
                role="alert"
                className="mb-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900"
              >
                <p className="font-semibold">
                  {t(`license.bannerWarning_${licenseView.reason}`)}
                </p>
                <p className="mt-1">{t('license.bannerWarningBody')}</p>
                <Button
                  variant="link"
                  size="sm"
                  className="mt-1 h-auto p-0 text-red-900"
                  onClick={() => void navigate('/settings')}
                >
                  {t('layout.goToSettings')}
                </Button>
              </div>
            )}
            {licenseView.display === 'EXPIRING' && licenseView.cache?.license && (
              <div
                role="alert"
                className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
              >
                <p className="font-semibold">
                  {t('license.bannerExpiring', {
                    date: licenseView.cache.license.expiry_date ?? '',
                  })}
                </p>
              </div>
            )}
            {licenseView.updateAvailable && licenseView.cache?.latest_release && (
              <div className="mb-6 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900">
                <p className="font-semibold">
                  {t('license.bannerUpdate', {
                    version: licenseView.cache.latest_release.version,
                  })}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Button
                    size="sm"
                    onClick={() => void handleUpdateNow()}
                    disabled={updateBusy || updateResult === 'triggered'}
                  >
                    {updateBusy
                      ? t('license.updateBusy')
                      : t('license.updateNow')}
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-sky-900"
                    onClick={() => void navigate('/settings')}
                  >
                    {t('layout.goToSettings')}
                  </Button>
                </div>
                {updateResult && (
                  <p className="mt-2">
                    {updateResult === 'triggered'
                      ? t('license.updateTriggered')
                      : updateResult === 'backup_required'
                        ? t('license.updateBackupRequired')
                        : updateResult === 'no_deploy_hook'
                          ? t('license.updateNoHook')
                          : updateResult === 'client_not_active'
                            ? t('license.updateNotActive')
                            : t('license.updateFailed')}
                  </p>
                )}
              </div>
            )}
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
