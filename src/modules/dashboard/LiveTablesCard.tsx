import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Bell, Bookmark, Check, Clock, Sparkles } from 'lucide-react'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { formatMoney } from '@/lib/money'
import { elapsedMinutes, useNow } from '@/lib/time'
import { subscribeKitchenOrders } from '@/services/kds'
import {
  fetchOpenTableOrders,
  fetchTables,
  type OpenTableOrderSummary,
} from '@/services/tables'
import {
  fetchPendingWaiterCalls,
  subscribeWaiterCalls,
} from '@/services/waiterCalls'
import type { DiningTable } from '@/types'

const POLL_MS = 15_000

type FloorState = 'free' | 'occupied' | 'cleaning' | 'reserved'

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`
}

const SPARKLE_PATH =
  'M0,-9 L2.2,-2.2 L9,0 L2.2,2.2 L0,9 L-2.2,2.2 L-9,0 L-2.2,-2.2 Z'

/**
 * One table as a small isometric 3D scene: a wooden round table on a
 * floor tile with stools. Occupied tables seat two guests with plates
 * and a drink; a table being cleaned carries a spray bottle, a cloth
 * and sparkles; a reserved table carries a little table sign; a free
 * table stands bare inside a soft green ring.
 */
function TableScene({ state }: { state: FloorState }) {
  const occupied = state === 'occupied'
  return (
    <svg
      viewBox="0 0 220 118"
      className="h-auto w-full"
      role="img"
      aria-hidden="true"
    >
      {/* Floor tile + ground shadow */}
      <polygon points="110,6 208,54 110,102 12,54" fill="#f4ecdc" />
      <polygon
        points="110,6 208,54 110,102 12,54"
        fill="none"
        stroke="#e3d5b8"
        strokeWidth="1.5"
      />
      <ellipse cx="110" cy="102" rx="64" ry="8" fill="#3f2d12" opacity="0.1" />
      {occupied && (
        <ellipse cx="110" cy="62" rx="68" ry="25" fill="#fb923c" opacity="0.16" />
      )}

      {/* Back stool */}
      <g stroke="#b08d57" strokeWidth="2.5" strokeLinecap="round">
        <line x1="103" y1="40" x2="103" y2="50" />
        <line x1="117" y1="40" x2="117" y2="50" />
      </g>
      <ellipse cx="110" cy="38" rx="14" ry="6" fill="#d9c096" />
      {/* Side stools */}
      <g stroke="#b08d57" strokeWidth="2.5" strokeLinecap="round">
        <line x1="30" y1="74" x2="30" y2="84" />
        <line x1="44" y1="74" x2="44" y2="84" />
        <line x1="176" y1="74" x2="176" y2="84" />
        <line x1="190" y1="74" x2="190" y2="84" />
      </g>
      <ellipse cx="37" cy="72" rx="13" ry="5.5" fill="#d9c096" />
      <ellipse cx="183" cy="72" rx="13" ry="5.5" fill="#d9c096" />

      {/* Table: pedestal, base, rim, top */}
      <rect x="104" y="68" width="12" height="24" fill="#96682f" />
      <ellipse cx="110" cy="94" rx="24" ry="6" fill="#7c5527" />
      <ellipse cx="110" cy="60" rx="50" ry="19" fill="#a9713a" />
      <ellipse cx="110" cy="56" rx="50" ry="19" fill="#cf9250" />
      <ellipse cx="110" cy="56" rx="37" ry="13" fill="#dba35e" opacity="0.85" />

      {occupied && (
        <>
          {/* Plates + drink on the table */}
          <ellipse
            cx="94"
            cy="54"
            rx="10"
            ry="4"
            fill="#ffffff"
            stroke="#e7e0cf"
          />
          <circle cx="94" cy="53.5" r="2.4" fill="#e2703a" />
          <circle cx="91" cy="55" r="1.4" fill="#7ba05b" />
          <ellipse
            cx="126"
            cy="60"
            rx="10"
            ry="4"
            fill="#ffffff"
            stroke="#e7e0cf"
          />
          <circle cx="126" cy="59.5" r="2.4" fill="#b5542d" />
          <circle cx="129" cy="61" r="1.4" fill="#7ba05b" />
          <rect x="138" y="42" width="5" height="10" rx="1" fill="#f59e0b" opacity="0.9" />
          <line
            x1="141"
            y1="42"
            x2="144"
            y2="36"
            stroke="#dc2626"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          {/* Two seated guests */}
          <path d="M24,78 Q24,50 39,48 Q54,50 54,78 Z" fill="#5b7fa6" />
          <circle cx="39" cy="38" r="8.5" fill="#eab892" />
          <path d="M30.5,38 a8.5,8.5 0 0 1 17,0 Z" fill="#4a3728" />
          <path d="M166,78 Q166,50 181,48 Q196,50 196,78 Z" fill="#c96f4a" />
          <circle cx="181" cy="38" r="8.5" fill="#d99e73" />
          <path d="M172.5,38 a8.5,8.5 0 0 1 17,0 Z" fill="#26221f" />
        </>
      )}

      {state === 'cleaning' && (
        <>
          {/* Spray bottle + cloth on the table, sparkles around */}
          <rect x="90" y="40" width="10" height="14" rx="2.5" fill="#38bdf8" />
          <rect x="90" y="36" width="14" height="4.5" rx="1.5" fill="#0369a1" />
          <rect x="102" y="33.5" width="6" height="3" rx="1" fill="#0369a1" />
          <path
            d="M122,58 q9,-7 19,-1 q-1,8 -10,8 q-9,0 -9,-7 Z"
            fill="#bae6fd"
            stroke="#7dd3fc"
          />
          <path
            d={SPARKLE_PATH}
            transform="translate(152,22)"
            fill="#f59e0b"
            className="animate-pulse"
          />
          <path
            d={SPARKLE_PATH}
            transform="translate(62,16) scale(0.7)"
            fill="#f59e0b"
            className="animate-pulse"
            style={{ animationDelay: '0.4s' }}
          />
          <path
            d={SPARKLE_PATH}
            transform="translate(176,42) scale(0.55)"
            fill="#f59e0b"
            className="animate-pulse"
            style={{ animationDelay: '0.8s' }}
          />
        </>
      )}

      {state === 'reserved' && (
        <>
          {/* Little reserved sign standing on the table */}
          <rect x="108.5" y="38" width="3" height="13" fill="#92400e" />
          <rect x="97" y="27" width="26" height="12" rx="2.5" fill="#f59e0b" />
          <rect x="101" y="32" width="18" height="2.5" rx="1" fill="#fff7ed" opacity="0.85" />
        </>
      )}

      {state === 'free' && (
        <ellipse
          cx="110"
          cy="94"
          rx="30"
          ry="7.5"
          fill="none"
          stroke="#22c55e"
          strokeWidth="2"
          strokeDasharray="5 5"
          opacity="0.5"
        />
      )}
    </svg>
  )
}

const CELL_STATE_CLASSES: Record<FloorState, string> = {
  free: 'border-border bg-muted/20',
  occupied:
    'border-orange-300 bg-orange-50/60 dark:border-orange-500/40 dark:bg-orange-500/5',
  cleaning:
    'border-sky-300/80 bg-sky-50/50 dark:border-sky-500/30 dark:bg-sky-500/5',
  reserved:
    'border-amber-300/80 bg-amber-50/40 dark:border-amber-500/30 dark:bg-amber-500/5',
}

/**
 * Live Tables — the restaurant floor at a glance on the Dashboard.
 * Every table renders as a small 3D scene whose look follows its real
 * state: guests seated while an order is open (with the elapsed time
 * and running total), a cleaning scene while the table is being
 * cleaned, a sign when reserved, bare when free. A pending "Call
 * waiter" (migration 0038) rings a bouncing bell over the table.
 * Data refreshes on mount, on realtime events (orders + waiter
 * calls) and on a 15 s poll fallback — the same live idiom as the
 * waiter-call strip. Clicking an occupied table opens its earliest
 * open order; any other table opens the Tables page.
 */
export default function LiveTablesCard({
  restaurantId,
  currency,
  showFinancials,
  navTo,
}: {
  restaurantId: string
  currency: string
  showFinancials: boolean
  navTo: (to: string) => string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const now = useNow(POLL_MS)
  const [tables, setTables] = useState<DiningTable[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [openByTable, setOpenByTable] = useState<
    Map<string, OpenTableOrderSummary>
  >(new Map())
  const [callingTables, setCallingTables] = useState<Set<string>>(new Set())
  const loadedOnce = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const rows = await fetchTables(restaurantId)
      loadedOnce.current = true
      setFailed(false)
      setTables(rows)
    } catch {
      // Keep the last good floor; hide the card only when the very
      // first read failed (the dashboard's honest-hide pattern).
      if (!loadedOnce.current) setFailed(true)
    }
    try {
      setOpenByTable(await fetchOpenTableOrders(restaurantId))
    } catch {
      // Keep the last good rollup; the next refresh retries.
    }
    try {
      const calls = await fetchPendingWaiterCalls(restaurantId)
      setCallingTables(new Set(calls.map((call) => call.tableId)))
    } catch {
      // Keep the last good call set; the next refresh retries.
    }
  }, [restaurantId])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, POLL_MS)
    const unsubscribeCalls = subscribeWaiterCalls(restaurantId, () => {
      void refresh()
    })
    const unsubscribeOrders = subscribeKitchenOrders(() => {
      void refresh()
    }, 'dashboard-live-tables')
    return () => {
      window.clearInterval(timer)
      unsubscribeCalls()
      unsubscribeOrders()
    }
  }, [restaurantId, refresh])

  if (failed && tables === null) return null

  const stateOf = (table: DiningTable): FloorState => {
    if (
      table.status === 'occupied' ||
      openByTable.has(table.id) ||
      callingTables.has(table.id)
    ) {
      return 'occupied'
    }
    if (table.status === 'cleaning') return 'cleaning'
    if (table.status === 'reserved') return 'reserved'
    return 'free'
  }

  const counts: Record<FloorState, number> = {
    free: 0,
    occupied: 0,
    cleaning: 0,
    reserved: 0,
  }
  if (tables) {
    for (const table of tables) counts[stateOf(table)] += 1
  }
  const callingCount = tables
    ? tables.filter((table) => callingTables.has(table.id)).length
    : 0

  const openTable = (table: DiningTable) => {
    const open = openByTable.get(table.id)
    navigate(navTo(open ? `/orders/${open.orderId}` : '/tables'))
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="flex items-center gap-2">
          {t('dashboard.liveTablesTitle')}
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
        </CardTitle>
        {tables && tables.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {t('dashboard.liveTablesInUse', {
              occupied: counts.occupied,
              total: tables.length,
            })}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {tables === null ? (
          <div className="h-44 animate-pulse rounded-xl bg-muted" aria-hidden="true" />
        ) : tables.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('dashboard.liveTablesEmpty')}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {tables.map((table) => {
                const state = stateOf(table)
                const open = openByTable.get(table.id)
                const calling = callingTables.has(table.id)
                return (
                  <button
                    key={table.id}
                    type="button"
                    onClick={() => openTable(table)}
                    className={`relative flex flex-col rounded-2xl border p-2 text-left transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      calling
                        ? 'border-amber-400 bg-amber-50/70 ring-1 ring-amber-300 dark:bg-amber-500/10'
                        : CELL_STATE_CLASSES[state]
                    }`}
                  >
                    <span className="absolute left-2 top-2 z-10 rounded-full border bg-background/90 px-2 py-0.5 text-xs font-bold shadow-sm">
                      {table.name}
                    </span>
                    {calling && (
                      <span className="absolute right-2 top-2 z-10 flex animate-bounce items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white shadow">
                        <Bell className="size-3" />
                        {t('dashboard.liveTablesCalling')}
                      </span>
                    )}
                    <TableScene state={state} />
                    <span className="mt-1 flex items-center justify-center gap-1.5 text-xs font-semibold">
                      {state === 'occupied' &&
                        (open ? (
                          <span className="flex items-center gap-1 text-orange-600 dark:text-orange-400">
                            <Clock className="size-3.5" />
                            {formatDuration(elapsedMinutes(open.since, now))}
                            {showFinancials &&
                              ` · ${formatMoney(open.total, currency)}`}
                            {open.count > 1 && ` (${open.count})`}
                          </span>
                        ) : (
                          <span className="text-orange-600 dark:text-orange-400">
                            {t('dashboard.liveTablesOccupied')}
                          </span>
                        ))}
                      {state === 'free' && (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <Check className="size-3.5" />
                          {t('dashboard.liveTablesFree')}
                        </span>
                      )}
                      {state === 'cleaning' && (
                        <span className="flex items-center gap-1 text-sky-600 dark:text-sky-400">
                          <Sparkles className="size-3.5" />
                          {t('dashboard.liveTablesCleaning')}
                        </span>
                      )}
                      {state === 'reserved' && (
                        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                          <Bookmark className="size-3.5" />
                          {t('dashboard.liveTablesReserved')}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-orange-500" />
                {t('dashboard.liveTablesOccupied')} · {counts.occupied}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-500" />
                {t('dashboard.liveTablesFree')} · {counts.free}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-amber-500" />
                {t('dashboard.liveTablesReserved')} · {counts.reserved}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-sky-500" />
                {t('dashboard.liveTablesCleaning')} · {counts.cleaning}
              </span>
              {callingCount > 0 && (
                <span className="flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
                  <Bell className="size-3.5" />
                  {t('dashboard.liveTablesCalling')} · {callingCount}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
