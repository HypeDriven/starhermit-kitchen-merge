// The look per graphics level. The engine-owned effects (shadows and their
// map size, ambient occlusion, bloom, the grade, anti-aliasing) are the
// level's own (levelSettings(): the same table every StarHermit game reads).
// The game's art (materials, wood and tile textures, geometry LOD,
// reflections, particles, motes, detail, ambient motion) is the browser
// build's four presets and budgets (js/gfx.js TABLE / BUDGETS) keyed by the
// level's quality tier, with the burst sparks and the dust motes scaled within
// the tier by the level's particle budget against the tier's anchor level
// (quantum, molecular, terrestrial, galactic), at most twice the tier's. The
// runtime owns the rest of what the old Graphics panel did: Auto and the level
// choice, render scale and the pixel-ratio cap, adaptive resolution, the
// frame-rate limit and readout. The per-category overrides of the old panel
// are not offered (the runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** Lit materials: Lambert, standard PBR, or clear-coated physical props. */
  material: "lambert" | "standard" | "physical";
  /** Butcher-block wood and glazed tile texture sizes (px), within the level's largest texture. */
  wood: number;
  tile: number;
  /** Geometry LOD: multiplies the segment counts of ingredients, stations, rings and props. */
  segments: number;
  /** Dust motes in the lamplight; spark burst factor. */
  motes: number;
  sparks: number;
}
export interface Look {
  preset: Preset;
  /** The level's key-light shadow map size, 0 when the level draws no shadows. */
  shadows: number;
  /** The level's ambient occlusion (null: off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null: off). */
  bloom: number | null;
  grade: boolean;
  antialias: AntialiasMode;
  reflections: boolean;
  /** Particle pool: 60 (low) or 300 (high) × the budget's sparks. */
  particlesHigh: boolean;
  /** Tiled ceramic board, wood textures and the surround props. */
  detailed: boolean;
  /** Ambient motion (items breathe, station tops bob, the lamp flickers, motes drift). */
  animated: boolean;
  budget: Budget;
}

type Art = Pick<Look, "reflections" | "particlesHigh" | "detailed" | "animated">;
const ART: Record<Preset, Art> = {
  low: { reflections: false, particlesHigh: false, detailed: false, animated: false },
  balanced: { reflections: true, particlesHigh: true, detailed: true, animated: true },
  high: { reflections: true, particlesHigh: true, detailed: true, animated: true },
  ultra: { reflections: true, particlesHigh: true, detailed: true, animated: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", wood: 256, tile: 64, segments: 0.5, motes: 16, sparks: 0.5 },
  balanced: { material: "standard", wood: 512, tile: 128, segments: 0.75, motes: 28, sparks: 0.75 },
  high: { material: "physical", wood: 512, tile: 128, segments: 1, motes: 40, sparks: 1 },
  ultra: { material: "physical", wood: 1024, tile: 256, segments: 1.5, motes: 80, sparks: 1.5 },
};
/** The level whose settings are each tier's preset. */
const ANCHOR: Record<Preset, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level (the frame's by default). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = { ...BUDGETS[preset] };
  // Sparks and motes grow with the level's particle budget above the tier's anchor, at most 2×.
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  b.sparks = Math.round(b.sparks * k * 100) / 100;
  b.motes = Math.round(b.motes * k);
  b.wood = Math.min(b.wood, s.maxTextureSize);
  b.tile = Math.min(b.tile, s.maxTextureSize);
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: b,
  };
}
/** Particle pool size (js/gfx.js particlePool). */
export function particlePool(look: Look): number {
  return Math.max(8, Math.round((look.particlesHigh ? 300 : 60) * look.budget.sparks));
}
