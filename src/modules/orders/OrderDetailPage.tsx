// FoodX — Order detail (protected).
// Items + modifiers, stored totals, payments, status history, and the
// actions the order state machine allows for the current status.
// After any successful action the detail is re-fetched.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { isMissingTableError } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { elapsedMinutes, useNow } from '@/lib/time'
import {
  cancelOrder,
  completeOrder,
  fetchOrderDetail,
  markOrderServed,
  refundOrder,
  sendOrderToKitchen,
} from '@/services/orders'
import { fetchTables } from '@/services/tables'
import { fetchBranches, type Branch } from '@/services/restaurant'
import { printHtml } from '@/lib/print'
import {
  buildKitchenTicketHtml,
  buildReceiptHtml,
  type ReceiptContext,
  type ReceiptLabels,
} from '@/lib/receipt'
import {
  ORDER_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
  type OrderDetail,
  type OrderSource,
  type OrderStatus,
  type OrderType,
  type PaymentMethod,
} from '@/types'
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

const PAYMENT_METHOD_KEYS: Record<PaymentMethod, string> = {
  cash: 'pos.methodCash',
  card: 'pos.methodCard',
  bkash: 'pos.methodBkash',
  nagad: 'pos.methodNagad',
  bank: 'pos.methodBank',
  due: 'pos.methodDue',
}

function actionErrorKey(error: unknown): string {
  return error instanceof Error && error.message === 'invalid_status_transition'
    ? 'orders.invalidTransition'
    : 'orders.updateFailed'
}

