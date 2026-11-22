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
    .select('received_amount')
    .eq('restaurant_id', restaurantId)
    .in('status', ['RECEIVED', 'PARTIALLY_RECEIVED', 'CLOSED'])
    .eq('order_date', date)
  if (poError) throw poError
  const purchases = (pos ?? []).reduce(
    (sum, p) =>
      sum + Number((p as { received_amount: number }).received_amount),
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
    .select('received_amount')
    .eq('restaurant_id', restaurantId)
    .in('status', ['RECEIVED', 'PARTIALLY_RECEIVED', 'CLOSED'])
    .gte('order_date', range.fromDate)
    .lte('order_date', range.toDate)
  if (poError) throw poError
  const purchases = (pos ?? []).reduce(
    (sum, p) =>
      sum + Number((p as { received_amount: number }).received_amount),
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

export interface HourlySalesPoint {
  hour: number
  sales: number
}

/**
 * Bucket a day's orders into per-hour sales (Dashboard modernisation
 * W2, design §2). Pure composition over the already-fetched today's
 * orders — no query of its own, so the hourly bars always sum to the
 * same total the caller's headline figure shows. Zero-filled from
 * the first order's hour through the current hour so the chart axis
 * has no gaps; an empty day returns [] and the card shows its empty
 * state instead of an empty axis.
 */
export function hourlySalesFromOrders(
  orders: { created_at: string; total_amount: number }[],
  now: Date = new Date(),
): HourlySalesPoint[] {
  if (orders.length === 0) return []
  const byHour = new Map<number, number>()
  let firstHour = 24
  for (const order of orders) {
    const hour = new Date(order.created_at).getHours()
    if (hour < firstHour) firstHour = hour
    byHour.set(hour, (byHour.get(hour) ?? 0) + Number(order.total_amount))
  }
  let lastHour = now.getHours()
  for (const hour of byHour.keys()) {
    if (hour > lastHour) lastHour = hour
  }
  const points: HourlySalesPoint[] = []
  for (let hour = firstHour; hour <= lastHour; hour += 1) {
    points.push({ hour, sales: roundMoney(byHour.get(hour) ?? 0) })
  }
  return points
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
 * What the restaurant owes suppliers on paper: the RECEIVED value
 * of purchase orders (received_amount — the portion that actually
 * arrived, in full or in part; migration 0035). Supplier payments
 * are subtracted by fetchSupplierBalances, not here.
 */
export async function fetchSupplierPayables(
  restaurantId: string,
): Promise<SupplierPayableRow[]> {
  const { data: pos, error: poError } = await supabase
    .from('purchase_orders')
    .select('supplier_id, received_amount')
    .eq('restaurant_id', restaurantId)
    .in('status', ['RECEIVED', 'PARTIALLY_RECEIVED', 'CLOSED'])
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
    received_amount: number
  }[]) {
    const entry = bySupplier.get(po.supplier_id) ?? { total: 0, count: 0 }
    entry.total += Number(po.received_amount)
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

// ---------------------------------------------------------------------------
// Phase 7 Step 2A — remaining §39 reports + supplier payments (0017)
// ---------------------------------------------------------------------------

async function fetchProfileNames(
  restaurantId: string,
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('restaurant_id', restaurantId)
  if (error) throw error
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null }[]).map((p) => [
      p.id,
      p.full_name ?? p.id.slice(0, 8),
    ]),
  )
}

export interface StaffSalesRow {
  userId: string
  name: string
  orders: number
  sales: number
  avgTicket: number
}

/**
 * Orders grouped by who created them (§39 Cashier report). With
 * `waiterOnly`, only creators holding the waiter role are listed —
 * orders record created_by only; there is no separate waiter field,
 * so this is honestly "orders taken by waiters".
 */
