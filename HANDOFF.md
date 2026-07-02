# HANDOFF — Untitled Ghost Game MVP (read this first in a new session)

## What this project is

A 3D multiplayer web playtest of the Phase-1 MVP from the "Untitled Ghost Game V2" design doc
(Google Drive → "Untitled Ghost Game" folder → "AI Summary v2" doc, owned by jmcmanus1193@gmail.com).
Purpose: test whether the core cat-and-mouse loop (1 Poltergeist vs 1–3 generic hunters) is fun
before any role asymmetry exists. Built 2026-07-01/02.

- **Location:** `D:\ghost-game-mvp` (D-drive on purpose — Jacob's OneDrive Desktop is full)
- **GitHub:** https://github.com/McMantis/ghost-game-mvp (pushed through commit `bc86c39`)
- **Stack:** Node ESM server (`express` + `ws`), Three.js client via CDN importmap, no build step
- **Run:** `npm start` in the project root → http://localhost:3000. Room-code lobby (4 letters),
  first player is host, host starts. Remote friends: `npx localtunnel --port 3000`.
- There is also a `.claude/launch.json` in the old session's cwd
  (`C:\Users\jacob\OneDrive\Desktop\Bibs&Aprons\MVP`) with a "ghost-game" preview config.

## ⚠️ OPEN BUG — fix this first (diagnosed, one-line fix, NOT yet applied)

**Symptom:** any WASD press teleports you back to spawn with a red banner
`camera state went NaN (pos NaN,1.6,NaN …)`. Mouse-look works fine.

**Root cause (confirmed):** `public/js/game.js:368-369` reads movement speeds from the
server-sent tuning object — `t.HUNTER_WALK`, `t.HUNTER_SPRINT`, `t.GHOST_SPEED`,
`t.RAMPAGE_SPEED` — but the `TUNE` block in `server/game.js` **never defines those four keys**
(grep confirms zero hits). So `speed = undefined` → velocity NaN → position NaN.
The NaN self-heal guard then resets to spawn each frame, which is the "teleporting" Jacob saw.

**Fix:** add to the `TUNE` object in `server/game.js` (with the other tuning constants):

```js
HUNTER_WALK: 4,
HUNTER_SPRINT: 6,
GHOST_SPEED: 4.8,
RAMPAGE_SPEED: 6.6,
```

Then **restart the server** (it's a server-side file) and hard-refresh clients.
Verify by actually pressing WASD in a real browser — automated tests missed this because they
teleported positions instead of pressing keys. `scripts/testroom.js` (see below) makes solo
verification easy.

## Architecture (files)

- `server/index.js` — HTTP static + WebSocket room manager (4-letter codes, 1 game per room)
- `server/game.js` — ALL game rules, server-authoritative: meter, evidence, temps, kills,
  ritual, win/lose. **`TUNE` at the top holds every balance number** (the design doc calls them
  "starting positions, not specs" — tune here after playtests)
- `shared/map.js` — house layout (8 rooms, walls with door gaps, furniture props, ritual circle
  in the Study, component spawn spots, player spawns). Used by both server and client
- `public/js/main.js` — lobby/screen flow, net handlers, global error banner (`window.__reportErr`),
  `window.__match` debug hook (set after match start; lets you drive the game from the console)
- `public/js/game.js` — the Match class: FPS controls, collision, abilities, HUD, effects, spectator
- `public/js/world.js` — Three.js scene build (house, props, lights) + mesh factories
- `public/js/audio.js` — all-procedural WebAudio sfx (knocks, EMF beeps, heartbeat, scream…)
- `scripts/bot.js` — headless client: `node scripts/bot.js CODE Name logfile [role]`; remote-control
  via `<logfile>.cmd` (`move x z`, `int pickup comp0`, `raw {json}`)
- `scripts/selftest.js` — deterministic protocol test (grab→rescue→regrab→execution), 7 checks,
  needs server running: `node scripts/selftest.js`
- `scripts/testroom.js` — solo-play helper: hosts a room, prints the code, takes whichever role the
  human doesn't pick, auto-starts; as ghost it rattles the hallway side table so a hunter sees activity

## Game rules as implemented (per the doc's Phase-1 list)

- Baseline haunt: ghost E near furniture; +7 meter ONLY if a living hunter is within 10m of the prop;
  always drops an EMF evidence trace (decays 45s). Meter and evidence are the same action = the doc's
  "race, not a timer".
- Meter 0–100; Hurl (Q, cost 10) + Clutter (C, cost 15, barricades nearest doorway, hunters clear with
  2s hold-E) unlock at 33; Crush (X, cost 35) needs target isolated (no teammate within 7m) AND
  slow-moving; 1.6s rising-block telegraph then slam. Rampage (R) at 100: ghost manifests visible,
  blind 5s, ~32s window, E-grab → 6s drag → execution; teammate within 2.8m presses E to rescue
  (ghost stunned 3s). Meter zeroes when the window ends.
- Wall-phasing: ghost walks through walls; glowing residue decal for 45s; drains 5 meter per phase
  only when meter ≥ 33.
- Hunters: EMF reader (1), thermometer (2), flashlight (F, now ON by default) — all battery-limited.
  Ritual: find 3 candles, carry one at a time to the circle in the Study, then hold-E channel 12s
  (staggers interrupt; progress persists). Ritual done = hunters win; all hunters dead = ghost wins.
  Dead hunters spectate (fly cam). Jumpscare + scream on death.
- Server sends personalized state 15Hz: hunters never receive ghost position (EMF/dread/temps are
  computed server-side); ghost pos goes out only while manifested/dragging.

## Debugging affordances (added during playtest round 2)

- Red top banner shows any JS error on-screen ("screenshot this for Claude")
- Tiny bottom-left debug line: `fps | pos | yaw | pitch | lock:Y/N`
- NaN camera self-heal (reset to spawn + banner) — this is what surfaced the open bug
- Mousemove spike guard (Chrome fires bogus giant deltas right after pointer lock)
- `window.__match` in the console: `.pos.set(x,1.6,z)`, `.net.send({t:'act',kind:'haunt',propId:'sidetable'})`, `.state`

## Bugs already found & fixed (don't re-hunt these)

1. Residue/barricade events never reached clients — `{t:'ev', ...obj}` spread where obj had its own
   `t` (timestamp) overwriting the message type. Fixed by renaming to `born` + explicit fields.
2. "Grey/black screen at spawn" — players spawned ~1.3m from a wall FACING it; flashlight at
   point-blank = huge flat grey blob, light off = black wall. Fixed: hunters spawn facing east down
   the long hallway (yaw −π/2), ghost faces the dining door (yaw π); flashlight softened
   (intensity 38, penumbra 0.6); "CLICK TO TAKE CONTROL" overlay shows whenever pointer lock is lost.
3. Barricade clear id compared with strict `===` against possibly-string id → `String()` both sides.

## Deployment status (unresolved)

- Repo is on GitHub (user "McMantis", credentials cached in git). `render.yaml` included, but
  **Render requires a credit card** for free workspaces — Jacob declined. No card-free host chosen yet;
  Glitch (import from GitHub) or a localtunnel for sessions were the candidate options.
  Claude-in-Chrome extension blocks render.com/railway.app/localhost — only github.com was allowed.
- For now playtests run locally + `npx localtunnel --port 3000`.

## Next steps

1. Apply the TUNE speed fix above, restart, verify WASD movement in a real browser, commit + push.
2. Full human playtest (Jacob + Andrew) — the actual "is it fun?" question. Numbers will need tuning
   in `TUNE` (the doc expects this).
3. Pick a card-free host when Jacob decides (or keep tunneling).
4. Watch list from the doc: Crush telegraph timing ("a beat to move"), residue duration, whether the
   early game feels threatening-but-survivable.
