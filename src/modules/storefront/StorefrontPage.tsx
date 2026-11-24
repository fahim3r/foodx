// FoodX — public storefront (Phase 5).
// No login, no app layout, no router: the host decides which restaurant
// this is (its own domain, or ?store=<slug> on the platform host) and
// this page renders that restaurant's menu + online ordering.
//
// THE RULE (same as the POS): the client never decides prices. The cart
// preview is priced from the loaded catalog with computeOrderTotals(),
// and placement sends only ids + quantities — place_online_order()
// re-reads every price from the database and computes the totals itself.
// Payment happens at the restaurant (v1 takes no payment online); the
// confirmation screen shows the live order status, polled every 30s.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import { formatMoney, roundMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  fetchStorefront,
  fetchStorefrontAvailability,
  fetchStorefrontMenu,
  fetchPublicZones,
  getOnlineOrderStatus,
  placeOnlineOrder,
} from '@/services/storefront'
import { computeOrderTotals, type PricedLine } from '@/services/pos'
import {
  requestWaiterCall,
  resolveTableIdByCode,
  waiterCallPending,
} from '@/services/waiterCalls'
import {
  isFeatureEnabledFromCache,
  isSuspendedFromCache,
} from '@/services/heartbeat'
import {
  TERMINAL_ORDER_STATUSES,
  type Category,
  type DeliveryZone,
  type OnlineOrderStatus,
  type OrderStatus,
  type OrderType,
  type ProductWithDetails,
  type StorefrontInfo,
} from '@/types'
import { Button } from '@/components/ui/button'
import ProductImage from '@/components/ProductImage'
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

const ONLINE_ORDER_ERRORS = new Set([
  'unknown_restaurant',
  'invalid_delivery_type',
  'customer_required',
  'empty_order',
  'invalid_item',
  'table_not_found',
  'delivery_not_available',
  'delivery_address_required',
  'min_order_not_met',
])

function cartKey(line: CartLine): string {
  return `${line.productId}|${line.variantId ?? ''}|${[...line.modifierIds].sort().join(',')}`
}

