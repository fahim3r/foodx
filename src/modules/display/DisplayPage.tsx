import { useCallback, useEffect, useMemo, useState } from 'react'
import { Maximize, Minimize } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/hooks/useAuth'
import { fetchServeBoard } from '@/services/orders'
import { subscribeKitchenOrders } from '@/services/kds'
import type { Order } from '@/types'

/** The restaurant-local calendar day (YYYY-MM-DD) for token scoping. */
function localToday(timezone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

/**
 * Waiting Display (roadmap gap 8a): the customer-facing token board
 * for a TV/monitor at the counter. Shows only token numbers — never
 * prices or names. "Now serving" = most recently served tokens;
 * "Please collect" = tokens READY and waiting. Signed-in staff
 * screen (same deployment model as the KDS); refreshes live.
 */
export default function DisplayPage() {
  const { t } = useTranslation()
  const { restaurant } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [loadError, setLoadError] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const onChange = () =>
      setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    onChange()
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      // Refused: no-op.
    }
  }

  const load = useCallback(async () => {
    if (!restaurant) return
    try {
      setOrders(
        await fetchServeBoard(restaurant.id, localToday(restaurant.timezone)),
      )
      setLoadError(false)
    } catch (error) {
      console.error('[Display] load failed', error)
      setLoadError(true)
    }
  }, [restaurant])

  useEffect(() => {
    void load()
    const interval = setInterval(() => void load(), 10_000)
    const unsubscribe = subscribeKitchenOrders(() => void load())
    return () => {
      clearInterval(interval)
      unsubscribe()
    }
  }, [load])

  const ready = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'READY')
        .sort((a, b) => (a.token_number ?? 0) - (b.token_number ?? 0)),
    [orders],
  )
  const serving = useMemo(
    () =>
      orders
        .filter((o) => o.status === 'SERVED')
        .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at))
        .slice(0, 6),
    [orders],
  )

  if (!restaurant) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="-m-4 flex min-h-screen flex-col bg-zinc-950 p-6 text-zinc-50 sm:-m-6 sm:p-10">
      <header className="flex items-baseline justify-between gap-4 border-b border-zinc-800 pb-4">
        <h1 className="text-2xl font-bold sm:text-3xl">{restaurant.name}</h1>
        <div className="flex items-center gap-3">
          <p className="text-lg text-zinc-400">{t('display.title')}</p>
          {typeof document !== 'undefined' && document.fullscreenEnabled && (
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
            >
              {isFullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
              {isFullscreen
                ? t('common.exitFullscreen')
                : t('common.fullscreen')}
            </button>
          )}
        </div>
      </header>

      {loadError && (
        <p className="mt-4 rounded-md bg-red-950 px-4 py-2 text-center text-red-300">
          {t('display.loadError')}
        </p>
      )}

      <div className="grid flex-1 gap-8 py-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-4 text-xl font-semibold uppercase tracking-wide text-emerald-400">
            {t('display.nowServing')}
          </h2>
          {serving.length === 0 ? (
            <p className="text-2xl text-zinc-500">{t('display.noneServing')}</p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {serving.map((order) => (
                <div
                  key={order.id}
                  className="rounded-2xl bg-emerald-500 px-8 py-6 text-center text-6xl font-black text-emerald-950 shadow-lg"
                >
                  {order.token_number}
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-xl font-semibold uppercase tracking-wide text-amber-400">
            {t('display.readyTitle')}
          </h2>
          {ready.length === 0 ? (
            <p className="text-2xl text-zinc-500">{t('display.noneReady')}</p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {ready.map((order) => (
                <div
                  key={order.id}
                  className="rounded-2xl border-4 border-amber-400 bg-zinc-900 px-8 py-6 text-center text-6xl font-black text-amber-300"
                >
                  {order.token_number}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="border-t border-zinc-800 pt-4 text-center text-zinc-500">
        {t('display.footer')}
      </footer>
    </div>
  )
}
