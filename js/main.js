// Kitchen Merge — bootstrap, DOM shell, input, session wiring, platform calls.
import {
  FAMILIES, legalActions, totalScore, TICK_MS, hashString,
} from './rules.js';
import {
  THEMES, TUTORIALS, JOURNEY_LEVELS, CHALLENGES, ACHIEVEMENTS,
  dailyLevel, practiceLevel,
} from './content.js';
import { KitchenRenderer } from './render.js';
import { AudioEngine } from './audio.js';
import { Session, store } from './session.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------- platform ----
// Token-aware same-origin API adapter with graceful offline fallback.
const platform = {
  timeOffset: 0, // server - client, ms
  online: false,
  async fetchTime() {
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time');
      const t1 = Date.now();
      if (!res.ok) return;
      const data = await res.json();
      // Round-trip-adjusted offset.
      this.timeOffset = data.now - (t0 + (t1 - t0) / 2);
      this.online = true;
    } catch { this.online = false; }
  },
  now() { return Date.now() + this.timeOffset; },
  todayIso() { return new Date(this.now()).toISOString().slice(0, 10); },
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.status === 429) throw new Error('rate-limited');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'request-failed');
    return data;
  },
  async get(path) {
    const res = await fetch(path);
    if (res.status === 429) throw new Error('rate-limited');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'request-failed');
    return data;
  },
};

// -------------------------------------------------------------- settings ----
const settings = store.getSettings();
const audio = new AudioEngine(settings);
let renderer = null;
let session = null;
let currentLevel = null;
let currentMode = null; // 'tutorial' | 'journey' | 'daily' | 'practice' | 'challenge'
let tutorialState = null;
let lastFocus = null;

const GLYPHS = { grain: '▬', garden: '●', dairy: '▮', ember: '▲' };
const FAMILY_NAMES = { grain: 'Grain', garden: 'Garden', dairy: 'Dairy', ember: 'Ember' };

function itemLabel(cell) {
  const fam = FAMILIES[cell.family];
  return fam.tiers[cell.tier - 1] + ' (' + fam.name + ' tier ' + cell.tier + ')';
}

// ------------------------------------------------------------ navigation ----
const SCREENS = ['title', 'setup', 'play', 'help', 'settings', 'scores', 'list'];
let settingsReturn = 'title';
let helpReturn = 'title';

function show(name) {
  for (const s of SCREENS) $('screen-' + s).classList.toggle('hidden', s !== name);
  const first = document.querySelector('#screen-' + name + ' [data-autofocus], #screen-' + name + ' .btn');
  if (first) first.focus();
  if (session && session.state.phase === 'active') {
    if (name !== 'play') session.pause();
    else if ($('overlay-pause').classList.contains('hidden')) session.resume();
  }
}

function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms);
}

function announce(msg, assertive = false) {
  const el = assertive ? $('live-assertive') : $('live');
  el.textContent = '';
  requestAnimationFrame(() => { el.textContent = msg; });
}

// ------------------------------------------------------------ settings UI ----
function applySettings() {
  document.body.classList.toggle('high-contrast', settings.highContrast);
  document.body.classList.toggle('large-text', settings.largeText);
  document.body.classList.toggle('left-handed', settings.leftHanded);
  document.body.classList.toggle('cb-palette', settings.colorblind);
  for (const bus of ['music', 'effects', 'ambience', 'voice']) audio.setVolume(bus, settings[bus]);
  if (renderer) {
    renderer.setQuality(settings.tier);
    renderer.setReducedMotion(settings.reducedMotion);
    renderer.setColorblind(settings.colorblind);
    renderer.setTheme(currentLevel ? currentLevel.theme : settings.theme);
  }
  store.saveSettings(settings);
}

function bindSettings() {
  const map = [
    ['set-music', 'music'], ['set-effects', 'effects'], ['set-ambience', 'ambience'], ['set-voice', 'voice'],
  ];
  for (const [id, key] of map) {
    const el = $(id);
    el.value = settings[key];
    el.addEventListener('input', () => { settings[key] = parseFloat(el.value); applySettings(); });
  }
  $('set-tier').value = settings.tier;
  $('set-tier').addEventListener('change', (e) => { settings.tier = e.target.value; applySettings(); });
  const themeSel = $('set-theme');
  for (const t of THEMES) {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = t.name;
    themeSel.appendChild(o);
  }
  themeSel.value = settings.theme;
  themeSel.addEventListener('change', (e) => { settings.theme = e.target.value; applySettings(); });
  const checks = [
    ['set-reduced-motion', 'reducedMotion'], ['set-high-contrast', 'highContrast'],
    ['set-colorblind', 'colorblind'], ['set-large-text', 'largeText'],
    ['set-left-handed', 'leftHanded'], ['set-haptics', 'haptics'],
  ];
  for (const [id, key] of checks) {
    const el = $(id);
    el.checked = !!settings[key];
    el.addEventListener('change', () => { settings[key] = el.checked; applySettings(); });
  }
  $('btn-replay-tutorial').addEventListener('click', () => {
    const p = store.getProgress();
    p.tutorialsDone = [];
    store.saveProgress(p);
    toast('Tutorials will play again.');
    openLearn();
  });
}

