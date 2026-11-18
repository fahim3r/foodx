import { useCallback, useEffect, useState, type FormEvent } from 'react'
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
import {
  fetchManagerPinIsSet,
  guardedErrorCode,
  removeManagerPin,
  setManagerPin,
} from '@/services/pin'

/**
 * Settings → Manager PIN (roadmap gap 6). While a PIN is set, order
 * cancellation and refunds ask for it (verified in the database by
 * the guarded RPCs). Only restaurant admins can set or remove it —
 * enforced server-side; this card just surfaces the result. Removing
 * the PIN is also the recovery path when it is forgotten.
 */
export default function ManagerPinCard() {
  const { t } = useTranslation()
  const [pinIsSet, setPinIsSet] = useState<boolean | null>(null)
  const [pin, setPin] = useState('')
  const [pinConfirm, setPinConfirm] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [noticeKey, setNoticeKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  const load = useCallback(async () => {
    try {
      setPinIsSet(await fetchManagerPinIsSet())
    } catch {
      setPinIsSet(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    setErrorKey(null)
    setNoticeKey(null)
    if (!/^[0-9]{4,8}$/.test(pin)) {
      setErrorKey('settings.pinInvalid')
      return
    }
    if (pin !== pinConfirm) {
      setErrorKey('settings.pinMismatch')
      return
    }
    setSaving(true)
    try {
      await setManagerPin(pin)
      setPin('')
      setPinConfirm('')
      setNoticeKey('settings.pinSaved')
      await load()
    } catch (error) {
      const code = guardedErrorCode(error)
      setErrorKey(
        code === 'not_admin'
          ? 'settings.pinNotAdmin'
          : code === 'pin_invalid'
            ? 'settings.pinInvalid'
            : 'settings.pinSaveFailed',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async () => {
    setErrorKey(null)
    setNoticeKey(null)
    setSaving(true)
    try {
      await removeManagerPin()
      setConfirmingRemove(false)
      setNoticeKey('settings.pinRemoved')
      await load()
    } catch (error) {
      const code = guardedErrorCode(error)
      setErrorKey(
        code === 'not_admin'
          ? 'settings.pinNotAdmin'
          : 'settings.pinSaveFailed',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.pinTitle')}</CardTitle>
        <CardDescription>{t('settings.pinBody')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {pinIsSet === null ? (
          <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : (
          <p className="text-sm">
            {pinIsSet ? t('settings.pinSet') : t('settings.pinNotSet')}
          </p>
        )}

        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="managerPin">{t('settings.pinNew')}</Label>
            <Input
              id="managerPin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="max-w-56"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="managerPinConfirm">
              {t('settings.pinConfirm')}
            </Label>
            <Input
              id="managerPinConfirm"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={pinConfirm}
              onChange={(e) => setPinConfirm(e.target.value)}
              className="max-w-56"
            />
          </div>
          <div>
            <Button type="submit" disabled={saving || !pin || !pinConfirm}>
              {t('settings.pinSave')}
            </Button>
          </div>
        </form>

        {pinIsSet && (
          <div className="flex flex-col gap-2 border-t pt-4">
            {confirmingRemove ? (
              <>
                <p className="text-sm">{t('settings.pinRemoveConfirm')}</p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={saving}
                    onClick={() => void handleRemove()}
                  >
                    {t('settings.pinRemove')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setConfirmingRemove(false)}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </>
            ) : (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmingRemove(true)}
                >
                  {t('settings.pinRemove')}
                </Button>
              </div>
            )}
          </div>
        )}

        {errorKey && (
          <p role="alert" className="text-sm text-destructive">
            {t(errorKey)}
          </p>
        )}
        {noticeKey && <p className="text-sm text-green-600">{t(noticeKey)}</p>}
      </CardContent>
    </Card>
  )
}
