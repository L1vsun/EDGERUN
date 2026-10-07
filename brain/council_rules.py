"""The council without the language models.

Same four regions, same data, same gate, same output schema - but each region reaches its
answer by rule instead of by judgement. This is not a mock of the LLM version: it is the
deterministic version of the same pipeline, and every sentence it emits is computed from a
number the feed reported seconds earlier. When `ANTHROPIC_API_KEY` is set, `council.py`
runs the same regions with real reasoning and writes the identical shape.

The honest limits of rules, which is exactly what the models are for later:
  - Scout can only say what the thresholds already know; it cannot notice the unusual thing
    nobody wrote a rule for.
  - Skeptic recites the trap patterns it was given and no others.
  - Historian matches on flag sets and magnitude, not on meaning.
  - Synthesis weighs by a fixed table; it cannot be argued out of it.
"""
from __future__ import annotations


def _biggest(tokens: list[dict], flag: str) -> list[dict]:
    return sorted([t for t in tokens if flag in t["flags"]], key=lambda t: -t["per_min"])


def scout(snap: dict) -> dict:
    toks = snap["tokens"]
    flagged = [t for t in toks if t["flags"]]
    top = sorted(flagged or toks, key=lambda t: -t["per_min"])[:3]
    moving = snap["tokens_moving"]
    if not flagged:
        head = f"{moving} tokens moving, none of them doing anything unusual"
    else:
        head = f"{moving} tokens moving · {len(flagged)} showing something worth a look"
    out = []
    for t in top:
        if "heating" in t["flags"]:
            what = f"{t['per_min']:.0f} trades/min and running {t['accel']:.1f}x its own hourly average"
        elif "top-heavy" in t["flags"]:
            what = f"{t['per_min']:.0f} trades/min but the ten largest wallets hold {t['top10'] * 100:.0f}% of it"
        elif "mint open" in t["flags"]:
            what = f"the mint authority is still live while {t['traders']} wallets trade it"
        elif "buyers lead" in t["flags"]:
            what = f"{t['buys']} buys against {t['sells']} sells, {t['per_min']:.0f}/min across {t['traders']} wallets"
        else:
            what = f"{t['per_min']:.0f} trades/min across {t['traders']} wallets"
        out.append({"symbol": t["symbol"], "what": what})
    return {"headline": head, "tokens": out, "quiet": not flagged}


def skeptic(snap: dict) -> dict:
    toks = snap["tokens"]
    traps, clean = [], []
    for t in toks:
        if "top-heavy" in t["flags"]:
            traps.append({"symbol": t["symbol"],
                          "why": f"the ten largest wallets hold {t['top10'] * 100:.0f}% of supply - that is a handful of holders, not demand"})
        elif "mint open" in t["flags"]:
            traps.append({"symbol": t["symbol"],
                          "why": "the mint authority is still live - supply can grow under whoever is buying"})
        elif t["trades"] < TOO_SMALL:
            continue  # too small to judge either way; saying nothing is the correct answer
        elif "sellers lead" in t["flags"]:
            traps.append({"symbol": t["symbol"],
                          "why": f"{t['sells']} sells against {t['buys']} buys in five minutes - more leaving than arriving"})
        elif t["buys"] >= t["sells"] * 0.8 and t["top10"] < 0.3:
            clean.append(t["symbol"])
    verdict = (f"{len(traps)} of the {len(toks)} busiest are top-heavy, printable or being sold"
               if traps else "nothing in this window matches a known trap pattern")
    return {"verdict": verdict, "traps": traps[:4], "clean": clean[:5]}