// ------------------------------------------------------------ selection ----
let selectedCell = null;
let hintCells = [];

function setSelected(i) {
  selectedCell = i;
  if (renderer && renderer.ok) renderer.setSelection(i);
  updateBoardDom();
  updateActionTray();
  if (i != null && session) {
    const c = session.state.board[i];
    if (c && c.kind === 'item') announce('Selected ' + itemLabel(c));
  }
}

function updateActionTray() {
  const has = selectedCell != null && session && session.state.board[selectedCell] &&
    session.state.board[selectedCell].kind === 'item';
  let canServe = false;
  if (has && session) {
    const c = session.state.board[selectedCell];
    canServe = session.state.orders.some((o) => o.family === c.family && o.tier === c.tier);
  }
  $('btn-serve').disabled = !canServe;
  $('btn-trash').disabled = !has;
  $('btn-undo').disabled = !(session && session.undoEnabled && session.undoStack.length);
}

// ------------------------------------------------------------- board DOM ----
// Fit the DOM board grid inside the playfield: square cells, centered,
// never spilling under the rails at any breakpoint.
function fitBoard() {
  const board = $('board-dom');
  const field = $('playfield');
  if (!board || !field || !board.dataset.cols) return;
  const cols = parseInt(board.dataset.cols, 10);
  const rows = Math.ceil(board.children.length / cols);
  const w = field.clientWidth - 24, h = field.clientHeight - 24;
  if (w <= 0 || h <= 0) return;
  const cell = Math.max(44, Math.floor(Math.min(w / cols, h / rows)));
  board.style.width = cell * cols + 'px';
  board.style.height = cell * rows + 'px';
  board.style.gridTemplateColumns = 'repeat(' + cols + ', ' + cell + 'px)';
  board.style.gridTemplateRows = 'repeat(' + rows + ', ' + cell + 'px)';
}

function buildBoardDom(state) {
  const board = $('board-dom');
  board.innerHTML = '';
  board.style.inset = '0';
  board.style.margin = 'auto';
  board.dataset.cols = state.cols;
  for (let i = 0; i < state.board.length; i++) {
    const b = document.createElement('button');
    b.className = 'cell';
    b.setAttribute('role', 'gridcell');
    b.dataset.index = i;
    b.tabIndex = i === 0 ? 0 : -1;
    b.addEventListener('click', () => onCellAction(i));
    b.addEventListener('keydown', onCellKey);
    board.appendChild(b);
  }
  updateBoardDom();
}

function updateBoardDom() {
  if (!session) return;
  const board = $('board-dom');
  const cells = board.children;
  const state = session.state;
  for (let i = 0; i < state.board.length; i++) {
    const el = cells[i];
    if (!el) continue;
    const c = state.board[i];
    el.classList.toggle('selected', i === selectedCell);
    el.classList.toggle('hint', hintCells.includes(i));
    el.classList.remove('match');
    if (!c) {
      el.dataset.kind = 'empty'; delete el.dataset.family;
      el.innerHTML = '';
      el.setAttribute('aria-label', 'Empty cell ' + (i + 1));
      continue;
    }
    el.dataset.kind = c.kind;
    el.dataset.family = c.family;
    const glyph = GLYPHS[c.family];
    if (c.kind === 'gen') {
      el.innerHTML = '<span class="glyph">' + glyph + '</span><span>' + FAMILY_NAMES[c.family] + ' station</span>';
      el.setAttribute('aria-label', FAMILY_NAMES[c.family] + ' station, cell ' + (i + 1) + '. Activate to generate.');
    } else {
      el.innerHTML = '<span class="glyph">' + glyph + '</span><span>' + FAMILIES[c.family].tiers[c.tier - 1] + '</span><span class="tier">T' + c.tier + '</span>';
      el.setAttribute('aria-label', itemLabel(c) + ', cell ' + (i + 1));
      if (state.orders.some((o) => o.family === c.family && o.tier === c.tier)) el.classList.add('match');
    }
  }
}

