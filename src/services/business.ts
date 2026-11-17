// FoodX — Business service (Phase 7, migration 0013).
//
// Expenses, cashier shifts with computed expected cash, daily
// closings, and read-only reports / P&L. All figures are computed from
// the database rows (orders, order_payments, purchase_orders,
// expenses); nothing here trusts a client-passed total (§37, §68
// pattern). Expenses are voided, never deleted (§46).

import { supabase } from '@/lib/supabase'
import { roundMoney } from '@/lib/money'
import {
  DEFAULT_EXPENSE_CATEGORY_NAMES,
  type CashMovementType,
  type CashierShift,
  type DailyClosing,
  type Expense,
  type ExpenseCategory,
  type PaymentMethod,
  type ShiftCashMovement,
} from '@/types'

// ---------------------------------------------------------------------------
// Shared range helpers
// ---------------------------------------------------------------------------

/** A report range: ISO instants for timestamptz columns, plain dates
 * for date columns (expense_date, purchase order_date). */
export interface ReportRange {
  fromIso: string
  toIso: string
  fromDate: string
  toDate: string
}

/** Build a range covering [fromDate, toDate] in local time. */
export function makeRange(fromDate: string, toDate: string): ReportRange {
  const from = new Date(`${fromDate}T00:00:00`)
  const to = new Date(`${toDate}T00:00:00`)
  to.setDate(to.getDate() + 1)
  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    fromDate,
    toDate,
  }
}

export function toDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Order statuses that never count as sales. */
const NON_SALE_STATUSES = '("CANCELLED","REFUNDED","DRAFT")'

// ---------------------------------------------------------------------------
// Expense categories
// ---------------------------------------------------------------------------

/**
 * Categories for a restaurant. The first time a restaurant has none,
 * the twelve §36 defaults are created (is_system) so a fresh client
 * deployment is never stuck with an empty list.
 */
export async function fetchExpenseCategories(
  restaurantId: string,
): Promise<ExpenseCategory[]> {
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as ExpenseCategory[]
  if (rows.length > 0) return rows

  const seeds = DEFAULT_EXPENSE_CATEGORY_NAMES.map((name) => ({
    id: crypto.randomUUID(),
    restaurant_id: restaurantId,
    name,
    is_system: true,
    is_active: true,
  }))
  const { error: seedError } = await supabase
    .from('expense_categories')
    .insert(seeds)
  if (seedError) throw seedError
  const { data: after, error: afterError } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true })
  if (afterError) throw afterError
  return (after ?? []) as ExpenseCategory[]
}

export async function createExpenseCategory(
  restaurantId: string,
  name: string,
): Promise<ExpenseCategory> {
  const { data, error } = await supabase
    .from('expense_categories')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      name: name.trim(),
      is_system: false,
      is_active: true,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as ExpenseCategory
}

