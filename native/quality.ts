// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU its
// Auto gave it) keyed by the runtime's quality tier (frame().quality), with
// the burst sparks and the dust motes scaled within the tier by the level
// (frame().levelIndex), as the browser build scaled them by its hardware level
// (at most 2×). The runtime owns the rest of what the old Graphics panel did:
// Auto and the level choice, render scale and the pixel-ratio cap, adaptive
// resolution, the frame-rate limit and readout, and the shadow-map size and
// MSAA samples it holds to the level. The per-category overrides of the old
// panel are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** Lit materials: Lambert, standard PBR, or clear-coated physical props. */
  material: "lambert" | "standard" | "physical";
  /** Butcher-block wood and glazed tile texture sizes (px). */
  wood: number;
  tile: number;
  /** Geometry LOD: multiplies the segment counts of ingredients, stations, rings and props. */
  segments: number;
  /** Dust motes in the lamplight; spark burst factor. */
  motes: number;
  sparks: number;
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: Preset;
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
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

const TABLE: Record<Preset, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, particlesHigh: false, detailed: false, animated: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, particlesHigh: true, detailed: true, animated: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particlesHigh: true, detailed: true, animated: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particlesHigh: true, detailed: true, animated: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", wood: 256, tile: 64, segments: 0.5, motes: 16, sparks: 0.5, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", wood: 512, tile: 128, segments: 0.75, motes: 28, sparks: 0.75, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", wood: 512, tile: 128, segments: 1, motes: 40, sparks: 1, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", wood: 1024, tile: 256, segments: 1.5, motes: 80, sparks: 1.5, bloomRes: 1, aoRes: 1 },
};
/** The first level index of each tier (quantum, molecular, terrestrial, galactic). */
const TIER_FLOOR: Record<Preset, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 quantum … 9 infinite). */
export function lookFor(preset: Preset, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart: sparks and motes grow above the tier's first level, at most 2×.
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.sparks = Math.round(b.sparks * k * 100) / 100;
  b.motes = Math.round(b.motes * k);
  return { preset, ...TABLE[preset], budget: b };
}
/** Particle pool size (js/gfx.js particlePool). */
export function particlePool(look: Look): number {
  return Math.max(8, Math.round((look.particlesHigh ? 300 : 60) * look.budget.sparks));
}