// Keyboard navigation among cells; confirm/cancel per spec.
function onCellKey(e) {
  const i = parseInt(e.currentTarget.dataset.index, 10);
  const cols = session ? session.state.cols : 6;
  const total = session ? session.state.board.length : 36;
  let next = null;
  switch (e.key) {
    case 'ArrowLeft': next = i % cols > 0 ? i - 1 : i; break;
    case 'ArrowRight': next = i % cols < cols - 1 ? i + 1 : i; break;
    case 'ArrowUp': next = i - cols >= 0 ? i - cols : i; break;
    case 'ArrowDown': next = i + cols < total ? i + cols : i; break;
    case 'Enter': case ' ': e.preventDefault(); onCellAction(i); return;
    case 'Escape': setSelected(null); return;
    default: return;
  }
  e.preventDefault();
  if (next != null && next !== i) {
    const board = $('board-dom');
    board.children[i].tabIndex = -1;
    board.children[next].tabIndex = 0;
    board.children[next].focus();
  }
}

// One input → one acknowledged action.
function onCellAction(i) {
  if (!session || session.state.phase !== 'active' || session.paused) return;
  audio.play('ack', i);
  const state = session.state;
  const c = state.board[i];
  if (c && c.kind === 'gen') {
    const res = session.command({ kind: 'spawn', gen: i });
    if (!res.ok) explain(res.reason);
    return;
  }
  if (selectedCell == null) {
    if (c && c.kind === 'item') { setSelected(i); audio.play('select', i); }
    return;
  }
  if (selectedCell === i) { setSelected(null); return; }
  const sel = state.board[selectedCell];
  if (!sel || sel.kind !== 'item') { setSelected(c && c.kind === 'item' ? i : null); return; }
  if (c && c.kind === 'item') {
    const res = session.command({ kind: 'merge', from: selectedCell, to: i });
    if (res.ok) { setSelected(null); return; }
    explain(res.reason);
    setSelected(i); // re-target selection
    return;
  }
  setSelected(null);
}

function explain(reason) {
  if (!reason) return;
  $('action-explain').textContent = reason;
  announce(reason, true);
  audio.play('invalid', 3);
}

// ------------------------------------------------------------- HUD ----
function updateHud() {
  if (!session) return;
  const s = session.state;
  $('hud-score').textContent = String(totalScore(s));
  const streakEl = $('hud-streak');
  if (s.streak >= 2) {
    streakEl.textContent = 'Streak x' + s.streak;
    streakEl.classList.remove('hidden');
  } else streakEl.classList.add('hidden');
  const timerEl = $('hud-timer');
  if (s.timeLeft != null) {
    const secs = Math.ceil(s.timeLeft * TICK_MS / 1000);
    timerEl.textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    timerEl.classList.toggle('urgent', secs <= 15);
  } else if (s.movesLeft != null) {
    timerEl.textContent = s.movesLeft + ' moves';
    timerEl.classList.toggle('urgent', s.movesLeft <= 5);
  } else timerEl.textContent = '';
  // Orders
  const list = $('orders-list');
  list.innerHTML = '';
  for (const o of s.orders) {
    const li = document.createElement('li');
    li.className = 'order' + (o.timeLeft < 100 ? ' expiring' : '');
    const name = FAMILIES[o.family].tiers[o.tier - 1];
    li.innerHTML = '<span class="order-name">' + name + '</span><span class="order-value">' + o.value + '</span>' +
      '<div class="order-bar"><i style="width:' + Math.max(0, (o.timeLeft / o.maxTime) * 100) + '%"></i></div>';
    li.setAttribute('aria-label', 'Order: ' + name + ', value ' + o.value + ', ' + Math.ceil(o.timeLeft / 10) + ' seconds left');
    list.appendChild(li);
  }
  const prog = [];
  if (s.ordersTarget != null) prog.push('Orders: ' + s.fulfilled + '/' + s.ordersTarget);
  else prog.push('Served: ' + s.fulfilled);
  $('hud-progress').textContent = prog.join(' · ');
}

