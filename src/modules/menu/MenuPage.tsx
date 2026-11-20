// FoodX — Menu page (protected).
// Categories, products (with variants + offered modifiers), kitchen
// stations and modifiers for the current restaurant. All data loads in
// parallel on mount; every mutation re-fetches the affected list.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { isMissingTableError } from '@/lib/errors'
import { formatMoney, roundMoney } from '@/lib/money'
import { useAuth } from '@/hooks/useAuth'
import { useEasyMode } from '@/hooks/useEasyMode'
import { UploadError, uploadProductImage } from '@/services/uploads'
import {
  createCategory,
  createModifier,
  createProduct,
  createStation,
  createVariant,
  deleteCategory,
  deleteModifier,
  deleteProduct,
  deleteStation,
  deleteVariant,
  fetchCategories,
  fetchModifiers,
  fetchProductsWithDetails,
  fetchStations,
  fetchVariants,
  setProductModifiers,
  updateCategory,
  updateModifier,
  updateProduct,
  updateStation,
} from '@/services/menu'
import type {
  Category,
  KitchenStation,
  Modifier,
  ProductVariant,
  ProductWithDetails,
} from '@/types'
import EasyConfirmNote from '@/components/EasyConfirmNote'
import EasyHelpLine from '@/components/EasyHelpLine'
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

interface CategoryForm {
  name: string
  nameBn: string
  sortOrder: number
}

interface StationForm {
  name: string
  sortOrder: number
}

interface ModifierForm {
  name: string
  nameBn: string
  // Money inputs stay STRINGS in form state: a number input's value goes
  // through binary floats, so a typed "50" could arrive as
  // 49.970001220703125. Parse + round only on submit (see roundMoney).
  // The inputs themselves are type="text" with inputMode="decimal" for
  // the same reason — a type="number" input mangled a filled "30" into
  // 29.969999313354492 before React ever saw it. Do not switch them
  // back to type="number".
  price: string
}

interface ProductForm {
  name: string
  nameBn: string
  description: string
  price: string
  costPrice: string
  categoryId: string
  stationId: string
  imageUrl: string
  sortOrder: number
}

const EMPTY_CATEGORY: CategoryForm = { name: '', nameBn: '', sortOrder: 0 }
const EMPTY_STATION: StationForm = { name: '', sortOrder: 0 }
const EMPTY_MODIFIER: ModifierForm = { name: '', nameBn: '', price: '' }
const EMPTY_PRODUCT: ProductForm = {
  name: '',
  nameBn: '',
  description: '',
  price: '',
  costPrice: '',
  categoryId: '',
  stationId: '',
  imageUrl: '',
  sortOrder: 0,
}

