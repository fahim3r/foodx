// FoodX — marketing landing page (platform hosts only).
//
// Rendered at / on foodx.bond / www.foodx.bond when no ?store= or
// ?table= preview is requested (see App.tsx). This page sells the
// FoodX software itself: the live demo lives on demo.foodx.bond (the
// demo restaurant's own deployment-style subdomain), the vendor
// Developer Panel stays at /devpanel on this host.
//
// Content rule (§82): every claim here maps to a feature that is
// actually built. No pricing and no testimonials until the owner
// supplies real ones.
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  Bike,
  ChefHat,
  Globe,
  KeyRound,
  Languages,
  LayoutGrid,
  Mail,
  MessageCircle,
  MonitorSmartphone,
  Package,
  Rocket,
  Server,
  Users,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const DEMO_STOREFRONT_URL = 'https://demo.foodx.bond'
const DEMO_PANEL_URL = 'https://demo.foodx.bond/panel'
const DEMO_LOGIN_EMAIL = 'demo@foodx.bond'
const DEMO_LOGIN_PASSWORD = 'foodx123'
const CONTACT_EMAIL = 'Foodx.bond@gmail.com'
const WHATSAPP_URL = 'https://wa.me/8801930599600'

function LanguageToggle() {
  const { i18n, t } = useTranslation()
  const current = i18n.language?.startsWith('bn') ? 'bn' : 'en'
  const switchTo = (lng: 'en' | 'bn') => {
    void i18n.changeLanguage(lng)
    try {
      window.localStorage.setItem('foodx.language', lng)
    } catch {
      // Storage unavailable — the switch still applies for this session.
    }
  }
  return (
    <div
      className="flex items-center rounded-full border border-input p-0.5"
      role="group"
      aria-label={t('landing.languageLabel')}
    >
      {(['en', 'bn'] as const).map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => switchTo(lng)}
          className={
            current === lng
              ? 'rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground'
              : 'rounded-full px-3 py-1 text-xs font-medium text-muted-foreground'
          }
        >
          {lng === 'en' ? 'EN' : 'বাং'}
        </button>
      ))}
    </div>
  )
}

const FEATURES = [
  { icon: MonitorSmartphone, titleKey: 'posTitle', bodyKey: 'posBody' },
  { icon: ChefHat, titleKey: 'kitchenTitle', bodyKey: 'kitchenBody' },
  { icon: Package, titleKey: 'inventoryTitle', bodyKey: 'inventoryBody' },
  { icon: Globe, titleKey: 'orderingTitle', bodyKey: 'orderingBody' },
  { icon: Bike, titleKey: 'deliveryTitle', bodyKey: 'deliveryBody' },
  { icon: Wallet, titleKey: 'businessTitle', bodyKey: 'businessBody' },
  { icon: BarChart3, titleKey: 'reportsTitle', bodyKey: 'reportsBody' },
  { icon: Languages, titleKey: 'languageTitle', bodyKey: 'languageBody' },
] as const

const STEPS = [
  { icon: Rocket, titleKey: 'step1Title', bodyKey: 'step1Body' },
  { icon: KeyRound, titleKey: 'step2Title', bodyKey: 'step2Body' },
  { icon: Users, titleKey: 'step3Title', bodyKey: 'step3Body' },
] as const

const WHY = [
  { icon: Server, titleKey: 'why1Title', bodyKey: 'why1Body' },
  { icon: LayoutGrid, titleKey: 'why2Title', bodyKey: 'why2Body' },
  { icon: MonitorSmartphone, titleKey: 'why3Title', bodyKey: 'why3Body' },
] as const

export default function LandingPage() {
  const { t } = useTranslation()
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <span className="text-xl font-bold tracking-tight">
            Food<span className="text-primary">X</span>
          </span>
          <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
            <a href="#features" className="hover:text-primary">
              {t('landing.navFeatures')}
            </a>
            <a href="#how" className="hover:text-primary">
              {t('landing.navHow')}
            </a>
            <a href="#demo" className="hover:text-primary">
              {t('landing.navDemo')}
            </a>
            <a href="#contact" className="hover:text-primary">
              {t('landing.navContact')}
            </a>
          </nav>
          <LanguageToggle />
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 text-center md:pt-20">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            {t('landing.heroBadge')}
          </p>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-bold leading-tight md:text-5xl">
            {t('landing.heroTitle')}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            {t('landing.heroSubtitle')}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <a href={DEMO_STOREFRONT_URL}>{t('landing.ctaDemo')}</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={DEMO_PANEL_URL}>{t('landing.ctaPanel')}</a>
            </Button>
          </div>

          {/* Public demo login (owner's decision 2026-11-18: the panel
              is the product, so prospects can click through it). */}
          <Card id="demo" className="mx-auto mt-10 max-w-md text-left">
            <CardHeader>
              <CardTitle className="text-base">
                {t('landing.demoLoginTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">
                  {t('landing.demoLoginEmail')}:{' '}
                </span>
                <span className="font-mono font-medium">{DEMO_LOGIN_EMAIL}</span>
              </p>
              <p>
                <span className="text-muted-foreground">
                  {t('landing.demoLoginPassword')}:{' '}
                </span>
                <span className="font-mono font-medium">
                  {DEMO_LOGIN_PASSWORD}
                </span>
              </p>
              <p className="pt-2 text-muted-foreground">
                {t('landing.demoLoginNote')}
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Features */}
        <section id="features" className="border-t bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 className="text-center text-3xl font-bold">
              {t('landing.featuresTitle')}
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, titleKey, bodyKey }) => (
                <Card key={titleKey}>
                  <CardHeader>
                    <Icon className="h-8 w-8 text-primary" />
                    <CardTitle className="text-base">
                      {t(`landing.${titleKey}`)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {t(`landing.${bodyKey}`)}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-center text-3xl font-bold">
            {t('landing.howTitle')}
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, titleKey, bodyKey }, i) => (
              <Card key={titleKey}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                      {i + 1}
                    </span>
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle className="text-base">
                    {t(`landing.${titleKey}`)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {t(`landing.${bodyKey}`)}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Why FoodX */}
        <section className="border-t bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-16">
            <h2 className="text-center text-3xl font-bold">
              {t('landing.whyTitle')}
            </h2>
            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {WHY.map(({ icon: Icon, titleKey, bodyKey }) => (
                <Card key={titleKey}>
                  <CardHeader>
                    <Icon className="h-8 w-8 text-primary" />
                    <CardTitle className="text-base">
                      {t(`landing.${titleKey}`)}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {t(`landing.${bodyKey}`)}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Contact */}
        <section id="contact" className="mx-auto max-w-6xl px-4 py-16 text-center">
          <h2 className="text-3xl font-bold">{t('landing.contactTitle')}</h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            {t('landing.contactBody')}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <a href={WHATSAPP_URL} target="_blank" rel="noreferrer">
                <MessageCircle className="mr-2 h-5 w-5" />
                {t('landing.contactWhatsapp')}
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={`mailto:${CONTACT_EMAIL}`}>
                <Mail className="mr-2 h-5 w-5" />
                {CONTACT_EMAIL}
              </a>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
          <span className="text-base font-bold text-foreground">
            Food<span className="text-primary">X</span>
          </span>
          <p>{t('landing.footerTagline')}</p>
          <p>{t('landing.footerDemoNote')}</p>
        </div>
      </footer>
    </div>
  )
}
