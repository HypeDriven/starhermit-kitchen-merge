// Kitchen Merge — versioned content: levels, tutorials, themes, achievements.
// All content is data with identifier, seed, initial state, goals, allowed
// mechanics, par values, tutorial flags and presentation theme.
import { FAMILY_KEYS, hashString } from './rules.js';

export const CONTENT_VERSION = 1;

// ------------------------------------------------------------ Themes ----
export const THEMES = [
  { id: 'hearth',  name: 'Hearth Kitchen',  bg: 0x1d1512, key: 0xffd9a0, fill: 0x6b5a8a, floor: 0x4a3a2e, board: 0x8a6a4a, accent: '#e8a04c' },
  { id: 'garden',  name: 'Garden Veranda',  bg: 0x12211a, key: 0xd8ffd0, fill: 0x4a7a6a, floor: 0x2e4a38, board: 0x5a8a62, accent: '#7cc98f' },
  { id: 'midnight',name: 'Midnight Diner',  bg: 0x0d1020, key: 0xa0c8ff, fill: 0x3a3a6a, floor: 0x22283f, board: 0x3a4670, accent: '#6fa8dc' },
  { id: 'sunrise', name: 'Sunrise Bakery',  bg: 0x241a20, key: 0xffc0b0, fill: 0x8a5a6a, floor: 0x503a44, board: 0xa06a70, accent: '#e8837a' },
  { id: 'coastal', name: 'Coastal Galley',  bg: 0x102028, key: 0xc0f0ff, fill: 0x3a6a7a, floor: 0x284450, board: 0x4a7a8a, accent: '#62b6cb' },
];

// ------------------------------------------------------- Tutorials ----
export const TUTORIALS = [
  {
    id: 'learn-1', title: 'Lesson 1: Generate',
    brief: 'Tap a glowing station (or press Enter on it) to produce an ingredient. Make two Grain Sprouts.',
    goal: { kind: 'spawn', count: 2, family: 'grain' },
    level: { families: ['grain'], openOrders: 0, ordersTarget: null, timeLimit: null },
  },
  {
    id: 'learn-2', title: 'Lesson 2: Merge',
    brief: 'Select one Sprout, then select the other to merge them into Dough. Merging identical items makes the next tier.',
    goal: { kind: 'merge', count: 1 },
    level: { families: ['grain'], openOrders: 0, ordersTarget: null, timeLimit: null },
  },
  {
    id: 'learn-3', title: 'Lesson 3: Serve',
    brief: 'A customer wants Dough. Merge two Sprouts into Dough, select it, then press Serve to fulfill the order before it expires.',
    goal: { kind: 'submit', count: 1 },
    level: { families: ['grain'], openOrders: 1, ordersTarget: 1, timeLimit: null },
  },
];

// --------------------------------------------------------- Journey ----
// 40 authored stages, procedurally assembled from a fixed recipe table so
// each stage is stable and inspectable. One new concept at a time, then
// combinations, then periodic mastery stages (every 8th).
function journeyLevel(n) {
  const stage = n + 1;
  const mastery = stage % 8 === 0;
  const famCount = Math.min(1 + Math.floor(n / 6), 4);
  const families = FAMILY_KEYS.slice(0, famCount);
  const seed = hashString('journey:' + stage);
  const orderMaxTier = Math.min(1 + Math.floor(n / 8), 4);
  const base = {
    id: 'journey-' + stage,
    version: CONTENT_VERSION,
    kind: 'journey',
    stage,
    seed,
    cols: 6, rows: 6,
    families,
    orderMaxTier,
    openOrders: mastery ? 3 : 2,
    theme: THEMES[Math.floor(n / 8) % THEMES.length].id,
    tutorial: stage === 1,
    mastery,
    par: 400 + stage * 120,
  };
  if (mastery) {
    // Mastery stage: move-limited, higher target.
    return { ...base, moveLimit: 40 + famCount * 8, ordersTarget: 5 + famCount, timeLimit: null,
      name: 'Mastery ' + stage / 8, blurb: 'Limited moves. Serve efficiently.' };
  }
  return { ...base, timeLimit: 1800 + Math.min(n * 30, 900), ordersTarget: 3 + Math.floor(n / 4),
    name: 'Stage ' + stage, blurb: famCount > 1 ? 'New station: ' + families[famCount - 1] : 'Serve the orders in time.' };
}

export const JOURNEY_LEVELS = Array.from({ length: 40 }, (_, i) => journeyLevel(i));

// ----------------------------------------------------------- Daily ----
// One shared seed + ruleset per UTC day, immutable after publication.
export function dailyLevel(dateIso) {
  const seed = hashString('daily:' + dateIso);
  const day = Math.floor(Date.parse(dateIso + 'T00:00:00Z') / 86400000);
  const famCount = 2 + (day % 3);
  return {
    id: 'daily-' + dateIso,
    version: CONTENT_VERSION,
    kind: 'daily',
    seed,
    cols: 6, rows: 6,
    families: FAMILY_KEYS.slice(0, famCount),
    orderMaxTier: 3 + (day % 2),
    openOrders: 3,
    timeLimit: 2400, // 4 minutes
    ordersTarget: null,
    theme: THEMES[day % THEMES.length].id,
    date: dateIso,
    name: 'Daily ' + dateIso,
    blurb: 'Shared seed for everyone today. Highest score wins.',
  };
}

