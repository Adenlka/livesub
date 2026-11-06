# Generate icons: red rounded square + two subtitle bars
from PIL import Image, ImageDraw
import sys, os
def icon(size):
    s = size * 4
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.22, fill=(255, 93, 93, 255))
    d.rounded_rectangle([s * .18, s * .50, s * .82, s * .62], radius=s * .05, fill=(255, 255, 255, 255))
    d.rounded_rectangle([s * .28, s * .70, s * .72, s * .80], radius=s * .05, fill=(255, 255, 255, 200))
    d.ellipse([s * .38, s * .18, s * .62, s * .42], fill=(255, 255, 255, 255))
    return im.resize((size, size), Image.LANCZOS)
out = sys.argv[1]
for n in (16, 32, 48, 128, 256):
    icon(n).save(os.path.join(out, 'icons', f'{n}.png') if 'extension' in out else os.path.join(out, f'icon-{n}.png'))
if 'desktop' in out:
    icon(256).save(os.path.join(out, 'icon.ico'), sizes=[(16,16),(32,32),(48,48),(256,256)])
