import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { APP_VERSION } from '@/lib/version'
import { useLicenseState } from '@/hooks/useLicenseState'
import {
  heartbeatInstanceId,
  isHeartbeatConfigured,
  runHeartbeat,
} from '@/services/heartbeat'
import { DEV_FEATURE_KEYS } from '@/types'

/**
 * Settings → License & updates (§42, Phase 8 step 2). Shows what the
 * vendor registry last told this deployment: license state, feature
 * flags as pulled, and whether a newer release exists. On deployments
 * without heartbeat env values it says so honestly instead of faking
 * a status.
 */
export default function LicenseCard() {
  const { t } = useTranslation()
  const view = useLicenseState()
  const [checking, setChecking] = useState(false)
  const [checkFailed, setCheckFailed] = useState(false)

  const configured = isHeartbeatConfigured()
  const cache = view.cache

  const handleCheckNow = async () => {
    setChecking(true)
    setCheckFailed(false)
    const ok = await runHeartbeat()
    setChecking(false)
    if (!ok) setCheckFailed(true)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('license.cardTitle')}</CardTitle>
        <CardDescription>{t('license.cardDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">
              {t('license.instanceId')}:{' '}
            </span>
            {heartbeatInstanceId() ?? '—'}
          </p>
          <p>
            <span className="text-muted-foreground">
              {t('license.appVersion')}:{' '}
            </span>
            {APP_VERSION}
          </p>
          <p>
            <span className="text-muted-foreground">
              {t('license.lastValidated')}:{' '}
            </span>
            {cache
              ? new Date(cache.fetched_at).toLocaleString()
              : t('license.neverValidated')}
          </p>
          <p>
            <span className="text-muted-foreground">
              {t('license.latestVersion')}:{' '}
            </span>
            {cache?.latest_release ? cache.latest_release.version : '—'}
          </p>
        </div>

        {!configured && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t('license.notConfigured')}
          </p>
        )}

        {configured && !cache && (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t('license.notValidatedYet')}
          </p>
        )}

        {cache && (
          <>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p>
                <span className="text-muted-foreground">
                  {t('license.licenseStatus')}:{' '}
                </span>
                {cache.license
                  ? t(`devpanel.licenseStatus_${cache.license.status}`)
                  : t('license.noLicense')}
              </p>
              <p>
                <span className="text-muted-foreground">
                  {t('license.licensePlan')}:{' '}
                </span>
                {cache.license
                  ? t(`devpanel.plan_${cache.license.plan}`)
                  : '—'}
              </p>
              <p>
                <span className="text-muted-foreground">
                  {t('license.licenseExpiry')}:{' '}
                </span>
                {cache.license
                  ? (cache.license.expiry_date ??
                    t('devpanel.noExpiry'))
                  : '—'}
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold">
                {t('license.featuresTitle')}
              </h3>
              <ul className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
                {DEV_FEATURE_KEYS.map((key) => (
                  <li key={key} className="flex items-center gap-2">
                    <span
                      className={
                        cache.features[key]
                          ? 'text-emerald-600'
                          : 'text-muted-foreground'
                      }
                    >
                      {cache.features[key] ? '●' : '○'}
                    </span>
                    {t(`devpanel.feature_${key}`)}
                  </li>
                ))}
              </ul>
            </div>

            {view.updateAvailable && cache.latest_release && (
              <div className="rounded-md border border-sky-300 bg-sky-50 p-3 dark:border-sky-800 dark:bg-sky-950">
                <p className="text-sm font-medium">
                  {t('license.updateAvailable', {
                    version: cache.latest_release.version,
                  })}
                </p>
                {cache.latest_release.release_notes && (
                  <p className="mt-1 text-sm whitespace-pre-line">
                    {cache.latest_release.release_notes}
                  </p>
                )}
                {cache.latest_release.required_migrations.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('license.requiredMigrations')}:{' '}
                    {cache.latest_release.required_migrations.join(', ')}
                  </p>
                )}
              </div>
            )}
            {cache.latest_release && !view.updateAvailable && (
              <p className="text-sm text-muted-foreground">
                {t('license.upToDate')}
              </p>
            )}
          </>
        )}

        {configured && (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={checking}
              onClick={() => void handleCheckNow()}
            >
              {checking ? t('license.checking') : t('license.checkNow')}
            </Button>
            {checkFailed && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {t('license.checkFailed')}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
