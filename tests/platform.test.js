// js/platform.js over the shared StarHermit SDK: token, profile, cloud save
// game:<slug>, settings KV, bindings, invite link, standalone guarantee.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlatform } from '../js/platform.js';

// The SDK is a UMD classic script; under "type": "module" load it as CommonJS by hand.
const sdkModule = { exports: {} };
new Function('module', 'exports', readFileSync(new URL('../js/starhermit-sdk.js', import.meta.url), 'utf8'))(sdkModule, sdkModule.exports);
const SDK = sdkModule.exports;

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = () => 'h.' + b64u({ sub: 'user-123456789', game_scope: 'gid-1', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.s';

function backend() {
  const calls = [], saves = {}, settings = {};
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body, auth: init.headers && init.headers.Authorization });
    const r = (st, b) => new Response(b, { status: st });
    if (url.includes('/cloud-saves/')) {
      const key = decodeURIComponent(url.split('/cloud-saves/')[1]);
      if (method === 'PUT') { saves[key] = Buffer.from(body.dataBase64, 'base64'); return r(200, '{}'); }
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
  const { platform } = make('', async () => { throw new Error('offline'); }, 'gid-1.starhermit.com');
  assert.equal(platform.canSignIn(), true);
});
