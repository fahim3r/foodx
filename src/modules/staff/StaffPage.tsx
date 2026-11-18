import { useCallback, useEffect, useState, type FormEvent } from 'react'
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
import { isMissingTableError } from '@/lib/errors'
import { fetchBranches, type Branch } from '@/services/restaurant'
import { getLicenseLimitsFromCache } from '@/services/heartbeat'
import { fetchRoles } from '@/services/roles'
import {
  StaffError,
  createStaff,
  fetchStaff,
  resetStaffPassword,
  setStaffActive,
  setStaffRole,
  type StaffMember,
} from '@/services/staff'
import type { Role } from '@/types'

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

/**
 * Staff management (landing/onboarding step 3). Admins create staff
 * logins with a role, change roles, reset passwords and deactivate
 * accounts. Everything goes through the manage-staff Edge Function
 * (staff.ts) — the browser cannot create logins or edit other
 * profiles itself. Non-admins get an honest notice; the function
 * enforces the same rule server-side.
 */
export default function StaffPage() {
  const { t } = useTranslation()
  const { user, restaurant } = useAuth()
  const restaurantId = restaurant?.id

  const [staff, setStaff] = useState<StaffMember[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [state, setState] = useState<
    'loading' | 'ready' | 'error' | 'notAdmin' | 'dbPending'
  >('loading')
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Create form
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [roleId, setRoleId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdOk, setCreatedOk] = useState(false)

  // Per-row password reset
  const [resetFor, setResetFor] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [passwordOkFor, setPasswordOkFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [staffData, rolesData] = await Promise.all([
        fetchStaff(),
        fetchRoles(),
      ])
      setStaff(staffData)
      setRoles(rolesData)
      setState('ready')
    } catch (error) {
      if (error instanceof StaffError && error.code === 'not_admin') {
        setState('notAdmin')
      } else if (isMissingTableError(error)) {
        setState('dbPending')
      } else {
        setState('error')
      }
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!restaurantId) return
    void fetchBranches(restaurantId)
      .then(setBranches)
      .catch(() => setBranches([]))
  }, [restaurantId])

  const runRowAction = async (
    member: StaffMember,
    action: () => Promise<StaffMember[]>,
  ) => {
    setBusyId(member.id)
    setActionError(null)
    try {
      setStaff(await action())
    } catch (error) {
      setActionError(
        error instanceof StaffError ? error.code : 'server_error',
      )
    } finally {
      setBusyId(null)
    }
  }

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (creating) return
    // §52 license limit (Phase 8 R2): creating beyond max_users is
    // refused before the Auth user is made. The staff list is the
    // restaurant's full profile list, the same basis the heartbeat
    // reports. No cached limit = no enforcement.
    const limits = getLicenseLimitsFromCache()
    if (limits?.max_users != null && staff.length >= limits.max_users) {
      setActionError('user_limit')
      return
    }
    setCreating(true)
    setActionError(null)
    setCreatedOk(false)
    try {
      const updated = await createStaff({
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        phone: phone.trim() || undefined,
        role_id: roleId,
        branch_id: branchId || null,
      })
      setStaff(updated)
      setFullName('')
      setEmail('')
      setPassword('')
      setPhone('')
      setBranchId('')
      setCreatedOk(true)
    } catch (error) {
      setActionError(
        error instanceof StaffError ? error.code : 'server_error',
      )
    } finally {
      setCreating(false)
    }
  }

  const handleResetPassword = async (member: StaffMember) => {
    setBusyId(member.id)
    setActionError(null)
    setPasswordOkFor(null)
    try {
      await resetStaffPassword(member.id, newPassword)
      setResetFor(null)
      setNewPassword('')
      setPasswordOkFor(member.id)
    } catch (error) {
      setActionError(
        error instanceof StaffError ? error.code : 'server_error',
      )
    } finally {
      setBusyId(null)
    }
  }

  if (state === 'loading') {
    return (
      <main className="px-4 py-8">
        <p className="text-muted-foreground">{t('common.loading')}</p>
      </main>
    )
  }
  if (state === 'dbPending') {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>{t('layout.dbPendingTitle')}</CardTitle>
            <CardDescription>{t('layout.dbPendingBody')}</CardDescription>
          </CardHeader>
        </Card>
      </main>
    )
  }
  if (state === 'notAdmin') {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>{t('staff.adminOnlyTitle')}</CardTitle>
            <CardDescription>{t('staff.adminOnlyBody')}</CardDescription>
          </CardHeader>
        </Card>
      </main>
    )
  }
  if (state === 'error') {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>{t('staff.title')}</CardTitle>
            <CardDescription>{t('staff.loadFailed')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" onClick={() => void load()}>
              {t('common.retry')}
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  const branchName = (id: string | null) =>
    branches.find((b) => b.id === id)?.name ?? '—'

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">{t('staff.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('staff.subtitle')}
        </p>
      </div>

      {actionError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t(`staff.error_${actionError}`, {
            max: getLicenseLimitsFromCache()?.max_users ?? '',
          })}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('staff.addTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => void handleCreate(e)}
            className="flex flex-col gap-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="staff-name">{t('staff.nameLabel')}</Label>
                <Input
                  id="staff-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="staff-email">{t('staff.emailLabel')}</Label>
                <Input
                  id="staff-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="staff-password">
                  {t('staff.passwordLabel')}
                </Label>
                <Input
                  id="staff-password"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="staff-phone">{t('staff.phoneLabel')}</Label>
                <Input
                  id="staff-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="staff-role">{t('staff.roleLabel')}</Label>
                <select
                  id="staff-role"
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  className={SELECT_CLASS}
                  required
                >
                  <option value="" disabled>
                    {t('staff.roleLabel')}
                  </option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.display_name ?? role.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="staff-branch">{t('staff.branchLabel')}</Label>
                <select
                  id="staff-branch"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">{t('staff.noBranch')}</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {createdOk && (
              <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                {t('staff.createdOk')}
              </p>
            )}
            <div>
              <Button
                type="submit"
                disabled={creating || !roleId || !fullName.trim()}
              >
                {creating ? t('staff.creating') : t('staff.createButton')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('staff.listTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {staff.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t('staff.emptyList')}
            </p>
          )}
          {staff.map((member) => {
            const isSelf = member.id === user?.id
            const currentRoleId = member.roles[0]?.id ?? ''
            return (
              <div
                key={member.id}
                className="flex flex-col gap-3 rounded-md border p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {member.full_name ?? member.email ?? '—'}
                      {isSelf && (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                          {t('staff.youBadge')}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {member.email ?? '—'}
                      {member.phone ? ` · ${member.phone}` : ''}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t('staff.branchLabel')}: {branchName(member.branch_id)}
                      {' · '}
                      {t('staff.lastSignIn')}:{' '}
                      {member.last_sign_in_at
                        ? new Date(member.last_sign_in_at).toLocaleString()
                        : t('staff.neverSignedIn')}
                    </p>
                  </div>
                  <span
                    className={
                      member.is_active
                        ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900'
                        : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                    }
                  >
                    {member.is_active
                      ? t('staff.statusActive')
                      : t('staff.statusInactive')}
                  </span>
                </div>

                {!isSelf && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={t('staff.changeRole')}
                      value={currentRoleId}
                      disabled={busyId === member.id}
                      onChange={(e) => {
                        const next = e.target.value
                        if (next && next !== currentRoleId) {
                          void runRowAction(member, () =>
                            setStaffRole(member.id, next),
                          )
                        }
                      }}
                      className={`${SELECT_CLASS} w-auto`}
                    >
                      {!currentRoleId && (
                        <option value="">{t('staff.noRole')}</option>
                      )}
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.display_name ?? role.name}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busyId === member.id}
                      onClick={() => {
                        setResetFor(resetFor === member.id ? null : member.id)
                        setNewPassword('')
                        setPasswordOkFor(null)
                      }}
                    >
                      {t('staff.resetPassword')}
                    </Button>
                    <Button
                      type="button"
                      variant={member.is_active ? 'destructive' : 'outline'}
                      size="sm"
                      disabled={busyId === member.id}
                      onClick={() =>
                        void runRowAction(member, () =>
                          setStaffActive(member.id, !member.is_active),
                        )
                      }
                    >
                      {member.is_active
                        ? t('staff.deactivate')
                        : t('staff.reactivate')}
                    </Button>
                  </div>
                )}

                {!isSelf && resetFor === member.id && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label={t('staff.newPasswordLabel')}
                      type="text"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={t('staff.newPasswordLabel')}
                      className="w-56"
                      autoComplete="off"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={busyId === member.id || newPassword.length < 6}
                      onClick={() => void handleResetPassword(member)}
                    >
                      {t('staff.setPasswordButton')}
                    </Button>
                  </div>
                )}
                {passwordOkFor === member.id && (
                  <p role="status" className="text-sm text-emerald-700">
                    {t('staff.passwordUpdated')}
                  </p>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </main>
  )
}

