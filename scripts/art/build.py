"""Turn the rendered masters in scripts/art/out/ into the files that ship.

    node scripts/art/render.mjs                        # the masters
    backend/.venv/bin/python scripts/art/build.py      # everything made from them

Writes the site's pictures (WebP, with alpha), the link preview, the brand folder, and every
icon. Small icons are the FLAT mark - at sixteen pixels a rendered object is a smudge - and
the large ones are the render.
"""
import json
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[2]
HERE = pathlib.Path(__file__).parent
OUT = HERE / "out"
BONE, INK = "#fff4ea", "#17060f"
# the ground: pink into orange, at the same angle the site and the cards draw it
GROUND = [(0.0, (0xff, 0x3d, 0x9a)), (0.46, (0xff, 0x5a, 0x6e)), (1.0, (0xff, 0x9a, 0x3d))]
ANGLE = 118
SCENES = ["brain", "graves", "strings", "coins", "receipt"]


def ground(size):
    """The gradient, as a square image. The same maths as CSS `linear-gradient(118deg, ...)`."""
    import math
    import numpy as np
    a = math.radians(ANGLE)
    dx, dy = math.sin(a), -math.cos(a)
    span = abs(size * dx) + abs(size * dy)
    ys, xs = np.mgrid[0:size, 0:size]
    t = ((xs - size / 2) * dx + (ys - size / 2) * dy) / span + 0.5
    out = np.zeros((size, size, 3))
    for (t0, c0), (t1, c1) in zip(GROUND, GROUND[1:]):
        k = np.clip((t - t0) / (t1 - t0), 0, 1)[..., None]
        seg = ((t >= t0) & (t <= t1))[..., None]
        out = np.where(seg, np.array(c0) * (1 - k) + np.array(c1) * k, out)
    out = np.where((t < 0)[..., None], np.array(GROUND[0][1]), out)
    out = np.where((t > 1)[..., None], np.array(GROUND[-1][1]), out)
    return Image.fromarray(out.astype("uint8"), "RGB")


def flat_icon(size, radius=0.22, scale=0.62):
    """The mark, bone on the gradient, on a rounded square. Drawn large and reduced, for clean edges."""
    big = size * 8
    im = rounded(ground(big), radius)
    d = ImageDraw.Draw(im)
    faces = json.loads((HERE / "mark.json").read_text())["faces"]
    xs = [x for f in faces for x, _ in f]
    ys = [y for f in faces for _, y in f]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    ox, oy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    k = big * scale / span
    off = big * 0.035
    for dx, dy, colour in ((off, off, INK), (0, 0, BONE)):   # a hard shadow, then the mark
        for f in faces:
            d.polygon([(big / 2 + (x - ox) * k + dx - off / 2, big / 2 - (y - oy) * k + dy - off / 2) for x, y in f], fill=colour)
    return im.resize((size, size), Image.LANCZOS)


def rounded(im, radius=0.22):
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], radius=int(im.size[0] * radius), fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def main():
    if not (OUT / "brain.png").exists():
        raise SystemExit("no masters: run `node scripts/art/render.mjs` first")
    made = []

    art = ROOT / "frontend" / "public" / "art"
    art.mkdir(parents=True, exist_ok=True)
    for name in SCENES:
        Image.open(OUT / f"{name}.png").convert("RGBA").save(art / f"{name}.webp", "WEBP", quality=88, method=6)
        made.append(art / f"{name}.webp")

    og = Image.open(OUT / "card-og.png").convert("RGB")
    og.save(ROOT / "frontend" / "public" / "og.png", optimize=True)
    og.save(ROOT / "brand" / "banner.png", optimize=True)
    Image.open(OUT / "card-header.png").convert("RGB").save(ROOT / "brand" / "x-header.png", optimize=True)
    logo = Image.open(OUT / "card-logo.png").convert("RGB")
    logo.resize((512, 512), Image.LANCZOS).save(ROOT / "brand" / "logo.png", optimize=True)
    made += [ROOT / "frontend/public/og.png", ROOT / "brand/banner.png", ROOT / "brand/x-header.png", ROOT / "brand/logo.png"]

    # large icons: the render, on its rounded square
    pub = ROOT / "frontend" / "public"
    for size, file in ((512, pub / "icon-512.png"), (192, pub / "icon-192.png"), (128, ROOT / "extension/icons/icon-128.png")):
        rounded(logo.resize((size, size), Image.LANCZOS)).save(file, optimize=True)
        made.append(file)
    # an iOS home-screen icon is masked by the system and must not carry its own corners
    logo.resize((180, 180), Image.LANCZOS).save(pub / "apple-touch-icon.png", optimize=True)
    # small icons: the flat mark
    for size, file in ((48, ROOT / "extension/icons/icon-48.png"), (16, ROOT / "extension/icons/icon-16.png")):
        flat_icon(size).save(file, optimize=True)
        made.append(file)
    flat_icon(48).save(pub / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    made += [pub / "apple-touch-icon.png", pub / "favicon.ico"]

    for f in made:
        print(f"{f.stat().st_size:>8}  {f.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
