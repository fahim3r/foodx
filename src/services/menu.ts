// FoodX — menu data service (categories, products, variants, modifiers,
// kitchen stations). All queries are scoped by RLS to the caller's own
// restaurant.
//
// NOTE on .select() after insert: these tables' SELECT policies are
// `restaurant_id = current_restaurant_id()`, and every row inserted here
// carries exactly that restaurant_id — so the inserted row is visible to
// the caller and `.select().single()` is safe (unlike the Phase 1
// restaurants bootstrap case, where the profile did not exist yet).
import { supabase } from '@/lib/supabase'
import { roundMoney } from '@/lib/money'
import type {
  Category,
  KitchenStation,
  Modifier,
  Product,
  ProductVariant,
  ProductWithDetails,
} from '@/types'

// --- kitchen stations -------------------------------------------------------

export async function fetchStations(
  restaurantId: string,
): Promise<KitchenStation[]> {
  const { data, error } = await supabase
    .from('kitchen_stations')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as KitchenStation[]
}

export async function createStation(
  restaurantId: string,
  values: { name: string; sortOrder?: number },
): Promise<KitchenStation> {
  const { data, error } = await supabase
    .from('kitchen_stations')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      name: values.name.trim(),
      sort_order: values.sortOrder ?? 0,
    })
    .select()
    .single()
  if (error) throw error
  return data as KitchenStation
}

export async function updateStation(
  stationId: string,
  patch: Partial<Pick<KitchenStation, 'name' | 'sort_order' | 'is_active'>>,
): Promise<KitchenStation> {
  const { data, error } = await supabase
    .from('kitchen_stations')
    .update(patch)
    .eq('id', stationId)
    .select()
    .single()
  if (error) throw error
  return data as KitchenStation
}

export async function deleteStation(stationId: string): Promise<void> {
  // Products pointing at the station keep working: their
  // kitchen_station_id is set to NULL by the foreign key.
  const { error } = await supabase
    .from('kitchen_stations')
    .delete()
    .eq('id', stationId)
  if (error) throw error
}

// --- categories -------------------------------------------------------------

export async function fetchCategories(
  restaurantId: string,
): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Category[]
}

export async function createCategory(
  restaurantId: string,
  values: { name: string; nameBn?: string; sortOrder?: number },
): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      name: values.name.trim(),
      name_bn: values.nameBn?.trim() || null,
      sort_order: values.sortOrder ?? 0,
    })
    .select()
    .single()
  if (error) throw error
  return data as Category
}

export async function updateCategory(
  categoryId: string,
  patch: Partial<
    Pick<Category, 'name' | 'name_bn' | 'sort_order' | 'is_active'>
  >,
): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .update(patch)
    .eq('id', categoryId)
    .select()
    .single()
  if (error) throw error
  return data as Category
}

export async function deleteCategory(categoryId: string): Promise<void> {
  // Products in the category keep working: their category_id is set to
  // NULL by the foreign key and they show under "Uncategorised".
  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', categoryId)
  if (error) throw error
}

// --- modifiers --------------------------------------------------------------

export async function fetchModifiers(
  restaurantId: string,
): Promise<Modifier[]> {
  const { data, error } = await supabase
    .from('modifiers')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Modifier[]
}

export async function createModifier(
  restaurantId: string,
  values: { name: string; nameBn?: string; price: number },
): Promise<Modifier> {
  const { data, error } = await supabase
    .from('modifiers')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      name: values.name.trim(),
      name_bn: values.nameBn?.trim() || null,
      price: roundMoney(values.price),
    })
    .select()
    .single()
  if (error) throw error
  return data as Modifier
}

export async function updateModifier(
  modifierId: string,
  patch: Partial<Pick<Modifier, 'name' | 'name_bn' | 'price' | 'is_active'>>,
): Promise<Modifier> {
  const { data, error } = await supabase
    .from('modifiers')
    .update({
      ...patch,
      ...(patch.price !== undefined
        ? { price: roundMoney(patch.price) }
        : {}),
    })
    .eq('id', modifierId)
    .select()
    .single()
  if (error) throw error
  return data as Modifier
}

export async function deleteModifier(modifierId: string): Promise<void> {
  // Past order items keep their modifier snapshot (modifier_id is set
  // to NULL, modifier_name/price stay on the order item).
  const { error } = await supabase
    .from('modifiers')
    .delete()
    .eq('id', modifierId)
  if (error) throw error
}

// --- products ---------------------------------------------------------------

export async function fetchProducts(
  restaurantId: string,
): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Product[]
}

/**
 * Products with their variants and offered modifiers attached — the shape
 * the POS browses. Modifiers come through the product_modifiers junction.
 */
