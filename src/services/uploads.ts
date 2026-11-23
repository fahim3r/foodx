import { supabase } from '@/lib/supabase'

/**
 * Product image uploads (modifications v2, item 5). Images live
 * in the public `product-images` bucket under the restaurant's
 * own folder; `products.image_url` just stores the public URL,
 * so image-by-link keeps working exactly as before and a
 * deployment without the bucket loses uploads only.
 */

const MAX_BYTES = 5 * 1024 * 1024
const MAX_EDGE = 1200
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp']

export class UploadError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

async function downscale(file: File): Promise<{ blob: Blob; ext: string }> {
  if (!ACCEPTED.includes(file.type)) throw new UploadError('upload_bad_type')
  if (file.size > MAX_BYTES) throw new UploadError('upload_too_large')
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) {
    // Cannot decode (rare) — upload the original within limits.
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    return { blob: file, ext }
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { blob: file, ext: 'jpg' }
  ctx.drawImage(bitmap, 0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.85),
  )
  if (blob) return { blob, ext: 'webp' }
  const jpeg = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  )
  if (jpeg) return { blob: jpeg, ext: 'jpg' }
  return { blob: file, ext: 'jpg' }
}

export async function uploadProductImage(
  restaurantId: string,
  file: File,
): Promise<string> {
  const { blob, ext } = await downscale(file)
  const path = `${restaurantId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('product-images')
    .upload(path, blob, { contentType: blob.type || undefined, upsert: false })
  if (error) {
    console.error('[uploads] product image upload failed', error)
    throw new UploadError('upload_failed')
  }
  const { data } = supabase.storage.from('product-images').getPublicUrl(path)
  return data.publicUrl
}

/**
 * White Glass backdrop upload (v4, migration 0037): the same
 * bucket and downscale as product images, under the restaurant's
 * own `backdrop/` folder; `restaurant_settings.glass_backdrop_url`
 * stores the returned public URL. A backdrop is blurred and
 * drained toward white by the theme, so the shared 1200px edge
 * cap costs nothing visually.
 */
export async function uploadGlassBackdrop(
  restaurantId: string,
  file: File,
): Promise<string> {
  const { blob, ext } = await downscale(file)
  const path = `${restaurantId}/backdrop/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from('product-images')
    .upload(path, blob, { contentType: blob.type || undefined, upsert: false })
  if (error) {
    console.error('[uploads] glass backdrop upload failed', error)
    throw new UploadError('upload_failed')
  }
  const { data } = supabase.storage.from('product-images').getPublicUrl(path)
  return data.publicUrl
}

/**
 * Best-effort cleanup for a replaced/reset glass backdrop:
 * clearing `glass_backdrop_url` alone would leave the uploaded
 * file in the bucket forever. Only URLs that are THIS bucket's
 * own public URLs under a `backdrop/` folder are touched — a
 * pasted external link is never deleted (it is not ours to
 * delete). All failures are swallowed: cleanup must never block
 * or fail the settings save that triggered it. Deletes are
 * scoped by the bucket's existing policy (0028,
 * `product_images_delete_own`: authenticated, own restaurant
 * folder only).
 */
const PRODUCT_IMAGES_PUBLIC_MARKER =
  '/storage/v1/object/public/product-images/'

export async function deleteGlassBackdropByUrl(
  url: string | null | undefined,
): Promise<void> {
  if (!url) return
  try {
    const markerAt = url.indexOf(PRODUCT_IMAGES_PUBLIC_MARKER)
    if (markerAt === -1) return
    const path = decodeURIComponent(
      url
        .slice(markerAt + PRODUCT_IMAGES_PUBLIC_MARKER.length)
        .split(/[?#]/)[0],
    )
    if (!path.includes('/backdrop/')) return
    const { error } = await supabase.storage
      .from('product-images')
      .remove([path])
    if (error) {
      console.error('[uploads] glass backdrop cleanup failed', error)
    }
  } catch (error) {
    console.error('[uploads] glass backdrop cleanup failed', error)
  }
}
