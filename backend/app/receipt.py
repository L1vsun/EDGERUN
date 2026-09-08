"""Shareable scan receipts: an OG image and a server-rendered unfurl page.

Why this lives in the backend rather than the static site: a link that unfurls
in Telegram/X needs server-rendered <meta> tags and a real PNG at a stable URL.
GitHub Pages can serve neither for an arbitrary contract address, so the share
link points here, and this page links back into the app.
"""
from __future__ import annotations

import html
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ASSETS = Path(__file__).resolve().parent / "assets"

# Light, Robinhood-native palette — matches the site, so a shared card is
# recognisably ours in a feed full of dark-mode screenshots.
CHARTREUSE = (207, 255, 4)
INK = (10, 14, 4)
BONE = (244, 245, 238)
AMBER = (214, 138, 0)
RED = (200, 40, 40)

VERDICT_GROUND = {"PASS": CHARTREUSE, "CAUTION": (255, 214, 130), "FAIL": (255, 138, 138)}


def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(ASSETS / name), size)


def render_og_image(result: dict) -> bytes:
    """1200x630 verdict card. Renders from real scan fields only."""
    W, H = 1200, 630
    verdict = result.get("verdict", "UNKNOWN")
    ground = VERDICT_GROUND.get(verdict, BONE)

    img = Image.new("RGB", (W, H), BONE)
    d = ImageDraw.Draw(img)

    # Verdict band down the left edge — the thing you read at thumbnail size.
    d.rectangle([0, 0, 26, H], fill=ground)
    d.rectangle([26, 0, W, H], fill=BONE)

    bold = _font("JetBrainsMono-ExtraBold.ttf", 96)
    med = _font("JetBrainsMono-Regular.ttf", 26)
    small = _font("JetBrainsMono-Regular.ttf", 22)
    tiny = _font("JetBrainsMono-Regular.ttf", 19)

    d.text((70, 58), "EDGERUN", font=_font("JetBrainsMono-ExtraBold.ttf", 30), fill=INK)
    d.text((70, 96), "robinhood chain · contract check", font=tiny, fill=(110, 118, 96))

    ticker = result.get("token_symbol") or "unknown token"
    d.text((70, 180), ticker.upper()[:22], font=_font("JetBrainsMono-ExtraBold.ttf", 46), fill=INK)

    addr = result.get("address", "")
    short = f"{addr[:10]}…{addr[-8:]}" if len(addr) > 20 else addr
    d.text((70, 240), short, font=med, fill=(110, 118, 96))

    # The verdict, as large as it will go.
    d.text((70, 310), verdict, font=bold, fill=INK)
    vw = d.textlength(verdict, font=bold)
    d.rectangle([70, 418, 70 + vw, 428], fill=ground)

    # Two or three real facts underneath — never a summary we invented.
    facts: list[str] = []
    for c in (result.get("contract") or {}).get("checks", []):
        if c.get("status") in ("fail", "warn"):
            facts.append(f"{c['status']}  {c['detail']}")
    for c in (result.get("impersonation") or {}).get("checks", []):
        if c.get("status") == "fail":
            facts.append(f"fail  {c['detail']}")
    if not facts:
        facts = [f"ok  {c['detail']}" for c in (result.get("contract") or {}).get("checks", [])
                 if c.get("status") == "ok"]

    y = 462
    for line in facts[:3]:
        d.text((70, y), line[:88], font=small, fill=(60, 66, 48))
        y += 32

    footer = (
        f"facts checked: {result.get('facts_checked', 0)} · "
        f"unresolved: {result.get('unresolved', 0)} · not financial advice"
    )
    d.text((70, H - 52), footer, font=tiny, fill=(130, 138, 116))

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def render_receipt_page(result: dict, site_url: str, og_image_url: str, page_url: str) -> str:
    verdict = html.escape(result.get("verdict", "UNKNOWN"))
    ticker = html.escape(result.get("token_symbol") or "unknown token")
    address = html.escape(result.get("address", ""))
    blockscout = html.escape(result.get("blockscout_url", ""))
    checked = result.get("facts_checked", 0)
    unresolved = result.get("unresolved", 0)

    rows = []
    for lane in ("contract", "impersonation"):
        for c in (result.get(lane) or {}).get("checks", []):
            rows.append(
                f'<div class="row"><span class="s s-{html.escape(c["status"])}">'
                f'{html.escape(c["status"])}</span>{html.escape(c["detail"])}</div>'
            )
    checks_html = "".join(rows)

    desc = f"{ticker} — {verdict}. {checked} facts checked, {unresolved} unresolved on Robinhood Chain."

    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{ticker} — {verdict} · edgerun</title>
<meta name="description" content="{html.escape(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="edgerun">
<meta property="og:title" content="{ticker} — {verdict} · edgerun">
<meta property="og:description" content="{html.escape(desc)}">
<meta property="og:image" content="{html.escape(og_image_url)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="{html.escape(page_url)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{ticker} — {verdict} · edgerun">
<meta name="twitter:description" content="{html.escape(desc)}">
<meta name="twitter:image" content="{html.escape(og_image_url)}">
<style>
:root{{--ink:#0a0e04;--bone:#f4f5ee;--chart:#cfff04;--dim:#6e7660}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bone);color:var(--ink);
font-family:ui-monospace,"JetBrains Mono",Menlo,monospace;padding:32px 20px;line-height:1.6}}
.wrap{{max-width:720px;margin:0 auto}}
.brand{{font-weight:800;letter-spacing:-.03em;font-size:20px}}
.tag{{color:var(--dim);font-size:12px;margin-bottom:28px}}
.card{{background:#fff;border:2px solid var(--ink);box-shadow:6px 6px 0 var(--ink);padding:24px}}
h1{{font-size:38px;margin:0 0 4px;letter-spacing:-.04em}}
.addr{{color:var(--dim);font-size:13px;word-break:break-all;margin-bottom:20px}}
.v{{display:inline-block;font-weight:800;font-size:15px;padding:6px 16px;border:2px solid var(--ink)}}
.v-PASS{{background:var(--chart)}} .v-CAUTION{{background:#ffd682}} .v-FAIL{{background:#ff8a8a}}
.row{{display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #e2e4d6;font-size:13px;align-items:baseline}}
.row:last-child{{border-bottom:none}}
.s{{flex-shrink:0;width:78px;font-weight:700;font-size:11px;text-transform:uppercase}}
.s-ok{{color:#4a7a00}} .s-warn{{color:#a86b00}} .s-fail{{color:#c22}} .s-unresolved{{color:var(--dim)}}
.foot{{margin-top:22px;font-size:12px;color:var(--dim)}}
a{{color:var(--ink)}}
.cta{{display:inline-block;margin-top:22px;background:var(--chart);border:2px solid var(--ink);
box-shadow:4px 4px 0 var(--ink);padding:12px 22px;font-weight:800;text-decoration:none}}
</style></head><body><div class="wrap">
<div class="brand">EDGERUN</div>
<div class="tag">robinhood chain · contract safety + impersonation check</div>
<div class="card">
  <h1>{ticker}</h1>
  <div class="addr">{address}</div>
  <span class="v v-{verdict}">{verdict}</span>
  <div style="margin-top:22px">{checks_html}</div>
  <div class="foot">facts checked: {checked} · unresolved: {unresolved} ·
    <a href="{blockscout}" rel="noreferrer">verify on blockscout</a></div>
</div>
<a class="cta" href="{html.escape(site_url)}">scan another contract →</a>
<div class="foot">Not financial advice. A PASS means the listed structural checks came back
clean — it is not a buy signal.</div>
</div></body></html>"""