export async function fetchStaffSales(
  restaurantId: string,
  range: ReportRange,
  waiterOnly = false,
): Promise<StaffSalesRow[]> {
  let allowed: Set<string> | null = null
  if (waiterOnly) {
    const { data: waiterRoles, error: roleError } = await supabase
      .from('roles')
      .select('id')
      .eq('name', 'waiter')
    if (roleError) throw roleError
    const roleIds = ((waiterRoles ?? []) as { id: string }[]).map((r) => r.id)
    allowed = new Set<string>()
    if (roleIds.length > 0) {
      const { data: assignments, error: assignError } = await supabase
        .from('user_roles')
        .select('user_id')
        .in('role_id', roleIds)
      if (assignError) throw assignError
      for (const a of (assignments ?? []) as { user_id: string }[]) {
        allowed.add(a.user_id)
      }
    }
  }
  const { data, error } = await supabase
    .from('orders')
    .select('created_by, total_amount')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
    .not('status', 'in', NON_SALE_STATUSES)
    .not('created_by', 'is', null)
  if (error) throw error
  const names = await fetchProfileNames(restaurantId)
  const byUser = new Map<string, { orders: number; sales: number }>()
  for (const o of (data ?? []) as {
    created_by: string
    total_amount: number
  }[]) {
    if (allowed && !allowed.has(o.created_by)) continue
    const entry = byUser.get(o.created_by) ?? { orders: 0, sales: 0 }
    entry.orders += 1
    entry.sales += Number(o.total_amount)
    byUser.set(o.created_by, entry)
  }
  return [...byUser.entries()]
    .map(([userId, v]) => ({
      userId,
      name: names.get(userId) ?? userId.slice(0, 8),
      orders: v.orders,
      sales: roundMoney(v.sales),
      avgTicket: v.orders > 0 ? roundMoney(v.sales / v.orders) : 0,
    }))
    .sort((a, b) => b.sales - a.sales)
}

export interface BranchSalesRow {
  branchId: string | null
  name: string
  orders: number
  sales: number
}

export async function fetchBranchSales(
  restaurantId: string,
  range: ReportRange,
): Promise<BranchSalesRow[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('branch_id, total_amount')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
    .not('status', 'in', NON_SALE_STATUSES)
  if (error) throw error
  const { data: branches, error: branchError } = await supabase
    .from('branches')
    .select('id, name')
    .eq('restaurant_id', restaurantId)
  if (branchError) throw branchError
  const nameById = new Map(
    ((branches ?? []) as { id: string; name: string }[]).map((b) => [
      b.id,
      b.name,
    ]),
  )
  const byBranch = new Map<string | null, { orders: number; sales: number }>()
  for (const o of (data ?? []) as {
    branch_id: string | null
    total_amount: number
  }[]) {
    const entry = byBranch.get(o.branch_id) ?? { orders: 0, sales: 0 }
    entry.orders += 1
    entry.sales += Number(o.total_amount)
    byBranch.set(o.branch_id, entry)
  }
  return [...byBranch.entries()]
    .map(([branchId, v]) => ({
      branchId,
      name: branchId ? (nameById.get(branchId) ?? branchId.slice(0, 8)) : '—',
      orders: v.orders,
      sales: roundMoney(v.sales),
    }))
    .sort((a, b) => b.sales - a.sales)
}

export interface KitchenReport {
  stations: { name: string; items: number; orders: number }[]
  avgCompletionMinutes: number | null
  completedOrders: number
}

