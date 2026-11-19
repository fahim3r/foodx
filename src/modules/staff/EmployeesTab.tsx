import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { usePermissions } from '@/hooks/usePermissions'
import { formatMoney } from '@/lib/money'
import {
  createEmployee,
  fetchEmployees,
  fetchLinkableProfiles,
  updateEmployee,
  type LinkableProfile,
} from '@/services/hrm'
import type { Employee } from '@/types'

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

const EMPTY_FORM = {
  fullName: '',
  phone: '',
  designation: '',
  salary: '',
  joinDate: '',
  profileId: '',
  notes: '',
}

/**
 * HRM — Employees tab (modifications v2, item 10). Directory of
 * everyone who works at the restaurant, whether or not they have
 * a panel login. Admin-level only: the database enforces it
 * (migration 0030), this gate just shows the honest notice.
 */
export default function EmployeesTab() {
  const { t } = useTranslation()
  const { restaurant, settings } = useAuth()
  const { isAdminLevel, ready } = usePermissions()
  const restaurantId = restaurant?.id
  const currency = settings?.currency ?? restaurant?.default_currency ?? 'BDT'

  const [employees, setEmployees] = useState<Employee[]>([])
  const [profiles, setProfiles] = useState<LinkableProfile[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!restaurantId) return
    const [employeeData, profileData] = await Promise.all([
      fetchEmployees(restaurantId),
      fetchLinkableProfiles(restaurantId).catch(() => [] as LinkableProfile[]),
    ])
    setEmployees(employeeData)
    setProfiles(profileData)
  }, [restaurantId])

  useEffect(() => {
    if (!isAdminLevel) return
    load()
      .then(() => setState('ready'))
      .catch((error: unknown) => {
        console.error('[HRM] employees load failed', error)
        setState('error')
      })
  }, [isAdminLevel, load])

  if (ready && !isAdminLevel) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('hrm.adminOnlyTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('hrm.adminOnlyBody')}</p>
        </CardContent>
      </Card>
    )
  }
  if (state === 'loading') {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  if (state === 'error') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('common.error')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('hrm.loadFailed')}</p>
        </CardContent>
      </Card>
    )
  }

  const startEdit = (employee: Employee) => {
    setEditingId(employee.id)
    setForm({
      fullName: employee.full_name,
      phone: employee.phone ?? '',
      designation: employee.designation ?? '',
      salary:
        employee.monthly_salary === null ? '' : String(employee.monthly_salary),
      joinDate: employee.join_date ?? '',
      profileId: employee.profile_id ?? '',
      notes: employee.notes ?? '',
    })
    setFormError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId || !form.fullName.trim()) {
      setFormError('hrm.nameRequired')
      return
    }
    setFormError(null)
    setSaving(true)
    const input = {
      profile_id: form.profileId || null,
      full_name: form.fullName.trim(),
      phone: form.phone.trim() || null,
      designation: form.designation.trim() || null,
      monthly_salary:
        form.salary.trim() === '' ? null : Math.max(0, Number(form.salary) || 0),
      join_date: form.joinDate || null,
      notes: form.notes.trim() || null,
    }
    try {
      if (editingId) {
        await updateEmployee(editingId, input)
      } else {
        await createEmployee(restaurantId, input)
      }
      cancelEdit()
      await load()
    } catch (error) {
      console.error('[HRM] employee save failed', error)
      setFormError('hrm.saveFailed')
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (employee: Employee) => {
    try {
      await updateEmployee(employee.id, {
        status: employee.status === 'active' ? 'inactive' : 'active',
      })
      await load()
    } catch (error) {
      console.error('[HRM] status toggle failed', error)
      setFormError('hrm.saveFailed')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {editingId ? t('hrm.editEmployee') : t('hrm.addEmployee')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="emp-name">{t('hrm.fullName')}</Label>
              <Input
                id="emp-name"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="emp-designation">{t('hrm.designation')}</Label>
              <Input
                id="emp-designation"
                value={form.designation}
                onChange={(e) => setForm({ ...form, designation: e.target.value })}
                placeholder={t('hrm.designationPlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="emp-phone">{t('hrm.phone')}</Label>
              <Input
                id="emp-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="emp-salary">{t('hrm.salary')}</Label>
              <Input
                id="emp-salary"
                type="number"
                min={0}
                step={0.01}
                value={form.salary}
                onChange={(e) => setForm({ ...form, salary: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="emp-join">{t('hrm.joinDate')}</Label>
              <Input
                id="emp-join"
                type="date"
                value={form.joinDate}
                onChange={(e) => setForm({ ...form, joinDate: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="emp-profile">{t('hrm.linkedLogin')}</Label>
              <select
                id="emp-profile"
                className={SELECT_CLASS}
                value={form.profileId}
                onChange={(e) => setForm({ ...form, profileId: e.target.value })}
              >
                <option value="">{t('hrm.noLogin')}</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <Label htmlFor="emp-notes">{t('hrm.notes')}</Label>
              <Input
                id="emp-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            {formError && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2"
              >
                {t(formError)}
              </p>
            )}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={saving}>
                {t('hrm.saveEmployee')}
              </Button>
              {editingId && (
                <Button type="button" variant="outline" onClick={cancelEdit}>
                  {t('common.cancel')}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('hrm.employeesTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {employees.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('hrm.noEmployees')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {employees.map((employee) => (
                <li
                  key={employee.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="font-medium">
                      {employee.full_name}
                      {employee.designation ? (
                        <span className="text-muted-foreground">
                          {' '}
                          · {employee.designation}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {[
                        employee.phone,
                        employee.monthly_salary !== null
                          ? formatMoney(Number(employee.monthly_salary), currency)
                          : null,
                        employee.join_date
                          ? `${t('hrm.joinDate')}: ${employee.join_date}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        employee.status === 'active'
                          ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900'
                          : 'rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'
                      }
                    >
                      {employee.status === 'active'
                        ? t('hrm.active')
                        : t('hrm.inactive')}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => startEdit(employee)}
                    >
                      {t('common.edit')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void toggleStatus(employee)}
                    >
                      {employee.status === 'active'
                        ? t('hrm.makeInactive')
                        : t('hrm.makeActive')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
