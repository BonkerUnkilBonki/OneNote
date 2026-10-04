#!/usr/bin/env python3
"""Generate One UI-style launcher icons for OneNotes."""
from PIL import Image, ImageDraw
import os

TOP = (78, 140, 255)
BOTTOM = (43, 99, 232)
LINE = (59, 123, 240)

def make(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = size * 0.295
    # vertical gradient
    for y in range(size):
        t = y / size
        c = tuple(int(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=c)
    mask = Image.new('L', (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    img.putalpha(mask)
    # white note paper
    d2 = ImageDraw.Draw(img)
    pad = size * 0.255
    p = size - 2 * pad
    pr = p * 0.24
    d2.rounded_rectangle([pad, pad, pad + p, pad + p], radius=pr, fill=(255, 255, 255, 255))
    # folded corner (bottom-right)
    fr = p * 0.26
    fx = pad + p - fr
    fy = pad + p - fr
    d2.polygon([(fx, pad + p), (pad + p, fy), (pad + p, pad + p)], fill=(232, 238, 250, 255))
    # text lines
    lx0 = pad + p * 0.20
    ly = pad + p * 0.24
    widths = [0.60, 0.60, 0.38]
    lh = p * 0.055
    gap = p * 0.16
    for i, w in enumerate(widths):
        y = ly + i * gap
        d2.rounded_rectangle([lx0, y, lx0 + p * w, y + lh], radius=lh / 2, fill=LINE + (255,))
    return img

out_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'res')
for dpi, size in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
    d = os.path.join(out_root, 'mipmap-' + dpi)
    os.makedirs(d, exist_ok=True)
    make(size).save(os.path.join(d, 'ic_launcher.png'))
print('icons written to', out_root)
