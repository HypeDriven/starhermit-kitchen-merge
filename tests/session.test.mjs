// js/session.js on the host's fixed steps: tick() advances the round's clock one
// TICK_MS step, only while started and not paused; undo restores the board.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../js/session.js';
import { JOURNEY_LEVELS, practiceLevel } from '../js/content.js';

test('the clock runs only on tick(), and not while paused or stopped', () => {
  const s = new Session(JOURNEY_LEVELS[0]);
  const t0 = s.state.timeLeft;
  s.tick();
  assert.equal(s.state.timeLeft, t0, 'not started');
  s.start();
  for (let i = 0; i < 10; i++) s.tick();
  assert.equal(s.state.timeLeft, t0 - 10);
  s.pause();
  s.tick();
  assert.equal(s.state.timeLeft, t0 - 10);
  s.resume();
  s.tick();
  s.stop();
  s.tick();
  assert.equal(s.state.timeLeft, t0 - 11);
});

test('a timed round ends with its results after its last tick', () => {
  let result = null;
  const level = { ...JOURNEY_LEVELS[0], timeLimit: 20 };
  const s = new Session(level, { onEnd: (r) => { result = r; } });
  s.start();
  for (let i = 0; i < 25; i++) s.tick();
  assert.equal(result.reason, 'time-up');
  assert.equal(s.state.phase, 'ended');
});

test('practice undo restores the board', () => {
  const s = new Session(practiceLevel('relaxed'));
  s.start();
  const gen = s.state.board.findIndex((c) => c && c.kind === 'gen');
  const before = JSON.stringify(s.state.board);
  assert.ok(s.command({ kind: 'spawn', gen }).ok);
  assert.notEqual(JSON.stringify(s.state.board), before);
  assert.ok(s.undo());
  assert.equal(JSON.stringify(s.state.board), before);
});
