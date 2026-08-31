// Kitchen Merge — deterministic rules engine.
// Pure module: no DOM, no network, no rendering. Usable from browser and Node.
// All randomness flows through seeded streams. Every state transition goes
// through applyCommand(); state is serializable at all times.

export const RULES_VERSION = 1;
export const TICK_MS = 100; // fixed simulation step

// ---------------------------------------------------------------- RNG ----
// mulberry32 — tiny deterministic PRNG.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Separate seeded streams: rules, content decoration, audiovisual variants.
export function makeStreams(seed) {
  return {
    rules: makeRng(hashString('rules:' + seed)),
    content: makeRng(hashString('content:' + seed)),
    av: makeRng(hashString('av:' + seed)),
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0; // FNV-1a 32
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ------------------------------------------------------------- Families ----
// Original item families: merge chain per family, tiers 1..5.
export const FAMILIES = {
  grain:  { name: 'Grain',  tiers: ['Sprout', 'Dough', 'Flatbread', 'Stuffed Roll', 'Harvest Loaf'], base: 10 },
  garden: { name: 'Garden', tiers: ['Leaf', 'Chopped Veg', 'Garden Salad', 'Roast Platter', 'Feast Bowl'], base: 12 },
  dairy:  { name: 'Dairy',  tiers: ['Milk Jug', 'Curds', 'Soft Cheese', 'Aged Wheel', 'Golden Fondue'], base: 14 },
  ember:  { name: 'Ember',  tiers: ['Skewer', 'Sear', 'Grill Plate', 'Smoke Roast', 'Fire Banquet'], base: 16 },
};
export const FAMILY_KEYS = Object.keys(FAMILIES);
export const MAX_TIER = 5;

// ---------------------------------------------------------- State shape ----
// state = {
//   version, seed, tick (monotonic), phase: 'active'|'ended',
//   cols, rows, board: [cell,...]  cell = null | {kind:'item',family,tier} | {kind:'gen',family}
//   orders: [{id,family,tier,timeLeft,maxTime,value}],
//   nextOrderId, orderSpawnIn (ticks),
//   timeLimit (ticks), ordersTarget, fulfilled, score components,
//   streak, bestStreak, lastSubmitTick, invalidActions, moves, terminalReason,
//   selected (transient, not hashed), undoStack (practice only, not hashed)
// }

export function createGame(level, seedOverride) {
  const seed = seedOverride != null ? seedOverride : level.seed;
  const streams = makeStreams(seed);
  const cols = level.cols || 6, rows = level.rows || 6;
  const board = new Array(cols * rows).fill(null);
  // Generators: one per enabled family, placed along the bottom row.
  const fams = level.families;
  fams.forEach((fam, i) => {
    const idx = (rows - 1) * cols + Math.min(1 + i * 2, cols - 1);
    board[idx] = { kind: 'gen', family: fam };
  });
  const state = {
    version: RULES_VERSION,
    levelId: level.id,
    seed,
    tick: 0,
    phase: 'active',
    cols, rows, board,
    orders: [],
    nextOrderId: 1,
    orderSpawnIn: 0,
    timeLimit: level.timeLimit != null ? level.timeLimit : null, // in ticks
    timeLeft: level.timeLimit != null ? level.timeLimit : null,
    moveLimit: level.moveLimit != null ? level.moveLimit : null,
    movesLeft: level.moveLimit != null ? level.moveLimit : null,
    ordersTarget: level.ordersTarget != null ? level.ordersTarget : null,
    fulfilled: 0,
    score: { orders: 0, streaks: 0, efficiency: 0 },
    streak: 0,
    bestStreak: 0,
    lastSubmitTick: -999,
    invalidActions: 0,
    moves: 0,
    terminalReason: null,
    _rngState: null,
  };
  state._streams = streams;
  // Prime initial orders.
  const opening = Math.min(level.openOrders || 2, 3);
  for (let i = 0; i < opening; i++) spawnOrder(state, level);
  return state;
}

function cloneCell(c) { return c ? { ...c } : null; }

export function serializeState(state) {
  const { _streams, ...rest } = state;
  return JSON.parse(JSON.stringify(rest));
}

export function restoreState(snapshot) {
  const state = JSON.parse(JSON.stringify(snapshot));
  state._streams = makeStreams(state.seed);
  // Fast-forward RNG to match move count so replay/restoration stays aligned.
  // (Streams are only consumed by spawnOrder/spawn commands, which are logged,
  // so restoration via replay is the authoritative path; snapshots restore the
  // deterministic fields.)
  return state;
}

// FNV hash over the deterministic state (excludes transient UI fields).
export function stateHash(state) {
  const s = JSON.stringify([
    state.tick, state.board, state.orders, state.score, state.streak,
    state.fulfilled, state.moves, state.phase, state.timeLeft, state.movesLeft,
    state.nextOrderId, state.orderSpawnIn,
  ]);
  return hashString(s);
}

// ---------------------------------------------------------- Orders ----
export const MAX_ORDERS = 3;
const ORDER_TIME = 450; // ticks (45s)

function spawnOrder(state, level) {
  if (state.orders.length >= MAX_ORDERS) return false;
  const rng = state._streams.rules;
  const fams = level.families;
  const family = fams[Math.floor(rng() * fams.length)];
  const maxOrderTier = Math.min(level.orderMaxTier || 3, MAX_TIER);
  const tier = 1 + Math.floor(rng() * maxOrderTier);
  const value = FAMILIES[family].base * tier * tier;
  state.orders.push({
    id: state.nextOrderId++,
    family, tier,
    timeLeft: ORDER_TIME, maxTime: ORDER_TIME,
    value,
  });
  return true;
}

// ------------------------------------------------------- Legal actions ----
// Single legal-action API used by play, hints and tutorials.
export function legalActions(state) {
  const actions = [];
  if (state.phase !== 'active') return actions;
  const { board, cols, rows } = state;
  for (let i = 0; i < board.length; i++) {
    const c = board[i];
    if (!c) continue;
    if (c.kind === 'gen') {
      if (board.some((x) => x === null)) actions.push({ kind: 'spawn', gen: i });
    } else if (c.kind === 'item') {
      for (let j = 0; j < board.length; j++) {
        const t = board[j];
        if (t && t.kind === 'item' && j !== i && t.family === c.family && t.tier === c.tier && c.tier < MAX_TIER) {
          actions.push({ kind: 'merge', from: i, to: j });
        }
      }
      for (const o of state.orders) {
        if (o.family === c.family && o.tier === c.tier) {
          actions.push({ kind: 'submit', cell: i, order: o.id });
        }
      }
      actions.push({ kind: 'trash', cell: i });
    }
  }
  return actions;
}

export function explainInvalid(state, cmd) {
  const { board } = state;
  const cellAt = (i) => (i >= 0 && i < board.length ? board[i] : undefined);
  switch (cmd.kind) {
    case 'spawn': {
      const g = cellAt(cmd.gen);
      if (!g || g.kind !== 'gen') return 'That station is not a generator.';
      if (!board.some((x) => x === null)) return 'The board is full — merge or discard something first.';
      return 'Not a legal action.';
    }
    case 'merge': {
      const a = cellAt(cmd.from), b = cellAt(cmd.to);
      if (!a || a.kind !== 'item') return 'Select an ingredient to merge.';
      if (!b || b.kind !== 'item') return 'Merge target must hold an ingredient.';
      if (cmd.from === cmd.to) return 'An item cannot merge with itself.';
      if (a.family !== b.family) return 'Different ingredient families cannot merge.';
      if (a.tier !== b.tier) return 'Only identical items merge.';
      if (a.tier >= MAX_TIER) return 'This dish is already at its highest tier.';
      return 'Not a legal action.';
    }
    case 'submit': {
      const c = cellAt(cmd.cell);
      if (!c || c.kind !== 'item') return 'Select a dish to serve.';
      const o = state.orders.find((x) => x.id === cmd.order);
      if (!o) return 'That order is no longer waiting.';
      if (o.family !== c.family || o.tier !== c.tier) return 'The dish does not match that order.';
      return 'Not a legal action.';
    }
    case 'trash': {
      const c = cellAt(cmd.cell);
      if (!c || c.kind !== 'item') return 'Only ingredients can be discarded.';
      return 'Not a legal action.';
    }
    default:
      return 'Unknown action.';
  }
}

export function isLegal(state, cmd) {
  return legalActions(state).some((a) =>
    a.kind === cmd.kind &&
    (a.gen === undefined || a.gen === cmd.gen) &&
    (a.from === undefined || a.from === cmd.from) &&
    (a.to === undefined || a.to === cmd.to) &&
    (a.cell === undefined || a.cell === cmd.cell) &&
    (a.order === undefined || a.order === cmd.order));
}

// ------------------------------------------------------- Command apply ----
// cmd: {id, kind, ...}. Returns {ok, reason?, events:[]}.
// Events feed audio/VFX: {type:'spawn'|'merge'|'submit'|'trash'|'expire'|'end', ...}
export function applyCommand(state, level, cmd) {
  const events = [];
  if (state.phase !== 'active') {
    return { ok: false, reason: 'The round has ended.', events };
  }
  if (!isLegal(state, cmd)) {
    state.invalidActions++;
    return { ok: false, reason: explainInvalid(state, cmd), events };
  }
  const { board } = state;
  switch (cmd.kind) {
    case 'spawn': {
      const fam = board[cmd.gen].family;
      const empties = [];
      board.forEach((c, i) => { if (c === null) empties.push(i); });
      const idx = empties[Math.floor(state._streams.rules() * empties.length)];
      board[idx] = { kind: 'item', family: fam, tier: 1 };
      state.moves++;
      events.push({ type: 'spawn', cell: idx, family: fam });
      break;
    }
    case 'merge': {
      const a = board[cmd.from];
      board[cmd.to] = { kind: 'item', family: a.family, tier: a.tier + 1 };
      board[cmd.from] = null;
      state.moves++;
      events.push({ type: 'merge', cell: cmd.to, from: cmd.from, family: a.family, tier: a.tier + 1 });
      break;
    }
    case 'submit': {
      const c = board[cmd.cell];
      const oi = state.orders.findIndex((x) => x.id === cmd.order);
      const order = state.orders[oi];
      state.orders.splice(oi, 1);
      board[cmd.cell] = null;
      state.moves++;
      state.fulfilled++;
      // Streak: consecutive submissions within 60 ticks (6 s) chain.
      const chained = state.tick - state.lastSubmitTick <= 60;
      state.streak = chained ? state.streak + 1 : 1;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
      state.lastSubmitTick = state.tick;
      const streakBonus = (state.streak - 1) * Math.floor(order.value * 0.2);
      state.score.orders += order.value;
      state.score.streaks += streakBonus;
      events.push({ type: 'submit', cell: cmd.cell, order, streak: state.streak, gained: order.value + streakBonus });
      // Replacement order arrives shortly.
      if (state.orderSpawnIn <= 0) state.orderSpawnIn = 30;
      if (state.ordersTarget != null && state.fulfilled >= state.ordersTarget) {
        endGame(state, 'orders-complete', events);
      }
      break;
    }
    case 'trash': {
      events.push({ type: 'trash', cell: cmd.cell, item: board[cmd.cell] });
      board[cmd.cell] = null;
      state.moves++;
      break;
    }
  }
  if (state.movesLeft != null) {
    state.movesLeft--;
    if (state.movesLeft <= 0 && state.phase === 'active') endGame(state, 'moves-exhausted', events);
  }
  return { ok: true, events };
}

// Fixed-step advance of timers. Deterministic; called every TICK_MS during play.
export function advance(state, level) {
  const events = [];
  if (state.phase !== 'active') return events;
  state.tick++;
  if (state.timeLeft != null) {
    state.timeLeft--;
    if (state.timeLeft <= 0) {
      endGame(state, 'time-up', events);
      return events;
    }
  }
  // Order expiry.
  for (let i = state.orders.length - 1; i >= 0; i--) {
    const o = state.orders[i];
    o.timeLeft--;
    if (o.timeLeft <= 0) {
      state.orders.splice(i, 1);
      state.streak = 0;
      events.push({ type: 'expire', order: o });
      if (state.orderSpawnIn <= 0) state.orderSpawnIn = 40;
    }
  }
  if (state.orderSpawnIn > 0) {
    state.orderSpawnIn--;
    if (state.orderSpawnIn === 0) {
      if (spawnOrder(state, level)) events.push({ type: 'new-order', order: state.orders[state.orders.length - 1] });
    }
  }
  return events;
}

function endGame(state, reason, events) {
  state.phase = 'ended';
  state.terminalReason = reason;
  // Board efficiency: reward open cells at the end.
  const total = state.board.length;
  const empty = state.board.filter((c) => c === null).length;
  state.score.efficiency = Math.round((empty / total) * 100);
  events.push({ type: 'end', reason });
}

export function totalScore(state) {
  return state.score.orders + state.score.streaks + state.score.efficiency;
}

// Tie-break ordering: objective completion, fewer invalid actions, lower
// elapsed ticks, then stable session identifier.
export function compareResults(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.fulfilled !== a.fulfilled) return b.fulfilled - a.fulfilled;
  if (a.invalidActions !== b.invalidActions) return a.invalidActions - b.invalidActions;
  if (a.ticks !== b.ticks) return a.ticks - b.ticks;
  return String(a.sessionId).localeCompare(String(b.sessionId));
}

// ------------------------------------------------------------- Replay ----
// Replay envelope: schema version, content version, seed, initial hash,
// ordered commands, periodic state hashes, terminal result.
export function makeReplayEnvelope(level, seed) {
  const probe = createGame(level, seed);
  return {
    schema: 1,
    rulesVersion: RULES_VERSION,
    levelId: level.id,
    contentVersion: level.version || 1,
    seed,
    initialHash: stateHash(probe),
    startedAtOffset: 0,
    commands: [], // {tick, id, kind, ...}
    hashes: [],   // {after, hash}
    terminal: null,
  };
}

export function recordCommand(envelope, state, cmd) {
  envelope.commands.push({ tick: state.tick, id: cmd.id, kind: cmd.kind, gen: cmd.gen, from: cmd.from, to: cmd.to, cell: cmd.cell, order: cmd.order });
  envelope.hashes.push({ after: envelope.commands.length, hash: stateHash(state) });
}

export function closeEnvelope(envelope, state) {
  envelope.terminal = {
    reason: state.terminalReason,
    score: totalScore(state),
    components: { ...state.score },
    fulfilled: state.fulfilled,
    invalidActions: state.invalidActions,
    ticks: state.tick,
  };
}

// Deterministic replay: re-run the envelope; verify hashes and terminal state.
// Commands carry the tick at which they were applied; advances are implied
// (engine advances to the command's tick before applying).
export function replayEnvelope(level, envelope) {
  if (envelope.schema !== 1 || envelope.rulesVersion !== RULES_VERSION) {
    return { ok: false, reason: 'unsupported-version' };
  }
  const state = createGame(level, envelope.seed);
  if (stateHash(state) !== envelope.initialHash) return { ok: false, reason: 'initial-hash-mismatch' };
  let hi = 0;
  const seen = new Set();
  for (const rec of envelope.commands) {
    if (seen.has(rec.id)) return { ok: false, reason: 'duplicate-command-id' };
    seen.add(rec.id);
    while (state.tick < rec.tick && state.phase === 'active') advance(state, level);
    const res = applyCommand(state, level, rec);
    if (!res.ok) return { ok: false, reason: 'illegal-command:' + (res.reason || rec.kind) };
    if (hi < envelope.hashes.length && envelope.hashes[hi].after === seen.size) {
      if (envelope.hashes[hi].hash !== stateHash(state)) return { ok: false, reason: 'hash-mismatch' };
      hi++;
    }
  }
  // Run out the clock to the recorded terminal tick.
  const target = envelope.terminal ? envelope.terminal.ticks : state.tick;
  let guard = 200000;
  while (state.phase === 'active' && state.tick < target && guard-- > 0) advance(state, level);
  if (guard <= 0) return { ok: false, reason: 'unbounded-loop' };
  if (envelope.terminal) {
    const t = envelope.terminal;
    if (state.terminalReason !== t.reason || totalScore(state) !== t.score) {
      return { ok: false, reason: 'terminal-mismatch' };
    }
  }
  return { ok: true, state, score: totalScore(state) };
}
