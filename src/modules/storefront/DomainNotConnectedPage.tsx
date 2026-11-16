// FoodX — "domain not connected" page (Phase 5).
// Shown on a hostname that no FoodX restaurant owns. It never renders
// the admin login: a stray domain must not become a way into the app.
import { useTranslation } from 'react-i18next'

export default function DomainNotConnectedPage({
  hostname,
  loadFailed,
}: {
  hostname: string
  loadFailed?: boolean
}) {
  const { t } = useTranslation()
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          {t('panel.domainNotConnectedTitle')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(
            loadFailed
              ? 'panel.domainCheckFailed'
              : 'panel.domainNotConnectedBody',
            { domain: hostname },
          )}
        </p>
        <p className="mt-4 text-sm">
          <a
            href="https://www.foodx.bond"
            className="font-medium text-primary hover:underline"
          >
            www.foodx.bond
          </a>
        </p>
      </div>
    </main>
  )
}
