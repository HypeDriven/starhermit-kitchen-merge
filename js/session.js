// Kitchen Merge — session controller: local rounds, snapshots, undo,
// replay envelopes, tick loop, persistence. Only this module issues
// validated commands to the rules engine.
import {
  createGame, applyCommand, advance, legalActions, totalScore,
  serializeState, stateHash, makeReplayEnvelope, recordCommand, closeEnvelope,
  TICK_MS,
} from './rules.js';

const LS_PREFIX = 'kitchen-merge:';
let cmdCounter = 0;

export function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(LS_PREFIX + key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
export function lsSet(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); } catch {}
}

export class Session {
  constructor(level, opts = {}) {
    this.level = level;
    this.state = createGame(level, opts.seed);
    this.envelope = makeReplayEnvelope(level, this.state.seed);
    this.listeners = { events: [], change: [] };
    this.undoStack = [];
    this.undoEnabled = !!level.undo || !!opts.undo;
    this.timer = null;
    this.paused = false;
    this.sessionId = opts.sessionId || ('s' + Math.random().toString(36).slice(2, 10));
    this.onEvent = opts.onEvent || (() => {});
    this.onChange = opts.onChange || (() => {});
    this.onEnd = opts.onEnd || (() => {});
    this.ranked = !!opts.ranked;
  }

  start() {
    this.stop();
    this._acc = 0;
    this._last = performance.now();
    this.timer = setInterval(() => this._step(), TICK_MS);
  }

  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  pause() { this.paused = true; }
  resume() { this.paused = false; this._last = performance.now(); }

  _step() {
    if (this.paused || this.state.phase !== 'active') return;
    const events = advance(this.state, this.level);
    if (events.length) this._emit(events);
    this.onChange(this.state);
    if (this.state.phase === 'ended') this._finish();
  }

  _emit(events) {
    for (const e of events) this.onEvent(e, this.state);
  }

  // Issue a validated command. Action identifiers prevent double commits.
  command(partial) {
    const cmd = { id: this.sessionId + ':' + (++cmdCounter), ...partial };
    if (this.undoEnabled && this.state.phase === 'active') {
      this.undoStack.push(serializeState(this.state));
      if (this.undoStack.length > 60) this.undoStack.shift();
    }
    const res = applyCommand(this.state, this.level, cmd);
    if (res.ok) {
      recordCommand(this.envelope, this.state, cmd);
      if (res.events.length) this._emit(res.events);
    } else {
      if (this.undoEnabled) this.undoStack.pop();
    }
    this.onChange(this.state);
    if (this.state.phase === 'ended') this._finish();
    return res;
  }

  undo() {
    if (!this.undoEnabled || !this.undoStack.length) return false;
    const snap = this.undoStack.pop();
    const streams = this.state._streams;
    this.state = JSON.parse(JSON.stringify(snap));
    this.state._streams = streams;
    this.envelope.commands.pop();
    this.envelope.hashes.pop();
    this.onChange(this.state);
    return true;
  }

  _finish() {
    this.stop();
    closeEnvelope(this.envelope, this.state);
    const result = {
      levelId: this.level.id,
      score: totalScore(this.state),
      components: { ...this.state.score },
      fulfilled: this.state.fulfilled,
      bestStreak: this.state.bestStreak,
      invalidActions: this.state.invalidActions,
      moves: this.state.moves,
      ticks: this.state.tick,
      reason: this.state.terminalReason,
      sessionId: this.sessionId,
      ranked: this.ranked,
      envelope: this.envelope,
      hash: stateHash(this.state),
    };
    this.onEnd(result);
  }

  hint() {
    // Hints use the same legal-action API as play.
    const actions = legalActions(this.state);
    const submit = actions.find((a) => a.kind === 'submit');
    if (submit) return { action: submit, text: 'Serve the dish on the highlighted cell.' };
    const merge = actions.find((a) => a.kind === 'merge');
    if (merge) return { action: merge, text: 'Merge the two highlighted items.' };
    const spawn = actions.find((a) => a.kind === 'spawn');
    if (spawn) return { action: spawn, text: 'Tap the highlighted station to make an ingredient.' };
    return { action: null, text: 'No useful action right now.' };
  }
}

// ------------------------------------------------------ persistence ----
export const store = {
  getSettings() {
    return {
      music: 0.6, effects: 0.8, ambience: 0.4, voice: 0.8,
      tier: 'high', reducedMotion: false, highContrast: false, colorblind: false,
      largeText: false, leftHanded: false, holdToConfirm: false, haptics: true,
      theme: 'hearth',
      ...lsGet('settings', {}),
    };
  },
  saveSettings(s) { lsSet('settings', s); },
  getProgress() {
    return { journeyStage: 0, stars: {}, tutorialsDone: [], achievements: {}, playDays: [], masteryDone: 0, ...lsGet('progress', {}) };
  },
  saveProgress(p) { lsSet('progress', p); },
  getScores() { return lsGet('scores', {}); },
  saveScore(boardId, entry) {
    const all = this.getScores();
    if (!all[boardId]) all[boardId] = [];
    all[boardId].push(entry);
    all[boardId].sort((a, b) => b.score - a.score);
    all[boardId] = all[boardId].slice(0, 20);
    lsSet('scores', all);
  },
  saveSnapshot(key, snapshot) { lsSet('snapshot:' + key, snapshot); },
  loadSnapshot(key) { return lsGet('snapshot:' + key, null); },
  clearSnapshot(key) { try { localStorage.removeItem(LS_PREFIX + 'snapshot:' + key); } catch {} },
};
