import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import EasyHelpLine from '@/components/EasyHelpLine'
import { useAuth } from '@/hooks/useAuth'
import { roundMoney } from '@/lib/money'
import { escapeHtml, printHtml } from '@/lib/print'
import { initSound, playTestSound } from '@/lib/sound'
import { isFeatureEnabledFromCache } from '@/services/heartbeat'
import { isModuleOn } from '@/services/modules'
import { initSound, playTestSound } from '@/lib/sound'
import {
  loadSoundSettings,
  saveSoundSettings,
  type SoundSettings,
} from '@/services/soundSettings'
import {
  createMainBranch,
  fetchBranches,
  updateBranchContact,
  updateRestaurant,
  updateSettingsPartial,
  type Branch,
} from '@/services/restaurant'
import {
  loadSoundSettings,
  saveSoundSettings,
  type SoundSettings,
} from '@/services/soundSettings'
import EasyModeCard from './EasyModeCard'
import HelpSection from './HelpSection'
import ManagerPinCard from './ManagerPinCard'
import PrintingCard from './PrintingCard'

/** Parse a money/rate text input the same way the full Settings
 * form does: empty, invalid or negative falls back (to 0 here —
 * in easy mode an unreadable number must never save as NaN). */
function parseAmount(value: string): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return roundMoney(parsed)
}

/**
 * Settings in Easy Mode (Easy Mode v2, wave E2; design §7). While
 * easy mode is on, SettingsPage renders THIS instead of the full
 * form: only the everyday things a non-tech owner touches, as big
 * labelled rows — restaurant name + the main branch's phone and
 * address (contact fields live on branches in this schema, the
 * same place the onboarding wizard writes them), tax on/off +
 * rate, the delivery fee (with zone editing linked to the
 * Delivery page, where it already lives), printing, the manager
 * PIN and the Panel view switch. Everything else (branding,
 * loyalty, module toggles, domains, license) stays in the full
 * view, untouched. Every save goes through the existing services
 * (updateRestaurant / updateBranchContact / createMainBranch /
 * updateSettingsPartial) — no new business logic.
 *
 * Tax has no on/off column in restaurant_settings — the full
 * panel's only tax field is tax_rate, and a rate of 0 already
 * means "no tax" everywhere totals are computed. So the easy
 * toggle is honest sugar over that same field: off saves 0, on
 * saves the rate shown (the previous rate is kept in the box
 * while off, so switching back on restores it).
 */
