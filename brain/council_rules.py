"""The council without the language models.

Same four regions, same data, same gate, same output schema - but each region reaches its
answer by rule instead of by judgement. This is not a mock of the LLM version: it is the
deterministic version of the same pipeline, and every sentence it emits is computed from a
number measured on-chain seconds earlier. When `ANTHROPIC_API_KEY` is set, `council.py`
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
            what = f"{t['per_min']:.0f} transfers/min and running {t['accel']:.1f}x its own average"
        elif "one wallet" in t["flags"]:
            what = f"{t['per_min']:.0f} transfers/min but one address touches {t['one_addr_share'] * 100:.0f}% of them"
        elif "printing" in t["flags"]:
            what = f"{t['mints']} mints against {t['burns']} burns while {t['wallets']} wallets hold it"
        elif "dex live" in t["flags"]:
            what = f"{t['swaps']} swaps and {t['per_min']:.0f} transfers/min across {t['wallets']} wallets"
        else:
            what = f"{t['per_min']:.0f} transfers/min across {t['wallets']} wallets"
        out.append({"symbol": t["symbol"], "what": what})
    return {"headline": head, "tokens": out, "quiet": not flagged}


def skeptic(snap: dict) -> dict:
    toks = snap["tokens"]
    traps, clean = [], []
    for t in toks:
        if "one wallet" in t["flags"]:
            traps.append({"symbol": t["symbol"],
                          "why": f"one address is on {t['one_addr_share'] * 100:.0f}% of {t['transfers']} transfers - that is one actor, not demand"})
        elif "printing" in t["flags"]:
            traps.append({"symbol": t["symbol"],
                          "why": f"{t['mints']} mints against only {t['burns']} burns - supply is growing under whoever is buying"})
        elif t["transfers"] < 20:
            continue  # too small to judge either way; saying nothing is the correct answer
        elif t["swaps"] == 0 and t["per_min"] > 60:
            traps.append({"symbol": t["symbol"],
                          "why": f"{t['per_min']:.0f} transfers/min and no DEX swap in the window - movement with no visible way out"})
        elif t["swaps"] >= 3 and t["one_addr_share"] < 0.4:
            clean.append(t["symbol"])
    verdict = (f"{len(traps)} of the {len(toks)} busiest look like one actor or fresh supply"
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
WEIGHT = {"heating": 0.34, "dex live": 0.2, "fresh wallets": 0.16,
          "one wallet": -0.3, "printing": -0.34, "cooling": -0.12}


def synthesis(snap: dict, sc: dict, sk: dict, hi: dict) -> dict:
    trapped = {t["symbol"] for t in sk["traps"]}
    best, score = None, 0.0
    for t in snap["tokens"]:
        if t["transfers"] < 20:
            continue
        if t.get("quote_asset"):
            continue   # WETH, stables: everything is priced against them, so they are always busy
        s = sum(WEIGHT.get(f, 0) for f in t["flags"])
        s += min(0.16, t["per_min"] / 2500)          # a little credit for actually moving
        if s > score:
            best, score = t, s
    if best is None or score < 0.3:
        return {"call": "nothing in this window is worth acting on",
                "focus": None,
                "reason": (f"{len(trapped)} of the busiest tokens look like a single actor; "
                           "the rest are moving normally or are too small to read."),
                "confidence": round(min(0.4, score), 2), "overruled": ""}
    conf = round(min(0.86, 0.42 + score), 2)
    flags = ", ".join(best["flags"])
    overruled = ""
    if best["symbol"] in trapped:
        overruled = f"Skeptic flagged {best['symbol']} as a single actor; kept it because the flow is broad enough to be worth watching anyway"
        conf = round(conf - 0.2, 2)
    return {
        "call": f"{best['symbol']} is the one to watch - {flags}",
        "focus": best["symbol"],
        "reason": (f"{best['per_min']:.0f} transfers/min across {best['wallets']} wallets, "
                   f"{best['accel']:.1f}x its own average, one address on "
                   f"{best['one_addr_share'] * 100:.0f}% of transfers, {best['swaps']} swaps."),
        "confidence": conf, "overruled": overruled,
    }


def run(snap: dict, log: list[dict]) -> dict:
    sc = scout(snap)
    sk = skeptic(snap)
    hi = historian(snap, log)
    sy = synthesis(snap, sc, sk, hi)
    return {"scout": sc, "skeptic": sk, "historian": hi, "synthesis": sy}
