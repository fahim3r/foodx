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
