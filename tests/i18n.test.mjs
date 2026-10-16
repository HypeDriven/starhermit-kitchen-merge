// Every player-facing string exists in all nine locales (node --test).
// Keys are the US-English source strings (see tests/i18n-keys.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DICTS, LOCALES, T, setLocale } from '../js/i18n.js';
import { stringsFor, shStrings } from '../js/gfx-ui.js';
import { ALL } from './i18n-keys.mjs';

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

test('Graphics and StarHermit strings follow the game language in all nine locales', () => {
  for (const locale of LOCALES) {
    assert.ok(stringsFor(locale)?.graphics, locale);
    setLocale(locale);
    assert.ok(shStrings().signIn, locale);
  }
  setLocale('de-DE');
  assert.equal(shStrings().invite, 'Freund einladen');
  setLocale('en-US');
});

test('T falls back to the key and fills placeholders; regional variants inherit', () => {
  setLocale('de-DE');
  assert.equal(T('Not a real key {x}', { x: 1 }), 'Not a real key 1');
  assert.equal(T('Stage {n}', { n: 2 }), 'Etappe 2');
  setLocale('fr-CA');
  assert.equal(T('Score'), 'Pointage');
  assert.equal(T('Merge'), 'Fusionner'); // inherited from fr-FR
  setLocale('es-ES');
  assert.equal(T('Settings'), 'Ajustes');
  assert.equal(T('Merge'), 'Combinar');
  setLocale('en-GB');
  assert.equal(T('Color-vision palette'), 'Colour-vision palette');
  setLocale('en-US');
  assert.equal(T('Merge'), 'Merge');
});
