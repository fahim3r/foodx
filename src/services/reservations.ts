import { supabase } from '@/lib/supabase'
import type { Reservation, ReservationStatus } from '@/types'

/**
 * Reservations (migration 0026, roadmap gap 8b). Bookings are plain
 * records scoped by RLS to the caller's restaurant; status moves are
 * simple updates — there is no delete, cancellation is a status.
 */

/** Reservations from the start of today onwards (plus today's
 * earlier ones, so the desk sees the whole day), newest booking
 * time last within each day is handled by the page grouping. */
export async function fetchReservations(
  restaurantId: string,
): Promise<Reservation[]> {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from('reservations')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .gte('reserved_for', startOfToday.toISOString())
    .order('reserved_for', { ascending: true })
    .limit(200)
  if (error) throw error
  return (data ?? []) as Reservation[]
}

export interface ReservationInput {
  guestName: string
  guestPhone?: string
  reservedFor: string // ISO instant
  partySize: number
  tableId?: string | null
  notes?: string
}

export async function createReservation(
  restaurantId: string,
  userId: string,
  input: ReservationInput,
): Promise<Reservation> {
  const { data, error } = await supabase
    .from('reservations')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      table_id: input.tableId || null,
      guest_name: input.guestName.trim(),
      guest_phone: input.guestPhone?.trim() || null,
      reserved_for: input.reservedFor,
      party_size: input.partySize,
      notes: input.notes?.trim() || null,
      created_by: userId,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Reservation
}

export async function setReservationStatus(
  reservationId: string,
  status: ReservationStatus,
): Promise<void> {
  const { error } = await supabase
    .from('reservations')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', reservationId)
  if (error) throw error
}

/**
 * Soft overlap check for the create form: other BOOKED/ARRIVED
 * reservations for the same table within ±2 hours. A warning, never
 * a block — the caller decides.
 */
export function findOverlap(
  reservations: Reservation[],
  tableId: string | null,
  reservedForIso: string,
): Reservation | null {
  if (!tableId) return null
  const when = +new Date(reservedForIso)
  const windowMs = 2 * 60 * 60 * 1000
  return (
    reservations.find(
      (r) =>
        r.table_id === tableId &&
        (r.status === 'BOOKED' || r.status === 'ARRIVED') &&
        Math.abs(+new Date(r.reserved_for) - when) < windowMs,
    ) ?? null
  )
}
