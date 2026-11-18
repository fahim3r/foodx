// FoodX — elapsed-time helpers (Roadmap Wave 1, gap 4).
//
// Extracted from the KDS waiting-minutes pattern so every surface
// (KDS, Orders list, order detail, Tables) shows the same elapsed
// time from one implementation. Pure presentation: everything is
// derived from timestamps that already exist (an order's
// created_at) — nothing is stored.
import { useEffect, useState } from 'react'

/** Whole minutes between an ISO timestamp and `now`, never negative. */
export function elapsedMinutes(isoString: string, now: number): number {
  return Math.max(
    0,
    Math.floor((now - new Date(isoString).getTime()) / 60_000),
  )
}

/** A ticking clock for elapsed displays (30 s by default). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/** Elapsed-chip urgency thresholds (minutes). */
export const ELAPSED_WARN_MINUTES = 30
export const ELAPSED_ALERT_MINUTES = 60

export function elapsedChipClass(minutes: number): string {
  if (minutes >= ELAPSED_ALERT_MINUTES) return 'bg-red-100 text-red-800'
  if (minutes >= ELAPSED_WARN_MINUTES) return 'bg-amber-100 text-amber-800'
  return 'bg-muted text-muted-foreground'
}
