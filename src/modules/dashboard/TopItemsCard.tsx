// FoodX — top-selling items (Dashboard modernisation W2, design
// §3 row 7). Today's top 5 from fetchProductSales — the same
// function Reports uses, so the figures can never disagree with
// Reports — with a thin share bar per row (the row's share of the
// top-5 total). Money widget: the page renders it only for
// reports.view holders, and only once the Phase 7 inputs have
// loaded (the page's gate).
import { useTranslation } from 'react-i18next'
import { formatMoney, roundMoney } from '@/lib/money'
import type { ProductSalesRow } from '@/services/business'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function TopItemsCard({
  products,
  currency,
}: {
  products: ProductSalesRow[]
  currency: string
}) {
  const { t } = useTranslation()
  const total = roundMoney(products.reduce((sum, row) => sum + row.amount, 0))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.topProducts')}</CardTitle>
      </CardHeader>
      <CardContent>
        {products.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('reports.noData')}
          </p>
        ) : (
          <div className="divide-y">
            {products.map((row) => {
              const share = total > 0 ? (row.amount / total) * 100 : 0
              return (
                <div key={row.name} className="py-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      {row.name}
                      {' · '}
                      {row.quantity}
                    </span>
                    <span className="font-medium">
                      {formatMoney(row.amount, currency)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
