// Every player-facing string exists in all nine locales (node --test).
// Keys are the US-English source strings (see tests/i18n-keys.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL } from './i18n-keys.mjs';

const DICTS = JSON.parse(readFileSync(new URL('../assets/strings.json', import.meta.url), 'utf8'));
const LOCALES = Object.keys(DICTS);
const PARENT = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
const T = (l, k) => { for (let c = l; c; c = PARENT[c]) if (Object.hasOwn(DICTS[c], k)) return DICTS[c][k]; return k; };
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('the key set is non-trivial', () => {
  assert.ok(ALL.size > 150, `only ${ALL.size} keys found`);
});

for (const locale of LOCALES.filter((l) => l !== 'en-US' && l !== 'en-GB')) {
  test(`${locale}: every key is translated with the same placeholders`, () => {
    const dict = DICTS[locale];
    const missing = [...ALL].filter((k) => !Object.prototype.hasOwnProperty.call(dict, k));
    assert.deepEqual(missing, [], `${missing.length} missing in ${locale}`);
    const bad = [...ALL].filter((k) => placeholders(dict[k]) !== placeholders(k));
    assert.deepEqual(bad, [], `placeholder mismatch in ${locale}`);
  });
}

test('no locale carries keys that no longer exist', () => {
  for (const locale of LOCALES) {
    const stray = Object.keys(DICTS[locale]).filter((k) => !ALL.has(k));
    assert.deepEqual(stray, [], locale);
  }
});

test('regional variants inherit', () => {
  assert.equal(T('de-DE', 'Stage {n}'), 'Etappe {n}');
  assert.equal(T('fr-CA', 'Score'), 'Pointage');
  assert.equal(T('fr-CA', 'Merge'), 'Fusionner'); // inherited from fr-FR
  assert.equal(T('es-ES', 'Settings'), 'Ajustes');
  assert.equal(T('es-ES', 'Merge'), 'Combinar');
  assert.equal(T('en-GB', 'Color-vision palette'), 'Colour-vision palette');
  assert.equal(T('en-US', 'Merge'), 'Merge');
});