// ------------------------------------------------------------- events ----
function onGameEvent(e, state) {
  const seed = state.tick + state.moves;
  switch (e.type) {
    case 'spawn':
      audio.play('spawn', seed);
      if (renderer && renderer.ok) renderer.burst(e.cell, 0xffffff, 6);
      break;
    case 'merge':
      audio.play('merge', seed);
      if (renderer && renderer.ok) { renderer.burst(e.cell, 0xffe28a, 14); renderer.shake(0.05); }
      if (e.tier >= 5) unlock('merge_master');
      announce('Merged into ' + FAMILIES[e.family].tiers[e.tier - 1]);
      if (tutorialState) tutorialProgress('merge');
      break;
    case 'submit': {
      audio.play(e.streak >= 3 ? 'streak' : 'submit', seed);
      if (renderer && renderer.ok) { renderer.burst(e.cell, 0x8affc0, 20); renderer.shake(0.08); }
      announce('Served ' + FAMILIES[e.order.family].tiers[e.order.tier - 1] + ' for ' + e.gained + ' points' +
        (e.streak > 1 ? ', streak ' + e.streak : ''));
      unlock('first_service');
      if (e.streak >= 5) unlock('hot_streak');
      if (settings.haptics && navigator.vibrate) navigator.vibrate(20);
      if (tutorialState) tutorialProgress('submit');
      break;
    }
    case 'trash': audio.play('trash', seed); break;
    case 'expire':
      audio.play('expire', seed);
      announce('An order expired.', true);
      break;
    case 'new-order':
      audio.play('tick', seed);
      announce('New order: ' + FAMILIES[e.order.family].tiers[e.order.tier - 1]);
      break;
    case 'end':
      audio.play(e.reason === 'orders-complete' ? 'win' : 'lose', seed);
      break;
  }
  if (e.type === 'spawn' && tutorialState) tutorialProgress('spawn');
}

// ------------------------------------------------------------ tutorials ----
function tutorialProgress(kind) {
  if (!tutorialState || tutorialState.goal.kind !== kind) return;
  tutorialState.done++;
  announce(tutorialState.title + ': ' + tutorialState.done + ' of ' + tutorialState.goal.count);
  if (tutorialState.done >= tutorialState.goal.count) {
    const p = store.getProgress();
    if (!p.tutorialsDone.includes(tutorialState.id)) p.tutorialsDone.push(tutorialState.id);
    store.saveProgress(p);
    toast('Lesson complete!');
    setTimeout(() => { endRoundEarly(); openLearn(); }, 800);
  }
}

// -------------------------------------------------------------- rounds ----
function startRound(level, mode) {
  currentLevel = level;
  currentMode = mode;
  tutorialState = null;
  if (mode === 'tutorial') {
    const t = TUTORIALS.find((x) => x.id === level.tutorialId);
    tutorialState = { ...t, done: 0 };
  }
  selectedCell = null;
  hintCells = [];
  if (session) session.stop();
  session = new Session(level, {
    ranked: mode === 'daily',
    onEvent: onGameEvent,
    onChange: () => { if (renderer && renderer.ok) renderer.syncState(session.state); updateBoardDom(); updateHud(); updateActionTray(); },
    onEnd: showResults,
  });
  if (renderer && renderer.ok) {
    renderer.setTheme(level.theme || settings.theme);
    renderer.buildBoard(level.cols || 6, level.rows || 6);
    renderer.syncState(session.state);
  }
  buildBoardDom(session.state);
  $('hud-objective').textContent = objectiveText(level);
  $('action-explain').textContent = '';
  show('play');
  requestAnimationFrame(() => { fitBoard(); if (renderer && renderer.ok) renderer.resize(); });
  updateHud();
  session.start();
  audio.ensure(); audio.startAmbience(); audio.startMusic(level.seed);
  if (tutorialState) toast(tutorialState.brief, 6000);
}

function objectiveText(level) {
  if (level.ordersTarget != null) return 'Serve ' + level.ordersTarget + ' orders';
  if (level.timeLimit != null) return 'Serve as many orders as you can';
  return 'Free service';
}

function endRoundEarly() {
  if (session) { session.stop(); session = null; }
  audio.stopMusic(); audio.stopAmbience();
}

function leaveRound() {
  $('overlay-pause').classList.add('hidden');
  endRoundEarly();
  show('title');
  refreshTitle();
}

