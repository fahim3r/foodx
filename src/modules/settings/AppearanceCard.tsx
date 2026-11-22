import { useTranslation } from 'react-i18next'
import { Droplets, Layers, Monitor, Moon, Sun } from 'lucide-react'

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

const OPTIONS: {
  mode: ThemeMode
  icon: typeof Sun
  key: string
  swatch?: 'glass' | 'glassWhite'
}[] = [
  { mode: 'light', icon: Sun, key: 'settings.themeLight' },
  { mode: 'dark', icon: Moon, key: 'settings.themeDark' },
  { mode: 'system', icon: Monitor, key: 'settings.themeSystem' },
  { mode: 'glass', icon: Layers, key: 'settings.themeGlass', swatch: 'glass' },
  {
    mode: 'glassWhite',
    icon: Droplets,
    key: 'settings.themeWhiteGlass',
    swatch: 'glassWhite',
  },
]

/** Miniature of the glass look: a brand-tinted gradient seen through
 *  a frosted layer — the option's preview swatch. */
function GlassSwatch() {
  return (
    <span
      aria-hidden="true"
      className="relative size-4 shrink-0 overflow-hidden rounded-[4px] border border-foreground/25 shadow-sm"
    >
      <span className="absolute inset-0 bg-gradient-to-br from-brand-400 via-brand-600 to-emerald-600" />
      <span className="absolute inset-0 bg-white/30 backdrop-blur-[1.5px]" />
    </span>
  )
}

/** Miniature of the white liquid glass look: a bright warm scene
 *  under a glossy translucent-white layer with a lit top edge. */
function WhiteGlassSwatch() {
  return (
    <span
      aria-hidden="true"
      className="relative size-4 shrink-0 overflow-hidden rounded-[4px] border border-foreground/20 shadow-sm"
    >
      <span className="absolute inset-0 bg-gradient-to-br from-amber-100 via-orange-200 to-emerald-200" />
      <span className="absolute inset-0 bg-white/55 backdrop-blur-[1.5px]" />
      <span className="absolute inset-x-0 top-0 h-px bg-white/90" />
    </span>
  )
}

/**
 * Settings → Appearance (modifications v2, item 7): the labelled
 * theme control. The header icon cycles the same setting; both are
 * per-device (localStorage), because a theme belongs to the screen.
 * Glass (2026-11-22) is chosen here; the header cycle keeps its
 * light → dark → system rotation. White Glass (2026-11-22) is the
 * fifth option — the same control, the light Liquid Glass look.
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
          {OPTIONS.map(({ mode: optionMode, icon: Icon, key, swatch }) => (
            <Button
              key={optionMode}
              type="button"
              variant={mode === optionMode ? 'default' : 'outline'}
              onClick={() => setMode(optionMode)}
            >
              {swatch === 'glass' ? (
                <GlassSwatch />
              ) : swatch === 'glassWhite' ? (
                <WhiteGlassSwatch />
              ) : (
                <Icon className="size-4" />
              )}
              {t(key)}
            </Button>
          ))}
        </div>
        {mode === 'glass' && (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('settings.themeGlassBody')}
          </p>
        )}
        {mode === 'glassWhite' && (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('settings.themeWhiteGlassBody')}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
