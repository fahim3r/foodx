// FoodX — print helper (Phase 7 Step 2A).
//
// One mechanism for report print/PDF views (§39 "PDF where
// appropriate") and order receipts / kitchen tickets (§62): build a
// small standalone HTML document, open it in a new window, and let
// the browser's print flow handle paper or Save-as-PDF. No PDF
// library; printer choice stays with the OS dialog (per-device
// printer routing is out of scope — see the Step 2A design).

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Open `bodyHtml` in a print-ready window and trigger printing. */
export function printHtml(title: string, bodyHtml: string, css = ''): boolean {
  const win = window.open('', '_blank', 'width=480,height=720')
  if (!win) return false
  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 16px 0 6px; }
  p { margin: 2px 0; font-size: 12px; }
  .muted { color: #555; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 8px; }
  th, td { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left; }
  th { border-bottom: 2px solid #999; }
  td.num, th.num { text-align: right; }
  .row { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
  .total { border-top: 2px solid #111; font-weight: 700; font-size: 14px; padding-top: 6px; margin-top: 6px; }
  .center { text-align: center; }
  ${css}
</style>
</head>
<body>${bodyHtml}</body>
</html>`)
  win.document.close()
  win.focus()
  win.print()
  return true
}
