// FoodX — POS page (order-taking screen).
// The client never decides prices: the cart preview is priced from the
// loaded catalog with the same computeOrderTotals() the server-side
// createOrder() uses, and placement sends only ids + quantities —
// services/pos.ts re-reads prices from the database before storing.
// Printing is not implemented; the summary says so honestly.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { isMissingTableError } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { useAuth } from '@/hooks/useAuth'
import { fetchCategories, fetchProductsWithDetails } from '@/services/menu'
import {
  computeOrderTotals,
  createOrder,
  fetchOrderPayments,
  recordPayment,
  roundMoney,
  summarizePayments,
  type PricedLine,
} from '@/services/pos'
import { fetchBranches, type Branch } from '@/services/restaurant'
import { fetchTables } from '@/services/tables'
import type {
  Category,
  DiningTable,
  Order,
  OrderPayment,
  OrderType,
  PaymentMethod,
  PosOrderLineInput,
  ProductWithDetails,
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

/** One cart line: ids + quantity only — prices are never stored here. */
interface CartLine {
  productId: string
  variantId: string | null
  modifierIds: string[]
  quantity: number
}

const ORDER_TYPE_KEYS: Record<OrderType, string> = {
  dine_in: 'pos.dineIn',
  takeaway: 'pos.takeaway',
  delivery: 'pos.delivery',
}

const PAYMENT_METHOD_KEYS: Record<PaymentMethod, string> = {
  cash: 'pos.methodCash',
  card: 'pos.methodCard',
  bkash: 'pos.methodBkash',
  nagad: 'pos.methodNagad',
  bank: 'pos.methodBank',
  due: 'pos.methodDue',
}

const ORDER_TYPES: OrderType[] = ['dine_in', 'takeaway', 'delivery']
const PAYMENT_METHODS: PaymentMethod[] = [
  'cash',
  'card',
  'bkash',
  'nagad',
  'bank',
  'due',
]

const SELECT_CLASSNAME =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

function cartKey(line: CartLine): string {
  return `${line.productId}|${line.variantId ?? ''}|${[...line.modifierIds].sort().join(',')}`
}

export default function PosPage() {
  const { t, i18n } = useTranslation()
  const { user, restaurant, settings, loading, dbPending } = useAuth()

  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<ProductWithDetails[]>([])
  const [tables, setTables] = useState<DiningTable[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadState, setLoadState] = useState<'ok' | 'missing' | 'failed'>('ok')

  const [orderType, setOrderType] = useState<OrderType>('dine_in')
  const [selectedTableId, setSelectedTableId] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [discount, setDiscount] = useState(0)
  const [notes, setNotes] = useState('')

  const [chooserProduct, setChooserProduct] =
    useState<ProductWithDetails | null>(null)
  const [chooserVariantId, setChooserVariantId] = useState<string | null>(null)
  const [chooserModifierIds, setChooserModifierIds] = useState<string[]>([])
  const [chooserQty, setChooserQty] = useState(1)

  const [placing, setPlacing] = useState(false)
  const [placeErrorKey, setPlaceErrorKey] = useState<string | null>(null)

  const [placedOrder, setPlacedOrder] = useState<Order | null>(null)
  const [placedLines, setPlacedLines] = useState<PricedLine[]>([])
  const [payments, setPayments] = useState<OrderPayment[]>([])
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  // Idempotency key for the payment being recorded: stays the same across
  // retries of the same attempt, regenerated after a successful payment.
  const [paymentAttemptId, setPaymentAttemptId] = useState(
    () => crypto.randomUUID(),
  )
  const [recordingPayment, setRecordingPayment] = useState(false)
  const [paymentErrorKey, setPaymentErrorKey] = useState<string | null>(null)
  const [paymentRecorded, setPaymentRecorded] = useState(false)

  const isBn = i18n.language === 'bn'
  const taxRate = Number(settings?.tax_rate ?? 0)
  const serviceChargeRate = Number(settings?.service_charge_rate ?? 0)
  const currency = settings?.currency ?? restaurant?.default_currency ?? 'BDT'

  const defaultBranch = useMemo<Branch | null>(
    () =>
      branches.find((branch) => branch.is_main) ?? branches[0] ?? null,
    [branches],
  )

  // Load the catalog, tables and branches for this restaurant.
  useEffect(() => {
    if (!restaurant) {
      setLoaded(true)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const [loadedCategories, loadedProducts, loadedTables, loadedBranches] =
          await Promise.all([
            fetchCategories(restaurant.id),
            fetchProductsWithDetails(restaurant.id),
            fetchTables(restaurant.id),
            fetchBranches(restaurant.id),
          ])
        if (cancelled) return
        setCategories(loadedCategories)
        setProducts(loadedProducts)
        setTables(loadedTables)
        setBranches(loadedBranches)
        setLoadState('ok')
      } catch (error) {
        console.error('[POS] load failed', error)
        if (cancelled) return
        setLoadState(isMissingTableError(error) ? 'missing' : 'failed')
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [restaurant])

  const displayName = useCallback(
    (name: string, nameBn: string | null): string =>
      isBn && nameBn ? nameBn : name,
    [isBn],
  )

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  )

  // Live preview: price every cart line from the loaded catalog, using
  // the same totals function the placement service uses.
  const previewLines = useMemo<PricedLine[]>(() => {
    const lines: PricedLine[] = []
    for (const line of cart) {
      const product = productById.get(line.productId)
      if (!product) continue
      const variant =
        product.variants.find((v) => v.id === line.variantId) ?? null
      const chosenModifiers = line.modifierIds
        .map((id) => product.modifiers.find((m) => m.id === id))
        .filter((m): m is NonNullable<typeof m> => !!m)
      const unitPrice = roundMoney(
        Number(product.price) +
          Number(variant?.price_adjustment ?? 0) +
          chosenModifiers.reduce((sum, m) => sum + Number(m.price), 0),
      )
      lines.push({
        productId: product.id,
        variantId: line.variantId,
        modifierIds: line.modifierIds,
        quantity: line.quantity,
        productName: displayName(product.name, product.name_bn),
        variantName: variant?.name ?? null,
        modifierNames: chosenModifiers.map((m) => ({
          id: m.id,
          name: displayName(m.name, m.name_bn),
          price: Number(m.price),
        })),
        unitPrice,
        lineTotal: roundMoney(unitPrice * line.quantity),
      })
    }
    return lines
  }, [cart, productById, displayName])

  const totals = useMemo(
    () =>
      computeOrderTotals(previewLines, discount, taxRate, serviceChargeRate),
    [previewLines, discount, taxRate, serviceChargeRate],
  )

  const availableTables = useMemo(
    () => tables.filter((table) => table.status === 'available'),
    [tables],
  )

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return products.filter((product) => {
      if (
        selectedCategoryId !== 'all' &&
        product.category_id !== selectedCategoryId
      ) {
        return false
      }
      if (!query) return true
      return (
        product.name.toLowerCase().includes(query) ||
        (product.name_bn ?? '').toLowerCase().includes(query)
      )
    })
  }, [products, selectedCategoryId, search])

  // Payments for the placed order, re-fetched after each recording.
  useEffect(() => {
    if (!placedOrder) return
    let cancelled = false
    const loadPayments = async () => {
      try {
        const loaded = await fetchOrderPayments(placedOrder.id)
        if (cancelled) return
        setPayments(loaded)
        const summary = summarizePayments(loaded, Number(placedOrder.total_amount))
        setPaymentAmount(String(summary.balance > 0 ? summary.balance : 0))
      } catch (error) {
        console.error('[POS] load payments failed', error)
        if (!cancelled) setPayments([])
      }
    }
    void loadPayments()
    return () => {
      cancelled = true
    }
  }, [placedOrder])

  const paymentSummary = useMemo(
    () =>
      placedOrder
        ? summarizePayments(payments, Number(placedOrder.total_amount))
        : null,
    [payments, placedOrder],
  )

  const addToCart = (
    product: ProductWithDetails,
    variantId: string | null,
    modifierIds: string[],
    quantity: number,
  ) => {
    const line: CartLine = {
      productId: product.id,
      variantId,
      modifierIds: [...modifierIds].sort(),
      quantity,
    }
    const key = cartKey(line)
    setCart((prev) => {
      const index = prev.findIndex((existing) => cartKey(existing) === key)
      if (index === -1) return [...prev, line]
      const next = [...prev]
      next[index] = {
        ...next[index],
        quantity: next[index].quantity + quantity,
      }
      return next
    })
  }

  const handleProductTap = (product: ProductWithDetails) => {
    if (!product.is_available) return
    if (product.variants.length === 0 && product.modifiers.length === 0) {
      addToCart(product, null, [], 1)
      return
    }
    setChooserProduct(product)
    setChooserVariantId(null)
    setChooserModifierIds([])
    setChooserQty(1)
  }

  const handleChooserAdd = () => {
    if (!chooserProduct) return
    addToCart(
      chooserProduct,
      chooserVariantId,
      chooserModifierIds,
      chooserQty,
    )
    setChooserProduct(null)
  }

  const updateCartQty = (key: string, delta: number) => {
    setCart((prev) =>
      prev.map((line) =>
        cartKey(line) === key
          ? { ...line, quantity: Math.max(1, line.quantity + delta) }
          : line,
      ),
    )
  }

  const removeCartLine = (key: string) => {
    setCart((prev) => prev.filter((line) => cartKey(line) !== key))
  }

  const resetForNewOrder = () => {
    setPlacedOrder(null)
    setPlacedLines([])
    setPayments([])
    setCart([])
    setDiscount(0)
    setNotes('')
    setSelectedTableId('')
    setOrderType('dine_in')
    setPlaceErrorKey(null)
    setPaymentErrorKey(null)
    setPaymentRecorded(false)
    setPaymentMethod('cash')
    setPaymentAmount('')
    setPaymentReference('')
    setChooserProduct(null)
  }

  const handlePlaceOrder = async () => {
    if (!user || !restaurant) return
    setPlaceErrorKey(null)
    if (cart.length === 0) {
      setPlaceErrorKey('pos.emptyOrder')
      return
    }
    if (orderType === 'dine_in' && !selectedTableId) {
      setPlaceErrorKey('pos.tableRequired')
      return
    }
    setPlacing(true)
    try {
      const lines: PosOrderLineInput[] = cart.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        modifierIds: line.modifierIds,
        quantity: line.quantity,
      }))
      const order = await createOrder(
        {
          restaurantId: restaurant.id,
          branchId: defaultBranch?.id ?? null,
          tableId: orderType === 'dine_in' ? selectedTableId : null,
          type: orderType,
          notes,
          discountAmount: discount,
          lines,
        },
        user.id,
        { taxRate, serviceChargeRate },
      )
      setPlacedLines(previewLines)
      setPlacedOrder(order)
      setCart([])
      setDiscount(0)
      setNotes('')
      setChooserProduct(null)
    } catch (error) {
      console.error('[POS] place order failed', error)
      const message = error instanceof Error ? error.message : ''
      setPlaceErrorKey(
        message === 'product_unavailable'
          ? 'pos.productUnavailable'
          : message === 'empty_order'
            ? 'pos.emptyOrder'
            : 'pos.placeFailed',
      )
    } finally {
      setPlacing(false)
    }
  }

  const handleRecordPayment = async (event: FormEvent) => {
    event.preventDefault()
    if (!user || !placedOrder) return
    setPaymentErrorKey(null)
    setPaymentRecorded(false)
    setRecordingPayment(true)
    try {
      await recordPayment(
        placedOrder,
        {
          method: paymentMethod,
          amount: Number(paymentAmount),
          reference: paymentReference,
        },
        user.id,
        paymentAttemptId,
      )
      const loaded = await fetchOrderPayments(placedOrder.id)
      setPayments(loaded)
      const summary = summarizePayments(loaded, Number(placedOrder.total_amount))
      setPaymentAmount(String(summary.balance > 0 ? summary.balance : 0))
      setPaymentReference('')
      setPaymentRecorded(true)
      setPaymentAttemptId(crypto.randomUUID())
    } catch (error) {
      console.error('[POS] record payment failed', error)
      const message = error instanceof Error ? error.message : ''
      setPaymentErrorKey(
        message === 'payment_exceeds_balance'
          ? 'pos.paymentExceedsBalance'
          : message === 'invalid_payment_amount'
            ? 'pos.invalidPaymentAmount'
            : 'pos.paymentFailed',
      )
    } finally {
      setRecordingPayment(false)
    }
  }

  if (loading || !loaded) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  if (dbPending || loadState === 'missing') {
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

  if (loadState === 'failed') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('common.error')}</CardTitle>
          <CardDescription>{t('pos.loadFailed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => window.location.reload()}>
            {t('common.retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  // --- placed-order summary state -------------------------------------------
  if (placedOrder) {
    const tableName =
      tables.find((table) => table.id === placedOrder.table_id)?.name ??
      t('pos.noTable')
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h2 className="text-2xl font-bold tracking-tight">
            {t('pos.orderSummary')}
          </h2>
          <p role="status" className="text-muted-foreground">
            {t('pos.orderPlaced', { number: placedOrder.order_number })}
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>
              #{placedOrder.order_number} · {t(ORDER_TYPE_KEYS[placedOrder.type])}
            </CardTitle>
            <CardDescription>{tableName}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ul className="flex flex-col gap-2">
              {placedLines.map((line) => (
                <li
                  key={`${line.productId}|${line.variantId ?? ''}|${line.modifierIds.join(',')}`}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span>
                    {line.productName}
                    {line.variantName ? ` (${line.variantName})` : ''}
                    {line.modifierNames.length > 0
                      ? ` + ${line.modifierNames.map((m) => m.name).join(', ')}`
                      : ''}
                    {' × '}
                    {line.quantity}
                  </span>
                  <span className="font-medium">
                    {formatMoney(line.lineTotal, currency)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-1 border-t pt-3 text-sm">
              <p className="flex justify-between">
                <span>{t('pos.subtotal')}</span>
                <span>{formatMoney(Number(placedOrder.subtotal), currency)}</span>
              </p>
              <p className="flex justify-between">
                <span>{t('pos.discount')}</span>
                <span>
                  {formatMoney(Number(placedOrder.discount_amount), currency)}
                </span>
              </p>
              <p className="flex justify-between">
                <span>{t('pos.tax', { rate: taxRate })}</span>
                <span>{formatMoney(Number(placedOrder.tax_amount), currency)}</span>
              </p>
              <p className="flex justify-between">
                <span>{t('pos.serviceCharge', { rate: serviceChargeRate })}</span>
                <span>
                  {formatMoney(Number(placedOrder.service_charge_amount), currency)}
                </span>
              </p>
              <p className="flex justify-between font-semibold">
                <span>{t('pos.total')}</span>
                <span>
                  {formatMoney(Number(placedOrder.total_amount), currency)}
                </span>
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('pos.printNotImplemented')}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('pos.payment')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {paymentSummary && (
              <div className="flex flex-col gap-1 text-sm">
                <p className="flex justify-between">
                  <span>{t('pos.paid')}</span>
                  <span>{formatMoney(paymentSummary.paid, currency)}</span>
                </p>
                <p className="flex justify-between">
                  <span>{t('pos.due')}</span>
                  <span>{formatMoney(paymentSummary.due, currency)}</span>
                </p>
                <p className="flex justify-between font-semibold">
                  <span>{t('pos.balance')}</span>
                  <span>{formatMoney(paymentSummary.balance, currency)}</span>
                </p>
              </div>
            )}
            <form onSubmit={handleRecordPayment} className="flex flex-col gap-4">
              <p className="text-sm font-medium">{t('pos.addPayment')}</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="paymentMethod">
                    {t('pos.paymentMethod')}
                  </Label>
                  <select
                    id="paymentMethod"
                    value={paymentMethod}
                    onChange={(e) =>
                      setPaymentMethod(e.target.value as PaymentMethod)
                    }
                    className={SELECT_CLASSNAME}
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {t(PAYMENT_METHOD_KEYS[method])}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="paymentAmount">{t('pos.amount')}</Label>
                  <Input
                    id="paymentAmount"
                    type="number"
                    min={0}
                    step={0.01}
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="paymentReference">{t('pos.reference')}</Label>
                  <Input
                    id="paymentReference"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder={t('pos.referencePlaceholder')}
                  />
                </div>
              </div>
              {paymentErrorKey && (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {t(paymentErrorKey)}
                </p>
              )}
              {paymentRecorded && (
                <p
                  role="status"
                  className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                >
                  {t('pos.paymentRecorded')}
                </p>
              )}
              <div>
                <Button type="submit" disabled={recordingPayment}>
                  {t('pos.recordPayment')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button onClick={resetForNewOrder}>{t('pos.newOrder')}</Button>
          <Button asChild variant="outline">
            <Link to={`/orders/${placedOrder.id}`}>{t('pos.viewOrder')}</Link>
          </Button>
        </div>
      </div>
    )
  }

  // --- building state --------------------------------------------------------
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-bold tracking-tight">{t('pos.title')}</h2>
        <p className="text-muted-foreground">{t('pos.subtitle')}</p>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-col gap-2">
            <Label>{t('pos.orderType')}</Label>
            <div className="flex flex-wrap gap-2">
              {ORDER_TYPES.map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant={orderType === type ? 'default' : 'outline'}
                  onClick={() => setOrderType(type)}
                >
                  {t(ORDER_TYPE_KEYS[type])}
                </Button>
              ))}
            </div>
          </div>
          {orderType === 'dine_in' && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="table">{t('pos.selectTable')}</Label>
              {availableTables.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('pos.noTable')}
                </p>
              ) : (
                <select
                  id="table"
                  value={selectedTableId}
                  onChange={(e) => setSelectedTableId(e.target.value)}
                  className={SELECT_CLASSNAME}
                >
                  <option value="">{t('pos.selectTable')}</option>
                  {availableTables.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('pos.searchProducts')}
            aria-label={t('pos.searchProducts')}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={selectedCategoryId === 'all' ? 'default' : 'outline'}
              onClick={() => setSelectedCategoryId('all')}
            >
              {t('pos.allCategories')}
            </Button>
            {categories.map((category) => (
              <Button
                key={category.id}
                type="button"
                size="sm"
                variant={
                  selectedCategoryId === category.id ? 'default' : 'outline'
                }
                onClick={() => setSelectedCategoryId(category.id)}
              >
                {displayName(category.name, category.name_bn)}
              </Button>
            ))}
          </div>

          {chooserProduct && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {displayName(chooserProduct.name, chooserProduct.name_bn)}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {chooserProduct.variants.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <Label>{t('pos.variant')}</Label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="chooser-variant"
                        checked={chooserVariantId === null}
                        onChange={() => setChooserVariantId(null)}
                      />
                      {t('pos.noVariant')}
                    </label>
                    {chooserProduct.variants.map((variant) => (
                      <label
                        key={variant.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="radio"
                          name="chooser-variant"
                          checked={chooserVariantId === variant.id}
                          onChange={() => setChooserVariantId(variant.id)}
                        />
                        {variant.name}
                        {Number(variant.price_adjustment) !== 0 &&
                          ` (${formatMoney(Number(variant.price_adjustment), currency)})`}
                      </label>
                    ))}
                  </div>
                )}
                {chooserProduct.modifiers.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <Label>{t('pos.modifiers')}</Label>
                    {chooserProduct.modifiers.map((modifier) => (
                      <label
                        key={modifier.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={chooserModifierIds.includes(modifier.id)}
                          onChange={(e) =>
                            setChooserModifierIds((prev) =>
                              e.target.checked
                                ? [...prev, modifier.id]
                                : prev.filter((id) => id !== modifier.id),
                            )
                          }
                        />
                        {displayName(modifier.name, modifier.name_bn)}
                        {` (${formatMoney(Number(modifier.price), currency)})`}
                      </label>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Label>{t('pos.quantity')}</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setChooserQty((q) => Math.max(1, q - 1))}
                  >
                    −
                  </Button>
                  <span className="min-w-6 text-center text-sm">{chooserQty}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setChooserQty((q) => q + 1)}
                  >
                    +
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button type="button" onClick={handleChooserAdd}>
                    {t('pos.addToCart')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setChooserProduct(null)}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {filteredProducts.map((product) => (
              <Button
                key={product.id}
                type="button"
                variant="outline"
                disabled={!product.is_available}
                onClick={() => handleProductTap(product)}
                className="h-auto flex-col items-start gap-1 p-4 text-left"
              >
                <span className="font-medium">
                  {displayName(product.name, product.name_bn)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatMoney(Number(product.price), currency)}
                </span>
                {!product.is_available && (
                  <span className="text-xs text-muted-foreground">
                    {t('pos.unavailable')}
                  </span>
                )}
              </Button>
            ))}
          </div>
        </div>

        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader>
            <CardTitle>{t('pos.cart')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {previewLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('pos.emptyCart')}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {previewLines.map((line) => {
                  const key = `${line.productId}|${line.variantId ?? ''}|${line.modifierIds.join(',')}`
                  return (
                    <li key={key} className="flex flex-col gap-1 text-sm">
                      <span className="flex items-center justify-between gap-2">
                        <span>
                          {line.productName}
                          {line.variantName ? ` (${line.variantName})` : ''}
                          {line.modifierNames.length > 0
                            ? ` + ${line.modifierNames.map((m) => m.name).join(', ')}`
                            : ''}
                        </span>
                        <span className="font-medium">
                          {formatMoney(line.lineTotal, currency)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => updateCartQty(key, -1)}
                        >
                          −
                        </Button>
                        <span className="min-w-6 text-center">
                          {line.quantity}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => updateCartQty(key, 1)}
                        >
                          +
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => removeCartLine(key)}
                        >
                          {t('common.delete')}
                        </Button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="discount">{t('pos.discountAmount')}</Label>
              <Input
                id="discount"
                type="number"
                min={0}
                step={0.01}
                value={discount}
                onChange={(e) =>
                  setDiscount(Math.max(0, Number(e.target.value) || 0))
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="notes">{t('pos.notes')}</Label>
              <Input
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('pos.notesPlaceholder')}
              />
            </div>
            <div className="flex flex-col gap-1 border-t pt-3 text-sm">
              <p className="flex justify-between">
                <span>{t('pos.subtotal')}</span>
                <span>{formatMoney(totals.subtotal, currency)}</span>
              </p>
              <p className="flex justify-between">
                <span>{t('pos.discount')}</span>
                <span>{formatMoney(totals.discountAmount, currency)}</span>
              </p>
              <p className="flex justify-between">
                <span>{t('pos.tax', { rate: taxRate })}</span>
                <span>{formatMoney(totals.taxAmount, currency)}</span>
              </p>
              <p className="flex justify-between">
                <span>{t('pos.serviceCharge', { rate: serviceChargeRate })}</span>
                <span>{formatMoney(totals.serviceChargeAmount, currency)}</span>
              </p>
              <p className="flex justify-between font-semibold">
                <span>{t('pos.total')}</span>
                <span>{formatMoney(totals.totalAmount, currency)}</span>
              </p>
            </div>
            {placeErrorKey && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {t(placeErrorKey)}
              </p>
            )}
            <Button
              type="button"
              onClick={() => void handlePlaceOrder()}
              disabled={placing}
            >
              {placing ? t('pos.placingOrder') : t('pos.placeOrder')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