def historian(snap: dict, log: list[dict]) -> dict:
    """Real precedent: find past rounds whose token carried the same flags, and report what
    that token's flow actually did afterwards. No log, no precedent - and it says so."""
    if len(log) < 3:
        return {"precedent": "none yet - the log needs a few more rounds before it can compare",
                "matches": [], "confidence": "none"}

    # index every token we have ever logged: symbol -> [(round index, per_min, flags)]
    seen: dict[str, list[tuple[int, float, tuple]]] = {}
    for i, entry in enumerate(log):
        for t in entry.get("tokens", []):
            seen.setdefault(t["symbol"], []).append((i, t.get("per_min", 0), tuple(t.get("flags", []))))

    matches = []
    for now_t in [t for t in snap["tokens"] if t["flags"]][:3]:
        want = set(now_t["flags"])
        best = None
        for sym, hist in seen.items():
            if sym == now_t["symbol"] or len(hist) < 2:
                continue
            for k, (idx, pm, flags) in enumerate(hist[:-1]):
                overlap = len(want & set(flags))
                if not overlap:
                    continue
                later = hist[-1]
                if later[0] <= idx:
                    continue
                change = (later[1] - pm) / pm if pm > 0 else 0
                score = overlap - abs(len(want) - len(flags)) * 0.5
                if best is None or score > best[0]:
                    best = (score, sym, pm, later[1], change, len(hist))
        if best:
            _, sym, then, now_pm, change, n = best
            direction = "fell" if change < -0.15 else "rose" if change > 0.15 else "held"
            matches.append({
                "now": now_t["symbol"], "before": sym,
                "what_followed": f"{sym} carried the same flags at {then:.0f}/min and its flow {direction} to {now_pm:.0f}/min over {n} rounds",
            })
    if not matches:
        return {"precedent": "nothing in the log carries these flags yet", "matches": [], "confidence": "none"}
    return {"precedent": f"{len(matches)} of today's flagged tokens resemble something already logged",
            "matches": matches, "confidence": "weak" if len(log) < 20 else "fair"}


# what each flag is worth when deciding whether anything deserves saying out loud
# Calibrated so the gate is quiet by default, which on this feed takes deliberate effort: a
# trending list is, by construction, a list of tokens that are heating. One good sign names
# nothing; two name a token to watch and leave the gate shut; only all three together clear
# the bar. SAME NUMBERS AS frontend/lib/council.ts - change one, change the other.
WEIGHT = {"heating": 0.09, "buyers lead": 0.07, "new holders": 0.07,
          "top-heavy": -0.3, "mint open": -0.34, "sellers lead": -0.2, "cooling": -0.12}
BASE_CONFIDENCE = 0.34
MIN_TRADES = 100   # what a token needs behind it before it can be named: a market, not a rumour
MIN_TRADERS = 40
TOO_SMALL = 60     # below this Skeptic says nothing either way


def synthesis(snap: dict, sc: dict, sk: dict, hi: dict) -> dict:
    trapped = {t["symbol"] for t in sk["traps"]}
    best, score = None, 0.0
    for t in snap["tokens"]:
        if t["trades"] < MIN_TRADES or t["traders"] < MIN_TRADERS:
            continue
        if t.get("quote_asset"):
            continue   # SOL, stables: everything is priced against them, so they are always busy
        s = sum(WEIGHT.get(f, 0) for f in t["flags"])
        s += min(0.03, t["per_min"] / 5000)          # a little credit for actually moving - never a flag's worth
        if s > score:
            best, score = t, s
    if best is None or score < 0.15:
        return {"call": "nothing in this window is worth acting on",
                "focus": None,
                "reason": (f"{len(trapped)} of the busiest tokens tripped a trap pattern; "
                           "the rest are trading normally or are too small to read."),
                "confidence": round(min(0.4, score), 2), "overruled": ""}
    conf = round(min(0.86, BASE_CONFIDENCE + score), 2)
    flags = ", ".join(best["flags"])
    overruled = ""
    if best["symbol"] in trapped:
        overruled = f"Skeptic flagged {best['symbol']}; kept it because the flow is broad enough to be worth watching anyway"
        conf = round(conf - 0.2, 2)
    return {
        "call": f"{best['symbol']} is the one to watch - {flags}",
        "focus": best["symbol"],
        "reason": (f"{best['per_min']:.0f} trades/min across {best['traders']} wallets, "
                   f"{best['accel']:.1f}x its own hourly average, top ten hold "
                   f"{best['top10'] * 100:.0f}%, {best['buys']} buys against {best['sells']} sells."),
        "confidence": conf, "overruled": overruled,
    }


def run(snap: dict, log: list[dict]) -> dict:
    sc = scout(snap)
    sk = skeptic(snap)
    hi = historian(snap, log)
    sy = synthesis(snap, sc, sk, hi)
    return {"scout": sc, "skeptic": sk, "historian": hi, "synthesis": sy}
