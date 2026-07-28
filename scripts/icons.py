#!/usr/bin/env python3
"""Regenerate every raster icon for Operation Roadtrip.

    python3 scripts/icons.py

Then push the Android launcher icons:

    npx @capacitor/assets generate --android

Why Pillow and not the SVGs in resources/?
    ImageMagick here has no librsvg delegate, and its built-in MSVG renderer
    chokes on gradients + many primitives ("non-conforming drawing primitive").
    Drawing the geometry directly is deterministic and dependency-light. The
    SVGs stay as the design source and ship as favicon.svg, which browsers
    render properly themselves.

Everything is drawn at 4x and downsampled with LANCZOS, which is what gives the
diagonal needle edges their antialiasing.
"""
from PIL import Image, ImageDraw
import math
import os

S = 1024          # final canvas
SS = 4            # supersample factor
N = S * SS

PRIMARY_TL = (91, 134, 255)    # #5b86ff
PRIMARY = (79, 124, 255)       # #4f7cff
VIOLET = (167, 139, 250)       # #a78bfa
NEEDLE_TILT = 20               # degrees


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size):
    """Diagonal primary -> violet, with a soft top-left highlight."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x / size + y / size) / 2
            c = lerp(PRIMARY_TL, PRIMARY, t / 0.55) if t < 0.55 \
                else lerp(PRIMARY, VIOLET, (t - 0.55) / 0.45)
            px[x, y] = c

    # Radial white glow, centred up-left, for a bit of depth.
    glow = Image.new("L", (size, size), 0)
    gd = ImageDraw.Draw(glow)
    cx, cy, r = size * 0.28, size * 0.22, size * 0.75
    steps = 60
    for i in range(steps, 0, -1):
        rr = r * i / steps
        a = round(72 * (1 - i / steps) ** 2)
        gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=a)
    img = Image.composite(Image.new("RGB", (size, size), (255, 255, 255)), img, glow)
    return img.convert("RGBA")


def rot(pt, cx, cy, deg):
    a = math.radians(deg)
    dx, dy = pt[0] - cx, pt[1] - cy
    return (cx + dx * math.cos(a) - dy * math.sin(a),
            cy + dx * math.sin(a) + dy * math.cos(a))


def draw_mark(img, scale=1.0):
    """Compass housing, rose dots and the tilted two-tone needle."""
    d = ImageDraw.Draw(img, "RGBA")
    c = N / 2

    def s(v):
        """Scale a 1024-space length about the centre."""
        return v * SS * scale

    # housing ring
    r = s(336)
    d.ellipse([c - r, c - r, c + r, c + r], outline=(255, 255, 255, 92), width=round(s(18)))

    # rose dots at N/E/S/W
    dot = s(20)
    for dx, dy in ((0, -s(384)), (s(384), 0), (0, s(384)), (-s(384), 0)):
        d.ellipse([c + dx - dot, c + dy - dot, c + dx + dot, c + dy + dot], fill=(255, 255, 255, 165))

    # Needle: north white, south a solid deep indigo.
    #
    # The south half was translucent white first. It looked right at 256px and
    # dissolved into the gradient by 32px, leaving an ambiguous blob. A solid
    # dark tone holds its edge at every size — favicon included, which is where
    # this is seen most. Wider than a classic thin needle for the same reason.
    tip_n = (c, c - s(322))
    tip_s = (c, c + s(322))
    left = (c - s(116), c)
    right = (c + s(116), c)
    R = lambda p: rot(p, c, c, NEEDLE_TILT)
    d.polygon([R(tip_s), R(right), R(left)], fill=(38, 54, 122, 255))
    d.polygon([R(tip_n), R(right), R(left)], fill=(255, 255, 255, 255))

    # hub
    hub = s(34)
    d.ellipse([c - hub, c - hub, c + hub, c + hub], fill=(255, 255, 255, 255))
    hub2 = s(15)
    d.ellipse([c - hub2, c - hub2, c + hub2, c + hub2], fill=PRIMARY + (255,))


def rounded(img, radius_ratio=0.225):
    """Mask to a rounded square — web only; native launchers mask themselves."""
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, img.size[0] - 1, img.size[1] - 1],
        radius=round(img.size[0] * radius_ratio), fill=255)
    out = img.copy()
    out.putalpha(mask)
    return out


def build_full():
    img = gradient(N)
    draw_mark(img)
    return img.resize((S, S), Image.LANCZOS)


#: Foreground scale. Do NOT pre-shrink this to the 66% safe zone.
#
# @capacitor/assets writes an ic_launcher.xml that already applies
# `android:inset="16.7%"` to the foreground, which shrinks the drawable to
# 66.6% — the safe zone — on its own. The first version here ALSO scaled the
# mark to 0.62, so the needle got shrunk twice and ended up filling 33% of the
# launcher icon: a small mark adrift in a big gradient.
#
# 1.14 puts the artwork at ~90% of the source canvas, which lands at ~60% of
# the finished icon after Android's inset. Comfortably inside the 66% limit.
FOREGROUND_SCALE = 1.14


def build_foreground():
    """Adaptive-icon foreground. Android's own inset does the safe-zone work."""
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    draw_mark(img, scale=FOREGROUND_SCALE)
    return img.resize((S, S), Image.LANCZOS)


def build_background():
    return gradient(N).resize((S, S), Image.LANCZOS)


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)

    full = build_full()
    full.save("resources/icon.png")
    build_foreground().save("resources/icon-foreground.png")
    build_background().save("resources/icon-background.png")
    print("resources/icon.png, icon-foreground.png, icon-background.png (1024px)")

    web = rounded(full.convert("RGBA"))
    web.resize((512, 512), Image.LANCZOS).save("public/icon.png")
    # Apple ignores alpha and composites on black, so this one stays square.
    full.resize((180, 180), Image.LANCZOS).convert("RGB").save("public/apple-touch-icon.png")
    print("public/icon.png (512px, rounded), apple-touch-icon.png (180px, square)")

    for src, dst in (("resources/icon.svg", "public/favicon.svg"),):
        with open(src, "rb") as f:
            data = f.read()
        with open(dst, "wb") as f:
            f.write(data)
    print("public/favicon.svg")


if __name__ == "__main__":
    main()
