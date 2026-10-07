#!/usr/bin/env python3
"""Move the accent colour. Nothing else about the identity changes.

The identity is silver on black with ONE coloured edge. This moves that edge to another hue
and leaves the silver, the ground and the status colours (pass / caution / fail) alone - a
green that means "this check passed" is not the brand colour and must not follow it.

    scripts/rebrand.py preview            write every variant to brand/variants/ to look at
    scripts/rebrand.py apply violet       recolour the shipped art and the style tokens
    scripts/rebrand.py apply '#19e3ff'    ...or any colour, not just a named one

`apply` rewrites files in place and is meant to be read as a diff before it is committed.
It is idempotent in the useful sense: it only ever moves colours that sit in the CURRENT
accent's hue window, so running it for a second colour moves the first one.

Needs Pillow and numpy:  backend/.venv/bin/python scripts/rebrand.py ...
"""

import colorsys
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent

VARIANTS = {
    "violet": "#a46bff",
    "ice": "#19e3ff",
    "magenta": "#ff3d9a",
}

# The art the accent lives in. Each is recoloured where it sits, so the optical sizing of the
# small icons (a tighter crop and a sharpen at 16 and 32 px) survives untouched.
ART = [
    "frontend/public/icon-512.png",
    "frontend/public/icon-192.png",
    "frontend/public/apple-touch-icon.png",
    "frontend/public/og.png",
    "frontend/public/lockup-bone.png",
    "extension/icons/icon-128.png",
    "extension/icons/icon-48.png",
    "extension/icons/icon-16.png",
]
FAVICON = "frontend/public/favicon.ico"

# Where colours are written out as literals.
STYLES = [
    "frontend/app/globals.css",
    "frontend/components/BrainCanvas.tsx",
    "extension/sidepanel/panel.css",
    "extension/shared/badge.js",
]

# Status colours: pass, caution, fail, in both themes, with their soft grounds and borders.
# They are NOT the accent and must never follow it - a green that means "this check passed"
# is not the brand colour, and neither is the amber of a caution or the red of a fail.
#
# Named here rather than left to the hue window, because the window cannot be trusted with
# them: whatever the accent is, one of these sits near it. The first version of this script
# kept only the greens and used a window 44 degrees wide, and a real run turned every amber
# "caution" in the product pink, then - run again from a cool accent - tinted the dark steel
# text colour as well. Both halves of that are closed here: these are skipped by name, and
# the window is narrow enough that a neighbouring hue is not "the accent, roughly".
KEEP = {
    "#4a7c0f", "#a8e04a", "#1b2613", "#f0f8e2", "#d5e7b4",              # pass
    "#a15c07", "#f2b33d", "#ffc069", "#ffd98a", "#2b2212", "#fdf3e0", "#f0dcb4",  # caution
    "#c62828", "#ff6f5e", "#ff7a70", "#2b1512", "#fdecec", "#f2c9c9", "#4a2020", "#1c0e0e",  # fail
}
KEEP_RGB = {(198, 40, 40)}

# The custom properties that ARE the accent. Their values move whatever their saturation - a
# pale tint of the accent is still the accent, and a chroma floor alone would leave it behind.
ACCENT_TOKENS = ("--accent", "--accent-ink", "--accent-dim", "--accent-bg", "--on-accent", "--signal", "--on-signal")

GROUND_DARK = "#080a0b"
GROUND_LIGHT = "#ffffff"


def rgb_of(hexa):
    h = hexa.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def hex_of(rgb):
    return "#%02x%02x%02x" % tuple(int(round(max(0, min(255, c)))) for c in rgb)


def hue_of(rgb):
    return colorsys.rgb_to_hsv(*(c / 255 for c in rgb))[0] * 360


def luminance(rgb):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def current_accent():
    """The accent the tree carries right now, read from the one place that defines it."""
    css = (ROOT / "frontend/app/globals.css").read_text()
    m = re.search(r'data-theme="dark"\][^}]*?--accent:\s*(#[0-9a-fA-F]{6})', css, re.S)
    return m.group(1).lower() if m else "#b2e604"


def window(hue, centre, half=18.0, soft=8.0):
    """1 inside `half` degrees of `centre`, falling to 0 over the next `soft`."""
    d = np.abs((np.asarray(hue) - centre + 180.0) % 360.0 - 180.0)
    return np.clip((half + soft - d) / soft, 0.0, 1.0)


