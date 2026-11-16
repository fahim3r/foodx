// FoodX — Login page (public). Sign-in + first-admin sign-up in one form.
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import logoWordmark from '@/assets/brand/logo-wordmark.webp'
import { authErrorKey } from '@/lib/errors'
import { signIn, signUp } from '@/services/auth'
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

type Mode = 'signin' | 'signup'

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export default function LoginPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const switchLanguage = (lng: 'en' | 'bn') => {
    void i18n.changeLanguage(lng)
    try {
      window.localStorage.setItem('foodx.language', lng)
    } catch {
      // ignore — language still switches for this session
    }
  }

  const validate = (): boolean => {
    const next: Record<string, string> = {}
    if (!email.trim()) next.email = t('auth.validation.emailRequired')
    else if (!isValidEmail(email.trim()))
      next.email = t('auth.validation.emailInvalid')
    if (!password) next.password = t('auth.validation.passwordRequired')
    else if (password.length < 6)
      next.password = t('auth.validation.passwordTooShort')
    if (mode === 'signup') {
      if (!fullName.trim()) next.fullName = t('auth.validation.nameRequired')
      if (password !== confirmPassword)
        next.confirmPassword = t('auth.validation.passwordMismatch')
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    setNotice(null)
    if (!validate()) return
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password)
        void navigate('/', { replace: true })
      } else {
        const { needsEmailConfirmation } = await signUp(
          email.trim(),
          password,
          fullName.trim() || undefined,
        )
        if (needsEmailConfirmation) {
          setNotice(
            t('auth.signupCheckEmailHint', { email: email.trim() }),
          )
          setMode('signin')
        } else {
          void navigate('/', { replace: true })
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : undefined
      setFormError(t(authErrorKey(message)))
    } finally {
      setBusy(false)
    }
  }

  const current = i18n.language?.startsWith('bn') ? 'bn' : 'en'

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-4 py-8">
      <div className="absolute right-4 top-4 flex gap-1">
        {(
          [
            { code: 'en', label: 'EN' },
            { code: 'bn', label: 'বাং' },
          ] as const
        ).map(({ code, label }) => (
          <button
            key={code}
            type="button"
            onClick={() => switchLanguage(code)}
            aria-pressed={current === code}
            className={
              current === code
                ? 'rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground'
                : 'rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground'
            }
          >
            {label}
          </button>
        ))}
      </div>

      <img
        src={logoWordmark}
        alt="FoodX"
        width={480}
        height={119}
        fetchPriority="high"
        className="mb-6 h-14 w-auto"
      />
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-2xl">
            {mode === 'signin' ? t('auth.signInTitle') : t('auth.signUpTitle')}
          </CardTitle>
          <CardDescription>
            {mode === 'signin'
              ? t('auth.signInSubtitle')
              : t('auth.signUpSubtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {mode === 'signup' && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="fullName">{t('auth.fullName')}</Label>
                <Input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  placeholder={t('auth.fullNamePlaceholder')}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  aria-invalid={Boolean(errors.fullName)}
                />
                {errors.fullName && (
                  <p className="text-sm text-destructive">{errors.fullName}</p>
                )}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder={t('auth.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(errors.email)}
              />
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t('auth.password')}</Label>
                {mode === 'signin' && (
                  <Link
                    to="/reset-password"
                    className="text-sm text-primary hover:underline"
                  >
                    {t('auth.forgotPassword')}
                  </Link>
                )}
              </div>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder={t('auth.passwordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(errors.password)}
              />
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password}</p>
              )}
            </div>
            {mode === 'signup' && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirmPassword">{t('auth.confirmPassword')}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder={t('auth.confirmPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={Boolean(errors.confirmPassword)}
                />
                {errors.confirmPassword && (
                  <p className="text-sm text-destructive">
                    {errors.confirmPassword}
                  </p>
                )}
              </div>
            )}
            {formError && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                {notice}
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy
                ? mode === 'signin'
                  ? t('auth.signingIn')
                  : t('auth.creatingAccount')
                : mode === 'signin'
                  ? t('auth.signIn')
                  : t('auth.signUp')}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {mode === 'signin' ? t('auth.noAccount') : t('auth.haveAccount')}{' '}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin')
                setFormError(null)
                setNotice(null)
                setErrors({})
              }}
            >
              {mode === 'signin' ? t('auth.createAccount') : t('auth.signIn')}
            </button>
          </p>
        </CardContent>
      </Card>
      <p className="mt-4 text-sm text-muted-foreground">{t('app.tagline')}</p>
    </main>
  )
}
