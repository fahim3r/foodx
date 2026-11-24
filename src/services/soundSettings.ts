/**
 * Per-device sound-effect settings (Sound Effects feature, 2026-11-22).
 * Sound belongs to THIS terminal, not the restaurant — the kitchen
 * tablet wants the chimes, the owner's phone does not — so, like the
 * print settings, this lives in localStorage, never in
 * restaurant_settings: `foodx.sound.<restaurantId>`.
 * The master defaults OFF (user decision, design D2/Q1): a fresh
 * device stays silent until someone turns sound on in Settings.
 * The event toggles default ON underneath it, so switching
 * the master on enables all the sounds at once.
 * Loading merges the stored value field-by-field over the defaults,
 * so a settings blob saved by an older build (e.g. one without the
 * v1.1 `complete` key) picks up the new defaults instead of
 * reading undefined.
 */
export interface SoundSettings {
  /** Master switch for this device. */
  master: boolean
  /** Looping two-tone doorbell while a new order waits for action. */
  newOrder: boolean
  /** Looping ascending triple while an order sits READY. */
  ready: boolean
  /** Soft blip when a payment is recorded. */
  payment: boolean
  /** Success motif when an order completes (v1.1). */
  complete: boolean
  /** Soft descending "failed" tone when an order is cancelled (v1.1). */
  cancelled: boolean
  /** Looping service bell while a table's waiter call waits (0038). */
  waiterCall: boolean
}

const DEFAULTS: SoundSettings = {
  master: false,
  newOrder: true,
  ready: true,
  payment: true,
  complete: true,
  cancelled: true,
  waiterCall: true,
}

export function loadSoundSettings(restaurantId: string): SoundSettings {
  try {
    const raw = localStorage.getItem(`foodx.sound.${restaurantId}`)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<SoundSettings>
    return {
      master: parsed.master === true,
      newOrder: parsed.newOrder !== false,
      ready: parsed.ready !== false,
      payment: parsed.payment !== false,
      complete: parsed.complete !== false,
      cancelled: parsed.cancelled !== false,
      waiterCall: parsed.waiterCall !== false,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSoundSettings(
  restaurantId: string,
  settings: SoundSettings,
): void {
  try {
    localStorage.setItem(`foodx.sound.${restaurantId}`, JSON.stringify(settings))
  } catch {
    // Storage unavailable: settings just don't persist on this device.
  }
}
