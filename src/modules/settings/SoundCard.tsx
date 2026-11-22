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
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import {
  initSound,
  playTestSound,
  stopAlertNow,
  stopAllAlerts,
  type SoundKind,
} from '@/lib/sound'
import {
  loadSoundSettings,
  saveSoundSettings,
  type SoundSettings,
} from '@/services/soundSettings'

const FALLBACK: SoundSettings = {
  master: false,
  newOrder: true,
  ready: true,
  payment: true,
  complete: true,
  cancelled: true,
}

/**
 * Settings → Sound effects (Sound Effects feature, 2026-11-22):
 * per-device chimes for a new order, an order becoming ready, a
 * recorded payment and (v1.1) an order completing or being
 * cancelled — built exactly like PrintingCard, whose settings make
 * the same "this terminal, not the restaurant" argument. The master
 * defaults OFF (design D2/Q1), with the five event toggles ON
 * underneath it. Switching
 * the master or a looping event off silences its alert at once.
 * The Test buttons
 * play their sound even while the toggles are off: the tap is an
 * explicit try-out, and it doubles as the gesture that unlocks
 * audio on this device (design D3).
 */
export default function SoundCard() {
  const { t } = useTranslation()
  const { restaurant } = useAuth()
  const [settings, setSettings] = useState<SoundSettings>(() =>
    restaurant ? loadSoundSettings(restaurant.id) : FALLBACK,
  )

  if (!restaurant) return null

  const update = (patch: Partial<SoundSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSoundSettings(restaurant.id, next)
  }

  const test = (kind: SoundKind) => {
    initSound(restaurant.id)
    playTestSound(kind)
  }

  const eventRow = (
    id: string,
    labelKey: string,
    kind: SoundKind,
    checked: boolean,
    onToggle: (checked: boolean) => void,
  ) => (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id}>{t(labelKey)}</Label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => test(kind)}
        >
          {t('settings.soundTest')}
        </Button>
        <input
          id={id}
          type="checkbox"
          className="size-4 accent-primary"
          checked={checked}
          disabled={!settings.master}
          onChange={(event) => onToggle(event.target.checked)}
        />
      </div>
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.soundTitle')}</CardTitle>
        <CardDescription>{t('settings.soundBody')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="sound-master">{t('settings.soundMaster')}</Label>
          <input
            id="sound-master"
            type="checkbox"
            className="size-4 accent-primary"
            checked={settings.master}
            onChange={(event) => {
              if (!event.target.checked) stopAllAlerts()
              update({ master: event.target.checked })
            }}
          />
        </div>
        {eventRow(
          'sound-new-order',
          'settings.soundNewOrder',
          'newOrder',
          settings.newOrder,
          (checked) => {
            if (!checked) stopAlertNow('new')
            update({ newOrder: checked })
          },
        )}
        {eventRow(
          'sound-ready',
          'settings.soundReady',
          'ready',
          settings.ready,
          (checked) => {
            if (!checked) stopAlertNow('ready')
            update({ ready: checked })
          },
        )}
        {eventRow(
          'sound-payment',
          'settings.soundPayment',
          'payment',
          settings.payment,
          (checked) => update({ payment: checked }),
        )}
        {eventRow(
          'sound-complete',
          'settings.soundComplete',
          'complete',
          settings.complete,
          (checked) => update({ complete: checked }),
        )}
        {eventRow(
          'sound-cancelled',
          'settings.soundCancelled',
          'cancelled',
          settings.cancelled,
          (checked) => update({ cancelled: checked }),
        )}
        <p className="text-sm text-muted-foreground">
          {t('settings.soundNote')}
        </p>
      </CardContent>
    </Card>
  )
}