// ------------------------------------------------------------- results ----
function showResults(result) {
  audio.stopMusic(); audio.stopAmbience();
  if (currentMode === 'tutorial') { markPlayDay(); return; } // lessons end via tutorialProgress
  const names = { 'orders-complete': 'All orders served!', 'time-up': 'Time is up', 'moves-exhausted': 'Out of moves' };
  $('results-heading').textContent = result.reason === 'orders-complete' ? 'Round Complete' : 'Round Over';
  $('results-reason').textContent = names[result.reason] || result.reason;
  const dl = $('results-breakdown');
  dl.innerHTML = '';
  const rows = [
    ['Orders served', result.components.orders],
    ['Streak bonuses', result.components.streaks],
    ['Board efficiency', result.components.efficiency],
    ['Dishes served', result.fulfilled],
    ['Best streak', result.bestStreak],
    ['Invalid actions', result.invalidActions],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = String(v);
    dl.append(dt, dd);
  }
  $('results-total').textContent = 'Total: ' + result.score;

  // Achievements + progression.
  const newAch = evaluateAchievements(result);
  $('results-achievements').textContent = newAch.length ? 'Achievement unlocked: ' + newAch.join(', ') : '';

  // Progression.
  const p = store.getProgress();
  if (currentMode === 'journey') {
    const stage = currentLevel.stage;
    if (result.reason === 'orders-complete' || result.score > 0) {
      const stars = result.score >= currentLevel.par ? 3 : result.score >= currentLevel.par * 0.6 ? 2 : 1;
      p.stars[stage] = Math.max(p.stars[stage] || 0, stars);
      if (currentLevel.mastery && !p.masteryStages?.includes?.(stage)) {
        p.masteryStages = p.masteryStages || [];
        p.masteryStages.push(stage);
        p.masteryDone = p.masteryStages.length;
        if (p.masteryDone >= 5) unlock('mastery_five');
      }
      if (stage >= p.journeyStage) p.journeyStage = Math.min(stage + 1, 40);
      store.saveProgress(p);
    }
    $('btn-next').classList.toggle('hidden', stage >= 40);
  } else $('btn-next').classList.add('hidden');

  // Local leaderboard.
  store.saveScore(currentLevel.id, {
    score: result.score, fulfilled: result.fulfilled, invalidActions: result.invalidActions,
    ticks: result.ticks, sessionId: result.sessionId, date: new Date().toISOString(),
  });

  // Daily: submit to authoritative server with replay envelope.
  $('results-compare').textContent = '';
  if (currentMode === 'daily') {
    submitDaily(result);
  }

  markPlayDay();
  $('overlay-results').classList.remove('hidden');
  announce('Round over. Total score ' + result.score + '.', true);
  $('btn-retry').focus();
}

async function submitDaily(result) {
  try {
    const resp = await platform.post('/api/v1/scores', {
      day: currentLevel.date,
      score: result.score,
      components: result.components,
      fulfilled: result.fulfilled,
      invalidActions: result.invalidActions,
      ticks: result.ticks,
      sessionId: result.sessionId,
      envelope: result.envelope,
      contentVersion: currentLevel.version,
      seed: currentLevel.seed,
      assists: settings.reducedMotion ? ['reduced-motion'] : [],
    });
    $('results-compare').textContent = resp.validated
      ? 'Validated on server. Daily rank #' + resp.rank + ' of ' + resp.total + '.'
      : 'Submitted (casual board): rank #' + resp.rank + '.';
  } catch (e) {
    $('results-compare').textContent = e.message === 'rate-limited'
      ? 'Server busy — your local score is saved; try again later.'
      : 'Offline — score saved locally only.';
  }
}

function evaluateAchievements(result) {
  const p = store.getProgress();
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (p.achievements[a.key] && !p.achievements[a.key].announced) {
      p.achievements[a.key].announced = true;
      fresh.push(a.name);
    }
  }
  store.saveProgress(p);
  return fresh;
}

function unlock(key) {
  const p = store.getProgress();
  if (!p.achievements[key]) {
    p.achievements[key] = { at: new Date().toISOString(), announced: false };
    store.saveProgress(p);
    const a = ACHIEVEMENTS.find((x) => x.key === key);
    if (a) toast('Achievement: ' + a.name);
  }
}

function markPlayDay() {
  const p = store.getProgress();
  const today = new Date().toISOString().slice(0, 10);
  if (!p.playDays.includes(today)) {
    p.playDays.push(today);
    if (p.playDays.length >= 7) unlock('regular');
    store.saveProgress(p);
  }
}

// ------------------------------------------------------------- screens ----
function refreshTitle() {
  const p = store.getProgress();
  $('journey-status').textContent = p.journeyStage > 0 ? 'Stage ' + Math.min(p.journeyStage, 40) + '/40' : '';
  $('daily-status').textContent = '';
  $('profile-line').textContent = 'Guest profile — progress is stored on this device.' +
    (platform.online ? ' Connected to server.' : ' Offline mode.');
}

