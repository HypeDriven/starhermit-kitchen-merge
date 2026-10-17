// Kitchen Merge — graphics quality model and panel localization (node --test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, CATEGORIES, LEVELS, BUDGETS, budget, particlePool, detectLevel, presetForLevel, detectPreset, resolve, presetTier, applyPreset, describe } from '../js/gfx.js';

// js/gpu-level.js is a classic script in the page; imported here it sets globalThis.StarHermitGpu.
await import('../js/gpu-level.js');
import { LOCALES, STRING_KEYS, stringsFor, pickLocale } from '../js/gfx-ui.js';

test('hardware level picks the Auto preset (StarHermit gpu-level.js)', () => {
  assert.equal(detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.equal(detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.equal(detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'low');
  assert.equal(detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)'), 'balanced');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)'), 'ultra');
  assert.equal(detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)'), 'ultra');
  assert.equal(detectLevel('NVIDIA GeForce RTX 5090'), 20);
  assert.equal(detectLevel('SwiftShader'), 0);
  for (const [p, lv] of Object.entries(LEVELS)) assert.equal(presetForLevel(lv), p);
  assert.equal(presetForLevel(9), 'balanced');
  assert.equal(presetForLevel(16), 'high');
});

test('hardware level: phones and tablets cap Auto at Balanced', () => {
  assert.ok(['low', 'balanced'].includes(detectPreset('Adreno (TM) 740', { mobile: true })), 'mobile Adreno 740 is Balanced at most');
  assert.equal(detectPreset('NVIDIA GeForce RTX 5090', { mobile: true }), 'balanced');
  assert.equal(detectPreset('SwiftShader', { mobile: true }), 'low');
});

test('per-preset budgets are explicit, grow from Low to Ultra and scale with the level', () => {
  const keys = ['material', 'wood', 'tile', 'segments', 'motes', 'sparks', 'bloomRes', 'aoRes'];
  for (const p of PRESETS) for (const k of keys) assert.ok(k in BUDGETS[p], `${p}.${k}`);
  for (let i = 1; i < PRESETS.length; i++) {
    const a = BUDGETS[PRESETS[i - 1]], b = BUDGETS[PRESETS[i]];
    for (const k of keys.slice(1)) assert.ok(b[k] >= a[k], `${PRESETS[i]}.${k}`);
  }
  assert.deepEqual(PRESETS.map((p) => BUDGETS[p].material), ['lambert', 'standard', 'physical', 'physical']);
  assert.ok(BUDGETS.balanced.bloomRes < 1 && BUDGETS.high.aoRes < 1 && BUDGETS.ultra.bloomRes === 1, 'half-res post below Ultra');
  assert.deepEqual(budget('high', 10), BUDGETS.high, 'floor level = table');
  assert.ok(budget('high', 14).sparks > BUDGETS.high.sparks, 'sparks grow above the floor');
  assert.ok(budget('ultra', 20).sparks <= BUDGETS.ultra.sparks * 2, 'at most 2x');
  assert.ok(budget('ultra', 2).sparks < BUDGETS.ultra.sparks, 'fewer below the floor');
  assert.equal(particlePool('high', BUDGETS.low), 150);
  assert.deepEqual(resolve({ preset: 'low' }, 'low', 0).budget, BUDGETS.low);
  assert.equal(resolve({}, 'ultra', 20).level, 20);
});

test('resolve: Auto uses the detected preset; explicit preset wins', () => {
  const a = resolve({}, 'high');
  assert.equal(a.preset, 'high');
  assert.equal(a.auto, true);
  assert.equal(a.shadows, presetTier('high', 'shadows'));
  const l = resolve({ preset: 'low' }, 'high');
  assert.equal(l.preset, 'low');
  assert.equal(l.auto, false);
  assert.equal(l.post, false, 'Low runs without the composer');
  assert.equal(l.dprCap, 1);
  assert.equal(resolve({ preset: 'bogus' }, undefined).preset, 'balanced');
});

test('resolve: overrides apply per category; invalid tiers fall back to the preset', () => {
  const r = resolve({ preset: 'low', bloom: 'on', shadows: 'nope' }, 'low');
  assert.equal(r.bloom, 'on');
  assert.equal(r.shadows, 'off');
  assert.equal(r.post, true, 'bloom needs the composer');
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    for (const p of PRESETS) assert.ok(tiers.includes(presetTier(p, cat)), `${p}.${cat}`);
  }
});

test('resolve: render scale is clamped to 50–200% and multiplies the preset scale', () => {
  assert.equal(resolve({ preset: 'high', render_scale: 5 }).scale, 2);
  assert.equal(resolve({ preset: 'high', render_scale: 0.1 }).scale, 0.5);
  assert.equal(resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
  assert.equal(resolve({}).adaptive, true);
  assert.equal(resolve({ adaptive: false, show_fps: true }).adaptive, false);
  assert.equal(resolve({ show_fps: true }).showFps, true);
});

test('applyPreset clears every category override but keeps scale and toggles', () => {
  const s = applyPreset({ preset: 'low', bloom: 'on', ao: 'high', render_scale: 1.5, show_fps: true }, 'high');
  assert.equal(s.preset, 'high');
  assert.equal(s.bloom, undefined);
  assert.equal(s.ao, undefined);
  assert.equal(s.render_scale, 1.5);
  assert.equal(s.show_fps, true);
  assert.equal(applyPreset({}, 'auto').preset, 'auto');
});

test('describe: cost summary with pixel size', () => {
  const d = describe(resolve({ preset: 'high' }), [1280, 720]);
  assert.match(d, /2048² shadows/);
  assert.match(d, /SMAA/);
  assert.match(d, /1280×720 px/);
  assert.match(describe(resolve({ preset: 'low' })), /no shadows/);
});

test('graphics panel strings exist in every required locale', () => {
  for (const loc of ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT']) {
    assert.ok(LOCALES.includes(loc), loc);
    const S = stringsFor(loc);
    for (const k of STRING_KEYS) assert.ok(typeof S[k] === 'string' && S[k].length, `${loc}.${k}`);
  }
  assert.equal(pickLocale(['fr-CA']), 'fr-CA');
  assert.equal(pickLocale(['es-MX']), 'es-419');
  assert.equal(pickLocale(['en-AU']), 'en-GB');
  assert.equal(pickLocale(['ja-JP']), 'en-US');
});
