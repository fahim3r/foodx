import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
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
import { isHeartbeatConfigured } from '@/services/heartbeat'
import {
  fetchBranches,
  updateBranchContact,
  updateRestaurant,
  updateSettingsPartial,
  type Branch,
} from '@/services/restaurant'
import ActivationForm from './ActivationForm'
import LicenseCard from './LicenseCard'

const CURRENCIES = ['BDT', 'USD', 'EUR', 'INR'] as const
const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

/**
 * First-run setup wizard (landing/onboarding step 2), route
 * /panel/setup. ProtectedRoute sends a restaurant here while its
 * settings carry onboarding_completed = false (migration 0016 marks
 * every pre-existing restaurant true, so only genuinely new
 * deployments see this). Three steps: restaurant info, license
 * activation, done. Activation can be skipped and finished later from
 * Settings — the wizard guides, it never locks (§53).
 */
export default function SetupPage() {
  const { t } = useTranslation()
  const { restaurant, settings, refreshWorkspace } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const panelRoot =
    pathname.startsWith('/panel/') || pathname === '/panel' ? '/panel' : '/'
  const toPanel = (sub: string) =>
    panelRoot === '/' ? sub : `${panelRoot}${sub}`

  const [step, setStep] = useState(1)
  const [branch, setBranch] = useState<Branch | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [currency, setCurrency] = useState('BDT')
  const [taxRate, setTaxRate] = useState('0')
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    if (restaurant) setName(restaurant.name)
  }, [restaurant])
  useEffect(() => {
    if (settings) {
      setCurrency(settings.currency)
      setTaxRate(String(settings.tax_rate))
    }
  }, [settings])
  useEffect(() => {
    if (!restaurant) return
    let cancelled = false
    void fetchBranches(restaurant.id)
      .then((branches) => {
        if (cancelled) return
        const main = branches[0] ?? null
        setBranch(main)
        if (main) {
          setPhone(main.phone ?? '')
          setAddress(main.address ?? '')
        }
      })
      .catch(() => {
        // Contact fields are optional — a failed branch load just
        // leaves them empty.
      })
    return () => {
      cancelled = true
    }
  }, [restaurant])

  if (!restaurant || !settings) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <p className="text-muted-foreground">{t('setup.noRestaurant')}</p>
      </main>
    )
  }
  const restaurantId = restaurant.id

  const handleSaveInfo = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setSaveFailed(false)
    try {
      await updateRestaurant(restaurantId, {
        name: name.trim(),
        default_currency: currency,
      })
      await updateSettingsPartial(restaurantId, {
        currency,
        tax_rate: Number.parseFloat(taxRate) || 0,
        ...(settings.branding_name
          ? {}
          : { branding_name: name.trim() || null }),
      })
      if (branch) {
        await updateBranchContact(branch.id, {
          phone: phone.trim() || null,
          address: address.trim() || null,
        })
      }
      await refreshWorkspace()
      setStep(2)
    } catch {
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }

  const handleFinish = async () => {
    if (finishing) return
    setFinishing(true)
    try {
      await updateSettingsPartial(restaurantId, {
        onboarding_completed: true,
      })
      await refreshWorkspace()
      navigate(panelRoot)
    } catch {
      setFinishing(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">{t('setup.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('setup.subtitle')}
        </p>
        <p className="mt-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t('setup.stepOf', { current: step, total: 3 })}
        </p>
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('setup.step1Title')}</CardTitle>
            <CardDescription>{t('setup.step1Desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => void handleSaveInfo(e)}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="setup-name">{t('setup.nameLabel')}</Label>
                <Input
                  id="setup-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="setup-phone">{t('setup.phoneLabel')}</Label>
                  <Input
                    id="setup-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="setup-currency">
                    {t('setup.currencyLabel')}
                  </Label>
                  <select
                    id="setup-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="setup-address">
                    {t('setup.addressLabel')}
                  </Label>
                  <Input
                    id="setup-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="setup-vat">{t('setup.vatLabel')}</Label>
                  <Input
                    id="setup-vat"
                    type="number"
                    min="0"
                    step="0.1"
                    value={taxRate}
                    onChange={(e) => setTaxRate(e.target.value)}
                  />
                </div>
              </div>
              {saveFailed && (
                <p role="alert" className="text-sm text-destructive">
                  {t('setup.saveFailed')}
                </p>
              )}
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving || !name.trim()}>
                  {saving ? t('setup.saving') : t('setup.saveContinue')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={finishing}
                  onClick={() => void handleFinish()}
                >
                  {t('setup.skip')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <>
          {isHeartbeatConfigured() ? (
            <LicenseCard />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>{t('setup.step2Title')}</CardTitle>
                <CardDescription>{t('setup.step2Desc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ActivationForm />
              </CardContent>
            </Card>
          )}
          <div className="flex items-center gap-3">
            <Button type="button" onClick={() => setStep(3)}>
              {t('setup.continue')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={finishing}
              onClick={() => void handleFinish()}
            >
              {t('setup.skip')}
            </Button>
          </div>
        </>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('setup.step3Title')}</CardTitle>
            <CardDescription>{t('setup.step3Desc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                disabled={finishing}
                onClick={() => void handleFinish()}
              >
                {finishing ? t('setup.finishing') : t('setup.finishButton')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={finishing}
                onClick={() => {
                  void (async () => {
                    setFinishing(true)
                    try {
                      await updateSettingsPartial(restaurantId, {
                        onboarding_completed: true,
                      })
                      await refreshWorkspace()
                      navigate(toPanel('/settings'))
                    } catch {
                      setFinishing(false)
                    }
                  })()
                }}
              >
                {t('setup.goSettings')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
