// js/platform.js over the shared StarHermit SDK: token, profile, cloud save
// game:<slug>, settings KV, bindings, invite link, standalone guarantee.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlatform, mergeDocs } from '../js/platform.js';

// The SDK is a UMD classic script; under "type": "module" load it as CommonJS by hand.
const sdkModule = { exports: {} };
new Function('module', 'exports', readFileSync(new URL('../js/starhermit-sdk.js', import.meta.url), 'utf8'))(sdkModule, sdkModule.exports);
const SDK = sdkModule.exports;

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = () => 'h.' + b64u({ sub: 'user-123456789', game_scope: 'gid-1', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.s';

function backend() {
  const calls = [], saves = {}, settings = {}, etags = {};
  let version = 0;
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body, auth: init.headers && init.headers.Authorization });
    const r = (st, b) => new Response(b, { status: st });
    if (url.includes('/cloud-saves/')) {
      // Conditional writes like the platform: If-Match must name the current
      // version, If-None-Match: * needs an empty slot; otherwise 412.
      const rest = decodeURIComponent(url.split('/cloud-saves/')[1]);
      const key = rest.replace(/\/info$/, '');
      if (rest.endsWith('/info')) return r(200, JSON.stringify(saves[key] ? { exists: true, etag: etags[key] } : { exists: false }));
      if (method === 'PUT') {
        const h = init.headers || {};
        if ((h['If-Match'] && h['If-Match'] !== etags[key]) || (h['If-None-Match'] === '*' && saves[key])) {
          return r(412, JSON.stringify({ error: 'precondition_failed', etag: etags[key] }));
        }
        saves[key] = Buffer.from(body.dataBase64, 'base64');
        etags[key] = '"v' + (++version) + '"';
        return r(200, JSON.stringify({ etag: etags[key] }));
      }
      return saves[key] ? r(200, saves[key]) : r(404, '');
    }
    if (url.endsWith('/profile')) return r(200, JSON.stringify({ username: 'pk', nickname: 'Al' }));
    if (/\/settings$/.test(url)) {
      if (method === 'PATCH') Object.assign(settings, body.settings);
      return r(200, JSON.stringify({ settings }));
    }
    if (url.endsWith('/controls')) return r(200, JSON.stringify({ actions: [{ action: 'serve', codes: ['KeyV'] }] }));
    return r(404, '');
  };
  return { calls, saves, fetch };
}

function memStore() {
  const ls = { settings: { music: 0.6 }, progress: { journeyStage: 2 }, scores: {} };
  return {
    ls,
    lsSet: (k, v) => { ls[k] = v; },
    store: { getSettings: () => ls.settings, getProgress: () => ls.progress, getScores: () => ls.scores },
  };
}

function make(hash, fetch, hostname = 'localhost', hooks = {}) {
  let replaced = null;
  const win = { location: { hash, search: '', pathname: '/', hostname, origin: 'https://' + hostname, href: '' }, history: { replaceState: (a, b, u) => { replaced = u; } } };
  const sh = SDK.create({ window: win, fetch });
  const m = memStore();
  const platform = createPlatform({ sh, store: m.store, lsSet: m.lsSet, hooks }).init();
  return { platform, sh, m, replaced: () => replaced };
}

test('launch token: nickname, cloud save game:<slug> round-trip, settings, bindings, invite', async () => {
  const be = backend();
  const { platform, sh, m, replaced } = make('#game_token=' + token(), be.fetch);
  assert.equal(platform.hosted, true);
  assert.equal(platform.slug, 'gid-1');
  assert.equal(replaced(), '/');
  await platform.fetchProfile();
  assert.equal(platform.nickname, 'Al');

  await platform.loadCloud(); // empty slot: pushes the local doc
  const put = be.calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, '/api/v1/me/cloud-saves/' + encodeURIComponent('game:gid-1'));
  assert.equal(platform.syncState, 'synced');

  // A second device adopts the remote progress.
  const other = make('#game_token=' + token(), be.fetch);
  other.m.ls.progress = { journeyStage: 0 };
  await other.platform.loadCloud();
  assert.equal(other.m.ls.progress.journeyStage, 2);

  platform.patchSettings({ music: 0.2 });
  await new Promise((r) => setTimeout(r, 10));
  const patch = be.calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.url, '/api/v1/games/gid-1/settings');
  assert.deepEqual(patch.body, { settings: { music: 0.2 } });
  assert.deepEqual(await platform.getSettings(), { music: 0.2 });

  assert.deepEqual(await platform.loadBindings({ serve: ['KeyS'], hint: ['KeyH'] }), { serve: ['KeyV'], hint: ['KeyH'] });
  assert.ok(platform.inviteLink().endsWith('/game-invite/user-123456789/gid-1'));
  assert.ok(be.calls.every((c) => c.auth === 'Bearer ' + sh.token));
  sh.signOut(); other.sh.signOut();
});

