// FoodX — Set a new password after following a reset link (public).
// Supabase establishes a recovery session from the link automatically
// (detectSessionInUrl); if there is no recovery session the link is
// invalid or expired and we say so instead of failing silently.
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { authErrorKey } from '@/lib/errors'
import { updatePassword } from '@/services/auth'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function UpdatePasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [sessionReady, setSessionReady] = useState<boolean | null>(null)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    // The recovery link lands with a hash fragment; supabase-js parses it
    // and creates the session. Give it a moment, then check.
    const timer = window.setTimeout(() => {
      void supabase.auth.getSession().then(({ data }) => {
        if (!cancelled) setSessionReady(Boolean(data.session))
      })
    }, 800)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    setFieldError(null)
    if (!password) {
      setFieldError(t('auth.validation.passwordRequired'))
      return
    }
    if (password.length < 6) {
      setFieldError(t('auth.validation.passwordTooShort'))
      return
    }
    if (password !== confirmPassword) {
      setFieldError(t('auth.validation.passwordMismatch'))
      return
    }
    setBusy(true)
    try {
      await updatePassword(password)
      setDone(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined
      setFormError(t(authErrorKey(message)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-2xl">{t('auth.updateTitle')}</CardTitle>
          <CardDescription>{t('auth.updateSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          {sessionReady === null && (
            <p className="text-center text-sm text-muted-foreground">
              {t('common.loading')}
            </p>
          )}
          {sessionReady === false && (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="font-semibold">{t('auth.linkInvalid')}</p>
              <p className="text-sm text-muted-foreground">
                {t('auth.linkInvalidHint')}
              </p>
              <Button asChild>
                <Link to="/reset-password">{t('auth.sendResetLink')}</Link>
              </Button>
            </div>
          )}
          {sessionReady === true && done && (
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="size-6" />
              </span>
              <p className="font-semibold">{t('auth.passwordUpdated')}</p>
              <p className="text-sm text-muted-foreground">
                {t('auth.passwordUpdatedHint')}
              </p>
              <Button onClick={() => void navigate('/login', { replace: true })}>
                {t('auth.signIn')}
              </Button>
            </div>
          )}
          {sessionReady === true && !done && (
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="newPassword">{t('auth.newPassword')}</Label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder={t('auth.newPasswordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={Boolean(fieldError)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmNewPassword">
                  {t('auth.confirmNewPassword')}
                </Label>
                <Input
                  id="confirmNewPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder={t('auth.newPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={Boolean(fieldError)}
                />
                {fieldError && (
                  <p className="text-sm text-destructive">{fieldError}</p>
                )}
              </div>
              {formError && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {formError}
                </p>
              )}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? t('auth.updating') : t('auth.updatePassword')}
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-sm">
            <Link to="/login" className="font-medium text-primary hover:underline">
              {t('auth.backToLogin')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  )
}
