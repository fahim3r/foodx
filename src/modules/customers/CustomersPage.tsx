// FoodX — Customers page (protected).
// Customers, loyalty points and coupons for the current restaurant.
//
// LOYALTY RULE: a balance is always SUM(loyalty_transactions.points) —
// it is computed, never stored. Points are earned only when an order
// completes and redeemed only at the POS; the Loyalty tab here only
// lists balances and allows manual adjustments (reason required).
// Customers are deactivated, never hard-deleted; coupons are
// deactivated, never hard-deleted.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { isMissingTableError, isUniqueViolationError } from '@/lib/errors'
import { formatMoney, roundMoney } from '@/lib/money'
import { useAuth } from '@/hooks/useAuth'
import { useLicenseState } from '@/hooks/useLicenseState'
import { isModuleEnabled } from '@/services/heartbeat'
import {
  adjustLoyaltyPoints,
  fetchCustomerBalance,
  fetchLoyaltyTransactions,
  fetchRecentLoyaltyTransactions,
} from '@/services/loyalty'
import {
  createCoupon,
  fetchCoupons,
  updateCoupon,
  type CouponValues,
} from '@/services/coupons'
import {
  createCustomer,
  deactivateCustomer,
  fetchCustomerOrders,
  fetchCustomerStats,
  fetchCustomerSummaries,
  fetchCustomers,
  updateCustomer,
} from '@/services/customers'
import type {
  Coupon,
  CouponType,
  CouponWithUsage,
  Customer,
  CustomerStats,
  LoyaltyTransactionType,
  LoyaltyTransactionWithOrder,
  Order,
  OrderStatus,
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

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

type Tab = 'customers' | 'loyalty' | 'coupons'

const TABS: Tab[] = ['customers', 'loyalty', 'coupons']

const TAB_KEYS: Record<Tab, string> = {
  customers: 'customers.tabCustomers',
  loyalty: 'customers.tabLoyalty',
  coupons: 'customers.tabCoupons',
}

const LOYALTY_TYPE_KEYS: Record<LoyaltyTransactionType, string> = {
  EARN: 'customers.typeEarn',
  REDEEM: 'customers.typeRedeem',
  ADJUSTMENT: 'customers.typeAdjustment',
  REVERSAL: 'customers.typeReversal',
}

const ORDER_STATUS_KEYS: Record<OrderStatus, string> = {
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

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function formatDateShort(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString()
}

interface CustomerForm {
  name: string
  phone: string
  email: string
  address: string
  notes: string
}

const EMPTY_CUSTOMER: CustomerForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
}

interface CouponForm {
  code: string
  type: CouponType
  // Money inputs stay STRINGS in form state and the inputs are
  // type="text" inputMode="decimal": a type="number" input mangled a
  // filled "30" into 29.969999313354492 before React ever saw it.
  // Parse + round only on submit. Do not switch them back.
  value: string
  minOrder: string
  validFrom: string
  validTo: string
  maxUses: string
}

const EMPTY_COUPON: CouponForm = {
  code: '',
  type: 'PERCENT',
  value: '',
  minOrder: '',
  validFrom: '',
  validTo: '',
  maxUses: '',
}

type Summary = { orderCount: number; totalSpent: number; points: number }

export default function CustomersPage() {
  const { t } = useTranslation()
  const { loading: authLoading, user, restaurant, settings } = useAuth()
  const restaurantId = restaurant?.id
  const currency = settings?.currency ?? 'BDT'

  // Vendor feature flag (§60): loyalty off hides the Loyalty tab.
  const licenseView = useLicenseState()
  const loyaltyEnabled = isModuleEnabled(licenseView, 'loyalty')
  const visibleTabs = TABS.filter(
    (item) => item !== 'loyalty' || loyaltyEnabled,
  )

  const [tab, setTab] = useState<Tab>('customers')
  const [loading, setLoading] = useState(true)
  const [dbPending, setDbPending] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [summaries, setSummaries] = useState<Map<string, Summary>>(
    new Map(),
  )
  const [coupons, setCoupons] = useState<CouponWithUsage[]>([])
  const [recentTxns, setRecentTxns] = useState<LoyaltyTransactionWithOrder[]>(
    [],
  )

  const [search, setSearch] = useState('')
  const [customerError, setCustomerError] = useState<string | null>(null)
  const [customerSaved, setCustomerSaved] = useState(false)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [couponSaved, setCouponSaved] = useState(false)
  const [adjustError, setAdjustError] = useState<string | null>(null)
  const [adjustSaved, setAdjustSaved] = useState(false)

  // Two-step deactivation: the id awaiting its confirming click.
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<
    string | null
  >(null)

  // --- customer form ---------------------------------------------------------
  const [customerForm, setCustomerForm] =
    useState<CustomerForm>(EMPTY_CUSTOMER)
  const [editingCustomerId, setEditingCustomerId] = useState<string | null>(
    null,
  )

  // --- customer detail -------------------------------------------------------
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  )
  const [detailStats, setDetailStats] = useState<CustomerStats | null>(null)
  const [detailBalance, setDetailBalance] = useState<number | null>(null)
  const [detailTxns, setDetailTxns] = useState<LoyaltyTransactionWithOrder[]>(
    [],
  )
  const [detailOrders, setDetailOrders] = useState<Order[]>([])

  // --- loyalty adjust --------------------------------------------------------
  const [adjustCustomerId, setAdjustCustomerId] = useState('')
  const [adjustPoints, setAdjustPoints] = useState('')
  const [adjustReason, setAdjustReason] = useState('')

  // --- coupon form -----------------------------------------------------------
  const [couponForm, setCouponForm] = useState<CouponForm>(EMPTY_COUPON)
  const [editingCouponId, setEditingCouponId] = useState<string | null>(null)

  // --- loading ---------------------------------------------------------------
  const reloadAll = async () => {
    if (!restaurantId) return
    const [loadedCustomers, loadedSummaries, loadedCoupons, loadedTxns] =
      await Promise.all([
        fetchCustomers(restaurantId),
        fetchCustomerSummaries(restaurantId),
        fetchCoupons(restaurantId),
        fetchRecentLoyaltyTransactions(restaurantId),
      ])
    setCustomers(loadedCustomers)
    setSummaries(loadedSummaries)
    setCoupons(loadedCoupons)
    setRecentTxns(loadedTxns)
  }

  useEffect(() => {
    if (authLoading || !restaurantId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setLoadError(false)
      setDbPending(false)
      try {
        await reloadAll()
        if (cancelled) return
      } catch (error) {
        console.error('[Customers] load failed', error)
        if (cancelled) return
        if (isMissingTableError(error)) {
          setDbPending(true)
        } else {
          setLoadError(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // reloadAll is stable enough to inline — reload on restaurant change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, restaurantId])

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return customers
    return customers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(query) ||
        (customer.phone ?? '').toLowerCase().includes(query) ||
        (customer.email ?? '').toLowerCase().includes(query),
    )
  }, [customers, search])

  const selectedCustomer = useMemo(
    () =>
      customers.find((customer) => customer.id === selectedCustomerId) ??
      null,
    [customers, selectedCustomerId],
  )

  const balancesSorted = useMemo(
    () =>
      customers
        .map((customer) => ({
          customer,
          points: summaries.get(customer.id)?.points ?? 0,
          orderCount: summaries.get(customer.id)?.orderCount ?? 0,
          totalSpent: summaries.get(customer.id)?.totalSpent ?? 0,
        }))
        .sort((a, b) => b.points - a.points),
    [customers, summaries],
  )

  const loadCustomerDetail = async (customerId: string) => {
    setSelectedCustomerId(customerId)
    setDetailStats(null)
    setDetailBalance(null)
    setDetailTxns([])
    setDetailOrders([])
    try {
      const [stats, balance, txns, orders] = await Promise.all([
        fetchCustomerStats(customerId),
        fetchCustomerBalance(customerId),
        fetchLoyaltyTransactions(customerId),
        fetchCustomerOrders(customerId),
      ])
      setDetailStats(stats)
      setDetailBalance(balance)
      setDetailTxns(txns)
      setDetailOrders(orders)
    } catch (error) {
      console.error('[Customers] detail load failed', error)
      setCustomerError('customers.loadFailed')
    }
  }

  // --- customer handlers -----------------------------------------------------
  const openEditCustomer = (customer: Customer) => {
    setCustomerForm({
      name: customer.name,
      phone: customer.phone ?? '',
      email: customer.email ?? '',
      address: customer.address ?? '',
      notes: customer.notes ?? '',
    })
    setEditingCustomerId(customer.id)
    setCustomerError(null)
    setCustomerSaved(false)
  }

  const handleCustomerSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId) return
    setCustomerError(null)
    setCustomerSaved(false)
    try {
      if (editingCustomerId) {
        await updateCustomer(editingCustomerId, {
          name: customerForm.name.trim(),
          phone: customerForm.phone.trim() || null,
          email: customerForm.email.trim() || null,
          address: customerForm.address.trim() || null,
          notes: customerForm.notes.trim() || null,
        })
      } else {
        await createCustomer(restaurantId, {
          name: customerForm.name.trim(),
          phone: customerForm.phone.trim(),
          email: customerForm.email.trim(),
          address: customerForm.address.trim(),
          notes: customerForm.notes.trim(),
        })
      }
      setCustomers(await fetchCustomers(restaurantId))
      setCustomerForm(EMPTY_CUSTOMER)
      setEditingCustomerId(null)
      setCustomerSaved(true)
    } catch (error) {
      console.error('[Customers] save customer failed', error)
      setCustomerError(
        isUniqueViolationError(error)
          ? 'customers.phoneTaken'
          : 'customers.saveFailed',
      )
    }
  }

  const handleDeactivateCustomer = async (customerId: string) => {
    if (confirmDeactivateId !== customerId) {
      setConfirmDeactivateId(customerId)
      return
    }
    setConfirmDeactivateId(null)
    setCustomerError(null)
    try {
      await deactivateCustomer(customerId)
      setCustomers(
        (prev) =>
          prev.map((c) =>
            c.id === customerId ? { ...c, is_active: false } : c,
          ),
      )
      if (selectedCustomerId === customerId) setSelectedCustomerId(null)
    } catch (error) {
      console.error('[Customers] deactivate failed', error)
      setCustomerError('customers.saveFailed')
    }
  }

  const handleReactivateCustomer = async (customerId: string) => {
    setCustomerError(null)
    try {
      await updateCustomer(customerId, { is_active: true })
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === customerId ? { ...c, is_active: true } : c,
        ),
      )
    } catch (error) {
      console.error('[Customers] reactivate failed', error)
      setCustomerError('customers.saveFailed')
    }
  }

  // --- loyalty adjust --------------------------------------------------------
  const handleAdjustSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId || !adjustCustomerId) return
    setAdjustError(null)
    setAdjustSaved(false)
    const points = Number.parseInt(adjustPoints, 10)
    try {
      await adjustLoyaltyPoints(
        adjustCustomerId,
        points,
        adjustReason,
        restaurantId,
        user?.id ?? null,
      )
      setAdjustPoints('')
      setAdjustReason('')
      setAdjustSaved(true)
      await reloadAll()
      if (selectedCustomerId === adjustCustomerId) {
        await loadCustomerDetail(adjustCustomerId)
      }
    } catch (error) {
      console.error('[Customers] adjust points failed', error)
      const message = error instanceof Error ? error.message : ''
      setAdjustError(
        message === 'reason_required'
          ? 'customers.reasonRequired'
          : message === 'invalid_points'
            ? 'customers.invalidPoints'
            : 'customers.saveFailed',
      )
    }
  }

  // --- coupon handlers -------------------------------------------------------
  const openEditCoupon = (coupon: Coupon) => {
    setCouponForm({
      code: coupon.code,
      type: coupon.type,
      value: String(coupon.value),
      minOrder: String(coupon.min_order_amount),
      validFrom: coupon.valid_from ?? '',
      validTo: coupon.valid_to ?? '',
      maxUses:
        coupon.max_uses === null ? '' : String(coupon.max_uses),
    })
    setEditingCouponId(coupon.id)
    setCouponError(null)
    setCouponSaved(false)
  }

  const couponValuesFromForm = (): CouponValues => ({
    code: couponForm.code,
    type: couponForm.type,
    value: roundMoney(Number.parseFloat(couponForm.value) || 0),
    minOrderAmount: roundMoney(Number.parseFloat(couponForm.minOrder) || 0),
    validFrom: couponForm.validFrom || null,
    validTo: couponForm.validTo || null,
    maxUses: couponForm.maxUses.trim()
      ? Number.parseInt(couponForm.maxUses, 10)
      : null,
  })

  const handleCouponSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId) return
    setCouponError(null)
    setCouponSaved(false)
    try {
      if (editingCouponId) {
        await updateCoupon(editingCouponId, {
          code: couponForm.code,
          type: couponForm.type,
          value: roundMoney(Number.parseFloat(couponForm.value) || 0),
          min_order_amount: roundMoney(
            Number.parseFloat(couponForm.minOrder) || 0,
          ),
          valid_from: couponForm.validFrom || null,
          valid_to: couponForm.validTo || null,
          max_uses: couponForm.maxUses.trim()
            ? Number.parseInt(couponForm.maxUses, 10)
            : null,
        })
      } else {
        await createCoupon(restaurantId, couponValuesFromForm())
      }
      setCoupons(await fetchCoupons(restaurantId))
      setCouponForm(EMPTY_COUPON)
      setEditingCouponId(null)
      setCouponSaved(true)
    } catch (error) {
      console.error('[Customers] save coupon failed', error)
      const message = error instanceof Error ? error.message : ''
      setCouponError(
        isUniqueViolationError(error)
          ? 'customers.couponCodeTaken'
          : message === 'invalid_coupon_code'
            ? 'customers.couponInvalid'
            : message === 'invalid_coupon_value'
              ? 'customers.couponInvalid'
              : message === 'invalid_coupon_dates'
                ? 'customers.couponInvalidDates'
                : 'customers.saveFailed',
      )
    }
  }

  const handleToggleCoupon = async (coupon: Coupon) => {
    setCouponError(null)
    try {
      await updateCoupon(coupon.id, { is_active: !coupon.is_active })
      setCoupons(await fetchCoupons(restaurantId!))
    } catch (error) {
      console.error('[Customers] toggle coupon failed', error)
      setCouponError('customers.saveFailed')
    }
  }

  if (loading || authLoading) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  if (dbPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('layout.dbPendingTitle')}</CardTitle>
          <CardDescription>{t('layout.dbPendingBody')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (loadError || !restaurant) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('common.error')}</CardTitle>
          <CardDescription>{t('customers.loadFailed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => window.location.reload()}>
            {t('common.retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-bold tracking-tight">
          {t('customers.title')}
        </h2>
        <p className="text-muted-foreground">{t('customers.subtitle')}</p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist">
        {visibleTabs.map((item) => (
          <Button
            key={item}
            type="button"
            size="sm"
            role="tab"
            aria-selected={tab === item}
            variant={tab === item ? 'default' : 'outline'}
            onClick={() => setTab(item)}
          >
            {t(TAB_KEYS[item])}
          </Button>
        ))}
      </div>

      {tab === 'customers' && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingCustomerId
                  ? t('customers.editCustomer')
                  : t('customers.newCustomer')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleCustomerSubmit}
                className="flex flex-col gap-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="customer-name">{t('customers.name')}</Label>
                    <Input
                      id="customer-name"
                      value={customerForm.name}
                      onChange={(e) =>
                        setCustomerForm((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      placeholder={t('customers.namePlaceholder')}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="customer-phone">
                      {t('customers.phone')}
                    </Label>
                    <Input
                      id="customer-phone"
                      type="tel"
                      value={customerForm.phone}
                      onChange={(e) =>
                        setCustomerForm((prev) => ({
                          ...prev,
                          phone: e.target.value,
                        }))
                      }
                      placeholder={t('customers.phonePlaceholder')}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="customer-email">
                      {t('customers.email')}
                    </Label>
                    <Input
                      id="customer-email"
                      type="email"
                      value={customerForm.email}
                      onChange={(e) =>
                        setCustomerForm((prev) => ({
                          ...prev,
                          email: e.target.value,
                        }))
                      }
                      placeholder={t('customers.emailPlaceholder')}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="customer-address">
                      {t('customers.address')}
                    </Label>
                    <Input
                      id="customer-address"
                      value={customerForm.address}
                      onChange={(e) =>
                        setCustomerForm((prev) => ({
                          ...prev,
                          address: e.target.value,
                        }))
                      }
                      placeholder={t('customers.addressPlaceholder')}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="customer-notes">{t('customers.notes')}</Label>
                  <Input
                    id="customer-notes"
                    value={customerForm.notes}
                    onChange={(e) =>
                      setCustomerForm((prev) => ({
                        ...prev,
                        notes: e.target.value,
                      }))
                    }
                    placeholder={t('customers.notesPlaceholder')}
                  />
                </div>
                {customerError && (
                  <p
                    role="alert"
                    className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {t(customerError)}
                  </p>
                )}
                {customerSaved && (
                  <p
                    role="status"
                    className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                  >
                    {t('common.saved')}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button type="submit">
                    {editingCustomerId
                      ? t('common.save')
                      : t('customers.addCustomer')}
                  </Button>
                  {editingCustomerId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCustomerForm(EMPTY_CUSTOMER)
                        setEditingCustomerId(null)
                        setCustomerError(null)
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('customers.tabCustomers')}</CardTitle>
              <CardDescription>
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('customers.searchPlaceholder')}
                  aria-label={t('customers.searchPlaceholder')}
                />
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {filteredCustomers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('customers.noCustomers')}
                </p>
              ) : (
                filteredCustomers.map((customer) => {
                  const summary = summaries.get(customer.id)
                  return (
                    <div
                      key={customer.id}
                      className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
                    >
                      <button
                        type="button"
                        onClick={() => void loadCustomerDetail(customer.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <span className="block truncate font-medium">
                          {customer.name}
                          {!customer.is_active && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {t('customers.inactive')}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-sm text-muted-foreground">
                          {[customer.phone, customer.email]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {t('customers.totalSpent')}:{' '}
                          {formatMoney(summary?.totalSpent ?? 0, currency)} ·{' '}
                          {t('customers.visits')}: {summary?.orderCount ?? 0} ·{' '}
                          {t('customers.points')}: {summary?.points ?? 0}
                        </span>
                      </button>
                      <span className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEditCustomer(customer)}
                        >
                          {t('common.edit')}
                        </Button>
                        {customer.is_active ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void handleDeactivateCustomer(customer.id)
                            }
                          >
                            {confirmDeactivateId === customer.id
                              ? t('customers.deactivateConfirm')
                              : t('customers.deactivate')}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void handleReactivateCustomer(customer.id)
                            }
                          >
                            {t('customers.reactivate')}
                          </Button>
                        )}
                      </span>
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          {selectedCustomer && (
            <Card>
              <CardHeader>
                <CardTitle>{selectedCustomer.name}</CardTitle>
                <CardDescription>
                  {[selectedCustomer.phone, selectedCustomer.email]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-2 text-sm sm:grid-cols-3">
                  <p>
                    <span className="text-muted-foreground">
                      {t('customers.totalSpent')}:{' '}
                    </span>
                    <span className="font-medium">
                      {formatMoney(detailStats?.totalSpent ?? 0, currency)}
                    </span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">
                      {t('customers.visits')}:{' '}
                    </span>
                    <span className="font-medium">
                      {detailStats?.orderCount ?? 0}
                    </span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">
                      {t('customers.pointsBalance')}:{' '}
                    </span>
                    <span className="font-medium">{detailBalance ?? 0}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">
                      {t('customers.lastOrder')}:{' '}
                    </span>
                    <span className="font-medium">
                      {formatDateShort(detailStats?.lastOrderAt ?? null)}
                    </span>
                  </p>
                </div>
                {selectedCustomer.address && (
                  <p className="text-sm text-muted-foreground">
                    {selectedCustomer.address}
                  </p>
                )}
                {selectedCustomer.notes && (
                  <p className="text-sm text-muted-foreground">
                    {selectedCustomer.notes}
                  </p>
                )}
                <div>
                  <p className="mb-2 text-sm font-medium">
                    {t('customers.loyaltyHistory')}
                  </p>
                  {detailTxns.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('customers.noTransactions')}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1 text-sm">
                      {detailTxns.map((txn) => (
                        <li
                          key={txn.id}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <span>
                            {t(LOYALTY_TYPE_KEYS[txn.type])}
                            {txn.order_number !== null &&
                              ` · #${txn.order_number}`}
                            {txn.reason ? ` · ${txn.reason}` : ''}
                          </span>
                          <span className="font-medium">
                            {txn.points > 0 ? '+' : ''}
                            {txn.points}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-sm font-medium">
                    {t('customers.orderHistory')}
                  </p>
                  {detailOrders.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('customers.noOrders')}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-1 text-sm">
                      {detailOrders.map((order) => (
                        <li
                          key={order.id}
                          className="flex flex-wrap items-center justify-between gap-2"
                        >
                          <Link
                            to={`/orders/${order.id}`}
                            className="text-primary underline-offset-2 hover:underline"
                          >
                            #{order.order_number} ·{' '}
                            {t(ORDER_STATUS_KEYS[order.status])}
                          </Link>
                          <span>
                            {formatDate(order.created_at)} ·{' '}
                            {formatMoney(Number(order.total_amount), currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedCustomerId(null)}
                  >
                    {t('common.close')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {tab === 'loyalty' && loyaltyEnabled && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('customers.adjustTitle')}</CardTitle>
              <CardDescription>{t('customers.adjustHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleAdjustSubmit}
                className="flex flex-col gap-4"
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="adjust-customer">
                      {t('customers.customer')}
                    </Label>
                    <select
                      id="adjust-customer"
                      value={adjustCustomerId}
                      onChange={(e) => setAdjustCustomerId(e.target.value)}
                      className={SELECT_CLASS}
                      required
                    >
                      <option value="">{t('customers.selectCustomer')}</option>
                      {customers
                        .filter((c) => c.is_active)
                        .map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                            {customer.phone ? ` (${customer.phone})` : ''}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="adjust-points">
                      {t('customers.pointsAmount')}
                    </Label>
                    <Input
                      id="adjust-points"
                      type="text"
                      inputMode="numeric"
                      value={adjustPoints}
                      onChange={(e) => setAdjustPoints(e.target.value)}
                      placeholder={t('customers.pointsPlaceholder')}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="adjust-reason">
                      {t('customers.reason')}
                    </Label>
                    <Input
                      id="adjust-reason"
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                      placeholder={t('customers.reasonPlaceholder')}
                      required
                    />
                  </div>
                </div>
                {adjustError && (
                  <p
                    role="alert"
                    className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {t(adjustError)}
                  </p>
                )}
                {adjustSaved && (
                  <p
                    role="status"
                    className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                  >
                    {t('customers.adjustSaved')}
                  </p>
                )}
                <div>
                  <Button type="submit">{t('customers.adjustPoints')}</Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('customers.balances')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {balancesSorted.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('customers.noCustomers')}
                </p>
              ) : (
                balancesSorted.map(({ customer, points, orderCount, totalSpent }) => (
                  <div
                    key={customer.id}
                    className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {customer.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t('customers.visits')}: {orderCount} ·{' '}
                        {t('customers.totalSpent')}:{' '}
                        {formatMoney(totalSpent, currency)}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium">
                      {points} {t('customers.points')}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('customers.recentTransactions')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {recentTxns.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('customers.noTransactions')}
                </p>
              ) : (
                recentTxns.map((txn) => (
                  <div
                    key={txn.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {txn.customer_name ?? '—'}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t(LOYALTY_TYPE_KEYS[txn.type])}
                        {txn.order_number !== null &&
                          ` · #${txn.order_number}`}
                        {txn.reason ? ` · ${txn.reason}` : ''} ·{' '}
                        {formatDate(txn.created_at)}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium">
                      {txn.points > 0 ? '+' : ''}
                      {txn.points}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'coupons' && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingCouponId
                  ? t('customers.editCoupon')
                  : t('customers.newCoupon')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleCouponSubmit}
                className="flex flex-col gap-4"
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="coupon-code">
                      {t('customers.couponCode')}
                    </Label>
                    <Input
                      id="coupon-code"
                      value={couponForm.code}
                      onChange={(e) =>
                        setCouponForm((prev) => ({
                          ...prev,
                          code: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder={t('customers.couponCodePlaceholder')}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="coupon-type">
                      {t('customers.couponType')}
                    </Label>
                    <select
                      id="coupon-type"
                      value={couponForm.type}
                      onChange={(e) =>
                        setCouponForm((prev) => ({
                          ...prev,
                          type: e.target.value as CouponType,
                        }))
                      }
                      className={SELECT_CLASS}
                    >
                      <option value="PERCENT">
                        {t('customers.couponPercent')}
                      </option>
                      <option value="FIXED">
                        {t('customers.couponFixed')}
                      </option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="coupon-value">
                      {t('customers.couponValue')}
                    </Label>
                    <Input
                      id="coupon-value"
                      type="text"
                      inputMode="decimal"
                      value={couponForm.value}
                      onChange={(e) =>
                        setCouponForm((prev) => ({
                          ...prev,
                          value: e.target.value,
                        }))
                      }
                      placeholder={
                        couponForm.type === 'PERCENT' ? '10' : '50'
                      }
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="coupon-min-order">
                      {t('customers.minOrderAmount')}
                    </Label>
                    <Input
                      id="coupon-min-order"
                      type="text"
                      inputMode="decimal"
                      value={couponForm.minOrder}
                      onChange={(e) =>
                        setCouponForm((prev) => ({
                          ...prev,
                          minOrder: e.target.value,
                        }))
                      }
                      placeholder="0"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="coupon-valid-from">
                      {t('customers.validFrom')}
                    </Label>
                    <Input
                      id="coupon-valid-from"
                      type="date"
                      value={couponForm.validFrom}
                      onChange={(e) =>
                        setCouponForm((prev) => ({
                          ...prev,
                          validFrom: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="coupon-valid-to">
                      {t('customers.validTo')}
                    </Label>
                    <Input
                      id="coupon-valid-to"
                      type="date"
                      value={couponForm.validTo}
                      onChange={(e) =>
                        setCouponForm((prev) => ({
                          ...prev,
                          validTo: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="coupon-max-uses">
                      {t('customers.maxUses')}
                    </Label>
                    <Input
                      id="coupon-max-uses"
                      type="text"
                      inputMode="numeric"
                      value={couponForm.maxUses}
                      onChange={(e) =>
                        setCouponForm((prev) => ({
                          ...prev,
                          maxUses: e.target.value,
                        }))
                      }
                      placeholder={t('customers.maxUsesUnlimited')}
                    />
                  </div>
                </div>
                {couponError && (
                  <p
                    role="alert"
                    className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {t(couponError)}
                  </p>
                )}
                {couponSaved && (
                  <p
                    role="status"
                    className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                  >
                    {t('common.saved')}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button type="submit">
                    {editingCouponId
                      ? t('common.save')
                      : t('customers.addCoupon')}
                  </Button>
                  {editingCouponId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setCouponForm(EMPTY_COUPON)
                        setEditingCouponId(null)
                        setCouponError(null)
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('customers.tabCoupons')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {coupons.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('customers.noCoupons')}
                </p>
              ) : (
                coupons.map((coupon) => (
                  <div
                    key={coupon.id}
                    className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {coupon.code}
                        {!coupon.is_active && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {t('customers.inactive')}
                          </span>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {coupon.type === 'PERCENT'
                          ? `${Number(coupon.value)}%`
                          : formatMoney(Number(coupon.value), currency)}
                        {' · '}
                        {t('customers.uses', {
                          used: coupon.uses,
                          max:
                            coupon.max_uses === null
                              ? t('customers.unlimited')
                              : coupon.max_uses,
                        })}
                        {(coupon.valid_from || coupon.valid_to) &&
                          ` · ${coupon.valid_from ?? '…'} → ${coupon.valid_to ?? '…'}`}
                        {Number(coupon.min_order_amount) > 0 &&
                          ` · ${t('customers.minOrderAmount')}: ${formatMoney(Number(coupon.min_order_amount), currency)}`}
                      </p>
                    </div>
                    <span className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openEditCoupon(coupon)}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleToggleCoupon(coupon)}
                      >
                        {coupon.is_active
                          ? t('customers.deactivateCoupon')
                          : t('customers.activateCoupon')}
                      </Button>
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
