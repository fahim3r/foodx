// FoodX — inventory data service (items, stock movements, availability).
// Stock quantities change ONLY through stock_movements, applied by the
// SECURITY DEFINER function apply_stock_movement() — the app never
// updates current_quantity directly (updateInventoryItem's patch type
// excludes it on purpose, and the edit form has no quantity field).
//
// Graceful degradation: when the Phase 3 tables do not exist yet
// (migration not applied), the availability fetch returns an empty map
// instead of failing — the POS must keep working without inventory.
import { supabase } from '@/lib/supabase'
import { isMissingTableError } from '@/lib/errors'
import type {
  InventoryItem,
  StockMovement,
  StockMovementType,
  StockMovementWithItem,
  StockTransfer,
  StockTransferItem,
  StockTransferWithItems,
} from '@/types'

// --- inventory items ---------------------------------------------------------

export async function fetchInventoryItems(
  restaurantId: string,
): Promise<InventoryItem[]> {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as InventoryItem[]
}

export async function fetchLowStockItems(
  restaurantId: string,
): Promise<InventoryItem[]> {
  const items = await fetchInventoryItems(restaurantId)
  return items.filter(
    (item) =>
      item.is_active &&
      Number(item.current_quantity) <= Number(item.low_stock_threshold),
  )
}

export async function createInventoryItem(
  restaurantId: string,
  values: {
    name: string
    unit: string
    lowStockThreshold?: number
    costPrice?: number
  },
): Promise<InventoryItem> {
  const { data, error } = await supabase
    .from('inventory_items')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      name: values.name.trim(),
      unit: values.unit.trim(),
      low_stock_threshold: values.lowStockThreshold ?? 0,
      cost_price: values.costPrice ?? 0,
    })
    .select()
    .single()
  if (error) throw error
  return data as InventoryItem
}

/**
 * Update an item's master data. NOTE: current_quantity is deliberately
 * NOT in the patch — stock only changes through movements (see
 * applyMovement / adjustStock / recordWaste below).
 */
export async function updateInventoryItem(
  itemId: string,
  patch: Partial<
    Pick<
      InventoryItem,
      'name' | 'unit' | 'low_stock_threshold' | 'cost_price' | 'is_active'
    >
  >,
): Promise<InventoryItem> {
  const { data, error } = await supabase
    .from('inventory_items')
    .update(patch)
    .eq('id', itemId)
    .select()
    .single()
  if (error) throw error
  return data as InventoryItem
}

export async function deleteInventoryItem(itemId: string): Promise<void> {
  // Recipe lines cascade; purchase-order lines are RESTRICT, so an item
  // on a purchase order cannot be deleted until the order is gone.
  // Past stock movements keep working: their inventory_item_id is
  // RESTRICT too — an item with any movement history cannot be deleted.
  const { error } = await supabase
    .from('inventory_items')
    .delete()
    .eq('id', itemId)
  if (error) throw error
}

// --- stock movements ---------------------------------------------------------

/**
 * Apply one stock movement through the database function (which inserts
 * the movement row and updates the item's quantity in one step).
 * Returns the item's new quantity. Throws when the delta is zero, the
 * type is invalid, or the item belongs to another restaurant.
 */
export async function applyMovement(
  itemId: string,
  values: {
    type: StockMovementType
    delta: number
    reason?: string | null
    referenceType?: string | null
    referenceId?: string | null
  },
): Promise<number> {
  const { data, error } = await supabase.rpc('apply_stock_movement', {
    p_item_id: itemId,
    p_type: values.type,
    p_delta: values.delta,
    p_reason: values.reason?.trim() || null,
    p_reference_type: values.referenceType ?? null,
    p_reference_id: values.referenceId ?? null,
  })
  if (error) throw error
  return Number(data)
}

/**
 * Restock an order that was cancelled: reverses the SALE movements
 * deduct_stock_for_order() wrote (one RESTOCK movement per item).
 * No-op when nothing was deducted, idempotent (never restocks the
 * same order twice). Throws when the order does not exist or belongs
 * to another restaurant.
 */
export async function restockForOrder(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('restock_for_order', {
    p_order_id: orderId,
  })
  if (error) throw error
}

