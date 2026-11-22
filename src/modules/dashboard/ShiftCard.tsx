// FoodX — আজকের পালা (today's shift) card (Dashboard modernisation
// W1, design §5). Primary subject: the signed-in user's own open
// shift — who, since when (ticking elapsed), and expected cash from
// fetchShiftSummary, the Phase 7 formula reused exactly, never
// re-derived. The দিন শেষের হিসাব button links to Business → Shifts
// & Closing (the Business page has no tab deep-link, so the button
// lands on the page and the tab is one click — no routing invented;
// the dashboard itself never closes anything). Below mine: other
// staff's open shifts (name + since, max 3 + "+N more"); their
// expected cash shows only when the viewer holds reports.view
// (showOthersCash). My own expected cash always shows — it is my
// own drawer. Source failure on first load hides the card entirely
// (the alerts honesty pattern): nothing fake is ever shown.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { formatMoney } from '@/lib/money'
import { elapsedMinutes, useNow } from '@/lib/time'
import {
  fetchDailyClosings,
  fetchMyOpenShift,
  fetchShiftSummary,
  fetchShifts,
  toDateString,
  type ShiftSummary,
} from '@/services/business'
import { fetchStaff } from '@/services/staff'
import type { CashierShift } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const POLL_MS = 30_000

export default function ShiftCard({
  restaurantId,
  userId,
  myName,
  currency,
  showOthersCash,
  navTo,
}: {
  restaurantId: string
  userId: string | null
  myName: string
  currency: string
  showOthersCash: boolean
  navTo: (to: string) => string
}) {
  const { t } = useTranslation()
  const now = useNow()

  const formatElapsed = (openedAt: string): string => {
    const minutes = elapsedMinutes(openedAt, now)
    if (minutes < 60) return t('orders.elapsedMinutes', { minutes })
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest > 0
      ? t('dashboard.shiftElapsedHoursMinutes', { hours, minutes: rest })
      : t('dashboard.shiftElapsedHours', { hours })
  }

  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [myShift, setMyShift] = useState<CashierShift | null>(null)
  const [mySummary, setMySummary] = useState<ShiftSummary | null>(null)
  const [others, setOthers] = useState<CashierShift[]>([])
  const [otherSummaries, setOtherSummaries] = useState<
    Map<string, ShiftSummary>
  >(new Map())
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [dayClosed, setDayClosed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let everLoaded = false

    const load = async () => {
      try {
        const [mine, shifts, closings] = await Promise.all([
          userId
            ? fetchMyOpenShift(restaurantId, userId)
            : Promise.resolve(null),
          fetchShifts(restaurantId, 30),
          fetchDailyClosings(restaurantId, 7),
        ])
        if (cancelled) return
        everLoaded = true
        setFailed(false)
        setMyShift(mine)
        const openOthers = shifts.filter(
          (shift) =>
            shift.status === 'OPEN' &&
            shift.id !== mine?.id &&
            shift.opened_by !== userId,
        )
        setOthers(openOthers)
        setDayClosed(
          closings.some(
            (closing) => closing.closing_date === toDateString(new Date()),
          ),
        )
        setLoaded(true)

        // Expected cash: mine always; others only for reports.view
        // holders, and only for the rows actually displayed.
        if (mine) {
          const summary = await fetchShiftSummary(mine).catch(() => null)
          if (!cancelled) setMySummary(summary)
        } else {
          setMySummary(null)
        }
        if (showOthersCash) {
          const visible = openOthers.slice(0, 3)
          const summaries = new Map<string, ShiftSummary>()
          await Promise.all(
            visible.map(async (shift) => {
              const summary = await fetchShiftSummary(shift).catch(
                () => null,
              )
              if (summary) summaries.set(shift.id, summary)
            }),
          )
          if (!cancelled) setOtherSummaries(summaries)
        }
      } catch (error: unknown) {
        console.error('[Dashboard] could not load shift card', error)
        // Phase 7 tables not applied (or a network error): hide the
        // card if it never loaded; keep the last good data otherwise.
        if (!everLoaded && !cancelled) setFailed(true)
      }
    }

    void load()
    const timer = window.setInterval(() => {
      void load()
    }, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [restaurantId, userId, showOthersCash])

  // Names for the other-shift rows: the same staff list the Staff
  // page reads. That call is admin-scoped; when it is not available
  // to this viewer the rows fall back to a plain "team member"
  // label rather than hiding the shifts themselves.
  useEffect(() => {
    let cancelled = false
    void fetchStaff()
      .then((staff) => {
        if (cancelled) return
        setNames(
          new Map(
            staff.map((member) => [
              member.id,
              member.full_name ?? member.email ?? member.id.slice(0, 8),
            ]),
          ),
        )
      })
      .catch(() => {
        // Not available to this viewer — fallback labels apply.
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) return null

  if (!loaded) {
    return (
      <Card aria-hidden="true">
        <CardHeader className="pb-2">
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        </CardHeader>
        <CardContent>
          <div className="h-9 w-32 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-4 w-40 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    )
  }

  const visibleOthers = others.slice(0, 3)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('dashboard.shiftTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {myShift ? (
          <div>
            <p className="font-medium">
              {myName}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {t('shifts.currentShift')}
              </span>
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t('shifts.openedAt')}{' '}
              {new Date(myShift.opened_at).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
              {' · '}
              {formatElapsed(myShift.opened_at)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('shifts.expectedCash')}
            </p>
            <p className="text-2xl font-bold">
              {mySummary
                ? formatMoney(mySummary.expectedCash, currency)
                : '—'}
            </p>
            {mySummary && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('shifts.cashSales')}{' '}
                {formatMoney(mySummary.cashSales, currency)}
                {' · '}
                {t('shifts.cashExpenses')}{' '}
                {formatMoney(mySummary.cashExpenses, currency)}
                {' · '}
                {t('shifts.movementsNet')}{' '}
                {formatMoney(mySummary.movementsNet, currency)}
              </p>
            )}
          </div>
        ) : others.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('dashboard.shiftNoneOpen')}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('shifts.noOpenShift')}
          </p>
        )}

        {dayClosed && (
          <p className="text-sm text-muted-foreground">
            {t('dashboard.shiftDayClosed')}
          </p>
        )}

        {visibleOthers.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-sm font-medium">
              {t('dashboard.shiftOthersTitle')}
            </p>
            <div className="mt-1 divide-y">
              {visibleOthers.map((shift) => {
                const summary = otherSummaries.get(shift.id)
                return (
                  <div
                    key={shift.id}
                    className="flex items-center justify-between gap-2 py-1.5 text-sm"
                  >
                    <span>
                      {shift.opened_by
                        ? (names.get(shift.opened_by) ??
                          t('dashboard.shiftTeamMember'))
                        : t('dashboard.shiftTeamMember')}
                      <span className="text-muted-foreground">
                        {' · '}
                        {formatElapsed(shift.opened_at)}
                      </span>
                    </span>
                    {showOthersCash && (
                      <span className="font-medium">
                        {summary
                          ? formatMoney(summary.expectedCash, currency)
                          : '—'}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            {others.length > 3 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {t('dashboard.shiftMoreOnShift', {
                  count: others.length - 3,
                })}
              </p>
            )}
          </div>
        )}

        <div>
          <Button asChild variant="outline">
            <Link to={navTo('/business')}>
              {t('dashboard.shiftDayEnd')}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
