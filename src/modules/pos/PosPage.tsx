// FoodX — POS page (order-taking screen).
// The client never decides prices: the cart preview is priced from the
// loaded catalog with the same computeOrderTotals() the server-side
// createOrder() uses, and placement sends only ids + quantities —
// services/pos.ts re-reads prices from the database before storing.
// Receipt printing (§62, Phase 7 Step 2A) prints the placed order
// from the summary card via lib/receipt + lib/print.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Mic, X } from 'lucide-react'
import EasyHelpLine from '@/components/EasyHelpLine'
import ProductImage from '@/components/ProductImage'
import LiveOrdersCarousel from '@/modules/pos/LiveOrdersCarousel'
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
  THIRD_PARTY_COMPANIES,
} from '@/services/pos'
import { fetchBranches, type Branch } from '@/services/restaurant'
import { fetchDeliveryZones } from '@/services/delivery'
import { fetchOrderDetail } from '@/services/orders'
import { fetchTables } from '@/services/tables'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useLicenseState } from '@/hooks/useLicenseState'
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
import { buildKitchenTicketHtml, buildReceiptHtml } from '@/lib/receipt'
import { loadPrintSettings } from '@/services/printSettings'
import { noteSelfPlacedOrder, playPaymentBlip } from '@/lib/sound'
import { isModuleOn } from '@/services/modules'
import { useEasyMode } from '@/hooks/useEasyMode'
import type {
  Category,
  Coupon,
  CreateOrderInput,
  Customer,
  DeliveryZone,
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
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** One cart line: ids + quantity only — prices are never stored here. */
interface CartLine {
  /** Stable row identity — the note editor keys off this, never the
   * content signature, so typing a note cannot remount the row. */
  id: string
  productId: string
  variantId: string | null
  modifierIds: string[]
  quantity: number
  /** Per-item kitchen note (gap 5); part of the merge signature. */
  note: string
}

/**
 * Saved in-progress cart (audit wave 3): the same ids-only shape as
 * the live cart, kept in localStorage per restaurant so a page
 * reload mid-order restores it. A draft is NOT an order — the
 * Phase 9 offline queue is the order pipeline; this only protects
 * the cart being keyed in.
 */
interface PosCartDraft {
  lines: CartLine[]
  orderType: OrderType
  tableId: string
}

function posCartDraftKey(restaurantId: string): string {
  return `foodx.pos_cart.${restaurantId}`
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

const EASY_PAYMENT_METHODS: PaymentMethod[] = ['cash', 'bkash', 'card']

const SELECT_CLASSNAME =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

const TEXTAREA_CLASSNAME =
  'flex w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm'

function cartKey(line: CartLine): string {
  return `${line.productId}|${line.variantId ?? ''}|${[...line.modifierIds].sort().join(',')}|${line.note.trim()}`
}

// Voice search (gap 9): the Web Speech API is not in the DOM lib
// types, so a minimal structural shape is declared here. Support
// is Chrome/Android — exactly the counter devices; where the API
// is absent the mic button simply never renders (no fake affordance).
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>
      }) => void)
    | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
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
  // Third-party (aggregator) entry, gap 1: within the delivery type
  // the worker picks our own delivery or an aggregator platform.
  const [deliveryChannel, setDeliveryChannel] = useState<'own' | 'third_party'>('own')
  const [thirdPartyCompany, setThirdPartyCompany] = useState<string>(THIRD_PARTY_COMPANIES[0])
  const [externalOrderId, setExternalOrderId] = useState('')
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const isThirdParty = orderType === 'delivery' && deliveryChannel === 'third_party'
  // Own-delivery orders carry the customer's contact + address on the
  // order row (the delivery board reads them from there). The zone is
  // optional: picking one charges that zone's fee.
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([])
  const [selectedZoneId, setSelectedZoneId] = useState('')
  const isOwnDelivery = orderType === 'delivery' && deliveryChannel === 'own'
  const selectedZone =
    deliveryZones.find((zone) => zone.id === selectedZoneId) ?? null
  const deliveryFee = isOwnDelivery ? Number(selectedZone?.fee ?? 0) : 0
  const [selectedTableId, setSelectedTableId] = useState('')
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceFailed, setVoiceFailed] = useState(false)
  const speechSupported =
    typeof window !== 'undefined' && getSpeechRecognitionCtor() !== null
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

  // Add feedback: which cart line / product the last add landed on,
  // plus a sequence number. The animation classes in index.css come
  // in -a/-b pairs picked by the sequence parity, so a rapid repeat
  // add restarts the keyframes instead of re-applying the same
  // class (which would not replay). `merged` marks an add that
  // incremented an existing line - its quantity number bounces.
  // `qty` is how many units the add carried; the tile chip shows
  // it as a +N badge.
  const [addFx, setAddFx] = useState<{
    lineId: string
    productId: string
    merged: boolean
    qty: number
    seq: number
  } | null>(null)

  const [placing, setPlacing] = useState(false)
  const [placeErrorKey, setPlaceErrorKey] = useState<string | null>(null)
  const { easy } = useEasyMode()
  const licenseView = useLicenseState()
  const licenseSuspended =
    licenseView.reason === 'client_suspended' ||
    licenseView.reason === 'suspended'

  const [placedOrder, setPlacedOrder] = useState<Order | null>(null)
  // Live-order carousel refresh signal: bumped whenever this page
  // places or pays an order, so the strip re-reads at once instead
  // of waiting for its 30 s poll.
  const [carouselSignal, setCarouselSignal] = useState(0)
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

  // Table id → name for the live-order carousel's card labels.
  const tableNames = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const table of tables) map[table.id] = table.name
    return map
  }, [tables])

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

  // Cart draft restore (audit wave 3): once the catalog has loaded,
  // bring back the cart that was in progress when the page was last
  // closed or reloaded. Lines whose product is no longer in the
  // catalog are dropped — the preview would skip them anyway, and a
  // stale row must never crash the page. Runs once per restaurant;
  // a failed catalog load leaves the saved draft untouched.
  const cartDraftForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!restaurant || !loaded || loadState !== 'ok') return
    if (cartDraftForRef.current === restaurant.id) return
    cartDraftForRef.current = restaurant.id
    try {
      const raw = localStorage.getItem(posCartDraftKey(restaurant.id))
      if (!raw) return
      const draft = JSON.parse(raw) as Partial<PosCartDraft>
      const catalogIds = new Set(products.map((product) => product.id))
      const lines: CartLine[] = []
      for (const line of Array.isArray(draft.lines) ? draft.lines : []) {
        if (!line || !catalogIds.has(line.productId)) continue
        lines.push({
          id: typeof line.id === 'string' ? line.id : crypto.randomUUID(),
          productId: line.productId,
          variantId:
            typeof line.variantId === 'string' ? line.variantId : null,
          modifierIds: Array.isArray(line.modifierIds)
            ? line.modifierIds.filter(
                (id): id is string => typeof id === 'string',
              )
            : [],
          quantity:
            Number.isFinite(line.quantity) && line.quantity > 0
              ? Math.floor(line.quantity)
              : 1,
          note: typeof line.note === 'string' ? line.note : '',
        })
      }
      if (lines.length === 0) return
      setCart(lines)
      if (draft.orderType && ORDER_TYPES.includes(draft.orderType)) {
        setOrderType(draft.orderType)
      }
      if (typeof draft.tableId === 'string') {
        setSelectedTableId(draft.tableId)
      }
    } catch {
      // A corrupt draft is ignored — the POS simply starts empty.
    }
  }, [restaurant, loaded, loadState, products])

  // Cart draft save: write on every cart change, but only after the
  // restore above has run for this restaurant (the initial empty
  // cart must not wipe a saved draft). An empty cart removes the
  // draft, so a successful placement, an offline queueing and the
  // New-order reset — all of which empty the cart — clear it too.
  useEffect(() => {
    if (!restaurant) return
    if (cartDraftForRef.current !== restaurant.id) return
    try {
      if (cart.length === 0) {
        localStorage.removeItem(posCartDraftKey(restaurant.id))
      } else {
        const draft: PosCartDraft = {
          lines: cart,
          orderType,
          tableId: selectedTableId,
        }
        localStorage.setItem(
          posCartDraftKey(restaurant.id),
          JSON.stringify(draft),
        )
      }
    } catch {
      // Storage full or blocked: the cart simply does not persist.
    }
  }, [cart, orderType, selectedTableId, restaurant])

  // Delivery zones for the zone picker. Best-effort and separate
  // from the catalog load above: zones only decorate delivery
  // orders, so a failure here just leaves the picker hidden.
  useEffect(() => {
    if (!restaurant) return
    let cancelled = false
    void (async () => {
      try {
        const zones = await fetchDeliveryZones(restaurant.id)
        if (!cancelled) {
          setDeliveryZones(zones.filter((zone) => zone.is_active))
        }
      } catch (error) {
        console.error('[POS] delivery zones load failed', error)
      }
    })()
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
        note: line.note || null,
        cartLineId: line.id,
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

  const loyaltyModuleOn = isModuleOn(settings, 'loyalty')
  // Easy Mode (item 9): the advanced strip (customer, coupon,
  // loyalty redeem, manual discount) is hidden — clear it when the
  // mode turns on so a hidden extra can never ride into an order.
  useEffect(() => {
    if (!easy) return
    setSelectedCustomer(null)
    setAppliedCoupon(null)
    setRedeemPoints('')
    setDiscount(0)
  }, [easy])
  const redeemPointsEffective = useMemo(() => {
    if (!loyaltyModuleOn) return 0
    const wanted = Number.parseInt(redeemPoints, 10)
    if (!Number.isFinite(wanted) || wanted <= 0) return 0
    return Math.min(wanted, maxRedeemablePoints)
  }, [redeemPoints, maxRedeemablePoints, loyaltyModuleOn])

  const loyaltyDiscount = useMemo(
    () => roundMoney(redeemPointsEffective * loyaltyRates.pointValue),
    [redeemPointsEffective, loyaltyRates],
  )

  const totals = useMemo(
    () =>
      computeOrderTotals(previewLines, discount, taxRate, serviceChargeRate, {
        couponDiscount,
        loyaltyDiscount,
        deliveryFee,
      }),
    [
      previewLines,
      discount,
      taxRate,
      serviceChargeRate,
      couponDiscount,
      loyaltyDiscount,
      deliveryFee,
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
      id: crypto.randomUUID(),
      productId: product.id,
      variantId,
      modifierIds: [...modifierIds].sort(),
      quantity,
      note: '',
    }
    const key = cartKey(line)
    const existing = cart.find((entry) => cartKey(entry) === key)
    setAddFx((prev) => ({
      lineId: existing ? existing.id : line.id,
      productId: product.id,
      merged: !!existing,
      qty: quantity,
      seq: (prev?.seq ?? 0) + 1,
    }))
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

  // Chooser popup: Escape closes it, exactly like Cancel, the X
  // button and a backdrop click - every close path is just
  // setChooserProduct(null); the next product tap re-seeds the
  // variant / modifier / quantity state in handleProductTap.
  useEffect(() => {
    if (!chooserProduct) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setChooserProduct(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [chooserProduct])

  const updateCartQty = (id: string, delta: number) => {
    if (delta > 0) {
      const bumped = cart.find((entry) => entry.id === id)
      if (bumped) {
        setAddFx((prev) => ({
          lineId: id,
          productId: bumped.productId,
          merged: true,
          qty: delta,
          seq: (prev?.seq ?? 0) + 1,
        }))
      }
    }
    setCart((prev) =>
      prev.map((line) =>
        line.id === id
          ? { ...line, quantity: Math.max(1, line.quantity + delta) }
          : line,
      ),
    )
  }

  const removeCartLine = (id: string) => {
    setCart((prev) => prev.filter((line) => line.id !== id))
  }

  useEffect(() => {
    if (!voiceFailed) return
    const id = window.setTimeout(() => setVoiceFailed(false), 4000)
    return () => window.clearTimeout(id)
  }, [voiceFailed])

  const handleVoiceSearch = () => {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) return
    setVoiceFailed(false)
    const recognition = new Ctor()
    recognition.lang = i18n.language?.startsWith('bn') ? 'bn-BD' : 'en-US'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript ?? ''
      if (transcript) setSearch(transcript)
    }
    recognition.onerror = () => setVoiceFailed(true)
    recognition.onend = () => setVoiceListening(false)
    setVoiceListening(true)
    try {
      recognition.start()
    } catch {
      setVoiceListening(false)
      setVoiceFailed(true)
    }
  }

  const updateCartNote = (id: string, note: string) => {
    setCart((prev) =>
      prev.map((line) => (line.id === id ? { ...line, note } : line)),
    )
  }

  const resetForNewOrder = () => {
    setPlacedOrder(null)
    setCarouselSignal((n) => n + 1)
    setAutoPrintBlocked(false)
    setQueuedOrder(null)
    setPlacedLines([])
    setPayments([])
    setCart([])
    setDiscount(0)
    setNotes('')
    setSelectedTableId('')
    setOrderType('dine_in')
    setDeliveryChannel('own')
    setExternalOrderId('')
    setGuestName('')
    setGuestPhone('')
    setDeliveryAddress('')
    setSelectedZoneId('')
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
    if (licenseSuspended) {
      setPlaceErrorKey('pos.licenseSuspended')
      return
    }
    if (cart.length === 0) {
      setPlaceErrorKey('pos.emptyOrder')
      return
    }
    if (orderType === 'dine_in' && !selectedTableId) {
      setPlaceErrorKey('pos.tableRequired')
      return
    }
    if (isThirdParty && !externalOrderId.trim()) {
      setPlaceErrorKey('pos.externalIdRequired')
      return
    }
    if (isOwnDelivery && (!guestPhone.trim() || !deliveryAddress.trim())) {
      setPlaceErrorKey('pos.deliveryDetailsRequired')
      return
    }
    const lines: PosOrderLineInput[] = cart.map((line) => ({
      productId: line.productId,
      variantId: line.variantId,
      modifierIds: line.modifierIds,
      quantity: line.quantity,
      note: line.note.trim() || undefined,
    }))
    const input: CreateOrderInput = {
      restaurantId: restaurant.id,
      branchId: defaultBranch?.id ?? null,
      tableId: orderType === 'dine_in' ? selectedTableId : null,
      // Aggregator orders are counter pickups by the platform rider:
      // stored as takeaway + source THIRD_PARTY, never dispatched on
      // the delivery board (gap 1 design).
      type: isThirdParty ? 'takeaway' : orderType,
      source: isThirdParty ? 'THIRD_PARTY' : undefined,
      externalOrderId: isThirdParty ? externalOrderId : undefined,
      thirdPartyCompany: isThirdParty ? thirdPartyCompany : undefined,
      customerName: isThirdParty || isOwnDelivery ? guestName : undefined,
      customerPhone: isThirdParty || isOwnDelivery ? guestPhone : undefined,
      deliveryAddress: isOwnDelivery ? deliveryAddress : undefined,
      deliveryZoneId: isOwnDelivery ? (selectedZone?.id ?? null) : undefined,
      deliveryFee: isOwnDelivery ? deliveryFee : undefined,
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
      // Sound effects (D7): this tab placed the order (queued under
      // its client UUID), so the watcher skips its arrival chime on
      // this device; its READY transition can still chime here.
      noteSelfPlacedOrder(entry.id)
      // Auto-print (item 11): the customer still gets a paper token
      // at the counter — the snapshot receipt (OFF- reference)
      // prints at queue time; nothing prints again at sync.
      if (loadPrintSettings(restaurant.id).autoReceipt) {
        if (!printSnapshotReceipt(entry)) setAutoPrintBlocked(true)
      }
      setPlacedLines(previewLines)
      setQueuedOrder(entry)
      setCart([])
      setDiscount(0)
      setNotes('')
      setDeliveryAddress('')
      setSelectedZoneId('')
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
        autoSendToKitchen: settings?.auto_send_to_kitchen === true,
      })
      setPlacedLines(previewLines)
      setPlacedOrder(order)
      // Sound effects (D7): self-placed — no arrival doorbell here.
      noteSelfPlacedOrder(order.id)
      setCarouselSignal((n) => n + 1)
      void autoPrintPlaced(order)
      setCart([])
      setDiscount(0)
      setNotes('')
      setDeliveryAddress('')
      setSelectedZoneId('')
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
        message === 'license_suspended'
          ? 'pos.licenseSuspended'
          : message === 'product_unavailable'
            ? 'pos.productUnavailable'
            : message === 'empty_order'
              ? 'pos.emptyOrder'
              : 'pos.placeFailed',
      )
    } finally {
      setPlacing(false)
    }
  }

  // Receipt print for any order — the placed-order card's Print
  // button and the live carousel's one-click payment share it.
  const printReceiptForOrder = async (target: Order) => {
    if (!restaurant) return
    try {
      const detail = await fetchOrderDetail(target.id)
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
          channelLine:
            detail.source === 'THIRD_PARTY'
              ? `${detail.third_party_company ?? ''} #${detail.external_order_id ?? ''}`
              : undefined,
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

  const handlePrintReceipt = async () => {
    if (!placedOrder) return
    await printReceiptForOrder(placedOrder)
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
      playPaymentBlip()
      setPaymentAttemptId(crypto.randomUUID())
      setCarouselSignal((n) => n + 1)
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

  // Easy Mode (item 9): one big button settles the exact balance in
  // cash — the common counter case, no form fields to fill.
  const handleEasyPaidInFull = async () => {
    if (!user || !placedOrder || !paymentSummary || paymentSummary.balance <= 0)
      return
    setPaymentErrorKey(null)
    setPaymentRecorded(false)
    setRecordingPayment(true)
    try {
      await recordPayment(
        placedOrder,
        {
          method: 'cash',
          amount: paymentSummary.balance,
          reference: '',
        },
        user.id,
        paymentAttemptId,
      )
      const loaded = await fetchOrderPayments(placedOrder.id)
      setPayments(loaded)
      setPaymentAmount('0')
      setPaymentReference('')
      setPaymentRecorded(true)
      playPaymentBlip()
      setPaymentAttemptId(crypto.randomUUID())
      setCarouselSignal((n) => n + 1)
    } catch (error) {
      console.error('[POS] easy paid-in-full failed', error)
      setPaymentErrorKey('pos.paymentFailed')
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

  const [autoPrintBlocked, setAutoPrintBlocked] = useState(false)

  const printSnapshotReceipt = (entry: QueuedOrder): boolean => {
    if (!restaurant) return false
    const detail: OrderDetail = {
      id: entry.id,
      restaurant_id: entry.restaurantId,
      branch_id: entry.input.branchId ?? null,
      table_id: entry.input.tableId ?? null,
      order_number: 0,
      type: entry.input.type,
      source: entry.input.source ?? 'POS',
      external_order_id: entry.input.externalOrderId ?? null,
      third_party_company: entry.input.thirdPartyCompany ?? null,
      token_number: null,
      token_day: null,
      merged_into_id: null,
      status: 'CONFIRMED',
      subtotal: entry.totals.subtotal,
      discount_amount: entry.totals.discountAmount,
      tax_amount: entry.totals.taxAmount,
      service_charge_amount: entry.totals.serviceChargeAmount,
      total_amount: entry.totals.totalAmount,
      delivery_fee:
        entry.input.type === 'delivery' ? (entry.input.deliveryFee ?? 0) : 0,
      delivery_zone_id: entry.input.deliveryZoneId ?? null,
      customer_id: null,
      customer_name: entry.input.customerName ?? null,
      customer_phone: entry.input.customerPhone ?? null,
      delivery_address: entry.input.deliveryAddress ?? null,
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
        note: line.note?.trim() || null,
        kitchen_status: 'PENDING',
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
        channelLine:
          detail.source === 'THIRD_PARTY'
            ? `${detail.third_party_company ?? ''} #${detail.external_order_id ?? ''}`
            : undefined,
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
    return printHtml(title, html, css)
  }

  const handlePrintQueuedReceipt = () => {
    if (!queuedOrder) return
    printSnapshotReceipt(queuedOrder)
  }

  // Auto-print (item 11): after a successful placement, open the
  // print flow for the receipt (and kitchen ticket) when this
  // device has it enabled. Best-effort only — the order is already
  // placed; a blocked popup just leaves a note on the placed card.
  const autoPrintPlaced = async (order: Order) => {
    if (!restaurant) return
    const printSettings = loadPrintSettings(restaurant.id)
    if (!printSettings.autoReceipt && !printSettings.autoKitchen) return
    try {
      const detail = await fetchOrderDetail(order.id)
      const branch =
        branches.find((b) => b.id === detail.branch_id) ?? defaultBranch
      const table = tables.find((tb) => tb.id === detail.table_id)
      const ctx = {
        restaurantName: settings?.branding_name || restaurant.name,
        logoUrl: settings?.logo_url ?? null,
        branchName: branch?.name ?? null,
        branchAddress: branch?.address ?? null,
        branchPhone: branch?.phone ?? null,
        tableName: table?.name ?? null,
        footer: settings?.receipt_footer ?? null,
        channelLine:
          detail.source === 'THIRD_PARTY'
            ? `${detail.third_party_company ?? ''} #${detail.external_order_id ?? ''}`
            : undefined,
      }
      const labels = {
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
      let blocked = false
      if (printSettings.autoReceipt) {
        const receipt = buildReceiptHtml(
          detail,
          ctx,
          labels,
          (n) => formatMoney(n, currency),
          (method) => t(PAYMENT_METHOD_KEYS[method as PaymentMethod]),
        )
        blocked = !printHtml(receipt.title, receipt.html, receipt.css)
      }
      if (printSettings.autoKitchen) {
        const ticket = buildKitchenTicketHtml(detail, ctx, labels)
        const printTicket = () => {
          if (!printHtml(ticket.title, ticket.html, ticket.css)) {
            setAutoPrintBlocked(true)
          }
        }
        // A beat between the two windows so both survive popup rules.
        if (printSettings.autoReceipt) {
          window.setTimeout(printTicket, 800)
        } else {
          printTicket()
        }
      }
      if (blocked) setAutoPrintBlocked(true)
    } catch {
      // Printing is best-effort; the order itself is unaffected.
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
            {autoPrintBlocked && (
              <span className="block text-amber-600 dark:text-amber-400">
                {t('pos.autoPrintBlocked')}
              </span>
            )}
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
                    {line.note ? (
                      <span className="block text-xs font-medium text-amber-700">
                        {line.note}
                      </span>
                    ) : null}
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
                    {(easy ? EASY_PAYMENT_METHODS : PAYMENT_METHODS).map((method) => (
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
            {autoPrintBlocked && (
              <p className="mt-1 text-sm font-normal text-amber-600 dark:text-amber-400">
                {t('pos.autoPrintBlocked')}
              </p>
            )}
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
                    {line.note ? (
                      <span className="block text-xs font-medium text-amber-700">
                        {line.note}
                      </span>
                    ) : null}
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
              {Number(placedOrder.delivery_fee) > 0 && (
                <p className="flex justify-between">
                  <span>{t('pos.deliveryFee')}</span>
                  <span>
                    {formatMoney(Number(placedOrder.delivery_fee), currency)}
                  </span>
                </p>
              )}
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
            {easy && paymentSummary && paymentSummary.balance > 0 && (
              <Button
                type="button"
                size="lg"
                className="mb-4 w-full text-base"
                onClick={() => void handleEasyPaidInFull()}
                disabled={recordingPayment}
              >
                {t('pos.paidInFull', {
                  amount: formatMoney(paymentSummary.balance, currency),
                })}
              </Button>
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
                    {(easy ? EASY_PAYMENT_METHODS : PAYMENT_METHODS).map((method) => (
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
    <div
      className={`flex flex-col gap-6 ${
        previewLines.length > 0 ? 'pb-24 lg:pb-28' : ''
      }`}
    >
      <header>
        <h2 className="text-2xl font-bold tracking-tight">{t('pos.title')}</h2>
        <p className="text-muted-foreground">{t('pos.subtitle')}</p>
        <EasyHelpLine labelKey="easy.help.pos" />
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

      {restaurant && user && (
        <LiveOrdersCarousel
          restaurantId={restaurant.id}
          userId={user.id}
          currency={currency}
          tableNames={tableNames}
          refreshSignal={carouselSignal}
          onPrintReceipt={printReceiptForOrder}
        />
      )}

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
          {orderType === 'delivery' && (
            <div className="flex flex-col gap-2">
              <Label>{t('pos.deliveryChannel')}</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant={deliveryChannel === 'own' ? 'default' : 'outline'}
                  onClick={() => setDeliveryChannel('own')}
                >
                  {t('pos.channelOwn')}
                </Button>
                <Button
                  type="button"
                  variant={deliveryChannel === 'third_party' ? 'default' : 'outline'}
                  onClick={() => setDeliveryChannel('third_party')}
                >
                  {t('pos.channelThirdParty')}
                </Button>
              </div>
              {isThirdParty && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="tp-company">{t('pos.thirdPartyCompany')}</Label>
                    <select
                      id="tp-company"
                      value={thirdPartyCompany}
                      onChange={(e) => setThirdPartyCompany(e.target.value)}
                      className={SELECT_CLASSNAME}
                    >
                      {THIRD_PARTY_COMPANIES.map((company) => (
                        <option key={company} value={company}>
                          {company}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="tp-external-id">{t('pos.externalOrderId')}</Label>
                    <Input
                      id="tp-external-id"
                      value={externalOrderId}
                      onChange={(e) => setExternalOrderId(e.target.value)}
                      placeholder={t('pos.externalOrderIdPlaceholder')}
                      maxLength={64}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="tp-guest-name">{t('pos.guestName')}</Label>
                      <Input
                        id="tp-guest-name"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        maxLength={120}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="tp-guest-phone">{t('pos.guestPhone')}</Label>
                      <Input
                        id="tp-guest-phone"
                        value={guestPhone}
                        onChange={(e) => setGuestPhone(e.target.value)}
                        maxLength={32}
                      />
                    </div>
                  </div>
                </div>
              )}
              {isOwnDelivery && (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="dlv-guest-name">{t('pos.guestName')}</Label>
                      <Input
                        id="dlv-guest-name"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        maxLength={120}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="dlv-guest-phone">{t('pos.guestPhone')}</Label>
                      <Input
                        id="dlv-guest-phone"
                        value={guestPhone}
                        onChange={(e) => setGuestPhone(e.target.value)}
                        maxLength={32}
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="dlv-address">{t('pos.deliveryAddress')}</Label>
                    <textarea
                      id="dlv-address"
                      value={deliveryAddress}
                      onChange={(e) => setDeliveryAddress(e.target.value)}
                      placeholder={t('pos.deliveryAddressPlaceholder')}
                      maxLength={500}
                      rows={2}
                      className={TEXTAREA_CLASSNAME}
                    />
                  </div>
                  {deliveryZones.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="dlv-zone">{t('pos.deliveryZone')}</Label>
                      <select
                        id="dlv-zone"
                        value={selectedZoneId}
                        onChange={(e) => setSelectedZoneId(e.target.value)}
                        className={SELECT_CLASSNAME}
                      >
                        <option value="">{t('pos.deliveryZoneNone')}</option>
                        {deliveryZones.map((zone) => (
                          <option key={zone.id} value={zone.id}>
                            {zone.name} ({formatMoney(Number(zone.fee), currency)})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
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
          <div className="flex items-center gap-2">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('pos.searchProducts')}
              aria-label={t('pos.searchProducts')}
              className="flex-1"
            />
            {speechSupported && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleVoiceSearch}
                disabled={voiceListening}
                aria-label={t('pos.voiceSearch')}
              >
                <Mic
                  className={
                    voiceListening
                      ? 'size-4 animate-pulse text-red-600'
                      : 'size-4'
                  }
                />
              </Button>
            )}
          </div>
          {voiceFailed && (
            <p className="text-xs text-muted-foreground">
              {t('pos.voiceFailed')}
            </p>
          )}
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

          <div
            className={
              easy
                ? 'grid grid-cols-2 gap-3 sm:grid-cols-2'
                : 'grid grid-cols-2 gap-2 sm:grid-cols-2 xl:grid-cols-3'
            }
          >
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
                  className={`relative h-full flex-col items-stretch justify-start gap-0 overflow-hidden whitespace-normal p-0 text-left${
                    addFx && addFx.productId === product.id
                      ? ` pos-tile-pop-${addFx.seq % 2 === 0 ? 'a' : 'b'}`
                      : ''
                  }`}
                >
                  <ProductImage src={product.image_url} />
                  <span
                    className={
                      easy
                        ? 'flex flex-1 flex-col items-start gap-1 p-5 pt-3'
                        : 'flex flex-1 flex-col items-start gap-1 p-4 pt-3'
                    }
                  >
                    <span className={easy ? 'text-lg font-semibold' : 'font-medium'}>
                      {displayName(product.name, product.name_bn)}
                    </span>
                    <span
                      className={
                        easy
                          ? 'text-base text-muted-foreground'
                          : 'text-sm text-muted-foreground'
                      }
                    >
                      {formatMoney(Number(product.price), currency)}
                    </span>
                    <span className="min-h-4">
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
                    </span>
                  </span>
                  {addFx && addFx.productId === product.id && (
                    <span
                      key={addFx.seq}
                      aria-hidden="true"
                      className={`pos-chip-pop-${
                        addFx.seq % 2 === 0 ? 'a' : 'b'
                      } pointer-events-none absolute top-2 right-2 z-10 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground shadow-md`}
                    >
                      +{addFx.qty}
                    </span>
                  )}
                </Button>
              )
            })}
          </div>
        </div>

        <Card>
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
                  const key =
                    line.cartLineId ??
                    `${line.productId}|${line.variantId ?? ''}|${line.modifierIds.join(',')}`
                  return (
                    <li
                      key={key}
                      className={`flex flex-col gap-1 text-sm${
                        addFx && addFx.lineId === key
                          ? ` pos-line-flash-${
                              addFx.seq % 2 === 0 ? 'a' : 'b'
                            }`
                          : ''
                      }`}
                    >
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
                        <span
                          className={`min-w-6 text-center${
                            addFx && addFx.lineId === key && addFx.merged
                              ? ` pos-qty-bounce-${
                                  addFx.seq % 2 === 0 ? 'a' : 'b'
                                }`
                              : ''
                          }`}
                        >
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
                      <Input
                        value={line.note ?? ''}
                        onChange={(e) => updateCartNote(key, e.target.value)}
                        placeholder={t('pos.itemNotePlaceholder')}
                        maxLength={200}
                        className="h-8 text-xs"
                      />
                    </li>
                  )
                })}
              </ul>
            )}
            {!easy && (
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
            )}
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
            {online && !easy && (
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
            {selectedCustomer && loyaltyModuleOn && (
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
              {deliveryFee > 0 && (
                <p className="flex justify-between">
                  <span>{t('pos.deliveryFee')}</span>
                  <span>{formatMoney(deliveryFee, currency)}</span>
                </p>
              )}
              <p className="flex justify-between font-semibold">
                <span>{t('pos.total')}</span>
                <span
                  className={
                    addFx
                      ? `pos-total-pulse-${addFx.seq % 2 === 0 ? 'a' : 'b'}`
                      : undefined
                  }
                >
                  {formatMoney(totals.totalAmount, currency)}
                </span>
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
            {licenseSuspended && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {t('pos.licenseSuspended')}
              </p>
            )}
            <Button
              type="button"
              onClick={() => void handlePlaceOrder()}
              disabled={placing || licenseSuspended}
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

      {previewLines.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:inset-x-auto lg:right-8 lg:bottom-6 lg:w-[360px] lg:rounded-xl lg:border lg:pt-4 lg:pb-4 lg:shadow-lg">
          <span className="text-sm">
            {t('pos.total')}:{' '}
            <span
              className={`font-semibold${
                addFx
                  ? ` pos-total-pulse-${addFx.seq % 2 === 0 ? 'a' : 'b'}`
                  : ''
              }`}
            >
              {formatMoney(totals.totalAmount, currency)}
            </span>
          </span>
          <Button
            type="button"
            onClick={() => void handlePlaceOrder()}
            disabled={placing || licenseSuspended}
          >
            {placing
              ? t('pos.placingOrder')
              : online
                ? t('pos.placeOrder')
                : t('offline.placeOffline')}
          </Button>
        </div>
      )}
      {chooserProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={displayName(chooserProduct.name, chooserProduct.name_bn)}
          onClick={() => setChooserProduct(null)}
        >
          <Card
            className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHeader>
              <CardTitle>
                {displayName(chooserProduct.name, chooserProduct.name_bn)}
              </CardTitle>
              <CardAction>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setChooserProduct(null)}
                  aria-label={t('common.close')}
                >
                  <X className="size-4" />
                </Button>
              </CardAction>
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
        </div>
      )}
    </div>
  )
}
