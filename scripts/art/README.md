# The brand art

Everything the brand shows - the logo, the icons, the link preview, the pictures on the site -
is made here from one outline, so that changing any of it is a change to a script and not a
session in a drawing program.

| file | what it does |
|---|---|
| `mark-source.png` | the mark as it originally existed: a raster |
| `trace_mark.py` | traces its white faces into polygons: `mark.json`, `mark.path.txt`, and `frontend/lib/mark.ts` for the site |
| `render.html` | the scenes. The mark extruded into a solid, and a few plain objects, lit like a product shot. Each renders on a transparent ground that only catches the shadow |
| `cards.html` | the flat cards built from the renders: link preview, X header, logo |
| `render.mjs` | renders every scene and card to `out/` (not committed) with a headless Chrome |
| `build.py` | turns `out/` into the files that ship |

```
backend/.venv/bin/python scripts/art/trace_mark.py     # only if the mark itself changed
node scripts/art/render.mjs                            # needs the network: three.js and the font
backend/.venv/bin/python scripts/art/build.py
```

`render.mjs` looks for the Chromium that Playwright installs; set `CHROME` to use another.
One scene to look at while changing it: serve this folder and open
`render.html?scene=graves&samples=32`.

## What it writes

- `frontend/public/art/*.webp` - the pictures on the site, with alpha, so one file sits on
  the gradient, the bone field or the dark one
- `frontend/public/og.png`, `brand/banner.png` - the link preview (1200x630)
- `brand/x-header.png` - the profile header (1500x500)
- `brand/logo.png` - the avatar (512)
- `extension/icons/`, `frontend/public/icon-*.png`, `apple-touch-icon.png`, `favicon.ico`

Small icons are the flat mark; at sixteen pixels a rendered object is a smudge.

## The colours

| | |
|---|---|
| ground | `linear-gradient(118deg, #ff3d9a 0%, #ff5a6e 46%, #ff9a3d 100%)` - pink running into orange |
| coral | `#ff5a6e` - the gradient's middle, and the one flat accent: buttons, hard shadows, the bright objects |
| deep | `#b5123f` - the sides of the mark, the dark objects |
| bone | `#fff4ea` - the paper |
| ink | `#17060f` - the type and every outline |

The same three stops are written in four places and have to move together: `cards.html`,
`build.py` (`GROUND`), the site's `--c-ground` in `frontend/app/globals.css`, and the side
panel's `--sunset` in `extension/sidepanel/panel.css`.

Red, amber and green are not in this table on purpose. They are the extension's verdict
colours and are never used to decorate anything. The gradient's coral and orange sit next to
them, which is why the extension's badges take only the pink from it: a card standing on a
coral or an orange shadow would read as a verdict.

## Soft shadows

The scene is drawn sixty-four times with the key light moved across a disc and the frames are
averaged - in floats, read straight off the drawing buffer. Blending the frames onto a canvas
would be simpler and is wrong at exactly the shadow's edge, where a transparent pixel drawn
"over" an accumulated one leaves it untouched instead of pulling it toward nothing.
