import { useTranslation } from 'react-i18next'
import { Monitor, Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useTheme } from '@/hooks/useTheme'
import type { ThemeMode } from '@/app/ThemeProvider'

const OPTIONS: { mode: ThemeMode; icon: typeof Sun; key: string }[] = [
  { mode: 'light', icon: Sun, key: 'settings.themeLight' },
  { mode: 'dark', icon: Moon, key: 'settings.themeDark' },
  { mode: 'system', icon: Monitor, key: 'settings.themeSystem' },
]

/**
 * Settings → Appearance (modifications v2, item 7): the labelled
 * theme control. The header icon cycles the same setting; both are
 * per-device (localStorage), because a theme belongs to the screen.
 */
export default function AppearanceCard() {
  const { t } = useTranslation()
  const { mode, setMode } = useTheme()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.themeTitle')}</CardTitle>
        <CardDescription>{t('settings.themeBody')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map(({ mode: optionMode, icon: Icon, key }) => (
            <Button
              key={optionMode}
              type="button"
              variant={mode === optionMode ? 'default' : 'outline'}
              onClick={() => setMode(optionMode)}
            >
              <Icon className="size-4" />
              {t(key)}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
