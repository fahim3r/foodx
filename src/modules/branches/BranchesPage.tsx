// FoodX — Branches (Phase 7 Step 2B, §40).
// Branch CRUD over the branches table. One main branch per
// restaurant (the service demotes the previous main). Creating or
// promoting a main branch also backfills branch_stock from the
// global totals for items that have no branch row yet (0018).
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { isMissingTableError } from '@/lib/errors'
import {
  backfillBranchStock,
  createBranch,
  fetchBranches,
  updateBranch,
  type Branch,
  type BranchInput,
} from '@/services/restaurant'
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

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

interface BranchForm {
  name: string
  code: string
  address: string
  phone: string
  isMain: boolean
  status: 'active' | 'inactive'
}

const EMPTY_FORM: BranchForm = {
  name: '',
  code: '',
  address: '',
  phone: '',
  isMain: false,
  status: 'active',
}

export default function BranchesPage() {
  const { t } = useTranslation()
  const { restaurant, loading: authLoading, dbPending } = useAuth()
  const restaurantId = restaurant?.id

  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [form, setForm] = useState<BranchForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    if (!restaurantId) return
    setLoading(true)
    setLoadFailed(false)
    try {
      setBranches(await fetchBranches(restaurantId))
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    void load()
  }, [load])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId || saving) return
    setSaving(true)
    setFormError(null)
    setSaved(false)
    const input: BranchInput = {
      name: form.name,
      code: form.code || null,
      address: form.address || null,
      phone: form.phone || null,
      isMain: form.isMain,
      status: form.status,
    }
    try {
      if (editingId) {
        await updateBranch(restaurantId, editingId, input)
      } else {
        await createBranch(restaurantId, input)
      }
      if (input.isMain) {
        // Fill branch_stock for the (new) main branch — inserts only
        // rows that do not exist yet, so this never overwrites
        // quantities that movements have already set.
        await backfillBranchStock().catch(() => 0)
      }
      setForm(EMPTY_FORM)
      setEditingId(null)
      setSaved(true)
      await load()
    } catch {
      setFormError(t('branches.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (branch: Branch) => {
    setForm({
      name: branch.name,
      code: branch.code ?? '',
      address: branch.address ?? '',
      phone: branch.phone ?? '',
      isMain: branch.is_main,
      status: branch.status === 'inactive' ? 'inactive' : 'active',
    })
    setEditingId(branch.id)
    setSaved(false)
    setFormError(null)
  }

  if (authLoading) {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
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
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-bold tracking-tight">
          {t('branches.title')}
        </h2>
        <p className="text-muted-foreground">{t('branches.subtitle')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>
            {editingId ? t('branches.editTitle') : t('branches.newTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="branchName">{t('branches.name')}</Label>
                <Input
                  id="branchName"
                  value={form.name}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="branchCode">{t('branches.code')}</Label>
                <Input
                  id="branchCode"
                  value={form.code}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, code: e.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="branchPhone">{t('branches.phone')}</Label>
                <Input
                  id="branchPhone"
                  value={form.phone}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, phone: e.target.value }))
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="branchStatus">{t('branches.status')}</Label>
                <select
                  id="branchStatus"
                  value={form.status}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      status: e.target.value as 'active' | 'inactive',
                    }))
                  }
                  className={SELECT_CLASS}
                >
                  <option value="active">{t('branches.statusActive')}</option>
                  <option value="inactive">
                    {t('branches.statusInactive')}
                  </option>
                </select>
              </div>
              <div className="flex flex-col gap-2 sm:col-span-2">
                <Label htmlFor="branchAddress">{t('branches.address')}</Label>
                <Input
                  id="branchAddress"
                  value={form.address}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, address: e.target.value }))
                  }
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isMain}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, isMain: e.target.checked }))
                }
                className="h-4 w-4"
              />
              {t('branches.isMain')}
            </label>
            {formError && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </p>
            )}
            {saved && (
              <p
                role="status"
                className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              >
                {t('branches.saved')}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {editingId ? t('common.save') : t('branches.add')}
              </Button>
              {editingId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setForm(EMPTY_FORM)
                    setEditingId(null)
                  }}
                >
                  {t('common.cancel')}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('branches.listTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">{t('common.loading')}</p>
          ) : loadFailed ? (
            <p className="text-sm text-destructive">
              {t('branches.loadFailed')}
            </p>
          ) : branches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('branches.empty')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {branches.map((branch) => (
                <li
                  key={branch.id}
                  className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {branch.name}
                      {branch.is_main && (
                        <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {t('branches.mainBadge')}
                        </span>
                      )}
                      {branch.status === 'inactive' && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({t('branches.statusInactive')})
                        </span>
                      )}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => startEdit(branch)}
                    >
                      {t('common.edit')}
                    </Button>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {[branch.code, branch.phone, branch.address]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
