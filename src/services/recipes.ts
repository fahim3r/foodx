// FoodX — recipe data service (product → ingredient lines).
// A recipe line says how much of one inventory item a single serving of
// a product uses. The POS deducts stock from these lines at order time;
// the POS availability check is computed from them too.
import { supabase } from '@/lib/supabase'
import type {
  ProductRecipe,
  ProductRecipeWithItem,
} from '@/types'

export async function fetchRecipes(
  productId: string,
): Promise<ProductRecipeWithItem[]> {
  const { data, error } = await supabase
    .from('product_recipes')
    .select('*, inventory_items(*)')
    .eq('product_id', productId)
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as Array<
    ProductRecipe & {
      inventory_items: ProductRecipeWithItem['item'] | null
    }
  >
  return rows
    .filter((row) => row.inventory_items !== null)
    .map((row) => ({
      ...row,
      item: row.inventory_items as ProductRecipeWithItem['item'],
      inventory_items: undefined,
    })) as ProductRecipeWithItem[]
}

export async function addRecipeLine(
  restaurantId: string,
  productId: string,
  inventoryItemId: string,
  quantityPerUnit: number,
): Promise<ProductRecipe> {
  if (!Number.isFinite(quantityPerUnit) || quantityPerUnit <= 0) {
    throw new Error('invalid_quantity')
  }
  const { data, error } = await supabase
    .from('product_recipes')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      product_id: productId,
      inventory_item_id: inventoryItemId,
      quantity_per_unit: quantityPerUnit,
    })
    .select()
    .single()
  if (error) throw error
  return data as ProductRecipe
}

export async function updateRecipeLine(
  recipeId: string,
  quantityPerUnit: number,
): Promise<ProductRecipe> {
  if (!Number.isFinite(quantityPerUnit) || quantityPerUnit <= 0) {
    throw new Error('invalid_quantity')
  }
  const { data, error } = await supabase
    .from('product_recipes')
    .update({ quantity_per_unit: quantityPerUnit })
    .eq('id', recipeId)
    .select()
    .single()
  if (error) throw error
  return data as ProductRecipe
}

export async function deleteRecipeLine(recipeId: string): Promise<void> {
  const { error } = await supabase
    .from('product_recipes')
    .delete()
    .eq('id', recipeId)
  if (error) throw error
}
