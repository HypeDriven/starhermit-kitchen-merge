// The save document (js/save.js): the browser build's cloud-save text parses as
// the engine save, two devices' copies merge, and js/session.js's store reads
// and writes it through the localStorage keys native/platform.ts maps onto it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDocs, parseDoc, LS_PREFIX, DOC_KEYS } from '../js/save.js';

// The browser build's cloud slot: the SDK's saveJSON of its buildSaveDoc() (js/platform.js).
const OLD = JSON.stringify({
  version: 1, savedAt: '2026-10-01T10:00:00.000Z',
  settings: { music: 0.6, theme: 'garden', colorblind: true, leftHanded: false, haptics: true, graphics: { preset: 'high' } },
  progress: { journeyStage: 5, stars: { 1: 3, 2: 2 }, tutorialsDone: ['learn-1', 'learn-2', 'learn-3'], achievements: { first_service: { at: '2026-09-01', announced: true } }, playDays: ['2026-09-01'], masteryDone: 0 },
  scores: { 'journey-1': [{ score: 300, fulfilled: 3, sessionId: 'sabc', date: '2026-09-01T00:00:00Z' }] },
});

test('the browser build\'s cloud save parses as the engine save', () => {
  const d = parseDoc(OLD);
  assert.equal(d.progress.journeyStage, 5);
  assert.equal(d.settings.theme, 'garden');
  assert.equal(d.scores['journey-1'][0].score, 300);
  assert.equal(parseDoc('not json'), null);
  assert.equal(parseDoc({ settings: {} }), null, 'no progress: not a save');
  assert.deepEqual(DOC_KEYS, ['settings', 'progress', 'scores']);
  assert.equal(LS_PREFIX, 'kitchen-merge:');
});

test('migrating the old save into a fresh device keeps all its progress', () => {
  const m = mergeDocs(parseDoc(OLD), null);
  assert.equal(m.progress.journeyStage, 5);
  assert.deepEqual(m.progress.tutorialsDone, ['learn-1', 'learn-2', 'learn-3']);
  assert.equal(m.settings.theme, 'garden');
  assert.equal(m.scores['journey-1'].length, 1);
});

test('mergeDocs keeps the better side of every progress field and this device\'s settings', () => {
  const m = mergeDocs(
    { settings: { music: 0.1 }, progress: { journeyStage: 9, stars: { 1: 1 }, masteryStages: [8], masteryDone: 1, playDays: ['d1'] }, scores: {} },
    { settings: { music: 0.9 }, progress: { journeyStage: 2, stars: { 1: 3 }, masteryStages: [16], playDays: ['d2'] }, scores: { x: [{ score: 1, sessionId: 's' }] } },
  );
  assert.equal(m.settings.music, 0.9);
  assert.equal(m.progress.journeyStage, 9);
  assert.equal(m.progress.stars['1'], 3);
  assert.deepEqual(m.progress.masteryStages.sort(), [16, 8].sort());
  assert.equal(m.progress.masteryDone, 2);
  assert.deepEqual(m.progress.playDays, ['d1', 'd2']);
  assert.equal(m.scores.x.length, 1);
  assert.deepEqual(mergeDocs(null, { progress: { journeyStage: 1 } }).progress.journeyStage, 1);
});

test('score tables merge without duplicates, best first, capped at 20', () => {
  const rows = (n, base) => Array.from({ length: n }, (_, i) => ({ score: base + i, sessionId: 's' + (base + i) }));
  const m = mergeDocs({ progress: {}, scores: { a: rows(15, 0) } }, { progress: {}, scores: { a: rows(15, 10) } });
  assert.equal(m.scores.a.length, 20);
  assert.equal(m.scores.a[0].score, 24);
  assert.equal(new Set(m.scores.a.map((e) => e.sessionId)).size, 20);
});

test('the store reads and writes the document through localStorage keys', async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const { store } = await import('../js/session.js');
  for (const k of DOC_KEYS) mem.set(LS_PREFIX + k, JSON.stringify(parseDoc(OLD)[k]));
  assert.equal(store.getProgress().journeyStage, 5);
  assert.equal(store.getSettings().theme, 'garden');
  store.saveScore('daily-x', { score: 9, sessionId: 'z' });
  assert.equal(JSON.parse(mem.get('kitchen-merge:scores'))['daily-x'][0].score, 9);
});
