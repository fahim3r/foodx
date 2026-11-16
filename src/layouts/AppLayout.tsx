// FoodX — AppLayout: sidebar + topbar + content area for protected pages.
// Branding colors from restaurant_settings are applied as CSS variables
// on the layout root (falling back to the brand orange / green defaults),
// so the primary color follows the restaurant's branding everywhere.
import { useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import {
  ChefHat,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Table2,
  UtensilsCrossed,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import logoMark from '@/assets/brand/logo-mark.webp'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const NAV_ITEMS = [
  { to: '/', key: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/pos', key: 'nav.pos', icon: ShoppingCart, end: false },
  { to: '/orders', key: 'nav.orders', icon: ClipboardList, end: false },
  { to: '/kds', key: 'nav.kds', icon: ChefHat, end: false },
  { to: '/menu', key: 'nav.menu', icon: UtensilsCrossed, end: false },
  { to: '/tables', key: 'nav.tables', icon: Table2, end: false },
  { to: '/settings', key: 'nav.settings', icon: Settings, end: false },
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
  const { t } = useTranslation()
  const { restaurant, settings } = useAuth()
  const displayName =
    settings?.branding_name ?? restaurant?.name ?? t('app.name')

  return (
    <div className="flex h-full flex-col">
      <Link
        to="/"
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-5 py-4"
      >
        {settings?.logo_url ? (
          <img
            src={settings.logo_url}
            alt={displayName}
            className="size-9 rounded-md object-contain"
          />
        ) : (
          <img
            src={logoMark}
            alt=""
            width={128}
            height={128}
            className="size-9 shrink-0 rounded-full"
          />
        )}
        <span className="truncate text-lg font-bold tracking-tight">
          {displayName}
        </span>
      </Link>
      <nav className="flex flex-col gap-1 px-3 py-2" aria-label={t('layout.nav')}>
        {NAV_ITEMS.map(({ to, key, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
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
        <p className="text-xs text-muted-foreground">{t('app.tagline')}</p>
      </div>
    </div>
  )
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { user, profile, restaurant, settings, dbPending, signOut } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

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
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