export default function OrderDetailPage() {
  const now = useNow()
  const { t } = useTranslation()
  const { id } = useParams()
  const {
    user,
    restaurant,
    settings,
    loading: authLoading,
    dbPending,
  } = useAuth()
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [tableNames, setTableNames] = useState<Record<string, string>>({})
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [missingTables, setMissingTables] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [acting, setActing] = useState(false)
  const [showCancelForm, setShowCancelForm] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelFormError, setCancelFormError] = useState<string | null>(null)
  const [showRefundForm, setShowRefundForm] = useState(false)
  const [refundReason, setRefundReason] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [refundFormError, setRefundFormError] = useState<string | null>(null)

  const currency =
    settings?.currency ?? restaurant?.default_currency ?? 'BDT'

  const statusLabel = (status: OrderStatus) => t(STATUS_KEYS[status])

  const typeLabel = (type: OrderType) =>
    type === 'dine_in'
      ? t('orders.dineIn')
      : type === 'takeaway'
        ? t('orders.takeaway')
        : type === 'pickup'
          ? t('orders.pickup')
          : t('orders.delivery')

  const sourceLabel = (source: OrderSource) => t(`orders.source${source}`)

  const receiptLabels: ReceiptLabels = {
    order: t('print.order'),
    table: t('print.table'),
    subtotal: t('print.subtotal'),
    discount: t('print.discount'),
    tax: t('print.tax'),
    serviceCharge: t('print.serviceCharge'),
    deliveryFee: t('print.deliveryFee'),
    total: t('print.total'),
    payment: t('print.payment'),
    kitchenTicket: t('print.kitchenTicket'),
    notes: t('print.notes'),
    poweredBy: t('print.poweredBy'),
  }

  const receiptContext = (target: OrderDetail): ReceiptContext => {
    const branch =
      branches.find((b) => b.id === target.branch_id) ??
      branches.find((b) => b.is_main) ??
      null
    return {
      restaurantName: settings?.branding_name || restaurant?.name || '',
      logoUrl: settings?.logo_url ?? null,
      branchName: branch?.name ?? null,
      branchAddress: branch?.address ?? null,
      branchPhone: branch?.phone ?? null,
      tableName: target.table_id
        ? (tableNames[target.table_id] ?? null)
        : null,
      footer: settings?.receipt_footer ?? null,
    }
  }

  const handlePrintReceipt = () => {
    if (!detail) return
    const { title, html, css } = buildReceiptHtml(
      detail,
      receiptContext(detail),
      receiptLabels,
      (n) => formatMoney(n, currency),
      (method) => t(PAYMENT_METHOD_KEYS[method as PaymentMethod]),
    )
    printHtml(title, html, css)
  }

  const handlePrintKitchen = () => {
    if (!detail) return
    const { title, html, css } = buildKitchenTicketHtml(
      detail,
      receiptContext(detail),
      receiptLabels,
    )
    printHtml(title, html, css)
  }

  const load = useCallback(async () => {
    if (!restaurant || !id) return
    setLoading(true)
    setLoadError(false)
    setMissingTables(false)
    try {
      const [fetchedDetail, tables, branchRows] = await Promise.all([
        fetchOrderDetail(id),
        fetchTables(restaurant.id),
        fetchBranches(restaurant.id),
      ])
      setDetail(fetchedDetail)
      setBranches(branchRows)
      const names: Record<string, string> = {}
      for (const table of tables) {
        names[table.id] = table.name
      }
      setTableNames(names)
    } catch (error) {
      console.error('[OrderDetail] load failed', error)
      if (isMissingTableError(error)) {
        setMissingTables(true)
      } else {
        setLoadError(true)
      }
    } finally {
      setLoading(false)
    }
  }, [restaurant, id])

  /** Re-fetch the detail after an action, without the loading flash. */
  const reload = useCallback(async () => {
    if (!id) return
    try {
      setDetail(await fetchOrderDetail(id))
    } catch (error) {
      console.error('[OrderDetail] reload failed', error)
      setLoadError(true)
    }
  }, [id])

  useEffect(() => {
    if (authLoading) return
    if (!restaurant || !id) {
      setLoading(false)
      return
    }
    void load()
  }, [authLoading, restaurant, id, load])

  const runAction = async (
    fn: (order: OrderDetail, userId: string) => Promise<unknown>,
  ) => {
    if (!detail || !user) return
    setActionError(null)
    setActing(true)
    try {
      await fn(detail, user.id)
      await reload()
    } catch (error) {
      console.error('[OrderDetail] action failed', error)
      setActionError(actionErrorKey(error))
    } finally {
      setActing(false)
    }
  }

  const handleCancel = async (event: FormEvent) => {
    event.preventDefault()
    if (!detail || !user) return
    if (!cancelReason.trim()) {
      setCancelFormError('orders.cancelReasonRequired')
      return
    }
    setCancelFormError(null)
    setActionError(null)
    setActing(true)
    try {
      await cancelOrder(detail, user.id, cancelReason.trim())
      setShowCancelForm(false)
      setCancelReason('')
      await reload()
    } catch (error) {
      console.error('[OrderDetail] cancel failed', error)
      if (
        error instanceof Error &&
        error.message === 'cancel_reason_required'
      ) {
        setCancelFormError('orders.cancelReasonRequired')
      } else {
        setActionError(actionErrorKey(error))
      }
    } finally {
      setActing(false)
    }
  }

  const handleRefund = async (event: FormEvent) => {
    event.preventDefault()
    if (!detail || !user) return
    if (!refundReason.trim()) {
      setRefundFormError('orders.refundReasonRequired')
      return
    }
    setRefundFormError(null)
    setActionError(null)
    setActing(true)
    try {
      const amount = Number(refundAmount)
      await refundOrder(
        detail,
        user.id,
        refundReason.trim(),
        Number.isFinite(amount) ? amount : undefined,
      )
      setShowRefundForm(false)
      setRefundReason('')
      setRefundAmount('')
      await reload()
    } catch (error) {
      console.error('[OrderDetail] refund failed', error)
      if (
        error instanceof Error &&
        error.message === 'refund_reason_required'
      ) {
        setRefundFormError('orders.refundReasonRequired')
      } else {
        setActionError(actionErrorKey(error))
      }
    } finally {
      setActing(false)
    }
  }

  if (authLoading || loading) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  if (dbPending || missingTables) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('layout.dbPendingTitle')}</CardTitle>
          <CardDescription>{t('layout.dbPendingBody')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!restaurant) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('layout.noProfileTitle')}</CardTitle>
          <CardDescription>{t('layout.noProfileBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/settings">{t('layout.goToSettings')}</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (loadError || !detail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('common.error')}</CardTitle>
          <CardDescription>{t('orders.loadDetailFailed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void load()}>{t('common.retry')}</Button>
        </CardContent>
      </Card>
    )
  }

  const allowed = ORDER_TRANSITIONS[detail.status] ?? []
  const isTerminal = TERMINAL_ORDER_STATUSES.includes(detail.status)
  const tableName = detail.table_id
    ? (tableNames[detail.table_id] ?? detail.table_id.slice(0, 8))
    : null

  return (
    <div className="flex flex-col gap-6">
      <Link to="/orders" className="font-medium text-primary hover:underline">
        {t('orders.backToOrders')}
      </Link>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>
            {t('orders.orderNumber', { number: detail.order_number })}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrintReceipt}
            >
              {t('print.receiptButton')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrintKitchen}
            >
              {t('print.kitchenButton')}
            </Button>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {statusLabel(detail.status)}
            </span>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p>{typeLabel(detail.type)}</p>
          {!TERMINAL_ORDER_STATUSES.includes(detail.status) && (
            <p className="text-muted-foreground">
              {t('orders.openFor', {
                minutes: elapsedMinutes(detail.created_at, now),
              })}
            </p>
          )}
          <p className="text-muted-foreground">
            {t('orders.source')}: {sourceLabel(detail.source)}
          </p>
          {detail.customer_name && (
            <p>
              <span className="font-medium">{t('orders.customerName')}: </span>
              {detail.customer_name}
            </p>
          )}
          {detail.customer_phone && (
            <p>
              <span className="font-medium">
                {t('orders.customerPhone')}:{' '}
              </span>
              {detail.customer_phone}
            </p>
          )}
          {detail.delivery_address && (
            <p>
              <span className="font-medium">
                {t('orders.customerAddress')}:{' '}
              </span>
              {detail.delivery_address}
            </p>
          )}
          {tableName && (
            <p>
              {t('orders.table')} {tableName}
            </p>
          )}
          <p className="text-muted-foreground">
            {t('orders.createdAt')}{' '}
            {new Date(detail.created_at).toLocaleString()}
          </p>
          {detail.notes && (
            <p>
              <span className="font-medium">{t('orders.notes')}: </span>
              {detail.notes}
            </p>
          )}
        </CardContent>
      </Card>

      {actionError && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t(actionError)}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {detail.status === 'CONFIRMED' &&
          allowed.includes('SENT_TO_KITCHEN') && (
            <Button
              onClick={() => void runAction(sendOrderToKitchen)}
              disabled={acting}
            >
              {t('orders.sendToKitchen')}
            </Button>
          )}
        {detail.status === 'READY' && allowed.includes('SERVED') && (
          <Button
            onClick={() => void runAction(markOrderServed)}
            disabled={acting}
          >
            {t('orders.markServed')}
          </Button>
        )}
        {detail.status === 'SERVED' && allowed.includes('COMPLETED') && (
          <Button
            onClick={() => void runAction(completeOrder)}
            disabled={acting}
          >
            {t('orders.completeOrder')}
          </Button>
        )}
        {!isTerminal && (
          <Button
            variant="outline"
            onClick={() => {
              setShowCancelForm(true)
              setShowRefundForm(false)
              setActionError(null)
            }}
            disabled={acting}
          >
            {t('orders.cancelOrder')}
          </Button>
        )}
        {detail.status === 'COMPLETED' && (
          <Button
            variant="outline"
            onClick={() => {
              setShowRefundForm(true)
              setShowCancelForm(false)
              setRefundAmount(String(detail.total_amount))
              setActionError(null)
            }}
            disabled={acting}
          >
            {t('orders.refundOrder')}
          </Button>
        )}
      </div>

      {showCancelForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t('orders.confirmCancel')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCancel} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="cancelReason">
                  {t('orders.cancelReason')}
                </Label>
                <Input
                  id="cancelReason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder={t('orders.cancelReasonPlaceholder')}
                />
                {cancelFormError && (
                  <p role="alert" className="text-sm text-destructive">
                    {t(cancelFormError)}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="destructive" disabled={acting}>
                  {t('orders.cancelOrder')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowCancelForm(false)
                    setCancelReason('')
                    setCancelFormError(null)
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {showRefundForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t('orders.confirmRefund')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRefund} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="refundReason">
                  {t('orders.refundReason')}
                </Label>
                <Input
                  id="refundReason"
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder={t('orders.refundReasonPlaceholder')}
                />
                {refundFormError && (
                  <p role="alert" className="text-sm text-destructive">
                    {t(refundFormError)}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="refundAmount">
                  {t('orders.refundAmount')}
                </Label>
                <Input
                  id="refundAmount"
                  type="number"
                  min={0}
                  step={0.01}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="destructive" disabled={acting}>
                  {t('orders.refundOrder')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowRefundForm(false)
                    setRefundReason('')
                    setRefundAmount('')
                    setRefundFormError(null)
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('orders.items')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {detail.items.map((item) => (
            <div key={item.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">
                  {item.product_name}
                  {item.variant_name ? ` (${item.variant_name})` : ''}
                </span>
                <span className="font-semibold">
                  {formatMoney(item.total_price, currency)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {item.quantity} × {formatMoney(item.unit_price, currency)}
              </p>
              {item.note && (
                <p className="pl-4 text-sm font-medium text-amber-700">
                  {item.note}
                </p>
              )}
              {item.modifiers.map((modifier) => (
                <p
                  key={modifier.id}
                  className="flex items-center justify-between gap-2 pl-4 text-sm text-muted-foreground"
                >
                  <span>+ {modifier.modifier_name}</span>
                  <span>{formatMoney(modifier.price, currency)}</span>
                </p>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('orders.total')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p className="flex items-center justify-between gap-2">
            <span>{t('orders.subtotal')}</span>
            <span>{formatMoney(detail.subtotal, currency)}</span>
          </p>
          <p className="flex items-center justify-between gap-2">
            <span>{t('orders.discount')}</span>
            <span>{formatMoney(detail.discount_amount, currency)}</span>
          </p>
          <p className="flex items-center justify-between gap-2">
            <span>{t('orders.tax')}</span>
            <span>{formatMoney(detail.tax_amount, currency)}</span>
          </p>
          <p className="flex items-center justify-between gap-2">
            <span>{t('orders.serviceCharge')}</span>
            <span>{formatMoney(detail.service_charge_amount, currency)}</span>
          </p>
          <p className="flex items-center justify-between gap-2 border-t pt-2 font-semibold">
            <span>{t('orders.total')}</span>
            <span>{formatMoney(detail.total_amount, currency)}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('orders.payments')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {detail.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('orders.noPayments')}
            </p>
          ) : (
            detail.payments.map((payment) => (
              <p
                key={payment.id}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span>
                  {t(PAYMENT_METHOD_KEYS[payment.method])}
                  {payment.reference ? ` (${payment.reference})` : ''}
                </span>
                <span className="font-medium">
                  {formatMoney(payment.amount, currency)}
                </span>
              </p>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('orders.history')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {detail.history.map((row) => (
            <div key={row.id} className="flex flex-col gap-0.5 text-sm">
              <p>
                {row.from_status ? statusLabel(row.from_status) : '—'}
                {' → '}
                {statusLabel(row.to_status)}
              </p>
              {row.note && (
                <p className="text-muted-foreground">{row.note}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {new Date(row.created_at).toLocaleString()}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