export default function EasySettings() {
  const { t } = useTranslation()
  const { restaurant, settings, refreshWorkspace } = useAuth()

  const [name, setName] = useState(restaurant?.name ?? '')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [mainBranch, setMainBranch] = useState<Branch | null>(null)
  const [branchLoaded, setBranchLoaded] = useState(false)
  const [taxOn, setTaxOn] = useState(
    () => Number(settings?.tax_rate ?? 0) > 0,
  )
  const [taxRate, setTaxRate] = useState(
    () => String(Number(settings?.tax_rate ?? 0)),
  )
  const [deliveryFee, setDeliveryFee] = useState(
    () => String(Number(settings?.delivery_fee ?? 0)),
  )
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // Sound effects (2026-11-22): Easy gets the one simple row — the
  // per-device master switch + a test button; the per-event detail
  // lives in the advanced SoundCard. Defaults OFF, like everywhere.
  const [soundSettings, setSoundSettings] = useState<SoundSettings>(() =>
    restaurant
      ? loadSoundSettings(restaurant.id)
      : { master: false, newOrder: true, ready: true, payment: true },
  )

  const handleSoundToggle = (checked: boolean) => {
    if (!restaurant) return
    const next = { ...soundSettings, master: checked }
    setSoundSettings(next)
    saveSoundSettings(restaurant.id, next)
  }

  const handleSoundTest = () => {
    if (!restaurant) return
    initSound(restaurant.id)
    playTestSound('newOrder')
  }

  // The main branch carries the restaurant's phone + address.
  useEffect(() => {
    if (!restaurant) return
    let cancelled = false
    void (async () => {
      try {
        const branches = await fetchBranches(restaurant.id)
        if (cancelled) return
        const main =
          branches.find((branch) => branch.is_main) ?? branches[0] ?? null
        setMainBranch(main)
        setPhone(main?.phone ?? '')
        setAddress(main?.address ?? '')
      } catch {
        // Contact fields just stay empty; saving then creates the
        // main branch (the wizard's fallback for a seeded-less
        // deployment) instead of failing the whole page.
      } finally {
        if (!cancelled) setBranchLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [restaurant])

  if (!restaurant) return null

  // Same gates as the sidebar's Delivery entry: the restaurant's
  // own delivery switch AND the vendor feature flag.
  const deliveryOn =
    isModuleOn(settings, 'delivery') &&
    isFeatureEnabledFromCache('delivery')

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setSaveError(false)
    try {
      const trimmedName = name.trim()
      if (trimmedName && trimmedName !== restaurant.name) {
        await updateRestaurant(restaurant.id, { name: trimmedName })
      }
      const phoneValue = phone.trim() || null
      const addressValue = address.trim() || null
      if (mainBranch) {
        if (
          phoneValue !== (mainBranch.phone ?? null) ||
          addressValue !== (mainBranch.address ?? null)
        ) {
          await updateBranchContact(mainBranch.id, {
            phone: phoneValue,
            address: addressValue,
          })
        }
      } else if (branchLoaded && (phoneValue || addressValue)) {
        await createMainBranch(restaurant.id, {
          name: trimmedName || restaurant.name,
          phone: phoneValue,
          address: addressValue,
        })
      }
      const patch: Parameters<typeof updateSettingsPartial>[1] = {
        tax_rate: taxOn ? parseAmount(taxRate) : 0,
      }
      if (deliveryOn) patch.delivery_fee = parseAmount(deliveryFee)
      await updateSettingsPartial(restaurant.id, patch)
      await refreshWorkspace()
      setSaved(true)
    } catch (error) {
      console.error('[EasySettings] save failed', error)
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

  const handleTestPrint = () => {
    const body =
      `<h1>${escapeHtml(restaurant.name)}</h1>` +
      `<p>${escapeHtml(t('easy.settings.testPrintBody'))}</p>`
    printHtml(t('easy.settings.testPrintTitle'), body)
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-bold tracking-tight">
          {t('easy.nav.settings')}
        </h2>
        <EasyHelpLine labelKey="easy.help.settings" />
      </header>

      <form onSubmit={handleSave} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('easy.settings.infoTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="easyName" className="text-base">
                {t('settings.name')}
              </Label>
              <Input
                id="easyName"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setSaved(false)
                }}
                className="h-11 text-base"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="easyPhone" className="text-base">
                {t('easy.settings.phone')}
              </Label>
              <Input
                id="easyPhone"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  setSaved(false)
                }}
                className="h-11 text-base"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="easyAddress" className="text-base">
                {t('easy.settings.address')}
              </Label>
              <Input
                id="easyAddress"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value)
                  setSaved(false)
                }}
                className="h-11 text-base"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('easy.settings.taxTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <label className="flex items-center gap-3 text-base font-medium">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={taxOn}
                onChange={(e) => {
                  setTaxOn(e.target.checked)
                  setSaved(false)
                }}
              />
              {t('easy.settings.taxOn')}
            </label>
            {taxOn && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="easyTaxRate" className="text-base">
                  {t('settings.taxRate')}
                </Label>
                <Input
                  id="easyTaxRate"
                  type="text"
                  inputMode="decimal"
                  value={taxRate}
                  onChange={(e) => {
                    setTaxRate(e.target.value)
                    setSaved(false)
                  }}
                  className="h-11 max-w-56 text-base"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {deliveryOn && (
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.delivery.title')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="easyDeliveryFee" className="text-base">
                  {t('settings.delivery.fee')}
                </Label>
                <Input
                  id="easyDeliveryFee"
                  type="text"
                  inputMode="decimal"
                  value={deliveryFee}
                  onChange={(e) => {
                    setDeliveryFee(e.target.value)
                    setSaved(false)
                  }}
                  className="h-11 max-w-56 text-base"
                />
              </div>
              <div>
                <Button asChild variant="outline" size="lg">
                  <Link to="../delivery">
                    {t('easy.settings.zonesLink')}
                  </Link>
                </Button>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t('easy.settings.zonesHint')}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {saveError && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {t('settings.saveFailed')}
          </p>
        )}
        {saved && (
          <p
            role="status"
            className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          >
            {t('settings.saved')}
          </p>
        )}
        <div>
          <Button type="submit" size="lg" disabled={saving}>
            {t('settings.saveSettings')}
          </Button>
        </div>
      </form>

      <PrintingCard />

      {/* Sound effects (2026-11-22): ONE simple row — the per-device
          master switch plus a Test button (the new-order doorbell as
          the sample). The per-event detail lives in the advanced
          Settings SoundCard. */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <p className="text-base font-medium">{t('easy.settings.sound')}</p>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              className="size-5 accent-primary"
              aria-label={t('easy.settings.sound')}
              checked={sound.master}
              onChange={(event) => {
                const next = { ...sound, master: event.target.checked }
                setSound(next)
                saveSoundSettings(restaurant.id, next)
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                initSound(restaurant.id)
                playTestSound('newOrder')
              }}
            >
              {t('easy.settings.soundTest')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <p className="text-base font-medium">
            {t('easy.settings.testPrint')}
          </p>
          <Button type="button" variant="outline" onClick={handleTestPrint}>
            {t('easy.settings.testPrint')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <p className="text-base font-medium">{t('easy.settings.sound')}</p>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={handleSoundTest}>
              {t('easy.settings.soundTest')}
            </Button>
            <input
              type="checkbox"
              className="size-5 accent-primary"
              aria-label={t('easy.settings.sound')}
              checked={soundSettings.master}
              onChange={(event) => handleSoundToggle(event.target.checked)}
            />
          </div>
        </CardContent>
      </Card>

      <ManagerPinCard />
      <EasyModeCard />

      {/* Help (wave H2; design §2-Q4): one row at the very bottom
          opening the same HelpSection as the advanced page — the
          five everyday cards above stay exactly as they were. */}
      <div>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="w-full"
          aria-expanded={helpOpen}
          onClick={() => setHelpOpen((open) => !open)}
        >
          {t('settings.help.rowTitle')}
        </Button>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('settings.help.rowHint')}
        </p>
      </div>
      {helpOpen && <HelpSection />}
    </div>
  )
}
