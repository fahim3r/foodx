import { useContext } from 'react'

import {
  EasyModeContext,
  type EasyModeContextValue,
} from '@/app/EasyModeProvider'

export function useEasyMode(): EasyModeContextValue {
  const ctx = useContext(EasyModeContext)
  if (!ctx) throw new Error('useEasyMode must be used within EasyModeProvider')
  return ctx
}
