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
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
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
  TERMINAL_ORDER_STATUSES,
  type Category,
  type DeliveryZone,
  type OrderStatus,
  type OrderType,
  type ProductWithDetails,
  type StorefrontInfo,
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
  total: number
  tableName: string | null
  status: OrderStatus
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

  const handlePlaceOrder = async (event: FormEvent) => {
    event.preventDefault()
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
        tableCode: deliveryType === 'dine_in' ? (tableCode ?? null) : null,
        deliveryType,
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
        total: grandTotal,
        tableName: result.tableName,
        status: 'CONFIRMED',
      })
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
              {t('storefront.payAtRestaurant')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3 text-center">
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setPlaced(null)}
            >
              {t('storefront.backToMenu')}
            </Button>
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
          <a
            href={loginHref}
            className="hidden text-sm font-medium text-primary hover:underline sm:inline"
          >
            {t('storefront.restaurantLogin')}
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {tableCode && (
          <p className="mb-4 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900">
            {t('storefront.dineInAtTable', { table: tableDisplayName ?? tableCode })}
          </p>
        )}

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
              <div className="grid gap-3 sm:grid-cols-2">
                {visibleProducts.map((product) => {
                  const servings = availability.get(product.id)
                  const outOfStock = servings !== undefined && servings <= 0
                  return (
                    <Card key={product.id}>
                      <CardContent className="flex gap-3 pt-6">
                        {product.image_url && (
                          <img
                            src={product.image_url}
                            alt=""
                            loading="lazy"
                            className="h-16 w-16 shrink-0 rounded-md object-cover"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold">
                            {displayNameOf(product.name, product.name_bn)}
                          </p>
                          {product.description && (
                            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                              {product.description}
                            </p>
                          )}
                          <p className="mt-1 text-sm font-semibold">
                            {formatMoney(Number(product.price), currency)}
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
                        <Button
                          type="button"
                          size="sm"
                          disabled={outOfStock || !product.is_available}
                          onClick={() => openChooser(product)}
                        >
                          {t('storefront.addToCart')}
                        </Button>
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

                {previewLines.length > 0 && (
                  <form
                    onSubmit={handlePlaceOrder}
                    className="flex flex-col gap-4 border-t pt-4"
                  >
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
    </div>
  )
}