export async function fetchProductsWithDetails(
  restaurantId: string,
): Promise<ProductWithDetails[]> {
  const { data, error } = await supabase
    .from('products')
    .select(
      '*, product_variants(*), product_modifiers(modifiers(*))',
    )
    .eq('restaurant_id', restaurantId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as Array<
    Product & {
      product_variants: ProductVariant[]
      product_modifiers: Array<{ modifiers: Modifier | null }>
    }
  >
  return rows.map((row) => ({
    ...row,
    variants: (row.product_variants ?? [])
      .filter((v) => v.is_active)
      .sort((a, b) => a.sort_order - b.sort_order),
    modifiers: (row.product_modifiers ?? [])
      .map((link) => link.modifiers)
      .filter((m): m is Modifier => m !== null && m.is_active),
    product_variants: undefined,
    product_modifiers: undefined,
  })) as ProductWithDetails[]
}

export async function createProduct(
  restaurantId: string,
  values: {
    categoryId?: string | null
    kitchenStationId?: string | null
    name: string
    nameBn?: string
    description?: string
    price: number
    costPrice?: number | null
    imageUrl?: string
    sortOrder?: number
  },
): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      category_id: values.categoryId ?? null,
      kitchen_station_id: values.kitchenStationId ?? null,
      name: values.name.trim(),
      name_bn: values.nameBn?.trim() || null,
      description: values.description?.trim() || null,
      price: roundMoney(values.price),
      cost_price:
        values.costPrice === undefined || values.costPrice === null
          ? null
          : roundMoney(values.costPrice),
      image_url: values.imageUrl?.trim() || null,
      sort_order: values.sortOrder ?? 0,
    })
    .select()
    .single()
  if (error) throw error
  return data as Product
}

export async function updateProduct(
  productId: string,
  patch: Partial<
    Pick<
      Product,
      | 'category_id'
      | 'kitchen_station_id'
      | 'name'
      | 'name_bn'
      | 'description'
      | 'price'
      | 'cost_price'
      | 'image_url'
      | 'is_available'
      | 'sort_order'
    >
  >,
): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .update({
      ...patch,
      ...(patch.price !== undefined
        ? { price: roundMoney(patch.price) }
        : {}),
    })
    .eq('id', productId)
    .select()
    .single()
  if (error) throw error
  return data as Product
}

export async function deleteProduct(productId: string): Promise<void> {
  // Past order items keep their snapshots (product_id is set to NULL,
  // product_name / unit_price stay on the order item). Variants and
  // junction rows cascade.
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', productId)
  if (error) throw error
}

// --- product variants --------------------------------------------------------

export async function fetchVariants(
  productId: string,
): Promise<ProductVariant[]> {
  const { data, error } = await supabase
    .from('product_variants')
    .select('*')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as ProductVariant[]
}

export async function createVariant(
  productId: string,
  values: { name: string; priceAdjustment: number; sortOrder?: number },
): Promise<ProductVariant> {
  const { data, error } = await supabase
    .from('product_variants')
    .insert({
      id: crypto.randomUUID(),
      product_id: productId,
      name: values.name.trim(),
      price_adjustment: roundMoney(values.priceAdjustment),
      sort_order: values.sortOrder ?? 0,
    })
    .select()
    .single()
  if (error) throw error
  return data as ProductVariant
}

export async function updateVariant(
  variantId: string,
  patch: Partial<
    Pick<ProductVariant, 'name' | 'price_adjustment' | 'sort_order' | 'is_active'>
  >,
): Promise<ProductVariant> {
  const { data, error } = await supabase
    .from('product_variants')
    .update({
      ...patch,
      ...(patch.price_adjustment !== undefined
        ? { price_adjustment: roundMoney(patch.price_adjustment) }
        : {}),
    })
    .eq('id', variantId)
    .select()
    .single()
  if (error) throw error
  return data as ProductVariant
}

export async function deleteVariant(variantId: string): Promise<void> {
  const { error } = await supabase
    .from('product_variants')
    .delete()
    .eq('id', variantId)
  if (error) throw error
}

// --- product ↔ modifier links -----------------------------------------------

/** Replace the full set of modifiers offered on a product. */
export async function setProductModifiers(
  productId: string,
  modifierIds: string[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('product_modifiers')
    .delete()
    .eq('product_id', productId)
  if (deleteError) throw deleteError
  if (modifierIds.length === 0) return
  const { error } = await supabase.from('product_modifiers').insert(
    modifierIds.map((modifierId) => ({
      product_id: productId,
      modifier_id: modifierId,
    })),
  )
  if (error) throw error
}
