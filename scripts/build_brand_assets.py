#!/usr/bin/env python3
"""Build performance-friendly FoodX brand assets from Fahim's logo files.

Sources (~/workspace/user/files/): all 2048x2048 PNG, cream bg #FFF6ED.
  icon light    = 1000042560_2_z4td.png  (X in orange disc)
  wordmark light= 1000042559_3_ekm5.png  (FOODX, no tagline)
  lockup light  = 1000042557_5_nt2v.png  (X + FOODX + tagline, stacked)

Method: remove the solid cream background properly (alpha from colour
distance + un-premultiply) so antialiased edges stay clean, trim the
transparent borders, then resize to the exact display size and save as
WebP (in-app, hashed by Vite) or PNG (favicon / PWA / og-image, which
need stable public URLs). No 2048px file is ever shipped to a browser.
"""
import os
import numpy as np
from PIL import Image

SRC = '/home/hatch/workspace/user/files/'
OUT_ASSETS = '/home/hatch/workspace/foodx-new/src/assets/brand'
OUT_PUBLIC = '/home/hatch/workspace/foodx-new/public'
BG = np.array([255, 246, 237], dtype=np.float32)


def remove_bg(im: Image.Image, thresh: float = 28.0) -> Image.Image:
    """Return RGBA with the solid cream background made transparent."""
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    d = np.abs(a - BG).max(axis=2)
    alpha = np.clip(d / thresh, 0.0, 1.0)
    safe = np.maximum(alpha, 1e-6)[..., None]
    rgb = BG + (a - BG) / safe
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    out = np.dstack([rgb, (alpha * 255).astype(np.uint8)])
    return Image.fromarray(out, 'RGBA')


def trimmed(im: Image.Image) -> Image.Image:
    box = im.getbbox()
    return im.crop(box) if box else im


def save(im: Image.Image, path: str, **kw) -> int:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, **kw)
    return os.path.getsize(path)


def report(label: str, path: str, size: int):
    im = Image.open(path)
    print(f'{label:28s} {im.size[0]}x{im.size[1]:<5d} {size/1024:6.1f} KB  {path}')


# --- 1. Mark (icon): transparent WebP for in-app use -----------------------
icon = trimmed(remove_bg(Image.open(SRC + '1000042560_2_z4td.png')))
icon128 = icon.resize((128, 128), Image.LANCZOS)
report('mark WebP 128', f'{OUT_ASSETS}/logo-mark.webp',
       save(icon128, f'{OUT_ASSETS}/logo-mark.webp', format='WEBP', quality=85))

# --- 2. Wordmark: transparent WebP for the login page -----------------------
word = trimmed(remove_bg(Image.open(SRC + '1000042559_3_ekm5.png')))
w, h = word.size
word480 = word.resize((480, round(h * 480 / w)), Image.LANCZOS)
report('wordmark WebP 480w', f'{OUT_ASSETS}/logo-wordmark.webp',
       save(word480, f'{OUT_ASSETS}/logo-wordmark.webp', format='WEBP', quality=85))
print('wordmark content aspect: %dx%d (%.2f:1)' % (word480.size[0], word480.size[1],
                                                    word480.size[0] / word480.size[1]))

# --- 3. Square cream versions for favicon / PWA (solid bg is correct here) --
icon_src = Image.open(SRC + '1000042560_2_z4td.png').convert('RGB')
for name, px in [('favicon.png', 64), ('apple-touch-icon.png', 180),
                 ('pwa-192.png', 192), ('pwa-512.png', 512)]:
    im = icon_src.resize((px, px), Image.LANCZOS)
    report(name, f'{OUT_PUBLIC}/{name}', save(im, f'{OUT_PUBLIC}/{name}'))

# --- 4. Lockup for og-image (square, crawlers fetch it, not site visitors) --
lock = Image.open(SRC + '1000042557_5_nt2v.png').convert('RGB').resize((1200, 1200), Image.LANCZOS)
report('og lockup PNG 1200', f'{OUT_PUBLIC}/brand/logo-lockup.png',
       save(lock, f'{OUT_PUBLIC}/brand/logo-lockup.png'))
print('done.')