def recolour_pixels(img, old, new):
    """Move every pixel in the old accent's hue window to the new hue.

    Value and saturation are scaled by the ratio between the two accents, so the brightest
    bevel lands exactly on the new colour and everything dimmer keeps its distance from it -
    a lit edge stays a lit edge, a glow stays a glow. Near-neutral pixels - the silver, the
    black - carry too little chroma to be selected at all.
    """
    rgba = np.asarray(img.convert("RGBA")).astype(np.float32) / 255.0
    rgb, alpha = rgba[..., :3], rgba[..., 3:]
    mx, mn = rgb.max(-1), rgb.min(-1)
    chroma = mx - mn
    sat = np.where(mx > 0, chroma / np.maximum(mx, 1e-6), 0.0)

    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    safe = np.maximum(chroma, 1e-6)
    hue = np.where(mx == r, ((g - b) / safe) % 6, np.where(mx == g, (b - r) / safe + 2, (r - g) / safe + 4)) * 60.0

    oh, os_, ov = colorsys.rgb_to_hsv(*(c / 255 for c in old))
    nh, ns, nv = colorsys.rgb_to_hsv(*(c / 255 for c in new))
    weight = window(hue, oh * 360.0) * np.clip((sat - 0.08) / 0.14, 0.0, 1.0)

    new_sat = np.clip(sat * (ns / max(os_, 1e-6)), 0.0, 1.0)
    val = np.clip(mx * (nv / max(ov, 1e-6)), 0.0, 1.0)
    # hsv -> rgb at the target hue, vectorised
    h6 = nh * 6.0
    i = int(h6) % 6
    f = h6 - int(h6)
    p, q, t = val * (1 - new_sat), val * (1 - f * new_sat), val * (1 - (1 - f) * new_sat)
    turned = np.stack([(val, t, p), (q, val, p), (p, val, t), (p, q, val), (t, p, val), (val, p, q)][i], -1)

    out = rgb * (1 - weight[..., None]) + turned * weight[..., None]
    merged = np.concatenate([out, alpha], -1)
    result = Image.fromarray((np.clip(merged, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA")
    return result if img.mode == "RGBA" else result.convert(img.mode)


def recolour_literal(rgb, old, new, lift_on=None):
    """One colour literal: the new hue, value and saturation scaled by the accents' ratio.

    Scaled rather than kept, so the accent token itself lands EXACTLY on the new colour and
    every tint and shade derived from it keeps its relationship to it.

    `lift_on` is a ground the colour has to be READ against. Lime is far brighter to the eye
    than a violet of the same HSV value, so text tokens are lightened (or darkened, on a
    white ground) until they clear 4.5:1 again rather than being trusted to survive the turn.
    """
    h, s, v = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    oh, os_, ov = colorsys.rgb_to_hsv(*(c / 255 for c in old))
    nh, ns, nv = colorsys.rgb_to_hsv(*(c / 255 for c in new))
    s = min(1.0, s * ns / max(os_, 1e-6))
    v = min(1.0, v * nv / max(ov, 1e-6))
    out = tuple(c * 255 for c in colorsys.hsv_to_rgb(nh, s, v))
    if lift_on is None:
        return out
    dark_ground = luminance(lift_on) < 0.2
    for _ in range(60):
        if contrast(out, lift_on) >= 4.5:
            break
        if dark_ground:
            s, v = max(0.0, s - 0.02), min(1.0, v + 0.02)
        else:
            v = max(0.0, v - 0.02)
        out = tuple(c * 255 for c in colorsys.hsv_to_rgb(nh, s, v))
    return out


def in_window(rgb, old, floor=0.25):
    h, s, _ = colorsys.rgb_to_hsv(*(c / 255 for c in rgb))
    return s > floor and float(window(h * 360.0, hue_of(old))) > 0.0


def recolour_styles(text, old, new):
    """Every literal in the accent's hue window, moved. Status colours are skipped by name."""
    ink_dark = re.search(r'data-theme="dark"\][^}]*?--accent-ink:\s*(#[0-9a-fA-F]{6})', text, re.S)
    ink_light = re.search(r":root\s*\{[^}]*?--accent-ink:\s*(#[0-9a-fA-F]{6})", text, re.S)
    readable = {}
    if ink_dark:
        readable[ink_dark.group(1).lower()] = rgb_of(GROUND_DARK)
    if ink_light:
        readable[ink_light.group(1).lower()] = rgb_of(GROUND_LIGHT)

    # values of the accent's own tokens, wherever else in the file they are repeated
    named = {
        m.group(1).lower()
        for m in re.finditer(r"(?:%s):\s*(#[0-9a-fA-F]{6})" % "|".join(re.escape(t) for t in ACCENT_TOKENS), text)
    }

    def hexa(m):
        lit = m.group(0).lower()
        rgb = rgb_of(lit)
        if lit in KEEP or not in_window(rgb, old, 0.05 if lit in named else 0.25):
            return m.group(0)
        return hex_of(recolour_literal(rgb, old, new, readable.get(lit)))

    def func(m):
        rgb = (int(m[2]), int(m[4]), int(m[6]))
        if rgb in KEEP_RGB or not in_window(rgb, old):
            return m[0]
        r, g, b = (int(round(c)) for c in recolour_literal(rgb, old, new))
        return f"{m[1]}{r}{m[3]}{g}{m[5]}{b}"

    text = re.sub(r"#[0-9a-fA-F]{6}\b", hexa, text)
    return re.sub(r"(rgba?\(\s*)(\d+)(\s*,\s*)(\d+)(\s*,\s*)(\d+)", func, text)


def preview():
    old = rgb_of(current_accent())
    out_dir = ROOT / "brand/variants"
    out_dir.mkdir(parents=True, exist_ok=True)
    mark = Image.open(ROOT / "frontend/public/icon-512.png")
    banner = Image.open(ROOT / "frontend/public/og.png")

    rows = [("current", current_accent(), mark.convert("RGB"), banner.convert("RGB"))]
    for name, hexa in VARIANTS.items():
        new = rgb_of(hexa)
        m, b = recolour_pixels(mark, old, new).convert("RGB"), recolour_pixels(banner, old, new).convert("RGB")
        m.save(out_dir / f"{name}-mark.png")
        b.save(out_dir / f"{name}-banner.png")
        rows.append((name, hexa, m, b))

    # one sheet, so the three can be compared without opening six files
    pad, label_h, h = 28, 44, 420
    mark_w = h
    banner_w = round(h * banner.width / banner.height)
    sheet = Image.new("RGB", (pad * 3 + mark_w + banner_w, pad + len(rows) * (h + label_h + pad)), rgb_of("#0e1113"))
    draw = ImageDraw.Draw(sheet)
    y = pad
    for name, hexa, m, b in rows:
        draw.rectangle([pad, y + 12, pad + 22, y + 34], fill=rgb_of(hexa))
        draw.text((pad + 34, y + 14), f"{name}   {hexa}", fill=rgb_of("#e7ebeb"))
        sheet.paste(m.resize((mark_w, h), Image.LANCZOS), (pad, y + label_h))
        sheet.paste(b.resize((banner_w, h), Image.LANCZOS), (pad * 2 + mark_w, y + label_h))
        y += h + label_h + pad
    sheet.save(out_dir / "preview.png")
    print(f"wrote {len(VARIANTS)} variants and preview.png to {out_dir.relative_to(ROOT)}/")


def apply(colour):
    hexa = VARIANTS.get(colour, colour)
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", hexa or ""):
        sys.exit(f"unknown colour {colour!r} - use one of {', '.join(VARIANTS)} or a #rrggbb")
    old, new = rgb_of(current_accent()), rgb_of(hexa)
    if hex_of(old) == hexa.lower():
        sys.exit(f"the accent is already {hexa}")

    for rel in ART:
        path = ROOT / rel
        recolour_pixels(Image.open(path), old, new).save(path)
    ico = ROOT / FAVICON
    frames = Image.open(ico)
    sizes = sorted(frames.info.get("sizes", {(16, 16), (32, 32), (48, 48)}))
    recoloured = []
    for size in sizes:
        frames.size = size
        recoloured.append(recolour_pixels(frames.copy(), old, new))
    recoloured[-1].save(ico, format="ICO", sizes=sizes, append_images=recoloured[:-1])

    for rel in STYLES:
        path = ROOT / rel
        path.write_text(recolour_styles(path.read_text(), old, new))

    print(f"accent {hex_of(old)} -> {hexa}: {len(ART) + 1} images, {len(STYLES)} style files. Read the diff, then rebuild the site.")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "preview":
        preview()
    elif len(sys.argv) == 3 and sys.argv[1] == "apply":
        apply(sys.argv[2])
    else:
        sys.exit(__doc__)
