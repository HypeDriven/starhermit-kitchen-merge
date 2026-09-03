// Kitchen Merge — rules engine tests: legal actions, invalid reasons,
// scoring components, terminal states, serialization, deterministic replay,
// fuzz of malformed commands.
import {
  createGame, applyCommand, advance, legalActions, isLegal, explainInvalid,
  totalScore, stateHash, serializeState, makeReplayEnvelope, recordCommand,
  closeEnvelope, replayEnvelope, FAMILIES, MAX_TIER, TICK_MS,
} from '../js/rules.js';

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('ok — ' + name); }
  catch (e) { failed++; console.error('FAIL — ' + name + ': ' + e.message); }
}
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || 'neq') + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

const level = {
  id: 'test', version: 1, seed: 1234, cols: 6, rows: 6,
  families: ['grain', 'garden'], orderMaxTier: 2, openOrders: 2,
  timeLimit: 1000, ordersTarget: null,
};

function spawnInto(state, lv, genIdx) {
  return applyCommand(state, lv, { id: 'c' + Math.random(), kind: 'spawn', gen: genIdx });
}

t('createGame places generators and initial orders', () => {
  const s = createGame(level);
  const gens = s.board.filter((c) => c && c.kind === 'gen');
  eq(gens.length, 2);
  eq(s.orders.length, 2);
  eq(s.tick, 0);
  eq(s.phase, 'active');
});

t('spawn command is legal on a generator and adds an item', () => {
  const s = createGame(level);
  const genIdx = s.board.findIndex((c) => c && c.kind === 'gen');
  const res = spawnInto(s, level, genIdx);
  ok(res.ok);
  eq(s.moves, 1);
  ok(s.board.some((c) => c && c.kind === 'item'));
});

t('illegal spawn target returns reason and counts invalid', () => {
  const s = createGame(level);
  const res = applyCommand(s, level, { id: 'x', kind: 'spawn', gen: 0 });
  ok(!res.ok);
  eq(s.invalidActions, 1);
  ok(res.reason.length > 0);
});

t('merge requires identical family and tier', () => {
  const s = createGame(level);
  // Place two identical items manually via serialized edit of fresh board.
  s.board[0] = { kind: 'item', family: 'grain', tier: 1 };
  s.board[1] = { kind: 'item', family: 'grain', tier: 1 };
  ok(isLegal(s, { kind: 'merge', from: 0, to: 1 }));
  const res = applyCommand(s, level, { id: 'm', kind: 'merge', from: 0, to: 1 });
  ok(res.ok);
  eq(s.board[1], { kind: 'item', family: 'grain', tier: 2 });
  eq(s.board[0], null);
  s.board[2] = { kind: 'item', family: 'garden', tier: 2 };
  ok(!isLegal(s, { kind: 'merge', from: 1, to: 2 }));
  ok(explainInvalid(s, { kind: 'merge', from: 1, to: 2 }).includes('families'));
  s.board[3] = { kind: 'item', family: 'grain', tier: 1 };
  ok(!isLegal(s, { kind: 'merge', from: 1, to: 3 }));
  // Max tier cannot merge further.
  s.board[4] = { kind: 'item', family: 'grain', tier: MAX_TIER };
  s.board[5] = { kind: 'item', family: 'grain', tier: MAX_TIER };
  ok(!isLegal(s, { kind: 'merge', from: 4, to: 5 }));
});

t('submit matches an order, scores value and streak', () => {
  const s = createGame(level);
  s.orders = [{ id: 1, family: 'grain', tier: 2, timeLeft: 400, maxTime: 400, value: 40 }];
  s.board[0] = { kind: 'item', family: 'grain', tier: 2 };
  const r1 = applyCommand(s, level, { id: 's1', kind: 'submit', cell: 0, order: 1 });
  ok(r1.ok);
  eq(s.score.orders, 40);
  eq(s.fulfilled, 1);
  eq(s.streak, 1);
  // Second submit within the streak window chains.
  s.orders = [{ id: 2, family: 'garden', tier: 1, timeLeft: 400, maxTime: 400, value: 12 }];
  s.board[3] = { kind: 'item', family: 'garden', tier: 1 };
  const r2 = applyCommand(s, level, { id: 's2', kind: 'submit', cell: 3, order: 2 });
  ok(r2.ok);
  eq(s.streak, 2);
  ok(s.score.streaks > 0);
  // Mismatched dish is rejected with reason.
  s.board[4] = { kind: 'item', family: 'grain', tier: 1 };
  s.orders = [{ id: 3, family: 'grain', tier: 3, timeLeft: 400, maxTime: 400, value: 90 }];
  const r3 = applyCommand(s, level, { id: 's3', kind: 'submit', cell: 4, order: 3 });
  ok(!r3.ok);
  ok(r3.reason.includes('match'));
});

t('terminal: orders-complete ends the game with efficiency score', () => {
  const lv = { ...level, ordersTarget: 1, timeLimit: null };
  const s = createGame(lv);
  s.orders = [{ id: 1, family: 'grain', tier: 1, timeLeft: 400, maxTime: 400, value: 10 }];
  s.board[0] = { kind: 'item', family: 'grain', tier: 1 };
  applyCommand(s, lv, { id: 'f', kind: 'submit', cell: 0, order: 1 });
  eq(s.phase, 'ended');
  eq(s.terminalReason, 'orders-complete');
  ok(s.score.efficiency > 0);
  // No further commands.
  ok(!applyCommand(s, lv, { id: 'g', kind: 'trash', cell: 2 }).ok);
});

