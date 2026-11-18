import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ActivationError,
  activateWithLicenseKey,
  registryEnvConfigured,
  type ActivationResult,
} from '@/services/activation'

/**
 * License-key activation form (landing/onboarding step 2). Shared by
 * the Settings LicenseCard and the setup wizard: paste the vendor-
 * provided key, the deployment exchanges it for its instance identity
 * (activation.ts), and the first heartbeat validates it. Failure
 * states are specific and honest — a wrong key, an inactive license
 * and an already-activated deployment each say so.
 */
export default function ActivationForm({
  onActivated,
}: {
  onActivated?: (result: ActivationResult) => void
}) {
  const { t } = useTranslation()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [issued, setIssued] = useState<{
    token: string
    instanceId: string
  } | null>(null)
  const [done, setDone] = useState<ActivationResult | null>(null)

  if (!registryEnvConfigured()) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
        {t('license.activateNoRegistry')}
      </p>
    )
  }

  if (done) {
    return (
      <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        <p className="font-medium">{t('license.activateSuccess')}</p>
        <p className="mt-1">
          {t('license.instanceId')}: {done.instanceId}
          {done.license &&
            ` · ${t(`devpanel.plan_${done.license.plan}`)} · ${t(
              `devpanel.licenseStatus_${done.license.status}`,
            )}`}
        </p>
      </div>
    )
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!key.trim() || busy) return
    setBusy(true)
    setErrorCode(null)
    setIssued(null)
    try {
      const result = await activateWithLicenseKey(key)
      setDone(result)
      onActivated?.(result)
    } catch (error) {
      if (error instanceof ActivationError) {
        setErrorCode(error.code)
        if (error.code === 'config_save_failed' && error.issuedToken) {
          setIssued({
            token: error.issuedToken,
            instanceId: error.issuedInstanceId ?? '',
          })
        }
      } else {
        setErrorCode('network_error')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="license-key">{t('license.activateKeyLabel')}</Label>
        <Input
          id="license-key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={t('license.activateKeyPlaceholder')}
          autoComplete="off"
        />
      </div>
      {errorCode && (
        <div role="alert" className="text-sm text-destructive">
          <p>{t(`license.activateError_${errorCode}`)}</p>
          {issued && (
            <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <p>{t('license.issuedTokenNote')}</p>
              <p className="mt-1 font-mono text-xs break-all">
                VITE_FOODX_INSTANCE_ID={issued.instanceId}
                <br />
                VITE_FOODX_INSTANCE_TOKEN={issued.token}
              </p>
            </div>
          )}
        </div>
      )}
      <div>
        <Button type="submit" disabled={busy || !key.trim()}>
          {busy ? t('license.activating') : t('license.activateButton')}
        </Button>
      </div>
    </form>
  )
}
