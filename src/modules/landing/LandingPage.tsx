// FoodX — marketing landing page (platform hosts only).
//
// Rendered at / on foodx.bond / www.foodx.bond when no ?store= or
// ?table= preview is requested (see App.tsx). This page sells the
// FoodX software itself: the live demo lives on demo.foodx.bond (the
// demo restaurant's own deployment-style subdomain), the vendor
// Developer Panel stays at /devpanel on this host.
//
// Design (owner-approved 2026-11-28): hero/heading in the CodBe style
// (gradient headline + live dashboard mock), sections below in the
// Apptics style (pill nav, bento grid, calculator, comparison).
//
// Content rule (§82): every claim here maps to a feature that is
// actually built. No pricing and no testimonials until the owner
// supplies real ones.
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BarChart3,
  Bell,
  Bike,
  Check,
  ChefHat,
  KeyRound,
  LayoutGrid,
  Mail,
  MessageCircle,
  MonitorSmartphone,
  Package,
  QrCode,
  Rocket,
  ShieldCheck,
  TrendingUp,
  Users,
  X,
} from 'lucide-react'

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
      className="flex items-center rounded-full border border-slate-200 bg-white p-0.5"
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
              ? 'rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white'
              : 'rounded-full px-3 py-1 text-xs font-medium text-slate-500'
          }
        >
          {lng === 'en' ? 'EN' : 'বাং'}
        </button>
      ))}
    </div>
  )
}

function XChip({ className = 'h-10 w-10 text-xl rounded-xl' }: { className?: string }) {
  return (
    <span
      className={`mx-1 inline-flex items-center justify-center bg-gradient-to-br from-orange-500 to-orange-600 font-black text-white shadow-lg shadow-orange-500/40 ${className}`}
    >
      X
    </span>
  )
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="text-center">
      <span className="inline-block rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 shadow-sm">
        {children}
      </span>
    </div>
  )
}

const STEPS = [
  { icon: Rocket, titleKey: 'step1Title', bodyKey: 'step1Body' },
  { icon: KeyRound, titleKey: 'step2Title', bodyKey: 'step2Body' },
  { icon: Users, titleKey: 'step3Title', bodyKey: 'step3Body' },
  { icon: TrendingUp, titleKey: 'step4Title', bodyKey: 'step4Body' },
] as const

const FAQS = [1, 2, 3, 4, 5, 6, 7, 8] as const
const CMP_ROWS = ['cmpR1', 'cmpR2', 'cmpR3', 'cmpR4', 'cmpR5', 'cmpR6'] as const
const PANEL_INCLUDES = ['posTitle', 'kitchenTitle', 'deliveryTitle', 'inventoryTitle', 'reportsTitle'] as const

