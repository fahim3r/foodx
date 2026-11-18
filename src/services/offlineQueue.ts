// FoodX — offline order queue (Phase 9 v1, master prompt §5).
//
// When the POS loses connectivity, placed orders are captured here —
// in localStorage, scoped per restaurant — with everything §5 asks
// of a synchronized transaction: a unique ID (the order UUID, which
// is also the idempotency key), a device ID, a timestamp, a source
// marker and a sync status. When connectivity returns, the sync
// runner (hooks/useOfflineSync) replays each entry through
// pos.syncQueuedOrder and removes it; entries that fail validation
// are marked 'failed' and stay visible in the POS queue panel —
// they are never silently dropped.

import type { CreateOrderInput, OrderTotals, PaymentMethod } from '@/types'
import type { PricedLine } from '@/services/pos'

export interface QueuedPayment {
  /** The payment row's id — its idempotency key at sync time. */
  id: string
  method: PaymentMethod
  amount: number
  reference: string | null
}

export interface QueuedOrder {
  /** The order UUID — the idempotency key for the whole entry. */
  id: string
  deviceId: string
  restaurantId: string
  queuedAt: string
  source: 'pos_offline'
  status: 'queued' | 'failed'
  /** Machine code of the last validation failure (e.g.
   * 'sync_product_missing'); null while merely waiting. */
  failureReason: string | null
  attempts: number
  lastAttemptAt: string | null
  /** The placement input (ids + quantities only, as the POS builds
   * it). Offline entries never carry a customer, coupon or loyalty
   * redemption — those need live validation (design D2). */
  input: CreateOrderInput
  /** Price snapshot from the catalog loaded on this device — the
   * prices the customer was actually charged (§69). */
  pricedLines: PricedLine[]
  totals: OrderTotals
  /** Settings rates captured at queue time, so sync can recompute
   * the totals from the snapshot and compare (design D1). */
  taxRate: number
  serviceChargeRate: number
  payments: QueuedPayment[]
}

export const OFFLINE_QUEUE_UPDATED_EVENT = 'foodx-offline-queue-updated'

const DEVICE_ID_KEY = 'foodx.device_id'

function queueKey(restaurantId: string): string {
  return `foodx.offline_queue.${restaurantId}`
}

/** This browser/device's stable ID (§5 Device ID), generated once. */
export function getDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY)
    if (existing) return existing
    const id = crypto.randomUUID()
    window.localStorage.setItem(DEVICE_ID_KEY, id)
    return id
  } catch {
    return 'unknown-device'
  }
}

export function loadQueue(restaurantId: string): QueuedOrder[] {
  try {
    const raw = window.localStorage.getItem(queueKey(restaurantId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as QueuedOrder[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveQueue(restaurantId: string, entries: QueuedOrder[]): void {
  try {
    window.localStorage.setItem(queueKey(restaurantId), JSON.stringify(entries))
  } catch {
    // Storage full or unavailable: the in-memory caller still holds
    // the entry; the POS surfaces queue counts from these reads, so
    // a failed write shows up as a missing entry rather than a
    // crash. (Quota is ~5 MB; one entry is ~1–2 KB.)
  }
  window.dispatchEvent(new Event(OFFLINE_QUEUE_UPDATED_EVENT))
}

export function enqueueOrder(entry: QueuedOrder): void {
  const entries = loadQueue(entry.restaurantId)
  entries.push(entry)
  saveQueue(entry.restaurantId, entries)
}

export function updateEntry(
  restaurantId: string,
  entryId: string,
  patch: Partial<QueuedOrder>,
): QueuedOrder | null {
  const entries = loadQueue(restaurantId)
  const index = entries.findIndex((e) => e.id === entryId)
  if (index === -1) return null
  entries[index] = { ...entries[index], ...patch }
  saveQueue(restaurantId, entries)
  return entries[index]
}

export function removeEntry(restaurantId: string, entryId: string): void {
  saveQueue(
    restaurantId,
    loadQueue(restaurantId).filter((e) => e.id !== entryId),
  )
}

/** Append a payment taken at the counter to a queued entry. */
export function addQueuedPayment(
  restaurantId: string,
  entryId: string,
  payment: QueuedPayment,
): QueuedOrder | null {
  const entries = loadQueue(restaurantId)
  const index = entries.findIndex((e) => e.id === entryId)
  if (index === -1) return null
  entries[index] = {
    ...entries[index],
    payments: [...entries[index].payments, payment],
  }
  saveQueue(restaurantId, entries)
  return entries[index]
}

export function queueCounts(entries: QueuedOrder[]): {
  waiting: number
  failed: number
} {
  return {
    waiting: entries.filter((e) => e.status === 'queued').length,
    failed: entries.filter((e) => e.status === 'failed').length,
  }
}

/** Short human reference for a queued order, e.g. OFF-3F9A2C41.
 * This is a LOCAL reference only — the real order number is
 * assigned at sync time and is never pre-printed. */
export function localRef(entryId: string): string {
  return `OFF-${entryId.slice(0, 8).toUpperCase()}`
}
