import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useEasyMode } from '@/hooks/useEasyMode'

/**
 * Easy Mode v2 (wave E3; design §8): the shared shell for the
 * four guided wizards — one question per step, big buttons,
 * progress dots, a plain-language error area, and a one-sentence
 * success screen. The wizards themselves live in
 * src/modules/easy/ and wrap the existing services; this file is
 * presentation only.
 *
 * The panel-root derivation mirrors EasyHomePage/AppLayout so
 * links are right under both mountings (basename /panel on
 * restaurant domains, descendant /panel/* routes on platform
 * hosts).
 */
export function usePanelNav(): {
  panelBase: string
  navTo: (to: string) => string
} {
  const { pathname } = useLocation()
  const panelBase =
    pathname === '/panel' || pathname.startsWith('/panel/') ? '/panel' : ''
  const navTo = (to: string) =>
    to === '/' ? panelBase || '/' : `${panelBase}${to}`
  return { panelBase, navTo }
}

/**
 * Shown when a wizard URL is opened while easy mode is OFF: the
 * wizards are easy-mode surfaces, so the honest answer is a plain
 * note plus a link to the normal page that does the same job.
 */
export function EasyOnlyNote({
  normalTo,
  normalLabel,
}: {
  normalTo: string
  normalLabel: string
}) {
  const { t } = useTranslation()
  const { easy } = useEasyMode()
  const { navTo } = usePanelNav()
  if (easy) return null
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4">
      <p className="text-lg font-medium">{t('easy.wizard.onlyEasy')}</p>
      <Button asChild size="lg">
        <Link to={navTo(normalTo)}>{normalLabel}</Link>
      </Button>
    </div>
  )
}

/** The one big question at the top of a wizard step. */
export function EasyWizardQuestion({ children }: { children: ReactNode }) {
  return <p className="text-xl font-semibold">{children}</p>
}

export function EasyWizardShell({
  title,
  step,
  stepCount,
  error,
  busy = false,
  onBack,
  onNext,
  nextLabel,
  nextDisabled = false,
  children,
}: {
  title: string
  step: number
  stepCount: number
  error: string | null
  busy?: boolean
  onBack?: () => void
  onNext?: () => void
  nextLabel: string
  nextDisabled?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {stepCount > 1 && (
          <div className="flex gap-2" aria-hidden="true">
            {Array.from({ length: stepCount }, (_, index) => (
              <span
                key={index}
                className={`h-2.5 w-2.5 rounded-full ${
                  index <= step ? 'bg-primary' : 'bg-muted'
                }`}
              />
            ))}
          </div>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-4 py-3 text-base font-medium text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-5">{children}</div>

      <div className="flex gap-3">
        {onBack && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="flex-1"
            onClick={onBack}
            disabled={busy}
          >
            {t('common.back')}
          </Button>
        )}
        {onNext && (
          <Button
            type="button"
            size="lg"
            className="flex-1"
            onClick={onNext}
            disabled={busy || nextDisabled}
          >
            {nextLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

/** One big tappable choice (a category, a job, a list…). */
export function BigChoiceButton({
  selected = false,
  onClick,
  disabled = false,
  children,
}: {
  selected?: boolean
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full rounded-xl border p-5 text-left text-lg font-semibold shadow-sm transition-colors disabled:opacity-50 ${
        selected
          ? 'border-primary bg-primary/10'
          : 'bg-card hover:bg-accent'
      }`}
    >
      {children}
    </button>
  )
}

/** The one-sentence success screen every wizard ends on. */
export function EasyWizardSuccess({
  message,
  doneTo,
  children,
}: {
  message: string
  doneTo: string
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const { navTo } = usePanelNav()
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 py-8 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        <Check className="size-8" />
      </span>
      <p className="text-xl font-semibold">{message}</p>
      {children}
      <Button asChild size="lg" className="w-full">
        <Link to={navTo(doneTo)}>{t('easy.wizard.done')}</Link>
      </Button>
    </div>
  )
}
