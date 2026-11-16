// FoodX — Inventory page (protected).
// Stock items, recipes, suppliers, purchase orders and the stock
// movement audit trail for the current restaurant.
//
// STOCK RULE: quantities change ONLY through movements (adjust / waste /
// purchase receipt / sale). The item form has NO quantity field, and
// the service excludes current_quantity from updates. Every movement
// needs a reason where the user causes it (adjust / waste).
// Receiving a purchase order is FULL receipt only — partial receiving
// is not implemented and the page says so.
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { isMissingTableError, isUniqueViolationError } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { useAuth } from '@/hooks/useAuth'
import {
  adjustStock,
  createInventoryItem,
  deleteInventoryItem,
  fetchInventoryItems,
  fetchProductAvailability,
  fetchStockMovements,
  recordWaste,
  updateInventoryItem,
} from '@/services/inventory'
import { fetchProducts } from '@/services/menu'
import {
  advancePurchaseOrderStatus,
  createPurchaseOrder,
  deletePurchaseOrder,
  fetchPurchaseOrderDetail,
  fetchPurchaseOrders,
  receivePurchaseOrder,
  type PurchaseOrderLineInput,
} from '@/services/purchases'
import {
  addRecipeLine,
  deleteRecipeLine,
  fetchRecipes,
  updateRecipeLine,
} from '@/services/recipes'
import {
  createSupplier,
  deleteSupplier,
  fetchSuppliers,
  updateSupplier,
} from '@/services/suppliers'
import type {
  InventoryItem,
  Product,
  ProductRecipeWithItem,
  PurchaseOrder,
  PurchaseOrderWithDetails,
  StockMovementType,
  StockMovementWithItem,
  Supplier,
} from '@/types'
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

type Tab = 'items' | 'recipes' | 'suppliers' | 'purchases' | 'movements'

const TABS: Tab[] = ['items', 'recipes', 'suppliers', 'purchases', 'movements']

const TAB_KEYS: Record<Tab, string> = {
  items: 'inventory.tabItems',
  recipes: 'inventory.tabRecipes',
  suppliers: 'inventory.tabSuppliers',
  purchases: 'inventory.tabPurchases',
  movements: 'inventory.tabMovements',
}

const MOVEMENT_TYPE_KEYS: Record<StockMovementType, string> = {
  PURCHASE: 'inventory.typePurchase',
  SALE: 'inventory.typeSale',
  ADJUSTMENT: 'inventory.typeAdjustment',
  WASTE: 'inventory.typeWaste',
  TRANSFER_IN: 'inventory.typeTransferIn',
  TRANSFER_OUT: 'inventory.typeTransferOut',
}

const PO_STATUS_KEYS: Record<PurchaseOrder['status'], string> = {
  DRAFT: 'inventory.statusDraft',
  ORDERED: 'inventory.statusOrdered',
  RECEIVED: 'inventory.statusReceived',
  CANCELLED: 'inventory.statusCancelled',
}

/** Quantities are numeric(12,3): show up to 3 decimals, no trailing zeros. */
function formatQty(value: number): string {
  return String(Math.round(Number(value) * 1000) / 1000)
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

interface ItemForm {
  name: string
  unit: string
  lowStockThreshold: number
  costPrice: number
  isActive: boolean
}

const EMPTY_ITEM: ItemForm = {
  name: '',
  unit: '',
  lowStockThreshold: 0,
  costPrice: 0,
  isActive: true,
}

interface SupplierForm {
  name: string
  phone: string
  email: string
  address: string
}

const EMPTY_SUPPLIER: SupplierForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
}

interface PoLineForm {
  key: string
  inventoryItemId: string
  quantity: number
  unitCost: number
}

