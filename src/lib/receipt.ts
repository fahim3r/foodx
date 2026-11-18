// FoodX — receipt + kitchen ticket builders (§62, Phase 7 Step 2A).
//
// Pure HTML builders over an OrderDetail; the caller supplies the
// already-localized labels and a money formatter, so this file stays
// free of i18n and formatting policy. Printing itself is print.ts.

import { escapeHtml } from '@/lib/print'
import type { OrderDetail } from '@/types'

export interface ReceiptContext {
  restaurantName: string
  logoUrl: string | null
  branchName: string | null
  branchAddress: string | null
  branchPhone: string | null
  tableName: string | null
  footer: string | null
  /** Printed instead of "#<order_number>" — used for offline-queued
   * orders, which have a local reference but no real number yet. */
  orderRef?: string
  /** Pre-formatted channel line printed under the order row, e.g.
   * "Foodpanda #FP-123" for third-party orders (gap 1). */
  channelLine?: string
}

export interface ReceiptLabels {
  order: string
  table: string
  subtotal: string
  discount: string
  tax: string
  serviceCharge: string
  deliveryFee: string
  total: string
  payment: string
  kitchenTicket: string
  notes: string
  poweredBy: string
}

const RECEIPT_CSS = `
  body { font-family: ui-monospace, Menlo, Consolas, monospace; width: 300px; margin: 12px auto; }
  h1 { font-size: 16px; text-align: center; }
  .center { text-align: center; }
  img.logo { display: block; margin: 0 auto 6px; max-height: 64px; max-width: 180px; }
  hr { border: none; border-top: 1px dashed #111; margin: 8px 0; }
`

function itemRows(detail: OrderDetail, fmt: (n: number) => string): string {
  return detail.items
    .map((item) => {
      const mods = item.modifiers
        .map(
          (m) =>
            `<div class="row"><span>&nbsp;&nbsp;+ ${escapeHtml(m.modifier_name)}</span><span>${fmt(Number(m.price))}</span></div>`,
        )
        .join('')
      const variant = item.variant_name
        ? ` (${escapeHtml(item.variant_name)})`
        : ''
      const note = item.note
        ? `<div class="row"><span>&nbsp;&nbsp;* ${escapeHtml(item.note)}</span></div>`
        : ''
      return `<div class="row"><span>${item.quantity} × ${escapeHtml(item.product_name)}${variant}</span><span>${fmt(Number(item.total_price))}</span></div>${mods}${note}`
    })
    .join('')
}

export function buildReceiptHtml(
  detail: OrderDetail,
  ctx: ReceiptContext,
  labels: ReceiptLabels,
  fmt: (n: number) => string,
  methodLabel: (method: string) => string,
): { title: string; html: string; css: string } {
  const payments = detail.payments
    .map(
      (p) =>
        `<div class="row"><span>${labels.payment}: ${escapeHtml(methodLabel(p.method))}</span><span>${fmt(Number(p.amount))}</span></div>`,
    )
    .join('')
  const deliveryFee = Number(detail.delivery_fee ?? 0)
  const html = `
    ${ctx.logoUrl ? `<img class="logo" src="${escapeHtml(ctx.logoUrl)}" alt="" />` : ''}
    <h1>${escapeHtml(ctx.restaurantName)}</h1>
    <p class="center muted">${escapeHtml(labels.poweredBy)}</p>
    ${ctx.branchName ? `<p class="center">${escapeHtml(ctx.branchName)}</p>` : ''}
    ${ctx.branchAddress ? `<p class="center">${escapeHtml(ctx.branchAddress)}</p>` : ''}
    ${ctx.branchPhone ? `<p class="center">${escapeHtml(ctx.branchPhone)}</p>` : ''}
    <hr />
    <div class="row"><span>${labels.order} ${ctx.orderRef ?? `#${detail.order_number}`}</span><span>${new Date(detail.created_at).toLocaleString()}</span></div>${ctx.channelLine ? `
    <div class="center">${escapeHtml(ctx.channelLine)}</div>` : ''}
    ${ctx.tableName ? `<div class="row"><span>${labels.table}</span><span>${escapeHtml(ctx.tableName)}</span></div>` : ''}
    <hr />
    ${itemRows(detail, fmt)}
    <hr />
    <div class="row"><span>${labels.subtotal}</span><span>${fmt(Number(detail.subtotal))}</span></div>
    ${Number(detail.discount_amount) > 0 ? `<div class="row"><span>${labels.discount}</span><span>−${fmt(Number(detail.discount_amount))}</span></div>` : ''}
    ${Number(detail.tax_amount) > 0 ? `<div class="row"><span>${labels.tax}</span><span>${fmt(Number(detail.tax_amount))}</span></div>` : ''}
    ${Number(detail.service_charge_amount) > 0 ? `<div class="row"><span>${labels.serviceCharge}</span><span>${fmt(Number(detail.service_charge_amount))}</span></div>` : ''}
    ${deliveryFee > 0 ? `<div class="row"><span>${labels.deliveryFee}</span><span>${fmt(deliveryFee)}</span></div>` : ''}
    <div class="row total"><span>${labels.total}</span><span>${fmt(Number(detail.total_amount))}</span></div>
    ${payments}
    ${ctx.footer ? `<hr /><p class="center">${escapeHtml(ctx.footer)}</p>` : ''}
  `
  return { title: `Receipt ${ctx.orderRef ?? `#${detail.order_number}`}`, html, css: RECEIPT_CSS }
}

export function buildKitchenTicketHtml(
  detail: OrderDetail,
  ctx: ReceiptContext,
  labels: ReceiptLabels,
): { title: string; html: string; css: string } {
  const items = detail.items
    .map((item) => {
      const mods = item.modifiers
        .map(
          (m) =>
            `<div class="row"><span>&nbsp;&nbsp;+ ${escapeHtml(m.modifier_name)}</span></div>`,
        )
        .join('')
      const variant = item.variant_name
        ? ` (${escapeHtml(item.variant_name)})`
        : ''
      const note = item.note
        ? `<div class="row"><span>&nbsp;&nbsp;* ${escapeHtml(item.note)}</span></div>`
        : ''
      return `<div class="row"><span>${item.quantity} × ${escapeHtml(item.product_name)}${variant}</span></div>${mods}${note}`
    })
    .join('')
  const html = `
    <h1>${labels.kitchenTicket}</h1>
    <div class="row"><span>${labels.order} #${detail.order_number}</span><span>${new Date(detail.created_at).toLocaleString()}</span></div>
    ${ctx.tableName ? `<div class="row"><span>${labels.table}</span><span>${escapeHtml(ctx.tableName)}</span></div>` : ''}
    <hr />
    ${items}
    ${detail.notes ? `<hr /><p>${labels.notes}: ${escapeHtml(detail.notes)}</p>` : ''}
  `
  return { title: `Kitchen #${detail.order_number}`, html, css: RECEIPT_CSS }
}
