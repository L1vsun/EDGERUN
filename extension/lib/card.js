// The receipt: one finding, as a picture somebody can post.
//
// A line under a post is seen by the person who installed this. A screenshot of it is seen by
// everybody else, and until now making one was a crop by hand. This draws the finding as a
// till receipt - the brand's own object - with everything a stranger needs to check it:
// what was found, about which address, under which post, read when, and whose record it is.
//
// ---- the rule ----
//
// A receipt says nothing the line did not say. It is built from a result this extension
// already produced, in the words the checks already chose, and it cannot be typed into: there
// is no field here a reader fills in. A picture that travels without its context has to carry
// its own, so three things are on every receipt and cannot be dropped to make room - the full
// address, the time it was read, and the sentence saying whose record a wallet-to-account
// link is.
//
// Two halves. The models are pure and tested. The drawing needs a canvas, so it runs in the
// worker on an OffscreenCanvas and is checked by looking at what it draws.

import { MARK_D } from "./mark.js";

const TONE = { bad: "#c62828", warn: "#a15c07", ok: "#4a7c0f", flat: "#17060f" };
const DOT = { fail: "#c62828", warn: "#a15c07", ok: "#4a7c0f" };
const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const stamp = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const postUrl = (post) => (post?.handle && post?.id ? `x.com/${post.handle}/status/${post.id}` : null);
const RANK = { fail: 0, warn: 1, ok: 2 };

