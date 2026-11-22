/**
 * Per-device sound-effect settings (Sound Effects feature, 2026-11-22).
 * Sound belongs to THIS terminal, not the restaurant — the kitchen
 * tablet wants the chimes, the owner's phone does not — so, like the
 * print settings, this lives in localStorage, never in
 * restaurant_settings: `foodx.sound.<restaurantId>`.
 * The master defaults OFF (user decision, design D2/Q1): a fresh
 * device stays silent until someone turns sound on in Settings.
 * The three event toggles default ON underneath it, so switching
 * the master on enables all three sounds at once.
 */
export interface SoundSettings {
  /** Master switch for this device. */
  master: boolean
  /** Two-tone doorbell when a new order appears. */
  newOrder: boolean
  /** Ascending triple when an order becomes READY. */
  ready: boolean
  /** Soft blip when a payment is recorded. */
  payment: boolean
}

const DEFAULTS: SoundSettings = {
  master: false,
  newOrder: true,
  ready: true,
  payment: true,
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
