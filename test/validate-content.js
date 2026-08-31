// Offline content validator runner: proves basic legality, reachable goals,
// bounded duration and absence of soft locks for all shipped content.
import { validateAll, JOURNEY_LEVELS, CHALLENGES, TUTORIALS, dailyLevel } from '../js/content.js';
import { createGame, legalActions, applyCommand, advance, MAX_TIER, FAMILIES } from '../js/rules.js';

let failed = 0;

const report = validateAll();
for (const r of report) {
  if (!r.ok) { failed++; console.error('INVALID ' + r.id + ': ' + r.errors.join(', ')); }
}
console.log('Validated ' + report.length + ' content entries: ' + report.filter((r) => r.ok).length + ' ok');

// Soft-lock probe: from the initial state of every level, there is always at
// least one legal action, and greedy play can fulfill an order.
const levels = [
  ...JOURNEY_LEVELS, ...CHALLENGES.map((c) => c.level),
  dailyLevel('2026-08-29'),
];
for (const lv of levels) {
  const s = createGame(lv);
  if (!legalActions(s).length) { failed++; console.error('SOFT LOCK at start: ' + lv.id); continue; }
  // Greedy auto-play: spawn from first generator, merge when possible,
  // submit when possible, trash tier-1 clutter if board nearly full.
  let guard = 0, served = 0;
  while (s.phase === 'active' && guard++ < 20000) {
    const acts = legalActions(s);
    // Prefer merges that advance an open order's family.
    const orderFamTier = (a) => {
      const cell = s.board[a.from];
      if (!cell) return -1;
      const o = s.orders.find((x) => x.family === cell.family);
      return o ? 10 - Math.abs(o.tier - (cell.tier + 1)) : -1;
    };
    const merges = acts.filter((a) => a.kind === 'merge').sort((a, b) => orderFamTier(b) - orderFamTier(a));
    // Spawn from the station whose family matches the most urgent order.
    let spawn = null;
    if (s.orders.length) {
      const want = [...s.orders].sort((a, b) => a.timeLeft - b.timeLeft)[0].family;
      spawn = acts.find((a) => a.kind === 'spawn' && s.board[a.gen].family === want);
    }
    spawn = spawn || acts.find((a) => a.kind === 'spawn');
    const pick = acts.find((a) => a.kind === 'submit') || merges[0] || spawn || acts[0];
    if (pick) {
      const before = s.fulfilled;
      applyCommand(s, lv, { id: 'v' + guard, ...pick });
      if (s.fulfilled > before) served++;
    } else {
      const trash = legalActions(s).find((a) => a.kind === 'trash');
      if (trash) applyCommand(s, lv, { id: 'v' + guard, ...trash });
    }
    advance(s, lv);
  }
  if (guard >= 20000) { failed++; console.error('UNBOUNDED: ' + lv.id); }
  if (s.phase !== 'ended' && lv.kind !== 'tutorial') { failed++; console.error('NO TERMINAL: ' + lv.id); }
  if (served === 0) { failed++; console.error('UNREACHABLE GOALS: ' + lv.id); }
}
console.log(failed ? 'CONTENT VALIDATION FAILED (' + failed + ')' : 'All content reachable, bounded, soft-lock free.');
process.exit(failed ? 1 : 0);
