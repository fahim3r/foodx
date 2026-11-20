// FoodX — Easy Mode v2 (wave E3; design §8, wizard 2): write an
// expense the guided way — amount → what for → who for — wrapping
// the same createExpense call the Business page uses.
//
// The four big "what for" buttons map onto the restaurant's own
// seeded system expense categories (§36 defaults), matched by
// name among the active rows: বাজারসামগ্রী → Supplies, বিল →
// Utilities (then Electricity / Gas / Internet / Rent), বেতন →
// Salary, অন্যান্য → Other (falling back to the first active
// category). Expenses have no supplier column in this schema, so
// the optional "who for" answer is stored in the expense's notes
// — exactly where the normal form's free-text note goes. The
// payment method is 'cash', the normal form's default; the date
// is today and the branch is left unset, as the form allows.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import {
  BigChoiceButton,
  EasyOnlyNote,
  EasyWizardQuestion,
  EasyWizardShell,
  EasyWizardSuccess,
} from '@/components/EasyWizard'
import { useAuth } from '@/hooks/useAuth'
import { useEasyMode } from '@/hooks/useEasyMode'
import { formatMoney, roundMoney } from '@/lib/money'
import {
  createExpense,
  fetchExpenseCategories,
  toDateString,
} from '@/services/business'
import type { ExpenseCategory } from '@/types'

interface ChoiceDef {
  key: string
  labelKey: string
  names: string[]
}

const CHOICE_DEFS: ChoiceDef[] = [
  { key: 'supplies', labelKey: 'easy.wizard.catSupplies', names: ['Supplies'] },
  {
    key: 'bills',
    labelKey: 'easy.wizard.catBills',
    names: ['Utilities', 'Electricity', 'Gas', 'Internet', 'Rent'],
  },
  { key: 'salary', labelKey: 'easy.wizard.catSalary', names: ['Salary'] },
  { key: 'other', labelKey: 'easy.wizard.catOther', names: ['Other'] },
]

interface ResolvedChoice {
  key: string
  labelKey: string
  categoryId: string
}

function resolveChoices(rows: ExpenseCategory[]): ResolvedChoice[] {
  const active = rows.filter((row) => row.is_active)
  const resolved: ResolvedChoice[] = []
  for (const def of CHOICE_DEFS) {
    const match =
      active.find((row) =>
        def.names.some(
          (name) => name.toLowerCase() === row.name.toLowerCase(),
        ),
      ) ?? (def.key === 'other' ? active[0] : undefined)
    if (match) {
      resolved.push({ key: def.key, labelKey: def.labelKey, categoryId: match.id })
    }
  }
  return resolved
}

export default function AddExpenseWizardPage() {
  const { t } = useTranslation()
  const { easy } = useEasyMode()
  if (!easy) {
    return (
      <EasyOnlyNote normalTo="/business" normalLabel={t('easy.nav.money')} />
    )
  }
  return <AddExpenseWizard />
}

function AddExpenseWizard() {
  const { t } = useTranslation()
  const { user, restaurant, settings } = useAuth()
  const restaurantId = restaurant?.id
  const currency = settings?.currency ?? 'BDT'

  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [amount, setAmount] = useState('')
  const [choices, setChoices] = useState<ResolvedChoice[] | null>(null)
  const [choiceKey, setChoiceKey] = useState<string | null>(null)
  const [who, setWho] = useState('')
  const [doneAmount, setDoneAmount] = useState<string | null>(null)

  useEffect(() => {
    if (!restaurantId) return
    let cancelled = false
    void fetchExpenseCategories(restaurantId)
      .then((rows) => {
        if (!cancelled) setChoices(resolveChoices(rows))
      })
      .catch(() => {
        if (!cancelled) setChoices([])
      })
    return () => {
      cancelled = true
    }
  }, [restaurantId])

  const selected = choices?.find((choice) => choice.key === choiceKey) ?? null

  const handleSave = async () => {
    if (!restaurantId || busy || !selected) return
    setError(null)
    setBusy(true)
    try {
      const value = roundMoney(Number.parseFloat(amount))
      await createExpense({
        restaurantId,
        branchId: null,
        categoryId: selected.categoryId,
        amount: value,
        date: toDateString(new Date()),
        paymentMethod: 'cash',
        notes: who.trim() || null,
        userId: user?.id ?? null,
      })
      setDoneAmount(formatMoney(value, currency))
    } catch {
      setError(t('easy.wizard.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const goNext = () => {
    setError(null)
    if (step === 0) {
      const value = Number.parseFloat(amount)
      if (!Number.isFinite(value) || value <= 0) {
        setError(t('easy.wizard.amountRequired'))
        return
      }
      setStep(1)
    } else if (step === 2) {
      void handleSave()
    }
  }

  if (!restaurantId) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  if (doneAmount !== null) {
    return (
      <EasyWizardSuccess
        message={t('easy.wizard.expenseSaved', { amount: doneAmount })}
        doneTo="/business"
      />
    )
  }

  return (
    <EasyWizardShell
      title={t('easy.tile.addExpense')}
      step={step}
      stepCount={3}
      error={error}
      busy={busy}
      onBack={step > 0 ? () => setStep(step - 1) : undefined}
      onNext={step === 1 ? undefined : goNext}
      nextLabel={
        step === 2 ? t('easy.wizard.saveExpense') : t('common.next')
      }
    >
      {step === 0 && (
        <>
          <EasyWizardQuestion>{t('easy.wizard.amountQ')}</EasyWizardQuestion>
          <Input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            className="h-12 text-lg"
            autoFocus
          />
        </>
      )}

      {step === 1 && (
        <>
          <EasyWizardQuestion>
            {t('easy.wizard.expenseWhatQ')}
          </EasyWizardQuestion>
          {choices === null ? (
            <p className="text-muted-foreground">{t('common.loading')}</p>
          ) : choices.length === 0 ? (
            <p className="text-base font-medium text-destructive">
              {t('easy.wizard.noCategory')}
            </p>
          ) : (
            choices.map((choice) => (
              <BigChoiceButton
                key={choice.key}
                selected={choiceKey === choice.key}
                onClick={() => {
                  setError(null)
                  setChoiceKey(choice.key)
                  setStep(2)
                }}
              >
                {t(choice.labelKey)}
              </BigChoiceButton>
            ))
          )}
        </>
      )}

      {step === 2 && (
        <>
          <EasyWizardQuestion>
            {t('easy.wizard.expenseWhoQ')}
          </EasyWizardQuestion>
          <p className="text-base text-muted-foreground">
            {t('easy.wizard.expenseWhoHint')}
          </p>
          <Input
            value={who}
            onChange={(event) => setWho(event.target.value)}
            placeholder={t('easy.wizard.expenseWhoPlaceholder')}
            className="h-12 text-lg"
          />
        </>
      )}
    </EasyWizardShell>
  )
}
