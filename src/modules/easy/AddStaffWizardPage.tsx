// FoodX — Easy Mode v2 (wave E3; design §8, wizard 3): add a
// staff login the guided way — name → job → email + password —
// wrapping the same manage-staff create the Staff page uses
// (services/staff.ts). Owner/admin only, like the Staff page's
// own server-side gate; the entry button and this page both check
// admin level before showing anything.
//
// The four plain jobs map onto system roles by name: ওয়েটার →
// waiter, ক্যাশিয়ার → cashier, রাঁধুনি → kitchen_staff,
// ম্যানেজার → manager. The create passes the role's DEFAULT
// module set (defaultModulesForRole) — exactly what the normal
// form pre-ticks when a role is picked; the wizard offers no
// custom per-person module selection.
import { useEffect, useState } from 'react'
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
import {
  BigChoiceButton,
  EasyOnlyNote,
  EasyWizardQuestion,
  EasyWizardShell,
  EasyWizardSuccess,
  usePanelNav,
} from '@/components/EasyWizard'
import { useAuth } from '@/hooks/useAuth'
import { useEasyMode } from '@/hooks/useEasyMode'
import { usePermissions } from '@/hooks/usePermissions'
import { getLicenseLimitsFromCache } from '@/services/heartbeat'
import { fetchRoles } from '@/services/roles'
import { StaffError, createStaff, fetchStaff } from '@/services/staff'
import { defaultModulesForRole } from '@/services/staffModules'
import type { Role } from '@/types'

interface JobDef {
  key: string
  labelKey: string
  roleName: string
}

const JOB_DEFS: JobDef[] = [
  { key: 'waiter', labelKey: 'easy.wizard.jobWaiter', roleName: 'waiter' },
  { key: 'cashier', labelKey: 'easy.wizard.jobCashier', roleName: 'cashier' },
  { key: 'cook', labelKey: 'easy.wizard.jobCook', roleName: 'kitchen_staff' },
  { key: 'manager', labelKey: 'easy.wizard.jobManager', roleName: 'manager' },
]

interface ResolvedJob extends JobDef {
  role: Role
}

export default function AddStaffWizardPage() {
  const { t } = useTranslation()
  const { easy } = useEasyMode()
  if (!easy) {
    return <EasyOnlyNote normalTo="/staff" normalLabel={t('easy.nav.staff')} />
  }
  return <AddStaffWizard />
}

function AddStaffWizard() {
  const { t } = useTranslation()
  const { restaurant } = useAuth()
  const { ready: permissionsReady, isAdminLevel } = usePermissions()
  const { navTo } = usePanelNav()
  const restaurantId = restaurant?.id

  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [jobs, setJobs] = useState<ResolvedJob[] | null>(null)
  const [jobKey, setJobKey] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [doneName, setDoneName] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdminLevel) return
    let cancelled = false
    void fetchRoles()
      .then((roles) => {
        if (cancelled) return
        const resolved: ResolvedJob[] = []
        for (const def of JOB_DEFS) {
          const role = roles.find((row) => row.name === def.roleName)
          if (role) resolved.push({ ...def, role })
        }
        setJobs(resolved)
      })
      .catch(() => {
        if (!cancelled) setJobs([])
      })
    return () => {
      cancelled = true
    }
  }, [isAdminLevel])

  const selectedJob = jobs?.find((job) => job.key === jobKey) ?? null

  const handleCreate = async () => {
    if (busy || !selectedJob) return
    setError(null)
    const trimmedEmail = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setError(t('easy.wizard.emailRequired'))
      return
    }
    if (password.length < 6) {
      setError(t('easy.wizard.passwordShort'))
      return
    }
    setBusy(true)
    try {
      // §52 license limit, checked the same way the Staff form
      // checks it: the full staff list against the cached cap.
      const limits = getLicenseLimitsFromCache()
      if (limits?.max_users != null) {
        const staff = await fetchStaff().catch(() => null)
        if (staff && staff.length >= limits.max_users) {
          setError(t('easy.wizard.userLimit'))
          return
        }
      }
      await createStaff({
        email: trimmedEmail,
        password,
        full_name: name.trim(),
        role_id: selectedJob.role.id,
        branch_id: null,
        modules: defaultModulesForRole(selectedJob.role.name),
      })
      setDoneName(name.trim())
    } catch (err) {
      if (err instanceof StaffError) {
        setError(
          t(
            err.code === 'email_taken'
              ? 'easy.wizard.emailTaken'
              : err.code === 'not_admin'
                ? 'easy.wizard.staffAdminOnly'
                : err.code === 'invalid_role'
                  ? 'easy.wizard.roleMissing'
                  : 'easy.wizard.saveFailed',
          ),
        )
      } else {
        setError(t('easy.wizard.saveFailed'))
      }
    } finally {
      setBusy(false)
    }
  }

  const goNext = () => {
    setError(null)
    if (step === 0) {
      if (!name.trim()) {
        setError(t('easy.wizard.nameRequired'))
        return
      }
      setStep(1)
    } else if (step === 2) {
      void handleCreate()
    }
  }

  if (!permissionsReady || !restaurantId) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  if (!isAdminLevel) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>{t('easy.wizard.addStaffTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4">
            <p className="text-lg font-medium">
              {t('easy.wizard.staffAdminOnly')}
            </p>
            <Button asChild size="lg">
              <Link to={navTo('/staff')}>{t('easy.wizard.goNormal')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (doneName !== null) {
    return (
      <EasyWizardSuccess
        message={t('easy.wizard.staffCreated', { name: doneName })}
        doneTo="/staff"
      />
    )
  }

  return (
    <EasyWizardShell
      title={t('easy.wizard.addStaffTitle')}
      step={step}
      stepCount={3}
      error={error}
      busy={busy}
      onBack={step > 0 ? () => setStep(step - 1) : undefined}
      onNext={step === 1 ? undefined : goNext}
      nextLabel={
        step === 2 ? t('easy.wizard.createStaff') : t('common.next')
      }
    >
      {step === 0 && (
        <>
          <EasyWizardQuestion>
            {t('easy.wizard.staffNameQ')}
          </EasyWizardQuestion>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-12 text-lg"
            autoFocus
          />
        </>
      )}

      {step === 1 && (
        <>
          <EasyWizardQuestion>
            {t('easy.wizard.staffJobQ')}
          </EasyWizardQuestion>
          {jobs === null ? (
            <p className="text-muted-foreground">{t('common.loading')}</p>
          ) : jobs.length === 0 ? (
            <p className="text-base font-medium text-destructive">
              {t('easy.wizard.roleMissing')}
            </p>
          ) : (
            jobs.map((job) => (
              <BigChoiceButton
                key={job.key}
                selected={jobKey === job.key}
                onClick={() => {
                  setError(null)
                  setJobKey(job.key)
                  setStep(2)
                }}
              >
                {t(job.labelKey)}
              </BigChoiceButton>
            ))
          )}
        </>
      )}

      {step === 2 && (
        <>
          <EasyWizardQuestion>
            {t('easy.wizard.staffLoginQ')}
          </EasyWizardQuestion>
          <div className="flex flex-col gap-2">
            <Label htmlFor="easy-staff-email" className="text-base">
              {t('staff.emailLabel')}
            </Label>
            <Input
              id="easy-staff-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-12 text-lg"
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="easy-staff-password" className="text-base">
              {t('staff.passwordLabel')}
            </Label>
            <Input
              id="easy-staff-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-12 text-lg"
              autoComplete="new-password"
            />
          </div>
        </>
      )}
    </EasyWizardShell>
  )
}
