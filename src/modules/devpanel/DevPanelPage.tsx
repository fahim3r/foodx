// FoodX — Developer Panel (Phase 8 Step 1: manual registry).
//
// The vendor control center (§2B): clients, licenses, releases and
// per-client feature registrations. Completely separated from the
// restaurant admin panel (§88): /devpanel has its own sign-in gate and
// every dev_* table is developer-only at the RLS level
// (public.is_developer(), migration 0014) — this page additionally
// checks the allow-list so non-developers get an honest notice instead
// of empty tables.
//
// STEP 1 HONESTY (§82): client instances run their own databases and do
// not report home yet, so versions and statuses shown here are AS
// REGISTERED by the developer in this panel. License expiry is the one
// computed value (an ACTIVE license past expiry reads EXPIRED).
// Heartbeat validation / live health arrive in Phase 8 Step 2 (§53).

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Session } from '@supabase/supabase-js'
import { registrySupabase as supabase } from '@/lib/registry'
import { authErrorKey } from '@/lib/errors'
import {
  addDevSupportNote,
  checkIsDeveloper,
  createDevClient,
  createDevLicense,
  createDevRelease,
  currentLicenseFor,
  effectiveLicenseStatus,
  featureStateMap,
  fetchDevClientFeatures,
  fetchDevHeartbeats,
  fetchDevBackupReports,
  setDeployHookUrl,
  triggerClientUpdate,
  TriggerUpdateError,
  fetchDevClients,
  fetchDevLicenses,
  fetchDevReleases,
  fetchDevSupportNotes,
  generateInstanceToken,
  latestPublishedRelease,
  licenseDaysLeft,
  renewDevLicense,
  setDevClientFeature,
  setDevClientStatus,
  setDevLicenseStatus,
  setDevReleaseStatus,
  updateDevClient,
  updatePendingClients,
  type DevClientInput,
  type DevLicenseInput,
} from '@/services/devpanel'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DEV_FEATURE_KEYS,
  LICENSE_PLANS,
  type DevClient,
  type DevHeartbeat,
  type DevBackupReport,
  type DevClientStatus,
  type DevFeatureKey,
  type DevLicense,
  type DevReleaseStatus,
  type DevSupportNote,
  type LicensePlan,
  type LicenseStatus,
} from '@/types'

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

const TEXTAREA_CLASS =
  'flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

type Tab = 'dashboard' | 'clients' | 'licenses' | 'releases'

/**
 * §72 "last update": when the client's current version first
 * appeared in its heartbeat history (Phase 8 R4). Heartbeats are
 * newest-first; the update moment is the oldest heartbeat of the
 * current version's consecutive run — but only when an older,
 * different version is visible below it. If the whole fetched
 * window already runs the current version, the transition is
 * older than the window and null is returned (shown as —) rather
 * than inventing a date.
 */
function lastUpdateFromHeartbeats(
  client: DevClient,
  beats: DevHeartbeat[],
): string | null {
  let oldestOfRun: string | null = null
  for (const h of beats) {
    if (h.version === client.version) {
      oldestOfRun = h.created_at
      continue
    }
    return oldestOfRun
  }
  return null
}