test('standalone: no platform calls', async () => {
  let fetched = 0;
  const { platform } = make('', async () => { fetched++; throw new Error('offline'); });
  assert.equal(platform.hosted, false);
  assert.equal(platform.canSignIn(), false);
  await platform.fetchProfile();
  await platform.loadCloud();
  platform.scheduleCloudPush();
  await platform.flushCloud();
  platform.patchSettings({ a: 1 });
  assert.deepEqual(await platform.getSettings(), {});
  assert.deepEqual(await platform.loadBindings({ hint: ['KeyH'] }), { hint: ['KeyH'] });
  assert.equal(platform.inviteLink(), null);
  assert.equal(await platform.fetchLeaderboard(), null);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetched++; throw new Error('offline'); };
  try { await platform.fetchTime(); } finally { globalThis.fetch = realFetch; }
  assert.equal(fetched, 0);
});

test('hosted domain without a token offers sign-in', () => {
  const { platform } = make('', async () => { throw new Error('offline'); }, '0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com');
  assert.equal(platform.canSignIn(), true);
});

test('save conflict: a write that lost to another device reloads, merges both sides and saves again', async (t) => {
  const be = backend();
  const a = make('#game_token=' + token(), be.fetch);
  const b = make('#game_token=' + token(), be.fetch);
  t.after(() => { a.sh.signOut(); b.sh.signOut(); });
  a.m.ls.progress = { journeyStage: 5, stars: { 1: 3, 2: 1 }, tutorialsDone: ['learn-1'], achievements: {}, playDays: ['2026-10-01'] };
  b.m.ls.progress = { journeyStage: 3, stars: { 2: 2 }, tutorialsDone: ['learn-2'], achievements: { first_service: { at: '2026-10-02', announced: true } }, playDays: ['2026-10-02'] };
  a.m.ls.scores = { 'journey-1': [{ score: 50, sessionId: 'a1' }] };
  b.m.ls.scores = { 'journey-1': [{ score: 70, sessionId: 'b1' }] };
  await a.platform.loadCloud(); // empty slot: A pushes first
  await b.platform.loadCloud(); // B adopts A's save, then progresses locally
  b.m.ls.progress = { ...b.m.ls.progress, journeyStage: 6, stars: { ...b.m.ls.progress.stars, 6: 2 }, achievements: { first_service: { at: '2026-10-02', announced: true } } };
  b.m.ls.scores = { 'journey-1': [...b.m.ls.scores['journey-1'], { score: 70, sessionId: 'b1' }] };
  a.m.ls.progress = { ...a.m.ls.progress, achievements: { hot_streak: { at: '2026-10-03', announced: false } } };
  a.platform.scheduleCloudPush(); await a.platform.flushCloud(); // A saves again (new version)
  let conflicted = false;
  b.sh.on('saveconflict', () => { conflicted = true; });
  b.platform.scheduleCloudPush();
  assert.equal(await b.platform.flushCloud(), false, 'B lost the conditional write');
  assert.ok(conflicted);
  for (let i = 0; i < 20 && b.sh.saveConflicted(); i++) await new Promise((r) => setTimeout(r, 5));
  await b.platform.flushCloud();
  const p = b.m.ls.progress;
  assert.equal(p.journeyStage, 6);
  assert.equal(p.stars['1'], 3);
  assert.equal(p.stars['6'], 2);
  assert.ok(p.achievements.hot_streak && p.achievements.first_service);
  assert.deepEqual(b.m.ls.scores['journey-1'].map((e) => e.sessionId), ['b1', 'a1']);
  const c = make('#game_token=' + token(), be.fetch);
  c.m.ls.progress = {};
  await c.platform.loadCloud();
  assert.equal(c.m.ls.progress.journeyStage, 6, 'the merged document reached the cloud');
  assert.ok(c.m.ls.progress.achievements.hot_streak);
  c.sh.signOut();
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
