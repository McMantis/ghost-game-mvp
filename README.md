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

- **Baseline haunt** — ghost presses E near furniture; charges the meter **only if a hunter is within 10m** (proximity rule), always leaves EMF evidence (meter-fill and evidence come from the same action — "a race, not a timer"). **Interactions scale with the meter**: small props (lamps, chairs, pots) are always hauntable; heavy furniture (tables, fridges, wardrobes) unlocks at 50 power and charges more per haunt.
- **Wall-phasing** — the ghost walks through walls freely; every phase leaves glowing residue for 45s, and drains meter *only once charged* (≥ 33).
- **Manifestation meter** — lessers unlock at 33, ultimate at 100, spent when the ghost chooses.
- **Lessers** — `Q` **Hurl** (stagger/interrupt, cost 10) and `C` **Clutter** (barricade nearest doorway, cost 15, hunters shove it clear with a 2s hold).
- **Crush (early kill)** — `X`, cost 35, target must be **isolated** (no teammate within 7m) and **relatively stationary**; 1.6s telegraph (rising block + rumble) then slam. Kills possible at any point in the match.
- **Rampage (ultimate)** — `R` at full meter: the ghost manifests (visible), is **blind for 5s**, then has ~32s to grab hunters. A grabbed hunter is dragged; **6s** undisturbed = execution. Teammates press E next to the victim to tear them free (ghost stunned 3s). Meter resets to 0 after.
- **Identification tools** — EMF tracker (`1`, reads ghost proximity + evidence trails 0–5, plus the ghost's **last active area and coarse power level**) and thermometer (`2`, rooms the ghost lingers in go cold). Both battery-limited, plus a battery-limited flashlight (`F`) — **holding the beam on the (invisible) ghost suppresses its meter gain**.
- **Disruptor** (`Q`) — the key hunter tool. Aim roughly where you think the ghost is and fire: a hit **reveals its trail** (glowing markers for 10s), **drains 10% of its meter**, and **locks all its abilities for 12s**. Long cooldown (40s) whether you hit or miss. Aim margin + cooldown are the top tuning knobs.
- **Ward** — each hunter's defensive item. Tearing a teammate out of a drag-kill (E) consumes your ward; it recharges slowly (90s).
- **Ritual identification puzzle** — **6 ritual objects** are hidden in the house but **only 3 are TRUE**. Using a FALSE object at the circle shatters it and **dumps 25 meter into the ghost** (red screen flash + dissonant sting so everyone knows the hunters fucked up). To deduce the TRUE ones: hold the tracker (EMF) with the ghost within 8m for **3 sustained seconds** — a lock identifies a random object for the whole team (candle flames recolor green/red).
- **One generic ritual** — place the 3 TRUE objects on the circle in the Study, then channel (hold E, interruptible by Hurl). **Speed scales with channelers**: 1 hunter finishes slowly (20s of channeling), 2 at normal speed (12s), 3 fast (~8.5s).
- **Jumpscares** — every hunter death.
- Win conditions: ritual complete → hunters win; all hunters dead → ghost wins.

## Deliberately NOT in (Phase 2 per the doc)

Hunter roles, other ghosts, ghost identification/typing, wrong-ritual penalty (only one ritual exists),
Mimic Evidence / faked tells, object possession, the soundboard/doppelganger system, voice chat
(use Discord for the playtest — proximity VC is a later system).

## Tuning after playtests

Every number the doc calls a "starting position, not a spec" lives in ONE settings file:
**`shared/tune.js`** — meter fill speed, disruptor aim-margin + cooldown + lock duration,
heavy-object unlock threshold, flashlight battery drain + suppression, ward recharge,
ritual speed per number of channelers, movement speeds, ranges, costs. Change, restart, replay.

## Deploying

Any Node host that supports WebSockets works (Render, Railway, Fly.io — **not** Netlify/Vercel static).
Start command: `npm start`; it binds to `process.env.PORT`. A `render.yaml` is included for Render.