function todayLocal(): string {  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function emptyToNull(s: string): string | null {
  const v = s.trim()
  return v === '' ? null : v
}

function parseIntOrNull(s: string): number | null {
  const v = s.trim()
  if (v === '') return null
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? null : n
}

function badgeClass(status: string): string {
  switch (status) {
    case 'ACTIVE':
    case 'PUBLISHED':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
    case 'EXPIRED':
      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
    case 'SUSPENDED':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
    case 'PENDING':
    case 'DRAFT':
      return 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'
    default:
      return 'bg-muted text-muted-foreground'
  }
}

function Badge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(status)}`}
    >
      {label}
    </span>
  )
}

interface ClientFormState {
  restaurant_name: string
  owner_name: string
  contact_email: string
  contact_phone: string
  domain: string
  instance_url: string
  instance_supabase_ref: string
  version: string
  plan: string
  notes: string
}

const EMPTY_CLIENT_FORM: ClientFormState = {
  restaurant_name: '',
  owner_name: '',
  contact_email: '',
  contact_phone: '',
  domain: '',
  instance_url: '',
  instance_supabase_ref: '',
  version: '',
  plan: '',
  notes: '',
}

function clientToForm(c: DevClient): ClientFormState {
  return {
    restaurant_name: c.restaurant_name,
    owner_name: c.owner_name ?? '',
    contact_email: c.contact_email ?? '',
    contact_phone: c.contact_phone ?? '',
    domain: c.domain ?? '',
    instance_url: c.instance_url ?? '',
    instance_supabase_ref: c.instance_supabase_ref ?? '',
    version: c.version ?? '',
    plan: c.plan ?? '',
    notes: c.notes ?? '',
  }
}

function formToInput(f: ClientFormState): DevClientInput {
  return {
    restaurant_name: f.restaurant_name.trim(),
    owner_name: emptyToNull(f.owner_name),
    contact_email: emptyToNull(f.contact_email),
    contact_phone: emptyToNull(f.contact_phone),
    domain: emptyToNull(f.domain),
    instance_url: emptyToNull(f.instance_url),
    instance_supabase_ref: emptyToNull(f.instance_supabase_ref),
    version: emptyToNull(f.version),
    plan: emptyToNull(f.plan),
    notes: emptyToNull(f.notes),
  }
}

export default function DevPanelPage() {
  const { t } = useTranslation()
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [isDev, setIsDev] = useState<boolean | null>(null)

  // Sign-in form
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [signInBusy, setSignInBusy] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin')
  const [signUpNotice, setSignUpNotice] = useState<string | null>(null)

  // Registry data
  const [clients, setClients] = useState<DevClient[]>([])
  const [licenses, setLicenses] = useState<DevLicense[]>([])
  const [releases, setReleases] = useState<
    Awaited<ReturnType<typeof fetchDevReleases>>
  >([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('dashboard')

  // Client form / detail
  const [showClientForm, setShowClientForm] = useState(false)
  const [editingClient, setEditingClient] = useState<DevClient | null>(null)
  const [clientForm, setClientForm] =
    useState<ClientFormState>(EMPTY_CLIENT_FORM)
  const [clientBusy, setClientBusy] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [featureMap, setFeatureMap] = useState<Record<
    DevFeatureKey,
    boolean
  > | null>(null)
  const [supportNotes, setSupportNotes] = useState<DevSupportNote[]>([])
  const [heartbeats, setHeartbeats] = useState<DevHeartbeat[]>([])
  const [backupReports, setBackupReports] = useState<DevBackupReport[]>([])
  const [issuedToken, setIssuedToken] = useState<string | null>(null)
  const [tokenBusy, setTokenBusy] = useState(false)
  const [hookDraft, setHookDraft] = useState('')
  const [hookBusy, setHookBusy] = useState(false)
  const [deployBusy, setDeployBusy] = useState(false)
  const [deployNotice, setDeployNotice] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)

  // License form (create + renew)
  const [showLicenseForm, setShowLicenseForm] = useState(false)
  const [renewFrom, setRenewFrom] = useState<DevLicense | null>(null)
  const [licClientId, setLicClientId] = useState('')
  const [licPlan, setLicPlan] = useState<LicensePlan>('MONTHLY')
  const [licStart, setLicStart] = useState(todayLocal())
  const [licExpiry, setLicExpiry] = useState('')
  const [licMaxBranches, setLicMaxBranches] = useState('')
  const [licMaxUsers, setLicMaxUsers] = useState('')
  const [licMaxDevices, setLicMaxDevices] = useState('')
  const [licBusy, setLicBusy] = useState(false)

  // Release form
  const [showReleaseForm, setShowReleaseForm] = useState(false)
  const [relVersion, setRelVersion] = useState('')
  const [relNotes, setRelNotes] = useState('')
  const [relMigrations, setRelMigrations] = useState('')
  const [relCompat, setRelCompat] = useState('')
  const [relTarget, setRelTarget] = useState('ALL')
  const [relBusy, setRelBusy] = useState(false)

  const today = useMemo(() => todayLocal(), [])

  // --- Session -------------------------------------------------------------
  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user) {
      setIsDev(null)
      return
    }
    let active = true
    checkIsDeveloper(session.user.id)
      .then((v) => {
        if (active) setIsDev(v)
      })
      .catch(() => {
        if (active) setIsDev(false)
      })
    return () => {
      active = false
    }
  }, [session])

  // --- Data ----------------------------------------------------------------
  const loadAll = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [c, l, r] = await Promise.all([
        fetchDevClients(),
        fetchDevLicenses(),
        fetchDevReleases(),
      ])
      setClients(c)
      setLicenses(l)
      setReleases(r)
    } catch {
      setLoadError(t('devpanel.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (isDev) void loadAll()
  }, [isDev, loadAll])

  // Client detail: features + support notes follow the selection.
  useEffect(() => {
    if (!selectedClientId) {
      setFeatureMap(null)
      setSupportNotes([])
      setHeartbeats([])
      setBackupReports([])
      setIssuedToken(null)
      return
    }
    let active = true
    Promise.all([
      fetchDevClientFeatures(selectedClientId),
      fetchDevSupportNotes(selectedClientId),
      fetchDevHeartbeats(selectedClientId, 50),
      fetchDevBackupReports(selectedClientId),
    ])
      .then(([features, notes, beats, backups]) => {
        if (!active) return
        setFeatureMap(featureStateMap(features))
        setSupportNotes(notes)
        setHeartbeats(beats)
        setBackupReports(backups)
      })
      .catch(() => {
        if (active) setActionError(t('devpanel.loadError'))
      })
    return () => {
      active = false
    }
  }, [selectedClientId, t])

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId) ?? null,
    [clients, selectedClientId],
  )

  // The deploy-hook draft follows the selected client's stored
  // value; typing only changes the draft, never the stored value.
  useEffect(() => {
    setHookDraft(selectedClient?.deploy_hook_url ?? '')
    setDeployNotice(null)
  }, [selectedClient?.id, selectedClient?.deploy_hook_url])

  const latestRelease = useMemo(
    () => latestPublishedRelease(releases),
    [releases],
  )
  const pendingUpdates = useMemo(
    () => updatePendingClients(clients, releases),
    [clients, releases],
  )
  const pendingUpdateIds = useMemo(
    () => new Set(pendingUpdates.map((c) => c.id)),
    [pendingUpdates],
  )

  const licenseCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const lic of licenses) {
      if (lic.status === 'CANCELLED' || lic.status === 'RENEWED') continue
      const eff = effectiveLicenseStatus(lic, today)
      counts[eff] = (counts[eff] ?? 0) + 1
    }
    return counts
  }, [licenses, today])

  const clientsWithoutLicense = useMemo(
    () =>
      clients.filter((c) => currentLicenseFor(licenses, c.id) === null)
        .length,
    [clients, licenses],
  )

  // --- Handlers --------------------------------------------------------------
  // The Developer Panel authenticates against the REGISTRY project
  // (Phase 8 R5), not the deployment's own project: the developer
  // allow-list lives there. Sign-up exists so the vendor can create
  // their registry account from this gate; a fresh account still
  // sees the locked notice until it is added to dev_developers.
  async function handleSignIn(e: FormEvent) {
    e.preventDefault()
    setSignInBusy(true)
    setSignInError(null)
    setSignUpNotice(null)
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        })
        if (error) throw error
        if (!data.session) setSignUpNotice(t('devpanel.signUpCheckEmail'))
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (error) throw error
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined
      setSignInError(t(authErrorKey(message)))
    } finally {
      setSignInBusy(false)
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    setIsDev(null)
    setClients([])
    setLicenses([])
    setReleases([])
  }

  async function runAction(fn: () => Promise<void>) {
    setActionError(null)
    try {
      await fn()
      await loadAll()
    } catch {
      setActionError(t('devpanel.loadError'))
    }
  }

  async function handleClientSubmit(e: FormEvent) {
    e.preventDefault()
    if (clientForm.restaurant_name.trim() === '') return
    setClientBusy(true)
    try {
      if (editingClient) {
        await updateDevClient(editingClient.id, formToInput(clientForm))
      } else {
        const created = await createDevClient(formToInput(clientForm))
        setSelectedClientId(created.id)
      }
      setShowClientForm(false)
      setEditingClient(null)
      setClientForm(EMPTY_CLIENT_FORM)
      await loadAll()
    } catch {
      setActionError(t('devpanel.loadError'))
    } finally {
      setClientBusy(false)
    }
  }

  async function handleGenerateToken() {
    if (!selectedClient) return
    setTokenBusy(true)
    setActionError(null)
    try {
      const token = await generateInstanceToken(selectedClient.id)
      setIssuedToken(token)
      await loadAll()
    } catch {
      setActionError(t('devpanel.actionError'))
    } finally {
      setTokenBusy(false)
    }
  }

  async function handleSaveHook() {
    if (!selectedClient) return
    setHookBusy(true)
    setActionError(null)
    try {
      const value = hookDraft.trim()
      await setDeployHookUrl(selectedClient.id, value === '' ? null : value)
      await loadAll()
    } catch {
      setActionError(t('devpanel.actionError'))
    } finally {
      setHookBusy(false)
    }
  }

  async function handleDeployUpdate() {
    if (!selectedClient) return
    setDeployBusy(true)
    setDeployNotice(null)
    setActionError(null)
    try {
      await triggerClientUpdate(selectedClient.id)
      setDeployNotice(t('devpanel.updateStarted'))
    } catch (err) {
      if (err instanceof TriggerUpdateError && err.code === 'no_deploy_hook') {
        setDeployNotice(t('devpanel.updateNoHook'))
      } else if (
        err instanceof TriggerUpdateError &&
        err.code === 'hook_failed'
      ) {
        setDeployNotice(
          t('devpanel.updateHookFailed', { status: err.hookStatus ?? '' }),
        )
      } else {
        setActionError(t('devpanel.actionError'))
      }
    } finally {
      setDeployBusy(false)
    }
  }

  async function handleFeatureToggle(key: DevFeatureKey, enabled: boolean) {
    if (!selectedClientId) return
    setFeatureMap((prev) => (prev ? { ...prev, [key]: enabled } : prev))
    try {
      await setDevClientFeature(selectedClientId, key, enabled)
    } catch {
      setActionError(t('devpanel.loadError'))
      const rows = await fetchDevClientFeatures(selectedClientId)
      setFeatureMap(featureStateMap(rows))
    }
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault()
    if (!selectedClientId || noteText.trim() === '') return
    setNoteBusy(true)
    try {
      await addDevSupportNote(
        selectedClientId,
        noteText.trim(),
        session?.user?.id ?? null,
      )
      setNoteText('')
      setSupportNotes(await fetchDevSupportNotes(selectedClientId))
    } catch {
      setActionError(t('devpanel.loadError'))
    } finally {
      setNoteBusy(false)
    }
  }

  function openLicenseForm(clientId: string, renew: DevLicense | null) {
    setRenewFrom(renew)
    setLicClientId(renew ? renew.client_id : clientId)
    setLicPlan(renew ? renew.plan : 'MONTHLY')
    setLicStart(todayLocal())
    setLicExpiry('')
    setLicMaxBranches(renew?.max_branches?.toString() ?? '')
    setLicMaxUsers(renew?.max_users?.toString() ?? '')
    setLicMaxDevices(renew?.max_devices?.toString() ?? '')
    setShowLicenseForm(true)
    setTab('licenses')
  }

  async function handleLicenseSubmit(e: FormEvent) {
    e.preventDefault()
    if (licClientId === '' || licStart === '') return
    if (licPlan !== 'LIFETIME' && licExpiry === '') return
    const input: DevLicenseInput = {
      client_id: licClientId,
      plan: licPlan,
      start_date: licStart,
      expiry_date: licPlan === 'LIFETIME' ? null : licExpiry,
      max_branches: parseIntOrNull(licMaxBranches),
      max_users: parseIntOrNull(licMaxUsers),
      max_devices: parseIntOrNull(licMaxDevices),
    }
    setLicBusy(true)
    try {
      if (renewFrom) {
        await renewDevLicense(renewFrom, input)
      } else {
        await createDevLicense(input, 'PENDING')
      }
      setShowLicenseForm(false)
      setRenewFrom(null)
      await loadAll()
    } catch {
      setActionError(t('devpanel.loadError'))
    } finally {
      setLicBusy(false)
    }
  }

  async function handleReleaseSubmit(e: FormEvent) {
    e.preventDefault()
    if (relVersion.trim() === '') return
    setRelBusy(true)
    try {
      await createDevRelease({
        version: relVersion.trim(),
        release_notes: emptyToNull(relNotes),
        required_migrations: relMigrations
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s !== ''),
        compatibility: emptyToNull(relCompat),
        target_client_ids: relTarget === 'ALL' ? null : [relTarget],
      })
      setShowReleaseForm(false)
      setRelVersion('')
      setRelNotes('')
      setRelMigrations('')
      setRelCompat('')
      setRelTarget('ALL')
      await loadAll()
    } catch {
      setActionError(t('devpanel.loadError'))
    } finally {
      setRelBusy(false)
    }
  }

  // --- Gate screens ----------------------------------------------------------
  if (session === undefined || (session && isDev === null)) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-4">
        <p className="text-sm text-muted-foreground">{t('devpanel.loading')}</p>
      </main>
    )
  }

  if (!session) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="items-center text-center">
            <CardTitle className="text-2xl">{t('devpanel.title')}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {authMode === 'signup'
                ? t('devpanel.signUpBody')
                : t('devpanel.signInBody')}
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="dev-email">{t('devpanel.email')}</Label>
                <Input
                  id="dev-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dev-password">{t('devpanel.password')}</Label>
                <Input
                  id="dev-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {signInError && (
                <p className="text-sm text-destructive">{signInError}</p>
              )}
              {signUpNotice && (
                <p className="text-sm text-muted-foreground">{signUpNotice}</p>
              )}
              <Button type="submit" className="w-full" disabled={signInBusy}>
                {signInBusy
                  ? authMode === 'signup'
                    ? t('devpanel.signingUp')
                    : t('devpanel.signingIn')
                  : authMode === 'signup'
                    ? t('devpanel.signUp')
                    : t('devpanel.signIn')}
              </Button>
            </form>
            <p className="mt-4 text-center text-sm">
              <button
                type="button"
                className="font-medium text-primary hover:underline"
                onClick={() => {
                  setAuthMode(authMode === 'signup' ? 'signin' : 'signup')
                  setSignInError(null)
                  setSignUpNotice(null)
                }}
              >
                {authMode === 'signup'
                  ? t('devpanel.switchToSignIn')
                  : t('devpanel.switchToSignUp')}
              </button>
            </p>
            <p className="mt-4 text-center text-sm">
              <Link to="/" className="font-medium text-primary hover:underline">
                {t('devpanel.backToStore')}
              </Link>
            </p>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (!isDev) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-4">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            {t('devpanel.title')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('devpanel.notDeveloperBody')}
          </p>
          <div className="mt-4 flex items-center justify-center gap-4 text-sm">
            <Button variant="outline" onClick={handleSignOut}>
              {t('devpanel.signOut')}
            </Button>
            <Link to="/" className="font-medium text-primary hover:underline">
              {t('devpanel.backToStore')}
            </Link>
          </div>
        </div>
      </main>
    )
  }

  // --- Panel -------------------------------------------------------------------
  const TABS: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: t('devpanel.tabDashboard') },
    { key: 'clients', label: t('devpanel.tabClients') },
    { key: 'licenses', label: t('devpanel.tabLicenses') },
    { key: 'releases', label: t('devpanel.tabReleases') },
  ]

  return (
    <main className="min-h-svh bg-background px-4 py-6">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t('devpanel.title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('devpanel.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{session.user.email}</span>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              {t('devpanel.signOut')}
            </Button>
          </div>
        </div>

        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          {t('devpanel.asRegisteredNote')}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((item) => (
            <Button
              key={item.key}
              variant={tab === item.key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        {loadError && (
          <Card className="mt-4">
            <CardContent className="flex items-center justify-between py-4">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => void loadAll()}>
                {t('devpanel.retry')}
              </Button>
            </CardContent>
          </Card>
        )}
        {actionError && (
          <p className="mt-3 text-sm text-destructive">{actionError}</p>
        )}
        {loading && (
          <p className="mt-4 text-sm text-muted-foreground">
            {t('devpanel.loading')}
          </p>
        )}

        {tab === 'dashboard' && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('devpanel.statTotalClients')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{clients.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('devpanel.statActiveLicenses')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">
                  {licenseCounts['ACTIVE'] ?? 0}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('devpanel.statExpiredLicenses')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">
                  {licenseCounts['EXPIRED'] ?? 0}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('devpanel.statSuspendedLicenses')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">
                  {licenseCounts['SUSPENDED'] ?? 0}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('devpanel.statCurrentVersion')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">
                  {latestRelease ? latestRelease.version : '—'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('devpanel.statUpdatePending')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{pendingUpdates.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('devpanel.statNoLicense')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{clientsWithoutLicense}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {t('devpanel.healthTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const dayMs = 24 * 60 * 60 * 1000
                  const nowMs = Date.now()
                  const fresh = clients.filter(
                    (c) =>
                      c.last_seen_at &&
                      nowMs - new Date(c.last_seen_at).getTime() < dayMs,
                  ).length
                  const stale = clients.filter(
                    (c) =>
                      c.last_seen_at &&
                      nowMs - new Date(c.last_seen_at).getTime() >= dayMs,
                  ).length
                  const never = clients.filter((c) => !c.last_seen_at).length
                  // Backup health (Phase 8 R3): from the latest
                  // report each client carries — fresh = success
                  // within 48h, stale = older success, failed =
                  // the last run failed, never = no report yet.
                  const backupFresh = clients.filter(
                    (c) =>
                      c.last_backup_status === 'success' &&
                      c.last_backup_at &&
                      nowMs - new Date(c.last_backup_at).getTime() <
                        2 * dayMs,
                  ).length
                  const backupStale = clients.filter(
                    (c) =>
                      c.last_backup_status === 'success' &&
                      c.last_backup_at &&
                      nowMs - new Date(c.last_backup_at).getTime() >=
                        2 * dayMs,
                  ).length
                  const backupFailed = clients.filter(
                    (c) => c.last_backup_status === 'failed',
                  ).length
                  const backupNever = clients.filter(
                    (c) => !c.last_backup_at,
                  ).length
                  return (
                    <div className="space-y-1 text-sm">
                      <p>
                        {t('devpanel.healthFresh')}:{' '}
                        <span className="font-semibold">{fresh}</span>
                      </p>
                      <p>
                        {t('devpanel.healthStale')}:{' '}
                        <span className="font-semibold">{stale}</span>
                      </p>
                      <p>
                        {t('devpanel.healthNever')}:{' '}
                        <span className="font-semibold">{never}</span>
                      </p>
                      <p className="pt-2">
                        {t('devpanel.healthBackupFresh')}:{' '}
                        <span className="font-semibold">{backupFresh}</span>
                      </p>
                      <p>
                        {t('devpanel.healthBackupStale')}:{' '}
                        <span className="font-semibold">{backupStale}</span>
                      </p>
                      <p
                        className={
                          backupFailed > 0 ? 'text-destructive' : undefined
                        }
                      >
                        {t('devpanel.healthBackupFailed')}:{' '}
                        <span className="font-semibold">{backupFailed}</span>
                      </p>
                      <p>
                        {t('devpanel.healthBackupNever')}:{' '}
                        <span className="font-semibold">{backupNever}</span>
                      </p>
                    </div>
                  )
                })()}
              </CardContent>
            </Card>
          </div>
        )}

        {tab === 'clients' && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {t('devpanel.clientsTitle')}
              </h2>
              <Button
                size="sm"
                onClick={() => {
                  setEditingClient(null)
                  setClientForm(EMPTY_CLIENT_FORM)
                  setShowClientForm((v) => !v)
                }}
              >
                {t('devpanel.newClient')}
              </Button>
            </div>

            {showClientForm && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {editingClient
                      ? t('devpanel.editClient')
                      : t('devpanel.newClient')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={handleClientSubmit}
                    className="grid gap-3 sm:grid-cols-2"
                  >
                    <div className="space-y-1">
                      <Label>{t('devpanel.restaurantName')} *</Label>
                      <Input
                        value={clientForm.restaurant_name}
                        onChange={(e) =>
                          setClientForm({
                            ...clientForm,
                            restaurant_name: e.target.value,
                          })
                        }
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.ownerName')}</Label>
                      <Input
                        value={clientForm.owner_name}
                        onChange={(e) =>
                          setClientForm({
                            ...clientForm,
                            owner_name: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.contactEmail')}</Label>
                      <Input
                        type="email"
                        value={clientForm.contact_email}
                        onChange={(e) =>
                          setClientForm({
                            ...clientForm,
                            contact_email: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.contactPhone')}</Label>
                      <Input
                        value={clientForm.contact_phone}
                        onChange={(e) =>
                          setClientForm({
                            ...clientForm,
                            contact_phone: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.domain')}</Label>
                      <Input
                        value={clientForm.domain}
                        onChange={(e) =>
                          setClientForm({
                            ...clientForm,
                            domain: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.instanceUrl')}</Label>
                      <Input
                        value={clientForm.instance_url}
                        onChange={(e) =>
                          setClientForm({
                            ...clientForm,
                            instance_url: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.supabaseRef')}</Label>
                      <Input
                        value={clientForm.instance_supabase_ref}
                        onChange={(e) =>
                          setClientForm({
                            ...clientForm,
                            instance_supabase_ref: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.version')}</Label>
                      <Input
                        value={clientForm.version}
                        onChange={(e) =>
                          setClientForm({
                            ...clientForm,
                            version: e.target.value,
                          })
                        }
                        placeholder="1.0.0"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.plan')}</Label>
                      <Input
                        value={clientForm.plan}
                        onChange={(e) =>
                          setClientForm({ ...clientForm, plan: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label>{t('devpanel.notes')}</Label>
                      <textarea
                        className={TEXTAREA_CLASS}
                        rows={2}
                        value={clientForm.notes}
                        onChange={(e) =>
                          setClientForm({
                            ...clientForm,
                            notes: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="flex gap-2 sm:col-span-2">
                      <Button type="submit" disabled={clientBusy}>
                        {clientBusy ? t('devpanel.saving') : t('devpanel.save')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setShowClientForm(false)
                          setEditingClient(null)
                        }}
                      >
                        {t('devpanel.cancel')}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="py-2">
                {clients.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    {t('devpanel.noClients')}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.clientCode')}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.restaurantName')}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.domain')}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.version')}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.currentLicense')}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.status')}
                          </th>
                          <th className="py-2 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {clients.map((c) => {
                          const lic = currentLicenseFor(licenses, c.id)
                          const eff = lic
                            ? effectiveLicenseStatus(lic, today)
                            : null
                          return (
                            <tr
                              key={c.id}
                              className={`border-b last:border-0 ${
                                selectedClientId === c.id ? 'bg-muted/50' : ''
                              }`}
                            >
                              <td className="py-2 pr-3 font-mono text-xs">
                                {c.client_code}
                              </td>
                              <td className="py-2 pr-3 font-medium">
                                {c.restaurant_name}
                              </td>
                              <td className="py-2 pr-3">
                                {c.domain ?? '—'}
                              </td>
                              <td className="py-2 pr-3">
                                {c.version ?? '—'}
                                <span className="block text-xs text-muted-foreground">
                                  {c.last_seen_at
                                    ? t('devpanel.lastCheckIn', {
                                        when: new Date(
                                          c.last_seen_at,
                                        ).toLocaleString(),
                                      })
                                    : t('devpanel.neverCheckedIn')}
                                </span>
                                {pendingUpdateIds.has(c.id) && (
                                  <span className="ml-2">
                                    <Badge
                                      status="SUSPENDED"
                                      label={t('devpanel.updatePendingBadge')}
                                    />
                                  </span>
                                )}
                              </td>
                              <td className="py-2 pr-3">
                                {lic && eff ? (
                                  <Badge
                                    status={eff}
                                    label={t(`devpanel.licenseStatus_${eff}`)}
                                  />
                                ) : (
                                  <span className="text-muted-foreground">
                                    {t('devpanel.noLicense')}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 pr-3">
                                <Badge
                                  status={c.status}
                                  label={t(
                                    `devpanel.clientStatus_${c.status}`,
                                  )}
                                />
                              </td>
                              <td className="py-2 text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setSelectedClientId(
                                      selectedClientId === c.id ? null : c.id,
                                    )
                                  }
                                >
                                  {t('devpanel.details')}
                                </Button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {selectedClient && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {selectedClient.client_code} —{' '}
                    {selectedClient.restaurant_name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingClient(selectedClient)
                        setClientForm(clientToForm(selectedClient))
                        setShowClientForm(true)
                      }}
                    >
                      {t('devpanel.editClient')}
                    </Button>
                    {selectedClient.status === 'ACTIVE' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void runAction(() =>
                            setDevClientStatus(
                              selectedClient.id,
                              'SUSPENDED' as DevClientStatus,
                            ),
                          )
                        }
                      >
                        {t('devpanel.suspend')}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void runAction(() =>
                            setDevClientStatus(
                              selectedClient.id,
                              'ACTIVE' as DevClientStatus,
                            ),
                          )
                        }
                      >
                        {t('devpanel.activate')}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openLicenseForm(selectedClient.id, null)}
                    >
                      {t('devpanel.newLicense')}
                    </Button>
                  </div>

                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <p>
                      <span className="text-muted-foreground">
                        {t('devpanel.ownerName')}:{' '}
                      </span>
                      {selectedClient.owner_name ?? '—'}
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        {t('devpanel.contactEmail')}:{' '}
                      </span>
                      {selectedClient.contact_email ?? '—'}
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        {t('devpanel.contactPhone')}:{' '}
                      </span>
                      {selectedClient.contact_phone ?? '—'}
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        {t('devpanel.instanceUrl')}:{' '}
                      </span>
                      {selectedClient.instance_url ?? '—'}
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        {t('devpanel.supabaseRef')}:{' '}
                      </span>
                      {selectedClient.instance_supabase_ref ?? '—'}
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        {t('devpanel.plan')}:{' '}
                      </span>
                      {selectedClient.plan ?? '—'}
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        {t('devpanel.usageBranches')}:{' '}
                      </span>
                      {selectedClient.last_branch_count ?? '—'}
                      {' / '}
                      {currentLicenseFor(licenses, selectedClient.id)
                        ?.max_branches ?? t('devpanel.unlimited')}
                    </p>
                    <p>
                      <span className="text-muted-foreground">
                        {t('devpanel.usageUsers')}:{' '}
                      </span>
                      {selectedClient.last_user_count ?? '—'}
                      {' / '}
                      {currentLicenseFor(licenses, selectedClient.id)
                        ?.max_users ?? t('devpanel.unlimited')}
                    </p>
                  </div>
                  {selectedClient.notes && (
                    <p className="text-sm text-muted-foreground">
                      {selectedClient.notes}
                    </p>
                  )}

                  <div>
                    <h3 className="text-sm font-semibold">
                      {t('devpanel.instanceAccessTitle')}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('devpanel.instanceAccessNote')}
                    </p>
                    <div className="mt-2 space-y-2 text-sm">
                      <p>
                        <span className="text-muted-foreground">
                          {t('devpanel.tokenStatus')}:{' '}
                        </span>
                        {selectedClient.instance_token_hash
                          ? t('devpanel.tokenIssued')
                          : t('devpanel.tokenNotIssued')}
                      </p>
                      <p>
                        <span className="text-muted-foreground">
                          {t('devpanel.lastCheckInLabel')}:{' '}
                        </span>
                        {selectedClient.last_seen_at
                          ? new Date(
                              selectedClient.last_seen_at,
                            ).toLocaleString()
                          : t('devpanel.neverCheckedIn')}
                        {selectedClient.last_seen_at && (
                          <span className="text-muted-foreground">
                            {' '}
                            ({t('devpanel.versionReported')})
                          </span>
                        )}
                      </p>
                      <p>
                        <span className="text-muted-foreground">
                          {t('devpanel.lastBackupLabel')}:{' '}
                        </span>
                        {selectedClient.last_backup_at ? (
                          <>
                            {new Date(
                              selectedClient.last_backup_at,
                            ).toLocaleString()}
                            {' — '}
                            {selectedClient.last_backup_status
                              ? t(
                                  `devpanel.backupStatus_${selectedClient.last_backup_status}`,
                                )
                              : ''}
                          </>
                        ) : (
                          t('devpanel.noBackupYet')
                        )}
                      </p>
                      <p>
                        <span className="text-muted-foreground">
                          {t('devpanel.lastUpdateLabel')}:{' '}
                        </span>
                        {(() => {
                          const at = lastUpdateFromHeartbeats(
                            selectedClient,
                            heartbeats,
                          )
                          return at ? new Date(at).toLocaleString() : '—'
                        })()}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={tokenBusy}
                        onClick={() => void handleGenerateToken()}
                      >
                        {selectedClient.instance_token_hash
                          ? t('devpanel.rotateToken')
                          : t('devpanel.generateToken')}
                      </Button>
                      {issuedToken && (
                        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                          <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                            {t('devpanel.tokenShownOnce')}
                          </p>
                          <p className="mt-1 font-mono text-xs break-all select-all">
                            VITE_FOODX_INSTANCE_TOKEN={issuedToken}
                          </p>
                          <p className="mt-1 font-mono text-xs break-all select-all">
                            VITE_FOODX_INSTANCE_ID=
                            {selectedClient.client_code}
                          </p>
                        </div>
                      )}
                      <div className="mt-3 border-t pt-3">
                        <h4 className="text-xs font-semibold text-muted-foreground">
                          {t('devpanel.deployHookLabel')}
                        </h4>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('devpanel.deployHookNote')}
                        </p>
                        <div className="mt-2 flex gap-2">
                          <Input
                            value={hookDraft}
                            onChange={(e) => setHookDraft(e.target.value)}
                            placeholder="https://api.vercel.com/v1/integrations/deploy/…"
                            className="font-mono text-xs"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={hookBusy}
                            onClick={() => void handleSaveHook()}
                          >
                            {t('devpanel.deployHookSave')}
                          </Button>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            disabled={
                              deployBusy || !selectedClient.deploy_hook_url
                            }
                            onClick={() => void handleDeployUpdate()}
                          >
                            {t('devpanel.deployUpdate')}
                          </Button>
                          {deployNotice && (
                            <span className="text-xs">{deployNotice}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {heartbeats.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-xs font-semibold text-muted-foreground">
                          {t('devpanel.recentHeartbeats')}
                        </h4>
                        <ul className="mt-1 space-y-1 text-xs">
                          {heartbeats.slice(0, 10).map((h) => (
                            <li key={h.id}>
                              {new Date(h.created_at).toLocaleString()} — v
                              {h.version}
                              {h.domain ? ` — ${h.domain}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {backupReports.length > 0 && (
                      <div className="mt-3">
                        <h4 className="text-xs font-semibold text-muted-foreground">
                          {t('devpanel.recentBackupReports')}
                        </h4>
                        <ul className="mt-1 space-y-1 text-xs">
                          {backupReports.map((r) => (
                            <li key={r.id}>
                              {new Date(r.created_at).toLocaleString()} —{' '}
                              {t(`devpanel.backupStatus_${r.status}`)}
                              {r.size_bytes !== null
                                ? ` — ${(r.size_bytes / 1024).toFixed(1)} KB`
                                : ''}
                              {r.note ? ` — ${r.note}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold">
                      {t('devpanel.featuresTitle')}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('devpanel.featuresNote')}
                    </p>
                    {featureMap && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {DEV_FEATURE_KEYS.map((key) => (
                          <label
                            key={key}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={featureMap[key]}
                              onChange={(e) =>
                                void handleFeatureToggle(key, e.target.checked)
                              }
                            />
                            {t(`devpanel.feature_${key}`)}
                          </label>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t('devpanel.featureNfcNote')}
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold">
                      {t('devpanel.supportNotesTitle')}
                    </h3>
                    <form
                      onSubmit={handleAddNote}
                      className="mt-2 flex gap-2"
                    >
                      <Input
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder={t('devpanel.supportNotePlaceholder')}
                      />
                      <Button type="submit" size="sm" disabled={noteBusy}>
                        {t('devpanel.addNote')}
                      </Button>
                    </form>
                    {supportNotes.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        {t('devpanel.noSupportNotes')}
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {supportNotes.map((n) => (
                          <li key={n.id} className="text-sm">
                            <span className="text-muted-foreground">
                              {new Date(n.created_at).toLocaleString()}
                            </span>{' '}
                            {n.note}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {tab === 'licenses' && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {t('devpanel.licensesTitle')}
              </h2>
              <Button
                size="sm"
                onClick={() => openLicenseForm(clients[0]?.id ?? '', null)}
                disabled={clients.length === 0}
              >
                {t('devpanel.newLicense')}
              </Button>
            </div>

            {showLicenseForm && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {renewFrom
                      ? t('devpanel.renewTitle')
                      : t('devpanel.newLicense')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={handleLicenseSubmit}
                    className="grid gap-3 sm:grid-cols-2"
                  >
                    <div className="space-y-1">
                      <Label>{t('devpanel.client')} *</Label>
                      <select
                        className={SELECT_CLASS}
                        value={licClientId}
                        onChange={(e) => setLicClientId(e.target.value)}
                        disabled={renewFrom !== null}
                        required
                      >
                        <option value="">—</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.client_code} — {c.restaurant_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.plan')} *</Label>
                      <select
                        className={SELECT_CLASS}
                        value={licPlan}
                        onChange={(e) =>
                          setLicPlan(e.target.value as LicensePlan)
                        }
                      >
                        {LICENSE_PLANS.map((p) => (
                          <option key={p} value={p}>
                            {t(`devpanel.plan_${p}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.startDate')} *</Label>
                      <Input
                        type="date"
                        value={licStart}
                        onChange={(e) => setLicStart(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.expiryDate')}</Label>
                      <Input
                        type="date"
                        value={licExpiry}
                        onChange={(e) => setLicExpiry(e.target.value)}
                        disabled={licPlan === 'LIFETIME'}
                        required={licPlan !== 'LIFETIME'}
                      />
                      {licPlan === 'LIFETIME' && (
                        <p className="text-xs text-muted-foreground">
                          {t('devpanel.noExpiry')}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.maxBranches')}</Label>
                      <Input
                        type="number"
                        min="0"
                        value={licMaxBranches}
                        onChange={(e) => setLicMaxBranches(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.maxUsers')}</Label>
                      <Input
                        type="number"
                        min="0"
                        value={licMaxUsers}
                        onChange={(e) => setLicMaxUsers(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.maxDevices')}</Label>
                      <Input
                        type="number"
                        min="0"
                        value={licMaxDevices}
                        onChange={(e) => setLicMaxDevices(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2 sm:col-span-2">
                      <Button type="submit" disabled={licBusy}>
                        {licBusy ? t('devpanel.saving') : t('devpanel.save')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setShowLicenseForm(false)
                          setRenewFrom(null)
                        }}
                      >
                        {t('devpanel.cancel')}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="py-2">
                {licenses.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    {t('devpanel.noLicenses')}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.licenseKey')}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.client')}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.plan')}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.expiryDate')}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.status')}
                          </th>
                          <th className="py-2 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {licenses.map((lic) => {
                          const client = clients.find(
                            (c) => c.id === lic.client_id,
                          )
                          const eff = effectiveLicenseStatus(lic, today)
                          const days = licenseDaysLeft(lic, today)
                          return (
                            <tr key={lic.id} className="border-b last:border-0">
                              <td className="py-2 pr-3 font-mono text-xs">
                                {lic.license_key}
                              </td>
                              <td className="py-2 pr-3">
                                {client
                                  ? `${client.client_code} — ${client.restaurant_name}`
                                  : '—'}
                              </td>
                              <td className="py-2 pr-3">
                                {t(`devpanel.plan_${lic.plan}`)}
                              </td>
                              <td className="py-2 pr-3">
                                {lic.expiry_date ?? t('devpanel.noExpiry')}
                                {days !== null && eff === 'ACTIVE' && (
                                  <span className="ml-2 text-xs text-muted-foreground">
                                    {days >= 0
                                      ? t('devpanel.daysLeft', { count: days })
                                      : t('devpanel.expired')}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 pr-3">
                                <Badge
                                  status={eff}
                                  label={t(`devpanel.licenseStatus_${eff}`)}
                                />
                              </td>
                              <td className="py-2">
                                <div className="flex flex-wrap justify-end gap-1">
                                  {(eff === 'PENDING' ||
                                    eff === 'SUSPENDED' ||
                                    eff === 'EXPIRED') && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        void runAction(() =>
                                          setDevLicenseStatus(
                                            lic.id,
                                            'ACTIVE' as LicenseStatus,
                                          ),
                                        )
                                      }
                                    >
                                      {t('devpanel.activate')}
                                    </Button>
                                  )}
                                  {eff === 'ACTIVE' && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        void runAction(() =>
                                          setDevLicenseStatus(
                                            lic.id,
                                            'SUSPENDED' as LicenseStatus,
                                          ),
                                        )
                                      }
                                    >
                                      {t('devpanel.suspend')}
                                    </Button>
                                  )}
                                  {(eff === 'ACTIVE' ||
                                    eff === 'EXPIRED' ||
                                    eff === 'SUSPENDED') && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() =>
                                        openLicenseForm(lic.client_id, lic)
                                      }
                                    >
                                      {t('devpanel.renew')}
                                    </Button>
                                  )}
                                  {lic.status !== 'CANCELLED' &&
                                    lic.status !== 'RENEWED' && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          void runAction(() =>
                                            setDevLicenseStatus(
                                              lic.id,
                                              'CANCELLED' as LicenseStatus,
                                            ),
                                          )
                                        }
                                      >
                                        {t('devpanel.cancelLicense')}
                                      </Button>
                                    )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {tab === 'releases' && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {t('devpanel.releasesTitle')}
              </h2>
              <Button
                size="sm"
                onClick={() => setShowReleaseForm((v) => !v)}
              >
                {t('devpanel.newRelease')}
              </Button>
            </div>

            {showReleaseForm && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {t('devpanel.newRelease')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={handleReleaseSubmit}
                    className="grid gap-3 sm:grid-cols-2"
                  >
                    <div className="space-y-1">
                      <Label>{t('devpanel.releaseVersion')} *</Label>
                      <Input
                        value={relVersion}
                        onChange={(e) => setRelVersion(e.target.value)}
                        placeholder="1.5.0"
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t('devpanel.target')}</Label>
                      <select
                        className={SELECT_CLASS}
                        value={relTarget}
                        onChange={(e) => setRelTarget(e.target.value)}
                      >
                        <option value="ALL">{t('devpanel.targetAll')}</option>
                        {clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.client_code} — {c.restaurant_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label>{t('devpanel.releaseNotes')}</Label>
                      <textarea
                        className={TEXTAREA_CLASS}
                        rows={3}
                        value={relNotes}
                        onChange={(e) => setRelNotes(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label>{t('devpanel.requiredMigrations')}</Label>
                      <textarea
                        className={TEXTAREA_CLASS}
                        rows={2}
                        value={relMigrations}
                        onChange={(e) => setRelMigrations(e.target.value)}
                        placeholder="0021_add_loyalty_rewards"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('devpanel.migrationsHint')}
                      </p>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label>{t('devpanel.compatibility')}</Label>
                      <Input
                        value={relCompat}
                        onChange={(e) => setRelCompat(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2 sm:col-span-2">
                      <Button type="submit" disabled={relBusy}>
                        {relBusy ? t('devpanel.saving') : t('devpanel.save')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowReleaseForm(false)}
                      >
                        {t('devpanel.cancel')}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="py-2">
                {releases.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    {t('devpanel.noReleases')}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.releaseVersion')}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.target')}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.requiredMigrations')}
                          </th>
                          <th className="py-2 pr-3 font-medium">
                            {t('devpanel.status')}
                          </th>
                          <th className="py-2 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {releases.map((r) => (
                          <tr key={r.id} className="border-b last:border-0">
                            <td className="py-2 pr-3 font-mono text-xs">
                              {r.version}
                            </td>
                            <td className="py-2 pr-3">
                              {r.target_client_ids === null
                                ? t('devpanel.targetAll')
                                : r.target_client_ids
                                    .map(
                                      (id) =>
                                        clients.find((c) => c.id === id)
                                          ?.client_code ?? id,
                                    )
                                    .join(', ')}
                            </td>
                            <td className="py-2 pr-3 font-mono text-xs">
                              {r.required_migrations.length > 0
                                ? r.required_migrations.join(', ')
                                : '—'}
                            </td>
                            <td className="py-2 pr-3">
                              <Badge
                                status={r.status}
                                label={t(`devpanel.releaseStatus_${r.status}`)}
                              />
                            </td>
                            <td className="py-2">
                              <div className="flex flex-wrap justify-end gap-1">
                                {r.status === 'DRAFT' && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      void runAction(() =>
                                        setDevReleaseStatus(
                                          r.id,
                                          'PUBLISHED' as DevReleaseStatus,
                                        ),
                                      )
                                    }
                                  >
                                    {t('devpanel.publish')}
                                  </Button>
                                )}
                                {r.status !== 'ARCHIVED' && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      void runAction(() =>
                                        setDevReleaseStatus(
                                          r.id,
                                          'ARCHIVED' as DevReleaseStatus,
                                        ),
                                      )
                                    }
                                  >
                                    {t('devpanel.archive')}
                                  </Button>
                                )}
                                {r.status === 'ARCHIVED' && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      void runAction(() =>
                                        setDevReleaseStatus(
                                          r.id,
                                          'DRAFT' as DevReleaseStatus,
                                        ),
                                      )
                                    }
                                  >
                                    {t('devpanel.toDraft')}
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </main>
  )
}

