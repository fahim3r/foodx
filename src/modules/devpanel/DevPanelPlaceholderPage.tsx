// FoodX — Developer Panel placeholder.
// Shown at /devpanel on the platform hosts. The real Developer
// Control Panel is Phase 8 (Developer Platform) work, so this page is
// deliberately honest: no fake controls, no fake data, no login form —
// just the note that it arrives with Phase 8, and a link back to the
// public storefront.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function DevPanelPlaceholderPage() {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          {t('devpanel.title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('devpanel.body')}
        </p>
        <p className="mt-4 text-sm">
          <Link
            to="/"
            className="font-medium text-primary hover:underline"
          >
            {t('devpanel.backToStore')}
          </Link>
        </p>
      </div>
    </main>
  )
}
