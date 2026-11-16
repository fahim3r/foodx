// FoodX — Settings page (protected).
// Loads restaurant + restaurant_settings when they exist. If no restaurant
// exists yet, the form runs in "setup" mode: it creates the restaurant,
// links the user's profile to it, and creates the settings row.
// Color pickers update the live preview (and the page's CSS variables)
// immediately; they are persisted only on save.
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { isMissingTableError, isSlugTakenError } from '@/lib/errors'
import { formatMoney, roundMoney } from '@/lib/money'
import { useAuth } from '@/hooks/useAuth'
import {
  createRestaurant,
  linkProfileToRestaurant,
  updateRestaurant,
  upsertSettings,
} from '@/services/restaurant'
import type { RestaurantFormValues } from '@/types'
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

const CURRENCIES = ['BDT', 'USD', 'EUR', 'INR'] as const
const TIMEZONES = ['Asia/Dhaka', 'Asia/Kolkata', 'Asia/Dubai', 'UTC'] as const

const DEFAULTS: RestaurantFormValues = {
  name: '',
  slug: '',
  currency: 'BDT',
  timezone: 'Asia/Dhaka',
  branding_name: '',
  logo_url: '',
  primary_color: '#ea580c',
  secondary_color: '#16a34a',
  tax_rate: 0,
  service_charge_rate: 0,
  receipt_footer: '',
  loyalty_earn_per_100: 1,
  loyalty_point_value: 1,
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isValidHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

/**
 * Parse a loyalty-rate text input. Returns the fallback when the input
 * is empty or invalid. The earn rate may be 0 (no points earned);
 * the point value must stay positive (a point worth nothing breaks
 * redemption math), so 0 is not allowed for it.
 */
function parseLoyaltyRate(
  value: string,
  fallback: number,
  allowZero: boolean,
): number {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  if (parsed < 0) return fallback
  if (!allowZero && parsed === 0) return fallback
  return roundMoney(parsed)
}

export default function SettingsPage() {
  const { t } = useTranslation()
  const { user, profile, restaurant, settings, dbPending, refreshWorkspace } =
    useAuth()
  const [values, setValues] = useState<RestaurantFormValues>(DEFAULTS)
  const [slugTouched, setSlugTouched] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [saveErrorKey, setSaveErrorKey] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  // Loyalty rates stay STRINGS in form state and the inputs are
  // type="text" inputMode="decimal": a type="number" input mangled a
  // filled "30" into 29.969999313354492 before React ever saw it.
  // Parsed + rounded only on submit. Do not switch them back.
  const [loyaltyEarn, setLoyaltyEarn] = useState('1')
  const [loyaltyPointValue, setLoyaltyPointValue] = useState('1')

  // Initialise the form from the loaded restaurant / settings.
  useEffect(() => {
    if (dbPending) {
      setLoaded(true)
      return
    }
    // Wait until the provider finished loading (profile may legitimately
    // be null for a brand-new user, so only gate on `user`).
    if (!user) return
    setValues({
      name: restaurant?.name ?? '',
      slug: restaurant?.slug ?? '',
      currency: settings?.currency ?? restaurant?.default_currency ?? 'BDT',
      timezone: restaurant?.timezone ?? 'Asia/Dhaka',
      branding_name: settings?.branding_name ?? '',
      logo_url: settings?.logo_url ?? '',
      primary_color: settings?.primary_color ?? '#ea580c',
      secondary_color: settings?.secondary_color ?? '#16a34a',
      tax_rate: Number(settings?.tax_rate ?? 0),
      service_charge_rate: Number(settings?.service_charge_rate ?? 0),
      receipt_footer: settings?.receipt_footer ?? '',
      loyalty_earn_per_100: Number(settings?.loyalty_earn_per_100 ?? 1),
      loyalty_point_value: Number(settings?.loyalty_point_value ?? 1),
    })
    setLoyaltyEarn(String(Number(settings?.loyalty_earn_per_100 ?? 1)))
    setLoyaltyPointValue(String(Number(settings?.loyalty_point_value ?? 1)))
    setLoaded(true)
  }, [user, restaurant, settings, dbPending])

  const set = <K extends keyof RestaurantFormValues>(
    key: K,
    value: RestaurantFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
    setSaveErrorKey(null)
  }

  const handleNameChange = (name: string) => {
    set('name', name)
    if (!slugTouched) set('slug', slugify(name))
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!user || dbPending) return
    setSaveErrorKey(null)
    setSaved(false)
    setSaving(true)
    try {
      const slug = slugify(values.slug || values.name)
      let restaurantId = restaurant?.id
      if (!restaurantId) {
        restaurantId = await createRestaurant({
          name: values.name.trim(),
          slug,
          currency: values.currency,
          timezone: values.timezone,
        })
        await linkProfileToRestaurant(
          user.id,
          restaurantId,
          profile?.full_name ?? undefined,
        )
      } else {
        await updateRestaurant(restaurantId, {
          name: values.name.trim(),
          slug,
          default_currency: values.currency,
          timezone: values.timezone,
        })
      }
      await upsertSettings(restaurantId, {
        branding_name: values.branding_name.trim(),
        logo_url: values.logo_url.trim(),
        primary_color: values.primary_color,
        secondary_color: values.secondary_color,
        currency: values.currency,
        tax_rate: values.tax_rate,
        service_charge_rate: values.service_charge_rate,
        receipt_footer: values.receipt_footer.trim(),
        // Rates are parsed from their string inputs here, never from a
        // number input: an empty/invalid value falls back to the
        // default 1 instead of saving 0 or NaN.
        loyalty_earn_per_100: parseLoyaltyRate(loyaltyEarn, 1, true),
        loyalty_point_value: parseLoyaltyRate(loyaltyPointValue, 1, false),
      })
      await refreshWorkspace()
      setSaved(true)
    } catch (error) {
      // Logged for diagnosis (visible in the browser console) — the UI
      // only ever shows the friendly message, never the raw error.
      console.error('[Settings] save failed', error)
      if (isMissingTableError(error)) {
        setLoadError(true)
      } else {
        setSaveErrorKey(
          isSlugTakenError(error)
            ? 'settings.slugTaken'
            : 'settings.saveFailed',
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const setupMode = !restaurant
  const previewStyle = {
    '--primary': isValidHex(values.primary_color)
      ? values.primary_color
      : '#ea580c',
    '--ring': isValidHex(values.primary_color)
      ? values.primary_color
      : '#ea580c',
  } as CSSProperties

  if (!loaded) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  if (dbPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.dbPendingTitle')}</CardTitle>
          <CardDescription>{t('settings.dbPendingBody')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('common.error')}</CardTitle>
          <CardDescription>{t('settings.loadFailed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => window.location.reload()}>
            {t('common.retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6" style={previewStyle}>
      <header>
        <h2 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h2>
        <p className="text-muted-foreground">{t('settings.subtitle')}</p>
      </header>

      {setupMode && (
        <div
          role="status"
          className="rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900"
        >
          <p className="font-semibold">{t('settings.setupTitle')}</p>
          <p className="mt-1">{t('settings.setupBody')}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.restaurantInfo')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">{t('settings.name')}</Label>
                <Input
                  id="name"
                  value={values.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder={t('settings.namePlaceholder')}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="slug">{t('settings.slug')}</Label>
                <Input
                  id="slug"
                  value={values.slug}
                  onChange={(e) => {
                    setSlugTouched(true)
                    set('slug', e.target.value)
                  }}
                  placeholder={t('settings.slugPlaceholder')}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  {t('settings.slugHint')}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="currency">{t('settings.currency')}</Label>
                <select
                  id="currency"
                  value={values.currency}
                  onChange={(e) => set('currency', e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="timezone">{t('settings.timezone')}</Label>
                <select
                  id="timezone"
                  value={values.timezone}
                  onChange={(e) => set('timezone', e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  {TIMEZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.branding')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="brandingName">{t('settings.brandingName')}</Label>
                <Input
                  id="brandingName"
                  value={values.branding_name}
                  onChange={(e) => set('branding_name', e.target.value)}
                  placeholder={t('settings.brandingNamePlaceholder')}
                />
                <p className="text-xs text-muted-foreground">
                  {t('settings.brandingNameHint')}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="logoUrl">{t('settings.logoUrl')}</Label>
                <Input
                  id="logoUrl"
                  type="url"
                  value={values.logo_url}
                  onChange={(e) => set('logo_url', e.target.value)}
                  placeholder={t('settings.logoUrlPlaceholder')}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="primaryColor">{t('settings.primaryColor')}</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="primaryColor"
                    type="color"
                    value={
                      isValidHex(values.primary_color)
                        ? values.primary_color
                        : '#ea580c'
                    }
                    onChange={(e) => set('primary_color', e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
                  />
                  <Input
                    value={values.primary_color}
                    onChange={(e) => set('primary_color', e.target.value)}
                    aria-label={t('settings.primaryColor')}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="secondaryColor">{t('settings.secondaryColor')}</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="secondaryColor"
                    type="color"
                    value={
                      isValidHex(values.secondary_color)
                        ? values.secondary_color
                        : '#16a34a'
                    }
                    onChange={(e) => set('secondary_color', e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-1"
                  />
                  <Input
                    value={values.secondary_color}
                    onChange={(e) => set('secondary_color', e.target.value)}
                    aria-label={t('settings.secondaryColor')}
                  />
                </div>
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <p className="mb-3 text-sm font-medium">
                {t('settings.previewTitle')}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button">{t('settings.previewPrimary')}</Button>
                <Button type="button" variant="secondary">
                  {t('settings.previewSecondary')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.charges')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="taxRate">{t('settings.taxRate')}</Label>
                <Input
                  id="taxRate"
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={values.tax_rate}
                  onChange={(e) => set('tax_rate', Number(e.target.value) || 0)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="serviceChargeRate">
                  {t('settings.serviceChargeRate')}
                </Label>
                <Input
                  id="serviceChargeRate"
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  value={values.service_charge_rate}
                  onChange={(e) =>
                    set('service_charge_rate', Number(e.target.value) || 0)
                  }
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="receiptFooter">{t('settings.receiptFooter')}</Label>
              <Input
                id="receiptFooter"
                value={values.receipt_footer}
                onChange={(e) => set('receipt_footer', e.target.value)}
                placeholder={t('settings.receiptFooterPlaceholder')}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.loyalty')}</CardTitle>
            <CardDescription>
              {t('settings.loyaltyHint', {
                amount: formatMoney(100, values.currency),
                value: formatMoney(1, values.currency),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="loyaltyEarnPer100">
                  {t('settings.loyaltyEarnPer100', {
                    amount: formatMoney(100, values.currency),
                  })}
                </Label>
                <Input
                  id="loyaltyEarnPer100"
                  type="text"
                  inputMode="decimal"
                  value={loyaltyEarn}
                  onChange={(e) => {
                    setLoyaltyEarn(e.target.value)
                    setSaved(false)
                    setSaveErrorKey(null)
                  }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="loyaltyPointValue">
                  {t('settings.loyaltyPointValue')}
                </Label>
                <Input
                  id="loyaltyPointValue"
                  type="text"
                  inputMode="decimal"
                  value={loyaltyPointValue}
                  onChange={(e) => {
                    setLoyaltyPointValue(e.target.value)
                    setSaved(false)
                    setSaveErrorKey(null)
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {saveErrorKey && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {t(saveErrorKey)}
          </p>
        )}
        {saved && (
          <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {t('settings.saved')}
          </p>
        )}
        <div>
          <Button type="submit" disabled={saving}>
            {saving
              ? t('settings.saving')
              : setupMode
                ? t('settings.createRestaurant')
                : t('settings.saveSettings')}
          </Button>
        </div>
      </form>
    </div>
  )
}
