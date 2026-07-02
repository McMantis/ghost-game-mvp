// Screen flow: menu -> lobby -> match -> end -> lobby.
import { Net } from './net.js';
import { Match } from './game.js';
import * as sfx from './audio.js';

const $ = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');

// visible error reporting — a playtest machine has no devtools open
window.__reportErr = msg => {
  let b = $('errBanner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'errBanner';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:70;background:#7a1c1c;color:#ffd0d0;' +
      'font:13px monospace;padding:6px 12px;white-space:pre-wrap;';
    document.body.appendChild(b);
  }
  b.textContent = 'ERROR (screenshot this for Claude): ' + msg;
};
addEventListener('error', e => window.__reportErr(`${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
addEventListener('unhandledrejection', e => window.__reportErr('promise: ' + (e.reason?.message || e.reason)));

const net = new Net();
let myId = null;
let isHost = false;
let myRole = null;
let match = null;

function screen(name) {
  for (const s of ['screen-menu', 'screen-lobby', 'screen-end']) hide(s);
  if (name) show(name);
  if (name === 'screen-menu' || name === 'screen-lobby') { sfx.startMenuMusic(); show('musicCtl'); }
  else { sfx.stopMenuMusic(); hide('musicCtl'); }
}

// ---- menu ----

$('nameInput').value = localStorage.getItem('ggName') || '';
sfx.startMenuMusic(); // title screen is visible on load; actual playback may wait for first click/keypress (autoplay policy)

// ---- music volume control ----

const volSlider = $('volSlider'), btnMute = $('btnMute');
volSlider.value = Math.round(sfx.musicVolume() * 100);
const muteIcon = () => { btnMute.textContent = sfx.musicMuted() ? '🔇' : '🔊'; };
muteIcon();
volSlider.oninput = () => {
  sfx.setMusicVolume(volSlider.value / 100);
  if (sfx.musicMuted()) { sfx.setMusicMuted(false); muteIcon(); } // adjusting volume un-mutes
};
btnMute.onclick = () => { sfx.setMusicMuted(!sfx.musicMuted()); muteIcon(); };

async function ensureConnected() {
  if (net.ws && net.ws.readyState === 1) return true;
  try { await net.connect(); return true; }
  catch { $('menuError').textContent = 'Could not reach the server.'; return false; }
}

function myName() {
  const n = $('nameInput').value.trim() || 'Player';
  localStorage.setItem('ggName', n);
  return n;
}

$('btnCreate').onclick = async () => {
  if (!(await ensureConnected())) return;
  sfx.unlock();
  net.send({ t: 'create', name: myName() });
};
$('btnJoin').onclick = async () => {
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length !== 4) { $('menuError').textContent = 'Codes are 4 letters.'; return; }
  if (!(await ensureConnected())) return;
  sfx.unlock();
  net.send({ t: 'join', code, name: myName() });
};
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });

// ---- lobby ----

$('btnGhost').onclick = () => net.send({ t: 'role', role: 'ghost' });
$('btnHunter').onclick = () => net.send({ t: 'role', role: 'hunter' });
$('btnStart').onclick = () => net.send({ t: 'start' });
$('btnAgain').onclick = () => net.send({ t: 'again' });

// ---- net handlers ----

net.on('joined', m => {
  myId = m.id;
  $('roomCode').textContent = m.code;
  $('menuError').textContent = '';
  screen('screen-lobby');
});

net.on('lobby', m => {
  if (match) { match.destroy(); match = null; hide('hud'); hide('deathScreen'); hide('dragOverlay'); }
  if (m.state === 'lobby') screen('screen-lobby');
  const me = m.players.find(p => p.id === myId);
  isHost = !!me?.host;
  myRole = me?.role || null;
  const list = $('playerList');
  list.innerHTML = '';
  for (const p of m.players) {
    const li = document.createElement('li');
    const tag = p.role ? `<span class="tag ${p.role}">${p.role.toUpperCase()}</span>` : '<span class="tag none">picking…</span>';
    li.innerHTML = `<span>${p.host ? '👑 ' : ''}${esc(p.name)}${p.id === myId ? ' (you)' : ''}</span>${tag}`;
    list.appendChild(li);
  }
  $('btnGhost').classList.toggle('picked', myRole === 'ghost');
  $('btnHunter').classList.toggle('picked', myRole === 'hunter');
  $('btnStart').classList.toggle('hidden', !isHost);
});

net.on('error', m => {
  $('menuError').textContent = m.msg;
  $('lobbyError').textContent = m.msg;
  setTimeout(() => { $('lobbyError').textContent = ''; }, 4000);
});

net.on('toast', m => { if (match) match.msg(m.msg); });

net.on('startMatch', m => {
  screen(null);
  hide('deathScreen');
  $('lobbyError').textContent = '';
  match = new Match({
    net,
    canvas: $('c'),
    myId,
    role: m.role,
    spawn: m.spawn,
    components: m.components,
    ritual: m.ritual,
    players: m.players,
    tune: m.tune,
  });
  match.msg(m.role === 'ghost' ? 'The house is yours. Haunt it.' : 'Dawn is far away. Get to work.');
  window.__match = match; // debug/playtest hook
});

net.on('st', m => { if (match) match.onState(m); });
net.on('ev', m => { if (match) match.onEvent(m); });

net.on('end', m => {
  if (match) { match.over = true; sfx.stopLoops(); }
  document.exitPointerLock?.();
  hide('dragOverlay'); hide('blind'); hide('deathScreen'); hide('hud');
  const hunterWin = m.winner === 'hunters';
  $('endTitle').textContent = hunterWin ? 'THE GHOST IS BANISHED' : 'THE HOUSE CLAIMS THEM ALL';
  $('endTitle').style.color = hunterWin ? '#7be0c0' : '#ff5a5a';
  $('endReason').textContent = m.reason;
  $('btnAgain').classList.toggle('hidden', !isHost);
  $('endWait').textContent = isHost ? '' : 'Waiting for the host…';
  if (hunterWin) sfx.banish(); else sfx.roar();
  if (match) { match.destroy(); match = null; }
  screen('screen-end');
});

net.on('_close', () => {
  if (match) { match.destroy(); match = null; }
  hide('hud'); hide('deathScreen'); hide('dragOverlay'); hide('blind');
  screen('screen-menu');
  $('menuError').textContent = 'Disconnected from server.';
});

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
