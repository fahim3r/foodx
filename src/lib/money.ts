// FoodX — money formatting. Amounts are stored as numeric(12,2) in the
// database and handled as plain numbers (2 decimal places) in the app.
// Never use floats for money without rounding — see roundMoney() in
// src/services/pos.ts, which is the single place order totals are computed.

const CURRENCY_SYMBOLS: Record<string, string> = {
  BDT: '৳',
  USD: '$',
  EUR: '€',
  INR: '₹',
}

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? currency
}

/** Format an amount with the restaurant's currency symbol, 2 decimals. */
export function formatMoney(amount: number, currency: string): string {
  const value = Number(amount) || 0
  return `${currencySymbol(currency)}${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}
