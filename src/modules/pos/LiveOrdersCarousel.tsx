// FoodX — POS live-order carousel (user feature, 2026-11-22).
// A single horizontal row of the restaurant's open orders directly
// under the POS header, so the cashier can run an order's whole
// life — send to kitchen, prepare, ready, served, payment,
// complete — without leaving the POS screen. Actions are icon
// buttons: on hover-capable pointers the label slides out beside
// the icon; on touch a single tap runs the action at once (no
// arm/confirm step) while a tooltip above the icon names it. All
// transitions go through the existing orders.ts machinery and all
// payments through pos.ts recordPayment — no new business logic.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import {
  Banknote,
  BellRing,
  CheckCheck,
  ChefHat,
  ChevronDown,
  Send,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { playPaymentBlip } from '@/lib/sound'
import { elapsedChipClass, elapsedMinutes, useNow } from '@/lib/time'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import {
  advanceOrderStatus,
  completeOrder,
  fetchOpenOrders,
  fetchPaymentsForOrders,
  markOrderServed,
  sendOrderToKitchen,
} from '@/services/orders'
import {
  recordPayment,
  summarizePayments,
  type PaymentSummary,
} from '@/services/pos'
import type {
  Order,
  OrderPayment,
  OrderStatus,
  OrderType,
  PaymentMethod,
} from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const POLL_MS = 30_000
const CAROUSEL_LIMIT = 20

const STATUS_KEYS: Record<OrderStatus, string> = {
  DRAFT: 'orders.statusDraft',
  CONFIRMED: 'orders.statusConfirmed',
  SENT_TO_KITCHEN: 'orders.statusSentToKitchen',
  PREPARING: 'orders.statusPreparing',
  READY: 'orders.statusReady',
  SERVED: 'orders.statusServed',
  COMPLETED: 'orders.statusCompleted',
  CANCELLED: 'orders.statusCancelled',
  REFUNDED: 'orders.statusRefunded',
}

const STATUS_TONES: Record<OrderStatus, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  CONFIRMED: 'bg-sky-100 text-sky-800',
  SENT_TO_KITCHEN: 'bg-amber-100 text-amber-800',
  PREPARING: 'bg-amber-100 text-amber-800',
  READY: 'bg-emerald-100 text-emerald-800',
  SERVED: 'bg-emerald-100 text-emerald-800',
  COMPLETED: 'bg-muted text-muted-foreground',
  CANCELLED: 'bg-red-100 text-red-800',
  REFUNDED: 'bg-red-100 text-red-800',
}

const TYPE_KEYS: Record<OrderType, string> = {
  dine_in: 'orders.dineIn',
  takeaway: 'orders.takeaway',
  delivery: 'orders.delivery',
  pickup: 'orders.pickup',
}

const PAYMENT_METHOD_KEYS: Record<PaymentMethod, string> = {
  cash: 'pos.methodCash',
  card: 'pos.methodCard',
  bkash: 'pos.methodBkash',
  nagad: 'pos.methodNagad',
  bank: 'pos.methodBank',
  due: 'pos.methodDue',
}

const PAYMENT_METHODS: PaymentMethod[] = [
  'cash',
  'card',
  'bkash',
  'nagad',
  'bank',
  'due',
]

/** The one lifecycle step an open order can take next, with the
 * label and icon its button carries. SERVED completes via
 * completeOrder (payment gate included); the rest are plain
 * transitions through the same helpers the KDS / To Serve /
 * Orders pages call. */
const NEXT_ACTION: Partial<
  Record<OrderStatus, { labelKey: string; icon: LucideIcon }>
> = {
  CONFIRMED: { labelKey: 'orders.sendToKitchen', icon: Send },
  SENT_TO_KITCHEN: { labelKey: 'kds.startPreparing', icon: ChefHat },
  PREPARING: { labelKey: 'kds.markReady', icon: BellRing },
  READY: { labelKey: 'orders.markServed', icon: UtensilsCrossed },
  SERVED: { labelKey: 'orders.completeOrder', icon: CheckCheck },
}

interface CardNotice {
  orderId: string
  text: string
  tone: 'ok' | 'warn' | 'error'
}