export async function fetchKitchenReport(
  restaurantId: string,
  range: ReportRange,
): Promise<KitchenReport> {
  const { data: items, error } = await supabase
    .from('order_items')
    .select('quantity, product_id, order_id, orders!inner (restaurant_id, status, created_at)')
    .eq('orders.restaurant_id', restaurantId)
    .gte('orders.created_at', range.fromIso)
    .lt('orders.created_at', range.toIso)
    .not('orders.status', 'in', NON_SALE_STATUSES)
  if (error) throw error
  const rows = (items ?? []) as unknown as {
    quantity: number
    product_id: string | null
    order_id: string
  }[]

  const { data: products, error: productError } = await supabase
    .from('products')
    .select('id, kitchen_station_id')
    .eq('restaurant_id', restaurantId)
  if (productError) throw productError
  const stationByProduct = new Map<string, string | null>(
    ((products ?? []) as { id: string; kitchen_station_id: string | null }[]).map(
      (p) => [p.id, p.kitchen_station_id],
    ),
  )
  const { data: stations, error: stationError } = await supabase
    .from('kitchen_stations')
    .select('id, name')
    .eq('restaurant_id', restaurantId)
  if (stationError) throw stationError
  const stationName = new Map(
    ((stations ?? []) as { id: string; name: string }[]).map((s) => [
      s.id,
      s.name,
    ]),
  )

  const byStation = new Map<string, { items: number; orders: Set<string> }>()
  for (const row of rows) {
    const stationId = row.product_id
      ? (stationByProduct.get(row.product_id) ?? null)
      : null
    const name = stationId
      ? (stationName.get(stationId) ?? stationId.slice(0, 8))
      : '—'
    const entry = byStation.get(name) ?? { items: 0, orders: new Set<string>() }
    entry.items += Number(row.quantity)
    entry.orders.add(row.order_id)
    byStation.set(name, entry)
  }

  // Average completion: order created_at → first SERVED/COMPLETED
  // transition in order_status_history.
  const { data: servedOrders, error: servedError } = await supabase
    .from('orders')
    .select('id, created_at')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
    .in('status', ['SERVED', 'COMPLETED'])
  if (servedError) throw servedError
  const createdById = new Map(
    ((servedOrders ?? []) as { id: string; created_at: string }[]).map((o) => [
      o.id,
      o.created_at,
    ]),
  )
  let avgCompletionMinutes: number | null = null
  let completedOrders = 0
  if (createdById.size > 0) {
    const { data: history, error: historyError } = await supabase
      .from('order_status_history')
      .select('order_id, to_status, created_at')
      .in('order_id', [...createdById.keys()])
      .in('to_status', ['SERVED', 'COMPLETED'])
      .order('created_at', { ascending: true })
    if (historyError) throw historyError
    const firstDoneAt = new Map<string, string>()
    for (const h of (history ?? []) as {
      order_id: string
      created_at: string
    }[]) {
      if (!firstDoneAt.has(h.order_id)) firstDoneAt.set(h.order_id, h.created_at)
    }
    let totalMinutes = 0
    for (const [orderId, doneAt] of firstDoneAt) {
      const created = createdById.get(orderId)
      if (!created) continue
      totalMinutes +=
        (new Date(doneAt).getTime() - new Date(created).getTime()) / 60000
      completedOrders += 1
    }
    if (completedOrders > 0) {
      avgCompletionMinutes = roundMoney(totalMinutes / completedOrders)
    }
  }

  return {
    stations: [...byStation.entries()]
      .map(([name, v]) => ({ name, items: v.items, orders: v.orders.size }))
      .sort((a, b) => b.items - a.items),
    avgCompletionMinutes,
    completedOrders,
  }
}

export interface CustomerReportRow {
  customerId: string
  name: string
  orders: number
  spent: number
  pointsBalance: number
}

export async function fetchCustomerReport(
  restaurantId: string,
  range: ReportRange,
): Promise<CustomerReportRow[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('customer_id, total_amount')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
    .not('status', 'in', NON_SALE_STATUSES)
    .not('customer_id', 'is', null)
  if (error) throw error
  const byCustomer = new Map<string, { orders: number; spent: number }>()
  for (const o of (data ?? []) as {
    customer_id: string
    total_amount: number
  }[]) {
    const entry = byCustomer.get(o.customer_id) ?? { orders: 0, spent: 0 }
    entry.orders += 1
    entry.spent += Number(o.total_amount)
    byCustomer.set(o.customer_id, entry)
  }
  if (byCustomer.size === 0) return []
  const ids = [...byCustomer.keys()]
  const { data: customers, error: customerError } = await supabase
    .from('customers')
    .select('id, name')
    .in('id', ids)
  if (customerError) throw customerError
  const nameById = new Map(
    ((customers ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ]),
  )
  const { data: loyalty, error: loyaltyError } = await supabase
    .from('loyalty_transactions')
    .select('customer_id, points')
    .eq('restaurant_id', restaurantId)
    .in('customer_id', ids)
  if (loyaltyError) throw loyaltyError
  const pointsByCustomer = new Map<string, number>()
  for (const row of (loyalty ?? []) as {
    customer_id: string
    points: number
  }[]) {
    pointsByCustomer.set(
      row.customer_id,
      (pointsByCustomer.get(row.customer_id) ?? 0) + Number(row.points),
    )
  }
  return ids
    .map((customerId) => ({
      customerId,
      name: nameById.get(customerId) ?? customerId.slice(0, 8),
      orders: byCustomer.get(customerId)?.orders ?? 0,
      spent: roundMoney(byCustomer.get(customerId)?.spent ?? 0),
      pointsBalance: pointsByCustomer.get(customerId) ?? 0,
    }))
    .sort((a, b) => b.spent - a.spent)
}