/** Manual stock correction. Delta may be positive or negative; a reason
 * is required — silent corrections are not allowed. */
export async function adjustStock(
  itemId: string,
  delta: number,
  reason: string,
): Promise<number> {
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error('invalid_quantity')
  }
  if (!reason.trim()) throw new Error('reason_required')
  return applyMovement(itemId, {
    type: 'ADJUSTMENT',
    delta,
    reason,
  })
}

/** Record spoiled / wasted stock. Quantity must be positive; the
 * movement is negative. A reason is required. */
export async function recordWaste(
  itemId: string,
  quantity: number,
  reason: string,
): Promise<number> {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('invalid_quantity')
  }
  if (!reason.trim()) throw new Error('reason_required')
  return applyMovement(itemId, {
    type: 'WASTE',
    delta: -quantity,
    reason,
  })
}

export async function fetchStockMovements(
  restaurantId: string,
  limit = 200,
): Promise<StockMovementWithItem[]> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*, inventory_items(name, unit)')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  const rows = (data ?? []) as Array<
    StockMovement & {
      inventory_items: { name: string; unit: string } | null
    }
  >
  return rows.map((row) => ({
    ...row,
    item_name: row.inventory_items?.name ?? '—',
    item_unit: row.inventory_items?.unit ?? '',
    inventory_items: undefined,
  })) as StockMovementWithItem[]
}

// --- POS availability ----------------------------------------------------------

/**
 * How many servings of each product the current stock allows:
 * min over the product's recipe lines of floor(item_qty / qty_per_unit).
 * Products with no recipe are not stock-limited and are absent from the
 * map (the POS treats a missing entry as unlimited). Negative stock
 * clamps to 0 servings.
 *
 * Never throws for a missing Phase 3 schema — returns an empty map so
 * the POS keeps working as if there were no recipes.
 */
export async function fetchProductAvailability(
  restaurantId: string,
): Promise<Map<string, number>> {
  try {
    const [{ data: recipes, error: recipesError }, { data: items }] =
      await Promise.all([
        supabase
          .from('product_recipes')
          .select('product_id, inventory_item_id, quantity_per_unit')
          .eq('restaurant_id', restaurantId),
        supabase
          .from('inventory_items')
          .select('id, current_quantity')
          .eq('restaurant_id', restaurantId),
      ])
    if (recipesError) throw recipesError
    const qtyByItem = new Map<string, number>(
      ((items ?? []) as { id: string; current_quantity: number }[]).map(
        (item) => [item.id, Number(item.current_quantity)],
      ),
    )
    const servings = new Map<string, number>()
    for (const recipe of (recipes ?? []) as {
      product_id: string
      inventory_item_id: string
      quantity_per_unit: number
    }[]) {
      const available = qtyByItem.get(recipe.inventory_item_id) ?? 0
      const perUnit = Number(recipe.quantity_per_unit)
      const canMake =
        perUnit > 0 ? Math.floor(available / perUnit) : Number.POSITIVE_INFINITY
      const current = servings.get(recipe.product_id)
      servings.set(
        recipe.product_id,
        Math.max(0, Math.min(current ?? Number.POSITIVE_INFINITY, canMake)),
      )
    }
    return servings
  } catch (error) {
    // Missing Phase 3 tables (or a network error): availability is a
    // hint, never a blocker — the POS sells without it.
    if (!isMissingTableError(error)) {
      console.error('[Inventory] availability fetch failed', error)
    }
    return new Map<string, number>()
  }
}

// ---------------------------------------------------------------------------
// Phase 7 Step 2B — branch stock + transfers (migration 0018, §41)
// ---------------------------------------------------------------------------

export interface BranchStockRow {
  inventoryItemId: string
  name: string
  unit: string
  branchQuantity: number
  globalQuantity: number
}

/** Stock of one branch: every active item with its branch quantity
 * (0 when the branch has no row yet) next to the global quantity. */