function openSetup(level, mode) {
  currentLevel = level;
  currentMode = mode;
  const fams = level.families.map((f) => FAMILY_NAMES[f]).join(', ');
  const bits = [];
  bits.push('<p><strong>' + (level.name || level.id) + '</strong></p>');
  if (level.blurb) bits.push('<p>' + level.blurb + '</p>');
  bits.push('<p>Stations: ' + fams + '. Board: ' + (level.cols || 6) + '×' + (level.rows || 6) + '.</p>');
  const dur = [];
  if (level.timeLimit != null) dur.push(Math.round(level.timeLimit / 10) + 's time limit');
  if (level.moveLimit != null) dur.push(level.moveLimit + ' moves');
  if (level.ordersTarget != null) dur.push('serve ' + level.ordersTarget + ' orders');
  bits.push('<p>' + (dur.join(' · ') || 'No time pressure') + '</p>');
  bits.push('<p>' + (mode === 'daily' ? 'Ranked — validated on the daily board.' : mode === 'practice' ? 'Unranked practice. Undo enabled.' : 'Solo progression.') + '</p>');
  if (mode === 'tutorial') {
    const t = TUTORIALS.find((x) => x.id === level.tutorialId);
    bits.push('<p>' + t.brief + '</p>');
  }
  $('setup-details').innerHTML = bits.join('');
  show('setup');
}

function openLearn() {
  const p = store.getProgress();
  const items = TUTORIALS.map((t) => ({
    label: t.title + (p.tutorialsDone.includes(t.id) ? ' ✓' : ''),
    sub: t.brief.slice(0, 60) + '…',
    action: () => openSetup({ id: t.id, kind: 'tutorial', seed: hashString(t.id), cols: 6, rows: 6, theme: 'hearth', tutorialId: t.id, ...t.level }, 'tutorial'),
  }));
  openList('Learn', items);
}

function openList(title, items) {
  $('list-heading').textContent = title;
  const box = $('list-items');
  box.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.className = 'btn' + (it.locked ? ' locked' : '');
    b.disabled = !!it.locked;
    b.innerHTML = it.label + (it.sub ? '<span class="sub">' + it.sub + '</span>' : '');
    b.addEventListener('click', it.action);
    box.appendChild(b);
  }
  show('list');
}

function openJourney() {
  const p = store.getProgress();
  const items = JOURNEY_LEVELS.map((l) => {
    const locked = l.stage > p.journeyStage + 1;
    const stars = p.stars[l.stage] || 0;
    return {
      label: (l.mastery ? '★ ' : '') + l.name + (stars ? ' ' + '★'.repeat(stars) : ''),
      sub: locked ? 'Locked' : l.blurb,
      locked,
      action: () => openSetup(l, 'journey'),
    };
  });
  openList('Journey', items);
}

function openPractice() {
  openList('Practice', ['relaxed', 'standard', 'intense'].map((d) => ({
    label: d[0].toUpperCase() + d.slice(1),
    sub: { relaxed: 'No timer, two stations', standard: 'Five minutes, three stations', intense: 'Fast orders, all stations' }[d],
    action: () => openSetup(practiceLevel(d), 'practice'),
  })));
}

function openChallenges() {
  openList('Challenges', CHALLENGES.map((c) => ({
    label: c.name, sub: c.blurb,
    action: () => openSetup(c.level, 'challenge'),
  })));
}

async function openDaily() {
  await platform.fetchTime();
  const level = dailyLevel(platform.todayIso());
  openSetup(level, 'daily');
}

async function openScores() {
  renderLocalScores();
  show('scores');
  if (platform.online) {
    try {
      const data = await platform.get('/api/v1/scores?day=' + platform.todayIso());
      $('scores-list').dataset.global = JSON.stringify(data.scores || []);
    } catch { /* offline */ }
  }
}

function renderLocalScores() {
  const all = store.getScores();
  const box = $('scores-list');
  const ids = Object.keys(all).sort();
  if (!ids.length) { box.innerHTML = '<p class="muted">No scores yet — play a round!</p>'; return; }
  box.innerHTML = ids.map((id) => {
    const best = all[id][0];
    return '<table><thead><tr><th>' + id + '</th><th>Score</th><th>Served</th><th>When</th></tr></thead><tbody>' +
      all[id].slice(0, 5).map((e) =>
        '<tr><td>' + e.sessionId.slice(0, 6) + '</td><td>' + e.score + '</td><td>' + e.fulfilled + '</td><td>' + e.date.slice(0, 10) + '</td></tr>').join('') +
      '</tbody></table>';
  }).join('');
}

function renderGlobalScores() {
  const box = $('scores-list');
  let scores = [];
  try { scores = JSON.parse(box.dataset.global || '[]'); } catch {}
  if (!scores.length) { box.innerHTML = '<p class="muted">No global scores available (offline or empty board).</p>'; return; }
  box.innerHTML = '<table><thead><tr><th>#</th><th>Session</th><th>Score</th><th>Validated</th></tr></thead><tbody>' +
    scores.map((e, i) => '<tr><td>' + (i + 1) + '</td><td>' + String(e.sessionId).slice(0, 8) + '</td><td>' + e.score + '</td><td>' + (e.validated ? 'yes' : 'casual') + '</td></tr>').join('') +
    '</tbody></table>';
}