export interface LoyaltyReport {
  earned: number
  redeemed: number
  adjustments: number
  topHolders: { name: string; balance: number }[]
}

export async function fetchLoyaltyReport(
  restaurantId: string,
  range: ReportRange,
): Promise<LoyaltyReport> {
  const { data, error } = await supabase
    .from('loyalty_transactions')
    .select('customer_id, type, points')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
  if (error) throw error
  let earned = 0
  let redeemed = 0
  let adjustments = 0
  for (const row of (data ?? []) as {
    type: string
    points: number
  }[]) {
    const points = Number(row.points)
    if (row.type === 'EARN') earned += points
    else if (row.type === 'REDEEM') redeemed += Math.abs(points)
    else adjustments += points
  }
  const { data: allTx, error: allError } = await supabase
    .from('loyalty_transactions')
    .select('customer_id, points')
    .eq('restaurant_id', restaurantId)
  if (allError) throw allError
  const balanceByCustomer = new Map<string, number>()
  for (const row of (allTx ?? []) as {
    customer_id: string
    points: number
  }[]) {
    balanceByCustomer.set(
      row.customer_id,
      (balanceByCustomer.get(row.customer_id) ?? 0) + Number(row.points),
    )
  }
  const top = [...balanceByCustomer.entries()]
    .filter(([, balance]) => balance > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  let topHolders: LoyaltyReport['topHolders'] = []
  if (top.length > 0) {
    const { data: customers, error: customerError } = await supabase
      .from('customers')
      .select('id, name')
      .in(
        'id',
        top.map(([id]) => id),
      )
    if (customerError) throw customerError
    const nameById = new Map(
      ((customers ?? []) as { id: string; name: string }[]).map((c) => [
        c.id,
        c.name,
      ]),
    )
    topHolders = top.map(([id, balance]) => ({
      name: nameById.get(id) ?? id.slice(0, 8),
      balance,
    }))
  }
  return { earned, redeemed, adjustments, topHolders }
}

export interface InventoryReport {
  stockValue: number
  lowStock: { name: string; quantity: number; threshold: number }[]
  movements: { type: string; count: number; quantity: number }[]
}

export async function fetchInventoryReport(
  restaurantId: string,
  range: ReportRange,
): Promise<InventoryReport> {
  const { data: items, error } = await supabase
    .from('inventory_items')
    .select('name, current_quantity, cost_price, low_stock_threshold')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
  if (error) throw error
  let stockValue = 0
  const lowStock: InventoryReport['lowStock'] = []
  for (const item of (items ?? []) as {
    name: string
    current_quantity: number
    cost_price: number
    low_stock_threshold: number
  }[]) {
    stockValue += Number(item.current_quantity) * Number(item.cost_price)
    if (Number(item.current_quantity) <= Number(item.low_stock_threshold)) {
      lowStock.push({
        name: item.name,
        quantity: Number(item.current_quantity),
        threshold: Number(item.low_stock_threshold),
      })
    }
  }
  const { data: movements, error: movementError } = await supabase
    .from('stock_movements')
    .select('movement_type, quantity_change')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
  if (movementError) throw movementError
  const byType = new Map<string, { count: number; quantity: number }>()
  for (const m of (movements ?? []) as {
    movement_type: string
    quantity_change: number
  }[]) {
    const entry = byType.get(m.movement_type) ?? { count: 0, quantity: 0 }
    entry.count += 1
    entry.quantity += Number(m.quantity_change)
    byType.set(m.movement_type, entry)
  }
  return {
    stockValue: roundMoney(stockValue),
    lowStock,
    movements: [...byType.entries()].map(([type, v]) => ({
      type,
      count: v.count,
      quantity: roundMoney(v.quantity),
    })),
  }
}

export interface PurchaseReportRow {
  supplierId: string
  name: string
  status: string
  orders: number
  total: number
}

export async function fetchPurchaseReport(
  restaurantId: string,
  range: ReportRange,
): Promise<PurchaseReportRow[]> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('supplier_id, status, total_amount, received_amount')
    .eq('restaurant_id', restaurantId)
    .gte('order_date', range.fromDate)
    .lte('order_date', range.toDate)
  if (error) throw error
  const names = new Map<string, string>()
  const { data: suppliers, error: supplierError } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('restaurant_id', restaurantId)
  if (supplierError) throw supplierError
  for (const s of (suppliers ?? []) as { id: string; name: string }[]) {
    names.set(s.id, s.name)
  }
  const byKey = new Map<string, PurchaseReportRow>()
  for (const po of (data ?? []) as {
    supplier_id: string
    status: string
    total_amount: number
    received_amount: number
  }[]) {
    const key = `${po.supplier_id}|${po.status}`
    const entry = byKey.get(key) ?? {
      supplierId: po.supplier_id,
      name: names.get(po.supplier_id) ?? po.supplier_id.slice(0, 8),
      status: po.status,
      orders: 0,
      total: 0,
    }
    entry.orders += 1
    // For the received-ish statuses the money that counts is what
    // actually arrived (received_amount); for DRAFT / ORDERED /
    // CANCELLED the row reports the ordered value, as before.
    entry.total +=
      po.status === 'RECEIVED' ||
      po.status === 'PARTIALLY_RECEIVED' ||
      po.status === 'CLOSED'
        ? Number(po.received_amount)
        : Number(po.total_amount)
    byKey.set(key, entry)
  }
  return [...byKey.values()]
    .map((r) => ({ ...r, total: roundMoney(r.total) }))
    .sort((a, b) => b.total - a.total)
}

