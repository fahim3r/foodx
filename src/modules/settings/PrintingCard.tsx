import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  loadPrintSettings,
  savePrintSettings,
  type PrintSettings,
} from '@/services/printSettings'

/**
 * Settings → Printing (modifications v2, item 11): per-device
 * auto-print toggles. The explainer is honest about the browser
 * reality — the print dialog appears once per print unless this
 * device runs Chrome with --kiosk-printing (a setup step the
 * vendor does at installation).
 */
export default function PrintingCard() {
  const { t } = useTranslation()
  const { restaurant } = useAuth()
  const [settings, setSettings] = useState<PrintSettings>(() =>
    restaurant ? loadPrintSettings(restaurant.id) : { autoReceipt: false, autoKitchen: false },
  )

  if (!restaurant) return null

  const update = (patch: Partial<PrintSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    savePrintSettings(restaurant.id, next)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.printTitle')}</CardTitle>
        <CardDescription>{t('settings.printBody')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="print-auto-receipt">{t('settings.printAutoReceipt')}</Label>
          <input
            id="print-auto-receipt"
            type="checkbox"
            className="size-4 accent-primary"
            checked={settings.autoReceipt}
            onChange={(event) => update({ autoReceipt: event.target.checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="print-auto-kitchen">{t('settings.printAutoKitchen')}</Label>
          <input
            id="print-auto-kitchen"
            type="checkbox"
            className="size-4 accent-primary"
            checked={settings.autoKitchen}
            onChange={(event) => update({ autoKitchen: event.target.checked })}
          />
        </div>
        <p className="text-sm text-muted-foreground">{t('settings.printNote')}</p>
      </CardContent>
    </Card>
  )
}