// ---------------------------------------------------------- pause/help ----
function openPause() {
  if (!session) return;
  session.pause();
  lastFocus = document.activeElement;
  $('overlay-pause').classList.remove('hidden');
  $('btn-resume').focus();
  announce('Paused.');
}

function closePause() {
  $('overlay-pause').classList.add('hidden');
  if (session) session.resume();
  if (lastFocus) lastFocus.focus();
}

// --------------------------------------------------------------- input ----
function bindPlayInput() {
  // Pointer/touch on the accessibility board (the canvas is aria-hidden;
  // this DOM layer is the single shared interaction surface).
  const board = $('board-dom');
  let downCell = null, downPos = null, dragging = false;

  board.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    downCell = parseInt(cell.dataset.index, 10);
    downPos = { x: e.clientX, y: e.clientY, id: e.pointerId };
    dragging = false;
  });
  board.addEventListener('pointermove', (e) => {
    if (downCell == null || !downPos) return;
    const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    if (dist > 14 && !dragging) {
      dragging = true;
      try { board.setPointerCapture(downPos.id); } catch {}
      const c = session && session.state.board[downCell];
      if (c && c.kind === 'item') setSelected(downCell);
    }
    if (dragging && renderer && renderer.ok) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const over = el && el.closest ? el.closest('.cell') : null;
      renderer.setGhostTarget(over ? parseInt(over.dataset.index, 10) : null);
    }
  });
  const endDrag = (e, commit) => {
    if (downCell == null) return;
    if (renderer && renderer.ok) renderer.setGhostTarget(null);
    if (commit && dragging) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const over = el && el.closest ? el.closest('.cell') : null;
      if (over) {
        const up = parseInt(over.dataset.index, 10);
        if (up !== downCell) {
          if (selectedCell == null) setSelected(downCell);
          onCellAction(up);
        }
      }
    }
    downCell = null; downPos = null;
    // Swallow the synthetic click after a real drag; allow taps through.
    setTimeout(() => { dragging = false; }, 0);
  };
  board.addEventListener('pointerup', (e) => endDrag(e, true));
  board.addEventListener('pointercancel', (e) => endDrag(e, false));
  board.addEventListener('click', (e) => {
    if (dragging) { e.preventDefault(); e.stopPropagation(); } // drag already committed
  }, true);

  document.addEventListener('keydown', (e) => {
    const inPlay = !$('screen-play').classList.contains('hidden');
    const paused = !$('overlay-pause').classList.contains('hidden');
    if (e.key === 'Escape') {
      if (paused) closePause();
      else if (inPlay && session) openPause();
      return;
    }
    if (!inPlay || paused || !session) return;
    switch (e.key.toLowerCase()) {
      case 's': $('btn-serve').click(); break;
      case 'd': $('btn-trash').click(); break;
      case 'u': $('btn-undo').click(); break;
      case 'h': $('btn-hint').click(); break;
      case 'c': if (renderer && renderer.ok) renderer.resize(); break;
    }
  });

  // Gamepad: focus navigation, primary/secondary, pause.
  let padPrev = {};
  function pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (gp && session && !$('screen-play').classList.contains('hidden')) {
      const pressed = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const edge = (name, val) => { const was = padPrev[name]; padPrev[name] = val; return val && !was; };
      if (edge('a', pressed(0))) document.activeElement?.click?.();
      if (edge('b', pressed(1))) setSelected(null);
      if (edge('start', pressed(9))) openPause();
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const focused = document.activeElement;
      if (focused && focused.classList && focused.classList.contains('cell')) {
        const i = parseInt(focused.dataset.index, 10);
        const cols = session.state.cols;
        let next = null;
        if (edge('l', ax < -0.6)) next = i - 1;
        else if (edge('r', ax > 0.6)) next = i + 1;
        else if (edge('u', ay < -0.6)) next = i - cols;
        else if (edge('d', ay > 0.6)) next = i + cols;
        if (next != null && next >= 0 && next < session.state.board.length) {
          $('board-dom').children[next].focus();
        }
      }
    }
    requestAnimationFrame(pollPad);
  }
  requestAnimationFrame(pollPad);
}