export interface SupplierBalanceRow {
  supplierId: string
  name: string
  receivedTotal: number
  paidTotal: number
  due: number
}

export async function fetchSupplierBalances(
  restaurantId: string,
): Promise<SupplierBalanceRow[]> {
  const payables = await fetchSupplierPayables(restaurantId)
  const { data: payments, error } = await supabase
    .from('supplier_payments')
    .select('supplier_id, amount')
    .eq('restaurant_id', restaurantId)
  if (error) throw error
  const paidBySupplier = new Map<string, number>()
  for (const p of (payments ?? []) as { supplier_id: string; amount: number }[]) {
    paidBySupplier.set(
      p.supplier_id,
      (paidBySupplier.get(p.supplier_id) ?? 0) + Number(p.amount),
    )
  }
  const seen = new Set<string>()
  const rows: SupplierBalanceRow[] = []
  for (const row of payables) {
    seen.add(row.supplierId)
    const paid = roundMoney(paidBySupplier.get(row.supplierId) ?? 0)
    rows.push({
      supplierId: row.supplierId,
      name: row.name,
      receivedTotal: row.receivedTotal,
      paidTotal: paid,
      due: roundMoney(row.receivedTotal - paid),
    })
  }
  const { data: allSuppliers, error: nameError } = await supabase
    .from('suppliers')
    .select('id, name')
    .eq('restaurant_id', restaurantId)
  if (nameError) throw nameError
  const nameById = new Map(
    ((allSuppliers ?? []) as { id: string; name: string }[]).map((s) => [
      s.id,
      s.name,
    ]),
  )
  for (const [supplierId, paid] of paidBySupplier) {
    if (seen.has(supplierId)) continue
    rows.push({
      supplierId,
      name: nameById.get(supplierId) ?? supplierId.slice(0, 8),
      receivedTotal: 0,
      paidTotal: roundMoney(paid),
      due: roundMoney(-paid),
    })
  }
  return rows.sort((a, b) => b.due - a.due)
}

export interface SupplierPaymentRow {
  id: string
  supplier_id: string
  purchase_order_id: string | null
  amount: number
  payment_method: PaymentMethod
  paid_on: string
  note: string | null
  created_at: string
}

export async function fetchSupplierPayments(
  restaurantId: string,
  supplierId?: string,
): Promise<SupplierPaymentRow[]> {
  let query = supabase
    .from('supplier_payments')
    .select(
      'id, supplier_id, purchase_order_id, amount, payment_method, paid_on, note, created_at',
    )
    .eq('restaurant_id', restaurantId)
    .order('paid_on', { ascending: false })
    .order('created_at', { ascending: false })
  if (supplierId) query = query.eq('supplier_id', supplierId)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as SupplierPaymentRow[]
}

export interface CreateSupplierPaymentInput {
  supplierId: string
  purchaseOrderId?: string | null
  amount: number
  method: PaymentMethod
  paidOn: string
  note?: string
}

