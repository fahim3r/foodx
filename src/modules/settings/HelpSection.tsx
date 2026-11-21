import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

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
import { useAuth } from '@/hooks/useAuth'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { APP_VERSION } from '@/lib/version'
import {
  submitTicket,
  TICKET_CATEGORIES,
  type TicketCategory,
} from '@/services/support'

// The vendor's public contact points (Help design §1/§4): the
// same WhatsApp number the landing page shows, and the support
// inbox the user decided in Q1. The app version is never written
// here — it comes from APP_VERSION so this block cannot go stale.
const SUPPORT_EMAIL = 'Foodx.bond@gmail.com'
const SUPPORT_WHATSAPP_DISPLAY = '01930599600'
const SUPPORT_WHATSAPP_INTL = '8801930599600'

const CATEGORY_LABEL_KEYS: Record<TicketCategory, string> = {
  order_payment: 'settings.help.catOrderPayment',
  printer_hardware: 'settings.help.catPrinter',
  menu_settings: 'settings.help.catMenuSettings',
  other: 'settings.help.catOther',
}

/**
 * Settings → Help (Help wave H2; design §4). One section, rendered
 * at the bottom of the advanced Settings page and behind the Help
 * row in Easy Settings: who made the software (FoodX, with the
 * live app version), how to reach them (WhatsApp — which IS the
 * live chat, D6 — and email), and a ticket form whose submissions
 * land in the vendor registry's DevPanel (wave H1). Anyone signed
 * in can send a ticket (Q2): the sender's name and email are taken
 * from the signed-in profile automatically, never typed. There is
 * no ticket list here (Q3) — on success the confirmation sentence
 * replaces the form, and FoodX replies on WhatsApp or email.
 * Offline, the form area shows a plain sentence instead and
 * nothing is queued (design §4.5).
 */
export default function HelpSection() {
  const { t } = useTranslation()
  const { user, profile, restaurant } = useAuth()
  const online = useOnlineStatus()

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<TicketCategory>('other')
  const [message, setMessage] = useState('')
  const [errorText, setErrorText] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const restaurantName = restaurant?.name ?? ''
  const whatsappUrl =
    `https://wa.me/${SUPPORT_WHATSAPP_INTL}?text=` +
    encodeURIComponent(
      t('settings.help.whatsappMessage', { name: restaurantName }),
    )
  const emailUrl =
    `mailto:${SUPPORT_EMAIL}?subject=` +
    encodeURIComponent(
      t('settings.help.emailSubject', { name: restaurantName }),
    )

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setErrorText(null)
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      setErrorText(t('settings.help.titleRequired'))
      return
    }
    const trimmedMessage = message.trim()
    if (!trimmedMessage) {
      setErrorText(t('settings.help.messageRequired'))
      return
    }
    setSending(true)
    try {
      const result = await submitTicket({
        title: trimmedTitle,
        category,
        message: trimmedMessage,
        senderName: profile?.full_name ?? null,
        senderEmail: user?.email ?? null,
      })
      if (result.ok) {
        setSent(true)
        return
      }
      // A failed send keeps the typed text — only the error line
      // changes, so the sender can fix or retry without retyping.
      if (result.message) {
        setErrorText(result.message)
      } else if (result.code === 'too_many_tickets') {
        setErrorText(t('settings.help.tooMany'))
      } else if (result.code === 'unconfigured') {
        setErrorText(t('settings.help.unconfigured'))
      } else if (result.code === 'unauthorized') {
        setErrorText(t('settings.help.unauthorized'))
      } else {
        setErrorText(t('settings.help.sendFailed'))
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.help.title')}</CardTitle>
        <CardDescription>{t('settings.help.body')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">
              {t('settings.help.software')}
            </dt>
            <dd className="font-medium">FoodX</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t('settings.help.website')}
            </dt>
            <dd>
              <a
                href="https://foodx.bond"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                foodx.bond
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t('settings.help.whatsapp')}
            </dt>
            <dd className="font-medium">{SUPPORT_WHATSAPP_DISPLAY}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t('settings.help.email')}
            </dt>
            <dd className="font-medium">{SUPPORT_EMAIL}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              {t('settings.help.version')}
            </dt>
            <dd className="font-medium">{APP_VERSION}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <a href={whatsappUrl} target="_blank" rel="noreferrer">
              {t('settings.help.whatsappButton')}
            </a>
          </Button>
          <Button asChild variant="outline">
            <a href={emailUrl}>{t('settings.help.emailButton')}</a>
          </Button>
        </div>

        <div className="border-t pt-6">
          <h3 className="font-medium">{t('settings.help.formTitle')}</h3>
          {!online ? (
            <p
              role="status"
              className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
            >
              {t('settings.help.offline')}
            </p>
          ) : sent ? (
            <p
              role="status"
              className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
            >
              {t('settings.help.sent')}
            </p>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="mt-4 flex flex-col gap-4"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="helpTitle">
                  {t('settings.help.titleLabel')}
                </Label>
                <Input
                  id="helpTitle"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value)
                    setErrorText(null)
                  }}
                  placeholder={t('settings.help.titlePlaceholder')}
                  maxLength={200}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>{t('settings.help.categoryLabel')}</Label>
                <div className="flex flex-wrap gap-2">
                  {TICKET_CATEGORIES.map((value) => (
                    <Button
                      key={value}
                      type="button"
                      variant={category === value ? 'default' : 'outline'}
                      onClick={() => setCategory(value)}
                    >
                      {t(CATEGORY_LABEL_KEYS[value])}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="helpMessage">
                  {t('settings.help.messageLabel')}
                </Label>
                <textarea
                  id="helpMessage"
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value)
                    setErrorText(null)
                  }}
                  placeholder={t('settings.help.messagePlaceholder')}
                  rows={5}
                  maxLength={5000}
                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                />
              </div>
              {errorText && (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {errorText}
                </p>
              )}
              <div>
                <Button type="submit" disabled={sending}>
                  {sending
                    ? t('settings.help.sending')
                    : t('settings.help.send')}
                </Button>
              </div>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
