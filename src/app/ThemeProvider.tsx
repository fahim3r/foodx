import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export type ThemeMode = 'light' | 'dark' | 'system' | 'glass'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeContextValue {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  cycle: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'foodx.theme'

function readStoredMode(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' ||
      value === 'dark' ||
      value === 'system' ||
      value === 'glass'
      ? value
      : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

/**
 * Theme (modifications v2, item 7): light / dark / system, stored
 * per device in localStorage — the theme belongs to the screen in
 * front of you, not to the restaurant. The `.dark` token block has
 * existed in index.css since the start; this provider is the switch
 * that finally applies it. An inline script in index.html applies
 * the stored mode before first paint so dark devices never flash.
 *
 * Glass (2026-11-22) is a fourth mode: its own appearance, not a
 * system variant. It resolves to the dark token set (it is a
 * dark-leaning look) and additionally applies a `.glass` class,
 * which is what the glass layer in index.css keys off. Glass is
 * chosen from Settings → Appearance; the header cycle keeps its
 * original light → dark → system rotation and leaves glass for
 * the labelled control, like the other labelled settings.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode)
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark)

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) =>
      setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resolved: ResolvedTheme =
    mode === 'glass'
      ? 'dark'
      : mode === 'system'
        ? systemDark
          ? 'dark'
          : 'light'
        : mode

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')
    root.classList.toggle('glass', mode === 'glass')
  }, [mode, resolved])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage unavailable (private mode): the in-memory mode still applies.
    }
  }, [])

  const cycle = useCallback(() => {
    setMode(mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light')
  }, [mode, setMode])

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode, cycle }}>
      {children}
    </ThemeContext.Provider>
  )
}
