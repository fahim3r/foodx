import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { formatMoney, roundMoney } from '@/lib/money'
import { elapsedMinutes, useNow } from '@/lib/time'
import { isNetworkError } from '@/lib/errors'
import {
  loadPosCache,
  savePosCache,
  type PosCatalogData,
} from '@/services/catalogCache'
import { fetchCategories, fetchProductsWithDetails } from '@/services/menu'
import { fetchProductAvailability } from '@/services/inventory'
import {
  enqueueOrder,
  getDeviceId,
  loadQueue,
  queueCounts,
  OFFLINE_QUEUE_UPDATED_EVENT,
  type QueuedOrder,
} from '@/services/offlineQueue'
import { fetchOrders } from '@/services/orders'
import { computeOrderTotals, createOrder, type PricedLine } from '@/services/pos'
import { fetchBranches } from '@/services/restaurant'
import { fetchTables } from '@/services/tables'
import {
  TERMINAL_ORDER_STATUSES,
  type Category,
  type CreateOrderInput,
  type DiningTable,
  type Order,
  type ProductWithDetails,
} from '@/types'

interface CartLine {
  id: string
  productId: string
  variantId: string | null
  modifierIds: string[]
  quantity: number
  note: string
}

type WaiterTab = 'tables' | 'new' | 'mine'

const STATUS_KEY: Record<string, string> = {
  DRAFT: 'orders.statusDraft',
  CONFIRMED: 'orders.statusConfirmed',
  SENT_TO_KITCHEN: 'orders.statusSentToKitchen',
  PREPARING: 'orders.statusPreparing',
  READY: 'orders.statusReady',
  SERVED: 'orders.statusServed',
}

function cartKey(line: Omit<CartLine, 'id' | 'quantity'>): string {
  return [
    line.productId,
    line.variantId ?? '',
    [...line.modifierIds].sort().join(','),
    line.note.trim(),
  ].join('|')
}

/**
 * Waiter view (modifications v2, item 1): a phone-first surface
 * over the same services the POS uses — tables, a big-tile
 * ordering screen (no payments/discounts; the cashier settles),
 * and the waiter's own orders for today. Offline placements go
 * through the shared offline queue, exactly like the POS.
 */
