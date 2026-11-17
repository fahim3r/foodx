// FoodX — Business page (protected, Phase 7).
// Tabs: Expenses | Shifts & Closing | Reports | Profit & Loss.
//
// RULES kept from earlier phases:
// - Expenses are voided, never deleted (§46); expected cash is always
//   computed by the service from DB rows, never typed by the user (§38).
// - Money inputs stay STRINGS in form state and are parsed + rounded
//   only on submit — the Phase 3 number-input lesson.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { isMissingTableError } from '@/lib/errors'
import { formatMoney, roundMoney } from '@/lib/money'
import { useAuth } from '@/hooks/useAuth'
import { useLicenseState } from '@/hooks/useLicenseState'
import { isModuleEnabled } from '@/services/heartbeat'
import {
  addCashMovement,
  closeDay,
  closeShift,
  createExpense,
  createExpenseCategory,
  fetchDailyClosings,
  fetchExpenseCategories,
  fetchExpenses,
  fetchMyOpenShift,
  fetchShiftMovements,
  fetchShiftSummary,
  fetchShifts,
  openShift,
  setExpenseCategoryActive,
  toDateString,
  updateExpense,
  voidExpense,
  type ShiftSummary,
} from '@/services/business'
import { fetchBranches, type Branch } from '@/services/restaurant'
import type {
  CashMovementType,
  CashierShift,
  DailyClosing,
  Expense,
  ExpenseCategory,
  PaymentMethod,
  ShiftCashMovement,
} from '@/types'
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
import ReportsPanel, { ProfitLossPanel } from './ReportsPanel'

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

const PAYMENT_METHODS: PaymentMethod[] = [
  'cash',
  'card',
  'bkash',
  'nagad',
  'bank',
  'due',
]

type Tab = 'expenses' | 'shifts' | 'reports' | 'pl'

const TABS: Tab[] = ['expenses', 'shifts', 'reports', 'pl']

const TAB_KEYS: Record<Tab, string> = {
  expenses: 'business.tabExpenses',
  shifts: 'business.tabShifts',
  reports: 'business.tabReports',
  pl: 'business.tabPl',
}

function methodKey(method: PaymentMethod): string {
  return `pos.method${method.charAt(0).toUpperCase()}${method.slice(1)}`
}