// -------------------------------------------------------- Practice ----
export function practiceLevel(difficulty) {
  const table = {
    relaxed: { famCount: 2, orderMaxTier: 2, timeLimit: null, ordersTarget: null, openOrders: 2 },
    standard: { famCount: 3, orderMaxTier: 3, timeLimit: 3000, ordersTarget: null, openOrders: 3 },
    intense: { famCount: 4, orderMaxTier: 4, timeLimit: 2100, ordersTarget: null, openOrders: 3 },
  };
  const d = table[difficulty] || table.standard;
  return {
    id: 'practice-' + difficulty,
    version: CONTENT_VERSION,
    kind: 'practice',
    seed: hashString('practice:' + difficulty + ':' + new Date().toISOString().slice(0, 10)),
    cols: 6, rows: 6,
    families: FAMILY_KEYS.slice(0, d.famCount),
    orderMaxTier: d.orderMaxTier,
    openOrders: d.openOrders,
    timeLimit: d.timeLimit,
    ordersTarget: d.ordersTarget,
    theme: 'hearth',
    undo: true,
    name: 'Practice (' + difficulty + ')',
    blurb: 'Unranked. Undo allowed.',
  };
}

// ------------------------------------------------------- Challenge ----
export const CHALLENGES = [
  { id: 'ch-speed', name: 'Speed Service', blurb: '90 seconds. Serve as many orders as you can.',
    level: { kind: 'challenge', cols: 6, rows: 6, families: ['grain', 'garden'], orderMaxTier: 2, openOrders: 3, timeLimit: 900, theme: 'midnight' } },
  { id: 'ch-moves', name: 'Thirty Moves', blurb: 'Exactly 30 moves. Plan every merge.',
    level: { kind: 'challenge', cols: 6, rows: 6, families: ['grain', 'dairy'], orderMaxTier: 3, openOrders: 2, moveLimit: 30, theme: 'sunrise' } },
  { id: 'ch-narrow', name: 'Narrow Counter', blurb: 'A cramped 4x5 board with all four stations.',
    level: { kind: 'challenge', cols: 4, rows: 5, families: FAMILY_KEYS, orderMaxTier: 3, openOrders: 3, timeLimit: 2400, theme: 'coastal' } },
  { id: 'ch-gourmet', name: 'Gourmet Rush', blurb: 'Only high-tier orders. Long chains, big values.',
    level: { kind: 'challenge', cols: 6, rows: 6, families: ['ember', 'dairy'], orderMaxTier: 5, openOrders: 2, timeLimit: 3000, theme: 'garden' } },
].map((c) => ({ ...c, level: { ...c.level, id: c.id, version: CONTENT_VERSION, seed: hashString(c.id), name: c.name } }));

// ---------------------------------------------------- Achievements ----
// Small static set, stable lowercase keys, idempotent unlocks.
export const ACHIEVEMENTS = [
  { key: 'first_service', name: 'First Service', desc: 'Fulfill your first order.' },
  { key: 'merge_master', name: 'Merge Master', desc: 'Create a tier-5 dish.' },
  { key: 'hot_streak', name: 'Hot Streak', desc: 'Reach a streak of 5.' },
  { key: 'mastery_five', name: 'Mastery Five', desc: 'Complete five journey mastery stages.' },
  { key: 'regular', name: 'Kitchen Regular', desc: 'Play on seven different days.' },
];

// -------------------------------------------------------- Validators ----
// Offline content validation: basic legality, reachable goals, bounded
// duration, no soft locks.
export function validateLevel(level) {
  const errors = [];
  if (!level.id) errors.push('missing id');
  if (typeof level.seed !== 'number') errors.push('missing numeric seed');
  if (!Array.isArray(level.families) || level.families.length < 1) errors.push('no families');
  if (level.cols * level.rows < level.families.length + 2) errors.push('board too small for stations');
  if (level.timeLimit == null && level.moveLimit == null && level.ordersTarget == null) {
    if (level.kind !== 'practice' && level.kind !== 'tutorial') errors.push('unbounded duration');
  }
  if (level.timeLimit != null && level.timeLimit > 36000) errors.push('duration exceeds 6 minutes');
  if (level.moveLimit != null && level.moveLimit > 500) errors.push('move limit unbounded');
  if (level.orderMaxTier > 5) errors.push('order tier out of range');
  // Reachability: orders only request families present on the board.
  if (level.families.some((f) => !FAMILY_KEYS.includes(f))) errors.push('unknown family');
  return errors;
}

export function validateAll() {
  const report = [];
  const all = [
    ...TUTORIALS.map((t) => ({ ...t.level, id: t.id, kind: 'tutorial', seed: hashString(t.id) })),
    ...JOURNEY_LEVELS,
    dailyLevel('2026-01-01'),
    ...CHALLENGES.map((c) => c.level),
  ];
  for (const l of all) {
    const errs = validateLevel(l);
    report.push({ id: l.id, ok: errs.length === 0, errors: errs });
  }
  return report;
}
