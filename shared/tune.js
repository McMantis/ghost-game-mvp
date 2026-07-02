// ============================================================================
// TUNE — THE SETTINGS FILE. Every balance number lives here and nowhere else.
// Change a value, restart the server (npm start), replay. The client receives
// this whole object over the wire at match start, so client and server always
// agree without editing two files.
// ============================================================================

export const TUNE = {
  // ---- meter ----
  METER_MAX: 100,
  LESSER_AT: 33,          // Hurl/Clutter unlock threshold (~1/3 meter per doc)

  // ---- movement speeds (m/s) — client reads these from the sent tune object ----
  HUNTER_WALK: 4,
  HUNTER_SPRINT: 6,
  GHOST_SPEED: 4.8,
  RAMPAGE_SPEED: 6.6,

  // ---- meter fill speed (baseline haunt) ----
  HAUNT_GAIN: 7,          // meter per SMALL-object haunt with a hunter in proximity
  HAUNT_GAIN_HEAVY: 12,   // meter per HEAVY-object haunt (bigger bang, bigger reward)
  HAUNT_RANGE: 2.8,       // ghost must be this close to a prop to haunt it
  PROX_RADIUS: 10,        // a hunter within this of the prop => points (doc's proximity rule)
  HAUNT_CD: 1.4,          // seconds between haunts

  // ---- object-size unlocks (interactions scale with the meter) ----
  // Small props (lamp, cup, chair…) are always hauntable. Heavy props
  // (table, fridge, piano-class furniture) need this much meter.
  HEAVY_HAUNT_AT: 50,

  // ---- wall-phasing ----
  PHASE_COST: 5,          // meter drained per wall-phase, ONLY while charged (doc)
  PHASE_RESIDUE_S: 45,    // residue trail visibility (doc says 30-60s, [OPEN])
  PHASE_CD: 0.6,

  // ---- lessers ----
  HURL_COST: 10,
  HURL_RANGE: 12,
  STAGGER_S: 1.6,         // stagger interrupts ritual channel + tool reading

  CLUTTER_COST: 15,
  CLUTTER_RANGE: 7,       // nearest doorway within this of the ghost
  BARRICADE_S: 25,        // barricade lifetime if not cleared

  // ---- Crush (early, hard, risky kill) ----
  CRUSH_COST: 35,         // "dumps a big chunk of meter" (doc)
  CRUSH_RANGE: 14,
  CRUSH_ISO_RADIUS: 7,    // target is "isolated": no living teammate within this
  CRUSH_MAX_SPEED: 1.7,   // target is "relatively stationary"
  CRUSH_TELE_S: 1.6,      // "a beat to move or break line of sight" (doc, [OPEN])
  CRUSH_KILL_RADIUS: 1.5,

  // ---- Rampage (full-meter kill; meter is spent when the window closes) ----
  RAMPAGE_BLIND_S: 5,     // ghost blind period on manifest (doc: ~5s)
  RAMPAGE_DUR_S: 32,
  GRAB_RANGE: 1.9,
  DRAG_EXEC_S: 6,         // drag this long uninterrupted => execution (doc)
  RESCUE_RANGE: 2.8,      // teammate intervention range
  GRAB_CD: 3,             // after a rescue breaks the grab
  RESCUE_STUN_S: 3,

  // ---- flashlight vs ghost (hold the beam on the ghost to suppress charging) ----
  FLASH_SLOW_FACTOR: 0.3, // haunt meter gain is multiplied by this while the ghost is lit
  FLASH_SLOW_DEG: 20,     // beam half-angle (degrees) that counts as "on the ghost"
  FLASH_SLOW_RANGE: 14,   // beam reach for suppression (m)

  // ---- battery drain (seconds of use from full to empty) ----
  FLASH_BATT_S: 240,
  EMF_BATT_S: 90,         // the EMF doubles as the tracker readout
  THERMO_BATT_S: 90,

  // ---- disruptor (THE key hunter tool — tune aim-margin + cooldown here) ----
  DISRUPT_AIM_DEG: 12,    // aim margin: fire lands if the ghost is within this half-angle
  DISRUPT_RANGE: 16,      // max distance the shot reaches (m)
  DISRUPT_CD_S: 40,       // long cooldown so it can't be spammed
  DISRUPT_DRAIN_FRAC: 0.10, // fraction of MAX meter drained on a hit
  DISRUPT_LOCK_S: 12,     // ghost locked out of ALL abilities for this long (10-15s)
  DISRUPT_TRAIL_S: 10,    // how long the ghost's revealed trail keeps dropping markers
  DISRUPT_TRAIL_STEP_S: 0.4, // one trail marker every this many seconds

  // ---- ward (defensive item: breaks a drag-kill; long recharge) ----
  WARD_RECHARGE_S: 90,    // per-hunter; set very high (e.g. 9999) for one-use-per-match

  // ---- evidence & temperature ----
  EVIDENCE_TTL: 45,       // EMF trace lifetime
  COLD_RATE: 1.8,         // deg/s the ghost's current room cools
  COLD_DECAY: 0.25,       // deg/s rooms warm back up
  TEMP_BASE: 18,
  TEMP_MIN: 1,

  // ---- ritual identification puzzle ----
  RITUAL_OBJECTS: 6,      // ritual objects hidden in the level
  RITUAL_REAL: 3,         // how many are genuine — all must be placed to channel
  // penalty for using a FALSE object: this much meter is dumped into the ghost.
  // Tune how punishing wrong guesses are here.
  WRONG_OBJECT_METER: 25,
  // the clue: keep the tracker (EMF, key 1) on with the ghost within CLUE_RANGE
  // for CLUE_LOCK_S sustained seconds => CLUE_REVEALS objects get identified
  // (team-wide). Tune how obvious the right objects are here.
  CLUE_RANGE: 8,
  CLUE_LOCK_S: 3,
  CLUE_REVEALS: 1,

  // ---- ritual (speed per number of channelers) ----
  CHANNEL_S: 12,          // total channel-seconds of progress needed to banish
  CHANNEL_RANGE: 2.4,
  // progress-seconds gained per real second, indexed by how many hunters are
  // channeling right now: [0 channelers, 1, 2, 3]. One hunter alone CAN finish,
  // just slowly (12 / 0.6 = 20 real seconds at these numbers).
  RITUAL_RATE_BY_CHANNELERS: [0, 0.6, 1.0, 1.4],

  // ---- lobby ----
  MIN_PLAYERS: 2,
  MAX_HUNTERS: 3,
};
