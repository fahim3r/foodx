// FoodX — Settings → Domains (Phase 5).
// Manages the restaurant_domains rows for one restaurant: list, add,
// set primary, delete. The DNS instructions are the records Vercel
// asks for (A @ → 216.198.79.1, CNAME www → the Vercel DNS value);
// the Developer must ALSO add the domain in Vercel before the
// storefront loads — see DEPLOYMENT.md.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  addDomain,
  deleteDomain,
  fetchDomains,
  setPrimaryDomain,
} from '@/services/domains'
import type { RestaurantDomain } from '@/types'
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

const DOMAIN_ERROR_KEYS: Record<string, string> = {
  invalid_domain: 'settings.domains.invalidDomain',
  platform_domain: 'settings.domains.platformDomain',
  domain_taken: 'settings.domains.domainTaken',
}

export default function DomainSection({
  restaurantId,
}: {
  restaurantId: string
}) {
  const { t } = useTranslation()
  const [domains, setDomains] = useState<RestaurantDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [domainInput, setDomainInput] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyDomainId, setBusyDomainId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      setDomains(await fetchDomains(restaurantId))
    } catch (error) {
      console.error('[Domains] load failed', error)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    void load()
  }, [load])

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault()
    setErrorKey(null)
    setSaving(true)
    try {
      await addDomain(restaurantId, domainInput)
      setDomainInput('')
      await load()
    } catch (error) {
      console.error('[Domains] add failed', error)
      setErrorKey(
        error instanceof Error && DOMAIN_ERROR_KEYS[error.message]
          ? DOMAIN_ERROR_KEYS[error.message]
          : 'settings.domains.saveFailed',
      )
    } finally {
      setSaving(false)
    }
  }

  const handleSetPrimary = async (domainId: string) => {
    setErrorKey(null)
    setBusyDomainId(domainId)
    try {
      await setPrimaryDomain(restaurantId, domainId)
      await load()
    } catch (error) {
      console.error('[Domains] set primary failed', error)
      setErrorKey('settings.domains.saveFailed')
    } finally {
      setBusyDomainId(null)
    }
  }

  const handleDelete = async (domainId: string) => {
    setErrorKey(null)
    setBusyDomainId(domainId)
    try {
      await deleteDomain(domainId)
      await load()
    } catch (error) {
      console.error('[Domains] delete failed', error)
      setErrorKey('settings.domains.deleteFailed')
    } finally {
      setBusyDomainId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.domains.title')}</CardTitle>
        <CardDescription>{t('settings.domains.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <p className="text-sm text-muted-foreground">
            {t('common.loading')}
          </p>
        ) : loadError ? (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {t('settings.domains.loadFailed')}
          </p>
        ) : domains.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('settings.domains.noDomains')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {domains.map((domain) => (
              <li
                key={domain.id}
                className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span className="font-mono">{domain.domain}</span>
                {domain.is_primary && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900">
                    {t('settings.domains.primary')}
                  </span>
                )}
                <span className="ml-auto flex gap-2">
                  {!domain.is_primary && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyDomainId === domain.id}
                      onClick={() => void handleSetPrimary(domain.id)}
                    >
                      {t('settings.domains.setPrimary')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busyDomainId === domain.id}
                    onClick={() => void handleDelete(domain.id)}
                  >
                    {t('settings.domains.delete')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAdd} className="flex flex-col gap-2">
          <Label htmlFor="newDomain">{t('settings.domains.addDomain')}</Label>
          <div className="flex gap-2">
            <Input
              id="newDomain"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder={t('settings.domains.domainPlaceholder')}
              required
            />
            <Button type="submit" disabled={saving}>
              {t('settings.domains.add')}
            </Button>
          </div>
          {errorKey && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {t(errorKey)}
            </p>
          )}
        </form>

        <div className="rounded-lg border p-4 text-sm">
          <p className="font-medium">{t('settings.domains.dnsTitle')}</p>
          <p className="mt-1 text-muted-foreground">
            {t('settings.domains.dnsBody')}
          </p>
          <ul className="mt-2 list-disc pl-5 font-mono text-xs">
            <li>{t('settings.domains.aRecord')}</li>
            <li>{t('settings.domains.cnameRecord')}</li>
          </ul>
          <p className="mt-2 text-muted-foreground">
            {t('settings.domains.vercelNote')}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
