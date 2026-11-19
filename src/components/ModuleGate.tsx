import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useAuth } from '@/hooks/useAuth'
import { isModuleOn, type ModuleKey } from '@/services/modules'

/**
 * Route-level module gate (modifications v2, item 8): opening a
 * turned-off module's URL directly shows an honest notice instead
 * of the page. While settings are still loading (null), children
 * render — the no-data rule reads as ON, matching isModuleOn.
 */
export default function ModuleGate({
  module,
  children,
}: {
  module: ModuleKey
  children: ReactNode
}) {
  const { t } = useTranslation()
  const { settings } = useAuth()
  if (isModuleOn(settings, module)) return <>{children}</>
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('modules.offTitle')}</CardTitle>
        <CardDescription>{t('modules.offBody')}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{t('modules.offHint')}</p>
      </CardContent>
    </Card>
  )
}
