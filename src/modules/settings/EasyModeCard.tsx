import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { useEasyMode } from '@/hooks/useEasyMode'
import { usePermissions } from '@/hooks/usePermissions'
import { fetchManagerPinIsSet, verifyManagerPin } from '@/services/pin'
import { updateSettingsPartial } from '@/services/restaurant'

/**
 * Settings → Panel view (Easy Mode v2, wave E1; design §3/§6).
 * The Easy / Advanced switch for the WHOLE restaurant
 * (restaurant_settings.easy_mode, migration 0034). It renders only
 * for owner/admin-level users — staff never see it — and applying
 * a change always asks for the manager PIN (verified server-side
 * by verify_manager_pin, migration 0034, over migration 0024's
 * hash). If no PIN is set yet, the card says so and points at the
 * Manager PIN card above: a mode change is never PIN-less. A wrong
 * PIN changes nothing and shows a plain error.
 */
export default function EasyModeCard() {
  const { t } = useTranslation()
  const { easy } = useEasyMode()
  const { isAdminLevel, ready: permissionsReady } = usePermissions()
  const { restaurant, refreshWorkspace } = useAuth()
  const [pinIsSet, setPinIsSet] = useState<boolean | null>(null)
  const [pin, setPin] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isAdminLevel) return
    let cancelled = false
    fetchManagerPinIsSet()
      .then((value) => {
        if (!cancelled) setPinIsSet(value)
      })
      .catch(() => {
        if (!cancelled) setPinIsSet(null)
      })
    return () => {
      cancelled = true
    }
  }, [isAdminLevel])

  // Owner/admin-level only (design §3/§6). While permissions are
  // still loading, isAdminLevel is false, so the card simply
  // appears once the role is known — it never flashes for staff.
  if (!permissionsReady || !isAdminLevel || !restaurant) return null

  const handleSwitch = async (event: FormEvent) => {
    event.preventDefault()
    setErrorKey(null)
    if (!pin) {
      setErrorKey('orders.pinRequired')
      return
    }
    setBusy(true)
    try {
      const verified = await verifyManagerPin(pin)
      if (!verified) {
        setErrorKey('orders.pinIncorrect')
        return
      }
      await updateSettingsPartial(restaurant.id, { easy_mode: !easy })
      setPin('')
      await refreshWorkspace()
    } catch {
      setErrorKey('easy.switch.failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('easy.switch.title')}</CardTitle>
        <CardDescription>{t('easy.switch.body')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">
          {easy ? t('easy.switch.nowEasy') : t('easy.switch.nowAdvanced')}
        </p>
        {pinIsSet === null ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : pinIsSet === false ? (
          <p role="alert" className="text-sm text-destructive">
            {t('easy.switch.needPin')}
          </p>
        ) : (
          <form onSubmit={handleSwitch} className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="easyModePin">{t('easy.switch.pinLabel')}</Label>
              <Input
                id="easyModePin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="max-w-56"
              />
            </div>
            <div>
              <Button type="submit" disabled={busy || !pin}>
                {easy ? t('easy.switch.toAdvanced') : t('easy.switch.toEasy')}
              </Button>
            </div>
          </form>
        )}
        {errorKey && (
          <p role="alert" className="text-sm text-destructive">
            {t(errorKey)}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