export default function BusinessPage() {
  const { t } = useTranslation()
  const { loading: authLoading, user, restaurant, settings } = useAuth()
  const licenseView = useLicenseState()
  const [tab, setTab] = useState<Tab>('expenses')
  const [dbPending, setDbPending] = useState(false)

  const restaurantId = restaurant?.id
  const userId = user?.id ?? null
  const currency = settings?.currency ?? 'BDT'

  if (authLoading) {
    return (
      <p className="text-muted-foreground">{t('common.loading')}</p>
    )
  }

  if (!restaurantId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.setupRestaurant')}</CardTitle>
        </CardHeader>
      </Card>
    )
  }

  if (!isModuleEnabled(licenseView, 'accounting')) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>{t('license.moduleDisabledTitle')}</CardTitle>
            <CardDescription>
              {t('license.moduleDisabledBody')}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (dbPending) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('layout.dbPendingTitle')}</CardTitle>
          <CardDescription>{t('layout.dbPendingBody')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('business.title')}</h1>
        <p className="text-muted-foreground">{t('business.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((key) => (
          <Button
            key={key}
            type="button"
            variant={tab === key ? 'default' : 'outline'}
            onClick={() => setTab(key)}
          >
            {t(TAB_KEYS[key])}
          </Button>
        ))}
      </div>

      {tab === 'expenses' && (
        <ExpensesTab
          restaurantId={restaurantId}
          userId={userId}
          currency={currency}
          onDbPending={() => setDbPending(true)}
        />
      )}
      {tab === 'shifts' && (
        <ShiftsTab
          restaurantId={restaurantId}
          userId={userId}
          currency={currency}
          onDbPending={() => setDbPending(true)}
        />
      )}
      {tab === 'reports' && (
        <ReportsPanel restaurantId={restaurantId} currency={currency} />
      )}
      {tab === 'pl' && (
        <ProfitLossPanel restaurantId={restaurantId} currency={currency} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Expenses tab
// ---------------------------------------------------------------------------

function ExpensesTab({
  restaurantId,
  userId,
  currency,
  onDbPending,
}: {
  restaurantId: string
  userId: string | null
  currency: string
  onDbPending: () => void
}) {
  const { t } = useTranslation()
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterCategory, setFilterCategory] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [formCategory, setFormCategory] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formDate, setFormDate] = useState(toDateString(new Date()))
  const [formMethod, setFormMethod] = useState<PaymentMethod>('cash')
  const [formBranch, setFormBranch] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [voidConfirmId, setVoidConfirmId] = useState<string | null>(null)
  const [newCategoryName, setNewCategoryName] = useState('')

  const categoryName = useCallback(
    (category: ExpenseCategory): string =>
      category.is_system
        ? t(`business.cat_${category.name.toUpperCase()}`, {
            defaultValue: category.name,
          })
        : category.name,
    [t],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cats, brs, exps] = await Promise.all([
        fetchExpenseCategories(restaurantId),
        fetchBranches(restaurantId),
        fetchExpenses(restaurantId, {
          fromDate: filterFrom || undefined,
          toDate: filterTo || undefined,
          categoryId: filterCategory || undefined,
        }),
      ])
      setCategories(cats)
      setBranches(brs)
      setExpenses(exps)
      setFormCategory((prev) =>
        prev && cats.some((c) => c.id === prev)
          ? prev
          : (cats.find((c) => c.is_active)?.id ?? ''),
      )
    } catch (err) {
      if (isMissingTableError(err)) onDbPending()
      else setError(t('business.loadError'))
    } finally {
      setLoading(false)
    }
  }, [restaurantId, filterFrom, filterTo, filterCategory, onDbPending, t])

  useEffect(() => {
    void load()
  }, [load])

  const branchName = (id: string | null): string =>
    branches.find((b) => b.id === id)?.name ?? '—'
  const categoryById = (id: string): ExpenseCategory | undefined =>
    categories.find((c) => c.id === id)

  const total = roundMoney(
    expenses
      .filter((e) => !e.is_voided)
      .reduce((sum, e) => sum + Number(e.amount), 0),
  )

  const resetForm = () => {
    setEditingId(null)
    setFormAmount('')
    setFormDate(toDateString(new Date()))
    setFormMethod('cash')
    setFormBranch('')
    setFormNotes('')
    setFormCategory(categories.find((c) => c.is_active)?.id ?? '')
  }

  const startEdit = (expense: Expense) => {
    setEditingId(expense.id)
    setFormCategory(expense.category_id)
    setFormAmount(String(expense.amount))
    setFormDate(expense.expense_date)
    setFormMethod(expense.payment_method)
    setFormBranch(expense.branch_id ?? '')
    setFormNotes(expense.notes ?? '')
    setError(null)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const amount = roundMoney(Number.parseFloat(formAmount))
    if (!formCategory) {
      setError(t('business.selectCategory'))
      return
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('business.invalidAmount'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (editingId) {
        await updateExpense(editingId, {
          categoryId: formCategory,
          amount,
          date: formDate,
          paymentMethod: formMethod,
          notes: formNotes.trim() || null,
          branchId: formBranch || null,
        })
      } else {
        await createExpense({
          restaurantId,
          branchId: formBranch || null,
          categoryId: formCategory,
          amount,
          date: formDate,
          paymentMethod: formMethod,
          notes: formNotes.trim() || null,
          userId,
        })
      }
      resetForm()
      await load()
    } catch {
      setError(t('business.saveError'))
    } finally {
      setBusy(false)
    }
  }

  const handleVoid = async (expense: Expense) => {
    if (voidConfirmId !== expense.id) {
      setVoidConfirmId(expense.id)
      return
    }
    setBusy(true)
    try {
      await voidExpense(expense.id, userId)
      setVoidConfirmId(null)
      await load()
    } catch {
      setError(t('business.saveError'))
    } finally {
      setBusy(false)
    }
  }

  const handleAddCategory = async (event: FormEvent) => {
    event.preventDefault()
    const name = newCategoryName.trim()
    if (!name) return
    setBusy(true)
    try {
      await createExpenseCategory(restaurantId, name)
      setNewCategoryName('')
      await load()
    } catch {
      setError(t('business.saveError'))
    } finally {
      setBusy(false)
    }
  }

  const toggleCategory = async (category: ExpenseCategory) => {
    setBusy(true)
    try {
      await setExpenseCategoryActive(category.id, !category.is_active)
      await load()
    } catch {
      setError(t('business.saveError'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {editingId ? t('business.editExpense') : t('business.addExpense')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(e) => void handleSubmit(e)}
          >
            <div className="space-y-2">
              <Label>{t('business.category')}</Label>
              <select
                className={SELECT_CLASS}
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
              >
                {categories
                  .filter((c) => c.is_active || c.id === formCategory)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {categoryName(c)}
                    </option>
                  ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t('business.amount')}</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('business.date')}</Label>
              <Input
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('business.paymentMethod')}</Label>
              <select
                className={SELECT_CLASS}
                value={formMethod}
                onChange={(e) =>
                  setFormMethod(e.target.value as PaymentMethod)
                }
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(methodKey(m))}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t('business.branch')}</Label>
              <select
                className={SELECT_CLASS}
                value={formBranch}
                onChange={(e) => setFormBranch(e.target.value)}
              >
                <option value="">{t('business.branchNone')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{t('business.notes')}</Label>
              <Input
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                placeholder={t('business.notesPlaceholder')}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive sm:col-span-2 lg:col-span-3">
                {error}
              </p>
            )}
            <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={busy}>
                {editingId ? t('business.save') : t('business.addExpense')}
              </Button>
              {editingId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetForm}
                  disabled={busy}
                >
                  {t('business.cancelEdit')}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('business.expensesTitle')}</CardTitle>
          <CardDescription>
            {t('business.totalForPeriod')}: {formatMoney(total, currency)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>{t('business.filterFrom')}</Label>
              <Input
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('business.filterTo')}</Label>
              <Input
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('business.category')}</Label>
              <select
                className={SELECT_CLASS}
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
              >
                <option value="">{t('business.allCategories')}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryName(c)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {expenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('business.noExpenses')}
            </p>
          ) : (
            <div className="divide-y">
              {expenses.map((expense) => {
                const category = categoryById(expense.category_id)
                return (
                  <div
                    key={expense.id}
                    className="flex flex-wrap items-center gap-3 py-3"
                  >
                    <div className="min-w-40 flex-1">
                      <p
                        className={
                          expense.is_voided
                            ? 'font-medium line-through opacity-60'
                            : 'font-medium'
                        }
                      >
                        {category ? categoryName(category) : '—'}
                        {' · '}
                        {formatMoney(Number(expense.amount), currency)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {expense.expense_date} ·{' '}
                        {t(methodKey(expense.payment_method))} ·{' '}
                        {branchName(expense.branch_id)}
                        {expense.notes ? ` · ${expense.notes}` : ''}
                      </p>
                    </div>
                    {expense.is_voided ? (
                      <span className="text-sm font-medium text-destructive">
                        {t('business.voided')}
                      </span>
                    ) : (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => startEdit(expense)}
                          disabled={busy}
                        >
                          {t('business.edit')}
                        </Button>
                        <Button
                          type="button"
                          variant={
                            voidConfirmId === expense.id
                              ? 'destructive'
                              : 'outline'
                          }
                          size="sm"
                          onClick={() => void handleVoid(expense)}
                          disabled={busy}
                        >
                          {voidConfirmId === expense.id
                            ? t('business.confirmVoid')
                            : t('business.void')}
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('business.categoriesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <span
                key={category.id}
                className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm"
              >
                {categoryName(category)}
                {category.is_system && (
                  <span className="text-xs text-muted-foreground">
                    {t('business.systemCategory')}
                  </span>
                )}
                <button
                  type="button"
                  className="text-xs underline"
                  onClick={() => void toggleCategory(category)}
                  disabled={busy}
                >
                  {category.is_active
                    ? t('business.deactivate')
                    : t('business.activate')}
                </button>
              </span>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => void handleAddCategory(e)}
          >
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder={t('business.categoryNamePlaceholder')}
              className="max-w-60"
            />
            <Button type="submit" variant="outline" disabled={busy}>
              {t('business.addCategory')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shifts tab
// ---------------------------------------------------------------------------

function ShiftsTab({
  restaurantId,
  userId,
  currency,
  onDbPending,
}: {
  restaurantId: string
  userId: string | null
  currency: string
  onDbPending: () => void
}) {
  const { t } = useTranslation()
  const [branches, setBranches] = useState<Branch[]>([])
  const [myShift, setMyShift] = useState<CashierShift | null>(null)
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [movements, setMovements] = useState<ShiftCashMovement[]>([])
  const [history, setHistory] = useState<CashierShift[]>([])
  const [closings, setClosings] = useState<DailyClosing[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [openingCash, setOpeningCash] = useState('')
  const [openBranch, setOpenBranch] = useState('')
  const [actualCash, setActualCash] = useState('')
  const [moveType, setMoveType] = useState<CashMovementType>('CASH_IN')
  const [moveAmount, setMoveAmount] = useState('')
  const [moveReason, setMoveReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [brs, shifts, closingsRows] = await Promise.all([
        fetchBranches(restaurantId),
        fetchShifts(restaurantId),
        fetchDailyClosings(restaurantId),
      ])
      setBranches(brs)
      setHistory(shifts)
      setClosings(closingsRows)
      if (userId) {
        const open = await fetchMyOpenShift(restaurantId, userId)
        setMyShift(open)
        if (open) {
          const [sum, movs] = await Promise.all([
            fetchShiftSummary(open),
            fetchShiftMovements(open.id),
          ])
          setSummary(sum)
          setMovements(movs)
        } else {
          setSummary(null)
          setMovements([])
        }
      }
    } catch (err) {
      if (isMissingTableError(err)) onDbPending()
      else setError(t('business.loadError'))
    } finally {
      setLoading(false)
    }
  }, [restaurantId, userId, onDbPending, t])

  useEffect(() => {
    void load()
  }, [load])

  const handleOpen = async (event: FormEvent) => {
    event.preventDefault()
    const opening = roundMoney(Number.parseFloat(openingCash || '0'))
    if (!Number.isFinite(opening) || opening < 0) {
      setError(t('shifts.invalidOpening'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await openShift({
        restaurantId,
        branchId: openBranch || null,
        openingCash: opening,
        userId,
        notes: null,
      })
      setOpeningCash('')
      await load()
    } catch {
      setError(t('business.saveError'))
    } finally {
      setBusy(false)
    }
  }

  const handleMovement = async (event: FormEvent) => {
    event.preventDefault()
    if (!myShift) return
    const amount = roundMoney(Number.parseFloat(moveAmount))
    if (!moveReason.trim()) {
      setError(t('shifts.reasonRequired'))
      return
    }
    if (
      !Number.isFinite(amount) ||
      (moveType === 'ADJUSTMENT' ? amount === 0 : amount <= 0)
    ) {
      setError(t('business.invalidAmount'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await addCashMovement({
        shiftId: myShift.id,
        type: moveType,
        amount,
        reason: moveReason,
        userId,
      })
      setMoveAmount('')
      setMoveReason('')
      await load()
    } catch {
      setError(t('business.saveError'))
    } finally {
      setBusy(false)
    }
  }

  const handleClose = async (event: FormEvent) => {
    event.preventDefault()
    if (!myShift) return
    const actual = roundMoney(Number.parseFloat(actualCash))
    if (!Number.isFinite(actual) || actual < 0) {
      setError(t('shifts.invalidActual'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await closeShift(myShift, actual, userId)
      setActualCash('')
      await load()
    } catch {
      setError(t('business.saveError'))
    } finally {
      setBusy(false)
    }
  }

  const handleCloseDay = async () => {
    setBusy(true)
    setError(null)
    try {
      await closeDay(restaurantId, toDateString(new Date()), userId)
      await load()
    } catch {
      setError(t('business.saveError'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!myShift ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('shifts.openShift')}</CardTitle>
            <CardDescription>{t('shifts.noOpenShift')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-3"
              onSubmit={(e) => void handleOpen(e)}
            >
              <div className="space-y-2">
                <Label>{t('shifts.openingCash')}</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={openingCash}
                  onChange={(e) => setOpeningCash(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('business.branch')}</Label>
                <select
                  className={SELECT_CLASS}
                  value={openBranch}
                  onChange={(e) => setOpenBranch(e.target.value)}
                >
                  <option value="">{t('business.branchNone')}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={busy}>
                  {t('shifts.openShift')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('shifts.currentShift')}</CardTitle>
            <CardDescription>
              {t('shifts.openedAt')}:{' '}
              {new Date(myShift.opened_at).toLocaleString()} ·{' '}
              {t('shifts.openingCash')}:{' '}
              {formatMoney(Number(myShift.opening_cash), currency)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {summary && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryStat
                  label={t('shifts.cashSales')}
                  value={formatMoney(summary.cashSales, currency)}
                />
                <SummaryStat
                  label={t('shifts.cashExpenses')}
                  value={formatMoney(summary.cashExpenses, currency)}
                />
                <SummaryStat
                  label={t('shifts.movementsNet')}
                  value={formatMoney(summary.movementsNet, currency)}
                />
                <SummaryStat
                  label={t('shifts.expectedCash')}
                  value={formatMoney(summary.expectedCash, currency)}
                />
              </div>
            )}

            <div>
              <h3 className="mb-2 font-medium">{t('shifts.movementsTitle')}</h3>
              {movements.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('shifts.noMovements')}
                </p>
              ) : (
                <div className="divide-y">
                  {movements.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span>
                        {t(
                          m.type === 'CASH_IN'
                            ? 'shifts.typeCashIn'
                            : m.type === 'CASH_OUT'
                              ? 'shifts.typeCashOut'
                              : 'shifts.typeAdjustment',
                        )}
                        {' · '}
                        {m.reason}
                      </span>
                      <span className="font-medium">
                        {formatMoney(Number(m.amount), currency)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <form
                className="mt-3 grid gap-3 sm:grid-cols-4"
                onSubmit={(e) => void handleMovement(e)}
              >
                <select
                  className={SELECT_CLASS}
                  value={moveType}
                  onChange={(e) =>
                    setMoveType(e.target.value as CashMovementType)
                  }
                >
                  <option value="CASH_IN">{t('shifts.typeCashIn')}</option>
                  <option value="CASH_OUT">{t('shifts.typeCashOut')}</option>
                  <option value="ADJUSTMENT">
                    {t('shifts.typeAdjustment')}
                  </option>
                </select>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={moveAmount}
                  onChange={(e) => setMoveAmount(e.target.value)}
                  placeholder={t('business.amount')}
                />
                <Input
                  value={moveReason}
                  onChange={(e) => setMoveReason(e.target.value)}
                  placeholder={t('shifts.reasonPlaceholder')}
                />
                <Button type="submit" variant="outline" disabled={busy}>
                  {t('shifts.addMovement')}
                </Button>
              </form>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('shifts.adjustmentHint')}
              </p>
            </div>

            <form
              className="grid gap-3 border-t pt-4 sm:grid-cols-3"
              onSubmit={(e) => void handleClose(e)}
            >
              <div className="space-y-1">
                <Label>{t('shifts.actualCash')}</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={actualCash}
                  onChange={(e) => setActualCash(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={busy}>
                  {t('shifts.closeShift')}
                </Button>
              </div>
              {summary && actualCash && (
                <p className="flex items-end text-sm text-muted-foreground">
                  {t('shifts.difference')}:{' '}
                  {formatMoney(
                    roundMoney(
                      Number.parseFloat(actualCash || '0') -
                        summary.expectedCash,
                    ),
                    currency,
                  )}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('shifts.historyTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('shifts.noMovements')}
            </p>
          ) : (
            <div className="divide-y">
              {history.map((shift) => (
                <div
                  key={shift.id}
                  className="flex flex-wrap items-center gap-3 py-2 text-sm"
                >
                  <span className="font-medium">
                    {new Date(shift.opened_at).toLocaleString()}
                  </span>
                  <span>
                    {shift.status === 'OPEN'
                      ? t('shifts.statusOpen')
                      : t('shifts.statusClosed')}
                  </span>
                  <span className="text-muted-foreground">
                    {t('shifts.openingCash')}:{' '}
                    {formatMoney(Number(shift.opening_cash), currency)}
                  </span>
                  {shift.status === 'CLOSED' && (
                    <span className="text-muted-foreground">
                      {t('shifts.expectedCash')}:{' '}
                      {formatMoney(Number(shift.expected_cash ?? 0), currency)}
                      {' · '}
                      {t('shifts.actualCash')}:{' '}
                      {formatMoney(Number(shift.actual_cash ?? 0), currency)}
                      {' · '}
                      {t('shifts.difference')}:{' '}
                      {formatMoney(Number(shift.difference ?? 0), currency)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('shifts.dailyClosingTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            onClick={() => void handleCloseDay()}
            disabled={busy}
          >
            {t('shifts.closeToday')}
          </Button>
          {closings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('shifts.closingsEmpty')}
            </p>
          ) : (
            <div className="divide-y">
              {closings.map((closing) => (
                <div
                  key={closing.id}
                  className="flex flex-wrap gap-3 py-2 text-sm"
                >
                  <span className="font-medium">{closing.closing_date}</span>
                  <span>
                    {t('shifts.colSales')}:{' '}
                    {formatMoney(Number(closing.total_sales), currency)}
                  </span>
                  <span>
                    {t('shifts.colPurchases')}:{' '}
                    {formatMoney(Number(closing.total_purchases), currency)}
                  </span>
                  <span>
                    {t('shifts.colExpenses')}:{' '}
                    {formatMoney(Number(closing.total_expenses), currency)}
                  </span>
                  <span>
                    {t('shifts.colRefunds')}:{' '}
                    {formatMoney(Number(closing.total_refunds), currency)}
                  </span>
                  {closing.difference !== null && (
                    <span>
                      {t('shifts.difference')}:{' '}
                      {formatMoney(Number(closing.difference), currency)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  )
}