export default function MenuPage() {
  const { t } = useTranslation()
  const { easy } = useEasyMode()
  const { loading: authLoading, restaurant, settings } = useAuth()
  const restaurantId = restaurant?.id
  const currency = settings?.currency ?? 'BDT'

  const [loading, setLoading] = useState(true)
  const [dbPending, setDbPending] = useState(false)
  const [loadError, setLoadError] = useState(false)

  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<ProductWithDetails[]>([])
  const [stations, setStations] = useState<KitchenStation[]>([])
  const [modifiers, setModifiers] = useState<Modifier[]>([])

  const [categoryError, setCategoryError] = useState<string | null>(null)
  const [productError, setProductError] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const imageFileRef = useRef<HTMLInputElement | null>(null)

  // Item 5: upload fills the same image_url field a pasted link
  // uses — the last action wins, and Save persists whichever URL
  // is in the field.
  const handleImageFile = async (file: File | undefined) => {
    if (!file || !restaurantId) return
    setProductError(null)
    setUploadingImage(true)
    try {
      const url = await uploadProductImage(restaurantId, file)
      setProductForm((prev) => ({ ...prev, imageUrl: url }))
    } catch (error) {
      if (error instanceof UploadError) {
        setProductError(
          error.code === 'upload_bad_type'
            ? 'menu.uploadBadType'
            : error.code === 'upload_too_large'
              ? 'menu.uploadTooLarge'
              : 'menu.uploadFailed',
        )
      } else {
        setProductError('menu.uploadFailed')
      }
    } finally {
      setUploadingImage(false)
    }
  }
  const [stationError, setStationError] = useState<string | null>(null)
  const [modifierError, setModifierError] = useState<string | null>(null)

  // Two-step delete: the id awaiting its confirming click (ids are
  // UUIDs, unique across tables, so one shared state is enough).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // Easy mode only (wave E2; design §9): hiding a product also
  // becomes a two-step action with a big plain-language warning —
  // the id whose first click has armed the confirmation. Never
  // set outside easy mode, so the normal panel is unchanged.
  const [confirmHideId, setConfirmHideId] = useState<string | null>(null)

  // --- category form -------------------------------------------------------
  const [categoryForm, setCategoryForm] = useState<CategoryForm>(EMPTY_CATEGORY)
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null)

  // --- product form --------------------------------------------------------
  const [productFilter, setProductFilter] = useState('')
  const [productForm, setProductForm] = useState<ProductForm>(EMPTY_PRODUCT)
  const [editingProductId, setEditingProductId] = useState<string | null>(null)
  const [productFormOpen, setProductFormOpen] = useState(false)
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([])
  const [variants, setVariants] = useState<ProductVariant[]>([])
  const [newVariantName, setNewVariantName] = useState('')
  const [newVariantAdjustment, setNewVariantAdjustment] = useState('')

  // --- station form --------------------------------------------------------
  const [stationForm, setStationForm] = useState<StationForm>(EMPTY_STATION)
  const [editingStationId, setEditingStationId] = useState<string | null>(null)

  // --- modifier form -------------------------------------------------------
  const [modifierForm, setModifierForm] = useState<ModifierForm>(EMPTY_MODIFIER)
  const [editingModifierId, setEditingModifierId] = useState<string | null>(null)

  // --- loading -------------------------------------------------------------
  useEffect(() => {
    if (authLoading || !restaurantId) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setLoadError(false)
      setDbPending(false)
      try {
        const [cats, prods, stats, mods] = await Promise.all([
          fetchCategories(restaurantId),
          fetchProductsWithDetails(restaurantId),
          fetchStations(restaurantId),
          fetchModifiers(restaurantId),
        ])
        if (cancelled) return
        setCategories(cats)
        setProducts(prods)
        setStations(stats)
        setModifiers(mods)
      } catch (error) {
        console.error('[Menu] load failed', error)
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

  const reloadCategories = async () => {
    if (!restaurantId) return
    setCategories(await fetchCategories(restaurantId))
  }
  const reloadProducts = async () => {
    if (!restaurantId) return
    setProducts(await fetchProductsWithDetails(restaurantId))
  }
  const reloadStations = async () => {
    if (!restaurantId) return
    setStations(await fetchStations(restaurantId))
  }
  const reloadModifiers = async () => {
    if (!restaurantId) return
    setModifiers(await fetchModifiers(restaurantId))
  }

  // --- categories ----------------------------------------------------------
  const handleCategorySubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId) return
    setCategoryError(null)
    try {
      if (editingCategoryId) {
        await updateCategory(editingCategoryId, {
          name: categoryForm.name.trim(),
          name_bn: categoryForm.nameBn.trim() || null,
          sort_order: categoryForm.sortOrder,
        })
      } else {
        await createCategory(restaurantId, {
          name: categoryForm.name.trim(),
          nameBn: categoryForm.nameBn.trim() || undefined,
          sortOrder: categoryForm.sortOrder,
        })
      }
      await reloadCategories()
      setCategoryForm(EMPTY_CATEGORY)
      setEditingCategoryId(null)
    } catch (error) {
      console.error('[Menu] save category failed', error)
      setCategoryError('menu.saveFailed')
    }
  }

  const handleCategoryDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      return
    }
    setConfirmDeleteId(null)
    setCategoryError(null)
    try {
      await deleteCategory(id)
      await reloadCategories()
    } catch (error) {
      console.error('[Menu] delete category failed', error)
      setCategoryError('menu.deleteFailed')
    }
  }

  const handleCategoryToggle = async (category: Category) => {
    setCategoryError(null)
    try {
      await updateCategory(category.id, { is_active: !category.is_active })
      await reloadCategories()
    } catch (error) {
      console.error('[Menu] toggle category failed', error)
      setCategoryError('menu.saveFailed')
    }
  }

  // --- products ------------------------------------------------------------
  const openNewProduct = () => {
    setProductForm(EMPTY_PRODUCT)
    setEditingProductId(null)
    setSelectedModifierIds([])
    setVariants([])
    setNewVariantName('')
    setNewVariantAdjustment('')
    setProductError(null)
    setProductFormOpen(true)
  }

  const openEditProduct = (product: ProductWithDetails) => {
    setProductForm({
      name: product.name,
      nameBn: product.name_bn ?? '',
      description: product.description ?? '',
      price: String(product.price),
      costPrice:
        product.cost_price === null || product.cost_price === undefined
          ? ''
          : String(product.cost_price),
      categoryId: product.category_id ?? '',
      stationId: product.kitchen_station_id ?? '',
      imageUrl: product.image_url ?? '',
      sortOrder: product.sort_order,
    })
    setEditingProductId(product.id)
    setSelectedModifierIds(product.modifiers.map((m) => m.id))
    setVariants(product.variants)
    setNewVariantName('')
    setNewVariantAdjustment('')
    setProductError(null)
    setProductFormOpen(true)
  }

  const handleProductSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId) return
    setProductError(null)
    try {
      const values = {
        categoryId: productForm.categoryId || null,
        kitchenStationId: productForm.stationId || null,
        name: productForm.name.trim(),
        nameBn: productForm.nameBn.trim() || undefined,
        description: productForm.description.trim() || undefined,
        price: roundMoney(parseFloat(productForm.price) || 0),
        costPrice:
          productForm.costPrice.trim() === ''
            ? null
            : roundMoney(parseFloat(productForm.costPrice) || 0),
        imageUrl: productForm.imageUrl.trim() || undefined,
        sortOrder: productForm.sortOrder,
      }
      let productId = editingProductId
      if (productId) {
        // updateProduct takes DB (snake_case) keys — passing the
        // camelCase form values sent unknown columns and every edit
        // failed. Map them here; createProduct maps internally.
        await updateProduct(productId, {
          category_id: values.categoryId,
          kitchen_station_id: values.kitchenStationId,
          name: values.name,
          // Cleared text fields must send an explicit null —
          // supabase-js drops undefined keys from the update, so
          // `|| undefined` would silently keep the old value
          // (this is why removing a product image did not stick).
          name_bn: values.nameBn ?? null,
          description: values.description ?? null,
          price: values.price,
          cost_price: values.costPrice,
          image_url: values.imageUrl ?? null,
          sort_order: values.sortOrder,
        })
      } else {
        const created = await createProduct(restaurantId, values)
        productId = created.id
      }
      await setProductModifiers(productId, selectedModifierIds)
      await reloadProducts()
      setProductFormOpen(false)
      setEditingProductId(null)
      setProductForm(EMPTY_PRODUCT)
      setSelectedModifierIds([])
      setVariants([])
    } catch (error) {
      console.error('[Menu] save product failed', error)
      setProductError('menu.saveFailed')
    }
  }

  const handleProductDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      return
    }
    setConfirmDeleteId(null)
    setProductError(null)
    try {
      await deleteProduct(id)
      await reloadProducts()
    } catch (error) {
      console.error('[Menu] delete product failed', error)
      setProductError('menu.deleteFailed')
    }
  }

  const handleProductToggle = async (product: ProductWithDetails) => {
    setProductError(null)
    try {
      await updateProduct(product.id, { is_available: !product.is_available })
      await reloadProducts()
    } catch (error) {
      console.error('[Menu] toggle product failed', error)
      setProductError('menu.saveFailed')
    }
  }

  // Availability toggle click. In easy mode, HIDING a product
  // (available → unavailable) asks first: the first click only
  // arms the big warning (confirmHideId), the second performs the
  // toggle. Showing a product again, and every click in the
  // normal panel, goes straight through as before.
  const handleProductToggleClick = (product: ProductWithDetails) => {
    if (easy && product.is_available && confirmHideId !== product.id) {
      setConfirmHideId(product.id)
      return
    }
    setConfirmHideId(null)
    void handleProductToggle(product)
  }

  const handleVariantAdd = async () => {
    if (!editingProductId || !newVariantName.trim()) return
    setProductError(null)
    try {
      await createVariant(editingProductId, {
        name: newVariantName.trim(),
        priceAdjustment: roundMoney(parseFloat(newVariantAdjustment) || 0),
        sortOrder: variants.length,
      })
      setVariants(await fetchVariants(editingProductId))
      setNewVariantName('')
      setNewVariantAdjustment('')
      await reloadProducts()
    } catch (error) {
      console.error('[Menu] add variant failed', error)
      setProductError('menu.saveFailed')
    }
  }

  const handleVariantDelete = async (variantId: string) => {
    if (!editingProductId) return
    setProductError(null)
    try {
      await deleteVariant(variantId)
      setVariants(await fetchVariants(editingProductId))
      await reloadProducts()
    } catch (error) {
      console.error('[Menu] delete variant failed', error)
      setProductError('menu.deleteFailed')
    }
  }

  const toggleModifierForProduct = (modifierId: string) => {
    setSelectedModifierIds((prev) =>
      prev.includes(modifierId)
        ? prev.filter((id) => id !== modifierId)
        : [...prev, modifierId],
    )
  }

  // --- stations ------------------------------------------------------------
  const handleStationSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId) return
    setStationError(null)
    try {
      if (editingStationId) {
        await updateStation(editingStationId, {
          name: stationForm.name.trim(),
          sort_order: stationForm.sortOrder,
        })
      } else {
        await createStation(restaurantId, {
          name: stationForm.name.trim(),
          sortOrder: stationForm.sortOrder,
        })
      }
      await reloadStations()
      setStationForm(EMPTY_STATION)
      setEditingStationId(null)
    } catch (error) {
      console.error('[Menu] save station failed', error)
      setStationError('menu.saveFailed')
    }
  }

  const handleStationDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      return
    }
    setConfirmDeleteId(null)
    setStationError(null)
    try {
      await deleteStation(id)
      await reloadStations()
    } catch (error) {
      console.error('[Menu] delete station failed', error)
      setStationError('menu.deleteFailed')
    }
  }

  const handleStationToggle = async (station: KitchenStation) => {
    setStationError(null)
    try {
      await updateStation(station.id, { is_active: !station.is_active })
      await reloadStations()
    } catch (error) {
      console.error('[Menu] toggle station failed', error)
      setStationError('menu.saveFailed')
    }
  }

  // --- modifiers -----------------------------------------------------------
  const handleModifierSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!restaurantId) return
    setModifierError(null)
    try {
      if (editingModifierId) {
        await updateModifier(editingModifierId, {
          name: modifierForm.name.trim(),
          name_bn: modifierForm.nameBn.trim() || null,
          price: roundMoney(parseFloat(modifierForm.price) || 0),
        })
      } else {
        await createModifier(restaurantId, {
          name: modifierForm.name.trim(),
          nameBn: modifierForm.nameBn.trim() || undefined,
          price: roundMoney(parseFloat(modifierForm.price) || 0),
        })
      }
      await reloadModifiers()
      setModifierForm(EMPTY_MODIFIER)
      setEditingModifierId(null)
    } catch (error) {
      console.error('[Menu] save modifier failed', error)
      setModifierError('menu.saveFailed')
    }
  }

  const handleModifierDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      return
    }
    setConfirmDeleteId(null)
    setModifierError(null)
    try {
      await deleteModifier(id)
      await reloadModifiers()
    } catch (error) {
      console.error('[Menu] delete modifier failed', error)
      setModifierError('menu.deleteFailed')
    }
  }

  const handleModifierToggle = async (modifier: Modifier) => {
    setModifierError(null)
    try {
      await updateModifier(modifier.id, { is_active: !modifier.is_active })
      await reloadModifiers()
    } catch (error) {
      console.error('[Menu] toggle modifier failed', error)
      setModifierError('menu.saveFailed')
    }
  }

  // --- states --------------------------------------------------------------
  if (authLoading || loading) {
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

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('common.error')}</CardTitle>
          <CardDescription>{t('menu.loadFailed')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => window.location.reload()}>
            {t('common.retry')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const categoryName = (id: string | null) =>
    categories.find((c) => c.id === id)?.name ?? t('menu.uncategorised')
  const stationName = (id: string | null) =>
    stations.find((s) => s.id === id)?.name ?? t('menu.noStation')
  const visibleProducts = productFilter
    ? products.filter((p) => p.category_id === productFilter)
    : products

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-2xl font-bold tracking-tight">{t('menu.title')}</h2>
        <p className="text-muted-foreground">{t('menu.subtitle')}</p>
        <EasyHelpLine labelKey="easy.help.menu" />
      </header>

      {/* Categories */}
      <Card>
        <CardHeader>
          <CardTitle>{t('menu.categoriesTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('menu.noCategories')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {categories.map((category) => (
                <li key={category.id} className="flex flex-col gap-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {category.name}
                      {category.name_bn ? ` (${category.name_bn})` : ''}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      #{category.sort_order}
                    </span>
                    <span
                      className={
                        category.is_active
                          ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900'
                          : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                      }
                    >
                      {category.is_active ? t('menu.active') : t('menu.inactive')}
                    </span>
                    <span className="ml-auto flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingCategoryId(category.id)
                          setCategoryForm({
                            name: category.name,
                            nameBn: category.name_bn ?? '',
                            sortOrder: category.sort_order,
                          })
                          setCategoryError(null)
                        }}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleCategoryToggle(category)}
                      >
                        {category.is_active ? t('menu.inactive') : t('menu.active')}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleCategoryDelete(category.id)}
                      >
                        {confirmDeleteId === category.id
                          ? t('menu.deleteConfirm')
                          : t('common.delete')}
                      </Button>
                    </span>
                  </div>
                  {editingCategoryId === category.id && (
                    <form
                      onSubmit={handleCategorySubmit}
                      className="flex flex-col gap-3 rounded-lg border p-3"
                    >
                      <p className="text-sm font-medium">
                        {t('menu.editCategory')}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="flex flex-col gap-2">
                          <Label htmlFor={`cat-name-${category.id}`}>
                            {t('menu.categoryName')}
                          </Label>
                          <Input
                            id={`cat-name-${category.id}`}
                            value={categoryForm.name}
                            onChange={(e) =>
                              setCategoryForm((prev) => ({
                                ...prev,
                                name: e.target.value,
                              }))
                            }
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor={`cat-name-bn-${category.id}`}>
                            {t('menu.categoryNameBn')}
                          </Label>
                          <Input
                            id={`cat-name-bn-${category.id}`}
                            value={categoryForm.nameBn}
                            onChange={(e) =>
                              setCategoryForm((prev) => ({
                                ...prev,
                                nameBn: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor={`cat-sort-${category.id}`}>
                            {t('menu.sortOrder')}
                          </Label>
                          <Input
                            id={`cat-sort-${category.id}`}
                            type="number"
                            value={categoryForm.sortOrder}
                            onChange={(e) =>
                              setCategoryForm((prev) => ({
                                ...prev,
                                sortOrder: Number(e.target.value) || 0,
                              }))
                            }
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button type="submit" size="sm">
                          {t('common.save')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingCategoryId(null)
                            setCategoryForm(EMPTY_CATEGORY)
                          }}
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!editingCategoryId && (
            <form
              onSubmit={handleCategorySubmit}
              className="flex flex-col gap-3 rounded-lg border p-3"
            >
              <p className="text-sm font-medium">{t('menu.addCategory')}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-category-name">{t('menu.categoryName')}</Label>
                <Input
                  id="new-category-name"
                  value={categoryForm.name}
                  onChange={(e) =>
                    setCategoryForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-category-name-bn">
                  {t('menu.categoryNameBn')}
                </Label>
                <Input
                  id="new-category-name-bn"
                  value={categoryForm.nameBn}
                  onChange={(e) =>
                    setCategoryForm((prev) => ({
                      ...prev,
                      nameBn: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-category-sort">{t('menu.sortOrder')}</Label>
                <Input
                  id="new-category-sort"
                  type="number"
                  value={categoryForm.sortOrder}
                  onChange={(e) =>
                    setCategoryForm((prev) => ({
                      ...prev,
                      sortOrder: Number(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>
              <div>
                <Button type="submit" size="sm">
                  {t('menu.addCategory')}
                </Button>
              </div>
            </form>
          )}
          {categoryError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t(categoryError)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Products */}
      <Card>
        <CardHeader>
          <CardTitle>{t('menu.productsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="product-filter">{t('menu.selectCategory')}</Label>
            <select
              id="product-filter"
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">{t('menu.selectCategory')}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" onClick={openNewProduct}>
              {t('menu.addProduct')}
            </Button>
          </div>

          {visibleProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('menu.noProducts')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {visibleProducts.map((product) => (
                <li key={product.id} className="flex flex-wrap items-center gap-2 py-3">
                  <span className="font-medium">
                    {product.name}
                    {product.name_bn ? ` (${product.name_bn})` : ''}
                  </span>
                  <span className="text-sm">
                    {formatMoney(Number(product.price), currency)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {categoryName(product.category_id)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {stationName(product.kitchen_station_id)}
                  </span>
                  <span
                    className={
                      product.is_available
                        ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900'
                        : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                    }
                  >
                    {product.is_available ? t('menu.available') : t('menu.unavailable')}
                  </span>
                  <span className="ml-auto flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEditProduct(product)}
                    >
                      {t('common.edit')}
                    </Button>
                    <Button
                      type="button"
                      variant={
                        confirmHideId === product.id ? 'destructive' : 'outline'
                      }
                      size="sm"
                      onClick={() => handleProductToggleClick(product)}
                    >
                      {product.is_available ? t('menu.unavailable') : t('menu.available')}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleProductDelete(product.id)}
                    >
                      {confirmDeleteId === product.id
                        ? t('menu.deleteConfirm')
                        : t('common.delete')}
                    </Button>
                  </span>
                  {confirmHideId === product.id && (
                    <EasyConfirmNote
                      className="basis-full"
                      text={t('easy.confirm.hideProduct', {
                        name: product.name,
                      })}
                    />
                  )}
                  {confirmDeleteId === product.id && (
                    <EasyConfirmNote
                      className="basis-full"
                      text={t('easy.confirm.deleteProduct', {
                        name: product.name,
                      })}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {productFormOpen && (
            <form
              onSubmit={handleProductSubmit}
              className="flex flex-col gap-4 rounded-lg border p-3"
            >
              <p className="text-sm font-medium">
                {editingProductId ? t('menu.editProduct') : t('menu.newProduct')}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-name">{t('menu.productName')}</Label>
                  <Input
                    id="product-name"
                    value={productForm.name}
                    onChange={(e) =>
                      setProductForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-name-bn">{t('menu.productNameBn')}</Label>
                  <Input
                    id="product-name-bn"
                    value={productForm.nameBn}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        nameBn: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <Label htmlFor="product-description">{t('menu.description')}</Label>
                  <Input
                    id="product-description"
                    value={productForm.description}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        description: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-price">{t('menu.price')}</Label>
                  <Input
                    id="product-price"
                    type="text"
                    inputMode="decimal"
                    value={productForm.price}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        price: e.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-cost">{t('menu.costPrice')}</Label>
                  <Input
                    id="product-cost"
                    type="text"
                    inputMode="decimal"
                    value={productForm.costPrice}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        costPrice: e.target.value,
                      }))
                    }
                    placeholder={t('menu.costPriceHint')}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-sort">{t('menu.sortOrder')}</Label>
                  <Input
                    id="product-sort"
                    type="number"
                    value={productForm.sortOrder}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        sortOrder: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-category">{t('menu.category')}</Label>
                  <select
                    id="product-category"
                    value={productForm.categoryId}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        categoryId: e.target.value,
                      }))
                    }
                    className={SELECT_CLASS}
                  >
                    <option value="">{t('menu.uncategorised')}</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="product-station">{t('menu.station')}</Label>
                  <select
                    id="product-station"
                    value={productForm.stationId}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        stationId: e.target.value,
                      }))
                    }
                    className={SELECT_CLASS}
                  >
                    <option value="">{t('menu.noStation')}</option>
                    {stations.map((station) => (
                      <option key={station.id} value={station.id}>
                        {station.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <Label htmlFor="product-image">{t('menu.imageUrl')}</Label>
                  <Input
                    id="product-image"
                    type="url"
                    value={productForm.imageUrl}
                    onChange={(e) =>
                      setProductForm((prev) => ({
                        ...prev,
                        imageUrl: e.target.value,
                      }))
                    }
                    placeholder={t('menu.imageUrlPlaceholder')}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    {productForm.imageUrl.trim() && (
                      <img
                        src={productForm.imageUrl.trim()}
                        alt=""
                        className="h-16 w-16 rounded-md border object-cover"
                      />
                    )}
                    <input
                      ref={imageFileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        void handleImageFile(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingImage}
                      onClick={() => imageFileRef.current?.click()}
                    >
                      {uploadingImage
                        ? t('menu.uploadingImage')
                        : t('menu.uploadImage')}
                    </Button>
                    {productForm.imageUrl.trim() && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setProductForm((prev) => ({ ...prev, imageUrl: '' }))
                        }
                      >
                        {t('menu.removeImage')}
                      </Button>
                    )}
                  </div>
                </div>
              </div>

              {/* Variants — only for a product that already exists. */}
              {editingProductId && (
                <div className="flex flex-col gap-3 rounded-lg border p-3">
                  <p className="text-sm font-medium">{t('menu.variants')}</p>
                  {variants.length > 0 && (
                    <ul className="flex flex-col divide-y">
                      {variants.map((variant) => (
                        <li
                          key={variant.id}
                          className="flex flex-wrap items-center gap-2 py-2"
                        >
                          <span className="font-medium">{variant.name}</span>
                          <span className="text-sm">
                            {formatMoney(
                              Number(productForm.price) +
                                Number(variant.price_adjustment),
                              currency,
                            )}{' '}
                            ({Number(variant.price_adjustment) >= 0 ? '+' : ''}
                            {formatMoney(Number(variant.price_adjustment), currency)})
                          </span>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="ml-auto"
                            onClick={() => void handleVariantDelete(variant.id)}
                          >
                            {t('common.delete')}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="variant-name">{t('menu.variantName')}</Label>
                      <Input
                        id="variant-name"
                        value={newVariantName}
                        onChange={(e) => setNewVariantName(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="variant-adjustment">
                        {t('menu.priceAdjustment')}
                      </Label>
                      <Input
                        id="variant-adjustment"
                        type="text"
                        inputMode="decimal"
                        value={newVariantAdjustment}
                        onChange={(e) =>
                          setNewVariantAdjustment(e.target.value)
                        }
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        size="sm"
                        disabled={!newVariantName.trim()}
                        onClick={() => void handleVariantAdd()}
                      >
                        {t('menu.addVariant')}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Offered modifiers */}
              <div className="flex flex-col gap-3 rounded-lg border p-3">
                <p className="text-sm font-medium">{t('menu.offeredModifiers')}</p>
                {modifiers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('menu.noModifiers')}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {modifiers.map((modifier) => (
                      <label
                        key={modifier.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedModifierIds.includes(modifier.id)}
                          onChange={() => toggleModifierForProduct(modifier.id)}
                        />
                        {modifier.name} (
                        {formatMoney(Number(modifier.price), currency)})
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button type="submit" size="sm">
                  {t('common.save')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setProductFormOpen(false)
                    setEditingProductId(null)
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          )}
          {productError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t(productError)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Kitchen stations */}
      <Card>
        <CardHeader>
          <CardTitle>{t('menu.stationsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {stations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('menu.noStations')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {stations.map((station) => (
                <li key={station.id} className="flex flex-col gap-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{station.name}</span>
                    <span className="text-xs text-muted-foreground">
                      #{station.sort_order}
                    </span>
                    <span
                      className={
                        station.is_active
                          ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900'
                          : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                      }
                    >
                      {station.is_active ? t('menu.active') : t('menu.inactive')}
                    </span>
                    <span className="ml-auto flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingStationId(station.id)
                          setStationForm({
                            name: station.name,
                            sortOrder: station.sort_order,
                          })
                          setStationError(null)
                        }}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleStationToggle(station)}
                      >
                        {station.is_active ? t('menu.inactive') : t('menu.active')}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleStationDelete(station.id)}
                      >
                        {confirmDeleteId === station.id
                          ? t('menu.deleteConfirm')
                          : t('common.delete')}
                      </Button>
                    </span>
                  </div>
                  {editingStationId === station.id && (
                    <form
                      onSubmit={handleStationSubmit}
                      className="flex flex-col gap-3 rounded-lg border p-3"
                    >
                      <p className="text-sm font-medium">
                        {t('menu.editStation')}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-2">
                          <Label htmlFor={`station-name-${station.id}`}>
                            {t('menu.stationName')}
                          </Label>
                          <Input
                            id={`station-name-${station.id}`}
                            value={stationForm.name}
                            onChange={(e) =>
                              setStationForm((prev) => ({
                                ...prev,
                                name: e.target.value,
                              }))
                            }
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor={`station-sort-${station.id}`}>
                            {t('menu.sortOrder')}
                          </Label>
                          <Input
                            id={`station-sort-${station.id}`}
                            type="number"
                            value={stationForm.sortOrder}
                            onChange={(e) =>
                              setStationForm((prev) => ({
                                ...prev,
                                sortOrder: Number(e.target.value) || 0,
                              }))
                            }
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button type="submit" size="sm">
                          {t('common.save')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingStationId(null)
                            setStationForm(EMPTY_STATION)
                          }}
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!editingStationId && (
            <form
              onSubmit={handleStationSubmit}
              className="flex flex-col gap-3 rounded-lg border p-3"
            >
              <p className="text-sm font-medium">{t('menu.addStation')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-station-name">{t('menu.stationName')}</Label>
                <Input
                  id="new-station-name"
                  value={stationForm.name}
                  onChange={(e) =>
                    setStationForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-station-sort">{t('menu.sortOrder')}</Label>
                <Input
                  id="new-station-sort"
                  type="number"
                  value={stationForm.sortOrder}
                  onChange={(e) =>
                    setStationForm((prev) => ({
                      ...prev,
                      sortOrder: Number(e.target.value) || 0,
                    }))
                  }
                />
              </div>
            </div>
              <div>
                <Button type="submit" size="sm">
                  {t('menu.addStation')}
                </Button>
              </div>
            </form>
          )}
          {stationError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t(stationError)}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Modifiers */}
      <Card>
        <CardHeader>
          <CardTitle>{t('menu.modifiers')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {modifiers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('menu.noModifiers')}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {modifiers.map((modifier) => (
                <li key={modifier.id} className="flex flex-col gap-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {modifier.name}
                      {modifier.name_bn ? ` (${modifier.name_bn})` : ''}
                    </span>
                    <span className="text-sm">
                      {formatMoney(Number(modifier.price), currency)}
                    </span>
                    <span
                      className={
                        modifier.is_active
                          ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900'
                          : 'rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground'
                      }
                    >
                      {modifier.is_active ? t('menu.active') : t('menu.inactive')}
                    </span>
                    <span className="ml-auto flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingModifierId(modifier.id)
                          setModifierForm({
                            name: modifier.name,
                            nameBn: modifier.name_bn ?? '',
                            price: String(modifier.price),
                          })
                          setModifierError(null)
                        }}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleModifierToggle(modifier)}
                      >
                        {modifier.is_active ? t('menu.inactive') : t('menu.active')}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => void handleModifierDelete(modifier.id)}
                      >
                        {confirmDeleteId === modifier.id
                          ? t('menu.deleteConfirm')
                          : t('common.delete')}
                      </Button>
                    </span>
                  </div>
                  {editingModifierId === modifier.id && (
                    <form
                      onSubmit={handleModifierSubmit}
                      className="flex flex-col gap-3 rounded-lg border p-3"
                    >
                      <p className="text-sm font-medium">
                        {t('menu.editModifier')}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="flex flex-col gap-2">
                          <Label htmlFor={`modifier-name-${modifier.id}`}>
                            {t('menu.modifierName')}
                          </Label>
                          <Input
                            id={`modifier-name-${modifier.id}`}
                            value={modifierForm.name}
                            onChange={(e) =>
                              setModifierForm((prev) => ({
                                ...prev,
                                name: e.target.value,
                              }))
                            }
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor={`modifier-name-bn-${modifier.id}`}>
                            {t('menu.categoryNameBn')}
                          </Label>
                          <Input
                            id={`modifier-name-bn-${modifier.id}`}
                            value={modifierForm.nameBn}
                            onChange={(e) =>
                              setModifierForm((prev) => ({
                                ...prev,
                                nameBn: e.target.value,
                              }))
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-2">
                          <Label htmlFor={`modifier-price-${modifier.id}`}>
                            {t('menu.price')}
                          </Label>
                          <Input
                            id={`modifier-price-${modifier.id}`}
                            type="text"
                            inputMode="decimal"
                            value={modifierForm.price}
                            onChange={(e) =>
                              setModifierForm((prev) => ({
                                ...prev,
                                price: e.target.value,
                              }))
                            }
                            required
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button type="submit" size="sm">
                          {t('common.save')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingModifierId(null)
                            setModifierForm(EMPTY_MODIFIER)
                          }}
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!editingModifierId && (
            <form
              onSubmit={handleModifierSubmit}
              className="flex flex-col gap-3 rounded-lg border p-3"
            >
              <p className="text-sm font-medium">{t('menu.addModifier')}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-modifier-name">{t('menu.modifierName')}</Label>
                <Input
                  id="new-modifier-name"
                  value={modifierForm.name}
                  onChange={(e) =>
                    setModifierForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-modifier-name-bn">
                  {t('menu.categoryNameBn')}
                </Label>
                <Input
                  id="new-modifier-name-bn"
                  value={modifierForm.nameBn}
                  onChange={(e) =>
                    setModifierForm((prev) => ({
                      ...prev,
                      nameBn: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-modifier-price">{t('menu.price')}</Label>
                <Input
                  id="new-modifier-price"
                  type="text"
                  inputMode="decimal"
                  value={modifierForm.price}
                  onChange={(e) =>
                    setModifierForm((prev) => ({
                      ...prev,
                      price: e.target.value,
                    }))
                  }
                  required
                />
              </div>
            </div>
              <div>
                <Button type="submit" size="sm">
                  {t('menu.addModifier')}
                </Button>
              </div>
            </form>
          )}
          {modifierError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t(modifierError)}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
