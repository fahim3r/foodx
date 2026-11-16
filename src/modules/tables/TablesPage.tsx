// FoodX — Tables page (protected).
// Lists the restaurant's tables with live status, lets the user add /
// edit / delete tables and change a table's status. Each table gets a
// real QR code (Phase 5) that opens the table's menu on the restaurant's
// own domain (or the platform preview URL when no domain is set yet),
// plus the NFC value for the tag.
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import { isMissingTableError, isUniqueViolationError } from '@/lib/errors'
import { useAuth } from '@/hooks/useAuth'
import { fetchBranches, type Branch } from '@/services/restaurant'
import { getPrimaryDomain } from '@/services/domains'
import { buildTableQrUrl } from '@/services/storefront'
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
  const [primaryDomain, setPrimaryDomain] = useState<string | null>(null)
  const [qrOpenTableId, setQrOpenTableId] = useState<string | null>(null)
  const [qrImages, setQrImages] = useState<Map<string, string>>(new Map())
  const [qrGeneratingId, setQrGeneratingId] = useState<string | null>(null)
  const [copiedTableId, setCopiedTableId] = useState<string | null>(null)
  const [nfcSavedTableId, setNfcSavedTableId] = useState<string | null>(null)

  const loadAll = useCallback(async (restaurantId: string) => {
    setPageState('loading')
    try {
      const [tablesData, branchesData, domain] = await Promise.all([
        fetchTables(restaurantId),
        fetchBranches(restaurantId),
        getPrimaryDomain(restaurantId),
      ])
      setTables(tablesData)
      setBranches(branchesData)
      setPrimaryDomain(domain?.domain ?? null)
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

  // The URL a table's QR code + NFC tag point at: the primary domain
  // when one is set, otherwise the platform preview URL (?store=).
  const tableUrl = (table: DiningTable): string | null => {
    if (!restaurant || !table.qr_code) return null
    return buildTableQrUrl(primaryDomain, restaurant.slug, table.qr_code)
  }

  const toggleQr = async (table: DiningTable) => {
    if (qrOpenTableId === table.id) {
      setQrOpenTableId(null)
      return
    }
    setQrOpenTableId(table.id)
    const url = tableUrl(table)
    if (!url || qrImages.has(table.id)) return
    setQrGeneratingId(table.id)
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 256,
      })
      setQrImages((prev) => new Map(prev).set(table.id, dataUrl))
    } catch (error) {
      console.error('[Tables] QR generation failed', error)
      setActionErrorKey('tables.loadFailed')
      setQrOpenTableId(null)
    } finally {
      setQrGeneratingId(null)
    }
  }

  const printQr = (table: DiningTable) => {
    if (!restaurant) return
    const dataUrl = qrImages.get(table.id)
    if (!dataUrl) return
    const win = window.open('', '_blank', 'width=640,height=640')
    if (!win) return
    win.document.write(
      `<!doctype html><html><head><title>${restaurant.name} — ${table.name}</title>` +
        '<style>body{font-family:sans-serif;text-align:center;padding:32px}img{width:320px;height:320px}h1{font-size:28px;margin:8px 0}h2{font-size:20px;margin:0 0 16px}p{color:#555}</style>' +
        `</head><body><h1>${restaurant.name}</h1><h2>${table.name}</h2>` +
        `<img src="${dataUrl}" alt="QR code"><p>${t('tables.qr.scanNote')}</p></body></html>`,
    )
    win.document.close()
    win.focus()
    win.print()
  }

  const copyUrl = async (table: DiningTable) => {
    const url = tableUrl(table)
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard unavailable (old browser / insecure context) — the
      // URL is still visible as text above, so nothing is lost.
    }
    setCopiedTableId(table.id)
    window.setTimeout(() => {
      setCopiedTableId((current) =>
        current === table.id ? null : current,
      )
    }, 2000)
  }

  const saveNfcValue = async (table: DiningTable) => {
    const url = tableUrl(table)
    if (!url || !restaurant) return
    setBusyTableId(table.id)
    try {
      await updateTable(table.id, { nfc_value: url })
      await refreshTables(restaurant.id)
      setNfcSavedTableId(table.id)
      window.setTimeout(() => {
        setNfcSavedTableId((current) =>
          current === table.id ? null : current,
        )
      }, 2000)
    } catch (error) {
      console.error('[Tables] NFC save failed', error)
      setActionErrorKey('tables.saveFailed')
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
                {tableUrl(table) && (
                  <div className="flex flex-col gap-2 border-t pt-3 text-sm">
                    <p className="font-medium">{t('tables.qr.title')}</p>
                    <p className="break-all font-mono text-xs">
                      {tableUrl(table)}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={qrGeneratingId === table.id}
                        onClick={() => void toggleQr(table)}
                      >
                        {qrOpenTableId === table.id
                          ? t('tables.qr.hideQr')
                          : qrGeneratingId === table.id
                            ? t('common.loading')
                            : t('tables.qr.showQr')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void copyUrl(table)}
                      >
                        {copiedTableId === table.id
                          ? t('tables.qr.copied')
                          : t('tables.qr.copy')}
                      </Button>
                      {qrImages.get(table.id) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => printQr(table)}
                        >
                          {t('tables.qr.print')}
                        </Button>
                      )}
                    </div>
                    {qrOpenTableId === table.id && qrImages.get(table.id) && (
                      <div className="flex flex-col items-start gap-1">
                        <img
                          src={qrImages.get(table.id)}
                          alt={t('tables.qr.title')}
                          className="h-40 w-40 rounded-md border bg-white p-1"
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('tables.qr.scanNote')}
                        </p>
                      </div>
                    )}
                    <p className="pt-1 font-medium">{t('tables.qr.nfcTitle')}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('tables.qr.nfcNote')}
                    </p>
                    {table.nfc_value && table.nfc_value !== tableUrl(table) ? (
                      <p className="break-all font-mono text-xs text-amber-700">
                        {table.nfc_value}
                      </p>
                    ) : null}
                    {table.nfc_value !== tableUrl(table) && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busyTableId === table.id}
                          onClick={() => void saveNfcValue(table)}
                        >
                          {t('tables.qr.nfcSave')}
                        </Button>
                        {nfcSavedTableId === table.id && (
                          <span className="text-xs text-emerald-700">
                            {t('tables.qr.nfcSaved')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
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
