import { useRef, useState } from 'react'
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
import { Input } from '@/components/ui/input'
import {
  DEFAULT_GLASS_BACKDROP,
  GLASS_BACKDROP_FILTER,
  GLASS_BACKDROP_WASH,
} from '@/components/GlassBackdrop'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { updateSettingsPartial } from '@/services/restaurant'
import {
  UploadError,
  deleteGlassBackdropByUrl,
  uploadGlassBackdrop,
} from '@/services/uploads'
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

/** Miniature of the white liquid glass look: a clean near-white
 *  scene with soft pastel brand glows under a glossy
 *  translucent-white layer with a lit top edge. */
function WhiteGlassSwatch() {
  return (
    <span
      aria-hidden="true"
      className="relative size-4 shrink-0 overflow-hidden rounded-[4px] border border-foreground/20 shadow-sm"
    >
      <span className="absolute inset-0 bg-[#f6f6f4]" />
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(234,88,12,0.38),transparent_65%),radial-gradient(circle_at_90%_90%,rgba(22,163,74,0.32),transparent_65%)]" />
      <span className="absolute inset-0 bg-white/55 backdrop-blur-[1.5px]" />
      <span className="absolute inset-x-0 top-0 h-px bg-white/90" />
    </span>
  )
}

/**
 * White Glass backdrop controls (v4, 2026-11-23): revealed only
 * while White Glass is the selected theme — the option belongs to
 * that theme alone. The backdrop photo is restaurant data, not a
 * device preference: it is stored on restaurant_settings
 * (glass_backdrop_url, migration 0037) and saved through the same
 * partial-update path as the other standalone Settings cards.
 * Upload goes to the product-images bucket under the restaurant's
 * backdrop/ folder; a pasted link is stored as-is. The thumbnail
 * wears the same drained filter + wash as the live backdrop, so
 * what is previewed here is what the panel will show. Replacing
 * or resetting the photo also deletes the previous upload's file
 * from the bucket (best-effort — see deleteGlassBackdropByUrl),
 * so the bucket does not fill with orphaned backdrops.
 */
function GlassBackgroundControls() {
  const { t } = useTranslation()
  const { restaurant, settings, refreshWorkspace } = useAuth()
  const [link, setLink] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  if (!restaurant || !settings) return null

  const busy = uploading || saving
  const customUrl = settings.glass_backdrop_url?.trim() || null
  const previewSrc = customUrl ?? DEFAULT_GLASS_BACKDROP

  const save = async (url: string | null) => {
    const previousUrl = customUrl
    setSaving(true)
    setErrorKey(null)
    setSaved(false)
    try {
      await updateSettingsPartial(restaurant.id, {
        glass_backdrop_url: url,
      })
      await refreshWorkspace()
      setSaved(true)
      // The save landed: remove the replaced/reset photo's file
      // from storage (best-effort; external links are untouched).
      if (previousUrl && previousUrl !== url) {
        void deleteGlassBackdropByUrl(previousUrl)
      }
    } catch {
      setErrorKey('settings.glassBackgroundSaveFailed')
    } finally {
      setSaving(false)
    }
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    const previousUrl = customUrl
    setUploading(true)
    setErrorKey(null)
    setSaved(false)
    let uploadedUrl: string | null = null
    let settingsSaved = false
    try {
      uploadedUrl = await uploadGlassBackdrop(restaurant.id, file)
      await updateSettingsPartial(restaurant.id, {
        glass_backdrop_url: uploadedUrl,
      })
      settingsSaved = true
      await refreshWorkspace()
      setSaved(true)
      // The save landed: remove the replaced photo's file from
      // storage (best-effort; external links are untouched).
      if (previousUrl && previousUrl !== uploadedUrl) {
        void deleteGlassBackdropByUrl(previousUrl)
      }
    } catch (error) {
      // The upload landed but the settings save did not: delete
      // the new file again so it is not orphaned from birth.
      if (uploadedUrl && !settingsSaved) {
        void deleteGlassBackdropByUrl(uploadedUrl)
      }
      if (error instanceof UploadError) {
        setErrorKey(
          error.code === 'upload_bad_type'
            ? 'settings.glassBackgroundBadType'
            : error.code === 'upload_too_large'
              ? 'settings.glassBackgroundTooLarge'
              : 'settings.glassBackgroundUploadFailed',
        )
      } else {
        setErrorKey('settings.glassBackgroundSaveFailed')
      }
    } finally {
      setUploading(false)
    }
  }

  const applyLink = () => {
    const value = link.trim()
    if (!/^https?:\/\/\S+$/i.test(value)) {
      setErrorKey('settings.glassBackgroundInvalidLink')
      setSaved(false)
      return
    }
    void save(value)
  }

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <div>
        <p className="text-sm font-medium">
          {t('settings.glassBackgroundTitle')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('settings.glassBackgroundBody')}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="relative block h-16 w-24 shrink-0 overflow-hidden rounded-md border">
          <img
            src={previewSrc}
            alt=""
            className="h-full w-full object-cover"
            style={{ filter: GLASS_BACKDROP_FILTER }}
          />
          <span
            className="absolute inset-0"
            style={{ background: GLASS_BACKDROP_WASH }}
          />
        </span>
        <div className="space-y-2">
          <p className="text-sm">
            {customUrl
              ? t('settings.glassBackgroundCustom')
              : t('settings.glassBackgroundDefault')}
          </p>
          {customUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void save(null)}
            >
              {t('settings.glassBackgroundReset')}
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {uploading
            ? t('settings.glassBackgroundUploading')
            : t('settings.glassBackgroundUpload')}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder={t('settings.glassBackgroundLinkPlaceholder')}
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          size="sm"
          disabled={busy || !link.trim()}
          onClick={applyLink}
        >
          {t('settings.glassBackgroundApply')}
        </Button>
      </div>
      {errorKey && (
        <p className="text-sm text-destructive">{t(errorKey)}</p>
      )}
      {saved && !errorKey && (
        <p className="text-sm text-muted-foreground">
          {t('settings.glassBackgroundSaved')}
        </p>
      )}
    </div>
  )
}

/**
 * Settings → Appearance (modifications v2, item 7): the labelled
 * theme control. The header icon cycles the same setting; both are
 * per-device (localStorage), because a theme belongs to the screen.
 * Glass (2026-11-22) is chosen here; the header cycle keeps its
 * light → dark → system rotation. White Glass (2026-11-22) is the
 * fifth option — the same control, the light Liquid Glass look.
 * White Glass v4 (2026-11-23) adds the backdrop controls above:
 * they reveal only while White Glass is selected.
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
        {mode === 'glassWhite' && <GlassBackgroundControls />}
      </CardContent>
    </Card>
  )
}