export async function createSupplierPayment(
  restaurantId: string,
  userId: string,
  input: CreateSupplierPaymentInput,
): Promise<void> {
  const { error } = await supabase.from('supplier_payments').insert({
    id: crypto.randomUUID(),
    restaurant_id: restaurantId,
    supplier_id: input.supplierId,
    purchase_order_id: input.purchaseOrderId ?? null,
    amount: roundMoney(input.amount),
    payment_method: input.method,
    paid_on: input.paidOn,
    note: input.note?.trim() ? input.note.trim() : null,
    created_by: userId,
  })
  if (error) throw error
}

export interface TaxDiscountReport {
  orders: number
  taxCollected: number
  serviceChargeCollected: number
  orderDiscounts: number
  couponRedemptions: number
  couponDiscount: number
}

export async function fetchTaxDiscountReport(
  restaurantId: string,
  range: ReportRange,
): Promise<TaxDiscountReport> {
  const { data, error } = await supabase
    .from('orders')
    .select('tax_amount, service_charge_amount, discount_amount')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
    .not('status', 'in', NON_SALE_STATUSES)
  if (error) throw error
  let tax = 0
  let service = 0
  let discounts = 0
  let count = 0
  for (const o of (data ?? []) as {
    tax_amount: number
    service_charge_amount: number
    discount_amount: number
  }[]) {
    tax += Number(o.tax_amount)
    service += Number(o.service_charge_amount)
    discounts += Number(o.discount_amount)
    count += 1
  }
  const { data: redemptions, error: redemptionError } = await supabase
    .from('coupon_redemptions')
    .select('discount_amount, orders!inner (restaurant_id)')
    .eq('orders.restaurant_id', restaurantId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
  if (redemptionError) throw redemptionError
  let couponDiscount = 0
  for (const r of (redemptions ?? []) as { discount_amount: number }[]) {
    couponDiscount += Number(r.discount_amount)
  }
  return {
    orders: count,
    taxCollected: roundMoney(tax),
    serviceChargeCollected: roundMoney(service),
    orderDiscounts: roundMoney(discounts),
    couponRedemptions: (redemptions ?? []).length,
    couponDiscount: roundMoney(couponDiscount),
  }
}

export interface RefundVoidReport {
  refunded: { orderNumber: number; total: number; at: string }[]
  refundedTotal: number
  cancelled: { orderNumber: number; total: number; at: string }[]
  cancelledTotal: number
  voidedExpenses: number
  voidedExpenseTotal: number
}

export async function fetchRefundVoidReport(
  restaurantId: string,
  range: ReportRange,
): Promise<RefundVoidReport> {
  const { data, error } = await supabase
    .from('orders')
    .select('order_number, total_amount, status, created_at')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', range.fromIso)
    .lt('created_at', range.toIso)
    .in('status', ['REFUNDED', 'CANCELLED'])
    .order('created_at', { ascending: false })
  if (error) throw error
  const refunded: RefundVoidReport['refunded'] = []
  const cancelled: RefundVoidReport['cancelled'] = []
  let refundedTotal = 0
  let cancelledTotal = 0
  for (const o of (data ?? []) as {
    order_number: number
    total_amount: number
    status: string
    created_at: string
  }[]) {
    const row = {
      orderNumber: o.order_number,
      total: Number(o.total_amount),
      at: o.created_at,
    }
    if (o.status === 'REFUNDED') {
      refunded.push(row)
      refundedTotal += row.total
    } else {
      cancelled.push(row)
      cancelledTotal += row.total
    }
  }
  const { data: voided, error: voidError } = await supabase
    .from('expenses')
    .select('amount')
    .eq('restaurant_id', restaurantId)
    .eq('is_voided', true)
    .gte('voided_at', range.fromIso)
    .lt('voided_at', range.toIso)
  if (voidError) throw voidError
  let voidedTotal = 0
  for (const e of (voided ?? []) as { amount: number }[]) {
    voidedTotal += Number(e.amount)
  }
  return {
    refunded,
    refundedTotal: roundMoney(refundedTotal),
    cancelled,
    cancelledTotal: roundMoney(cancelledTotal),
    voidedExpenses: (voided ?? []).length,
    voidedExpenseTotal: roundMoney(voidedTotal),
  }
}

export interface ShiftReportRow {
  cashier: string
  openedAt: string
  closedAt: string | null
  expected: number | null
  actual: number | null
  difference: number | null
}

export async function fetchShiftReport(
  restaurantId: string,
  range: ReportRange,
): Promise<ShiftReportRow[]> {
  const { data, error } = await supabase
    .from('cashier_shifts')
    .select('opened_by, opened_at, closed_at, expected_cash, actual_cash, difference')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'CLOSED')
    .gte('closed_at', range.fromIso)
    .lt('closed_at', range.toIso)
    .order('closed_at', { ascending: false })
  if (error) throw error
  const names = await fetchProfileNames(restaurantId)
  return ((data ?? []) as {
    opened_by: string | null
    opened_at: string
    closed_at: string | null
    expected_cash: number | null
    actual_cash: number | null
    difference: number | null
  }[]).map((s) => ({
    cashier: s.opened_by
      ? (names.get(s.opened_by) ?? s.opened_by.slice(0, 8))
      : '—',
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    expected: s.expected_cash === null ? null : Number(s.expected_cash),
    actual: s.actual_cash === null ? null : Number(s.actual_cash),
    difference: s.difference === null ? null : Number(s.difference),
  }))
}