t('terminal: time-up via advance; orders expire', () => {
  const lv = { ...level, timeLimit: 5 };
  const s = createGame(lv);
  for (let i = 0; i < 5; i++) advance(s, lv);
  eq(s.phase, 'ended');
  eq(s.terminalReason, 'time-up');
});

t('order expiry clears streak', () => {
  const s = createGame(level);
  s.streak = 3;
  s.orders = [{ id: 9, family: 'grain', tier: 1, timeLeft: 1, maxTime: 400, value: 10 }];
  const events = advance(s, level);
  eq(s.streak, 0);
  ok(events.some((e) => e.type === 'expire'));
});

t('serialization round-trips and hash is stable', () => {
  const s = createGame(level);
  const snap = serializeState(s);
  const h1 = stateHash(s);
  const s2 = JSON.parse(JSON.stringify(snap));
  s2._streams = s._streams;
  eq(stateHash(s2), h1);
  ok(!JSON.stringify(snap).includes('_streams'));
});

t('deterministic replay: same seed and commands → identical hashes', () => {
  function run() {
    const s = createGame(level);
    const env = makeReplayEnvelope(level, level.seed);
    const genIdx = s.board.findIndex((c) => c && c.kind === 'gen');
    let cid = 0;
    for (let i = 0; i < 50 && s.phase === 'active'; i++) {
      const actions = legalActions(s);
      if (actions.length) {
        const cmd = { id: 'r' + (cid++), ...actions[i % actions.length] };
        const res = applyCommand(s, level, cmd);
        if (res.ok) recordCommand(env, s, cmd);
      }
      advance(s, level);
    }
    closeEnvelope(env, s);
    return env;
  }
  const e1 = run(), e2 = run();
  eq(e1.terminal, e2.terminal);
  eq(e1.hashes, e2.hashes);
  const rep = replayEnvelope(level, e1);
  ok(rep.ok, 'replay failed: ' + rep.reason);
  eq(rep.score, e1.terminal.score);
});

t('replay rejects tampered terminal score', () => {
  const s = createGame(level);
  const env = makeReplayEnvelope(level, level.seed);
  const genIdx = s.board.findIndex((c) => c && c.kind === 'gen');
  applyCommand(s, level, { id: 'a', kind: 'spawn', gen: genIdx });
  recordCommand(env, s, { id: 'a', kind: 'spawn', gen: genIdx });
  closeEnvelope(env, s);
  env.terminal.score += 999;
  const rep = replayEnvelope(level, env);
  ok(!rep.ok);
  eq(rep.reason, 'terminal-mismatch');
});

t('replay rejects duplicate command ids', () => {
  const s = createGame(level);
  const env = makeReplayEnvelope(level, level.seed);
  const genIdx = s.board.findIndex((c) => c && c.kind === 'gen');
  applyCommand(s, level, { id: 'a', kind: 'spawn', gen: genIdx });
  recordCommand(env, s, { id: 'a', kind: 'spawn', gen: genIdx });
  applyCommand(s, level, { id: 'a2', kind: 'spawn', gen: genIdx });
  env.commands.push({ ...env.commands[0] });
  closeEnvelope(env, s);
  const rep = replayEnvelope(level, env);
  ok(!rep.ok);
  eq(rep.reason, 'duplicate-command-id');
});

t('fuzz: malformed commands never hang or corrupt state', () => {
  const s = createGame(level);
  const weird = [
    {}, { kind: 'nope' }, { kind: 'merge' }, { kind: 'merge', from: -5, to: 999 },
    { kind: 'submit', cell: 'x', order: null }, { kind: 'trash', cell: NaN },
    { kind: 'spawn', gen: 1e9 }, { kind: 'merge', from: 0, to: 0 },
  ];
  for (const c of weird) {
    const res = applyCommand(s, level, { id: 'f' + Math.random(), ...c });
    ok(!res.ok, 'should reject ' + JSON.stringify(c));
    ok(typeof res.reason === 'string');
  }
  eq(s.phase, 'active');
  ok(Number.isFinite(totalScore(s)));
});

t('full random game terminates and stays finite', () => {
  const lv = { ...level, timeLimit: 300 };
  const s = createGame(lv);
  let guard = 0;
  while (s.phase === 'active' && guard++ < 10000) {
    const actions = legalActions(s);
    if (actions.length) applyCommand(s, lv, { id: 'g' + guard, ...actions[guard % actions.length] });
    advance(s, lv);
  }
  eq(s.phase, 'ended');
  ok(Number.isFinite(totalScore(s)));
  ok(guard < 10000);
});

t('legalActions is empty after end and hints cover core actions', () => {
  const s = createGame(level);
  const acts = legalActions(s);
  ok(acts.some((a) => a.kind === 'spawn'));
  s.phase = 'ended';
  eq(legalActions(s).length, 0);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
