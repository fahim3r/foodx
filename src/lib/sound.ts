/**
 * Sound effects (Sound Effects feature, 2026-11-22; design D3/D4/D7,
 * v1.1 addendum §7b). Five tiny sounds synthesised with WebAudio —
 * no audio files (the GitHub connector cannot carry binaries, and
 * these don't need any):
 *   - new order: two-tone doorbell, E5 → C5 — LOOPED by the alert
 *     manager below until the order is acted on (min 5 s)
 *   - order ready: ascending triple, C5 → E5 → G5 — LOOPED the
 *     same way while the order sits READY (min 5 s)
 *   - payment recorded: single soft blip, 990 Hz (one-shot)
 *   - order completed: success motif, C5 → E5 → G5 → C6 with a
 *     sustained finish (one-shot, v1.1)
 *   - order cancelled: soft descending "failed" tone, G4 → E♭4
 *     (one-shot, v1.1) — a gentle uh-oh, never a buzzer
 * Browsers refuse audio before a user gesture, so one shared
 * AudioContext is created lazily and resumed on the first
 * pointerdown/keydown in the panel (installed by initSound, called
 * from AppLayout). Before that gesture the panel is simply silent.
 * EVERYTHING here is best-effort: any failure is swallowed — sound
 * must never throw into UI code or break the panel.
 */
import {
  loadSoundSettings,
  type SoundSettings,
} from '@/services/soundSettings'

export type SoundKind =
  | 'newOrder'
  | 'ready'
  | 'payment'
  | 'complete'
  | 'cancelled'

/** The two LOOPING alerts (v1.1). Payment and complete stay one-shot. */
export type AlertKind = 'new' | 'ready'

let context: AudioContext | null = null
let masterGain: GainNode | null = null
let unlockInstalled = false
let currentRestaurantId: string | null = null

/** Orders placed from THIS tab (design D7). The order watcher skips
 * the arrival chime for these on this device only; their READY
 * transition still chimes. In-memory on purpose: a reload
 * re-baselines the watcher, so nothing replays. */
const selfPlacedOrderIds = new Set<string>()

export function noteSelfPlacedOrder(orderId: string): void {
  selfPlacedOrderIds.add(orderId)
}

export function isSelfPlacedOrder(orderId: string): boolean {
  return selfPlacedOrderIds.has(orderId)
}

function ensureContext(): AudioContext | null {
  try {
    if (typeof window === 'undefined') return null
    if (!context) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!Ctor) return null
      context = new Ctor()
      masterGain = context.createGain()
      masterGain.gain.value = 0.18
      masterGain.connect(context.destination)
    }
    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined)
    }
    return context
  } catch {
    return null
  }
}

/**
 * Wire up sound for the signed-in restaurant: remembers which
 * restaurant's per-device settings apply and installs the one-time
 * audio-unlock listeners. Safe to call on every restaurant change.
 */