export default function LandingPage() {
  const { t } = useTranslation()
  const [orders, setOrders] = useState(120)
  const [bill, setBill] = useState(450)
  const [mins, setMins] = useState(3)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const monthly = orders * bill * 30
  const hoursSaved = Math.round((orders * mins * 30) / 60)
  const fmt = (n: number) =>
    n >= 100000
      ? `৳${(n / 100000).toFixed(1)}L`
      : `৳${Math.round(n).toLocaleString('en-IN')}`
  const gaugeOffset = Math.max(20, 251 - Math.min(1, monthly / 3000000) * 251)

  return (
    <div className="min-h-svh bg-[#eceef3] text-slate-900 antialiased">
      <div className="mx-auto max-w-6xl px-4 pb-0 pt-5 sm:px-6">
        {/* Pill nav (Apptics style) */}
        <header className="sticky top-4 z-50 flex items-center justify-between gap-3 rounded-full border border-slate-200 bg-white/95 py-2.5 pl-6 pr-2.5 shadow-lg shadow-slate-900/5 backdrop-blur">
          <span className="text-2xl font-black tracking-tight">
            FOOD<span className="text-orange-600">X</span>
          </span>
          <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-600 lg:flex">
            <a href="#features" className="hover:text-blue-600">{t('landing.navFeatures')}</a>
            <a href="#how" className="hover:text-blue-600">{t('landing.navHow')}</a>
            <a href="#calc" className="hover:text-blue-600">{t('landing.navCalc')}</a>
            <a href="#demo" className="hover:text-blue-600">{t('landing.navDemo')}</a>
            <a href="#contact" className="hover:text-blue-600">{t('landing.navContact')}</a>
          </nav>
          <div className="flex items-center gap-2.5">
            <LanguageToggle />
            <a
              href="#demo"
              className="hidden rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white sm:inline-block"
            >
              {t('landing.panelCta')}
            </a>
          </div>
        </header>

        {/* Hero (CodBe style): gradient headline + dashboard mock */}
        <section className="relative overflow-visible pb-4 pt-12 text-center md:pt-16">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-full"
            style={{
              background:
                'radial-gradient(60% 50% at 20% 0%, rgba(167,139,250,0.20), transparent 70%), radial-gradient(55% 50% at 85% 10%, rgba(96,165,250,0.18), transparent 70%)',
            }}
          />
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-bold text-slate-600 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              {t('landing.heroBadge')}
            </span>
            <p className="mt-6 text-sm font-bold uppercase tracking-[0.2em] text-violet-600">
              {t('landing.heroKicker')}
            </p>
            <h1 className="mx-auto mt-3 max-w-3xl bg-gradient-to-r from-violet-700 via-indigo-600 to-violet-700 bg-clip-text text-5xl font-black leading-[1.08] tracking-tight text-transparent md:text-6xl">
              {t('landing.heroTitle')}
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-500">
              {t('landing.heroSubtitle')}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href={DEMO_STOREFRONT_URL}
                className="rounded-full bg-slate-900 px-7 py-3.5 text-sm font-bold text-white shadow-lg"
              >
                {t('landing.ctaDemo')} →
              </a>
              <a
                href={DEMO_PANEL_URL}
                className="rounded-full border border-slate-200 bg-white px-7 py-3.5 text-sm font-bold text-slate-800 shadow-sm"
              >
                {t('landing.ctaPanel')}
              </a>
            </div>
          </div>

          {/* Dashboard mock on a navy band */}
          <div className="relative mx-auto mt-14 max-w-4xl">
            <div className="absolute -inset-x-6 top-10 bottom-[-1.5rem] -rotate-2 rounded-[2.5rem] bg-indigo-950" />
            <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white text-left shadow-2xl">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
                <span className="ml-3 text-xs font-semibold text-slate-400">
                  demo.foodx.bond/panel
                </span>
              </div>
              <div className="flex">
                <div className="hidden w-32 shrink-0 flex-col gap-2 bg-violet-700 p-3 sm:flex">
                  <span className="text-sm font-black text-white">
                    FOOD<span className="text-orange-300">X</span>
                  </span>
                  {['w-4/5', 'w-3/5', 'w-4/5', 'w-2/5', 'w-3/5', 'w-4/5'].map((w, i) => (
                    <span key={i} className={`h-2 rounded-full bg-white/30 ${w}`} />
                  ))}
                </div>
                <div className="min-w-0 flex-1 p-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold text-slate-400">{t('landing.mockSales')}</p>
                      <p className="mt-1 text-base font-black sm:text-xl">৳48,250</p>
                      <p className="text-[11px] font-bold text-green-600">↑ 12%</p>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold text-slate-400">{t('landing.mockOrders')}</p>
                      <p className="mt-1 text-base font-black sm:text-xl">132</p>
                      <p className="text-[11px] font-bold text-green-600">↑ 8%</p>
                    </div>
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold text-slate-400">{t('landing.mockTables')}</p>
                      <p className="mt-1 text-base font-black sm:text-xl">5 / 7</p>
                      <p className="text-[11px] font-bold text-orange-600">● Live</p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[1.5fr_1fr]">
                    <div className="rounded-2xl border border-slate-100 p-3">
                      <p className="text-[11px] font-semibold text-slate-400">{t('landing.reportsTitle')}</p>
                      <svg viewBox="0 0 300 90" className="mt-2 w-full" preserveAspectRatio="none">
                        <polyline points="0,68 40,60 80,64 120,45 160,50 200,30 240,36 300,14" fill="none" stroke="#2563eb" strokeWidth="3" />
                        <polyline points="0,78 40,72 80,68 120,58 160,52 200,44 240,36 300,26" fill="none" stroke="#22c55e" strokeWidth="3" />
                      </svg>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-bold text-orange-600">T1 · {t('landing.mockPreparing')}</span>
                        <span className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-bold text-green-600">T2 · {t('landing.mockReady')}</span>
                        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-600">T3 · 🔔</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-100 p-3">
                      <div
                        className="flex h-24 w-24 items-center justify-center rounded-full"
                        style={{ background: 'conic-gradient(#2563eb 0 71%, #e8eaf3 71% 100%)' }}
                      >
                        <div className="flex h-[4.2rem] w-[4.2rem] items-center justify-center rounded-full bg-white text-lg font-black">
                          5/7
                        </div>
                      </div>
                      <p className="mt-2 text-center text-[11px] font-semibold text-slate-400">
                        {t('landing.mockOccupied')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="absolute -left-4 top-14 hidden items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xl md:flex lg:-left-12">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <Bell className="h-5 w-5" />
              </span>
              <span className="text-sm font-bold">{t('landing.mockCall')}</span>
            </div>
            <div className="absolute -right-4 top-6 hidden items-center gap-2.5 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-xl md:flex lg:-right-12">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100 text-green-600">
                <Check className="h-5 w-5" />
              </span>
              <span className="text-sm font-bold">
                {t('landing.mockPaid')} · ৳680
              </span>
            </div>
          </div>

          {/* Public demo login (owner's decision 2026-11-18: the panel
              is the product, so prospects can click through it). */}
          <div
            id="demo"
            className="relative mx-auto mt-16 flex max-w-xl flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-6 text-left shadow-lg shadow-slate-900/5"
          >
            <div>
              <p className="font-bold">{t('landing.demoLoginTitle')}</p>
              <p className="mt-1.5 flex flex-wrap gap-2">
                <code className="rounded-lg bg-slate-100 px-2.5 py-1 text-[13px] font-semibold">{DEMO_LOGIN_EMAIL}</code>
                <code className="rounded-lg bg-slate-100 px-2.5 py-1 text-[13px] font-semibold">{DEMO_LOGIN_PASSWORD}</code>
              </p>
              <p className="mt-2 max-w-sm text-[13px] text-slate-500">{t('landing.demoLoginNote')}</p>
            </div>
            <a
              href={DEMO_PANEL_URL}
              className="rounded-full bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-600/30"
            >
              {t('landing.ctaPanel')}
            </a>
          </div>
        </section>
        {/* Steps rail (Apptics style) */}
        <section id="how" className="grid items-start gap-8 py-16 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="lg:sticky lg:top-28">
            <span className="inline-block rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 shadow-sm">
              {t('landing.navHow')}
            </span>
            <h2 className="mt-4 text-4xl font-black tracking-tight">{t('landing.stepsTitle')}</h2>
            <p className="mt-3 max-w-md text-slate-500">{t('landing.stepsBody')}</p>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="mt-6 inline-block rounded-full bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-blue-600/30"
            >
              {t('landing.panelCta')}
            </a>
          </div>
          <div className="space-y-4">
            {STEPS.map(({ icon: Icon, titleKey, bodyKey }, i) => (
              <div
                key={titleKey}
                className="grid grid-cols-[1fr_auto] items-center gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5"
              >
                <div>
                  <div className="text-5xl font-black leading-none text-slate-200">
                    0{i + 1}
                  </div>
                  <span className="mt-2.5 inline-block rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-600">
                    STEP {i + 1}
                  </span>
                  <h3 className="mt-2 text-lg font-extrabold">{t(`landing.${titleKey}`)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">{t(`landing.${bodyKey}`)}</p>
                </div>
                <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-slate-50 text-blue-600">
                  <Icon className="h-10 w-10" />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Features trio */}
        <section id="features" className="py-10">
          <Kicker>{t('landing.navFeatures')}</Kicker>
          <h2 className="mt-4 text-center text-4xl font-black tracking-tight">
            {t('landing.featuresTitle')}
            <XChip />
          </h2>
          <p className="mb-9 mt-2 text-center text-slate-500">{t('landing.featuresSub')}</p>
          <div className="grid gap-5 md:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5">
              <MonitorSmartphone className="h-8 w-8 text-blue-600" />
              <h3 className="mt-3 text-lg font-extrabold">{t('landing.posTitle')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{t('landing.posBody')}</p>
              <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-[13px]">
                <div className="flex justify-between border-b border-dashed border-slate-200 py-1.5">
                  <span>🍔 Chicken Burger ×2</span>
                  <b>৳560</b>
                </div>
                <div className="flex justify-between border-b border-dashed border-slate-200 py-1.5">
                  <span>🥤 Soft Drink ×2</span>
                  <b>৳120</b>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span>Table T2</span>
                  <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-bold text-green-700">
                    {t('landing.mockPaid')} ৳680
                  </span>
                </div>
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5">
              <ChefHat className="h-8 w-8 text-blue-600" />
              <h3 className="mt-3 text-lg font-extrabold">{t('landing.kitchenTitle')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{t('landing.kitchenBody')}</p>
              <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-[13px]">
                <div className="flex items-center justify-between border-b border-dashed border-slate-200 py-1.5">
                  <span>#112 · Grilled Chicken</span>
                  <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-bold text-orange-700">{t('landing.mockPreparing')}</span>
                </div>
                <div className="flex items-center justify-between border-b border-dashed border-slate-200 py-1.5">
                  <span>#112 · Soft Drink</span>
                  <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[11px] font-bold text-green-700">{t('landing.mockReady')}</span>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span>#113 · Beef Biryani</span>
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-bold text-blue-700">{t('landing.mockKitchen')}</span>
                </div>
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5">
              <BarChart3 className="h-8 w-8 text-blue-600" />
              <h3 className="mt-3 text-lg font-extrabold">{t('landing.reportsTitle')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{t('landing.reportsBody')}</p>
              <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                <svg viewBox="0 0 300 86" className="w-full" preserveAspectRatio="none">
                  <polyline points="0,66 40,58 80,62 120,44 160,48 200,30 240,34 300,16" fill="none" stroke="#2563eb" strokeWidth="3" />
                  <polyline points="0,74 40,70 80,66 120,58 160,52 200,46 240,38 300,28" fill="none" stroke="#22c55e" strokeWidth="3" />
                  <polyline points="0,80 40,76 80,74 120,68 160,64 200,58 240,52 300,44" fill="none" stroke="#a78bfa" strokeWidth="3" />
                </svg>
                <p className="mt-2 text-right text-[13px] font-bold text-green-600">↑ 12%</p>
              </div>
            </div>
          </div>
        </section>

        {/* Calculator */}
        <section id="calc" className="py-16">
          <Kicker>{t('landing.navCalc')}</Kicker>
          <h2 className="mt-4 text-center text-4xl font-black tracking-tight">
            {t('landing.calcTitle')}
            <XChip />
          </h2>
          <p className="mb-9 mt-2 text-center text-slate-500">{t('landing.calcSub')}</p>
          <div className="grid items-stretch gap-5 lg:grid-cols-[1fr_1.35fr]">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5">
              {[
                { label: t('landing.calcOrders'), value: orders, set: setOrders, min: 20, max: 400, step: 1, display: `${orders}` },
                { label: t('landing.calcBill'), value: bill, set: setBill, min: 150, max: 2000, step: 10, display: `৳${bill.toLocaleString('en-IN')}` },
                { label: t('landing.calcMins'), value: mins, set: setMins, min: 1, max: 8, step: 1, display: `${mins} min` },
              ].map((s) => (
                <div key={s.label} className="my-5">
                  <label className="mb-2 flex justify-between text-[13px] font-bold text-slate-600">
                    {s.label}
                    <span>{s.display}</span>
                  </label>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={s.value}
                    onChange={(e) => s.set(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </div>
              ))}
              <div className="mt-6 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3.5">
                <span className="text-[13px] font-bold text-slate-600">{t('landing.calcHours')}</span>
                <b className="text-xl font-black">{hoursSaved} hrs</b>
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5">
              <div className="flex flex-wrap items-center gap-6">
                <svg width="190" height="120" viewBox="0 0 190 120" className="shrink-0">
                  <path d="M15 105 A 80 80 0 0 1 175 105" fill="none" stroke="#e8eaf3" strokeWidth="17" strokeLinecap="round" />
                  <path
                    d="M15 105 A 80 80 0 0 1 175 105"
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="17"
                    strokeLinecap="round"
                    strokeDasharray="251"
                    strokeDashoffset={gaugeOffset}
                  />
                  <text x="95" y="80" textAnchor="middle" fontSize="21" fontWeight="900" fill="#0f172a">
                    {fmt(monthly)}
                  </text>
                  <text x="95" y="99" textAnchor="middle" fontSize="10.5" fill="#64748b">
                    {t('landing.calcTracked')}
                  </text>
                </svg>
                <div className="min-w-52 flex-1 text-sm">
                  <div className="flex justify-between border-b border-dashed border-slate-200 py-2">
                    <span className="text-slate-500">{t('landing.calcOrdersMonth')}</span>
                    <b>{(orders * 30).toLocaleString('en-IN')}</b>
                  </div>
                  <div className="flex justify-between border-b border-dashed border-slate-200 py-2">
                    <span className="text-slate-500">{t('landing.calcHours')}</span>
                    <b>{hoursSaved} hrs</b>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className="text-slate-500">{t('landing.calcTracked')}</span>
                    <b className="text-blue-600">{fmt(monthly)}</b>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-500">{t('landing.calcNote')}</p>
            </div>
          </div>
        </section>

        {/* Bento benefits */}
        <section className="py-10">
          <Kicker>{t('landing.whyTitle')}</Kicker>
          <h2 className="mt-4 text-center text-4xl font-black tracking-tight">
            {t('landing.bentoTitle')}
            <XChip />
          </h2>
          <p className="mb-9 mt-2 text-center text-slate-500">{t('landing.bentoSub')}</p>
          <div className="grid gap-5 md:grid-cols-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5 md:col-span-2">
              <LayoutGrid className="h-8 w-8 text-blue-600" />
              <h3 className="mt-3 text-lg font-extrabold">{t('landing.liveTablesTitle')}</h3>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-orange-50 px-2.5 py-1 text-[11px] font-bold text-orange-600">T1 · {t('landing.mockPreparing')}</span>
                <span className="rounded-full bg-green-50 px-2.5 py-1 text-[11px] font-bold text-green-600">T2 · {t('landing.mockReady')} · {t('landing.mockPaid')}</span>
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-600">T3 · 🔔</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">T4 · —</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-500">{t('landing.liveTablesBody')}</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5">
              <span className="rounded-full bg-green-100 px-2.5 py-1 text-[11px] font-bold text-green-700">● Live</span>
              <div className="mt-4 flex h-16 items-center gap-1">
                {[35, 60, 45, 80, 55, 95, 70, 88, 50, 100, 66, 78, 58, 92].map((h, i) => (
                  <span
                    key={i}
                    className="flex-1 rounded-full bg-gradient-to-t from-green-500 to-green-400"
                    style={{ height: `${h}%` }}
                  />
                ))}
              </div>
              <h3 className="mt-3 text-lg font-extrabold">{t('landing.revenueTitle')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{t('landing.revenueBody')}</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5">
              <ShieldCheck className="h-8 w-8 text-blue-600" />
              <h3 className="mt-3 text-lg font-extrabold">{t('landing.unpaidTitle')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{t('landing.unpaidBody')}</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5">
              <QrCode className="h-8 w-8 text-blue-600" />
              <h3 className="mt-3 text-lg font-extrabold">{t('landing.qrTitle')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{t('landing.qrBody')}</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{t('landing.orderingBody')}</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5">
              <Bike className="h-8 w-8 text-blue-600" />
              <h3 className="mt-3 text-lg font-extrabold">{t('landing.deliveryTitle')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{t('landing.deliveryBody')}</p>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg shadow-slate-900/5">
              <Package className="h-8 w-8 text-blue-600" />
              <h3 className="mt-3 text-lg font-extrabold">{t('landing.busyworkTitle')}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">{t('landing.busyworkBody')}</p>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{t('landing.inventoryBody')}</p>
            </div>
            <div className="rounded-3xl bg-gradient-to-br from-violet-600 via-blue-600 to-cyan-500 p-6 text-white shadow-lg shadow-blue-600/30 md:col-span-2">
              <h3 className="text-lg font-extrabold">{t('landing.bentoCtaTitle')}</h3>
              <p className="mt-1 max-w-md text-sm leading-relaxed text-white/85">{t('landing.bentoCtaBody')}</p>
              <a
                href={DEMO_PANEL_URL}
                className="mt-5 inline-block rounded-full bg-white px-6 py-3 text-sm font-bold text-slate-900"
              >
                {t('landing.ctaPanel')}
              </a>
            </div>
          </div>
        </section>
        {/* Included panel (blue, Apptics pricing-panel shape — §82: no
            prices or testimonials until the owner supplies real ones) */}
        <section className="py-16">
          <div className="grid gap-7 rounded-[2rem] bg-gradient-to-br from-blue-800 via-blue-600 to-sky-500 p-8 text-white shadow-2xl shadow-blue-600/30 md:p-10 lg:grid-cols-[1.15fr_1fr]">
            <div>
              <span className="rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider">
                {t('landing.panelKicker')}
              </span>
              <h3 className="mt-4 text-3xl font-black tracking-tight">{t('landing.panelTitle')}</h3>
              <p className="mt-2.5 max-w-md text-[15px] leading-relaxed text-white/85">
                {t('landing.panelBody')}
              </p>
              <p className="mt-5 max-w-md rounded-2xl border border-white/25 bg-white/10 p-4 text-sm leading-relaxed">
                {t('landing.why1Body')}
              </p>
            </div>
            <div className="rounded-3xl bg-white p-6 text-slate-900 shadow-xl">
              <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold text-blue-600">
                {t('landing.featuresTitle')}
              </span>
              <ul className="mt-4 space-y-2.5 text-sm font-medium text-slate-600">
                {PANEL_INCLUDES.map((key) => (
                  <li key={key} className="flex items-center gap-2">
                    <Check className="h-4 w-4 shrink-0 text-green-600" />
                    {t(`landing.${key}`)}
                  </li>
                ))}
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-green-600" />
                  {t('landing.liveTablesTitle')}
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-green-600" />
                  {t('landing.languageTitle')}
                </li>
              </ul>
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-6 block rounded-full bg-slate-900 py-3 text-center text-sm font-bold text-white"
              >
                {t('landing.panelCta')}
              </a>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="py-10">
          <Kicker>FAQs</Kicker>
          <h2 className="mt-4 text-center text-4xl font-black tracking-tight">
            {t('landing.faqTitle')}
            <XChip />
          </h2>
          <p className="mb-9 mt-2 text-center text-slate-500">{t('landing.faqSub')}</p>
          <div className="grid items-start gap-3 lg:grid-cols-2">
            {FAQS.map((n) => {
              const open = openFaq === n
              return (
                <div
                  key={n}
                  className="rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(open ? null : n)}
                    className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left text-sm font-bold"
                  >
                    {t(`landing.q${n}`)}
                    <span className="text-lg font-black text-blue-600">{open ? '−' : '+'}</span>
                  </button>
                  {open && (
                    <p className="px-5 pb-4 text-sm leading-relaxed text-slate-500">
                      {t(`landing.a${n}`)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* Comparison */}
        <section className="grid items-start gap-8 py-16 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <span className="inline-block rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 shadow-sm">
              FoodX vs {t('landing.cmpOthers')}
            </span>
            <h2 className="mt-4 text-4xl font-black tracking-tight">{t('landing.cmpTitle')}</h2>
            <p className="mt-3 max-w-md leading-relaxed text-slate-500">{t('landing.cmpBody')}</p>
            <a
              href="#demo"
              className="mt-6 inline-block rounded-full bg-slate-900 px-6 py-3 text-sm font-bold text-white"
            >
              {t('landing.ctaDemo')} →
            </a>
          </div>
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left">
                  <th className="px-5 py-3.5 font-bold text-slate-400"></th>
                  <th className="px-3 py-3.5 text-center font-bold text-slate-400">
                    {t('landing.cmpOthers')}
                  </th>
                  <th className="bg-gradient-to-b from-blue-500 to-blue-600 px-3 py-3.5 text-center font-black text-white">
                    FoodX
                  </th>
                </tr>
              </thead>
              <tbody>
                {CMP_ROWS.map((key) => (
                  <tr key={key} className="border-b border-slate-100 last:border-0">
                    <td className="px-5 py-3.5 font-medium">{t(`landing.${key}`)}</td>
                    <td className="px-3 py-3.5 text-center">
                      <X className="mx-auto h-4 w-4 text-red-500" />
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      <Check className="mx-auto h-4 w-4 font-black text-green-600" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Final CTA + contact */}
        <section id="contact" className="pb-6 pt-10 text-center">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-violet-600">
            {t('landing.heroKicker')}
          </p>
          <h2 className="mx-auto mt-3 max-w-2xl text-4xl font-black tracking-tight md:text-5xl">
            {t('landing.finalTitle')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-500">{t('landing.finalBody')}</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-600/30"
            >
              <MessageCircle className="h-5 w-5" />
              {t('landing.contactWhatsapp')}
            </a>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-7 py-3.5 text-sm font-bold text-slate-800 shadow-sm"
            >
              <Mail className="h-5 w-5" />
              {CONTACT_EMAIL}
            </a>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-10 overflow-hidden rounded-t-[2rem] border border-b-0 border-slate-200 bg-white px-6 pt-9">
          <div className="flex flex-wrap justify-between gap-6 text-sm text-slate-500">
            <div>
              <span className="text-xl font-black text-slate-900">
                FOOD<span className="text-orange-600">X</span>
              </span>
              <p className="mt-2">{t('landing.footerTagline')}</p>
              <p>{t('landing.footerDemoNote')}</p>
            </div>
            <div>
              <b className="mb-2 block text-slate-900">{t('landing.navFeatures')}</b>
              <a href="#features" className="block py-0.5 hover:text-blue-600">{t('landing.posTitle')}</a>
              <a href="#features" className="block py-0.5 hover:text-blue-600">{t('landing.kitchenTitle')}</a>
              <a href="#features" className="block py-0.5 hover:text-blue-600">{t('landing.liveTablesTitle')}</a>
              <a href="#features" className="block py-0.5 hover:text-blue-600">{t('landing.deliveryTitle')}</a>
            </div>
            <div>
              <b className="mb-2 block text-slate-900">{t('landing.navHow')}</b>
              <a href="#how" className="block py-0.5 hover:text-blue-600">{t('landing.stepsTitle')}</a>
              <a href="#calc" className="block py-0.5 hover:text-blue-600">{t('landing.navCalc')}</a>
              <a href="#faq" className="block py-0.5 hover:text-blue-600">{t('landing.faqTitle')}</a>
              <a href="#demo" className="block py-0.5 hover:text-blue-600">{t('landing.navDemo')}</a>
            </div>
            <div>
              <b className="mb-2 block text-slate-900">{t('landing.navContact')}</b>
              <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="block py-0.5 hover:text-blue-600">
                {t('landing.contactWhatsapp')}
              </a>
              <a href={`mailto:${CONTACT_EMAIL}`} className="block py-0.5 hover:text-blue-600">
                {CONTACT_EMAIL}
              </a>
            </div>
          </div>
          <div
            aria-hidden
            className="mt-4 select-none text-center text-[11rem] font-black leading-[0.78] tracking-tight text-transparent max-lg:text-[5.5rem]"
            style={{ WebkitTextStroke: '2px #edf0f7' }}
          >
            FOODX
          </div>
        </footer>
      </div>
    </div>
  )
}