const NOTICE_CLASSES: Record<CardNotice['tone'], string> = {
  ok: 'bg-emerald-50 text-emerald-900',
  warn: 'bg-amber-50 text-amber-900',
  error: 'bg-destructive/10 text-destructive',
}

/**
 * One icon action button. The label is always in the DOM: it sits
 * collapsed (max-w-0) beside the icon and slides open on group
 * hover (the PC reveal); a tap/click also flashes it as a tooltip
 * above the button for ~1.6 s (the phone reveal) while the action
 * itself runs immediately — a single tap, never a confirm step.
 */
function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  highlight = false,
  tipAlign = 'center',
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  highlight?: boolean
  tipAlign?: 'center' | 'left'
}) {
  const [tip, setTip] = useState(false)
  const timerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
    },
    [],
  )
  const handleClick = () => {
    setTip(true)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setTip(false), 1600)
    onClick()
  }
  return (
    <span className="relative inline-flex">
      {tip && (
        <span
          className={`pointer-events-none absolute -top-8 z-20 rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background shadow-md ${
            tipAlign === 'left' ? 'left-0' : 'left-1/2 -translate-x-1/2'
          }`}
        >
          {label}
        </span>
      )}
      <button
        type="button"
        title={label}
        aria-label={label}
        disabled={disabled}
        onClick={handleClick}
        className={`group inline-flex h-9 items-center rounded-full border px-2.5 shadow-xs transition-all disabled:pointer-events-none disabled:opacity-50 ${
          highlight
            ? 'border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-400'
            : 'bg-background hover:bg-accent'
        }`}
      >
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span className="max-w-0 overflow-hidden text-xs font-medium whitespace-nowrap transition-all duration-200 group-hover:ml-1.5 group-hover:max-w-36">
          {label}
        </span>
      </button>
    </span>
  )
}