export function initSound(restaurantId: string | null): void {
  currentRestaurantId = restaurantId
  if (unlockInstalled || typeof window === 'undefined') return
  unlockInstalled = true
  const unlock = () => {
    ensureContext()
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
}

/** One sine note with a fast attack and a soft exponential decay. */
function tone(
  ctx: AudioContext,
  gain: GainNode,
  frequency: number,
  offsetSeconds: number,
  durationSeconds: number,
): void {
  const start = ctx.currentTime + offsetSeconds
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = frequency
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(1, start + 0.015)
  env.gain.exponentialRampToValueAtTime(0.0001, start + durationSeconds)
  osc.connect(env)
  env.connect(gain)
  osc.start(start)
  osc.stop(start + durationSeconds + 0.05)
}

function play(kind: SoundKind): void {
  try {
    const ctx = ensureContext()
    if (!ctx || !masterGain) return
    if (kind === 'newOrder') {
      tone(ctx, masterGain, 659.26, 0, 0.32) // E5
      tone(ctx, masterGain, 523.25, 0.17, 0.38) // C5
    } else if (kind === 'ready') {
      tone(ctx, masterGain, 523.25, 0, 0.24) // C5
      tone(ctx, masterGain, 659.26, 0.11, 0.24) // E5
      tone(ctx, masterGain, 783.99, 0.22, 0.34) // G5
    } else if (kind === 'complete') {
      // Success motif (v1.1): the ready triple extended up to C6,
      // the last note held with a soft decay so it lands as "done".
      tone(ctx, masterGain, 523.25, 0, 0.22) // C5
      tone(ctx, masterGain, 659.26, 0.09, 0.22) // E5
      tone(ctx, masterGain, 783.99, 0.18, 0.26) // G5
      tone(ctx, masterGain, 1046.5, 0.27, 0.6) // C6, sustained finish
    } else if (kind === 'cancelled') {
      // Failed tone (v1.1): two descending tones — clearly negative
      // next to the ascending motifs, but soft sine, never harsh.
      tone(ctx, masterGain, 392.0, 0, 0.22) // G4
      tone(ctx, masterGain, 311.13, 0.16, 0.36) // E♭4, falling finish
    } else {
      tone(ctx, masterGain, 990, 0, 0.12)
    }
  } catch {
    // Sound is decoration: a failed chime must never surface.
  }
}

function settingsNow(): SoundSettings | null {
  if (!currentRestaurantId) return null
  return loadSoundSettings(currentRestaurantId)
}

function playIfEnabled(kind: SoundKind): void {
  const settings = settingsNow()
  if (!settings || !settings.master || !settings[kind]) return
  play(kind)
}

/** New-order doorbell, one-shot (the watcher normally drives the
 * looping alert below; this stays for any one-shot caller). */
export function playNewOrderChime(): void {
  playIfEnabled('newOrder')
}

/** Order-ready triple, one-shot (see playNewOrderChime). */
export function playReadyChime(): void {
  playIfEnabled('ready')
}

/** Payment blip (UI success branches only; design D6). */
export function playPaymentBlip(): void {
  playIfEnabled('payment')
}

/** Order-completed success motif (watcher, v1.1). One-shot. */
export function playCompleteSound(): void {
  playIfEnabled('complete')
}

/** Order-cancelled failed tone (watcher, v1.1). One-shot. */
export function playCancelledSound(): void {
  playIfEnabled('cancelled')
}

/**
 * Settings Test buttons: an explicit tap in Settings, so the sound
 * plays even while that event (or the master) is still off — the
 * tap is also the gesture that unlocks audio on this device (D3).
 */
export function playTestSound(kind: SoundKind): void {
  play(kind)
}

/* ------------------------------------------------------------------
 * Alert loops (v1.1, design §7b). The v1 one-shot chimes were too
 * short to register in a busy kitchen, so the new-order doorbell and
 * the ready triple now REPEAT until the order is acted on:
 *   - a loop plays its chime immediately, then on a fixed interval
 *     (doorbell ~2.2 s, ready ~2.4 s — each chime is ~0.6 s, so the
 *     repeats never overlap);
 *   - stopAlert() only REQUESTS a stop: the loop actually stops at
 *     the first interval tick at or after 5 s from its start, so an
 *     alert always rings for at least 5 s even if the order is
 *     acted on sooner;
 *   - with no stop requested the loop runs until a 5-minute safety
 *     cap, then stops on its own (a forgotten tab must not ring
 *     all day);
 *   - stopAlertNow()/stopAllAlerts() cut a loop IMMEDIATELY — used
 *     when the master or the event toggle is switched off, and on
 *     watcher unmount.
 * Each kind has at most one loop; starting an already-running loop
 * just cancels any pending stop (a fresh un-acted order arrived).
 * ------------------------------------------------------------------ */

const ALERT_MIN_MS = 5_000
const ALERT_MAX_MS = 5 * 60_000
const ALERT_INTERVAL_MS: Record<AlertKind, number> = {
  new: 2_200,
  ready: 2_400,
}

interface AlertLoop {
  timer: number
  startedAt: number
  stopRequested: boolean
}

const alertLoops = new Map<AlertKind, AlertLoop>()

function alertSoundKind(kind: AlertKind): SoundKind {
  return kind === 'new' ? 'newOrder' : 'ready'
}

export function startAlert(kind: AlertKind): void {
  try {
    const existing = alertLoops.get(kind)
    if (existing) {
      existing.stopRequested = false
      return
    }
    if (typeof window === 'undefined') return
    const loop: AlertLoop = { timer: 0, startedAt: Date.now(), stopRequested: false }
    alertLoops.set(kind, loop)
    playIfEnabled(alertSoundKind(kind))
    loop.timer = window.setInterval(() => {
      const elapsed = Date.now() - loop.startedAt
      if (elapsed >= ALERT_MAX_MS) {
        stopAlertNow(kind)
        return
      }
      if (loop.stopRequested && elapsed >= ALERT_MIN_MS) {
        stopAlertNow(kind)
        return
      }
      playIfEnabled(alertSoundKind(kind))
    }, ALERT_INTERVAL_MS[kind])
  } catch {
    // Sound is decoration: a failed alert must never surface.
  }
}

/** Request a stop: honoured at the first tick at/after the 5 s
 * minimum (see the loop notes above). */
export function stopAlert(kind: AlertKind): void {
  const loop = alertLoops.get(kind)
  if (loop) loop.stopRequested = true
}

/** Stop a loop right now, ignoring the 5 s minimum. */
export function stopAlertNow(kind: AlertKind): void {
  const loop = alertLoops.get(kind)
  if (!loop) return
  if (typeof window !== 'undefined') window.clearInterval(loop.timer)
  alertLoops.delete(kind)
}

/** Immediately silence every loop (master switched off, unmount). */
export function stopAllAlerts(): void {
  stopAlertNow('new')
  stopAlertNow('ready')
}

export function isAlertActive(kind: AlertKind): boolean {
  return alertLoops.has(kind)
}
