# Generate icons: red rounded square + speaker figure + two subtitle bars
from PIL import Image, ImageDraw
import sys, os
def icon(size):
    s = size * 4
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.22, fill=(229, 72, 77, 255))
    d.rounded_rectangle([s * .18, s * .54, s * .82, s * .66], radius=s * .05, fill=(255, 255, 255, 255))
    d.rounded_rectangle([s * .28, s * .73, s * .72, s * .83], radius=s * .05, fill=(255, 255, 255, 200))
    d.ellipse([s * .38, s * .16, s * .62, s * .40], fill=(255, 255, 255, 255))
    return im.resize((size, size), Image.LANCZOS)
out, kind = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
for n in (16, 32, 48, 128, 256):
    icon(n).save(os.path.join(out, f'{n}.png' if kind == 'ext' else f'icon-{n}.png'))
if kind == 'desktop':
    icon(256).save(os.path.join(out, 'icon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
