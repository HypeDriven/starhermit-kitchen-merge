// Kitchen Merge — graphics quality model: presets, per-category overrides,
// hardware-level detection, per-preset budgets and a cost summary. Pure (no three.js, no DOM) so the
// settings panel, the renderer and the unit tests agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],
  detail: ['plain', 'detailed'],
  particles: ['low', 'high'],
  ambient: ['static', 'animated'],
};

// Each preset is a row of tiers, a render scale (multiplies the device pixel
// ratio) and a device-pixel-ratio cap.
const TABLE = {
  low: { scale: 1, dprCap: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', detail: 'plain', particles: 'low', ambient: 'static' },
  balanced: { scale: 1, dprCap: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', detail: 'detailed', particles: 'high', ambient: 'animated' },
  high: { scale: 1, dprCap: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', detail: 'detailed', particles: 'high', ambient: 'animated' },
  ultra: { scale: 1.25, dprCap: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', detail: 'detailed', particles: 'high', ambient: 'animated' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };
export const PARTICLE_POOL = { low: 60, high: 300 };

// StarHermit hardware level (0–20, js/gpu-level.js → window.StarHermitGpu) at which Auto starts choosing
// each preset. 0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX 5090; phones, tablets and ≤ 4 GB machines
// are capped at level 9 (Balanced); software renderers are level 0 (Low).
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

/*
 * Per-preset asset and effect budgets, each tuned to hold 60 FPS on the weakest GPU Auto gives the preset
 * (Low: level 0 phones / Intel UHD; Balanced: level 4 Iris Xe; High: level 10 GTX 1070; Ultra: level 17
 * RTX 4080; measured with tests/gfx-bench.mjs). Gameplay is identical on every preset.
 *   material  ingredients, stations, tiles and counter: 'lambert' (Low) | 'standard' (Balanced) |
 *             'physical' (glazed clearcoat/sheen props and clearcoated tiles with Scene detail on; High/Ultra)
 *   wood      butcher-block wood texture size in px (Scene detail on); tile: glazed tile texture size
 *   segments  geometry LOD: multiplies the radial/segment counts of ingredients, stations, rings and props
 *   motes     ambient dust motes drifting through the lamp light (Ambient motion on)
 *   sparks    multiplies merge/serve burst particle counts and the pool size, then scaled by the
 *             hardware level within the preset (≤ 2×)
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 */
export const BUDGETS = {
  low: { material: 'lambert', wood: 256, tile: 64, segments: 0.5, motes: 16, sparks: 0.5, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', wood: 512, tile: 128, segments: 0.75, motes: 28, sparks: 0.75, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: 'physical', wood: 512, tile: 128, segments: 1, motes: 40, sparks: 1, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: 'physical', wood: 1024, tile: 256, segments: 1.5, motes: 80, sparks: 1.5, bloomRes: 1, aoRes: 1 },
};

const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system = {}) {
  const G = gpuApi();
  if (!G) return LEVELS.balanced;
  return G.detectLevel({ webgl: true, webgl2: true, ...system, gpu: String(gpu || '') });
}

/** Auto preset for a hardware level: Low 0, Balanced 4, High 10, Ultra 17. */
export function presetForLevel(level) {
  const G = gpuApi();
  if (G) return G.presetForLevel(level, LEVELS);
  return PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU; phones and tablets are capped at Balanced by the hardware level. */
export function detectPreset(gpu, system = {}) {
  return presetForLevel(detectLevel(gpu, system));
}

/** A preset's concrete budget for a hardware level (sparks and motes scale within the preset, ≤ 2×). */
export function budget(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] ?? 0;
  const k = G ? Math.min(2, G.scaleBudget(1, Number.isFinite(level) ? level : floor, floor)) : 1;
  b.sparks = Math.round(b.sparks * k * 100) / 100;
  b.motes = Math.round(b.motes * k);
  return b;
}

/** Particle pool size for a Particles tier under a budget. */
export function particlePool(tier, b) {
  return Math.max(8, Math.round((PARTICLE_POOL[tier] || PARTICLE_POOL.low) * (b ? b.sparks : 1)));
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const auto = !PRESETS.includes(s.preset);
  const preset = auto ? (PRESETS.includes(detected) ? detected : 'balanced') : s.preset;
  const row = TABLE[preset];
  const renderScale = clamp(Number(s.render_scale) || 1, 0.5, 2);
  const out = { preset, auto, renderScale, scale: row.scale * renderScale, dprCap: row.dprCap };
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budget(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // The composer only runs when something needs it; otherwise the canvas MSAA path is used.
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias === 'fxaa' || out.antialias === 'smaa';
  return out;
}

/** Choosing a preset clears every per-category override (scale and toggles stay). */
export function applyPreset(saved, preset) {
  const s = { ...(saved || {}) };
  for (const cat of Object.keys(CATEGORIES)) delete s[cat];
  s.preset = PRESETS.includes(preset) ? preset : 'auto';
  return s;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset]?.[cat];
}

const DESCRIBE_EN = {
  noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoFull: 'full ambient occlusion',
  bloom: 'bloom', reflections: 'reflections', noAA: 'no anti-aliasing',
};

/** Cost summary; `words` optionally localizes the phrases (same keys as DESCRIBE_EN). */
export function describe(r, pixels, words) {
  const w = { ...DESCRIBE_EN, ...(words || {}) };
  const parts = [
    r.shadows === 'off' ? w.noShadows : `${SHADOW_MAP[r.shadows]}² ${w.shadows}`,
    r.ao === 'off' ? null : r.ao === 'high' ? w.aoFull : w.ao,
    r.bloom === 'on' ? w.bloom : null,
    r.reflections === 'on' ? w.reflections : null,
    r.antialias === 'off' ? w.noAA : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
