// FoodX — Easy Mode v2 (wave E3; design §8, wizard 4): the
// end-of-day accounts the guided way. One screen first — today's
// sales, cash received, today's expenses, dues still to collect —
// composed from the same services Easy Home and the Business
// page use (fetchDayTotals, fetchTodayOrders +
// fetchPaymentsForOrders + summarizePayments). The big button
// then performs the closing exactly as the Business page's
// Shifts & Closing tab configures it today: if the signed-in
// user still has an OPEN shift, its counted-cash step comes
// first (closeShift needs the counted amount), then closeDay
// snapshots the day. With no open shift the button calls
// closeDay directly. Nothing new is computed or stored beyond
// what those two services already do.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  EasyOnlyNote,
  EasyWizardQuestion,
  EasyWizardShell,
  EasyWizardSuccess,
} from '@/components/EasyWizard'
import { useAuth } from '@/hooks/useAuth'
import { useEasyMode } from '@/hooks/useEasyMode'
import { formatMoney, roundMoney } from '@/lib/money'
import { escapeHtml, printHtml } from '@/lib/print'
import {
  closeDay,
  closeShift,
  fetchDailyClosings,
  fetchDayTotals,
  fetchMyOpenShift,
  fetchShiftSummary,
  toDateString,
} from '@/services/business'
import {
  fetchPaymentsForOrders,
  fetchTodayOrders,
} from '@/services/orders'
import { summarizePayments } from '@/services/pos'
import type { CashierShift, OrderPayment } from '@/types'

interface DayFigures {
  sales: number
  expenses: number
  cashReceived: number
  dues: number
}

export default function DayEndWizardPage() {
  const { t } = useTranslation()
  const { easy } = useEasyMode()
  if (!easy) {
    return (
      <EasyOnlyNote normalTo="/business" normalLabel={t('easy.nav.money')} />
    )
  }
  return <DayEndWizard />
}

