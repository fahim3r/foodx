import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import {
  createReservation,
  fetchReservations,
  findOverlap,
  setReservationStatus,
} from '@/services/reservations'
import { fetchTables } from '@/services/tables'
import type { DiningTable, Reservation, ReservationStatus } from '@/types'

const SELECT_CLASSNAME =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm'

const STATUS_STYLES: Record<ReservationStatus, string> = {
  BOOKED: 'bg-sky-100 text-sky-800',
  ARRIVED: 'bg-amber-100 text-amber-800',
  SEATED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-zinc-200 text-zinc-600',
  NO_SHOW: 'bg-red-100 text-red-700',
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function isToday(iso: string): boolean {
  return dayKey(iso) === dayKey(new Date().toISOString())
}

/**
 * Reservations (roadmap gap 8b): the booking book. Create bookings
 * with a soft overlap warning, then work the lifecycle
 * BOOKED → ARRIVED → SEATED (or Cancelled / No-show). v1 does not
 * touch table status — seating the party is a staff action.
 */
export default function ReservationsPage() {
  const { t } = useTranslation()
  const { user, restaurant } = useAuth()
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [tables, setTables] = useState<DiningTable[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [actingId, setActingId] = useState<string | null>(null)

  // Create form
  const [guestName, setGuestName] = useState('')
  const [guestPhone, setGuestPhone] = useState('')
  const [date, setDate] = useState(() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })
  const [time, setTime] = useState('19:00')
  const [partySize, setPartySize] = useState('2')
  const [tableId, setTableId] = useState('')
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedNote, setSavedNote] = useState(false)

  const load = useCallback(async () => {
    if (!restaurant) return
    try {
      const [rows, tableRows] = await Promise.all([
        fetchReservations(restaurant.id),
        fetchTables(restaurant.id).catch(() => [] as DiningTable[]),
      ])
      setReservations(rows)
      setTables(tableRows)
      setLoadError(false)
    } catch (error) {
      console.error('[Reservations] load failed', error)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [restaurant])

  useEffect(() => {
    void load()
  }, [load])

  const tableName = useCallback(
    (id: string | null) =>
      id ? (tables.find((tb) => tb.id === id)?.name ?? '') : '',
    [tables],
  )

  const reservedForIso = useMemo(() => {
    const when = new Date(`${date}T${time}:00`)
    return Number.isNaN(+when) ? null : when.toISOString()
  }, [date, time])

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurant || !user || !reservedForIso) return
    setFormError(null)
    setSavedNote(false)
    if (!guestName.trim()) {
      setFormError('reservations.nameRequired')
      return
    }
    const size = Number(partySize)
    if (!Number.isFinite(size) || size < 1) {
      setFormError('reservations.partyInvalid')
      return
    }
    // Soft overlap warning: first submit warns, second confirms.
    const overlap = findOverlap(reservations, tableId || null, reservedForIso)
    if (overlap && !overlapWarning) {
      setOverlapWarning(
        t('reservations.overlapWarning', {
          name: overlap.guest_name,
          time: new Date(overlap.reserved_for).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          }),
        }),
      )
      return
    }
    setSaving(true)
    try {
      await createReservation(restaurant.id, user.id, {
        guestName,
        guestPhone,
        reservedFor: reservedForIso,
        partySize: Math.floor(size),
        tableId: tableId || null,
        notes,
      })
      setGuestName('')
      setGuestPhone('')
      setNotes('')
      setTableId('')
      setOverlapWarning(null)
      setSavedNote(true)
      await load()
    } catch (error) {
      console.error('[Reservations] create failed', error)
      setFormError('reservations.saveFailed')
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (row: Reservation, status: ReservationStatus) => {
    setActingId(row.id)
    try {
      await setReservationStatus(row.id, status)
      await load()
    } catch (error) {
      console.error('[Reservations] status failed', error)
    } finally {
      setActingId(null)
    }
  }

  const groups = useMemo(() => {
    const today: Reservation[] = []
    const upcoming: Reservation[] = []
    for (const row of reservations) {
      ;(isToday(row.reserved_for) ? today : upcoming).push(row)
    }
    return { today, upcoming }
  }, [reservations])

  const renderRow = (row: Reservation) => (
    <div
      key={row.id}
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
    >
      <div className="flex flex-col gap-0.5">
        <p className="font-medium">
          {row.guest_name}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {new Date(row.reserved_for).toLocaleString([], {
              weekday: 'short',
              hour: 'numeric',
              minute: '2-digit',
              day: 'numeric',
              month: 'short',
            })}
          </span>
        </p>
        <p className="text-sm text-muted-foreground">
          {t('reservations.partyOf', { count: row.party_size })}
          {row.table_id ? ` · ${t('orders.table')} ${tableName(row.table_id)}` : ''}
          {row.guest_phone ? ` · ${row.guest_phone}` : ''}
        </p>
        {row.notes && <p className="text-sm">{row.notes}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[row.status]}`}
        >
          {t(`reservations.status${row.status}`)}
        </span>
        {row.status === 'BOOKED' && (
          <>
            <Button
              size="sm"
              disabled={actingId === row.id}
              onClick={() => void changeStatus(row, 'ARRIVED')}
            >
              {t('reservations.markArrived')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={actingId === row.id}
              onClick={() => void changeStatus(row, 'NO_SHOW')}
            >
              {t('reservations.markNoShow')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={actingId === row.id}
              onClick={() => void changeStatus(row, 'CANCELLED')}
            >
              {t('common.cancel')}
            </Button>
          </>
        )}
        {row.status === 'ARRIVED' && (
          <Button
            size="sm"
            disabled={actingId === row.id}
            onClick={() => void changeStatus(row, 'SEATED')}
          >
            {t('reservations.markSeated')}
          </Button>
        )}
      </div>
    </div>
  )

  if (!restaurant) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{t('reservations.title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('reservations.newTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleCreate}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="resName">{t('reservations.guestName')}</Label>
              <Input
                id="resName"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="resPhone">{t('reservations.guestPhone')}</Label>
              <Input
                id="resPhone"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="resTable">{t('reservations.tableOptional')}</Label>
              <select
                id="resTable"
                value={tableId}
                onChange={(e) => {
                  setTableId(e.target.value)
                  setOverlapWarning(null)
                }}
                className={SELECT_CLASSNAME}
              >
                <option value="">{t('reservations.noTable')}</option>
                {tables.map((tb) => (
                  <option key={tb.id} value={tb.id}>
                    {tb.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="resDate">{t('reservations.date')}</Label>
              <Input
                id="resDate"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="resTime">{t('reservations.time')}</Label>
              <Input
                id="resTime"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="resParty">{t('reservations.partySize')}</Label>
              <Input
                id="resParty"
                type="number"
                min={1}
                value={partySize}
                onChange={(e) => setPartySize(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
              <Label htmlFor="resNotes">{t('reservations.notes')}</Label>
              <Input
                id="resNotes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            {overlapWarning && (
              <p className="text-sm font-medium text-amber-600 sm:col-span-2 lg:col-span-3">
                {overlapWarning} {t('reservations.overlapConfirm')}
              </p>
            )}
            {formError && (
              <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-3">
                {t(formError)}
              </p>
            )}
            {savedNote && (
              <p className="text-sm text-green-600 sm:col-span-2 lg:col-span-3">
                {t('reservations.saved')}
              </p>
            )}
            <div>
              <Button type="submit" disabled={saving}>
                {t('reservations.create')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : loadError ? (
        <p className="text-sm text-destructive">{t('reservations.loadError')}</p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{t('reservations.today')}</h2>
            {groups.today.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('reservations.noneToday')}
              </p>
            ) : (
              groups.today.map(renderRow)
            )}
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{t('reservations.upcoming')}</h2>
            {groups.upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('reservations.noneUpcoming')}
              </p>
            ) : (
              groups.upcoming.map(renderRow)
            )}
          </section>
        </>
      )}
    </div>
  )
}