// --------------------------------------------------------------- wire ----
function wire() {
  $('btn-play').addEventListener('click', () => {
    audio.ensure(); audio.resume();
    const p = store.getProgress();
    if (p.tutorialsDone.length < TUTORIALS.length) openLearn();
    else {
      const stage = Math.min(p.journeyStage, 39);
      openSetup(JOURNEY_LEVELS[stage === 0 && p.journeyStage === 0 ? 0 : stage], 'journey');
    }
  });
  $('btn-daily').addEventListener('click', openDaily);
  $('btn-journey').addEventListener('click', openJourney);
  $('btn-practice').addEventListener('click', openPractice);
  $('btn-challenge').addEventListener('click', openChallenges);
  $('btn-scores').addEventListener('click', openScores);
  $('btn-help').addEventListener('click', () => { helpReturn = 'title'; show('help'); });
  $('btn-settings').addEventListener('click', () => { settingsReturn = 'title'; show('settings'); });

  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
    const parent = b.closest('.screen').id;
    if (parent === 'screen-settings') show(settingsReturn);
    else if (parent === 'screen-help') show(helpReturn);
    else show('title');
    refreshTitle();
  }));

  $('btn-start').addEventListener('click', () => startRound(currentLevel, currentMode));
  $('btn-pause').addEventListener('click', openPause);
  $('btn-resume').addEventListener('click', closePause);
  $('btn-leave').addEventListener('click', leaveRound);
  $('btn-pause-settings').addEventListener('click', () => { settingsReturn = 'play'; $('overlay-pause').classList.add('hidden'); show('settings'); });
  $('btn-pause-help').addEventListener('click', () => { helpReturn = 'play'; $('overlay-pause').classList.add('hidden'); show('help'); });

  $('btn-serve').addEventListener('click', () => {
    if (!session || selectedCell == null) return;
    const c = session.state.board[selectedCell];
    if (!c || c.kind !== 'item') return;
    const order = session.state.orders.find((o) => o.family === c.family && o.tier === c.tier);
    if (!order) { explain('No waiting order matches this dish.'); return; }
    const res = session.command({ kind: 'submit', cell: selectedCell, order: order.id });
    if (res.ok) setSelected(null);
    else explain(res.reason);
  });
  $('btn-trash').addEventListener('click', () => {
    if (!session || selectedCell == null) return;
    const res = session.command({ kind: 'trash', cell: selectedCell });
    if (res.ok) setSelected(null);
    else explain(res.reason);
  });
  $('btn-undo').addEventListener('click', () => {
    if (session && session.undo()) { audio.play('ack', 7); announce('Undone.'); }
  });
  $('btn-hint').addEventListener('click', () => {
    if (!session) return;
    const h = session.hint();
    hintCells = [];
    if (h.action) {
      if (h.action.gen != null) hintCells.push(h.action.gen);
      if (h.action.from != null) hintCells.push(h.action.from);
      if (h.action.to != null) hintCells.push(h.action.to);
      if (h.action.cell != null) hintCells.push(h.action.cell);
    }
    updateBoardDom();
    toast(h.text);
    announce(h.text);
    setTimeout(() => { hintCells = []; updateBoardDom(); }, 3000);
  });

  $('btn-retry').addEventListener('click', () => {
    $('overlay-results').classList.add('hidden');
    startRound(currentLevel, currentMode);
  });
  $('btn-next').addEventListener('click', () => {
    $('overlay-results').classList.add('hidden');
    const next = JOURNEY_LEVELS[Math.min(currentLevel.stage, 39)];
    openSetup(next, 'journey');
  });
  $('btn-results-title').addEventListener('click', () => {
    $('overlay-results').classList.add('hidden');
    endRoundEarly();
    show('title');
    refreshTitle();
  });
  $('btn-scores-local').addEventListener('click', renderLocalScores);
  $('btn-scores-global').addEventListener('click', renderGlobalScores);

  // Backgrounding pauses solo simulation.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session && session.state.phase === 'active' &&
        $('overlay-pause').classList.contains('hidden') &&
        !$('screen-play').classList.contains('hidden')) {
      openPause();
    }
  });

  window.addEventListener('resize', () => { fitBoard(); if (renderer && renderer.ok) renderer.resize(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { fitBoard(); if (renderer && renderer.ok) renderer.resize(); }, 100));
}

// --------------------------------------------------------------- boot ----
async function boot() {
  bindSettings();
  wire();
  bindPlayInput();
  applySettings();
  platform.fetchTime().then(refreshTitle);

  try {
    renderer = new KitchenRenderer($('gl'), {
      tier: settings.tier,
      reducedMotion: settings.reducedMotion,
      colorblind: settings.colorblind,
    });
    if (!renderer.ok) $('gl-fallback').classList.remove('hidden');
  } catch {
    $('gl-fallback').classList.remove('hidden');
  }

  // Render loop.
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (renderer && renderer.ok) renderer.render(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  refreshTitle();
  show('title');
}

boot();
