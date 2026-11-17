// FoodX — Delivery page (protected, Phase 6).
// The delivery board (dispatch records for this restaurant's delivery
// orders), plus driver and zone management.
//
// RULES kept from earlier phases:
// - The order stays the financial / kitchen record; a delivery_orders
//   row is only its dispatch record (created by the service on first
//   sight, cod_amount snapshotted from the order total).
// - Status changes go through the service state machine and always
//   write a history row. DELIVERED completes the linked order through
//   the orders service; FAILED / CANCELLED never auto-cancel the order.
// - Money inputs stay STRINGS in form state (type="text",
//   inputMode="decimal") and are parsed + rounded only on submit —
//   the Phase 3 number-input lesson.
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { isMissingTableError, isUniqueViolationError } from '@/lib/errors'
import { formatMoney, roundMoney } from '@/lib/money'
import { useAuth } from '@/hooks/useAuth'
import { useLicenseState } from '@/hooks/useLicenseState'
import { isModuleEnabled } from '@/services/heartbeat'
import {
  advanceDeliveryStatus,
  assignDriver,
  createDeliveryDriver,
  createDeliveryZone,
  deleteDeliveryDriver,
  deleteDeliveryZone,
  fetchDeliveryBoard,
  fetchDeliveryDrivers,
  fetchDeliveryZones,
  updateDeliveryDriver,
  updateDeliveryZone,
} from '@/services/delivery'
import type {
  DeliveryBoardEntry,
  DeliveryDriver,
  DeliveryDriverStatus,
  DeliveryStatus,
  DeliveryZone,
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

type Tab = 'board' | 'drivers' | 'zones'

const TABS: Tab[] = ['board', 'drivers', 'zones']

const TAB_KEYS: Record<Tab, string> = {
  board: 'delivery.tabBoard',
  drivers: 'delivery.tabDrivers',
  zones: 'delivery.tabZones',
}

const DELIVERY_STATUS_KEYS: Record<DeliveryStatus, string> = {
  PENDING: 'delivery.statusPending',
  ASSIGNED: 'delivery.statusAssigned',
  PICKED_UP: 'delivery.statusPickedUp',
  OUT_FOR_DELIVERY: 'delivery.statusOutForDelivery',
  DELIVERED: 'delivery.statusDelivered',
  FAILED: 'delivery.statusFailed',
  CANCELLED: 'delivery.statusCancelled',
}

const DRIVER_STATUS_KEYS: Record<DeliveryDriverStatus, string> = {
  AVAILABLE: 'delivery.driverAvailable',
  ON_DELIVERY: 'delivery.driverOnDelivery',
  OFFLINE: 'delivery.driverOffline',
}

/** The next actions offered for a delivery in each non-terminal status. */
const NEXT_ACTIONS: Partial<Record<DeliveryStatus, DeliveryStatus[]>> = {
  ASSIGNED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['OUT_FOR_DELIVERY', 'FAILED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
}

const ACTION_KEYS: Partial<Record<DeliveryStatus, string>> = {
  PICKED_UP: 'delivery.actionPickedUp',
  OUT_FOR_DELIVERY: 'delivery.actionOutForDelivery',
  DELIVERED: 'delivery.actionDelivered',
  FAILED: 'delivery.actionFailed',
  CANCELLED: 'delivery.actionCancel',
}

interface DriverForm {
  name: string
  phone: string
  email: string
  vehicle_type: string
  vehicle_number: string
  notes: string
}

const EMPTY_DRIVER: DriverForm = {
  name: '',
  phone: '',
  email: '',
  vehicle_type: '',
  vehicle_number: '',
  notes: '',
}

interface ZoneForm {
  name: string
  fee: string
  minOrder: string
  minutes: string
}

const EMPTY_ZONE: ZoneForm = { name: '', fee: '', minOrder: '', minutes: '' }

function parseMoneyInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return 0
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return null
  return roundMoney(value)
}

export default function DeliveryPage() {
  const { t } = useTranslation()
  const { loading: authLoading, user, restaurant, settings } = useAuth()
  const licenseView = useLicenseState()
  const restaurantId = restaurant?.id
  const userId = user?.id ?? ''
  const currency = settings?.currency ?? 'BDT'

  const [tab, setTab] = useState<Tab>('board')
  const [loading, setLoading] = useState(true)
  const [dbPending, setDbPending] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const [board, setBoard] = useState<DeliveryBoardEntry[]>([])
  const [drivers, setDrivers] = useState<DeliveryDriver[]>([])
  const [zones, setZones] = useState<DeliveryZone[]>([])

  const [actionError, setActionError] = useState<string | null>(null)
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null)
  const [assignDriverId, setAssignDriverId] = useState<Record<string, string>>(
    {},
  )
  const [assignZoneId, setAssignZoneId] = useState<Record<string, string>>({})

  const [driverForm, setDriverForm] = useState<DriverForm>(EMPTY_DRIVER)
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null)
  const [driverError, setDriverError] = useState<string | null>(null)
  const [driverSaved, setDriverSaved] = useState(false)
  const [confirmDeleteDriverId, setConfirmDeleteDriverId] = useState<
    string | null
  >(null)

  const [zoneForm, setZoneForm] = useState<ZoneForm>(EMPTY_ZONE)
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  const [zoneError, setZoneError] = useState<string | null>(null)
  const [zoneSaved, setZoneSaved] = useState(false)
  const [confirmDeleteZoneId, setConfirmDeleteZoneId] = useState<
    string | null
  >(null)

  const reloadAll = async () => {
    if (!restaurantId) return
    const [loadedBoard, loadedDrivers, loadedZones] = await Promise.all([
      fetchDeliveryBoard(restaurantId),
      fetchDeliveryDrivers(restaurantId),
      fetchDeliveryZones(restaurantId),
    ])
    setBoard(loadedBoard)
    setDrivers(loadedDrivers)
    setZones(loadedZones)
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
        console.error('[Delivery] load failed', error)
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

  const runBoardAction = async (orderId: string, fn: () => Promise<void>) => {
    setActionError(null)
    setBusyOrderId(orderId)
    try {
      await fn()
      await reloadAll()
    } catch (error) {
      console.error('[Delivery] action failed', error)
      setActionError('delivery.saveFailed')
    } finally {
      setBusyOrderId(null)
    }
  }

  const handleAssign = (entry: DeliveryBoardEntry) => {
    const driverId = assignDriverId[entry.order.id] ?? ''
    if (!driverId) {
      setActionError('delivery.selectDriverFirst')
      return
    }
    const zoneId = assignZoneId[entry.order.id] || undefined
    void runBoardAction(entry.order.id, async () => {
      await assignDriver(entry.order, driverId, userId, zoneId)
    })
  }

  const handleAdvance = (entry: DeliveryBoardEntry, to: DeliveryStatus) => {
    if (!entry.delivery) return
    const delivery = entry.delivery
    void runBoardAction(entry.order.id, async () => {
      await advanceDeliveryStatus(entry.order, delivery, to, userId)
    })
  }

  const handleDriverSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId) return
    setDriverError(null)
    setDriverSaved(false)
    if (!driverForm.name.trim()) {
      setDriverError('delivery.nameRequired')
      return
    }
    if (!driverForm.phone.trim()) {
      setDriverError('delivery.phoneRequired')
      return
    }
    try {
      if (editingDriverId) {
        await updateDeliveryDriver(editingDriverId, {
          name: driverForm.name.trim(),
          phone: driverForm.phone.trim(),
          email: driverForm.email.trim() || null,
          vehicle_type: driverForm.vehicle_type.trim() || null,
          vehicle_number: driverForm.vehicle_number.trim() || null,
          notes: driverForm.notes.trim() || null,
        })
      } else {
        await createDeliveryDriver(restaurantId, {
          name: driverForm.name,
          phone: driverForm.phone,
          email: driverForm.email,
          vehicle_type: driverForm.vehicle_type,
          vehicle_number: driverForm.vehicle_number,
          notes: driverForm.notes,
        })
      }
      setDriverForm(EMPTY_DRIVER)
      setEditingDriverId(null)
      setDriverSaved(true)
      await reloadAll()
    } catch (error) {
      console.error('[Delivery] save driver failed', error)
      setDriverError('delivery.saveFailed')
    }
  }

  const handleToggleDriver = async (driver: DeliveryDriver) => {
    setDriverError(null)
    try {
      await updateDeliveryDriver(driver.id, { is_active: !driver.is_active })
      await reloadAll()
    } catch (error) {
      console.error('[Delivery] toggle driver failed', error)
      setDriverError('delivery.saveFailed')
    }
  }

  const handleDeleteDriver = async (driverId: string) => {
    setDriverError(null)
    try {
      await deleteDeliveryDriver(driverId)
      setConfirmDeleteDriverId(null)
      await reloadAll()
    } catch (error) {
      console.error('[Delivery] delete driver failed', error)
      setDriverError('delivery.saveFailed')
    }
  }

  const handleZoneSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId) return
    setZoneError(null)
    setZoneSaved(false)
    if (!zoneForm.name.trim()) {
      setZoneError('delivery.zoneNameRequired')
      return
    }
    const fee = parseMoneyInput(zoneForm.fee)
    const minOrder = parseMoneyInput(zoneForm.minOrder)
    const minutesRaw = zoneForm.minutes.trim()
    const minutes = minutesRaw === '' ? undefined : Number(minutesRaw)
    if (
      fee === null ||
      minOrder === null ||
      (minutes !== undefined && (!Number.isInteger(minutes) || minutes <= 0))
    ) {
      setZoneError('delivery.invalidValue')
      return
    }
    try {
      if (editingZoneId) {
        await updateDeliveryZone(editingZoneId, {
          name: zoneForm.name.trim(),
          fee,
          min_order_amount: minOrder,
          estimated_minutes: minutes ?? null,
        })
      } else {
        await createDeliveryZone(restaurantId, {
          name: zoneForm.name,
          fee,
          min_order_amount: minOrder,
          estimated_minutes: minutes,
        })
      }
      setZoneForm(EMPTY_ZONE)
      setEditingZoneId(null)
      setZoneSaved(true)
      await reloadAll()
    } catch (error) {
      console.error('[Delivery] save zone failed', error)
      setZoneError(
        isUniqueViolationError(error)
          ? 'delivery.zoneNameTaken'
          : 'delivery.saveFailed',
      )
    }
  }

  const handleToggleZone = async (zone: DeliveryZone) => {
    setZoneError(null)
    try {
      await updateDeliveryZone(zone.id, { is_active: !zone.is_active })
      await reloadAll()
    } catch (error) {
      console.error('[Delivery] toggle zone failed', error)
      setZoneError('delivery.saveFailed')
    }
  }

  const handleDeleteZone = async (zoneId: string) => {
    setZoneError(null)
    try {
      await deleteDeliveryZone(zoneId)
      setConfirmDeleteZoneId(null)
      await reloadAll()
    } catch (error) {
      console.error('[Delivery] delete zone failed', error)
      setZoneError('delivery.saveFailed')
    }
  }

  if (loading || authLoading) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  if (!isModuleEnabled(licenseView, 'delivery')) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>{t('license.moduleDisabledTitle')}</CardTitle>
            <CardDescription>
              {t('license.moduleDisabledBody')}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
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
          <CardDescription>{t('delivery.loadFailed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => window.location.reload()}>
            {t('common.retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const activeDrivers = drivers.filter((d) => d.is_active)
  const activeZones = zones.filter((z) => z.is_active)

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-bold tracking-tight">
          {t('delivery.title')}
        </h2>
        <p className="text-muted-foreground">{t('delivery.subtitle')}</p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist">
        {TABS.map((item) => (
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

      {tab === 'board' && (
        <div className="flex flex-col gap-3">
          {actionError && (
            <p className="text-sm text-destructive">{t(actionError)}</p>
          )}
          {board.length === 0 && (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">
                {t('delivery.emptyBoard')}
              </CardContent>
            </Card>
          )}
          {board.map((entry) => {
            const delivery = entry.delivery
            const status: DeliveryStatus = delivery?.status ?? 'PENDING'
            const busy = busyOrderId === entry.order.id
            return (
              <Card key={entry.order.id}>
                <CardContent className="flex flex-col gap-3 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {t('delivery.orderNumber', {
                        number: entry.order.order_number,
                      })}
                    </span>
                    <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-medium">
                      {t(DELIVERY_STATUS_KEYS[status])}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {entry.order.customer_name ?? '—'} ·{' '}
                      {entry.order.customer_phone ?? '—'}
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {entry.order.delivery_address ?? '—'}
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <span>
                      {t('delivery.cod')}:{' '}
                      {formatMoney(
                        delivery?.cod_amount ?? entry.order.total_amount,
                        currency,
                      )}
                    </span>
                    <span>
                      {t('delivery.driver')}: {entry.driver_name ?? '—'}
                    </span>
                    <span>
                      {t('delivery.zone')}: {entry.zone_name ?? '—'}
                    </span>
                  </div>

                  {status === 'PENDING' && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select
                        className={SELECT_CLASS}
                        aria-label={t('delivery.driver')}
                        value={assignDriverId[entry.order.id] ?? ''}
                        onChange={(e) =>
                          setAssignDriverId((prev) => ({
                            ...prev,
                            [entry.order.id]: e.target.value,
                          }))
                        }
                      >
                        <option value="">{t('delivery.selectDriver')}</option>
                        {activeDrivers.map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.name} ({t(DRIVER_STATUS_KEYS[driver.status])})
                          </option>
                        ))}
                      </select>
                      <select
                        className={SELECT_CLASS}
                        aria-label={t('delivery.zone')}
                        value={assignZoneId[entry.order.id] ?? ''}
                        onChange={(e) =>
                          setAssignZoneId((prev) => ({
                            ...prev,
                            [entry.order.id]: e.target.value,
                          }))
                        }
                      >
                        <option value="">{t('delivery.selectZone')}</option>
                        {activeZones.map((zone) => (
                          <option key={zone.id} value={zone.id}>
                            {zone.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => handleAssign(entry)}
                      >
                        {t('delivery.assign')}
                      </Button>
                    </div>
                  )}

                  {status === 'ASSIGNED' && (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <select
                        className={SELECT_CLASS}
                        aria-label={t('delivery.driver')}
                        value={
                          assignDriverId[entry.order.id] ??
                          delivery?.driver_id ??
                          ''
                        }
                        onChange={(e) =>
                          setAssignDriverId((prev) => ({
                            ...prev,
                            [entry.order.id]: e.target.value,
                          }))
                        }
                      >
                        <option value="">{t('delivery.selectDriver')}</option>
                        {activeDrivers.map((driver) => (
                          <option key={driver.id} value={driver.id}>
                            {driver.name} ({t(DRIVER_STATUS_KEYS[driver.status])})
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => handleAssign(entry)}
                      >
                        {t('delivery.reassign')}
                      </Button>
                    </div>
                  )}

                  {(NEXT_ACTIONS[status] ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {(NEXT_ACTIONS[status] ?? []).map((next) => (
                        <Button
                          key={next}
                          type="button"
                          size="sm"
                          variant={
                            next === 'DELIVERED' ? 'default' : 'outline'
                          }
                          disabled={busy}
                          onClick={() => handleAdvance(entry, next)}
                        >
                          {t(ACTION_KEYS[next] ?? '')}
                        </Button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {tab === 'drivers' && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {t(editingDriverId ? 'delivery.editDriver' : 'delivery.addDriver')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={handleDriverSubmit}
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="driver-name">{t('delivery.driverName')}</Label>
                  <Input
                    id="driver-name"
                    value={driverForm.name}
                    onChange={(e) =>
                      setDriverForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="driver-phone">{t('delivery.driverPhone')}</Label>
                  <Input
                    id="driver-phone"
                    value={driverForm.phone}
                    onChange={(e) =>
                      setDriverForm((f) => ({ ...f, phone: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="driver-email">{t('delivery.email')}</Label>
                  <Input
                    id="driver-email"
                    value={driverForm.email}
                    onChange={(e) =>
                      setDriverForm((f) => ({ ...f, email: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="driver-vehicle-type">
                    {t('delivery.vehicleType')}
                  </Label>
                  <Input
                    id="driver-vehicle-type"
                    value={driverForm.vehicle_type}
                    onChange={(e) =>
                      setDriverForm((f) => ({
                        ...f,
                        vehicle_type: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="driver-vehicle-number">
                    {t('delivery.vehicleNumber')}
                  </Label>
                  <Input
                    id="driver-vehicle-number"
                    value={driverForm.vehicle_number}
                    onChange={(e) =>
                      setDriverForm((f) => ({
                        ...f,
                        vehicle_number: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="driver-notes">{t('delivery.notes')}</Label>
                  <Input
                    id="driver-notes"
                    value={driverForm.notes}
                    onChange={(e) =>
                      setDriverForm((f) => ({ ...f, notes: e.target.value }))
                    }
                  />
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Button type="submit">{t('common.save')}</Button>
                  {editingDriverId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingDriverId(null)
                        setDriverForm(EMPTY_DRIVER)
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                  )}
                  {driverSaved && (
                    <span className="text-sm text-muted-foreground">
                      {t('common.saved')}
                    </span>
                  )}
                  {driverError && (
                    <span className="text-sm text-destructive">
                      {t(driverError)}
                    </span>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            {drivers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t('delivery.noDrivers')}
              </p>
            )}
            {drivers.map((driver) => (
              <div
                key={driver.id}
                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {driver.name}
                    {!driver.is_active && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t('delivery.inactive')}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {[driver.phone, driver.vehicle_type, driver.vehicle_number]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {t(DRIVER_STATUS_KEYS[driver.status])}
                  </span>
                </div>
                <span className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingDriverId(driver.id)
                      setDriverForm({
                        name: driver.name,
                        phone: driver.phone,
                        email: driver.email ?? '',
                        vehicle_type: driver.vehicle_type ?? '',
                        vehicle_number: driver.vehicle_number ?? '',
                        notes: driver.notes ?? '',
                      })
                    }}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleToggleDriver(driver)}
                  >
                    {t(driver.is_active ? 'delivery.deactivate' : 'delivery.activate')}
                  </Button>
                  {confirmDeleteDriverId === driver.id ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleDeleteDriver(driver.id)}
                    >
                      {t('delivery.confirmDelete')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmDeleteDriverId(driver.id)}
                    >
                      {t('common.delete')}
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'zones' && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {t(editingZoneId ? 'delivery.editZone' : 'delivery.addZone')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-4 sm:grid-cols-2"
                onSubmit={handleZoneSubmit}
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="zone-name">{t('delivery.zoneName')}</Label>
                  <Input
                    id="zone-name"
                    value={zoneForm.name}
                    onChange={(e) =>
                      setZoneForm((f) => ({ ...f, name: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="zone-fee">{t('delivery.zoneFee')}</Label>
                  <Input
                    id="zone-fee"
                    type="text"
                    inputMode="decimal"
                    value={zoneForm.fee}
                    onChange={(e) =>
                      setZoneForm((f) => ({ ...f, fee: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="zone-min-order">
                    {t('delivery.zoneMinOrder')}
                  </Label>
                  <Input
                    id="zone-min-order"
                    type="text"
                    inputMode="decimal"
                    value={zoneForm.minOrder}
                    onChange={(e) =>
                      setZoneForm((f) => ({ ...f, minOrder: e.target.value }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="zone-minutes">{t('delivery.zoneMinutes')}</Label>
                  <Input
                    id="zone-minutes"
                    type="text"
                    inputMode="numeric"
                    value={zoneForm.minutes}
                    onChange={(e) =>
                      setZoneForm((f) => ({ ...f, minutes: e.target.value }))
                    }
                  />
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Button type="submit">{t('common.save')}</Button>
                  {editingZoneId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingZoneId(null)
                        setZoneForm(EMPTY_ZONE)
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                  )}
                  {zoneSaved && (
                    <span className="text-sm text-muted-foreground">
                      {t('common.saved')}
                    </span>
                  )}
                  {zoneError && (
                    <span className="text-sm text-destructive">
                      {t(zoneError)}
                    </span>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            {zones.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t('delivery.noZones')}
              </p>
            )}
            {zones.map((zone) => (
              <div
                key={zone.id}
                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {zone.name}
                    {!zone.is_active && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t('delivery.inactive')}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {t('delivery.zoneFee')}: {formatMoney(zone.fee, currency)} ·{' '}
                    {t('delivery.zoneMinOrder')}:{' '}
                    {formatMoney(zone.min_order_amount, currency)}
                    {zone.estimated_minutes
                      ? ` · ${zone.estimated_minutes} ${t('delivery.minutes')}`
                      : ''}
                  </span>
                </div>
                <span className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingZoneId(zone.id)
                      setZoneForm({
                        name: zone.name,
                        fee: String(zone.fee),
                        minOrder: String(zone.min_order_amount),
                        minutes: zone.estimated_minutes
                          ? String(zone.estimated_minutes)
                          : '',
                      })
                    }}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleToggleZone(zone)}
                  >
                    {t(zone.is_active ? 'delivery.deactivate' : 'delivery.activate')}
                  </Button>
                  {confirmDeleteZoneId === zone.id ? (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleDeleteZone(zone.id)}
                    >
                      {t('delivery.confirmDelete')}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmDeleteZoneId(zone.id)}
                    >
                      {t('common.delete')}
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