export default function InventoryPage() {
  const { t } = useTranslation()
  const { loading: authLoading, restaurant, settings } = useAuth()
  const restaurantId = restaurant?.id
  const currency = settings?.currency ?? 'BDT'

  const [tab, setTab] = useState<Tab>('items')
  const [loading, setLoading] = useState(true)
  const [dbPending, setDbPending] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const [items, setItems] = useState<InventoryItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [movements, setMovements] = useState<StockMovementWithItem[]>([])
  const [availability, setAvailability] = useState<Map<string, number>>(
    new Map(),
  )

  const [itemError, setItemError] = useState<string | null>(null)
  const [recipeError, setRecipeError] = useState<string | null>(null)
  const [supplierError, setSupplierError] = useState<string | null>(null)
  const [poError, setPoError] = useState<string | null>(null)

  // Two-step delete: the id awaiting its confirming click.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // --- item form -------------------------------------------------------------
  const [itemForm, setItemForm] = useState<ItemForm>(EMPTY_ITEM)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)

  // --- adjust / waste panel ---------------------------------------------------
  const [adjustItemId, setAdjustItemId] = useState<string | null>(null)
  const [adjustMode, setAdjustMode] = useState<'adjust' | 'waste'>('adjust')
  const [adjustDelta, setAdjustDelta] = useState(0)
  const [wasteQty, setWasteQty] = useState(0)
  const [adjustReason, setAdjustReason] = useState('')
  const [adjustError, setAdjustError] = useState<string | null>(null)
  const [adjustSaved, setAdjustSaved] = useState(false)

  // --- recipes ----------------------------------------------------------------
  const [recipeProductId, setRecipeProductId] = useState('')
  const [recipeLines, setRecipeLines] = useState<ProductRecipeWithItem[]>([])
  const [newRecipeItemId, setNewRecipeItemId] = useState('')
  const [newRecipeQty, setNewRecipeQty] = useState(0)
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null)
  const [editingRecipeQty, setEditingRecipeQty] = useState(0)
  const [recipeSaved, setRecipeSaved] = useState(false)

  // --- supplier form -----------------------------------------------------------
  const [supplierForm, setSupplierForm] =
    useState<SupplierForm>(EMPTY_SUPPLIER)
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(
    null,
  )

  // --- purchase orders ----------------------------------------------------------
  const [poSupplierId, setPoSupplierId] = useState('')
  const [poOrderDate, setPoOrderDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  )
  const [poNotes, setPoNotes] = useState('')
  const [poLines, setPoLines] = useState<PoLineForm[]>([])
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null)
  const [selectedPo, setSelectedPo] =
    useState<PurchaseOrderWithDetails | null>(null)
  const [poConfirm, setPoConfirm] = useState<'receive' | 'cancel' | null>(
    null,
  )
  const [poActionDone, setPoActionDone] = useState<string | null>(null)

  // --- loading ------------------------------------------------------------------
  useEffect(() => {
    if (authLoading || !restaurantId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setLoadError(false)
      setDbPending(false)
      try {
        const [loadedItems, loadedProducts, loadedSuppliers, loadedPos, loadedMovements, loadedAvailability] =
          await Promise.all([
            fetchInventoryItems(restaurantId),
            fetchProducts(restaurantId),
            fetchSuppliers(restaurantId),
            fetchPurchaseOrders(restaurantId),
            fetchStockMovements(restaurantId),
            fetchProductAvailability(restaurantId),
          ])
        if (cancelled) return
        setItems(loadedItems)
        setProducts(loadedProducts)
        setSuppliers(loadedSuppliers)
        setPurchaseOrders(loadedPos)
        setMovements(loadedMovements)
        setAvailability(loadedAvailability)
      } catch (error) {
        console.error('[Inventory] load failed', error)
        if (cancelled) return
        if (isMissingTableError(error)) {
          setDbPending(true)
        } else {
          setLoadError(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [authLoading, restaurantId])

  const reloadItems = async () => {
    if (!restaurantId) return
    const [loadedItems, loadedMovements, loadedAvailability] =
      await Promise.all([
        fetchInventoryItems(restaurantId),
        fetchStockMovements(restaurantId),
        fetchProductAvailability(restaurantId),
      ])
    setItems(loadedItems)
    setMovements(loadedMovements)
    setAvailability(loadedAvailability)
  }

  const reloadRecipes = async () => {
    if (!recipeProductId) return
    const lines = await fetchRecipes(recipeProductId)
    setRecipeLines(lines)
  }

  const reloadPurchaseOrders = async () => {
    if (!restaurantId) return
    const loaded = await fetchPurchaseOrders(restaurantId)
    setPurchaseOrders(loaded)
    if (selectedPoId) {
      setSelectedPo(await fetchPurchaseOrderDetail(selectedPoId))
    }
  }

  // --- derived -------------------------------------------------------------------
  const totalStockValue = useMemo(
    () =>
      items.reduce(
        (sum, item) =>
          sum + Number(item.current_quantity) * Number(item.cost_price),
        0,
      ),
    [items],
  )

  const lowStockCount = useMemo(
    () =>
      items.filter(
        (item) =>
          item.is_active &&
          Number(item.current_quantity) <= Number(item.low_stock_threshold),
      ).length,
    [items],
  )

  const supplierById = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier])),
    [suppliers],
  )

  const itemById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  )

  const selectedRecipeProduct = products.find((p) => p.id === recipeProductId)
  const selectedServings = recipeProductId
    ? availability.get(recipeProductId)
    : undefined

  const recipeAvailableItems = items.filter(
    (item) =>
      item.is_active &&
      !recipeLines.some((line) => line.inventory_item_id === item.id),
  )

  const poFormTotal = poLines.reduce(
    (sum, line) => sum + Number(line.quantity || 0) * Number(line.unitCost || 0),
    0,
  )

  // --- item handlers ---------------------------------------------------------------
  const handleItemSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId) return
    setItemError(null)
    try {
      if (editingItemId) {
        await updateInventoryItem(editingItemId, {
          name: itemForm.name.trim(),
          unit: itemForm.unit.trim(),
          low_stock_threshold: itemForm.lowStockThreshold,
          cost_price: itemForm.costPrice,
          is_active: itemForm.isActive,
        })
      } else {
        await createInventoryItem(restaurantId, {
          name: itemForm.name.trim(),
          unit: itemForm.unit.trim(),
          lowStockThreshold: itemForm.lowStockThreshold,
          costPrice: itemForm.costPrice,
        })
      }
      setItemForm(EMPTY_ITEM)
      setEditingItemId(null)
      await reloadItems()
    } catch (error) {
      console.error('[Inventory] save item failed', error)
      setItemError(
        isUniqueViolationError(error)
          ? 'inventory.nameTaken'
          : 'inventory.saveFailed',
      )
    }
  }

  const handleDeleteItem = async (itemId: string) => {
    if (confirmDeleteId !== itemId) {
      setConfirmDeleteId(itemId)
      return
    }
    setConfirmDeleteId(null)
    setItemError(null)
    try {
      await deleteInventoryItem(itemId)
      await reloadItems()
    } catch (error) {
      console.error('[Inventory] delete item failed', error)
      setItemError('inventory.saveFailed')
    }
  }

  const handleAdjustSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!adjustItemId) return
    setAdjustError(null)
    setAdjustSaved(false)
    try {
      if (adjustMode === 'adjust') {
        await adjustStock(adjustItemId, adjustDelta, adjustReason)
      } else {
        await recordWaste(adjustItemId, wasteQty, adjustReason)
      }
      setAdjustReason('')
      setAdjustDelta(0)
      setWasteQty(0)
      setAdjustSaved(true)
      await reloadItems()
    } catch (error) {
      console.error('[Inventory] adjust stock failed', error)
      const message = error instanceof Error ? error.message : ''
      setAdjustError(
        message === 'reason_required'
          ? 'inventory.reasonRequired'
          : message === 'invalid_quantity'
            ? 'inventory.saveFailed'
            : 'inventory.saveFailed',
      )
    }
  }

  // --- recipe handlers ---------------------------------------------------------------
  const handleRecipeProductChange = async (productId: string) => {
    setRecipeProductId(productId)
    setRecipeError(null)
    setRecipeSaved(false)
    setEditingRecipeId(null)
    if (!productId) {
      setRecipeLines([])
      return
    }
    try {
      setRecipeLines(await fetchRecipes(productId))
    } catch (error) {
      console.error('[Inventory] load recipe failed', error)
      setRecipeError('inventory.loadFailed')
    }
  }

  const handleAddRecipeLine = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId || !recipeProductId || !newRecipeItemId) return
    setRecipeError(null)
    setRecipeSaved(false)
    try {
      await addRecipeLine(
        restaurantId,
        recipeProductId,
        newRecipeItemId,
        newRecipeQty,
      )
      setNewRecipeItemId('')
      setNewRecipeQty(0)
      setRecipeSaved(true)
      await reloadRecipes()
    } catch (error) {
      console.error('[Inventory] add recipe line failed', error)
      setRecipeError(
        isUniqueViolationError(error)
          ? 'inventory.saveFailed'
          : 'inventory.saveFailed',
      )
    }
  }

  const handleUpdateRecipeLine = async (recipeId: string) => {
    setRecipeError(null)
    setRecipeSaved(false)
    try {
      await updateRecipeLine(recipeId, editingRecipeQty)
      setEditingRecipeId(null)
      setRecipeSaved(true)
      await reloadRecipes()
    } catch (error) {
      console.error('[Inventory] update recipe line failed', error)
      setRecipeError('inventory.saveFailed')
    }
  }

  const handleDeleteRecipeLine = async (recipeId: string) => {
    if (confirmDeleteId !== recipeId) {
      setConfirmDeleteId(recipeId)
      return
    }
    setConfirmDeleteId(null)
    setRecipeError(null)
    try {
      await deleteRecipeLine(recipeId)
      await reloadRecipes()
    } catch (error) {
      console.error('[Inventory] delete recipe line failed', error)
      setRecipeError('inventory.saveFailed')
    }
  }

  // --- supplier handlers ---------------------------------------------------------------
  const handleSupplierSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId) return
    setSupplierError(null)
    try {
      if (editingSupplierId) {
        await updateSupplier(editingSupplierId, {
          name: supplierForm.name.trim(),
          phone: supplierForm.phone.trim() || null,
          email: supplierForm.email.trim() || null,
          address: supplierForm.address.trim() || null,
        })
      } else {
        await createSupplier(restaurantId, {
          name: supplierForm.name.trim(),
          phone: supplierForm.phone.trim(),
          email: supplierForm.email.trim(),
          address: supplierForm.address.trim(),
        })
      }
      setSupplierForm(EMPTY_SUPPLIER)
      setEditingSupplierId(null)
      setSuppliers(await fetchSuppliers(restaurantId))
    } catch (error) {
      console.error('[Inventory] save supplier failed', error)
      setSupplierError(
        isUniqueViolationError(error)
          ? 'inventory.nameTaken'
          : 'inventory.saveFailed',
      )
    }
  }

  const handleDeleteSupplier = async (supplierId: string) => {
    if (confirmDeleteId !== supplierId) {
      setConfirmDeleteId(supplierId)
      return
    }
    setConfirmDeleteId(null)
    setSupplierError(null)
    try {
      await deleteSupplier(supplierId)
      if (restaurantId) setSuppliers(await fetchSuppliers(restaurantId))
    } catch (error) {
      console.error('[Inventory] delete supplier failed', error)
      setSupplierError('inventory.saveFailed')
    }
  }

  // --- purchase order handlers ---------------------------------------------------------------
  const handleCreatePo = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId) return
    setPoError(null)
    try {
      const lines: PurchaseOrderLineInput[] = poLines.map((line) => ({
        inventoryItemId: line.inventoryItemId,
        quantity: line.quantity,
        unitCost: line.unitCost,
      }))
      await createPurchaseOrder(restaurantId, {
        supplierId: poSupplierId,
        orderDate: poOrderDate,
        notes: poNotes,
        lines,
      })
      setPoSupplierId('')
      setPoOrderDate(new Date().toISOString().slice(0, 10))
      setPoNotes('')
      setPoLines([])
      await reloadPurchaseOrders()
    } catch (error) {
      console.error('[Inventory] create purchase order failed', error)
      const message = error instanceof Error ? error.message : ''
      setPoError(
        message === 'empty_order'
          ? 'inventory.noLines'
          : message === 'supplier_required'
            ? 'inventory.selectSupplier'
            : 'inventory.saveFailed',
      )
    }
  }

  const handleSelectPo = async (poId: string) => {
    setSelectedPoId(poId)
    setPoConfirm(null)
    setPoActionDone(null)
    try {
      setSelectedPo(await fetchPurchaseOrderDetail(poId))
    } catch (error) {
      console.error('[Inventory] load purchase order failed', error)
      setPoError('inventory.loadFailed')
    }
  }

  const handlePoStatus = async (
    to: PurchaseOrder['status'],
    doneKey: string,
  ) => {
    if (!selectedPo) return
    setPoError(null)
    setPoActionDone(null)
    try {
      if (to === 'RECEIVED') {
        await receivePurchaseOrder(selectedPo)
      } else {
        await advancePurchaseOrderStatus(selectedPo, to)
      }
      setPoActionDone(doneKey)
      setPoConfirm(null)
      await reloadPurchaseOrders()
      await reloadItems()
    } catch (error) {
      console.error('[Inventory] purchase order action failed', error)
      const message = error instanceof Error ? error.message : ''
      setPoError(
        message === 'invalid_transition'
          ? 'inventory.invalidTransition'
          : 'inventory.saveFailed',
      )
    }
  }

  const handleDeletePo = async (poId: string) => {
    if (confirmDeleteId !== poId) {
      setConfirmDeleteId(poId)
      return
    }
    setConfirmDeleteId(null)
    setPoError(null)
    try {
      await deletePurchaseOrder(poId)
      if (selectedPoId === poId) {
        setSelectedPoId(null)
        setSelectedPo(null)
      }
      await reloadPurchaseOrders()
    } catch (error) {
      console.error('[Inventory] delete purchase order failed', error)
      setPoError('inventory.saveFailed')
    }
  }

  // --- render states ------------------------------------------------------------------
  if (authLoading || loading) {
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

  if (!restaurant) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('layout.noProfileTitle')}</CardTitle>
          <CardDescription>{t('layout.noProfileBody')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('common.error')}</CardTitle>
          <CardDescription>{t('inventory.loadFailed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => window.location.reload()}>
            {t('common.retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const adjustItem = items.find((item) => item.id === adjustItemId) ?? null

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-bold tracking-tight">
          {t('inventory.title')}
        </h2>
        <p className="text-muted-foreground">{t('inventory.subtitle')}</p>
      </header>

      <div className="flex flex-wrap gap-2">
        {TABS.map((key) => (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={tab === key ? 'default' : 'outline'}
            onClick={() => setTab(key)}
          >
            {t(TAB_KEYS[key])}
          </Button>
        ))}
      </div>

      {tab === 'items' && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingItemId ? t('inventory.editItem') : t('inventory.newItem')}
              </CardTitle>
              <CardDescription>
                {t('inventory.totalStockValue')}:{' '}
                {formatMoney(totalStockValue, currency)}
                {lowStockCount > 0 &&
                  ` · ${t('inventory.lowStock')}: ${lowStockCount}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleItemSubmit}
                className="flex flex-col gap-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="itemName">{t('inventory.itemName')}</Label>
                    <Input
                      id="itemName"
                      value={itemForm.name}
                      onChange={(e) =>
                        setItemForm((prev) => ({ ...prev, name: e.target.value }))
                      }
                      placeholder={t('inventory.itemNamePlaceholder')}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="itemUnit">{t('inventory.unit')}</Label>
                    <Input
                      id="itemUnit"
                      value={itemForm.unit}
                      onChange={(e) =>
                        setItemForm((prev) => ({ ...prev, unit: e.target.value }))
                      }
                      placeholder={t('inventory.unitPlaceholder')}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="itemThreshold">
                      {t('inventory.lowStockThreshold')}
                    </Label>
                    <Input
                      id="itemThreshold"
                      type="number"
                      min={0}
                      step={0.001}
                      value={itemForm.lowStockThreshold}
                      onChange={(e) =>
                        setItemForm((prev) => ({
                          ...prev,
                          lowStockThreshold: Number(e.target.value) || 0,
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('inventory.lowStockThresholdHint')}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="itemCost">{t('inventory.costPrice')}</Label>
                    <Input
                      id="itemCost"
                      type="number"
                      min={0}
                      step={0.01}
                      value={itemForm.costPrice}
                      onChange={(e) =>
                        setItemForm((prev) => ({
                          ...prev,
                          costPrice: Number(e.target.value) || 0,
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {t('inventory.costPriceHint')}
                    </p>
                  </div>
                </div>
                {editingItemId && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={itemForm.isActive}
                      onChange={(e) =>
                        setItemForm((prev) => ({
                          ...prev,
                          isActive: e.target.checked,
                        }))
                      }
                    />
                    {t('inventory.active')}
                  </label>
                )}
                {itemError && (
                  <p
                    role="alert"
                    className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {t(itemError)}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button type="submit">
                    {editingItemId ? t('common.save') : t('inventory.addItem')}
                  </Button>
                  {editingItemId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setItemForm(EMPTY_ITEM)
                        setEditingItemId(null)
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          {adjustItem && (
            <Card>
              <CardHeader>
                <CardTitle>
                  {adjustMode === 'adjust'
                    ? t('inventory.adjustTitle')
                    : t('inventory.wasteTitle')}
                  {': '}
                  {adjustItem.name}
                </CardTitle>
                <CardDescription>
                  {t('inventory.currentQuantity')}:{' '}
                  {formatQty(Number(adjustItem.current_quantity))}{' '}
                  {adjustItem.unit}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={handleAdjustSubmit}
                  className="flex flex-col gap-4"
                >
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={adjustMode === 'adjust' ? 'default' : 'outline'}
                      onClick={() => setAdjustMode('adjust')}
                    >
                      {t('inventory.adjust')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={adjustMode === 'waste' ? 'default' : 'outline'}
                      onClick={() => setAdjustMode('waste')}
                    >
                      {t('inventory.waste')}
                    </Button>
                  </div>
                  {adjustMode === 'adjust' ? (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="adjustDelta">
                        {t('inventory.adjustQuantity')}
                      </Label>
                      <Input
                        id="adjustDelta"
                        type="number"
                        step={0.001}
                        value={adjustDelta}
                        onChange={(e) =>
                          setAdjustDelta(Number(e.target.value) || 0)
                        }
                        required
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('inventory.adjustQuantityHint')}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="wasteQty">
                        {t('inventory.wasteQuantity')}
                      </Label>
                      <Input
                        id="wasteQty"
                        type="number"
                        min={0}
                        step={0.001}
                        value={wasteQty}
                        onChange={(e) =>
                          setWasteQty(Number(e.target.value) || 0)
                        }
                        required
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="adjustReason">
                      {t('inventory.reason')}
                    </Label>
                    <Input
                      id="adjustReason"
                      value={adjustReason}
                      onChange={(e) => setAdjustReason(e.target.value)}
                      placeholder={t('inventory.reasonPlaceholder')}
                      required
                    />
                  </div>
                  {adjustError && (
                    <p
                      role="alert"
                      className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                    >
                      {t(adjustError)}
                    </p>
                  )}
                  {adjustSaved && (
                    <p
                      role="status"
                      className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                    >
                      {t('inventory.adjustSaved')}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button type="submit">{t('common.save')}</Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setAdjustItemId(null)
                        setAdjustReason('')
                        setAdjustSaved(false)
                      }}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('inventory.tabItems')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('inventory.noItems')}
                </p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {items.map((item) => {
                    const qty = Number(item.current_quantity)
                    const isNegative = qty < 0
                    const isLow =
                      !isNegative &&
                      qty <= Number(item.low_stock_threshold)
                    return (
                      <li
                        key={item.id}
                        className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0"
                      >
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">
                            {item.name}
                            {!item.is_active && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                ({t('inventory.inactive')})
                              </span>
                            )}
                          </span>
                          <span
                            className={
                              isNegative
                                ? 'font-semibold text-destructive'
                                : isLow
                                  ? 'font-semibold text-amber-700'
                                  : 'font-medium'
                            }
                          >
                            {formatQty(qty)} {item.unit}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>
                            {t('inventory.lowStockThreshold')}:{' '}
                            {formatQty(Number(item.low_stock_threshold))}{' '}
                            {item.unit}
                            {' · '}
                            {t('inventory.costPrice')}:{' '}
                            {formatMoney(Number(item.cost_price), currency)}
                            {' · '}
                            {t('inventory.stockValue')}:{' '}
                            {formatMoney(
                              qty * Number(item.cost_price),
                              currency,
                            )}
                          </span>
                          <span className="flex gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setAdjustItemId(item.id)
                                setAdjustMode('adjust')
                                setAdjustSaved(false)
                                setAdjustError(null)
                              }}
                            >
                              {t('inventory.adjust')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setAdjustItemId(item.id)
                                setAdjustMode('waste')
                                setAdjustSaved(false)
                                setAdjustError(null)
                              }}
                            >
                              {t('inventory.waste')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setItemForm({
                                  name: item.name,
                                  unit: item.unit,
                                  lowStockThreshold: Number(
                                    item.low_stock_threshold,
                                  ),
                                  costPrice: Number(item.cost_price),
                                  isActive: item.is_active,
                                })
                                setEditingItemId(item.id)
                              }}
                            >
                              {t('common.edit')}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => void handleDeleteItem(item.id)}
                            >
                              {t('common.delete')}
                            </Button>
                          </span>
                        </span>
                        {isNegative && (
                          <span className="text-xs text-destructive">
                            {t('inventory.negativeStock')}:{' '}
                            {t('inventory.negativeStockHint')}
                          </span>
                        )}
                        {isLow && (
                          <span className="text-xs text-amber-700">
                            {t('inventory.lowStock')}
                          </span>
                        )}
                        {confirmDeleteId === item.id && (
                          <span className="text-xs text-destructive">
                            {t('inventory.deleteConfirm')}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'recipes' && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('inventory.tabRecipes')}</CardTitle>
              <CardDescription>
                {selectedRecipeProduct && selectedServings === undefined
                  ? t('inventory.unlimitedServings')
                  : selectedRecipeProduct && selectedServings !== undefined
                    ? t('inventory.servingsAvailable', {
                        count: selectedServings,
                      })
                    : t('inventory.noProductSelected')}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="recipeProduct">
                  {t('inventory.selectProduct')}
                </Label>
                <select
                  id="recipeProduct"
                  value={recipeProductId}
                  onChange={(e) => void handleRecipeProductChange(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">{t('inventory.selectProduct')}</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
              </div>
              {recipeError && (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {t(recipeError)}
                </p>
              )}
              {recipeSaved && (
                <p
                  role="status"
                  className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                >
                  {t('inventory.recipeSaved')}
                </p>
              )}
              {recipeProductId && (
                <>
                  {recipeLines.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('inventory.noRecipe')}
                    </p>
                  ) : (
                    <ul className="flex flex-col divide-y">
                      {recipeLines.map((line) => (
                        <li
                          key={line.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm first:pt-0 last:pb-0"
                        >
                          <span className="font-medium">
                            {line.item.name} ({line.item.unit})
                          </span>
                          <span className="flex items-center gap-2">
                            {editingRecipeId === line.id ? (
                              <>
                                <Input
                                  type="number"
                                  min={0}
                                  step={0.001}
                                  value={editingRecipeQty}
                                  onChange={(e) =>
                                    setEditingRecipeQty(
                                      Number(e.target.value) || 0,
                                    )
                                  }
                                  className="w-24"
                                  aria-label={t('inventory.quantityPerUnit')}
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() =>
                                    void handleUpdateRecipeLine(line.id)
                                  }
                                >
                                  {t('common.save')}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setEditingRecipeId(null)}
                                >
                                  {t('common.cancel')}
                                </Button>
                              </>
                            ) : (
                              <>
                                <span>
                                  {formatQty(Number(line.quantity_per_unit))}{' '}
                                  {line.item.unit}
                                </span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setEditingRecipeId(line.id)
                                    setEditingRecipeQty(
                                      Number(line.quantity_per_unit),
                                    )
                                  }}
                                >
                                  {t('common.edit')}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  onClick={() =>
                                    void handleDeleteRecipeLine(line.id)
                                  }
                                >
                                  {t('common.delete')}
                                </Button>
                              </>
                            )}
                          </span>
                          {confirmDeleteId === line.id && (
                            <span className="w-full text-xs text-destructive">
                              {t('inventory.deleteConfirm')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <form
                    onSubmit={handleAddRecipeLine}
                    className="flex flex-col gap-4 border-t pt-4"
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="newRecipeItem">
                          {t('inventory.ingredient')}
                        </Label>
                        <select
                          id="newRecipeItem"
                          value={newRecipeItemId}
                          onChange={(e) => setNewRecipeItemId(e.target.value)}
                          className={SELECT_CLASS}
                        >
                          <option value="">
                            {t('inventory.ingredient')}
                          </option>
                          {recipeAvailableItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.unit})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="newRecipeQty">
                          {t('inventory.quantityPerUnit')}
                        </Label>
                        <Input
                          id="newRecipeQty"
                          type="number"
                          min={0}
                          step={0.001}
                          value={newRecipeQty}
                          onChange={(e) =>
                            setNewRecipeQty(Number(e.target.value) || 0)
                          }
                          required
                        />
                        <p className="text-xs text-muted-foreground">
                          {t('inventory.quantityPerUnitHint')}
                        </p>
                      </div>
                    </div>
                    <div>
                      <Button type="submit">
                        {t('inventory.addIngredient')}
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                {editingSupplierId
                  ? t('inventory.editSupplier')
                  : t('inventory.newSupplier')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleSupplierSubmit}
                className="flex flex-col gap-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="supplierName">
                      {t('inventory.supplierName')}
                    </Label>
                    <Input
                      id="supplierName"
                      value={supplierForm.name}
                      onChange={(e) =>
                        setSupplierForm((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      placeholder={t('inventory.supplierNamePlaceholder')}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="supplierPhone">
                      {t('inventory.phone')}
                    </Label>
                    <Input
                      id="supplierPhone"
                      value={supplierForm.phone}
                      onChange={(e) =>
                        setSupplierForm((prev) => ({
                          ...prev,
                          phone: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="supplierEmail">
                      {t('inventory.email')}
                    </Label>
                    <Input
                      id="supplierEmail"
                      type="email"
                      value={supplierForm.email}
                      onChange={(e) =>
                        setSupplierForm((prev) => ({
                          ...prev,
                          email: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="supplierAddress">
                      {t('inventory.address')}
                    </Label>
                    <Input
                      id="supplierAddress"
                      value={supplierForm.address}
                      onChange={(e) =>
                        setSupplierForm((prev) => ({
                          ...prev,
                          address: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                {supplierError && (
                  <p
                    role="alert"
                    className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {t(supplierError)}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button type="submit">
                    {editingSupplierId
                      ? t('common.save')
                      : t('inventory.addSupplier')}
                  </Button>
                  {editingSupplierId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setSupplierForm(EMPTY_SUPPLIER)
                        setEditingSupplierId(null)
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
              <CardTitle>{t('inventory.tabSuppliers')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {suppliers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('inventory.noSuppliers')}
                </p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {suppliers.map((supplier) => (
                    <li
                      key={supplier.id}
                      className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0"
                    >
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {supplier.name}
                          {!supplier.is_active && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({t('inventory.inactive')})
                            </span>
                          )}
                        </span>
                        <span className="flex gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSupplierForm({
                                name: supplier.name,
                                phone: supplier.phone ?? '',
                                email: supplier.email ?? '',
                                address: supplier.address ?? '',
                              })
                              setEditingSupplierId(supplier.id)
                            }}
                          >
                            {t('common.edit')}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => void handleDeleteSupplier(supplier.id)}
                          >
                            {t('common.delete')}
                          </Button>
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {[supplier.phone, supplier.email, supplier.address]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </span>
                      {confirmDeleteId === supplier.id && (
                        <span className="text-xs text-destructive">
                          {t('inventory.deleteConfirm')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'purchases' && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('inventory.addPurchaseOrder')}</CardTitle>
              <CardDescription>
                {t('inventory.receivePartialNotImplemented')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreatePo} className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="poSupplier">
                      {t('inventory.supplier')}
                    </Label>
                    <select
                      id="poSupplier"
                      value={poSupplierId}
                      onChange={(e) => setPoSupplierId(e.target.value)}
                      className={SELECT_CLASS}
                      required
                    >
                      <option value="">
                        {t('inventory.selectSupplier')}
                      </option>
                      {suppliers
                        .filter((supplier) => supplier.is_active)
                        .map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="poDate">{t('inventory.orderDate')}</Label>
                    <Input
                      id="poDate"
                      type="date"
                      value={poOrderDate}
                      onChange={(e) => setPoOrderDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="poNotes">{t('inventory.notes')}</Label>
                    <Input
                      id="poNotes"
                      value={poNotes}
                      onChange={(e) => setPoNotes(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t('inventory.items')}</Label>
                  {poLines.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('inventory.noLines')}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {poLines.map((line) => {
                        const item = itemById.get(line.inventoryItemId)
                        return (
                          <li
                            key={line.key}
                            className="flex flex-wrap items-center gap-2 text-sm"
                          >
                            <span className="min-w-32 font-medium">
                              {item?.name ?? '—'} ({item?.unit ?? ''})
                            </span>
                            <span>
                              {formatQty(line.quantity)} ×{' '}
                              {formatMoney(line.unitCost, currency)}
                            </span>
                            <span className="font-medium">
                              {formatMoney(
                                line.quantity * line.unitCost,
                                currency,
                              )}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() =>
                                setPoLines((prev) =>
                                  prev.filter((l) => l.key !== line.key),
                                )
                              }
                            >
                              {t('common.delete')}
                            </Button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <PoLineAdder
                    items={items}
                    usedItemIds={new Set(
                      poLines.map((line) => line.inventoryItemId),
                    )}
                    onAdd={(line) =>
                      setPoLines((prev) => [...prev, line])
                    }
                  />
                </div>
                <p className="text-sm font-medium">
                  {t('inventory.total')}: {formatMoney(poFormTotal, currency)}
                </p>
                {poError && (
                  <p
                    role="alert"
                    className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {t(poError)}
                  </p>
                )}
                <div>
                  <Button type="submit">
                    {t('inventory.addPurchaseOrder')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('inventory.tabPurchases')}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {purchaseOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('inventory.noPurchaseOrders')}
                </p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {purchaseOrders.map((order) => (
                    <li
                      key={order.id}
                      className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0"
                    >
                      <button
                        type="button"
                        onClick={() => void handleSelectPo(order.id)}
                        className="flex flex-wrap items-center justify-between gap-2 text-left"
                      >
                        <span className="font-medium">
                          {supplierById.get(order.supplier_id)?.name ?? '—'}
                          {' · '}
                          {order.order_date}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {t(PO_STATUS_KEYS[order.status])}
                          </span>
                          <span className="font-medium">
                            {formatMoney(Number(order.total_amount), currency)}
                          </span>
                        </span>
                      </button>
                      {selectedPoId === order.id && selectedPo && (
                        <span className="mt-2 flex flex-col gap-3 rounded-md border p-3">
                          <span className="flex flex-col gap-1">
                            {selectedPo.items.map((line) => (
                              <span
                                key={line.id}
                                className="flex flex-wrap justify-between gap-2"
                              >
                                <span>
                                  {line.item_name} ({line.item_unit})
                                </span>
                                <span>
                                  {t('inventory.quantity')}:{' '}
                                  {formatQty(Number(line.quantity))}
                                  {' · '}
                                  {t('inventory.receivedQuantity')}:{' '}
                                  {formatQty(Number(line.received_quantity))}
                                  {' · '}
                                  {formatMoney(Number(line.unit_cost), currency)}
                                </span>
                              </span>
                            ))}
                          </span>
                          {selectedPo.notes && (
                            <span className="text-xs text-muted-foreground">
                              {selectedPo.notes}
                            </span>
                          )}
                          {poActionDone && (
                            <span
                              role="status"
                              className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
                            >
                              {t(poActionDone)}
                            </span>
                          )}
                          <span className="flex flex-wrap gap-2">
                            {selectedPo.status === 'DRAFT' && (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  void handlePoStatus(
                                    'ORDERED',
                                    'inventory.ordered',
                                  )
                                }
                              >
                                {t('inventory.markOrdered')}
                              </Button>
                            )}
                            {selectedPo.status === 'ORDERED' && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => setPoConfirm('receive')}
                                >
                                  {t('inventory.receiveAll')}
                                </Button>
                                {poConfirm === 'receive' && (
                                  <span className="flex w-full flex-col gap-2 text-xs">
                                    <span className="text-muted-foreground">
                                      {t('inventory.receiveConfirm')}
                                    </span>
                                    <span className="flex gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        onClick={() =>
                                          void handlePoStatus(
                                            'RECEIVED',
                                            'inventory.received',
                                          )
                                        }
                                      >
                                        {t('inventory.receiveAll')}
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setPoConfirm(null)}
                                      >
                                        {t('common.cancel')}
                                      </Button>
                                    </span>
                                  </span>
                                )}
                              </>
                            )}
                            {(selectedPo.status === 'DRAFT' ||
                              selectedPo.status === 'ORDERED') && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setPoConfirm('cancel')}
                                >
                                  {t('inventory.cancelOrder')}
                                </Button>
                                {poConfirm === 'cancel' && (
                                  <span className="flex gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="destructive"
                                      onClick={() =>
                                        void handlePoStatus(
                                          'CANCELLED',
                                          'inventory.cancelled',
                                        )
                                      }
                                    >
                                      {t('inventory.cancelOrder')}
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setPoConfirm(null)}
                                    >
                                      {t('common.cancel')}
                                    </Button>
                                  </span>
                                )}
                              </>
                            )}
                            {selectedPo.status === 'DRAFT' && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => void handleDeletePo(order.id)}
                              >
                                {t('common.delete')}
                              </Button>
                            )}
                          </span>
                          {confirmDeleteId === order.id && (
                            <span className="text-xs text-destructive">
                              {t('inventory.deleteConfirm')}
                            </span>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'movements' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('inventory.tabMovements')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('inventory.noMovements')}
              </p>
            ) : (
              <ul className="flex flex-col divide-y">
                {movements.map((movement) => (
                  <li
                    key={movement.id}
                    className="flex flex-col gap-1 py-3 text-sm first:pt-0 last:pb-0"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {movement.item_name}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {t(MOVEMENT_TYPE_KEYS[movement.movement_type])}
                        </span>
                      </span>
                      <span
                        className={
                          Number(movement.quantity_change) > 0
                            ? 'font-semibold text-emerald-700'
                            : 'font-semibold text-destructive'
                        }
                      >
                        {Number(movement.quantity_change) > 0 ? '+' : ''}
                        {formatQty(Number(movement.quantity_change))}{' '}
                        {movement.item_unit}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(movement.created_at)}
                      {movement.reason ? ` · ${movement.reason}` : ''}
                      {movement.reference_type
                        ? ` · ${t('inventory.reference')}: ${movement.reference_type}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// --- purchase-order line adder (small local form) ------------------------------

/** One line of a new purchase order: pick an item, quantity, unit cost. */
function PoLineAdder({
  items,
  usedItemIds,
  onAdd,
}: {
  items: InventoryItem[]
  usedItemIds: Set<string>
  onAdd: (line: PoLineForm) => void
}) {
  const { t } = useTranslation()
  const [itemId, setItemId] = useState('')
  const [quantity, setQuantity] = useState(0)
  const [unitCost, setUnitCost] = useState(0)

  const availableItems = items.filter(
    (item) => item.is_active && !usedItemIds.has(item.id),
  )

  // NOTE: this is intentionally NOT a <form> — PoLineAdder renders inside
  // the purchase-order <form>, and nested forms are invalid HTML: the
  // browser drops the inner form and the "Add line" button submits the
  // outer form instead (which used to navigate away to /inventory?).
  const handleAdd = () => {
    if (!itemId || quantity <= 0 || unitCost < 0) return
    onAdd({
      key: crypto.randomUUID(),
      inventoryItemId: itemId,
      quantity,
      unitCost,
    })
    setItemId('')
    setQuantity(0)
    setUnitCost(0)
  }

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          handleAdd()
        }
      }}
      className="grid gap-2 sm:grid-cols-[1fr_120px_140px_auto]"
    >
      <select
        value={itemId}
        onChange={(e) => setItemId(e.target.value)}
        className={SELECT_CLASS}
        aria-label={t('inventory.ingredient')}
        required
      >
        <option value="">{t('inventory.ingredient')}</option>
        {availableItems.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} ({item.unit})
          </option>
        ))}
      </select>
      <Input
        type="number"
        min={0}
        step={0.001}
        value={quantity}
        onChange={(e) => setQuantity(Number(e.target.value) || 0)}
        placeholder={t('inventory.quantity')}
        aria-label={t('inventory.quantity')}
        required
      />
      <Input
        type="number"
        min={0}
        step={0.01}
        value={unitCost}
        onChange={(e) => setUnitCost(Number(e.target.value) || 0)}
        placeholder={t('inventory.unitCost')}
        aria-label={t('inventory.unitCost')}
        required
      />
      <Button type="button" size="sm" onClick={handleAdd}>
        {t('inventory.addLine')}
      </Button>
    </div>
  )
}