function LanguageToggle() {
  const { i18n, t } = useTranslation()
  const current = i18n.language?.startsWith('bn') ? 'bn' : 'en'
  const switchTo = (lng: 'en' | 'bn') => {
    void i18n.changeLanguage(lng)
    try {
      window.localStorage.setItem('foodx.language', lng)
    } catch {
      // Storage unavailable — the switch still applies for this session.
    }
  }
  return (
    <div
      className="flex rounded-md border p-0.5"
      role="group"
      aria-label={t('common.language')}
    >
      {(
        [
          { code: 'en', label: 'EN' },
          { code: 'bn', label: 'বাং' },
        ] as const
      ).map(({ code, label }) => (
        <button
          key={code}
          type="button"
          onClick={() => switchTo(code)}
          aria-pressed={current === code}
          className={cn(
            'rounded px-2 py-1 text-xs font-medium transition-colors',
            current === code
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

interface PlacedOrder {
  orderNumber: number
  tokenNumber: number | null
  total: number
  tableName: string | null
  status: OrderStatus
  /** The type the order was actually placed as (kiosk = pickup). */
  type: OrderType
}

/**
 * The last order placed on this device (audit wave 2). Remembered so
 * a customer who left the confirmation can still track it: the
 * tracking form pre-fills from this, and the token — which
 * get_online_order_status does NOT return (status + total only) —
 * can still be shown when the lookup matches this order.
 */
interface LastOrderMemory {
  orderNumber: number
  phone: string
  tokenNumber: number | null
}

function readLastOrder(slug: string): LastOrderMemory | null {
  try {
    const raw = window.localStorage.getItem(`foodx.lastOrder.${slug}`)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastOrderMemory>
    if (
      typeof parsed.orderNumber !== 'number' ||
      typeof parsed.phone !== 'string'
    ) {
      return null
    }
    return {
      orderNumber: parsed.orderNumber,
      phone: parsed.phone,
      tokenNumber:
        typeof parsed.tokenNumber === 'number' ? parsed.tokenNumber : null,
    }
  } catch {
    return null
  }
}

function writeLastOrder(slug: string, value: LastOrderMemory): void {
  try {
    window.localStorage.setItem(
      `foodx.lastOrder.${slug}`,
      JSON.stringify(value),
    )
  } catch {
    // Storage unavailable — tracking still works with manual entry.
  }
}

/** Call-waiter "notified" memory (migration 0038): this device has
 * an open call at this table, so a reload keeps the button in its
 * notified state instead of offering a duplicate tap. The server
 * stays the truth — the page polls waiter_call_pending and clears
 * this the moment staff attend. */
function waiterCallKey(restaurantId: string, tableCode: string): string {
  return `foodx.waiterCall.${restaurantId}.${tableCode}`
}

function readWaiterNotified(restaurantId: string, tableCode: string): boolean {
  try {
    return window.localStorage.getItem(waiterCallKey(restaurantId, tableCode)) === '1'
  } catch {
    return false
  }
}

function writeWaiterNotified(
  restaurantId: string,
  tableCode: string,
  notified: boolean,
): void {
  try {
    if (notified) {
      window.localStorage.setItem(waiterCallKey(restaurantId, tableCode), '1')
    } else {
      window.localStorage.removeItem(waiterCallKey(restaurantId, tableCode))
    }
  } catch {
    // Storage unavailable — the button state just won't survive a reload.
  }
}

export default function StorefrontPage({
  slug,
  tableCode,
}: {
  slug: string
  tableCode?: string | null
}) {
  const { t, i18n } = useTranslation()
  const [info, setInfo] = useState<StorefrontInfo | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<ProductWithDetails[]>([])
  const [availability, setAvailability] = useState<Map<string, number>>(
    new Map(),
  )
  const [pageState, setPageState] = useState<
    'loading' | 'ready' | 'notFound' | 'failed'
  >('loading')

  const [selectedCategoryId, setSelectedCategoryId] =
    useState<string>('all')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])

  const [chooserProduct, setChooserProduct] =
    useState<ProductWithDetails | null>(null)
  const [chooserVariantId, setChooserVariantId] = useState<string | null>(null)
  const [chooserModifierIds, setChooserModifierIds] = useState<string[]>([])
  const [chooserQty, setChooserQty] = useState(1)

  const [deliveryType, setDeliveryType] = useState<OrderType>(
    tableCode ? 'dine_in' : 'pickup',
  )
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [zones, setZones] = useState<DeliveryZone[]>([])
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null)
  const [placing, setPlacing] = useState(false)
  const [placeErrorKey, setPlaceErrorKey] = useState<string | null>(null)
  const [placed, setPlaced] = useState<PlacedOrder | null>(null)

  // Call waiter (migration 0038): only in a table context (the
  // ?table= QR flow). The storefront knows the table by its QR code
  // alone, so the id is resolved once through resolve_table_by_code;
  // the button renders only after a table actually resolved.
  const [waiterTableId, setWaiterTableId] = useState<string | null>(null)
  const [waiterNotified, setWaiterNotified] = useState(false)
  const [waiterCalling, setWaiterCalling] = useState(false)
  const [waiterCallFailed, setWaiterCallFailed] = useState(false)

  // Order tracking (audit wave 2): after leaving the confirmation a
  // customer re-checks a status with order number + phone — the same
  // pair get_online_order_status already validates server-side.
  const [trackingOpen, setTrackingOpen] = useState(false)
  const [trackOrderNumber, setTrackOrderNumber] = useState('')
  const [trackPhone, setTrackPhone] = useState('')
  const [trackState, setTrackState] = useState<
    'idle' | 'searching' | 'found' | 'notFound' | 'failed'
  >('idle')
  const [trackResult, setTrackResult] = useState<OnlineOrderStatus | null>(
    null,
  )
  const [trackToken, setTrackToken] = useState<number | null>(null)

  // Self-KIOSK mode (modifications v2, item 2): ?kiosk=1 turns this
  // storefront into a counter tablet — pickup only, oversized
  // tiles, no login/footer links, and a big-token confirmation
  // that resets itself for the next customer. The flag sticks in
  // sessionStorage so a reload does not drop out of kiosk mode;
  // leaving is a deliberate long-press on the header brand.
  const [kiosk] = useState<boolean>(() => {
    try {
      if (
        new URLSearchParams(window.location.search).get('kiosk') === '1'
      ) {
        sessionStorage.setItem('foodx.kiosk', '1')
        return true
      }
      return sessionStorage.getItem('foodx.kiosk') === '1'
    } catch {
      return false
    }
  })
  const [kioskExitArmed, setKioskExitArmed] = useState(false)
  const brandPressTimer = useRef<number | null>(null)

  const resetKiosk = useCallback(() => {
    setPlaced(null)
    setCustomerName('')
    setCustomerPhone('')
    setDeliveryAddress('')
  }, [])

  const exitKiosk = () => {
    try {
      sessionStorage.removeItem('foodx.kiosk')
    } catch {
      // ignore — navigation below still leaves kiosk mode
    }
    const url = new URL(window.location.href)
    url.searchParams.delete('kiosk')
    window.location.assign(url.toString())
  }

  const isBn = i18n.language === 'bn'
  const taxRate = Number(info?.tax_rate ?? 0)
  const serviceChargeRate = Number(info?.service_charge_rate ?? 0)
  const currency = info?.currency ?? info?.default_currency ?? 'BDT'
  const deliveryEnabled = info?.delivery_enabled ?? false
  const deliveryFee = Number(info?.delivery_fee ?? 0)
  const minOrder = Number(info?.min_order_amount ?? 0)
  // Zone picker (migration 0012): when the restaurant has zones, the
  // selected zone's fee + minimum replace the settings values below.
  const selectedZone =
    zones.find((zone) => zone.id === selectedZoneId) ?? null
  const effectiveDeliveryFee = selectedZone
    ? Number(selectedZone.fee)
    : deliveryFee
  const effectiveMinOrder = selectedZone
    ? Number(selectedZone.min_order_amount)
    : minOrder
  const displayName = info?.branding_name?.trim() || info?.name || slug
  const tableDisplayName = tableCode
    ? tableCode.startsWith(`${slug}-`)
      ? tableCode.slice(slug.length + 1)
      : tableCode
    : null
  // The staff login is /panel on every host now — on the platform
  // hosts the admin moved from / to /panel, and on a restaurant domain
  // it was /panel already.
  const loginHref = '/panel'

  // Load the restaurant + menu (public data, no login).
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setPageState('loading')
      try {
        const loadedInfo = await fetchStorefront(slug)
        if (cancelled) return
        if (!loadedInfo) {
          setPageState('notFound')
          return
        }
        const [menu, loadedAvailability, loadedZones] = await Promise.all([
          fetchStorefrontMenu(loadedInfo.restaurant_id),
          fetchStorefrontAvailability(loadedInfo.restaurant_id),
          fetchPublicZones(loadedInfo.restaurant_id).catch(
            () => [] as DeliveryZone[],
          ),
        ])
        if (cancelled) return
        setInfo(loadedInfo)
        setCategories(menu.categories)
        setProducts(menu.products)
        setAvailability(loadedAvailability)
        setZones(loadedZones)
        setSelectedZoneId(loadedZones[0]?.id ?? null)
        setPageState('ready')
      } catch (error) {
        console.error('[Storefront] load failed', error)
        if (!cancelled) setPageState('failed')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [slug])

  const displayNameOf = useCallback(
    (name: string, nameBn: string | null): string =>
      isBn && nameBn ? nameBn : name,
    [isBn],
  )

  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  )

  // Live preview: price every cart line from the loaded catalog, using
  // the same totals function the server-side placement uses.
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
        productName: product.name,
        variantName: variant?.name ?? null,
        modifierNames: chosenModifiers.map((m) => ({
          id: m.id,
          name: m.name,
          price: Number(m.price),
        })),
        unitPrice,
        lineTotal: roundMoney(unitPrice * line.quantity),
        note: null,
      })
    }
    return lines
  }, [cart, productById])

  const totals = useMemo(
    () =>
      computeOrderTotals(previewLines, 0, taxRate, serviceChargeRate),
    [previewLines, taxRate, serviceChargeRate],
  )
  const deliveryFeeCharged =
    deliveryType === 'delivery' ? roundMoney(effectiveDeliveryFee) : 0
  const grandTotal = roundMoney(totals.totalAmount + deliveryFeeCharged)
  const activeMinOrder =
    deliveryType === 'delivery' ? effectiveMinOrder : minOrder
  const minOrderShort =
    activeMinOrder > 0 &&
    (deliveryType === 'delivery' || deliveryType === 'pickup') &&
    totals.subtotal < activeMinOrder

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase()
    return products.filter((product) => {
      if (selectedCategoryId !== 'all' && product.category_id !== selectedCategoryId) {
        return false
      }
      if (query) {
        const haystack = `${product.name} ${product.name_bn ?? ''} ${product.description ?? ''}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      return true
    })
  }, [products, selectedCategoryId, search])

  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0)

  const addToCart = useCallback((line: CartLine) => {
    setCart((prev) => {
      const key = cartKey(line)
      const existing = prev.find((l) => cartKey(l) === key)
      if (existing) {
        return prev.map((l) =>
          cartKey(l) === key
            ? { ...l, quantity: l.quantity + line.quantity }
            : l,
        )
      }
      return [...prev, line]
    })
  }, [])

  const setLineQty = useCallback((line: CartLine, quantity: number) => {
    setCart((prev) =>
      quantity <= 0
        ? prev.filter((l) => cartKey(l) !== cartKey(line))
        : prev.map((l) =>
            cartKey(l) === cartKey(line) ? { ...l, quantity } : l,
          ),
    )
  }, [])

  const openChooser = (product: ProductWithDetails) => {
    if (product.variants.length === 0 && product.modifiers.length === 0) {
      addToCart({
        productId: product.id,
        variantId: null,
        modifierIds: [],
        quantity: 1,
      })
      return
    }
    setChooserProduct(product)
    // No variant pre-selected: the base product is a valid choice, exactly
    // like the POS chooser (which offers a "No variant" radio). Pre-selecting
    // variants[0] made the base price unreachable on the storefront.
    setChooserVariantId(null)
    setChooserModifierIds([])
    setChooserQty(1)
  }

  const addChooserToCart = () => {
    if (!chooserProduct) return
    addToCart({
      productId: chooserProduct.id,
      variantId: chooserVariantId,
      modifierIds: chooserModifierIds,
      quantity: chooserQty,
    })
    setChooserProduct(null)
  }

  // Live order status after placement: poll every 30s until terminal.
  useEffect(() => {
    if (!placed || TERMINAL_ORDER_STATUSES.includes(placed.status)) return
    const timer = window.setInterval(() => {
      void getOnlineOrderStatus(slug, placed.orderNumber, customerPhone)
        .then((status) => {
          if (status) {
            setPlaced((prev) =>
              prev ? { ...prev, status: status.status } : prev,
            )
          }
        })
        .catch((error: unknown) =>
          console.error('[Storefront] status poll failed', error),
        )
    }, 30000)
    return () => window.clearInterval(timer)
    // customerPhone is read at placement time and does not change while
    // polling; slug + order number identify the order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, slug])

  // Kiosk: the confirmation resets itself after 8s so the next
  // customer starts from a clean menu (the timer only arms AFTER
  // an order is placed — never during checkout).
  useEffect(() => {
    if (!kiosk || !placed) return
    const timer = window.setTimeout(resetKiosk, 8000)
    return () => window.clearTimeout(timer)
  }, [kiosk, placed, resetKiosk])

  // Call waiter: resolve the QR table code to its table id once the
  // restaurant is known, then sync the button with the server (a
  // call may already be pending from another phone at this table).
  useEffect(() => {
    if (!info || !tableCode) return
    const restaurantId = info.restaurant_id
    const code = tableCode
    let cancelled = false
    void (async () => {
      try {
        const tableId = await resolveTableIdByCode(restaurantId, code)
        if (cancelled || !tableId) return
        setWaiterTableId(tableId)
        const remembered = readWaiterNotified(restaurantId, code)
        const pending = await waiterCallPending(restaurantId, tableId)
          .catch(() => remembered)
        if (cancelled) return
        setWaiterNotified(pending)
        writeWaiterNotified(restaurantId, code, pending)
      } catch {
        // No resolution, no button — the menu itself is unaffected.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [info, tableCode])

  // While this table's call is open, poll until staff attend it;
  // then the button quietly becomes available again.
  useEffect(() => {
    if (!info || !tableCode || !waiterTableId || !waiterNotified) return
    const restaurantId = info.restaurant_id
    const code = tableCode
    const timer = window.setInterval(() => {
      void waiterCallPending(restaurantId, waiterTableId)
        .then((pending) => {
          if (!pending) {
            setWaiterNotified(false)
            writeWaiterNotified(restaurantId, code, false)
          }
        })
        .catch(() => undefined)
    }, 15000)
    return () => window.clearInterval(timer)
  }, [info, tableCode, waiterTableId, waiterNotified])

  const handleCallWaiter = async () => {
    if (!info || !tableCode || !waiterTableId || waiterNotified || waiterCalling) {
      return
    }
    setWaiterCalling(true)
    setWaiterCallFailed(false)
    try {
      await requestWaiterCall(info.restaurant_id, waiterTableId)
      setWaiterNotified(true)
      writeWaiterNotified(info.restaurant_id, tableCode, true)
    } catch {
      setWaiterCallFailed(true)
    } finally {
      setWaiterCalling(false)
    }
  }

  const runTrackingLookup = useCallback(
    async (orderNumberText: string, phone: string) => {
      const orderNumber = Number.parseInt(orderNumberText, 10)
      if (
        !Number.isFinite(orderNumber) ||
        orderNumber <= 0 ||
        !phone.trim()
      ) {
        setTrackResult(null)
        setTrackToken(null)
        setTrackState('notFound')
        return
      }
      setTrackState('searching')
      try {
        const result = await getOnlineOrderStatus(slug, orderNumber, phone)
        if (!result) {
          setTrackResult(null)
          setTrackToken(null)
          setTrackState('notFound')
          return
        }
        // The status RPC returns status + total only; the token is
        // shown when this lookup is the order remembered from
        // placement on this device.
        const memory = readLastOrder(slug)
        setTrackToken(
          memory &&
            memory.orderNumber === orderNumber &&
            memory.phone === phone.trim()
            ? memory.tokenNumber
            : null,
        )
        setTrackResult(result)
        setTrackState('found')
      } catch (error) {
        console.error('[Storefront] tracking lookup failed', error)
        setTrackResult(null)
        setTrackToken(null)
        setTrackState('failed')
      }
    },
    [slug],
  )

  const openTracking = useCallback(
    (prefill?: { orderNumber: number; phone: string }) => {
      const memory = readLastOrder(slug)
      const numberText = prefill
        ? String(prefill.orderNumber)
        : memory
          ? String(memory.orderNumber)
          : ''
      const phoneText = prefill ? prefill.phone : (memory?.phone ?? '')
      setTrackOrderNumber(numberText)
      setTrackPhone(phoneText)
      setTrackResult(null)
      setTrackToken(null)
      setTrackState('idle')
      setTrackingOpen(true)
      if (numberText && phoneText) {
        void runTrackingLookup(numberText, phoneText)
      }
    },
    [slug, runTrackingLookup],
  )

  const handleTrackSubmit = (event: FormEvent) => {
    event.preventDefault()
    void runTrackingLookup(trackOrderNumber, trackPhone)
  }

  // Vendor feature flag (§60): when the registry says online
  // ordering is off for this deployment, the menu stays browsable
  // but checkout is replaced by a notice. Read from the license
  // cache the panel maintains on this origin; no cache = enabled.
  const orderingEnabled =
    isFeatureEnabledFromCache('online_ordering') && !isSuspendedFromCache()

  const handlePlaceOrder = async (event: FormEvent) => {
    event.preventDefault()
    if (!orderingEnabled) return
    if (!info || cart.length === 0 || placing) return
    setPlaceErrorKey(null)
    if (!customerName.trim() || !customerPhone.trim()) {
      setPlaceErrorKey('storefront.error_customer_required')
      return
    }
    if (deliveryType === 'delivery' && !deliveryAddress.trim()) {
      setPlaceErrorKey('storefront.error_delivery_address_required')
      return
    }
    if (minOrderShort) {
      setPlaceErrorKey('storefront.error_min_order_not_met')
      return
    }
    setPlacing(true)
    try {
      const result = await placeOnlineOrder({
        slug,
        tableCode:
          !kiosk && deliveryType === 'dine_in' ? (tableCode ?? null) : null,
        deliveryType: kiosk ? 'pickup' : deliveryType,
        customerName,
        customerPhone,
        deliveryAddress:
          deliveryType === 'delivery' ? deliveryAddress : null,
        zoneId:
          deliveryType === 'delivery' ? (selectedZone?.id ?? null) : null,
        items: cart,
      })
      setPlaced({
        orderNumber: result.orderNumber,
        tokenNumber: result.tokenNumber,
        total: grandTotal,
        tableName: result.tableName,
        status: 'CONFIRMED',
        type: kiosk ? 'pickup' : deliveryType,
      })
      if (!kiosk) {
        writeLastOrder(slug, {
          orderNumber: result.orderNumber,
          phone: customerPhone.trim(),
          tokenNumber: result.tokenNumber,
        })
      }
      setCart([])
    } catch (error) {
      console.error('[Storefront] place order failed', error)
      const code =
        error instanceof Error ? error.message : 'place_failed'
      setPlaceErrorKey(
        ONLINE_ORDER_ERRORS.has(code)
          ? `storefront.error_${code}`
          : 'storefront.placeFailed',
      )
    } finally {
      setPlacing(false)
    }
  }

  // Call waiter button (0038): shared by the menu view (under the
  // dine-in banner) and the dine-in order confirmation. Null until
  // the table resolved — a takeaway/delivery visit never sees it.
  const callWaiterButton =
    tableCode && waiterTableId ? (
      <div className="flex w-full flex-col gap-1">
        <Button
          type="button"
          size="lg"
          variant={waiterNotified ? 'secondary' : 'default'}
          disabled={waiterNotified || waiterCalling}
          onClick={() => void handleCallWaiter()}
          className="w-full"
        >
          <Bell />
          {waiterNotified
            ? t('storefront.waiterNotified')
            : t('storefront.callWaiter')}
        </Button>
        {waiterCallFailed && (
          <p className="text-sm text-destructive">
            {t('storefront.callWaiterFailed')}
          </p>
        )}
      </div>
    ) : null

  const brandingStyle = {
    '--primary': info?.primary_color ?? '#ea580c',
    '--ring': info?.primary_color ?? '#ea580c',
  } as CSSProperties

  if (pageState === 'loading') {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-4">
        <p className="text-muted-foreground">{t('common.loading')}</p>
      </main>
    )
  }

  if (pageState === 'notFound' || pageState === 'failed' || !info) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background px-4">
        <div className="w-full max-w-md text-center">
          <h1 className="text-2xl font-bold tracking-tight">
            {t(
              pageState === 'notFound'
                ? 'storefront.notFoundTitle'
                : 'storefront.loadFailedTitle',
            )}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(
              pageState === 'notFound'
                ? 'storefront.notFoundBody'
                : 'storefront.loadFailedBody',
            )}
          </p>
          <p className="mt-4 text-sm">
            <a
              href="https://www.foodx.bond"
              className="font-medium text-primary hover:underline"
            >
              www.foodx.bond
            </a>
          </p>
        </div>
      </main>
    )
  }

  // --- order confirmation ----------------------------------------------------
  if (placed && kiosk) {
    return (
      <main
        style={brandingStyle}
        className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-6 py-10 text-center"
      >
        <p className="text-2xl font-semibold">{displayName}</p>
        <p className="text-xl text-muted-foreground">{t('kiosk.yourToken')}</p>
        <p className="text-[9rem] font-bold leading-none tracking-tight">
          {placed.tokenNumber ?? placed.orderNumber}
        </p>
        <p className="text-2xl font-semibold">
          {formatMoney(placed.total, currency)}
        </p>
        <p className="max-w-md text-lg text-muted-foreground">
          {t('kiosk.payAtCounter')}
        </p>
        <Button type="button" size="lg" className="mt-4 h-14 px-10 text-lg" onClick={resetKiosk}>
          {t('kiosk.startAgain')}
        </Button>
        <p className="text-sm text-muted-foreground">{t('kiosk.autoReset')}</p>
      </main>
    )
  }

  if (placed) {
    return (
      <main
        style={brandingStyle}
        className="flex min-h-svh items-center justify-center bg-background px-4 py-10"
      >
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>{t('storefront.orderPlaced')}</CardTitle>
            <CardDescription>
              {placed.type === 'delivery'
                ? t('storefront.payRider')
                : t('storefront.payAtRestaurant')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 text-center">
            {placed.tokenNumber !== null && (
              <div>
                <p className="text-sm text-muted-foreground">
                  {t('storefront.yourToken')}
                </p>
                <p className="text-7xl font-bold leading-none tracking-tight">
                  {placed.tokenNumber}
                </p>
              </div>
            )}
            <p className="text-5xl font-bold tracking-tight">
              #{placed.orderNumber}
            </p>
            <p className="text-lg font-semibold">
              {formatMoney(placed.total, currency)}
            </p>
            {placed.tableName && (
              <p className="text-sm text-muted-foreground">
                {t('storefront.table')} {placed.tableName}
              </p>
            )}
            <p className="rounded-full bg-muted px-3 py-1 text-sm font-medium">
              {t('storefront.orderStatus')}: {t(STATUS_KEYS[placed.status])}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('storefront.statusChecking')}
            </p>
            {placed.type === 'dine_in' && callWaiterButton}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                type="button"
                onClick={() => {
                  const orderNumber = placed.orderNumber
                  const phone = customerPhone
                  setPlaced(null)
                  openTracking({ orderNumber, phone })
                }}
              >
                {t('storefront.trackOrder')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPlaced(null)}
              >
                {t('storefront.backToMenu')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    )
  }

  // --- order tracking ---------------------------------------------------------
  if (trackingOpen) {
    return (
      <main
        style={brandingStyle}
        className="flex min-h-svh items-center justify-center bg-background px-4 py-10"
      >
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>{t('storefront.trackTitle')}</CardTitle>
            <CardDescription>{t('storefront.trackBody')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleTrackSubmit}
              className="flex flex-col gap-3"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="track-order-number">
                  {t('storefront.orderNumber')}
                </Label>
                <Input
                  id="track-order-number"
                  inputMode="numeric"
                  value={trackOrderNumber}
                  onChange={(e) => setTrackOrderNumber(e.target.value)}
                  placeholder={t('storefront.orderNumberPlaceholder')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="track-phone">{t('storefront.phone')}</Label>
                <Input
                  id="track-phone"
                  inputMode="tel"
                  value={trackPhone}
                  onChange={(e) => setTrackPhone(e.target.value)}
                  placeholder={t('storefront.phonePlaceholder')}
                />
              </div>
              <Button type="submit" disabled={trackState === 'searching'}>
                {trackState === 'searching'
                  ? t('storefront.trackSearching')
                  : t('storefront.trackButton')}
              </Button>
            </form>
            {trackState === 'notFound' && (
              <p
                role="alert"
                className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {t('storefront.trackNotFound')}
              </p>
            )}
            {trackState === 'failed' && (
              <p
                role="alert"
                className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {t('storefront.trackFailed')}
              </p>
            )}
            {trackState === 'found' && trackResult && (
              <div className="mt-5 flex flex-col items-center gap-3 text-center">
                {trackToken !== null && (
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t('storefront.yourToken')}
                    </p>
                    <p className="text-6xl font-bold leading-none tracking-tight">
                      {trackToken}
                    </p>
                  </div>
                )}
                <p className="rounded-full bg-muted px-3 py-1 text-sm font-medium">
                  {t('storefront.orderStatus')}:{' '}
                  {t(STATUS_KEYS[trackResult.status])}
                </p>
                <p className="text-lg font-semibold">
                  {t('storefront.total')}:{' '}
                  {formatMoney(trackResult.totalAmount, currency)}
                </p>
              </div>
            )}
            <div className="mt-5 text-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTrackingOpen(false)}
              >
                {t('storefront.backToMenu')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    )
  }

  // --- menu + cart ------------------------------------------------------------
  return (
    <div style={brandingStyle} className="min-h-svh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          {kiosk ? (
            <div
              className="flex min-w-0 flex-1 items-center gap-3"
              onPointerDown={() => {
                brandPressTimer.current = window.setTimeout(
                  () => setKioskExitArmed(true),
                  3000,
                )
              }}
              onPointerUp={() => {
                if (brandPressTimer.current) {
                  window.clearTimeout(brandPressTimer.current)
                  brandPressTimer.current = null
                }
              }}
              onPointerLeave={() => {
                if (brandPressTimer.current) {
                  window.clearTimeout(brandPressTimer.current)
                  brandPressTimer.current = null
                }
              }}
            >
              {info.logo_url ? (
                <img
                  src={info.logo_url}
                  alt={displayName}
                  className="h-12 w-auto max-w-36 rounded-md object-contain"
                />
              ) : (
                <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-primary text-xl font-bold text-primary-foreground">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              )}
              <h1 className="min-w-0 flex-1 truncate text-2xl font-bold tracking-tight">
                {displayName}
              </h1>
              {kioskExitArmed && (
                <Button type="button" size="sm" variant="outline" onClick={exitKiosk}>
                  {t('kiosk.exit')}
                </Button>
              )}
            </div>
          ) : (
            <>
          {info.logo_url ? (
            <img
              src={info.logo_url}
              alt={displayName}
              className="h-10 w-auto max-w-36 rounded-md object-contain"
            />
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-lg font-bold text-primary-foreground">
              {displayName.charAt(0).toUpperCase()}
            </span>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight">
            {displayName}
          </h1>
          <LanguageToggle />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => openTracking()}
          >
            {t('storefront.trackOrder')}
          </Button>
          <a
            href={loginHref}
            className="hidden text-sm font-medium text-primary hover:underline sm:inline"
          >
            {t('storefront.restaurantLogin')}
          </a>
            </>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {!kiosk && tableCode && (
          <p className="mb-4 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            {t('storefront.dineInAtTable', { table: tableDisplayName ?? tableCode })}
          </p>
        )}
        {callWaiterButton && <div className="mb-4">{callWaiterButton}</div>}

        <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('storefront.searchPlaceholder')}
                aria-label={t('storefront.searchPlaceholder')}
              />
              <div className="flex gap-2 overflow-x-auto pb-1">
                <Button
                  type="button"
                  size="sm"
                  variant={selectedCategoryId === 'all' ? 'default' : 'outline'}
                  onClick={() => setSelectedCategoryId('all')}
                >
                  {t('storefront.allCategories')}
                </Button>
                {categories
                  .filter((category) => category.is_active)
                  .map((category) => (
                    <Button
                      key={category.id}
                      type="button"
                      size="sm"
                      variant={
                        selectedCategoryId === category.id
                          ? 'default'
                          : 'outline'
                      }
                      onClick={() => setSelectedCategoryId(category.id)}
                    >
                      {displayNameOf(category.name, category.name_bn)}
                    </Button>
                  ))}
              </div>
            </div>

            {visibleProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('storefront.noProducts')}
              </p>
            ) : (
              <div
                className={
                  kiosk ? 'grid gap-4 sm:grid-cols-2' : 'grid gap-3 sm:grid-cols-2'
                }
              >
                {visibleProducts.map((product) => {
                  const servings = availability.get(product.id)
                  const outOfStock = servings !== undefined && servings <= 0
                  return (
                    <Card key={product.id} className="h-full gap-0 overflow-hidden py-0">
                      <ProductImage src={product.image_url} />
                      <CardContent
                        className={
                          kiosk
                            ? 'flex flex-1 flex-col px-5 pb-5 pt-4'
                            : 'flex flex-1 flex-col px-4 pb-4 pt-3'
                        }
                      >
                        <div className="min-w-0">
                          <p className={kiosk ? 'text-xl font-semibold' : 'font-semibold'}>
                            {displayNameOf(product.name, product.name_bn)}
                          </p>
                          <p className="mt-0.5 line-clamp-2 min-h-10 text-sm text-muted-foreground">
                            {product.description ?? ''}
                          </p>
                          {outOfStock ? (
                            <p className="mt-1 text-xs font-medium text-destructive">
                              {t('storefront.outOfStock')}
                            </p>
                          ) : servings !== undefined && servings <= 4 ? (
                            <p className="mt-1 text-xs font-medium text-amber-700">
                              {t('storefront.onlyLeft', { count: servings })}
                            </p>
                          ) : null}
                        </div>
                        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                          <p
                            className={
                              kiosk ? 'text-lg font-bold' : 'text-sm font-semibold'
                            }
                          >
                            {formatMoney(Number(product.price), currency)}
                          </p>
                          <Button
                            type="button"
                            size={kiosk ? 'lg' : 'sm'}
                            className={kiosk ? 'h-12 px-6 text-base' : undefined}
                            disabled={outOfStock || !product.is_available}
                            onClick={() => openChooser(product)}
                          >
                            {t('storefront.addToCart')}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </section>

          <section id="cart" aria-label={t('storefront.cart')}>
            <Card className="lg:sticky lg:top-20">
              <CardHeader>
                <CardTitle>
                  {t('storefront.cart')} ({cartCount})
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {previewLines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('storefront.emptyCart')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {previewLines.map((line) => (
                      <li
                        key={cartKey({
                          productId: line.productId,
                          variantId: line.variantId,
                          modifierIds: line.modifierIds,
                          quantity: line.quantity,
                        })}
                        className="flex items-start justify-between gap-2 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">
                            {line.productName}
                            {line.variantName ? ` · ${line.variantName}` : ''}
                          </p>
                          {line.modifierNames.map((m) => (
                            <p
                              key={m.id}
                              className="text-xs text-muted-foreground"
                            >
                              + {m.name} {formatMoney(m.price, currency)}
                            </p>
                          ))}
                          <p className="text-muted-foreground">
                            {formatMoney(line.unitPrice, currency)} ×{' '}
                            {line.quantity}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={t('storefront.decreaseQuantity')}
                            onClick={() =>
                              setLineQty(
                                {
                                  productId: line.productId,
                                  variantId: line.variantId,
                                  modifierIds: line.modifierIds,
                                  quantity: line.quantity,
                                },
                                line.quantity - 1,
                              )
                            }
                          >
                            −
                          </Button>
                          <span className="w-6 text-center">
                            {line.quantity}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label={t('storefront.increaseQuantity')}
                            onClick={() =>
                              setLineQty(
                                {
                                  productId: line.productId,
                                  variantId: line.variantId,
                                  modifierIds: line.modifierIds,
                                  quantity: line.quantity,
                                },
                                line.quantity + 1,
                              )
                            }
                          >
                            +
                          </Button>
                          <span className="w-20 text-right font-medium">
                            {formatMoney(line.lineTotal, currency)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {previewLines.length > 0 && (
                  <div className="flex flex-col gap-1 border-t pt-3 text-sm">
                    <p className="flex justify-between">
                      <span>{t('storefront.subtotal')}</span>
                      <span>{formatMoney(totals.subtotal, currency)}</span>
                    </p>
                    {taxRate > 0 && (
                      <p className="flex justify-between text-muted-foreground">
                        <span>
                          {t('storefront.tax', { rate: taxRate })}
                        </span>
                        <span>{formatMoney(totals.taxAmount, currency)}</span>
                      </p>
                    )}
                    {serviceChargeRate > 0 && (
                      <p className="flex justify-between text-muted-foreground">
                        <span>
                          {t('storefront.serviceCharge', {
                            rate: serviceChargeRate,
                          })}
                        </span>
                        <span>
                          {formatMoney(totals.serviceChargeAmount, currency)}
                        </span>
                      </p>
                    )}
                    {deliveryFeeCharged > 0 && (
                      <p className="flex justify-between text-muted-foreground">
                        <span>{t('storefront.deliveryFee')}</span>
                        <span>
                          {formatMoney(deliveryFeeCharged, currency)}
                        </span>
                      </p>
                    )}
                    <p className="flex justify-between border-t pt-2 text-base font-bold">
                      <span>{t('storefront.total')}</span>
                      <span>{formatMoney(grandTotal, currency)}</span>
                    </p>
                  </div>
                )}

                {previewLines.length > 0 && !orderingEnabled && (
                  <p className="border-t pt-4 text-sm text-muted-foreground">
                    {t('storefront.orderingDisabled')}
                  </p>
                )}

                {previewLines.length > 0 && orderingEnabled && (
                  <form
                    onSubmit={handlePlaceOrder}
                    className="flex flex-col gap-4 border-t pt-4"
                  >
                    {!kiosk && (
                    <div
                      className="flex flex-wrap gap-2"
                      role="group"
                      aria-label={t('storefront.deliveryType')}
                    >
                      {tableCode && (
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            deliveryType === 'dine_in'
                              ? 'default'
                              : 'outline'
                          }
                          onClick={() => setDeliveryType('dine_in')}
                        >
                          {t('storefront.dineIn')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          deliveryType === 'pickup' ? 'default' : 'outline'
                        }
                        onClick={() => setDeliveryType('pickup')}
                      >
                        {t('storefront.pickup')}
                      </Button>
                      {deliveryEnabled && (
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            deliveryType === 'delivery'
                              ? 'default'
                              : 'outline'
                          }
                          onClick={() => setDeliveryType('delivery')}
                        >
                          {t('storefront.delivery')}
                        </Button>
                      )}
                    </div>

                    )}
                    {deliveryType === 'delivery' && (
                      <p className="text-xs text-muted-foreground">
                        {t('storefront.deliveryFeeNote', {
                          fee: formatMoney(effectiveDeliveryFee, currency),
                        })}
                      </p>
                    )}
                    {minOrderShort && (
                      <p
                        role="alert"
                        className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
                      >
                        {t('storefront.minOrderNote', {
                          amount: formatMoney(activeMinOrder, currency),
                        })}
                      </p>
                    )}

                    <div className="flex flex-col gap-2">
                      <Label htmlFor="storefrontName">
                        {t('storefront.name')}
                      </Label>
                      <Input
                        id="storefrontName"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder={t('storefront.namePlaceholder')}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="storefrontPhone">
                        {t('storefront.phone')}
                      </Label>
                      <Input
                        id="storefrontPhone"
                        type="tel"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder={t('storefront.phonePlaceholder')}
                        required
                      />
                    </div>
                    {deliveryType === 'delivery' && (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="storefrontAddress">
                          {t('storefront.address')}
                        </Label>
                        <Input
                          id="storefrontAddress"
                          value={deliveryAddress}
                          onChange={(e) => setDeliveryAddress(e.target.value)}
                          placeholder={t('storefront.addressPlaceholder')}
                          required
                        />
                      </div>
                    )}
                    {deliveryType === 'delivery' && zones.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="storefrontZone">
                          {t('storefront.zone')}
                        </Label>
                        <select
                          id="storefrontZone"
                          value={selectedZone?.id ?? ''}
                          onChange={(e) => setSelectedZoneId(e.target.value)}
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                        >
                          {zones.map((zone) => (
                            <option key={zone.id} value={zone.id}>
                              {zone.name} —{' '}
                              {formatMoney(Number(zone.fee), currency)}
                              {zone.estimated_minutes != null
                                ? ` · ${t('storefront.zoneEta', {
                                    minutes: zone.estimated_minutes,
                                  })}`
                                : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {placeErrorKey && (
                      <p
                        role="alert"
                        className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                      >
                        {t(placeErrorKey)}
                      </p>
                    )}
                    <Button
                      type="submit"
                      disabled={
                        placing || cart.length === 0 || minOrderShort
                      }
                    >
                      {placing
                        ? t('storefront.placingOrder')
                        : t('storefront.placeOrder')}
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </main>

      {chooserProduct && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
          role="dialog"
          aria-label={chooserProduct.name}
        >
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>
                {displayNameOf(chooserProduct.name, chooserProduct.name_bn)}
              </CardTitle>
              <CardDescription>
                {formatMoney(Number(chooserProduct.price), currency)}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {chooserProduct.variants.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label>{t('storefront.variant')}</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={
                        chooserVariantId === null ? 'default' : 'outline'
                      }
                      onClick={() => setChooserVariantId(null)}
                    >
                      {t('storefront.noVariant')}
                    </Button>
                    {chooserProduct.variants.map((variant) => (
                      <Button
                        key={variant.id}
                        type="button"
                        size="sm"
                        variant={
                          chooserVariantId === variant.id
                            ? 'default'
                            : 'outline'
                        }
                        onClick={() => setChooserVariantId(variant.id)}
                      >
                        {variant.name}
                        {Number(variant.price_adjustment) !== 0 &&
                          ` (${Number(variant.price_adjustment) > 0 ? '+' : ''}${formatMoney(Number(variant.price_adjustment), currency)})`}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {chooserProduct.modifiers.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label>{t('storefront.modifiers')}</Label>
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
                      {displayNameOf(modifier.name, modifier.name_bn)} ·{' '}
                      {formatMoney(Number(modifier.price), currency)}
                    </label>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Label htmlFor="chooserQty">{t('storefront.quantity')}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={chooserQty <= 1}
                  onClick={() => setChooserQty((q) => Math.max(1, q - 1))}
                >
                  −
                </Button>
                <span className="w-8 text-center">{chooserQty}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setChooserQty((q) => q + 1)}
                >
                  +
                </Button>
              </div>
              <div className="flex gap-2">
                <Button type="button" onClick={addChooserToCart}>
                  {t('storefront.addToCart')}
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

      {!kiosk && (
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        <p>
          {t('storefront.poweredBy')}{' '}
          <a
            href="https://www.foodx.bond"
            className="font-medium text-primary hover:underline"
          >
            FoodX
          </a>
        </p>
        <p className="mt-1">
          <a
            href={loginHref}
            className="font-medium text-primary hover:underline"
          >
            {t('storefront.restaurantLogin')}
          </a>
        </p>
      </footer>
      )}
    </div>
  )
}
