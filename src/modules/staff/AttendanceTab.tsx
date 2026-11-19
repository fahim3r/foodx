import { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  fetchAttendance,
  fetchEmployees,
  markAttendance,
} from '@/services/hrm'
import type { AttendanceRecord, AttendanceStatus, Employee } from '@/types'

const STATUSES: AttendanceStatus[] = ['present', 'absent', 'leave', 'half_day']

function todayString(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function monthRange(month: string): { from: string; to: string } {
  const [year, mon] = month.split('-').map(Number)
  const last = new Date(year, mon, 0).getDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

/**
 * HRM — Attendance tab (modifications v2, item 10). One row per
 * active employee for the chosen day; tapping a status marks it
 * (upsert — a day can be corrected). The month summary shows
 * counts only; payroll math is deliberately not in v1.
 */
export default function AttendanceTab() {
  const { t } = useTranslation()
  const { user, restaurant } = useAuth()
  const { isAdminLevel, ready } = usePermissions()
  const restaurantId = restaurant?.id

  const [employees, setEmployees] = useState<Employee[]>([])
  const [day, setDay] = useState(todayString())
  const [dayRecords, setDayRecords] = useState<AttendanceRecord[]>([])
  const [month, setMonth] = useState(todayString().slice(0, 7))
  const [monthRecords, setMonthRecords] = useState<AttendanceRecord[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [actionError, setActionError] = useState<string | null>(null)

  const loadDay = useCallback(async () => {
    if (!restaurantId) return
    const [employeeData, records] = await Promise.all([
      fetchEmployees(restaurantId),
      fetchAttendance(restaurantId, day, day),
    ])
    setEmployees(employeeData)
    setDayRecords(records)
  }, [restaurantId, day])

  const loadMonth = useCallback(async () => {
    if (!restaurantId) return
    const { from, to } = monthRange(month)
    setMonthRecords(await fetchAttendance(restaurantId, from, to))
  }, [restaurantId, month])

  useEffect(() => {
    if (!isAdminLevel) return
    loadDay()
      .then(() => setState('ready'))
      .catch((error: unknown) => {
        console.error('[HRM] attendance load failed', error)
        setState('error')
      })
  }, [isAdminLevel, loadDay])

  useEffect(() => {
    if (!isAdminLevel) return
    loadMonth().catch((error: unknown) => {
      console.error('[HRM] month load failed', error)
    })
  }, [isAdminLevel, loadMonth])

  const statusByEmployee = useMemo(() => {
    const map = new Map<string, AttendanceStatus>()
    for (const record of dayRecords) map.set(record.employee_id, record.status)
    return map
  }, [dayRecords])

  const monthCounts = useMemo(() => {
    const map = new Map<string, Record<AttendanceStatus, number>>()
    for (const record of monthRecords) {
      const counts = map.get(record.employee_id) ?? {
        present: 0,
        absent: 0,
        leave: 0,
        half_day: 0,
      }
      counts[record.status] += 1
      map.set(record.employee_id, counts)
    }
    return map
  }, [monthRecords])

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

  const activeEmployees = employees.filter((e) => e.status === 'active')

  const handleMark = async (employee: Employee, status: AttendanceStatus) => {
    if (!restaurantId || !user) return
    setActionError(null)
    try {
      await markAttendance(restaurantId, employee.id, day, status, user.id)
      await Promise.all([loadDay(), loadMonth()])
    } catch (error) {
      console.error('[HRM] mark failed', error)
      setActionError('hrm.saveFailed')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('hrm.attendanceTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="att-day">{t('hrm.dayLabel')}</Label>
              <Input
                id="att-day"
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="w-44"
              />
            </div>
          </div>
          {actionError && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {t(actionError)}
            </p>
          )}
          {activeEmployees.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('hrm.noEmployees')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {activeEmployees.map((employee) => {
                const current = statusByEmployee.get(employee.id)
                return (
                  <li
                    key={employee.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium">{employee.full_name}</p>
                      {employee.designation && (
                        <p className="text-sm text-muted-foreground">
                          {employee.designation}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {STATUSES.map((status) => (
                        <Button
                          key={status}
                          type="button"
                          size="sm"
                          variant={current === status ? 'default' : 'outline'}
                          onClick={() => void handleMark(employee, status)}
                        >
                          {t(`hrm.status_${status}`)}
                        </Button>
                      ))}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('hrm.monthSummaryTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="att-month">{t('hrm.monthLabel')}</Label>
            <Input
              id="att-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-44"
            />
          </div>
          {employees.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('hrm.noEmployees')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {employees.map((employee) => {
                const counts = monthCounts.get(employee.id) ?? {
                  present: 0,
                  absent: 0,
                  leave: 0,
                  half_day: 0,
                }
                return (
                  <li
                    key={employee.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <p className="font-medium">{employee.full_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('hrm.countsLine', {
                        present: counts.present,
                        absent: counts.absent,
                        leave: counts.leave,
                        half: counts.half_day,
                      })}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
