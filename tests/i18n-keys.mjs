// Key extraction for the i18n coverage test (run directly to list the keys).
// Keys are the US-English source strings: literal T('…') / N('…') calls in js/
// and native/, the content tables' display fields and the
// English sentences the rules engine and hint engine return.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { FAMILIES } from '../js/rules.js';
import { THEMES, TUTORIALS, CHALLENGES, ACHIEVEMENTS } from '../js/content.js';

const ROOT = new URL('..', import.meta.url).pathname;
const unescape = (s) => s.replace(/\\(['"\\])/g, '$1');

export function sourceKeys() {
  const keys = new Set();
  const call = /(?<![\w.$])(?:T|N)\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)")/g;
  const dirs = [['js', '.js'], ['native', '.ts']];
  for (const [dir, ext] of dirs) {
    for (const f of readdirSync(join(ROOT, dir))) {
      if (!f.endsWith(ext) || f.startsWith('i18n.')) continue;
      const src = readFileSync(join(ROOT, dir, f), 'utf8');
      for (const m of src.matchAll(call)) keys.add(unescape(m[1] ?? m[2]));
    }
  }
  return keys;
}

export function contentKeys() {
  const keys = new Set();
  const add = (...v) => v.forEach((s) => { if (typeof s === 'string' && s) keys.add(s); });
  for (const f of Object.values(FAMILIES)) { add(f.name); f.tiers.forEach((t) => add(t)); }
  for (const t of THEMES) add(t.name);
  for (const t of TUTORIALS) add(t.title, t.brief);
  for (const c of CHALLENGES) add(c.name, c.blurb);
  for (const a of ACHIEVEMENTS) add(a.name);
  // Refusals (rules.js explainInvalid / applyCommand) and hints (session.js) are shown via T().
  const rules = readFileSync(join(ROOT, 'js/rules.js'), 'utf8');
  const explain = rules.slice(rules.indexOf('function explainInvalid'), rules.indexOf('function explainInvalid') + 2000);
  for (const m of explain.matchAll(/return '([^']+)';/g)) add(m[1]);
  add('The round has ended.');
  const session = readFileSync(join(ROOT, 'js/session.js'), 'utf8');
  for (const m of session.matchAll(/text: '([^']+)'/g)) add(m[1]);
  return keys;
}

export const ALL = new Set([...sourceKeys(), ...contentKeys()]);

if (process.argv[1] && process.argv[1].endsWith('i18n-keys.mjs')) console.log(JSON.stringify([...ALL], null, 1));