export async function setExpenseCategoryActive(
  categoryId: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('expense_categories')
    .update({ is_active: isActive })
    .eq('id', categoryId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export interface ExpenseFilters {
  fromDate?: string
  toDate?: string
  categoryId?: string
  branchId?: string
}

export async function fetchExpenses(
  restaurantId: string,
  filters: ExpenseFilters = {},
): Promise<Expense[]> {
  let query = supabase
    .from('expenses')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (filters.fromDate) query = query.gte('expense_date', filters.fromDate)
  if (filters.toDate) query = query.lte('expense_date', filters.toDate)
  if (filters.categoryId) query = query.eq('category_id', filters.categoryId)
  if (filters.branchId) query = query.eq('branch_id', filters.branchId)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Expense[]
}

export interface CreateExpenseInput {
  restaurantId: string
  branchId: string | null
  categoryId: string
  amount: number
  date: string
  paymentMethod: PaymentMethod
  notes: string | null
  userId: string | null
}

export async function createExpense(
  input: CreateExpenseInput,
): Promise<Expense> {
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: input.restaurantId,
      branch_id: input.branchId,
      category_id: input.categoryId,
      amount: roundMoney(input.amount),
      expense_date: input.date,
      payment_method: input.paymentMethod,
      notes: input.notes,
      created_by: input.userId,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as Expense
}

export interface UpdateExpenseInput {
  categoryId: string
  amount: number
  date: string
  paymentMethod: PaymentMethod
  notes: string | null
  branchId: string | null
}

export async function updateExpense(
  expenseId: string,
  input: UpdateExpenseInput,
): Promise<void> {
  const { error } = await supabase
    .from('expenses')
    .update({
      category_id: input.categoryId,
      amount: roundMoney(input.amount),
      expense_date: input.date,
      payment_method: input.paymentMethod,
      notes: input.notes,
      branch_id: input.branchId,
    })
    .eq('id', expenseId)
  if (error) throw error
}

/** §46: void instead of delete. The row stays visible as voided. */
export async function voidExpense(
  expenseId: string,
  userId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('expenses')
    .update({
      is_voided: true,
      voided_at: new Date().toISOString(),
      voided_by: userId,
    })
    .eq('id', expenseId)
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Cashier shifts (§38)
// ---------------------------------------------------------------------------

export async function fetchMyOpenShift(
  restaurantId: string,
  userId: string,
): Promise<CashierShift | null> {
  const { data, error } = await supabase
    .from('cashier_shifts')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('opened_by', userId)
    .eq('status', 'OPEN')
    .order('opened_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const rows = (data ?? []) as CashierShift[]
  return rows[0] ?? null
}

export async function fetchShifts(
  restaurantId: string,
  limit = 30,
): Promise<CashierShift[]> {
  const { data, error } = await supabase
    .from('cashier_shifts')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('opened_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as CashierShift[]
}

export async function openShift(input: {
  restaurantId: string
  branchId: string | null
  openingCash: number
  userId: string | null
  notes: string | null
}): Promise<CashierShift> {
  const { data, error } = await supabase
    .from('cashier_shifts')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: input.restaurantId,
      branch_id: input.branchId,
      opened_by: input.userId,
      opening_cash: roundMoney(input.openingCash),
      notes: input.notes,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as CashierShift
}

export async function fetchShiftMovements(
  shiftId: string,
): Promise<ShiftCashMovement[]> {
  const { data, error } = await supabase
    .from('shift_cash_movements')
    .select('*')
    .eq('shift_id', shiftId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ShiftCashMovement[]
}

export async function addCashMovement(input: {
  shiftId: string
  type: CashMovementType
  amount: number
  reason: string
  userId: string | null
}): Promise<ShiftCashMovement> {
  const { data, error } = await supabase
    .from('shift_cash_movements')
    .insert({
      id: crypto.randomUUID(),
      shift_id: input.shiftId,
      type: input.type,
      amount: roundMoney(input.amount),
      reason: input.reason.trim(),
      created_by: input.userId,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as ShiftCashMovement
}

export interface ShiftSummary {
  cashSales: number
  cashExpenses: number
  movementsNet: number
  expectedCash: number
}

/**
 * The shift's cash position, computed from DB rows in the window
 * [opened_at, until): cash payments received, minus non-voided cash
 * expenses recorded, plus drawer movements (§38).
 */
export async function fetchShiftSummary(
  shift: CashierShift,
  untilIso?: string,
): Promise<ShiftSummary> {
  const until = untilIso ?? new Date().toISOString()

  const { data: payments, error: payError } = await supabase
    .from('order_payments')
    .select('amount, orders!inner(restaurant_id)')
    .eq('orders.restaurant_id', shift.restaurant_id)
    .eq('method', 'cash')
    .gte('created_at', shift.opened_at)
    .lt('created_at', until)
  if (payError) throw payError
  const cashSales = roundMoney(
    ((payments ?? []) as { amount: number }[]).reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    ),
  )

  const { data: expenses, error: expError } = await supabase
    .from('expenses')
    .select('amount')
    .eq('restaurant_id', shift.restaurant_id)
    .eq('payment_method', 'cash')
    .eq('is_voided', false)
    .gte('created_at', shift.opened_at)
    .lt('created_at', until)
  if (expError) throw expError
  const cashExpenses = roundMoney(
    ((expenses ?? []) as { amount: number }[]).reduce(
      (sum, e) => sum + Number(e.amount),
      0,
    ),
  )

  const movements = await fetchShiftMovements(shift.id)
  const movementsNet = roundMoney(
    movements.reduce((sum, m) => {
      if (m.type === 'CASH_IN') return sum + Number(m.amount)
      if (m.type === 'CASH_OUT') return sum - Number(m.amount)
      return sum + Number(m.amount) // ADJUSTMENT is signed
    }, 0),
  )

  return {
    cashSales,
    cashExpenses,
    movementsNet,
    expectedCash: roundMoney(
      Number(shift.opening_cash) + cashSales - cashExpenses + movementsNet,
    ),
  }
}

/**
 * Close a shift: expected cash is recomputed from the DB at close
 * time, the counted actual is stored next to it, and the difference
 * (actual − expected) is stored — never hidden (§38).
 */
export async function closeShift(
  shift: CashierShift,
  actualCash: number,
  userId: string | null,
): Promise<CashierShift> {
  const closedAt = new Date().toISOString()
  const summary = await fetchShiftSummary(shift, closedAt)
  const actual = roundMoney(actualCash)
  const { data, error } = await supabase
    .from('cashier_shifts')
    .update({
      status: 'CLOSED',
      closed_by: userId,
      closed_at: closedAt,
      expected_cash: summary.expectedCash,
      actual_cash: actual,
      difference: roundMoney(actual - summary.expectedCash),
    })
    .eq('id', shift.id)
    .select('*')
    .single()
  if (error) throw error
  return data as CashierShift
}

// ---------------------------------------------------------------------------
// Day totals + daily closings (§37)
// ---------------------------------------------------------------------------

export interface DayTotals {
  sales: number
  purchases: number
  expenses: number
  refunds: number
}

/** Sales / purchases / expenses / refunds for one local calendar day. */
export async function fetchDayTotals(
  restaurantId: string,
  date: string,
): Promise<DayTotals> {
  const range = makeRange(date, date)

  const { data: orders, error: ordError } = await supabase
    .from('orders')
    .select('total_amount, status')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
  if (ordError) throw ordError
  let sales = 0
  let refunds = 0
  for (const o of (orders ?? []) as { total_amount: number; status: string }[]) {
    if (o.status === 'REFUNDED') refunds += Number(o.total_amount)
    else if (o.status !== 'CANCELLED' && o.status !== 'DRAFT')
      sales += Number(o.total_amount)
  }

  const { data: pos, error: poError } = await supabase
    .from('purchase_orders')
    .select('total_amount')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'RECEIVED')
    .eq('order_date', date)
  if (poError) throw poError
  const purchases = (pos ?? []).reduce(
    (sum, p) => sum + Number((p as { total_amount: number }).total_amount),
    0,
  )

  const { data: exps, error: expError } = await supabase
    .from('expenses')
    .select('amount')
    .eq('restaurant_id', restaurantId)
    .eq('is_voided', false)
    .eq('expense_date', date)
  if (expError) throw expError
  const expensesTotal = (exps ?? []).reduce(
    (sum, e) => sum + Number((e as { amount: number }).amount),
    0,
  )

  return {
    sales: roundMoney(sales),
    purchases: roundMoney(purchases),
    expenses: roundMoney(expensesTotal),
    refunds: roundMoney(refunds),
  }
}

export async function fetchDailyClosings(
  restaurantId: string,
  limit = 30,
): Promise<DailyClosing[]> {
  const { data, error } = await supabase
    .from('daily_closings')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('closing_date', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as DailyClosing[]
}

/**
 * Snapshot a day's closing (restaurant-wide in v1; per-branch
 * closings wait for branch-scoped purchases). Re-closing the same
 * day updates the snapshot. Cash figures come from the shifts
 * closed that day.
 */
export async function closeDay(
  restaurantId: string,
  date: string,
  userId: string | null,
): Promise<DailyClosing> {
  const totals = await fetchDayTotals(restaurantId, date)
  const range = makeRange(date, date)

  const { data: shifts, error: shiftError } = await supabase
    .from('cashier_shifts')
    .select('expected_cash, actual_cash')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'CLOSED')
    .gte('closed_at', range.fromIso)
    .lt('closed_at', range.toIso)
  if (shiftError) throw shiftError
  const closed = (shifts ?? []) as {
    expected_cash: number | null
    actual_cash: number | null
  }[]
  const cashExpected =
    closed.length > 0
      ? roundMoney(closed.reduce((s, x) => s + Number(x.expected_cash ?? 0), 0))
      : null
  const cashActual =
    closed.length > 0
      ? roundMoney(closed.reduce((s, x) => s + Number(x.actual_cash ?? 0), 0))
      : null
  const difference =
    cashExpected !== null && cashActual !== null
      ? roundMoney(cashActual - cashExpected)
      : null

  const { data: existing, error: existError } = await supabase
    .from('daily_closings')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('closing_date', date)
    .is('branch_id', null)
    .limit(1)
  if (existError) throw existError

  const payload = {
    total_sales: totals.sales,
    total_purchases: totals.purchases,
    total_expenses: totals.expenses,
    total_refunds: totals.refunds,
    cash_expected: cashExpected,
    cash_actual: cashActual,
    difference,
    closed_by: userId,
  }

  if (existing && existing.length > 0) {
    const { data, error } = await supabase
      .from('daily_closings')
      .update(payload)
      .eq('id', (existing[0] as { id: string }).id)
      .select('*')
      .single()
    if (error) throw error
    return data as DailyClosing
  }
  const { data, error } = await supabase
    .from('daily_closings')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      branch_id: null,
      closing_date: date,
      ...payload,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as DailyClosing
}

// ---------------------------------------------------------------------------
// Reports (§39 subset) + P&L (§37, §79)
// ---------------------------------------------------------------------------

export interface ProfitLoss {
  sales: number
  purchases: number
  expenses: number
  refunds: number
  /** sales − purchases − expenses − refunds. */
  profit: number
  ordersCount: number
}

export async function fetchProfitLoss(
  restaurantId: string,
  range: ReportRange,
): Promise<ProfitLoss> {
  const { data: orders, error: ordError } = await supabase
    .from('orders')
    .select('total_amount, status')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
  if (ordError) throw ordError
  let sales = 0
  let refunds = 0
  let ordersCount = 0
  for (const o of (orders ?? []) as { total_amount: number; status: string }[]) {
    if (o.status === 'REFUNDED') refunds += Number(o.total_amount)
    else if (o.status !== 'CANCELLED' && o.status !== 'DRAFT') {
      sales += Number(o.total_amount)
      ordersCount += 1
    }
  }

  const { data: pos, error: poError } = await supabase
    .from('purchase_orders')
    .select('total_amount')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'RECEIVED')
    .gte('order_date', range.fromDate)
    .lte('order_date', range.toDate)
  if (poError) throw poError
  const purchases = (pos ?? []).reduce(
    (sum, p) => sum + Number((p as { total_amount: number }).total_amount),
    0,
  )

  const { data: exps, error: expError } = await supabase
    .from('expenses')
    .select('amount')
    .eq('restaurant_id', restaurantId)
    .eq('is_voided', false)
    .gte('expense_date', range.fromDate)
    .lte('expense_date', range.toDate)
  if (expError) throw expError
  const expensesTotal = (exps ?? []).reduce(
    (sum, e) => sum + Number((e as { amount: number }).amount),
    0,
  )

  const s = roundMoney(sales)
  const p = roundMoney(purchases)
  const e = roundMoney(expensesTotal)
  const r = roundMoney(refunds)
  return {
    sales: s,
    purchases: p,
    expenses: e,
    refunds: r,
    profit: roundMoney(s - p - e - r),
    ordersCount,
  }
}

export interface DailySalesPoint {
  date: string
  sales: number
  orders: number
}

export async function fetchDailySalesSeries(
  restaurantId: string,
  range: ReportRange,
): Promise<DailySalesPoint[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('total_amount, created_at')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
    .not('status', 'in', NON_SALE_STATUSES)
    .order('created_at', { ascending: true })
  if (error) throw error

  const byDay = new Map<string, { sales: number; orders: number }>()
  const cursor = new Date(`${range.fromDate}T00:00:00`)
  const end = new Date(`${range.toDate}T00:00:00`)
  while (cursor <= end) {
    byDay.set(toDateString(cursor), { sales: 0, orders: 0 })
    cursor.setDate(cursor.getDate() + 1)
  }
  for (const o of (data ?? []) as { total_amount: number; created_at: string }[]) {
    const key = toDateString(new Date(o.created_at))
    const entry = byDay.get(key)
    if (entry) {
      entry.sales += Number(o.total_amount)
      entry.orders += 1
    }
  }
  return [...byDay.entries()].map(([date, v]) => ({
    date,
    sales: roundMoney(v.sales),
    orders: v.orders,
  }))
}

export interface ProductSalesRow {
  name: string
  quantity: number
  amount: number
}

export async function fetchProductSales(
  restaurantId: string,
  range: ReportRange,
  limit = 10,
): Promise<ProductSalesRow[]> {
  const { data, error } = await supabase
    .from('order_items')
    .select('product_name, quantity, total_price, orders!inner(restaurant_id, status, created_at)')
    .eq('orders.restaurant_id', restaurantId)
    .not('orders.status', 'in', NON_SALE_STATUSES)
    .gte('orders.created_at', range.fromIso)
    .lt('orders.created_at', range.toIso)
  if (error) throw error
  const byName = new Map<string, { quantity: number; amount: number }>()
  for (const row of (data ?? []) as {
    product_name: string
    quantity: number
    total_price: number
  }[]) {
    const entry = byName.get(row.product_name) ?? { quantity: 0, amount: 0 }
    entry.quantity += Number(row.quantity)
    entry.amount += Number(row.total_price)
    byName.set(row.product_name, entry)
  }
  return [...byName.entries()]
    .map(([name, v]) => ({
      name,
      quantity: v.quantity,
      amount: roundMoney(v.amount),
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
}

export interface CategorySalesRow {
  name: string
  quantity: number
  amount: number
}

export async function fetchCategorySales(
  restaurantId: string,
  range: ReportRange,
): Promise<CategorySalesRow[]> {
  const { data: products, error: prodError } = await supabase
    .from('products')
    .select('id, category_id')
    .eq('restaurant_id', restaurantId)
  if (prodError) throw prodError
  const { data: categories, error: catError } = await supabase
    .from('categories')
    .select('id, name')
    .eq('restaurant_id', restaurantId)
  if (catError) throw catError
  const categoryName = new Map(
    ((categories ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ]),
  )
  const productCategory = new Map(
    ((products ?? []) as { id: string; category_id: string | null }[]).map(
      (p) => [p.id, p.category_id],
    ),
  )

  const { data, error } = await supabase
    .from('order_items')
    .select('product_id, quantity, total_price, orders!inner(restaurant_id, status, created_at)')
    .eq('orders.restaurant_id', restaurantId)
    .not('orders.status', 'in', NON_SALE_STATUSES)
    .gte('orders.created_at', range.fromIso)
    .lt('orders.created_at', range.toIso)
  if (error) throw error
  const byCategory = new Map<string, { quantity: number; amount: number }>()
  for (const row of (data ?? []) as {
    product_id: string | null
    quantity: number
    total_price: number
  }[]) {
    const catId = row.product_id
      ? (productCategory.get(row.product_id) ?? null)
      : null
    const name = catId ? (categoryName.get(catId) ?? '—') : '—'
    const entry = byCategory.get(name) ?? { quantity: 0, amount: 0 }
    entry.quantity += Number(row.quantity)
    entry.amount += Number(row.total_price)
    byCategory.set(name, entry)
  }
  return [...byCategory.entries()]
    .map(([name, v]) => ({
      name,
      quantity: v.quantity,
      amount: roundMoney(v.amount),
    }))
    .sort((a, b) => b.amount - a.amount)
}

export interface PaymentBreakdownRow {
  method: PaymentMethod
  count: number
  amount: number
}

export async function fetchPaymentBreakdown(
  restaurantId: string,
  range: ReportRange,
): Promise<PaymentBreakdownRow[]> {
  const { data, error } = await supabase
    .from('order_payments')
    .select('method, amount, orders!inner(restaurant_id)')
    .eq('orders.restaurant_id', restaurantId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
  if (error) throw error
  const byMethod = new Map<PaymentMethod, { count: number; amount: number }>()
  for (const row of (data ?? []) as { method: PaymentMethod; amount: number }[]) {
    const entry = byMethod.get(row.method) ?? { count: 0, amount: 0 }
    entry.count += 1
    entry.amount += Number(row.amount)
    byMethod.set(row.method, entry)
  }
  return [...byMethod.entries()]
    .map(([method, v]) => ({
      method,
      count: v.count,
      amount: roundMoney(v.amount),
    }))
    .sort((a, b) => b.amount - a.amount)
}

export interface ExpenseByCategoryRow {
  name: string
  count: number
  amount: number
}

export async function fetchExpenseByCategory(
  restaurantId: string,
  range: ReportRange,
): Promise<ExpenseByCategoryRow[]> {
  const categories = await fetchExpenseCategories(restaurantId)
  const nameById = new Map(categories.map((c) => [c.id, c.name]))
  const { data, error } = await supabase
    .from('expenses')
    .select('category_id, amount')
    .eq('restaurant_id', restaurantId)
    .eq('is_voided', false)
    .gte('expense_date', range.fromDate)
    .lte('expense_date', range.toDate)
  if (error) throw error
  const byCategory = new Map<string, { count: number; amount: number }>()
  for (const row of (data ?? []) as { category_id: string; amount: number }[]) {
    const name = nameById.get(row.category_id) ?? '—'
    const entry = byCategory.get(name) ?? { count: 0, amount: 0 }
    entry.count += 1
    entry.amount += Number(row.amount)
    byCategory.set(name, entry)
  }
  return [...byCategory.entries()]
    .map(([name, v]) => ({ name, count: v.count, amount: roundMoney(v.amount) }))
    .sort((a, b) => b.amount - a.amount)
}

export interface DeliverySummary {
  orders: number
  completed: number
  fees: number
  codTotal: number
}

export async function fetchDeliverySummary(
  restaurantId: string,
  range: ReportRange,
): Promise<DeliverySummary> {
  const { data, error } = await supabase
    .from('orders')
    .select('total_amount, delivery_fee, status')
    .eq('restaurant_id', restaurantId)
    .eq('type', 'delivery')
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
    .not('status', 'in', '("CANCELLED","DRAFT")')
  if (error) throw error
  let orders = 0
  let completed = 0
  let fees = 0
  let codTotal = 0
  for (const o of (data ?? []) as {
    total_amount: number
    delivery_fee: number
    status: string
  }[]) {
    orders += 1
    fees += Number(o.delivery_fee)
    if (o.status === 'COMPLETED') {
      completed += 1
      codTotal += Number(o.total_amount)
    }
  }
  return {
    orders,
    completed,
    fees: roundMoney(fees),
    codTotal: roundMoney(codTotal),
  }
}

export interface SupplierPayableRow {
  supplierId: string
  name: string
  receivedTotal: number
  ordersCount: number
}

/**
 * What the restaurant owes suppliers on paper: RECEIVED purchase
 * totals. Supplier payment recording is not built yet, so nothing is
 * subtracted — the UI labels this honestly.
 */
export async function fetchSupplierPayables(
  restaurantId: string,
): Promise<SupplierPayableRow[]> {
  const { data: pos, error: poError } = await supabase
    .from('purchase_orders')
    .select('supplier_id, total_amount')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'RECEIVED')
  if (poError) throw poError
  const { data: suppliers, error: supError } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('restaurant_id', restaurantId)
  if (supError) throw supError
  const nameById = new Map(
    ((suppliers ?? []) as { id: string; name: string }[]).map((s) => [
      s.id,
      s.name,
    ]),
  )
  const bySupplier = new Map<string, { total: number; count: number }>()
  for (const po of (pos ?? []) as {
    supplier_id: string
    total_amount: number
  }[]) {
    const entry = bySupplier.get(po.supplier_id) ?? { total: 0, count: 0 }
    entry.total += Number(po.total_amount)
    entry.count += 1
    bySupplier.set(po.supplier_id, entry)
  }
  return [...bySupplier.entries()]
    .map(([supplierId, v]) => ({
      supplierId,
      name: nameById.get(supplierId) ?? '—',
      receivedTotal: roundMoney(v.total),
      ordersCount: v.count,
    }))
    .sort((a, b) => b.receivedTotal - a.receivedTotal)
}

// ---------------------------------------------------------------------------
// Dashboard helpers (today)
// ---------------------------------------------------------------------------

export async function fetchTodayExpenseTotal(
  restaurantId: string,
): Promise<number> {
  const today = toDateString(new Date())
  const { data, error } = await supabase
    .from('expenses')
    .select('amount')
    .eq('restaurant_id', restaurantId)
    .eq('is_voided', false)
    .eq('expense_date', today)
  if (error) throw error
  return roundMoney(
    ((data ?? []) as { amount: number }[]).reduce(
      (sum, e) => sum + Number(e.amount),
      0,
    ),
  )
}