export default function WaiterPage() {
  const { t, i18n } = useTranslation()
  const { user, restaurant, settings } = useAuth()
  const online = useOnlineStatus()
  const restaurantId = restaurant?.id
  const currency = settings?.currency ?? restaurant?.default_currency ?? 'BDT'
  const taxRate = Number(settings?.tax_rate ?? 0)
  const serviceChargeRate = Number(settings?.service_charge_rate ?? 0)
  const now = useNow(30_000)

  const [tab, setTab] = useState<WaiterTab>('tables')
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<ProductWithDetails[]>([])
  const [tables, setTables] = useState<DiningTable[]>([])
  const [mainBranchId, setMainBranchId] = useState<string | null>(null)
  const [openOrders, setOpenOrders] = useState<Order[]>([])
  const [ordersLoaded, setOrdersLoaded] = useState(false)
  const [myOrders, setMyOrders] = useState<Order[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  )
  const [fromCacheAt, setFromCacheAt] = useState<string | null>(null)

  const [selectedTable, setSelectedTable] = useState<DiningTable | null>(null)
  const [expandedTableId, setExpandedTableId] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [cart, setCart] = useState<CartLine[]>([])
  const [picker, setPicker] = useState<ProductWithDetails | null>(null)
  const [pickerVariantId, setPickerVariantId] = useState<string | null>(null)
  const [pickerModifierIds, setPickerModifierIds] = useState<string[]>([])
  const [pickerNote, setPickerNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sentInfo, setSentInfo] = useState<
    { kind: 'online'; orderNumber: number } | { kind: 'queued' } | null
  >(null)
  const [queue, setQueue] = useState<QueuedOrder[]>([])
  const initialised = useRef(false)

  const displayName = useCallback(
    (name: string, nameBn: string | null) =>
      i18n.language?.startsWith('bn') && nameBn ? nameBn : name,
    [i18n.language],
  )

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  )
  const tableById = useMemo(
    () => new Map(tables.map((table) => [table.id, table])),
    [tables],
  )

  const refreshQueue = useCallback(() => {
    if (restaurantId) setQueue(loadQueue(restaurantId))
  }, [restaurantId])

  useEffect(() => {
    refreshQueue()
    window.addEventListener(OFFLINE_QUEUE_UPDATED_EVENT, refreshQueue)
    return () =>
      window.removeEventListener(OFFLINE_QUEUE_UPDATED_EVENT, refreshQueue)
  }, [refreshQueue])

  const loadOpenOrders = useCallback(async () => {
    if (!restaurantId) return
    const orders = await fetchOrders(restaurantId, { limit: 100 })
    setOrdersLoaded(true)
    setOpenOrders(
      orders.filter((o) => !TERMINAL_ORDER_STATUSES.includes(o.status)),
    )
    if (user) {
      const today = new Date().toDateString()
      setMyOrders(
        orders.filter(
          (o) =>
            o.created_by === user.id &&
            new Date(o.created_at).toDateString() === today &&
            !TERMINAL_ORDER_STATUSES.includes(o.status),
        ),
      )
    }
  }, [restaurantId, user])

  useEffect(() => {
    if (!restaurantId || initialised.current) return
    initialised.current = true
    ;(async () => {
      try {
        const [cats, prods, tbls, branches, availability] = await Promise.all([
          fetchCategories(restaurantId),
          fetchProductsWithDetails(restaurantId),
          fetchTables(restaurantId),
          fetchBranches(restaurantId),
          fetchProductAvailability(restaurantId),
        ])
        const data: PosCatalogData = {
          categories: cats,
          products: prods,
          tables: tbls,
          branches,
          availability,
        }
        savePosCache(restaurantId, data)
        setCategories(cats)
        setProducts(prods)
        setTables(tbls)
        setMainBranchId(branches.find((b) => b.is_main)?.id ?? null)
        setLoadState('ready')
      } catch (error) {
        const cached = loadPosCache(restaurantId)
        if (cached && isNetworkError(error)) {
          setCategories(cached.categories)
          setProducts(cached.products)
          setTables(cached.tables)
          setMainBranchId(
            cached.branches.find((b) => b.is_main)?.id ?? null,
          )
          setFromCacheAt(cached.savedAt)
          setLoadState('ready')
        } else {
          console.error('[Waiter] catalog load failed', error)
          setLoadState('error')
        }
      }
      void loadOpenOrders().catch(() => setOrdersLoaded(true))
    })()
  }, [restaurantId, loadOpenOrders])

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
        note: line.note || null,
        cartLineId: line.id,
      })
    }
    return lines
  }, [cart, productById, displayName])

  const totals = useMemo(
    () => computeOrderTotals(previewLines, 0, taxRate, serviceChargeRate),
    [previewLines, taxRate, serviceChargeRate],
  )

  const addToCart = (
    product: ProductWithDetails,
    variantId: string | null,
    modifierIds: string[],
    note: string,
  ) => {
    const candidate = { productId: product.id, variantId, modifierIds, note }
    setCart((prev) => {
      const key = cartKey(candidate)
      const existing = prev.find((line) => cartKey(line) === key)
      if (existing) {
        return prev.map((line) =>
          line.id === existing.id
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        )
      }
      return [
        ...prev,
        { id: crypto.randomUUID(), ...candidate, quantity: 1 },
      ]
    })
  }

  const handleProductTap = (product: ProductWithDetails) => {
    if (product.variants.length > 0 || product.modifiers.length > 0) {
      setPicker(product)
      setPickerVariantId(product.variants[0]?.id ?? null)
      setPickerModifierIds([])
      setPickerNote('')
    } else {
      addToCart(product, null, [], '')
    }
  }

  const changeQty = (lineId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((line) =>
          line.id === lineId
            ? { ...line, quantity: line.quantity + delta }
            : line,
        )
        .filter((line) => line.quantity > 0),
    )
  }

  const ordersByTable = useMemo(() => {
    const map = new Map<string, Order[]>()
    for (const order of openOrders) {
      if (!order.table_id) continue
      const list = map.get(order.table_id) ?? []
      list.push(order)
      map.set(order.table_id, list)
    }
    return map
  }, [openOrders ])

  const handleSend = async () => {
    if (!user || !restaurant || !selectedTable || cart.length === 0) return
    setSendError(null)
    const input: CreateOrderInput = {
      restaurantId: restaurant.id,
      branchId: mainBranchId,
      tableId: selectedTable.id,
      type: 'dine_in',
      discountAmount: 0,
      lines: cart.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        modifierIds: line.modifierIds,
        quantity: line.quantity,
        note: line.note.trim() || undefined,
      })),
    }
    const queueIt = () => {
      const entry: QueuedOrder = {
        id: crypto.randomUUID(),
        deviceId: getDeviceId(),
        restaurantId: restaurant.id,
        queuedAt: new Date().toISOString(),
        source: 'pos_offline',
        status: 'queued',
        failureReason: null,
        attempts: 0,
        lastAttemptAt: null,
        input,
        pricedLines: previewLines,
        totals,
        taxRate,
        serviceChargeRate,
        payments: [],
      }
      enqueueOrder(entry)
      refreshQueue()
      setSentInfo({ kind: 'queued' })
      setCart([])
    }
    if (!online) {
      queueIt()
      return
    }
    setSending(true)
    try {
      const order = await createOrder(input, user.id, {
        taxRate,
        serviceChargeRate,
      })
      setSentInfo({ kind: 'online', orderNumber: order.order_number })
      setCart([])
      void loadOpenOrders().catch(() => undefined)
    } catch (error) {
      if (error instanceof Error && error.message === 'license_suspended') {
        setSendError('pos.licenseSuspended')
      } else if (isNetworkError(error)) {
        queueIt()
      } else {
        console.error('[Waiter] send failed', error)
        setSendError('waiter.sendFailed')
      }
    } finally {
      setSending(false)
    }
  }

  const counts = queueCounts(queue)
  const visibleProducts = categoryId
    ? products.filter((p) => p.category_id === categoryId)
    : products

  if (loadState === 'loading') {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }
  if (loadState === 'error') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('common.error')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t('waiter.loadFailed')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('waiter.title')}</h1>
        {!online && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
            {t('offline.badge')}
          </span>
        )}
      </div>
      {fromCacheAt && (
        <p className="text-xs text-muted-foreground">
          {t('waiter.fromCache', { time: new Date(fromCacheAt).toLocaleString() })}
        </p>
      )}
      {counts.waiting + counts.failed > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t('waiter.queueWaiting', {
            count: counts.waiting + counts.failed,
          })}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ['tables', 'waiter.tabTables'],
            ['new', 'waiter.tabNew'],
            ['mine', 'waiter.tabMine'],
          ] as [WaiterTab, string][]
        ).map(([id, key]) => (
          <Button
            key={id}
            type="button"
            size="lg"
            variant={tab === id ? 'default' : 'outline'}
            onClick={() => setTab(id)}
          >
            {t(key)}
          </Button>
        ))}
      </div>

      {tab === 'tables' && !ordersLoaded && (
        <p className="text-muted-foreground">{t('common.loading')}</p>
      )}
      {tab === 'tables' && ordersLoaded && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {tables.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('waiter.noTables')}</p>
          )}
          {tables.map((table) => {
            const tableOrders = ordersByTable.get(table.id) ?? []
            const occupied = tableOrders.length > 0
            const runningTotal = tableOrders.reduce(
              (sum, o) => sum + Number(o.total_amount),
              0,
            )
            const oldest = tableOrders[tableOrders.length - 1]
            return (
              <div key={table.id} className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (occupied) {
                      setExpandedTableId(
                        expandedTableId === table.id ? null : table.id,
                      )
                    } else {
                      setSelectedTable(table)
                      setSentInfo(null)
                      setTab('new')
                    }
                  }}
                  className={
                    occupied
                      ? 'rounded-xl border border-amber-300 bg-amber-50 p-4 text-left'
                      : 'rounded-xl border bg-card p-4 text-left'
                  }
                >
                  <p className="text-lg font-semibold">{table.name}</p>
                  {occupied ? (
                    <>
                      <p className="text-sm text-amber-900">
                        {t('waiter.busyFor', {
                          minutes: oldest
                            ? elapsedMinutes(oldest.created_at, now)
                            : 0,
                        })}
                      </p>
                      <p className="text-sm font-medium">
                        {formatMoney(runningTotal, currency)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t('waiter.tableFree')}
                    </p>
                  )}
                </button>
                {occupied && expandedTableId === table.id && (
                  <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                    {tableOrders.map((order) => (
                      <p key={order.id} className="flex justify-between gap-2">
                        <span>
                          #{order.order_number} ·{' '}
                          {t(STATUS_KEY[order.status] ?? 'orders.statusConfirmed')}
                        </span>
                        <span>{formatMoney(Number(order.total_amount), currency)}</span>
                      </p>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      className="mt-2"
                      onClick={() => {
                        setSelectedTable(table)
                        setSentInfo(null)
                        setTab('new')
                      }}
                    >
                      {t('waiter.newRound')}
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'new' && (
        <div className="flex flex-col gap-4">
          {selectedTable ? (
            <p className="text-sm">
              {t('waiter.orderingFor', { table: selectedTable.name })}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => setTab('tables')}
              >
                {t('waiter.changeTable')}
              </button>
            </p>
          ) : (
            <p className="rounded-md bg-muted px-3 py-2 text-sm">
              {t('waiter.pickTableFirst')}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={categoryId === null ? 'default' : 'outline'}
              onClick={() => setCategoryId(null)}
            >
              {t('waiter.allCategories')}
            </Button>
            {categories.map((category) => (
              <Button
                key={category.id}
                type="button"
                size="sm"
                variant={categoryId === category.id ? 'default' : 'outline'}
                onClick={() => setCategoryId(category.id)}
              >
                {displayName(category.name, category.name_bn)}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {visibleProducts.map((product) => (
              <button
                key={product.id}
                type="button"
                disabled={!product.is_available}
                onClick={() => handleProductTap(product)}
                className="rounded-xl border bg-card p-3 text-left disabled:opacity-50"
              >
                {product.image_url && (
                  <img
                    src={product.image_url}
                    alt=""
                    className="mb-2 h-20 w-full rounded-lg object-cover"
                  />
                )}
                <p className="font-medium leading-snug">
                  {displayName(product.name, product.name_bn)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {formatMoney(Number(product.price), currency)}
                </p>
              </button>
            ))}
          </div>

          {picker && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {displayName(picker.name, picker.name_bn)}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {picker.variants.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {picker.variants.map((variant) => (
                      <Button
                        key={variant.id}
                        type="button"
                        size="sm"
                        variant={
                          pickerVariantId === variant.id ? 'default' : 'outline'
                        }
                        onClick={() => setPickerVariantId(variant.id)}
                      >
                        {variant.name}
                        {Number(variant.price_adjustment) !== 0 &&
                          ` (${formatMoney(Number(variant.price_adjustment), currency)})`}
                      </Button>
                    ))}
                  </div>
                )}
                {picker.modifiers.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {picker.modifiers.map((modifier) => {
                      const active = pickerModifierIds.includes(modifier.id)
                      return (
                        <Button
                          key={modifier.id}
                          type="button"
                          size="sm"
                          variant={active ? 'default' : 'outline'}
                          onClick={() =>
                            setPickerModifierIds((prev) =>
                              active
                                ? prev.filter((id) => id !== modifier.id)
                                : [...prev, modifier.id],
                            )
                          }
                        >
                          {displayName(modifier.name, modifier.name_bn)} (+
                          {formatMoney(Number(modifier.price), currency)})
                        </Button>
                      )
                    })}
                  </div>
                )}
                <Input
                  value={pickerNote}
                  onChange={(e) => setPickerNote(e.target.value)}
                  placeholder={t('waiter.notePlaceholder')}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => {
                      addToCart(
                        picker,
                        pickerVariantId,
                        pickerModifierIds,
                        pickerNote,
                      )
                      setPicker(null)
                    }}
                  >
                    {t('waiter.addToOrder')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPicker(null)}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('waiter.cartTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {cart.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('waiter.cartEmpty')}
                </p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {previewLines.map((line) => (
                    <li
                      key={line.cartLineId ?? line.productId}
                      className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                    >
                      <div>
                        <p className="font-medium">
                          {line.productName}
                          {line.variantName ? ` · ${line.variantName}` : ''}
                        </p>
                        {line.note && (
                          <p className="text-xs text-amber-700">{line.note}</p>
                        )}
                        <p className="text-sm text-muted-foreground">
                          {formatMoney(line.lineTotal, currency)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            line.cartLineId && changeQty(line.cartLineId, -1)
                          }
                        >
                          −
                        </Button>
                        <span className="w-6 text-center">{line.quantity}</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            line.cartLineId && changeQty(line.cartLineId, 1)
                          }
                        >
                          +
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="flex justify-between border-t pt-3 font-semibold">
                <span>{t('waiter.total')}</span>
                <span>{formatMoney(totals.totalAmount, currency)}</span>
              </p>
              {sendError && (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {t(sendError)}
                </p>
              )}
              {sentInfo && (
                <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  {sentInfo.kind === 'online'
                    ? t('waiter.sentOnline', { number: sentInfo.orderNumber })
                    : t('waiter.sentQueued')}
                </p>
              )}
              <Button
                type="button"
                size="lg"
                disabled={
                  sending || cart.length === 0 || !selectedTable
                }
                onClick={() => void handleSend()}
              >
                {t('waiter.sendOrder')}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'mine' && (
        <div className="flex flex-col gap-3">
          {myOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('waiter.noMyOrders')}
            </p>
          ) : (
            myOrders.map((order) => (
              <Card key={order.id}>
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <div>
                    <p className="font-medium">
                      #{order.order_number}
                      {order.table_id && tableById.get(order.table_id)
                        ? ` · ${tableById.get(order.table_id)?.name}`
                        : ''}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('waiter.openFor', {
                        minutes: elapsedMinutes(order.created_at, now),
                      })}
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={
                        order.status === 'READY'
                          ? 'rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900'
                          : 'rounded-full bg-muted px-2.5 py-1 text-xs font-medium'
                      }
                    >
                      {t(STATUS_KEY[order.status] ?? 'orders.statusConfirmed')}
                    </span>
                    <p className="mt-1 text-sm">
                      {formatMoney(Number(order.total_amount), currency)}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  )
}
