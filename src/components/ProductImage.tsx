import { Image as ImageIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * A product photo in a fixed 4:3 box, shared by every menu
 * surface (storefront + kiosk, POS, waiter, panel Menu list).
 * The WHOLE image stays visible — `object-contain`, never
 * cropped — over a soft brand-tinted letterbox, so photos of
 * any shape render in identical boxes. A product without an
 * image gets the same box with a neutral placeholder icon.
 */
export default function ProductImage({
  src,
  className,
}: {
  src?: string | null
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-primary/5',
        className,
      )}
    >
      {src ? (
        <img src={src} alt="" loading="lazy" className="h-full w-full object-contain" />
      ) : (
        <ImageIcon aria-hidden className="size-[30%] text-muted-foreground/40" />
      )}
    </div>
  )
}
