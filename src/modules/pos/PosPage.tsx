// FoodX — POS page (order-taking screen).
// The client never decides prices: the cart preview is priced from the
// loaded catalog with the same computeOrderTotals() the server-side
// createOrder() uses, and placement sends only ids + quantities —
// services/pos.ts re-reads prices from the database before storing.
// Receipt printing (§62, Phase 7 Step 2A) prints the placed order
// from the summary card via lib/receipt + lib/print.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { isMissingTableError, isNetworkError } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { useAuth } from '@/hooks/useAuth'
import { fetchProductAvailability } from '@/services/inventory'
import {
  computeCouponDiscount,
  fetchCouponByCode,
  validateCouponForOrder,
} from '@/services/coupons'
import { fetchCustomers } from '@/services/customers'
import { fetchCustomerBalance, readLoyaltyRates } from '@/services/loyalty'
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
import { fetchOrderDetail } from '@/services/orders'
import { fetchTables } from '@/services/tables'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { loadPosCache, savePosCache } from '@/services/catalogCache'
import {
  addQueuedPayment,
  enqueueOrder,
  getDeviceId,
  loadQueue,
  localRef,
  queueCounts,
  removeEntry,
  OFFLINE_QUEUE_UPDATED_EVENT,
  type QueuedOrder,
} from '@/services/offlineQueue'
import { printHtml } from '@/lib/print'
import { buildReceiptHtml } from '@/lib/receipt'
import type {
  Category,
  Coupon,
  CreateOrderInput,
  Customer,
  DiningTable,
  Order,
  OrderDetail,
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
  pickup: 'pos.pickup',
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
  // Servings the current stock allows per product (Phase 3). A missing
  // entry means the product has no recipe and is not stock-limited.
  const [availability, setAvailability] = useState<Map<string, number>>(
    new Map(),
  )
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

  // --- Phase 4: customer / coupon / loyalty (all optional) ------------------
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerOptions, setCustomerOptions] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    null,
  )
  const [customerBalance, setCustomerBalance] = useState<number | null>(null)
  const [couponCode, setCouponCode] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null)
  const [couponErrorKey, setCouponErrorKey] = useState<string | null>(null)
  const [couponApplying, setCouponApplying] = useState(false)
  // Points the cashier wants to redeem; clamped to what the customer
  // can actually use (see redeemPointsEffective below).
  const [redeemPoints, setRedeemPoints] = useState('')

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

  // --- Phase 9: offline queue ------------------------------------------------
  const online = useOnlineStatus()
  const [queuedOrder, setQueuedOrder] = useState<QueuedOrder | null>(null)
  const [queueEntries, setQueueEntries] = useState<QueuedOrder[]>([])
  const [queueOpen, setQueueOpen] = useState(false)
  const [removingEntryId, setRemovingEntryId] = useState<string | null>(null)

  // --- Phase 9 v2: catalog cache --------------------------------------------
  // savedAt of the POS cache the page is currently running on, or
  // null when the catalog on screen came from the server.
  const [cacheSavedAt, setCacheSavedAt] = useState<string | null>(null)
  // True when a load failed offline and this device has no cache yet.
  const [cacheMissing, setCacheMissing] = useState(false)

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
        const [loadedCategories, loadedProducts, loadedTables, loadedBranches, loadedAvailability] =
          await Promise.all([
            fetchCategories(restaurant.id),
            fetchProductsWithDetails(restaurant.id),
            fetchTables(restaurant.id),
            fetchBranches(restaurant.id),
            fetchProductAvailability(restaurant.id),
          ])
        if (cancelled) return
        setCategories(loadedCategories)
        setProducts(loadedProducts)
        setTables(loadedTables)
        setBranches(loadedBranches)
        setAvailability(loadedAvailability)
        savePosCache(restaurant.id, {
          categories: loadedCategories,
          products: loadedProducts,
          tables: loadedTables,
          branches: loadedBranches,
          availability: loadedAvailability,
        })
        setCacheSavedAt(null)
        setCacheMissing(false)
        setLoadState('ok')
      } catch (error) {
        console.error('[POS] load failed', error)
        if (cancelled) return
        if (isMissingTableError(error)) {
          setLoadState('missing')
          return
        }
        // Phase 9 v2: a network failure falls back to the saved
        // catalog, so a cold offline start can still sell. Any
        // other failure keeps the load-failed card.
        if (isNetworkError(error) || !navigator.onLine) {
          const cached = loadPosCache(restaurant.id)
          if (cached) {
            setCategories(cached.categories)
            setProducts(cached.products)
            setTables(cached.tables)
            setBranches(cached.branches)
            setAvailability(cached.availability)
            setCacheSavedAt(cached.savedAt)
            setLoadState('ok')
            return
          }
          setCacheMissing(true)
        }
        setLoadState('failed')
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [restaurant])

  // Phase 9 v2: when connectivity returns while the page is running
  // on a cached catalog, refresh from the server — but only with an
  // empty cart, so an open cart's preview is never re-priced
  // mid-order. With items in the cart the cached catalog stays
  // until the next mount; online placements re-price server-side
  // anyway, and offline placements use the snapshot (v1 D1).
  useEffect(() => {
    if (!online || !cacheSavedAt || !restaurant || cart.length > 0) return
    let cancelled = false
    void (async () => {
      try {
        const [c, p, tb, b, a] = await Promise.all([
          fetchCategories(restaurant.id),
          fetchProductsWithDetails(restaurant.id),
          fetchTables(restaurant.id),
          fetchBranches(restaurant.id),
          fetchProductAvailability(restaurant.id),
        ])
        if (cancelled) return
        setCategories(c)
        setProducts(p)
        setTables(tb)
        setBranches(b)
        setAvailability(a)
        savePosCache(restaurant.id, {
          categories: c,
          products: p,
          tables: tb,
          branches: b,
          availability: a,
        })
        setCacheSavedAt(null)
      } catch {
        // Still effectively offline — keep selling from the cache.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [online, cacheSavedAt, cart.length, restaurant])

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

  // Live preview: price every cart line from the loaded catalog, using
  // the same totals function the placement service uses.
  //
  // Discount order: manual first, then coupon, then loyalty — each
  // clamped so the total never goes below 0. The coupon discount is
  // computed from the raw subtotal (same rule the service validates
  // against); the redeemable points are capped by the balance AND by
  // the remaining total after manual + coupon, so the preview and the
  // placed order always agree.
  const loyaltyRates = useMemo(() => readLoyaltyRates(settings), [settings])

  const baseTotals = useMemo(
    () =>
      computeOrderTotals(previewLines, discount, taxRate, serviceChargeRate),
    [previewLines, discount, taxRate, serviceChargeRate],
  )

  const couponDiscount = useMemo(
    () =>
      appliedCoupon
        ? computeCouponDiscount(appliedCoupon, baseTotals.subtotal)
        : 0,
    [appliedCoupon, baseTotals.subtotal],
  )

  const totalsAfterCoupon = useMemo(
    () =>
      computeOrderTotals(previewLines, discount, taxRate, serviceChargeRate, {
        couponDiscount,
      }),
    [previewLines, discount, taxRate, serviceChargeRate, couponDiscount],
  )

  const maxRedeemablePoints = useMemo(() => {
    if (!selectedCustomer || customerBalance === null) return 0
    const byTotal = Math.floor(
      Math.max(0, totalsAfterCoupon.totalAmount) / loyaltyRates.pointValue,
    )
    return Math.max(0, Math.min(customerBalance, byTotal))
  }, [selectedCustomer, customerBalance, totalsAfterCoupon, loyaltyRates])

  const redeemPointsEffective = useMemo(() => {
    const wanted = Number.parseInt(redeemPoints, 10)
    if (!Number.isFinite(wanted) || wanted <= 0) return 0
    return Math.min(wanted, maxRedeemablePoints)
  }, [redeemPoints, maxRedeemablePoints])

  const loyaltyDiscount = useMemo(
    () => roundMoney(redeemPointsEffective * loyaltyRates.pointValue),
    [redeemPointsEffective, loyaltyRates],
  )

  const totals = useMemo(
    () =>
      computeOrderTotals(previewLines, discount, taxRate, serviceChargeRate, {
        couponDiscount,
        loyaltyDiscount,
      }),
    [
      previewLines,
      discount,
      taxRate,
      serviceChargeRate,
      couponDiscount,
      loyaltyDiscount,
    ],
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

  // The offline queue for this restaurant, kept current through the
  // queue-updated event (enqueues, sync removals, failure marks).
  useEffect(() => {
    if (!restaurant) return
    const refresh = () => setQueueEntries(loadQueue(restaurant.id))
    refresh()
    window.addEventListener(OFFLINE_QUEUE_UPDATED_EVENT, refresh)
    return () =>
      window.removeEventListener(OFFLINE_QUEUE_UPDATED_EVENT, refresh)
  }, [restaurant])

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
    // Out of stock (0 servable servings) cannot be added. A low but
    // non-zero count is a warning only — a sale at the counter is never
    // blocked, and the server allows stock to go negative.
    if (availability.get(product.id) === 0) return
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
    setQueuedOrder(null)
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
    setCustomerSearch('')
    setCustomerOptions([])
    setSelectedCustomer(null)
    setCustomerBalance(null)
    setCouponCode('')
    setAppliedCoupon(null)
    setCouponErrorKey(null)
    setRedeemPoints('')
  }

  const handleCustomerSearch = async () => {
    if (!restaurant) return
    try {
      const found = await fetchCustomers(restaurant.id, customerSearch)
      setCustomerOptions(found.filter((c) => c.is_active))
    } catch (error) {
      console.error('[POS] customer search failed', error)
      setCustomerOptions([])
    }
  }

  const handleAttachCustomer = async (customer: Customer) => {
    setSelectedCustomer(customer)
    setCustomerOptions([])
    setCustomerSearch('')
    setRedeemPoints('')
    try {
      setCustomerBalance(await fetchCustomerBalance(customer.id))
    } catch (error) {
      console.error('[POS] customer balance failed', error)
      setCustomerBalance(null)
    }
  }

  const handleClearCustomer = () => {
    setSelectedCustomer(null)
    setCustomerBalance(null)
    setRedeemPoints('')
  }

  const handleApplyCoupon = async () => {
    if (!restaurant) return
    setCouponErrorKey(null)
    setCouponApplying(true)
    try {
      const coupon = await fetchCouponByCode(restaurant.id, couponCode)
      if (!coupon) {
        setCouponErrorKey('customers.couponNotFound')
        return
      }
      const invalid = validateCouponForOrder(
        coupon,
        baseTotals.subtotal,
        new Date(),
      )
      if (invalid) {
        setCouponErrorKey(invalid)
        return
      }
      setAppliedCoupon(coupon)
    } catch (error) {
      console.error('[POS] apply coupon failed', error)
      setCouponErrorKey('customers.couponNotFound')
    } finally {
      setCouponApplying(false)
    }
  }

  const handleClearCoupon = () => {
    setAppliedCoupon(null)
    setCouponCode('')
    setCouponErrorKey(null)
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
    const lines: PosOrderLineInput[] = cart.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      modifierIds: line.modifierIds,
      quantity: line.quantity,
    }))
    const input: CreateOrderInput = {
      restaurantId: restaurant.id,
      branchId: defaultBranch?.id ?? null,
      tableId: orderType === 'dine_in' ? selectedTableId : null,
      type: orderType,
      notes,
      discountAmount: discount,
      customerId: selectedCustomer?.id ?? null,
      couponId: appliedCoupon?.id ?? null,
      couponDiscount,
      loyaltyPointsRedeemed: redeemPointsEffective,
      loyaltyDiscount,
      lines,
    }
    // Phase 9: the offline queue cannot carry a customer, coupon or
    // loyalty redemption — those need live validation (design D2).
    const hasOnlineExtras =
      !!selectedCustomer || !!appliedCoupon || redeemPointsEffective > 0
    const queueCurrentOrder = () => {
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
      setPlacedLines(previewLines)
      setQueuedOrder(entry)
      setCart([])
      setDiscount(0)
      setNotes('')
      setChooserProduct(null)
      setPaymentAmount(String(totals.totalAmount))
      setPaymentReference('')
      setPaymentErrorKey(null)
      setPaymentRecorded(false)
    }
    if (!online) {
      if (hasOnlineExtras) {
        setPlaceErrorKey('offline.extrasUnsupported')
        return
      }
      queueCurrentOrder()
      return
    }
    setPlacing(true)
    try {
      const order = await createOrder(input, user.id, {
        taxRate,
        serviceChargeRate,
      })
      setPlacedLines(previewLines)
      setPlacedOrder(order)
      setCart([])
      setDiscount(0)
      setNotes('')
      setChooserProduct(null)
      // Stock changed (the order deducted recipe ingredients) — refresh
      // availability so the next order sees honest servings.
      setAvailability(await fetchProductAvailability(restaurant.id))
    } catch (error) {
      // A connectivity failure mid-placement queues the order
      // instead of losing the sale (Phase 9) — unless it carries
      // online-only extras, which the queue cannot hold.
      if (isNetworkError(error) && !hasOnlineExtras) {
        queueCurrentOrder()
        return
      }
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

  const handlePrintReceipt = async () => {
    if (!placedOrder || !restaurant) return
    try {
      const detail = await fetchOrderDetail(placedOrder.id)
      const branch =
        branches.find((b) => b.id === detail.branch_id) ?? defaultBranch
      const table = tables.find((tb) => tb.id === detail.table_id)
      const { title, html, css } = buildReceiptHtml(
        detail,
        {
          restaurantName: settings?.branding_name || restaurant.name,
          logoUrl: settings?.logo_url ?? null,
          branchName: branch?.name ?? null,
          branchAddress: branch?.address ?? null,
          branchPhone: branch?.phone ?? null,
          tableName: table?.name ?? null,
          footer: settings?.receipt_footer ?? null,
        },
        {
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
        },
        (n) => formatMoney(n, currency),
        (method) => t(PAYMENT_METHOD_KEYS[method as PaymentMethod]),
      )
      printHtml(title, html, css)
    } catch {
      // Printing is best-effort; the order itself is unaffected.
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

  // --- Phase 9: payments + receipt for a QUEUED (offline) order -------------
  // The payment form state is shared with the placed-order card; for a
  // queued order the payment is appended to the queue entry (with the
  // attempt id as its idempotency key) and syncs with the order.
  const handleQueuedPayment = (event: FormEvent) => {
    event.preventDefault()
    if (!queuedOrder || !restaurant) return
    setPaymentErrorKey(null)
    setPaymentRecorded(false)
    const amount = roundMoney(Number(paymentAmount))
    if (!Number.isFinite(amount) || amount <= 0) {
      setPaymentErrorKey('pos.invalidPaymentAmount')
      return
    }
    const paidSoFar = queuedOrder.payments.reduce(
      (sum, p) => sum + p.amount,
      0,
    )
    const balance = roundMoney(queuedOrder.totals.totalAmount - paidSoFar)
    if (amount > balance + 0.001) {
      setPaymentErrorKey('pos.paymentExceedsBalance')
      return
    }
    const updated = addQueuedPayment(restaurant.id, queuedOrder.id, {
      id: paymentAttemptId,
      method: paymentMethod,
      amount,
      reference: paymentReference.trim() || null,
    })
    if (updated) {
      setQueuedOrder(updated)
      setPaymentAmount(String(Math.max(0, roundMoney(balance - amount))))
      setPaymentReference('')
      setPaymentRecorded(true)
      setPaymentAttemptId(crypto.randomUUID())
    }
  }

  const handlePrintQueuedReceipt = () => {
    if (!queuedOrder || !restaurant) return
    const entry = queuedOrder
    const detail: OrderDetail = {
      id: entry.id,
      restaurant_id: entry.restaurantId,
      branch_id: entry.input.branchId ?? null,
      table_id: entry.input.tableId ?? null,
      order_number: 0,
      type: entry.input.type,
      source: 'POS',
      status: 'CONFIRMED',
      subtotal: entry.totals.subtotal,
      discount_amount: entry.totals.discountAmount,
      tax_amount: entry.totals.taxAmount,
      service_charge_amount: entry.totals.serviceChargeAmount,
      total_amount: entry.totals.totalAmount,
      delivery_fee: 0,
      delivery_zone_id: null,
      customer_id: null,
      customer_name: null,
      customer_phone: null,
      delivery_address: null,
      coupon_id: null,
      coupon_discount: 0,
      loyalty_points_redeemed: 0,
      loyalty_discount: 0,
      notes: entry.input.notes ?? null,
      created_by: user?.id ?? null,
      created_at: entry.queuedAt,
      updated_at: entry.queuedAt,
      items: entry.pricedLines.map((line, i) => ({
        id: `${entry.id}-item-${i}`,
        order_id: entry.id,
        product_id: line.productId,
        variant_id: line.variantId,
        product_name: line.productName,
        variant_name: line.variantName,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        total_price: line.lineTotal,
        created_at: entry.queuedAt,
        updated_at: entry.queuedAt,
        modifiers: line.modifierNames.map((m, j) => ({
          id: `${entry.id}-item-${i}-mod-${j}`,
          order_item_id: `${entry.id}-item-${i}`,
          modifier_id: m.id,
          modifier_name: m.name,
          price: m.price,
          created_at: entry.queuedAt,
        })),
      })),
      payments: entry.payments.map((payment) => ({
        id: payment.id,
        order_id: entry.id,
        method: payment.method,
        amount: payment.amount,
        reference: payment.reference,
        received_by: null,
        created_at: entry.queuedAt,
      })),
      history: [],
    }
    const branch =
      branches.find((b) => b.id === detail.branch_id) ?? defaultBranch
    const table = tables.find((tb) => tb.id === detail.table_id)
    const { title, html, css } = buildReceiptHtml(
      detail,
      {
        restaurantName: settings?.branding_name || restaurant.name,
        logoUrl: settings?.logo_url ?? null,
        branchName: branch?.name ?? null,
        branchAddress: branch?.address ?? null,
        branchPhone: branch?.phone ?? null,
        tableName: table?.name ?? null,
        footer: settings?.receipt_footer ?? null,
        orderRef: localRef(entry.id),
      },
      {
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
      },
      (n) => formatMoney(n, currency),
      (method) => t(PAYMENT_METHOD_KEYS[method as PaymentMethod]),
    )
    printHtml(title, html, css)
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
          {cacheMissing && (
            <p className="mb-3 text-sm text-muted-foreground">
              {t('offline.firstVisitOffline')}
            </p>
          )}
          <Button onClick={() => window.location.reload()}>
            {t('common.retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  // --- queued (offline) order summary state --------------------------------
  if (queuedOrder) {
    const tableName =
      tables.find((table) => table.id === queuedOrder.input.tableId)?.name ??
      t('pos.noTable')
    const paidTotal = roundMoney(
      queuedOrder.payments
        .filter((payment) => payment.method !== 'due')
        .reduce((sum, payment) => sum + payment.amount, 0),
    )
    const dueTotal = roundMoney(
      queuedOrder.payments
        .filter((payment) => payment.method === 'due')
        .reduce((sum, payment) => sum + payment.amount, 0),
    )
    const balanceTotal = roundMoney(
      queuedOrder.totals.totalAmount - paidTotal - dueTotal,
    )
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h2 className="text-2xl font-bold tracking-tight">
            {t('offline.queuedTitle')}
          </h2>
          <p role="status" className="text-muted-foreground">
            {t('offline.localRef')}: {localRef(queuedOrder.id)}
          </p>
        </header>

        <p
          role="status"
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {t('offline.queuedNotice')}
        </p>

        <Card>
          <CardHeader>
            <CardTitle>
              {localRef(queuedOrder.id)} ·{' '}
              {t(ORDER_TYPE_KEYS[queuedOrder.input.type])}
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
                <span>{formatMoney(queuedOrder.totals.subtotal, currency)}</span>
              </p>
              <p className="flex justify-between">
                <span>{t('pos.discount')}</span>
                <span>
                  {formatMoney(queuedOrder.totals.discountAmount, currency)}
                </span>
              </p>
              <p className="flex justify-between">
                <span>{t('pos.tax', { rate: taxRate })}</span>
                <span>{formatMoney(queuedOrder.totals.taxAmount, currency)}</span>
              </p>
              <p className="flex justify-between">
                <span>{t('pos.serviceCharge', { rate: serviceChargeRate })}</span>
                <span>
                  {formatMoney(queuedOrder.totals.serviceChargeAmount, currency)}
                </span>
              </p>
              <p className="flex justify-between font-semibold">
                <span>{t('pos.total')}</span>
                <span>
                  {formatMoney(queuedOrder.totals.totalAmount, currency)}
                </span>
              </p>
            </div>
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={handlePrintQueuedReceipt}
              >
                {t('print.receiptButton')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('pos.payment')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 text-sm">
              <p className="flex justify-between">
                <span>{t('pos.paid')}</span>
                <span>{formatMoney(paidTotal, currency)}</span>
              </p>
              <p className="flex justify-between">
                <span>{t('pos.due')}</span>
                <span>{formatMoney(dueTotal, currency)}</span>
              </p>
              <p className="flex justify-between font-semibold">
                <span>{t('pos.balance')}</span>
                <span>{formatMoney(balanceTotal, currency)}</span>
              </p>
            </div>
            <form onSubmit={handleQueuedPayment} className="flex flex-col gap-4">
              <p className="text-sm font-medium">{t('pos.addPayment')}</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="queuedPaymentMethod">
                    {t('pos.paymentMethod')}
                  </Label>
                  <select
                    id="queuedPaymentMethod"
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
                  <Label htmlFor="queuedPaymentAmount">{t('pos.amount')}</Label>
                  <Input
                    id="queuedPaymentAmount"
                    type="number"
                    min={0}
                    step={0.01}
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="queuedPaymentReference">
                    {t('pos.reference')}
                  </Label>
                  <Input
                    id="queuedPaymentReference"
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
                  {t('offline.paymentQueued')}
                </p>
              )}
              <div>
                <Button type="submit">{t('pos.recordPayment')}</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button onClick={resetForNewOrder}>{t('pos.newOrder')}</Button>
        </div>
      </div>
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
            {selectedCustomer && (
              <p className="text-sm text-muted-foreground">
                {t('pos.customer')}: {selectedCustomer.name}
              </p>
            )}
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
              {Number(placedOrder.coupon_discount) > 0 && (
                <p className="flex justify-between">
                  <span>{t('pos.couponDiscount')}</span>
                  <span>
                    {formatMoney(Number(placedOrder.coupon_discount), currency)}
                  </span>
                </p>
              )}
              {Number(placedOrder.loyalty_discount) > 0 && (
                <p className="flex justify-between">
                  <span>
                    {t('pos.loyaltyDiscount')} (
                    {Number(placedOrder.loyalty_points_redeemed)}{' '}
                    {t('pos.points')})
                  </span>
                  <span>
                    {formatMoney(Number(placedOrder.loyalty_discount), currency)}
                  </span>
                </p>
              )}
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
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handlePrintReceipt()}
              >
                {t('print.receiptButton')}
              </Button>
            </div>
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
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!online && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
              {t('offline.badge')}
            </span>
          )}
          {cacheSavedAt && (
            <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-medium text-sky-900">
              {t(
                Date.now() - new Date(cacheSavedAt).getTime() >
                  24 * 60 * 60 * 1000
                  ? 'offline.cacheStale'
                  : 'offline.cacheNote',
                { time: new Date(cacheSavedAt).toLocaleString() },
              )}
            </span>
          )}
          {queueCounts(queueEntries).waiting > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setQueueOpen((value) => !value)}
            >
              {t('offline.waitingCount', {
                count: queueCounts(queueEntries).waiting,
              })}
            </Button>
          )}
          {queueCounts(queueEntries).failed > 0 && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => setQueueOpen((value) => !value)}
            >
              {t('offline.failedCount', {
                count: queueCounts(queueEntries).failed,
              })}
            </Button>
          )}
        </div>
      </header>

      {queueOpen && (
        <Card>
          <CardHeader>
            <CardTitle>{t('offline.queueTitle')}</CardTitle>
            <CardDescription>{t('offline.queueHint')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {queueEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('offline.queueEmpty')}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {queueEntries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-1 rounded-lg border p-3 text-sm"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {localRef(entry.id)} ·{' '}
                        {formatMoney(entry.totals.totalAmount, currency)}
                      </span>
                      <span>
                        {entry.status === 'failed'
                          ? t('offline.statusFailed')
                          : t('offline.statusWaiting')}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      {t('offline.queuedAt', {
                        time: new Date(entry.queuedAt).toLocaleString(),
                      })}{' '}
                      ·{' '}
                      {t('offline.itemsCount', {
                        count: entry.pricedLines.reduce(
                          (sum, line) => sum + line.quantity,
                          0,
                        ),
                      })}
                    </span>
                    {entry.status === 'failed' && (
                      <span className="text-destructive">
                        {t(
                          `offline.fail_${entry.failureReason ?? 'sync_failed'}`,
                        )}
                      </span>
                    )}
                    <span className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          window.dispatchEvent(
                            new Event(OFFLINE_QUEUE_UPDATED_EVENT),
                          )
                        }
                      >
                        {t('offline.syncNow')}
                      </Button>
                      {removingEntryId === entry.id ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              removeEntry(restaurant.id, entry.id)
                              setRemovingEntryId(null)
                            }}
                          >
                            {t('offline.confirmRemove')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setRemovingEntryId(null)}
                          >
                            {t('common.cancel')}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setRemovingEntryId(entry.id)}
                        >
                          {t('offline.remove')}
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

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
            {filteredProducts.map((product) => {
              const servable = availability.get(product.id)
              const outOfStock = servable === 0
              const lowStock =
                servable !== undefined && servable > 0 && servable <= 4
              return (
                <Button
                  key={product.id}
                  type="button"
                  variant="outline"
                  disabled={!product.is_available || outOfStock}
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
                  {outOfStock && (
                    <span className="text-xs font-medium text-destructive">
                      {t('pos.outOfStock')}
                    </span>
                  )}
                  {lowStock && (
                    <span className="text-xs font-medium text-amber-700">
                      {t('pos.onlyLeft', { count: servable })}
                    </span>
                  )}
                </Button>
              )
            })}
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
            {!online && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {t('offline.extrasDisabled')}
              </p>
            )}
            {online && (
              <>
            <div className="flex flex-col gap-2 border-t pt-3">
              <Label>{t('pos.customer')}</Label>
              {selectedCustomer ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {selectedCustomer.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {selectedCustomer.phone
                        ? `${selectedCustomer.phone} · `
                        : ''}
                      {t('pos.pointsBalance', {
                        points: customerBalance ?? 0,
                      })}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleClearCustomer}
                  >
                    {t('pos.clearCustomer')}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <Input
                      type="search"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void handleCustomerSearch()
                        }
                      }}
                      placeholder={t('pos.customerSearchPlaceholder')}
                      aria-label={t('pos.customerSearchPlaceholder')}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleCustomerSearch()}
                    >
                      {t('common.search')}
                    </Button>
                  </div>
                  {customerOptions.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {customerOptions.map((customer) => (
                        <li key={customer.id}>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-auto w-full justify-start whitespace-normal text-left"
                            onClick={() => void handleAttachCustomer(customer)}
                          >
                            {customer.name}
                            {customer.phone ? ` (${customer.phone})` : ''}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="couponCode">{t('pos.couponCode')}</Label>
              {appliedCoupon ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm">
                  <span className="font-medium">{appliedCoupon.code}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleClearCoupon}
                  >
                    {t('pos.clearCoupon')}
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    id="couponCode"
                    value={couponCode}
                    onChange={(e) =>
                      setCouponCode(e.target.value.toUpperCase())
                    }
                    placeholder={t('pos.couponCodePlaceholder')}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={couponApplying || !couponCode.trim()}
                    onClick={() => void handleApplyCoupon()}
                  >
                    {t('pos.applyCoupon')}
                  </Button>
                </div>
              )}
              {couponErrorKey && (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {t(couponErrorKey)}
                </p>
              )}
            </div>
            {selectedCustomer && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="redeemPoints">
                  {t('pos.redeemPoints')}
                </Label>
                <Input
                  id="redeemPoints"
                  type="text"
                  inputMode="numeric"
                  value={redeemPoints}
                  onChange={(e) => setRedeemPoints(e.target.value)}
                  placeholder={t('pos.redeemPointsPlaceholder', {
                    max: maxRedeemablePoints,
                  })}
                />
                <p className="text-xs text-muted-foreground">
                  {t('pos.pointsAvailable', {
                    balance: customerBalance ?? 0,
                    max: maxRedeemablePoints,
                    value: formatMoney(loyaltyRates.pointValue, currency),
                  })}
                </p>
              </div>
            )}
              </>
            )}
            <div className="flex flex-col gap-1 border-t pt-3 text-sm">
              <p className="flex justify-between">
                <span>{t('pos.subtotal')}</span>
                <span>{formatMoney(totals.subtotal, currency)}</span>
              </p>
              <p className="flex justify-between">
                <span>{t('pos.discount')}</span>
                <span>{formatMoney(totals.discountAmount, currency)}</span>
              </p>
              {totals.couponDiscount > 0 && (
                <p className="flex justify-between">
                  <span>
                    {t('pos.couponDiscount')}
                    {appliedCoupon ? ` (${appliedCoupon.code})` : ''}
                  </span>
                  <span>{formatMoney(totals.couponDiscount, currency)}</span>
                </p>
              )}
              {totals.loyaltyDiscount > 0 && (
                <p className="flex justify-between">
                  <span>
                    {t('pos.loyaltyDiscount')} ({redeemPointsEffective}{' '}
                    {t('pos.points')})
                  </span>
                  <span>{formatMoney(totals.loyaltyDiscount, currency)}</span>
                </p>
              )}
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
              {placing
                ? t('pos.placingOrder')
                : online
                  ? t('pos.placeOrder')
                  : t('offline.placeOffline')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
