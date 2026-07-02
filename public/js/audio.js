// SFX are procedural WebAudio; menu music is the one asset file (audio/menu_music.mp3).
let ctx = null;
let master = null;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
export function unlock() { ac(); }

let noiseBuf = null;
function noise() {
  const c = ac();
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  return src;
}

function env(gainNode, t0, a, peak, dur) {
  gainNode.gain.setValueAtTime(0.0001, t0);
  gainNode.gain.exponentialRampToValueAtTime(peak, t0 + a);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
}

// distance -> volume (rough positional audio)
const distVol = d => Math.max(0, Math.min(1, 1.2 - d / 18));

export function knock(dist = 0) {
  const v = distVol(dist); if (v <= 0) return;
  const c = ac(), t = c.currentTime;
  const n = noise(), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'lowpass'; f.frequency.value = 320;
  env(g, t, 0.005, 0.7 * v, 0.16);
  n.connect(f).connect(g).connect(master);
  n.start(t); n.stop(t + 0.2);
}

export function scrape(dist = 0) {
  const v = distVol(dist); if (v <= 0) return;
  const c = ac(), t = c.currentTime;
  const n = noise(), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.frequency.setValueAtTime(180, t); f.frequency.linearRampToValueAtTime(90, t + 0.7);
  env(g, t, 0.05, 0.5 * v, 0.8);
  n.connect(f).connect(g).connect(master);
  n.start(t); n.stop(t + 0.85);
}

export function whoosh(dist = 0) {
  const v = distVol(dist); if (v <= 0) return;
  const c = ac(), t = c.currentTime;
  const n = noise(), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.frequency.setValueAtTime(2000, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.4);
  env(g, t, 0.03, 0.35 * v, 0.45);
  n.connect(f).connect(g).connect(master);
  n.start(t); n.stop(t + 0.5);
}

export function thud(dist = 0) {
  const v = distVol(dist); if (v <= 0) return;
  const c = ac(), t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
  env(g, t, 0.005, 0.9 * v, 0.3);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.35);
}

export function rumble(dur = 1.6, dist = 0) {
  const v = distVol(dist); if (v <= 0) return;
  const c = ac(), t = c.currentTime;
  const n = noise(), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'lowpass'; f.frequency.value = 70;
  env(g, t, 0.15, 0.8 * v, dur);
  n.connect(f).connect(g).connect(master);
  n.start(t); n.stop(t + dur + 0.1);
}

export function slam(dist = 0) {
  const v = Math.max(0.25, distVol(dist));
  const c = ac(), t = c.currentTime;
  const n = noise(), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'lowpass'; f.frequency.value = 200;
  env(g, t, 0.004, 1.1 * v, 0.5);
  n.connect(f).connect(g).connect(master);
  n.start(t); n.stop(t + 0.55);
  thud(dist);
}

export function scream() {
  const c = ac(), t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(700, t);
  o.frequency.exponentialRampToValueAtTime(1400, t + 0.12);
  o.frequency.exponentialRampToValueAtTime(250, t + 0.9);
  f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2;
  env(g, t, 0.01, 0.9, 1.0);
  o.connect(f).connect(g).connect(master);
  o.start(t); o.stop(t + 1.05);
  const n = noise(), ng = c.createGain(), nf = c.createBiquadFilter();
  nf.type = 'highpass'; nf.frequency.value = 900;
  env(ng, t, 0.01, 0.5, 0.9);
  n.connect(nf).connect(ng).connect(master);
  n.start(t); n.stop(t + 0.95);
}

export function roar() {
  const c = ac(), t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(60, t);
  o.frequency.linearRampToValueAtTime(140, t + 0.5);
  o.frequency.linearRampToValueAtTime(45, t + 1.6);
  f.type = 'lowpass'; f.frequency.value = 400;
  env(g, t, 0.05, 0.9, 1.8);
  o.connect(f).connect(g).connect(master);
  o.start(t); o.stop(t + 1.9);
  rumble(2.2, 0);
}

// disruptor fire: a sharp electric crackle
export function zap(dist = 0) {
  const v = Math.max(0.2, distVol(dist));
  const c = ac(), t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(1800, t);
  o.frequency.exponentialRampToValueAtTime(220, t + 0.28);
  env(g, t, 0.005, 0.5 * v, 0.3);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + 0.35);
  const n = noise(), nf = c.createBiquadFilter(), ng = c.createGain();
  nf.type = 'highpass'; nf.frequency.value = 2500;
  env(ng, t, 0.005, 0.3 * v, 0.18);
  n.connect(nf).connect(ng).connect(master);
  n.start(t); n.stop(t + 0.2);
}

