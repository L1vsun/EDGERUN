# The council

Four Claude calls with different prompts, wired like brain regions, arguing about what
the chain is doing. A code gate decides whether the result is worth saying out loud.

    SCOUT      sensory cortex          what is happening      (numbers only, no opinion)
    SKEPTIC    inhibitory prefrontal   why it is a trap       (sees Scout)
    HISTORIAN  hippocampus             what followed before   (sees the run log)
    SYNTHESIS  association cortex      the one call           (sees all three)
    GATE       basal ganglia           speak or stay silent   (code, not a model)

Prompts are plain markdown in `brain/council/` — edit them without touching the code.

## Why it is scheduled and not live

The website is static. Anything it can call, a visitor can read, so an API key cannot
ship in it. The council runs somewhere trusted and publishes `council.json`, which the
site loads like any other file. A round is therefore minutes old, not seconds — the raw
chain data on the page stays live either way.

## Running it

    pip install anthropic
    ANTHROPIC_API_KEY=sk-... python brain/council.py
    python brain/council.py --dry-run     # shows the briefing, calls nothing, costs nothing

Writes `frontend/public/brain/council.json` (what the site reads) and appends to
`brain/council_log.json` (what the Historian remembers next round — commit it).

## Cost

`MODEL` and `MIN_CONFIDENCE` are at the top of `council.py`; the cadence is the cron in
`.github/workflows/council.yml`.

Each round is 4 calls. On `claude-opus-5` ($5/M in, $25/M out) a round is roughly
**$0.10–0.15**, dominated by thinking tokens — but this is an estimate, not a
measurement. The real number is printed after every run and stored in the `usage` field
of `council.json`; trust that over this paragraph.

At that rate: every 4h ≈ $20/month · hourly ≈ $80/month · every 30 min ≈ $160/month.

The shared briefing is sent as a cached system block, so rounds 2–4 of each cycle should
read it from cache rather than paying full price. `usage.cache_read` in the output tells
you whether that is actually happening — if it is 0, the briefing is under the model's
minimum cacheable size and the saving is not there.