function DayEndWizard() {
  const { t } = useTranslation()
  const { user, restaurant, settings } = useAuth()
  const restaurantId = restaurant?.id
  const userId = user?.id ?? null
  const currency = settings?.currency ?? 'BDT'
  const [today] = useState(() => toDateString(new Date()))

  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [figures, setFigures] = useState<DayFigures>({
    sales: 0,
    expenses: 0,
    cashReceived: 0,
    dues: 0,
  })
  const [shift, setShift] = useState<CashierShift | null>(null)
  const [expectedCash, setExpectedCash] = useState<number | null>(null)
  const [alreadyClosed, setAlreadyClosed] = useState(false)
  const [step, setStep] = useState(0)
  const [countedCash, setCountedCash] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{
    sales: string
    difference: number | null
  } | null>(null)

  useEffect(() => {
    if (!restaurantId) return
    let cancelled = false
    void (async () => {
      try {
        const [totals, todayOrders] = await Promise.all([
          fetchDayTotals(restaurantId, today),
          fetchTodayOrders(restaurantId),
        ])
        const payments = await fetchPaymentsForOrders(
          todayOrders.map((order) => order.id),
        )
        if (cancelled) return
        const cashReceived = roundMoney(
          payments
            .filter((payment) => payment.method === 'cash')
            .reduce((sum, payment) => sum + Number(payment.amount), 0),
        )
        const paymentsByOrder = new Map<string, OrderPayment[]>()
        for (const payment of payments) {
          const list = paymentsByOrder.get(payment.order_id) ?? []
          list.push(payment)
          paymentsByOrder.set(payment.order_id, list)
        }
        let dues = 0
        for (const order of todayOrders) {
          const summary = summarizePayments(
            paymentsByOrder.get(order.id) ?? [],
            Number(order.total_amount),
          )
          dues += Math.max(0, summary.due + summary.balance)
        }
        setFigures({
          sales: totals.sales,
          expenses: totals.expenses,
          cashReceived,
          dues: roundMoney(dues),
        })
        // The shift pieces degrade gracefully: no open shift (or
        // an unreadable one) simply means the button closes the
        // day directly, like the Business page allows.
        const openShift = userId
          ? await fetchMyOpenShift(restaurantId, userId).catch(() => null)
          : null
        if (cancelled) return
        if (openShift) {
          setShift(openShift)
          const summary = await fetchShiftSummary(openShift).catch(
            () => null,
          )
          if (!cancelled && summary) setExpectedCash(summary.expectedCash)
        }
        const closings = await fetchDailyClosings(restaurantId, 5).catch(
          () => [],
        )
        if (!cancelled) {
          setAlreadyClosed(
            closings.some((closing) => closing.closing_date === today),
          )
        }
      } catch {
        if (!cancelled) setLoadFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [restaurantId, userId, today])

  const rows = [
    {
      label: t('easy.home.todaySales'),
      value: formatMoney(figures.sales, currency),
    },
    {
      label: t('easy.wizard.cashReceived'),
      value: formatMoney(figures.cashReceived, currency),
    },
    {
      label: t('easy.home.todayExpenses'),
      value: formatMoney(figures.expenses, currency),
    },
    {
      label: t('easy.home.dueLeft'),
      value: formatMoney(figures.dues, currency),
    },
  ]

  const handlePrint = () => {
    const rowsHtml = rows
      .map(
        (row) =>
          `<div class="row"><span>${escapeHtml(row.label)}</span><span>${escapeHtml(row.value)}</span></div>`,
      )
      .join('')
    const body = `<h1>${escapeHtml(restaurant?.name ?? '')}</h1><p class="muted">${escapeHtml(t('easy.wizard.printTitle'))} — ${escapeHtml(today)}</p>${rowsHtml}`
    printHtml(t('easy.wizard.printTitle'), body)
  }

  const finishDay = async (difference: number | null) => {
    if (!restaurantId) return
    await closeDay(restaurantId, today, userId)
    setDone({
      sales: formatMoney(figures.sales, currency),
      difference,
    })
  }

  const handleClose = async () => {
    if (!restaurantId || busy) return
    setError(null)
    if (shift && step === 0) {
      setStep(1)
      return
    }
    if (shift) {
      const actual = roundMoney(Number.parseFloat(countedCash))
      if (!Number.isFinite(actual) || actual < 0) {
        setError(t('easy.wizard.countedCashRequired'))
        return
      }
      setBusy(true)
      try {
        await closeShift(shift, actual, userId)
        await finishDay(
          expectedCash !== null ? roundMoney(actual - expectedCash) : null,
        )
      } catch {
        setError(t('easy.wizard.saveFailed'))
      } finally {
        setBusy(false)
      }
      return
    }
    setBusy(true)
    try {
      await finishDay(null)
    } catch {
      setError(t('easy.wizard.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  if (!restaurantId || loading) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  if (loadFailed) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <p className="text-lg font-medium text-destructive">
          {t('easy.wizard.loadFailed')}
        </p>
      </div>
    )
  }

  if (done !== null) {
    return (
      <EasyWizardSuccess
        message={t('easy.wizard.dayClosed', { amount: done.sales })}
        doneTo="/"
      >
        {done.difference !== null && done.difference !== 0 && (
          <p className="text-lg font-medium text-amber-600 dark:text-amber-400">
            {t('easy.wizard.cashDifference', {
              amount: formatMoney(done.difference, currency),
            })}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={handlePrint}
        >
          <Printer className="size-5" />
          {t('easy.wizard.printSummary')}
        </Button>
      </EasyWizardSuccess>
    )
  }

  return (
    <EasyWizardShell
      title={t('easy.tile.dayEnd')}
      step={step}
      stepCount={shift ? 2 : 1}
      error={error}
      busy={busy}
      onBack={step > 0 ? () => setStep(0) : undefined}
      onNext={() => void handleClose()}
      nextLabel={
        shift && step === 0
          ? t('common.next')
          : t('easy.wizard.closeDay')
      }
    >
      {step === 0 && (
        <>
          <p className="text-base text-muted-foreground">
            {t('easy.wizard.dayEndIntro')}
          </p>
          <div className="flex flex-col gap-3">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-xl border bg-card p-5 shadow-sm"
              >
                <span className="text-lg font-medium">{row.label}</span>
                <span className="text-xl font-bold">{row.value}</span>
              </div>
            ))}
          </div>
          {alreadyClosed && (
            <p className="rounded-md bg-amber-500/10 px-4 py-3 text-base font-medium text-amber-700 dark:text-amber-300">
              {t('easy.wizard.alreadyClosed')}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full"
            onClick={handlePrint}
          >
            <Printer className="size-5" />
            {t('easy.wizard.printSummary')}
          </Button>
        </>
      )}

      {step === 1 && shift && (
        <>
          <EasyWizardQuestion>
            {t('easy.wizard.countedCashQ')}
          </EasyWizardQuestion>
          {expectedCash !== null && (
            <p className="text-base text-muted-foreground">
              {t('easy.wizard.expectedCash', {
                amount: formatMoney(expectedCash, currency),
              })}
            </p>
          )}
          <Input
            value={countedCash}
            onChange={(event) => setCountedCash(event.target.value)}
            inputMode="decimal"
            className="h-12 text-lg"
            autoFocus
          />
        </>
      )}
    </EasyWizardShell>
  )
}