/** Launch facts from an index, as one line. The same four the badge prints under a strip. */
function launchFacts(ctx, now) {
  if (!ctx) return null;
  const parts = [];
  if (ctx.launchpad) parts.push(ctx.launchpad);
  if (ctx.createdAt && now > ctx.createdAt) {
    const mins = Math.floor((now - ctx.createdAt) / 60000);
    parts.push(`${mins < 1 ? "under a minute" : mins < 60 ? `${mins} min` : mins < 2880 ? `${Math.floor(mins / 60)} h` : `${Math.floor(mins / 1440)} days`} old`);
  }
  if (ctx.holders != null) parts.push(`${Number(ctx.holders).toLocaleString("en-US")} holder${Number(ctx.holders) === 1 ? "" : "s"}`);
  if (ctx.top10Pct != null) parts.push(`top 10 hold ${Math.round(ctx.top10Pct)}%`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * A token verdict as a receipt. Pure.
 *
 * `lead` and `label` are the sentence and the short verdict the surface already showed: the
 * receipt repeats them rather than deriving its own, so the picture and the line can never
 * disagree. The headline is the strongest finding's own name, and only a finding can be one.
 */
export function tokenCard(result, { lead = "", label = "", post = null, now = Date.now() } = {}) {
  if (!result?.address) return null;
  const checks = (result.checks || []).filter((c) => c?.detail);
  const found = checks.filter((c) => c.status in RANK).sort((a, b) => RANK[a.status] - RANK[b.status]);
  const strongest = found.find((c) => c.status === "fail" || c.status === "warn");
  const mint = result.chainName === "Solana";
  const tone = result.verdict === "FAIL" ? "bad" : result.verdict === "CAUTION" ? "warn"
    : result.verdict === "OFFICIAL" || (result.verdict === "PASS" && !mint) ? "ok" : "flat";
  // an unresolved row is context; it only gets on the receipt when nothing was established
  const rows = (found.length ? found : checks).slice(0, 4);
  // The line's sentence is very often its strongest finding's sentence, word for word (or cut
  // short). Printed above the rows AND as the first row it reads as padding, so it is kept
  // only when it says something the rows do not.
  const flat = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const said = flat(lead).replace(/ $/, "");
  // compared on how the sentence opens: a surface may print an address in full where the line cut it short
  const repeated = said && rows.some((c) => flat(c.detail).startsWith(said.slice(0, 40)));
  if (repeated) lead = "";
  return {
    kind: "token", tone,
    headline: clip(strongest ? strongest.label : label || result.verdict || "checked", 34).toUpperCase(),
    subject: [result.symbol || null, result.chainName || null].filter(Boolean).join(" · "),
    lead: clip(lead, 220),
    rows: rows.map((c) => ({ label: clip(c.label, 40), text: clip(c.detail, 190), status: c.status })),
    facts: launchFacts(result.context, now),
    refs: [result.address, postUrl(post)].filter(Boolean),
    source: result.ticker
      ? "Counted from a public index of Solana mints. A ticker is not an address."
      : mint ? "The mint was read from the chain; holder and launch figures are an index's count."
        : "Read from the chain and its explorer.",
    at: stamp(now),
  };
}

/**
 * The poster's wallet as a receipt. Pure.
 *
 * `stake` is what the worker's `stake` answer carries. The headline is the loudest TRUE thing
 * in it, in a fixed order: what was sold after the post, then that nothing was, then when it
 * bought. Amber is reserved exactly as it is on the line: the wallet held the token at the
 * post and has sold half or more since.
 */
export function stakeCard(stake, { symbol = null, mint = null, post = null, now = Date.now() } = {}) {
  if (!stake?.handle || !stake?.wallet) return null;
  const f = stake.facts || {};
  let headline = "ON RECORD", tone = "flat";
  if (f.soldAfterPct > 0) {
    headline = f.soldAfterPct >= 99.5 ? "SOLD ALL OF IT AFTER POSTING" : `SOLD ${Math.round(f.soldAfterPct)}% AFTER POSTING`;
    tone = stake.tone === "warn" ? "warn" : "flat";
  } else if (f.heldAtPost && f.soldAfterPct === 0) { headline = "HAS NOT SOLD SINCE THE POST"; tone = "ok"; }
  else if (f.leadMs != null) headline = "BOUGHT BEFORE THE POST";
  else if (f.boughtAfterMs != null) headline = "BOUGHT AFTER POSTING";
  else if (f.holdsPct > 0) headline = "HOLDS IT";
  return {
    kind: "stake", tone, headline,
    subject: [`@${stake.handle}`, symbol ? `$${String(symbol).replace(/^\$/, "")}` : null].filter(Boolean).join(" · "),
    lead: clip(stake.lead, 220),
    rows: (stake.checks || []).slice(0, 4).map((c) => ({ label: clip(c.label, 40), text: clip(c.detail, 190), status: c.status })),
    facts: null,
    refs: [`wallet ${stake.wallet}`, mint ? `mint ${mint}` : null, postUrl(post)].filter(Boolean),
    // the one sentence a wallet receipt may never lose
    source: `Which wallet belongs to @${stake.handle} is an index's attribution (Jupiter), and so are the trades.`,
    at: stamp(now),
  };
}

/** A caption to paste beside the picture: the sentence the line already said, and nothing more. */
export const cardCaption = (model) => (model ? [model.lead || model.headline, "", "Checked with EDGERUN - edgerun.pro"].join("\n") : "");

/* ---- the drawing ---- */

const W = 1080, H = 1350, PAD = 58, SLIP_X = 86, SLIP_W = W - SLIP_X * 2;
const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

/** Break text into lines that fit. Words first; a word longer than the line breaks by character. */
export function wrap(measure, text, width) {
  const out = [];
  let line = "";
  for (const word of String(text).split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) { line = next; continue; }
    if (line) out.push(line);
    line = "";
    let piece = word;
    while (measure(piece) > width && piece.length > 1) {
      let n = piece.length - 1;
      while (n > 1 && measure(piece.slice(0, n)) > width) n--;
      out.push(piece.slice(0, n));
      piece = piece.slice(n);
    }
    line = piece;
  }
  if (line) out.push(line);
  return out;
}

/**
 * Lay the receipt out and, when `paint` is true, draw it. Returns the height the slip needs.
 * One function for both passes, so what is measured is exactly what is drawn.
 */
function layout(ctx, model, top, paint, display) {
  const x = SLIP_X + PAD, width = SLIP_W - PAD * 2;
  let y = top + PAD;
  const set = (font, color, spacing = "0px") => { ctx.font = font; ctx.fillStyle = color; ctx.letterSpacing = spacing; ctx.textBaseline = "alphabetic"; };
  const measure = (s) => ctx.measureText(s).width;
  const text = (s, tx, ty) => { if (paint) ctx.fillText(s, tx, ty); };
  const rule = () => { if (paint) { ctx.save(); ctx.strokeStyle = "#d9c7ba"; ctx.lineWidth = 3; ctx.setLineDash([12, 10]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y); ctx.stroke(); ctx.restore(); } y += 34; };

  // the name, and what this is
  if (paint) { ctx.save(); ctx.translate(x, y - 2); ctx.scale(0.5, 0.5); ctx.fillStyle = "#ff5a6e"; ctx.fill(new Path2D(MARK_D)); ctx.restore(); }
  set(`800 40px ${display}`, "#17060f", "-1.5px"); text("EDGERUN", x + 62, y + 38);
  set(`800 20px ${SANS}`, "#6b5560", "5px"); const r = "RECEIPT"; text(r, x + width - measure(r), y + 36);
  y += 78; rule();

  // the finding
  let size = 112, lines;
  do { set(`800 ${size}px ${display}`, TONE[model.tone] || TONE.flat, `${-size * 0.045}px`); lines = wrap(measure, model.headline, width); size -= 6; } while (lines.length > 2 && size > 52);
  size += 6;
  for (const l of lines) { y += size * 0.86; text(l, x, y); y += size * 0.1; }
  y += 22;
  if (model.subject) { set(`800 34px ${SANS}`, "#17060f", "-0.5px"); y += 30; text(model.subject, x, y); y += 20; }
  if (model.lead) { set(`500 27px ${SANS}`, "#4a3540"); for (const l of wrap(measure, model.lead, width).slice(0, 5)) { y += 36; text(l, x, y); } y += 14; }
  y += 18; rule();

  // the evidence
  for (const row of model.rows) {
    if (paint) { ctx.fillStyle = DOT[row.status] || "#cdbcb0"; ctx.beginPath(); ctx.roundRect(x, y + 2, 16, 16, 4); ctx.fill(); }
    set(`800 19px ${SANS}`, "#6b5560", "2.5px"); text(row.label.toUpperCase(), x + 30, y + 17);
    y += 26;
    set(`500 25px ${SANS}`, "#17060f");
    for (const l of wrap(measure, row.text, width - 30).slice(0, 4)) { y += 33; text(l, x + 30, y); }
    y += 24;
  }
  if (model.facts) { set(`600 22px ${MONO}`, "#6b5560"); for (const l of wrap(measure, model.facts, width)) { y += 30; text(l, x, y); } y += 16; }
  if (model.rows.length || model.facts) { y += 8; rule(); }

  // what it is about, and whose record it is: never dropped
  set(`500 20px ${MONO}`, "#6b5560");
  for (const ref of model.refs) for (const l of wrap(measure, ref, width)) { y += 28; text(l, x, y); }
  y += 16;
  set(`500 20px ${SANS}`, "#6b5560");
  for (const l of wrap(measure, model.source, width)) { y += 27; text(l, x, y); }
  y += 40;
  set(`800 27px ${SANS}`, "#17060f"); text("edgerun.pro", x, y);
  set(`500 20px ${MONO}`, "#6b5560"); const when = `read ${model.at}`; text(when, x + width - measure(when), y);
  return y + PAD - 14 - top;
}

/** Draw `model` onto a 1080 x 1350 context. `display` is the headline face, already loaded. */
export function drawCard(ctx, model, display = SANS) {
  // the ground: the same gradient the site and the art stand on
  const a = 118 * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a), L = Math.abs(W * dx) + Math.abs(H * dy);
  const g = ctx.createLinearGradient(W / 2 - dx * L / 2, H / 2 - dy * L / 2, W / 2 + dx * L / 2, H / 2 + dy * L / 2);
  g.addColorStop(0, "#ff3d9a"); g.addColorStop(0.46, "#ff5a6e"); g.addColorStop(1, "#ff9a3d");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // Evidence gives way before the things a stranger needs: rows are dropped from the end
  // until the slip fits, and the address, the time and the source line are never among them.
  const m = { ...model, rows: [...model.rows] };
  const room = H - 120;
  let h = layout(ctx, m, 0, false, display);
  while (h > room && m.rows.length > 1) { m.rows.pop(); h = layout(ctx, m, 0, false, display); }
  if (h > room && m.lead) { m.lead = ""; h = layout(ctx, m, 0, false, display); }
  const top = Math.max(50, Math.round((H - h - 26) / 2));

  // The slip: a hard shadow, then paper with a torn foot. The shadow is the paper moved right
  // and down, except at the foot: there its teeth stand on the SAME line as the paper's and
  // only reach further. Moved down whole, the shadow fills the gaps between the paper's teeth
  // and the edge reads as a row of black diamonds instead of as torn paper.
  const slip = (ox, oy) => {
    const tw = SLIP_W / 30, base = top + h - 3, depth = 24 + oy;
    const left = SLIP_X + ox, right = SLIP_X + SLIP_W + ox;
    const dip = (px) => { const u = ((px - SLIP_X) / tw) % 1; return base + depth * (1 - Math.abs(2 * (u < 0 ? u + 1 : u) - 1)); };
    // two fills, not one path: the body and the teeth overlap by a hair, and as subpaths of
    // one shape wound in opposite directions that hair comes out as a line of nothing
    ctx.beginPath();
    ctx.roundRect(left, top + oy, SLIP_W, h - oy, [26, 26, 0, 0]);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(left, base);
    ctx.lineTo(left, dip(left));
    for (let px = SLIP_X + tw / 2 * Math.ceil((left - SLIP_X) / (tw / 2) + 1e-9); px < right - 1e-6; px += tw / 2) ctx.lineTo(px, dip(px));
    ctx.lineTo(right, dip(right));
    ctx.lineTo(right, base);
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = "#17060f"; slip(13, 13);
  ctx.fillStyle = "#fff8f1"; slip(0, 0);
  layout(ctx, m, top, true, display);
  return { width: W, height: H };
}

let face = null;

/**
 * Render a model to a PNG data URL. Worker only: it needs OffscreenCanvas.
 * The headline face is the one the side panel carries; without it the system face is used
 * and the receipt is still a receipt.
 */
export async function renderCard(model) {
  if (!model) throw new Error("nothing to put on a receipt");
  if (typeof OffscreenCanvas === "undefined") throw new Error("this browser cannot draw a receipt here");
  let display = SANS;
  try {
    if (!face) {
      const bytes = await (await fetch(chrome.runtime.getURL("sidepanel/fonts/BricolageGrotesque-800.woff2"))).arrayBuffer();
      face = new FontFace("EDGERUN Display", bytes, { weight: "800" });
      await face.load();
      self.fonts.add(face);
    }
    display = `"EDGERUN Display", ${SANS}`;
  } catch { face = null; }
  const canvas = new OffscreenCanvas(W, H);
  drawCard(canvas.getContext("2d"), model, display);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
}
