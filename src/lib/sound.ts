/**
 * Sound effects (Sound Effects feature, 2026-11-22; design D3/D4/D7).
 * Three tiny chimes synthesised with WebAudio — no audio files (the
 * GitHub connector cannot carry binaries, and these don't need any):
 *   - new order: two-tone doorbell, E5 → C5
 *   - order ready: ascending triple, C5 → E5 → G5
 *   - payment recorded: single soft blip, 990 Hz
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

export type SoundKind = 'newOrder' | 'ready' | 'payment'

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

/** New-order doorbell (watcher; design D5). No-op unless this
 * device has sound + the new-order event switched on. */
export function playNewOrderChime(): void {
  playIfEnabled('newOrder')
}

/** Order-ready triple (watcher; design D5). */
export function playReadyChime(): void {
  playIfEnabled('ready')
}

/** Payment blip (UI success branches only; design D6). */
export function playPaymentBlip(): void {
  playIfEnabled('payment')
}

/**
 * Settings Test buttons: an explicit tap in Settings, so the sound
 * plays even while that event (or the master) is still off — the
 * tap is also the gesture that unlocks audio on this device (D3).
 */
export function playTestSound(kind: SoundKind): void {
  play(kind)
}