export default function LiveOrdersCarousel({
  restaurantId,
  userId,
  currency,
  tableNames,
  refreshSignal,
  onPrintReceipt,
}: {
  restaurantId: string
  userId: string
  currency: string
  tableNames: Record<string, string>
  refreshSignal: number
  onPrintReceipt: (order: Order) => Promise<void>
}) {
  const { t } = useTranslation()
  const online = useOnlineStatus()
  const now = useNow()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [extraCount, setExtraCount] = useState(0)
  const [summaries, setSummaries] = useState<Record<string, PaymentSummary>>(
    {},
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<CardNotice | null>(null)
  const [panelOrderId, setPanelOrderId] = useState<string | null>(null)
  const [panelMethod, setPanelMethod] = useState<PaymentMethod>('cash')
  const [panelAmount, setPanelAmount] = useState('')
  const [panelReference, setPanelReference] = useState('')
  const [panelError, setPanelError] = useState<string | null>(null)
  const [panelBusy, setPanelBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await fetchOpenOrders(restaurantId, CAROUSEL_LIMIT)
      const payments = await fetchPaymentsForOrders(
        result.orders.map((order) => order.id),
      )
      const grouped = new Map<string, OrderPayment[]>()
      for (const payment of payments) {
        const list = grouped.get(payment.order_id) ?? []
        list.push(payment)
        grouped.set(payment.order_id, list)
      }
      const next: Record<string, PaymentSummary> = {}
      for (const order of result.orders) {
        next[order.id] = summarizePayments(
          grouped.get(order.id) ?? [],
          Number(order.total_amount),
        )
      }
      setOrders(result.orders)
      setExtraCount(result.extraCount)
      setSummaries(next)
    } catch (error) {
      // A failed poll keeps the last good data (dashboard idiom).
      console.error('[POS] live orders load failed', error)
    }
  }, [restaurantId])

  // Mount + whenever the POS page itself places or pays an order.
  useEffect(() => {
    void load()
  }, [load, refreshSignal])

  useEffect(() => {
    const id = window.setInterval(() => {
      void load()
    }, POLL_MS)
    return () => window.clearInterval(id)
  }, [load])

  const runTransition = async (order: Order) => {
    if (busyId) return
    setBusyId(order.id)
    setNotice(null)
    try {
      if (order.status === 'CONFIRMED') {
        await sendOrderToKitchen(order, userId)
      } else if (order.status === 'SENT_TO_KITCHEN') {
        await advanceOrderStatus(order, 'PREPARING', userId)
      } else if (order.status === 'PREPARING') {
        await advanceOrderStatus(order, 'READY', userId)
      } else if (order.status === 'READY') {
        await markOrderServed(order, userId)
      } else if (order.status === 'SERVED') {
        await completeOrder(order, userId)
      }
      await load()
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message === 'payment_required') {
        // The unpaid-complete rule: say what is still due, in plain
        // language, and light up the Payment button instead of
        // completing.
        const balance =
          summaries[order.id]?.balance ?? Number(order.total_amount)
        setNotice({
          orderId: order.id,
          tone: 'warn',
          text: t('orders.paymentRequiredNote', {
            amount: formatMoney(balance, currency),
          }),
        })
      } else {
        console.error('[POS] live order action failed', error)
        setNotice({
          orderId: order.id,
          tone: 'error',
          text: t('orders.updateFailed'),
        })
      }
    } finally {
      setBusyId(null)
    }
  }

  /** The split button's main half: one click settles the whole
   * remaining balance in cash and prints the invoice. */
  const payInFullCash = async (order: Order) => {
    const summary = summaries[order.id]
    if (!summary || summary.balance <= 0 || busyId) return
    setBusyId(order.id)
    setNotice(null)
    try {
      await recordPayment(
        order,
        { method: 'cash', amount: summary.balance },
        userId,
      )
      playPaymentBlip()
      await onPrintReceipt(order)
      await load()
      setNotice({
        orderId: order.id,
        tone: 'ok',
        text: t('pos.paymentRecorded'),
      })
    } catch (error) {
      console.error('[POS] live order payment failed', error)
      setNotice({
        orderId: order.id,
        tone: 'error',
        text: t('pos.paymentFailed'),
      })
    } finally {
      setBusyId(null)
    }
  }

  const togglePanel = (order: Order) => {
    if (panelOrderId === order.id) {
      setPanelOrderId(null)
      return
    }
    setPanelOrderId(order.id)
    setPanelMethod('cash')
    setPanelAmount(String(summaries[order.id]?.balance ?? 0))
    setPanelReference('')
    setPanelError(null)
  }

  const submitPanelPayment = async (event: FormEvent, order: Order) => {
    event.preventDefault()
    if (panelBusy) return
    setPanelBusy(true)
    setPanelError(null)
    try {
      await recordPayment(
        order,
        {
          method: panelMethod,
          amount: Number(panelAmount),
          reference: panelReference,
        },
        userId,
      )
      playPaymentBlip()
      setPanelOrderId(null)
      await load()
      setNotice({
        orderId: order.id,
        tone: 'ok',
        text: t('pos.paymentRecorded'),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      setPanelError(
        message === 'payment_exceeds_balance'
          ? t('pos.paymentExceedsBalance')
          : message === 'invalid_payment_amount'
            ? t('pos.invalidPaymentAmount')
            : t('pos.paymentFailed'),
      )
    } finally {
      setPanelBusy(false)
    }
  }

  if (orders === null || orders.length === 0) return null

  const actionsDisabled = !online || busyId !== null

  return (
    <section aria-label={t('pos.liveOrders')} className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t('pos.liveOrders')}</h3>
      <div className="overflow-x-auto pb-1">
        <div className="flex snap-x items-start gap-3">
          {orders.map((order) => {
            const balance = summaries[order.id]?.balance ?? 0
            const next = NEXT_ACTION[order.status]
            const minutes = elapsedMinutes(order.created_at, now)
            const place = order.table_id
              ? `${t('orders.table')} ${tableNames[order.table_id] ?? '—'}`
              : order.customer_name
            const cardNotice = notice?.orderId === order.id ? notice : null
            const panelOpen = panelOrderId === order.id && balance > 0
            return (
              <div
                key={order.id}
                className="flex w-60 shrink-0 snap-start flex-col gap-1.5 rounded-lg border bg-card p-3 shadow-xs"
              >
                <Link
                  to={`/orders/${order.id}`}
                  className="flex flex-col gap-1 rounded-md outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      {t('orders.orderNumber', { number: order.order_number })}
                    </span>
                    {order.token_number !== null && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                        {t('orders.token', { number: order.token_number })}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {t(TYPE_KEYS[order.type])}
                    {place ? ` · ${place}` : ''}
                    {order.source === 'THIRD_PARTY' &&
                    order.third_party_company
                      ? ` · ${order.third_party_company}`
                      : ''}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONES[order.status]}`}
                      >
                        {t(STATUS_KEYS[order.status])}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${elapsedChipClass(minutes)}`}
                      >
                        {t('orders.elapsedMinutes', { minutes })}
                      </span>
                    </span>
                    <span className="text-sm font-semibold">
                      {formatMoney(order.total_amount, currency)}
                    </span>
                  </span>
                </Link>

                <div className="flex items-center gap-1.5 pt-0.5">
                  {next && (
                    <ActionButton
                      icon={next.icon}
                      label={t(next.labelKey)}
                      tipAlign="left"
                      disabled={actionsDisabled}
                      onClick={() => void runTransition(order)}
                    />
                  )}
                  {balance > 0 && (
                    <>
                      <ActionButton
                        icon={Banknote}
                        label={t('pos.payment')}
                        disabled={actionsDisabled}
                        highlight={cardNotice?.tone === 'warn'}
                        onClick={() => void payInFullCash(order)}
                      />
                      <button
                        type="button"
                        title={t('pos.payment')}
                        aria-label={t('pos.payment')}
                        aria-expanded={panelOpen}
                        disabled={!online}
                        onClick={() => togglePanel(order)}
                        className="inline-flex h-9 w-6 shrink-0 items-center justify-center rounded-full border bg-background shadow-xs hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                      >
                        <ChevronDown
                          className={`size-4 transition-transform ${panelOpen ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                      </button>
                    </>
                  )}
                </div>

                {cardNotice && (
                  <p
                    role={cardNotice.tone === 'ok' ? 'status' : 'alert'}
                    className={`rounded-md px-2 py-1.5 text-xs ${NOTICE_CLASSES[cardNotice.tone]}`}
                  >
                    {cardNotice.text}
                  </p>
                )}

                {panelOpen && (
                  <form
                    onSubmit={(event) => void submitPanelPayment(event, order)}
                    className="flex flex-col gap-2 border-t pt-2"
                  >
                    <div
                      className="flex flex-wrap gap-1.5"
                      role="group"
                      aria-label={t('pos.paymentMethod')}
                    >
                      {PAYMENT_METHODS.map((method) => (
                        <button
                          key={method}
                          type="button"
                          aria-pressed={panelMethod === method}
                          onClick={() => setPanelMethod(method)}
                          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                            panelMethod === method
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'bg-background hover:bg-accent'
                          }`}
                        >
                          {t(PAYMENT_METHOD_KEYS[method])}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`carousel-amount-${order.id}`}>
                        {t('pos.amount')}
                      </Label>
                      <Input
                        id={`carousel-amount-${order.id}`}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={panelAmount}
                        onChange={(event) => setPanelAmount(event.target.value)}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`carousel-reference-${order.id}`}>
                        {t('pos.reference')}
                      </Label>
                      <Input
                        id={`carousel-reference-${order.id}`}
                        value={panelReference}
                        onChange={(event) =>
                          setPanelReference(event.target.value)
                        }
                        placeholder={t('pos.referencePlaceholder')}
                      />
                    </div>
                    {panelError && (
                      <p
                        role="alert"
                        className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                      >
                        {panelError}
                      </p>
                    )}
                    <div>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={panelBusy || !online}
                      >
                        {t('pos.recordPayment')}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )
          })}
          {extraCount > 0 && (
            <Link
              to="/orders"
              className="flex w-32 shrink-0 snap-start items-center justify-center self-stretch rounded-lg border border-dashed p-3 text-center text-sm font-medium hover:bg-accent"
            >
              {t('pos.liveOrdersMore', { count: extraCount })}
            </Link>
          )}
        </div>
      </div>
    </section>
  )
}