export interface ItemMarginRow {
  productId: string
  name: string
  price: number
  cost: number | null
  costSource: 'recipe' | 'manual' | 'none'
  margin: number | null
  marginPct: number | null
  soldQty: number
}

/**
 * §28 food cost per product: recipe cost (Σ quantity_per_unit ×
 * ingredient cost_price) wins; the manual products.cost_price is the
 * fallback for bought-in items; neither → cost stays unknown and the
 * UI says so instead of inventing a margin.
 */
export async function fetchItemMargins(
  restaurantId: string,
  range: ReportRange,
): Promise<ItemMarginRow[]> {
  const { data: products, error } = await supabase
    .from('products')
    .select('id, name, price, cost_price')
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true })
  if (error) throw error
  const { data: recipes, error: recipeError } = await supabase
    .from('product_recipes')
    .select('product_id, inventory_item_id, quantity_per_unit')
    .eq('restaurant_id', restaurantId)
  if (recipeError) throw recipeError
  const { data: invItems, error: invError } = await supabase
    .from('inventory_items')
    .select('id, cost_price')
    .eq('restaurant_id', restaurantId)
  if (invError) throw invError
  const invCost = new Map(
    ((invItems ?? []) as { id: string; cost_price: number }[]).map((i) => [
      i.id,
      Number(i.cost_price),
    ]),
  )
  const recipeCostByProduct = new Map<string, number>()
  for (const r of (recipes ?? []) as {
    product_id: string
    inventory_item_id: string
    quantity_per_unit: number
  }[]) {
    const unitCost = invCost.get(r.inventory_item_id)
    if (unitCost === undefined) continue
    recipeCostByProduct.set(
      r.product_id,
      (recipeCostByProduct.get(r.product_id) ?? 0) +
        Number(r.quantity_per_unit) * unitCost,
    )
  }
  const { data: soldItems, error: soldError } = await supabase
    .from('order_items')
    .select('product_id, quantity, orders!inner (restaurant_id, status, created_at)')
    .eq('orders.restaurant_id', restaurantId)
    .gte('orders.created_at', range.fromIso)
    .lt('orders.created_at', range.toIso)
    .not('orders.status', 'in', NON_SALE_STATUSES)
  if (soldError) throw soldError
  const soldByProduct = new Map<string, number>()
  for (const row of (soldItems ?? []) as {
    product_id: string | null
    quantity: number
  }[]) {
    if (!row.product_id) continue
    soldByProduct.set(
      row.product_id,
      (soldByProduct.get(row.product_id) ?? 0) + Number(row.quantity),
    )
  }
  return ((products ?? []) as {
    id: string
    name: string
    price: number
    cost_price: number | null
  }[]).map((p) => {
    const price = Number(p.price)
    const recipeCost = recipeCostByProduct.get(p.id)
    let cost: number | null = null
    let costSource: ItemMarginRow['costSource'] = 'none'
    if (recipeCost !== undefined) {
      cost = roundMoney(recipeCost)
      costSource = 'recipe'
    } else if (p.cost_price !== null) {
      cost = Number(p.cost_price)
      costSource = 'manual'
    }
    const margin = cost === null ? null : roundMoney(price - cost)
    const marginPct =
      cost === null || price <= 0
        ? null
        : roundMoney(((price - cost) / price) * 100)
    return {
      productId: p.id,
      name: p.name,
      price,
      cost,
      costSource,
      margin,
      marginPct,
      soldQty: soldByProduct.get(p.id) ?? 0,
    }
  })
}