export async function fetchBranchStock(
  restaurantId: string,
  branchId: string,
): Promise<BranchStockRow[]> {
  const { data: items, error } = await supabase
    .from('inventory_items')
    .select('id, name, unit, current_quantity')
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('name', { ascending: true })
  if (error) throw error
  const { data: stock, error: stockError } = await supabase
    .from('branch_stock')
    .select('inventory_item_id, quantity')
    .eq('restaurant_id', restaurantId)
    .eq('branch_id', branchId)
  if (stockError) throw stockError
  const byItem = new Map(
    ((stock ?? []) as { inventory_item_id: string; quantity: number }[]).map(
      (s) => [s.inventory_item_id, Number(s.quantity)],
    ),
  )
  return (
    (items ?? []) as {
      id: string
      name: string
      unit: string
      current_quantity: number
    }[]
  ).map((item) => ({
    inventoryItemId: item.id,
    name: item.name,
    unit: item.unit,
    branchQuantity: byItem.get(item.id) ?? 0,
    globalQuantity: Number(item.current_quantity),
  }))
}

export async function fetchTransfers(
  restaurantId: string,
): Promise<StockTransferWithItems[]> {
  const { data, error } = await supabase
    .from('stock_transfers')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error
  const transfers = (data ?? []) as StockTransfer[]
  if (transfers.length === 0) return []
  const { data: items, error: itemsError } = await supabase
    .from('stock_transfer_items')
    .select('*')
    .in(
      'transfer_id',
      transfers.map((t) => t.id),
    )
  if (itemsError) throw itemsError
  const itemsByTransfer = new Map<string, StockTransferItem[]>()
  for (const item of (items ?? []) as StockTransferItem[]) {
    const list = itemsByTransfer.get(item.transfer_id) ?? []
    list.push(item)
    itemsByTransfer.set(item.transfer_id, list)
  }
  return transfers.map((t) => ({
    ...t,
    items: itemsByTransfer.get(t.id) ?? [],
  }))
}

export interface CreateTransferInput {
  fromBranchId: string
  toBranchId: string
  notes?: string
  lines: { inventoryItemId: string; quantity: number }[]
}

/** Create a transfer REQUEST. No stock moves until receive. */
export async function createTransfer(
  restaurantId: string,
  userId: string,
  input: CreateTransferInput,
): Promise<void> {
  const lines = input.lines.filter((l) => l.quantity > 0)
  if (lines.length === 0) throw new Error('empty_transfer')
  if (input.fromBranchId === input.toBranchId) {
    throw new Error('same_branch')
  }
  const transferId = crypto.randomUUID()
  const { error } = await supabase.from('stock_transfers').insert({
    id: transferId,
    restaurant_id: restaurantId,
    from_branch_id: input.fromBranchId,
    to_branch_id: input.toBranchId,
    status: 'REQUESTED',
    notes: input.notes?.trim() ? input.notes.trim() : null,
    requested_by: userId,
  })
  if (error) throw error
  const { error: itemsError } = await supabase
    .from('stock_transfer_items')
    .insert(
      lines.map((l) => ({
        id: crypto.randomUUID(),
        restaurant_id: restaurantId,
        transfer_id: transferId,
        inventory_item_id: l.inventoryItemId,
        quantity: l.quantity,
      })),
    )
  if (itemsError) {
    // Roll the header back so a failed request leaves no orphan.
    await supabase
      .from('stock_transfers')
      .update({ status: 'CANCELLED' })
      .eq('id', transferId)
    throw itemsError
  }
}

export async function setTransferStatus(
  transferId: string,
  status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
  userId: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status }
  if (status === 'APPROVED') {
    patch.approved_by = userId
    patch.approved_at = new Date().toISOString()
  }
  const { error } = await supabase
    .from('stock_transfers')
    .update(patch)
    .eq('id', transferId)
  if (error) throw error
}

/**
 * Receive an APPROVED transfer: the database function checks the
 * source branch's stock, writes both movements and moves the branch
 * quantities atomically. Throws 'insufficient_branch_stock' when the
 * source branch does not hold enough.
 */
export async function receiveTransfer(transferId: string): Promise<void> {
  const { error } = await supabase.rpc('receive_stock_transfer', {
    p_transfer_id: transferId,
  })
  if (error) {
    if (error.message.includes('insufficient_branch_stock')) {
      throw new Error('insufficient_branch_stock')
    }
    if (error.message.includes('transfer_not_approved')) {
      throw new Error('transfer_not_approved')
    }
    throw error
  }
}
