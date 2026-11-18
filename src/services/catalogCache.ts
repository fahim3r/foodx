// FoodX — offline catalog cache (Phase 9 v2, master prompt §5).
//
// v1 made the panel OPEN offline and queue orders, but every
// dataset was still fetched live, so a POS opened COLD while
// offline (browser closed, phone restarted, first open of the
// day during an outage) hit a dead end. This service saves the
// two datasets a cold start needs — the workspace (profile /
// restaurant / settings) and the POS catalog (categories,
// products with variants + modifiers, tables, branches,
// availability) — to localStorage whenever they are loaded
// online, and hands them back when a load fails with a network
// error. Sync validation never reads this cache: the server
// stays authoritative (see OFFLINE_SYNC.md).

import type {
  Category,
  DiningTable,
  ProductWithDetails,
  Profile,
  Restaurant,
  RestaurantSettings,
} from '@/types'
import type { Branch } from '@/services/restaurant'

const CACHE_VERSION = 1

export interface WorkspaceData {
  profile: Profile | null
  restaurant: Restaurant | null
  settings: RestaurantSettings | null
}

interface WorkspaceCacheBlob extends WorkspaceData {
  version: number
  userId: string
  savedAt: string
}

export interface PosCatalogData {
  categories: Category[]
  products: ProductWithDetails[]
  tables: DiningTable[]
  branches: Branch[]
  availability: Map<string, number>
}

interface PosCacheBlob {
  version: number
  restaurantId: string
  savedAt: string
  categories: Category[]
  products: ProductWithDetails[]
  tables: DiningTable[]
  branches: Branch[]
  availability: Array<[string, number]>
}

function workspaceKey(userId: string): string {
  return `foodx.workspace_cache.${userId}`
}

function posKey(restaurantId: string): string {
  return `foodx.pos_cache.${restaurantId}`
}

function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Storage unavailable — nothing to clean up.
  }
}

export function saveWorkspaceCache(userId: string, data: WorkspaceData): void {
  try {
    const blob: WorkspaceCacheBlob = {
      version: CACHE_VERSION,
      userId,
      savedAt: new Date().toISOString(),
      profile: data.profile,
      restaurant: data.restaurant,
      settings: data.settings,
    }
    window.localStorage.setItem(workspaceKey(userId), JSON.stringify(blob))
  } catch {
    // Quota or private mode: the live session is unaffected; the
    // device simply has no workspace cache on the next cold start.
  }
}

export function loadWorkspaceCache(userId: string): WorkspaceData | null {
  const key = workspaceKey(userId)
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const blob = JSON.parse(raw) as WorkspaceCacheBlob
    if (
      blob.version !== CACHE_VERSION ||
      blob.userId !== userId ||
      typeof blob.savedAt !== 'string' ||
      !('profile' in blob) ||
      !('restaurant' in blob) ||
      !('settings' in blob)
    ) {
      removeKey(key)
      return null
    }
    return {
      profile: blob.profile,
      restaurant: blob.restaurant,
      settings: blob.settings,
    }
  } catch {
    removeKey(key)
    return null
  }
}

export function savePosCache(restaurantId: string, data: PosCatalogData): void {
  try {
    const blob: PosCacheBlob = {
      version: CACHE_VERSION,
      restaurantId,
      savedAt: new Date().toISOString(),
      categories: data.categories,
      products: data.products,
      tables: data.tables,
      branches: data.branches,
      availability: Array.from(data.availability.entries()),
    }
    window.localStorage.setItem(posKey(restaurantId), JSON.stringify(blob))
  } catch {
    // Same rule as the workspace cache: a failed write is silent.
  }
}

export function loadPosCache(
  restaurantId: string,
): (PosCatalogData & { savedAt: string }) | null {
  const key = posKey(restaurantId)
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const blob = JSON.parse(raw) as PosCacheBlob
    const pairsValid =
      Array.isArray(blob.availability) &&
      blob.availability.every(
        (pair) =>
          Array.isArray(pair) &&
          typeof pair[0] === 'string' &&
          typeof pair[1] === 'number',
      )
    if (
      blob.version !== CACHE_VERSION ||
      blob.restaurantId !== restaurantId ||
      typeof blob.savedAt !== 'string' ||
      !Array.isArray(blob.categories) ||
      !Array.isArray(blob.products) ||
      !Array.isArray(blob.tables) ||
      !Array.isArray(blob.branches) ||
      !pairsValid
    ) {
      removeKey(key)
      return null
    }
    return {
      savedAt: blob.savedAt,
      categories: blob.categories,
      products: blob.products,
      tables: blob.tables,
      branches: blob.branches,
      availability: new Map(blob.availability),
    }
  } catch {
    removeKey(key)
    return null
  }
}
