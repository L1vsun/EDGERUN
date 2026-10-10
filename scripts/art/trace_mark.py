"""Trace the brain mark out of mark-source.png into polygons.

The mark only ever existed as a raster (mark-source.png, the logo as it was before the art
was rendered from it). Everything in the brand art is extruded from its outline, so the
outline is recovered once, here, and written to mark.json: the white faces of the logo, each
as one closed polygon, in a square of -1..1 with y pointing up.

    backend/.venv/bin/python scripts/art/trace_mark.py

The faces are straight-edged, so the trace is simplified hard (Ramer-Douglas-Peucker) and the
result is a few dozen corners rather than a few thousand pixels.
"""
import json
import pathlib
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = pathlib.Path(__file__).with_name("mark-source.png")
OUT = pathlib.Path(__file__).with_name("mark.json")
SCALE = 4          # trace on an upsampled image so corners land between source pixels
EPSILON = 2.2      # simplification tolerance, in source pixels
MIN_AREA = 150     # specks below this many source pixels are antialiasing, not faces


def components(mask):
    """Label 4-connected regions. Returns (labels, count)."""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    count = 0
    for y0, x0 in zip(*np.nonzero(mask)):
        if labels[y0, x0]:
            continue
        count += 1
        stack = [(y0, x0)]
        labels[y0, x0] = count
        while stack:
            y, x = stack.pop()
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = count
                    stack.append((ny, nx))
    return labels, count


def boundary(region):
    """Outer boundary of one region, as pixel-corner coordinates, by walking its edge."""
    h, w = region.shape
    pad = np.zeros((h + 2, w + 2), dtype=bool)
    pad[1:-1, 1:-1] = region
    ys, xs = np.nonzero(pad)
    start = (int(ys.min()), int(xs[ys == ys.min()].min()))
    # walk the crack between inside and outside, keeping the region on the right
    y, x = start
    path = [(x, y)]
    dx, dy = 1, 0
    px, py = x, y
    for _ in range(8 * pad.size):
        # the four cells around corner (px, py): which are inside
        def cell(cx, cy):
            return 0 <= cy < pad.shape[0] and 0 <= cx < pad.shape[1] and pad[cy, cx]
        # moving along (dx, dy): the cell to the right and to the left ahead of the corner
        if (dx, dy) == (1, 0):
            right, left = cell(px, py), cell(px, py - 1)
        elif (dx, dy) == (0, 1):
            right, left = cell(px - 1, py), cell(px, py)
        elif (dx, dy) == (-1, 0):
            right, left = cell(px - 1, py - 1), cell(px - 1, py)
        else:
            right, left = cell(px, py - 1), cell(px - 1, py - 1)
        if right and not left:
            pass                      # straight on
        elif right and left:
            dx, dy = dy, -dx          # turn left
        else:
            dx, dy = -dy, dx          # turn right
            if (px, py) == (x, y) and len(path) > 1 and (dx, dy) == (1, 0):
                break
            continue
        px, py = px + dx, py + dy
        if (px, py) == (x, y):
            break
        path.append((px, py))
    return [(a - 1, b - 1) for a, b in path]


def rdp(points, eps):
    """Ramer-Douglas-Peucker on an open polyline."""
    if len(points) < 3:
        return points
    a, b = np.array(points[0], float), np.array(points[-1], float)
    seg = b - a
    norm = np.hypot(*seg) or 1.0
    pts = np.array(points, float)
    dist = np.abs(seg[0] * (pts[:, 1] - a[1]) - seg[1] * (pts[:, 0] - a[0])) / norm
    i = int(dist.argmax())
    if dist[i] <= eps:
        return [points[0], points[-1]]
    return rdp(points[: i + 1], eps)[:-1] + rdp(points[i:], eps)


def simplify_closed(points, eps):
    """RDP on a closed ring: split at the two points furthest apart, simplify each half."""
    pts = np.array(points, float)
    far = int(((pts - pts[0]) ** 2).sum(1).argmax())
    a = rdp(points[: far + 1], eps)
    b = rdp(points[far:] + [points[0]], eps)
    return a[:-1] + b[:-1]


def area(poly):
    p = np.array(poly, float)
    return 0.5 * float(np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1]))


def main():
    img = Image.open(SRC).convert("RGB")
    size = img.size[0]
    big = np.asarray(img.resize((size * SCALE, size * SCALE), Image.LANCZOS)).astype(int)
    # a face is near-white: bright, and with no colour cast (the bevels are magenta)
    white = (big.min(axis=2) > 170) & ((big.max(axis=2) - big.min(axis=2)) < 60)
    labels, count = components(white)
    faces = []
    for i in range(1, count + 1):
        region = labels == i
        if region.sum() < MIN_AREA * SCALE * SCALE:
            continue
        ring = boundary(region)
        poly = simplify_closed(ring, EPSILON * SCALE)
        if len(poly) < 3:
            continue
        # to -1..1, y up, counter-clockwise
        norm = [((x / SCALE) / size * 2 - 1, 1 - (y / SCALE) / size * 2) for x, y in poly]
        if area(norm) < 0:
            norm.reverse()
        faces.append([[round(x, 4), round(y, 4)] for x, y in norm])
    faces.sort(key=lambda f: -abs(area(f)))
    OUT.write_text(json.dumps({"source": "scripts/art/mark-source.png", "faces": faces}))
    # The same outline as one SVG path, for everything flat: the site's header, the favicon,
    # the stamp on the extension's badge. Scaled to a 100-unit box with y pointing down.
    xs = [x for f in faces for x, _ in f]
    ys = [y for f in faces for _, y in f]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    ox, oy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    def pt(x, y):
        return f"{50 + (x - ox) / span * 100:.1f} {50 - (y - oy) / span * 100:.1f}"
    path = "".join("M" + "L".join(pt(x, y) for x, y in f) + "Z" for f in faces)
    (ROOT / "frontend" / "lib" / "mark.ts").write_text(
        "// Generated by scripts/art/trace_mark.py. Do not edit by hand.\n"
        "// The brain mark as one path in a 100 x 100 box.\n"
        f'export const MARK_PATH =\n  "{path}";\n')
    OUT.with_name("mark.path.txt").write_text(path + "\n")
    print(f"{len(faces)} faces, {sum(len(f) for f in faces)} corners -> {OUT.relative_to(ROOT)}")
    # an SVG to look at: the trace over nothing, so a bad corner is obvious
    svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1.1 -1.1 2.2 2.2" width="600" height="600"><rect x="-1.1" y="-1.1" width="2.2" height="2.2" fill="#ff3d9a"/>']
    for f in faces:
        svg.append('<polygon fill="#fff4ea" stroke="#17060f" stroke-width="0.006" points="%s"/>' % " ".join(f"{x},{-y}" for x, y in f))
    svg.append("</svg>")
    pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else OUT.with_suffix(".svg")).write_text("\n".join(svg))


if __name__ == "__main__":
    sys.setrecursionlimit(100000)
    main()
