/**
 * Per-device auto-print settings (modifications v2, item 11).
 * The printer belongs to THIS terminal, not the restaurant, so —
 * like the theme — this lives in localStorage, never in
 * restaurant_settings: `foodx.print.<restaurantId>`.
 * Both default OFF: a restaurant without a printer must never get
 * surprise print dialogs.
 */
export interface PrintSettings {
  autoReceipt: boolean
  autoKitchen: boolean
}

const DEFAULTS: PrintSettings = { autoReceipt: false, autoKitchen: false }

export function loadPrintSettings(restaurantId: string): PrintSettings {
  try {
    const raw = localStorage.getItem(`foodx.print.${restaurantId}`)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<PrintSettings>
    return {
      autoReceipt: parsed.autoReceipt === true,
      autoKitchen: parsed.autoKitchen === true,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function savePrintSettings(
  restaurantId: string,
  settings: PrintSettings,
): void {
  try {
    localStorage.setItem(`foodx.print.${restaurantId}`, JSON.stringify(settings))
  } catch {
    // Storage unavailable: settings just don't persist on this device.
  }
}