// wrong ritual object: a dissonant power-surge sting — unmistakably "we fucked up"
export function backfire() {
  const c = ac(), t = c.currentTime;
  for (const f0 of [220, 233, 110]) { // minor-second clash + sub
    const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.4, t + 0.9);
    f.type = 'lowpass'; f.frequency.value = 900;
    env(g, t, 0.02, 0.4, 1.1);
    o.connect(f).connect(g).connect(master);
    o.start(t); o.stop(t + 1.15);
  }
  slam(0);
}

export function chime() {
  const c = ac(), t = c.currentTime;
  for (const [i, fr] of [660, 880].entries()) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = fr;
    env(g, t + i * 0.08, 0.01, 0.25, 0.5);
    o.connect(g).connect(master);
    o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.55);
  }
}

export function banish() {
  const c = ac(), t = c.currentTime;
  for (const [i, fr] of [440, 550, 660, 880].entries()) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = fr;
    env(g, t + i * 0.12, 0.02, 0.3, 1.2);
    o.connect(g).connect(master);
    o.start(t + i * 0.12); o.stop(t + i * 0.12 + 1.3);
  }
}

// ---- continuous loops ----

let beepTimer = null, beepLevel = 0;
export function setEmfBeep(level) {
  if (level === beepLevel) return;
  beepLevel = level;
  if (beepTimer) { clearInterval(beepTimer); beepTimer = null; }
  if (level <= 0) return;
  const period = [0, 900, 550, 330, 190, 110][Math.min(5, level)];
  beepTimer = setInterval(() => {
    const c = ac(), t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = level >= 5 ? 1200 : 880;
    env(g, t, 0.005, 0.12, 0.07);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + 0.08);
  }, period);
}

let heartTimer = null, heartRate = 0;
export function setHeartbeat(dread) {
  const rate = dread < 0.15 ? 0 : Math.round(600 + (1 - dread) * 900); // ms between beats
  if (Math.abs(rate - heartRate) < 60) return;
  heartRate = rate;
  if (heartTimer) { clearInterval(heartTimer); heartTimer = null; }
  if (!rate) return;
  const beat = () => {
    const c = ac(), t = c.currentTime;
    for (const dt of [0, 0.18]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = 55;
      env(g, t + dt, 0.01, dt ? 0.32 : 0.45, 0.16);
      o.connect(g).connect(master);
      o.start(t + dt); o.stop(t + dt + 0.2);
    }
  };
  heartTimer = setInterval(beat, rate);
}

export function stopLoops() { setEmfBeep(0); setHeartbeat(0); }

// ---- menu music (looping mp3) ----

let menuTrack = null;
let menuMusicWanted = false;
let menuFade = null;
let menuVol = (() => { const v = parseFloat(localStorage.getItem('ggMusicVol')); return Number.isFinite(v) ? v : 0.45; })();
let menuMuted = localStorage.getItem('ggMusicMuted') === '1';

export function musicVolume() { return menuVol; }
export function musicMuted() { return menuMuted; }

export function setMusicVolume(v) {
  menuVol = Math.min(1, Math.max(0, v));
  localStorage.setItem('ggMusicVol', String(menuVol));
  if (menuTrack && !menuFade) menuTrack.volume = menuVol;
}

export function setMusicMuted(m) {
  menuMuted = m;
  localStorage.setItem('ggMusicMuted', m ? '1' : '0');
  if (menuTrack) menuTrack.muted = m;
}

export function startMenuMusic() {
  menuMusicWanted = true;
  if (!menuTrack) {
    menuTrack = new Audio('audio/menu_music.mp3');
    menuTrack.loop = true;
    window.__menuMusic = menuTrack; // debug/playtest hook
  }
  if (menuFade) { clearInterval(menuFade); menuFade = null; }
  menuTrack.volume = menuVol;
  menuTrack.muted = menuMuted;
  menuTrack.play().catch(() => {
    // Autoplay is blocked until the user interacts — start on the first gesture.
    const kick = () => {
      removeEventListener('pointerdown', kick);
      removeEventListener('keydown', kick);
      if (menuMusicWanted) menuTrack.play().catch(() => {});
    };
    addEventListener('pointerdown', kick);
    addEventListener('keydown', kick);
  });
}

export function stopMenuMusic() {
  menuMusicWanted = false;
  if (!menuTrack || menuTrack.paused) return;
  if (menuFade) clearInterval(menuFade);
  menuFade = setInterval(() => {
    if (menuTrack.volume > 0.05) { menuTrack.volume -= 0.05; return; }
    clearInterval(menuFade); menuFade = null;
    menuTrack.pause();
    menuTrack.volume = menuVol;
  }, 50);
}
