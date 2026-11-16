// FoodX — Tables page (protected).
// Lists the restaurant's tables with live status, lets the user add /
// edit / delete tables and change a table's status. The QR code value
// is shown as text only — no QR image is generated (not implemented).
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { isMissingTableError, isUniqueViolationError } from '@/lib/errors'
import { useAuth } from '@/hooks/useAuth'
import { fetchBranches, type Branch } from '@/services/restaurant'
import {
  createTable,
  deleteTable,
  fetchTables,
  setTableStatus,
  updateTable,
} from '@/services/tables'
import type { DiningTable, TableStatus } from '@/types'
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

const STATUSES: TableStatus[] = ['available', 'occupied', 'reserved', 'cleaning']

const STATUS_KEYS: Record<TableStatus, string> = {
  available: 'tables.statusAvailable',
  occupied: 'tables.statusOccupied',
  reserved: 'tables.statusReserved',
  cleaning: 'tables.statusCleaning',
}

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]'

export default function TablesPage() {
  const { t } = useTranslation()
  const { restaurant, loading: authLoading } = useAuth()
  const [tables, setTables] = useState<DiningTable[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [pageState, setPageState] = useState<
    'loading' | 'ready' | 'dbPending' | 'error'
  >('loading')
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [seats, setSeats] = useState(1)
  const [branchId, setBranchId] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveErrorKey, setSaveErrorKey] = useState<string | null>(null)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  )
  const [deleteErrorKey, setDeleteErrorKey] = useState<string | null>(null)
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null)
  const [busyTableId, setBusyTableId] = useState<string | null>(null)

  const loadAll = useCallback(async (restaurantId: string) => {
    setPageState('loading')
    try {
      const [tablesData, branchesData] = await Promise.all([
        fetchTables(restaurantId),
        fetchBranches(restaurantId),
      ])
      setTables(tablesData)
      setBranches(branchesData)
      setPageState('ready')
    } catch (error) {
      console.error('[Tables] load failed', error)
      setPageState(isMissingTableError(error) ? 'dbPending' : 'error')
    }
  }, [])

  useEffect(() => {
    if (authLoading || !restaurant) return
    void loadAll(restaurant.id)
  }, [authLoading, restaurant, loadAll])

  const refreshTables = useCallback(async (restaurantId: string) => {
    try {
      setTables(await fetchTables(restaurantId))
    } catch (error) {
      console.error('[Tables] refresh failed', error)
      setActionErrorKey('tables.loadFailed')
    }
  }, [])

  const openAddForm = () => {
    setEditingId(null)
    setName('')
    setSeats(1)
    setBranchId('')
    setSaveErrorKey(null)
    setFormOpen(true)
  }

  const openEditForm = (table: DiningTable) => {
    setEditingId(table.id)
    setName(table.name)
    setSeats(table.seats)
    setBranchId(table.branch_id ?? '')
    setSaveErrorKey(null)
    setFormOpen(true)
  }

  const closeForm = () => {
    setFormOpen(false)
    setEditingId(null)
    setSaveErrorKey(null)
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurant) return
    setSaveErrorKey(null)
    setSaving(true)
    try {
      const trimmedName = name.trim()
      if (editingId) {
        await updateTable(editingId, {
          branch_id: branchId || null,
          name: trimmedName,
          seats,
        })
      } else {
        const created = await createTable(restaurant.id, {
          branchId: branchId || null,
          name: trimmedName,
          seats,
        })
        // createTable does not accept a qr_code — set it right after.
        const qrCode = `${restaurant.slug}-${trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        await updateTable(created.id, { qr_code: qrCode })
      }
      await refreshTables(restaurant.id)
      closeForm()
    } catch (error) {
      console.error('[Tables] save failed', error)
      setSaveErrorKey(
        isUniqueViolationError(error)
          ? 'tables.nameTaken'
          : 'tables.saveFailed',
      )
      // A create may have succeeded before a later step failed — make
      // sure the list reflects what is actually in the database.
      await refreshTables(restaurant.id)
    } finally {
      setSaving(false)
    }
  }

  const handleStatusChange = async (tableId: string, status: TableStatus) => {
    setActionErrorKey(null)
    setBusyTableId(tableId)
    try {
      await setTableStatus(tableId, status)
      if (restaurant) await refreshTables(restaurant.id)
    } catch (error) {
      console.error('[Tables] status change failed', error)
      setActionErrorKey('tables.saveFailed')
    } finally {
      setBusyTableId(null)
    }
  }

  const handleDelete = async (tableId: string) => {
    setDeleteErrorKey(null)
    setBusyTableId(tableId)
    try {
      await deleteTable(tableId)
      setConfirmingDeleteId(null)
      if (restaurant) await refreshTables(restaurant.id)
    } catch (error) {
      console.error('[Tables] delete failed', error)
      setDeleteErrorKey(
        error instanceof Error && error.message === 'table_has_active_orders'
          ? 'tables.hasActiveOrders'
          : 'tables.deleteFailed',
      )
    } finally {
      setBusyTableId(null)
    }
  }

  const branchName = (table: DiningTable) =>
    branches.find((branch) => branch.id === table.branch_id)?.name ??
    t('tables.noBranch')

  if (authLoading || pageState === 'loading') {
    return <p className="text-muted-foreground">{t('common.loading')}</p>
  }

  if (!restaurant) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('layout.noProfileTitle')}</CardTitle>
          <CardDescription>{t('layout.noProfileBody')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/settings">{t('layout.goToSettings')}</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (pageState === 'dbPending') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('layout.dbPendingTitle')}</CardTitle>
          <CardDescription>{t('layout.dbPendingBody')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (pageState === 'error') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('common.error')}</CardTitle>
          <CardDescription>{t('tables.loadFailed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void loadAll(restaurant.id)}>
            {t('common.retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {t('tables.title')}
          </h2>
          <p className="text-muted-foreground">{t('tables.subtitle')}</p>
        </div>
        <Button type="button" onClick={openAddForm}>
          {t('tables.addTable')}
        </Button>
      </header>

      {actionErrorKey && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t(actionErrorKey)}
        </p>
      )}

      {formOpen && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingId ? t('tables.editTable') : t('tables.newTable')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="tableName">{t('tables.tableName')}</Label>
                  <Input
                    id="tableName"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('tables.tableNamePlaceholder')}
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="tableSeats">{t('tables.seats')}</Label>
                  <Input
                    id="tableSeats"
                    type="number"
                    min={1}
                    step={1}
                    value={seats}
                    onChange={(e) =>
                      setSeats(Math.max(1, Number(e.target.value) || 1))
                    }
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="tableBranch">{t('tables.branch')}</Label>
                  <select
                    id="tableBranch"
                    value={branchId}
                    onChange={(e) => setBranchId(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">{t('tables.noBranch')}</option>
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {saveErrorKey && (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {t(saveErrorKey)}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={saving}>
                  {t('common.save')}
                </Button>
                <Button type="button" variant="outline" onClick={closeForm}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {deleteErrorKey && (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {t(deleteErrorKey)}
        </p>
      )}

      {tables.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t('tables.noTables')}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map((table) => (
            <Card key={table.id}>
              <CardHeader>
                <CardTitle>{table.name}</CardTitle>
                <CardDescription>
                  {t('tables.seats')}: {table.seats}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  {branchName(table)}
                </p>
                <span className="inline-block w-fit rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {t(STATUS_KEYS[table.status])}
                </span>
                <div className="flex flex-col gap-1 text-sm">
                  <p className="font-medium">{t('tables.qrCode')}</p>
                  {table.qr_code && (
                    <p className="break-all font-mono text-xs">{table.qr_code}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t('tables.qrNotImplemented')}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`status-${table.id}`}>
                    {t('tables.setStatus')}
                  </Label>
                  <select
                    id={`status-${table.id}`}
                    value={table.status}
                    disabled={busyTableId === table.id}
                    onChange={(e) =>
                      void handleStatusChange(
                        table.id,
                        e.target.value as TableStatus,
                      )
                    }
                    className={SELECT_CLASS}
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {t(STATUS_KEYS[status])}
                      </option>
                    ))}
                  </select>
                </div>
                {confirmingDeleteId === table.id ? (
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    <p className="text-sm font-medium">
                      {t('tables.deleteConfirm')}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={busyTableId === table.id}
                        onClick={() => void handleDelete(table.id)}
                      >
                        {t('common.delete')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmingDeleteId(null)}
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEditForm(table)}
                    >
                      {t('common.edit')}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setDeleteErrorKey(null)
                        setConfirmingDeleteId(table.id)
                      }}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
