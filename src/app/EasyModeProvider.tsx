import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import { useAuth } from '@/hooks/useAuth'

export interface EasyModeContextValue {
  easy: boolean
  setEasy: (value: boolean) => void
  toggle: () => void
}

export const EasyModeContext = createContext<EasyModeContextValue | null>(null)

/**
 * Easy Mode (modifications v2, item 9): a per-device presentation
 * layer — bigger text and tap targets (the `easy-mode` class on
 * <html> raises the root font size; Tailwind is rem-based, so
 * everything grows), a reduced sidebar, and a simplified POS.
 * It is NOT a permission: it changes no data and no access, and
 * anyone can flip it. Stored per restaurant on this device:
 * `foodx.easy_mode.<restaurantId>`.
 */
export function EasyModeProvider({ children }: { children: ReactNode }) {
  const { restaurant } = useAuth()
  const restaurantId = restaurant?.id ?? null
  const [easy, setEasyState] = useState(false)

  useEffect(() => {
    if (!restaurantId) {
      setEasyState(false)
      return
    }
    try {
      setEasyState(localStorage.getItem(`foodx.easy_mode.${restaurantId}`) === '1')
    } catch {
      setEasyState(false)
    }
  }, [restaurantId])

  useEffect(() => {
    document.documentElement.classList.toggle('easy-mode', easy)
    return () => {
      document.documentElement.classList.remove('easy-mode')
    }
  }, [easy])

  const setEasy = useCallback(
    (value: boolean) => {
      setEasyState(value)
      if (restaurantId) {
        try {
          localStorage.setItem(
            `foodx.easy_mode.${restaurantId}`,
            value ? '1' : '0',
          )
        } catch {
          // Storage unavailable: the in-memory state still applies.
        }
      }
    },
    [restaurantId],
  )

  const toggle = useCallback(() => setEasy(!easy), [easy, setEasy])

  return (
    <EasyModeContext.Provider value={{ easy, setEasy, toggle }}>
      {children}
    </EasyModeContext.Provider>
  )
}
