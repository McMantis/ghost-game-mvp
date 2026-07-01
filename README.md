# Untitled Ghost Game — Phase 1 MVP

A 3D web playtest of the core loop from the design doc: **one Poltergeist vs 1–3 generic hunters**.
The question it exists to answer: *is the cat-and-mouse chase fun before any asymmetry exists?*

## Run it

```
npm install
npm start
```

Open http://localhost:3000 — one player creates a room, everyone else joins with the 4-letter code.
To play over the internet without deploying, the host can tunnel: `npx localtunnel --port 3000` (or ngrok).

## What's in (per the doc's Phase-1 list)

- **Baseline haunt** — ghost presses E near furniture; charges the meter **only if a hunter is within 10m** (proximity rule), always leaves EMF evidence (meter-fill and evidence come from the same action — "a race, not a timer").
- **Wall-phasing** — the ghost walks through walls freely; every phase leaves glowing residue for 45s, and drains meter *only once charged* (≥ 33).
- **Manifestation meter** — lessers unlock at 33, ultimate at 100, spent when the ghost chooses.
- **Lessers** — `Q` **Hurl** (stagger/interrupt, cost 10) and `C` **Clutter** (barricade nearest doorway, cost 15, hunters shove it clear with a 2s hold).
- **Crush (early kill)** — `X`, cost 35, target must be **isolated** (no teammate within 7m) and **relatively stationary**; 1.6s telegraph (rising block + rumble) then slam. Kills possible at any point in the match.
- **Rampage (ultimate)** — `R` at full meter: the ghost manifests (visible), is **blind for 5s**, then has ~32s to grab hunters. A grabbed hunter is dragged; **6s** undisturbed = execution. Teammates press E next to the victim to tear them free (ghost stunned 3s). Meter resets to 0 after.
- **Identification tools** — EMF reader (`1`, reads ghost proximity + evidence trails, 0–5 lights + beeps) and thermometer (`2`, rooms the ghost lingers in go cold). Both battery-limited, plus a battery-limited flashlight (`F`).
- **One generic ritual** — find 3 candles scattered in the house, place them on the circle in the Study, then channel (hold E, 12s total, interruptible by Hurl).
- **Jumpscares** — every hunter death.
- Win conditions: ritual complete → hunters win; all hunters dead → ghost wins.

## Deliberately NOT in (Phase 2 per the doc)

Hunter roles, other ghosts, ghost identification/typing, wrong-ritual penalty (only one ritual exists),
Mimic Evidence / faked tells, object possession, the soundboard/doppelganger system, voice chat
(use Discord for the playtest — proximity VC is a later system).

## Tuning after playtests

Every number the doc calls a "starting position, not a spec" lives in one block:
`server/game.js` → `TUNE` (meter costs, thresholds, telegraph time, drag time, ranges, battery life…).
Movement speeds are in there too. Change, restart, replay.

## Deploying

Any Node host that supports WebSockets works (Render, Railway, Fly.io — **not** Netlify/Vercel static).
Start command: `npm start`; it binds to `process.env.PORT`. A `render.yaml` is included for Render.
