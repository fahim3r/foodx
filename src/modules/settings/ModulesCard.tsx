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
import { isFeatureEnabledFromCache } from '@/services/heartbeat'
import { updateSettingsPartial } from '@/services/restaurant'
import type { ModuleKey } from '@/services/modules'
import type { RestaurantModules } from '@/types'

const MODULE_ROWS: {
  key: ModuleKey
  labelKey: string
  vendorKey: 'delivery' | 'loyalty' | null
}[] = [
  { key: 'delivery', labelKey: 'settings.moduleDelivery', vendorKey: 'delivery' },
  { key: 'loyalty', labelKey: 'settings.moduleLoyalty', vendorKey: 'loyalty' },
  { key: 'reservations', labelKey: 'settings.moduleReservations', vendorKey: null },
  { key: 'business', labelKey: 'settings.moduleBusiness', vendorKey: null },
  { key: 'customers', labelKey: 'settings.moduleCustomers', vendorKey: null },
]

/**
 * Settings → Modules (modifications v2, item 8): the restaurant's
 * own on/off switches. Vendor-locked modules (not in the client's
 * FoodX plan) render disabled with the reason — the vendor flag
 * always wins. Writes are instant (updateSettingsPartial) and the
 * workspace refreshes so the sidebar updates immediately.
 */
export default function ModulesCard() {
  const { t } = useTranslation()
  const { restaurant, settings, refreshWorkspace } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const [localModules, setLocalModules] = useState<RestaurantModules | null>(null)
  const [localDelivery, setLocalDelivery] = useState<boolean | null>(null)

  if (!restaurant || !settings) return null

  const modules: RestaurantModules = localModules ?? settings.modules ?? {}
  const deliveryOn = localDelivery ?? settings.delivery_enabled

  const isOn = (key: ModuleKey): boolean =>
    key === 'delivery' ? deliveryOn !== false : modules[key] !== false

  const toggle = async (key: ModuleKey, next: boolean) => {
    setSaving(true)
    setError(false)
    try {
      if (key === 'delivery') {
        await updateSettingsPartial(restaurant.id, { delivery_enabled: next })
        setLocalDelivery(next)
      } else {
        const merged: RestaurantModules = { ...modules, [key]: next }
        await updateSettingsPartial(restaurant.id, { modules: merged })
        setLocalModules(merged)
      }
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
        <CardTitle>{t('settings.modulesTitle')}</CardTitle>
        <CardDescription>{t('settings.modulesBody')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {MODULE_ROWS.map(({ key, labelKey, vendorKey }) => {
          const locked =
            vendorKey !== null && !isFeatureEnabledFromCache(vendorKey)
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor={`module-${key}`}>{t(labelKey)}</Label>
                {locked && (
                  <p className="text-xs text-muted-foreground">
                    {t('settings.modulesNotInPlan')}
                  </p>
                )}
              </div>
              <input
                id={`module-${key}`}
                type="checkbox"
                className="size-4 accent-primary"
                checked={!locked && isOn(key)}
                disabled={locked || saving}
                onChange={(event) => void toggle(key, event.target.checked)}
              />
            </div>
          )
        })}
        {error && (
          <p className="text-sm text-destructive">{t('settings.modulesError')}</p>
        )}
      </CardContent>
    </Card>
  )
}
