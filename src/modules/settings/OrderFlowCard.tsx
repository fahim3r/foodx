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
import { updateSettingsPartial } from '@/services/restaurant'

/**
 * Settings → Order flow (user request 2026-11-19): one switch —
 * send new orders straight to the kitchen. When on, POS / waiter /
 * online / kiosk orders are placed as SENT_TO_KITCHEN; when off they
 * wait at CONFIRMED for the manual "Send to kitchen" click on the
 * Orders page. Stored on restaurant_settings.auto_send_to_kitchen
 * (migration 0032); the online-order RPC reads the same column
 * (migration 0033).
 */
export default function OrderFlowCard() {
  const { t } = useTranslation()
  const { restaurant, settings, refreshWorkspace } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [local, setLocal] = useState<boolean | null>(null)

  if (!restaurant || !settings) return null

  const on = local ?? settings.auto_send_to_kitchen === true

  const toggle = async (next: boolean) => {
    setSaving(true)
    setError(false)
    try {
      await updateSettingsPartial(restaurant.id, {
        auto_send_to_kitchen: next,
      })
      setLocal(next)
      await refreshWorkspace()
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.orderFlowTitle')}</CardTitle>
        <CardDescription>{t('settings.orderFlowBody')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="orderflow-autokitchen">
            {t('settings.autoKitchen')}
          </Label>
          <input
            id="orderflow-autokitchen"
            type="checkbox"
            className="size-4 accent-primary"
            checked={on}
            disabled={saving}
            onChange={(event) => void toggle(event.target.checked)}
          />
        </div>
        {error && (
          <p className="text-sm text-destructive">
            {t('settings.orderFlowError')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
