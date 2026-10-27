// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.txt) per game event, the quiet filtered-
// noise ambience bed looping under a round, and the seeded arpeggio music
// (a sine note every 620 ms over a five-note scale, 40 % of the time with an
// added fifth).
//
// The browser build's four buses become the runtime's (Options › Audio owns
// the volumes, the mute and the voice limit): music → "music", effects and
// ambience → "effects"; the old default bus levels (music 0.6, effects 0.8,
// ambience 0.4) are folded into each sound's gain. The voice bus had nothing
// routed to it and is not ported. The bed and the notes are rendered once into
// clips (createClip) with the old filter and envelope; the synthesized
// stand-ins the browser build played while a clip decoded are not ported (a
// live synthesis graph makes clip loads fail on the engine's web runtime), so
// a clip still loading is silent. Clips load once the mixer runs (natively at
// once, in a browser after the first press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
import { hashString, makeRng } from "../js/rules.js";

const LEVEL = { music: 0.6, effects: 0.8, ambience: 0.4 };
export type Cue = "ack" | "select" | "spawn" | "merge" | "invalid" | "submit" | "streak" | "expire" | "trash" | "win" | "lose" | "tick" | "arrive" | "warn";
const SAMPLES: Record<Cue, string> = {
  ack: "ui-confirm", select: "item-select", spawn: "ingredient-spawn", merge: "merge-pop", invalid: "action-denied",
  submit: "order-serve", streak: "streak-bonus", expire: "order-expire", trash: "discard-item", win: "round-win",
  lose: "round-lose", tick: "timer-tick", arrive: "order-arrive", warn: "time-warning",
};

const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let suspended = false;

function load(name: string): void { if (!queue.includes(name) && !clips.has(name)) queue.push(name); }
function pump(): void {
  if (loading || !queue.length) return;
  const name = queue.shift()!;
  loading = true;
  loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); loading = false; });
}
/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }

/** Plays a cue's sample (once loaded). */
export function cue(name: Cue): void {
  const file = SAMPLES[name];
  const clip = clips.get(file);
  if (!clip || suspended) return;
  try { playClip(clip, { bus: "effects", gain: LEVEL.effects }); }
  catch { clips.delete(file); load(file); } // a clip the mixer lost: load it again
}

// -- the ambience bed and the music -----------------------------------------------------------
const RATE = 22050;
/** js/audio.js startAmbience: two seconds of seeded noise through a 320 Hz low-pass at 0.25, looped. */
function ambienceClip(): AudioClip {
  const n = RATE * 2;
  const out = new Float32Array(n);
  const rng = makeRng(hashString("ambience"));
  // RBJ biquad low-pass, Q 1 (the Web Audio BiquadFilterNode default).
  const w = (2 * Math.PI * 320) / RATE, alpha = Math.sin(w) / 2, cw = Math.cos(w);
  const a0 = 1 + alpha, b0 = (1 - cw) / 2 / a0, b1 = (1 - cw) / a0, b2 = b0, a1 = (-2 * cw) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let pass = 0; pass < 2; pass++) { // a first pass settles the filter so the loop has no click
    for (let i = 0; i < n; i++) {
      const x = rng() * 2 - 1;
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      if (pass) out[i] = y * 0.25;
    }
  }
  const fade = 400;
  for (let i = 0; i < fade; i++) out[i] = out[i]! * (i / fade) + out[n - fade + i]! * (1 - i / fade);
  return createClip([out.subarray(0, n - fade)], RATE);
}
/** js/audio.js blip: a sine, 8 ms attack, exponential decay to 0.001 over `dur`. */
function noteClip(freq: number, dur: number): AudioClip {
  const attack = 0.008;
  const n = Math.round((dur + 0.02) * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const env = t < attack ? t / attack : Math.pow(0.001, Math.min(1, (t - attack) / Math.max(0.01, dur - attack)));
    out[i] = Math.sin(2 * Math.PI * freq * t) * env;
  }
  return createClip([out], RATE);
}
const SCALE = [261.6, 311.1, 392, 466.2, 523.3];
const notes = new Map<number, AudioClip>(); // 0..4 the scale (0.4 s), 5..9 its fifths (0.3 s)
let musicRng = makeRng(hashString("music:1"));
let bed: AudioClip | null = null;
let bedSound: Sound | null = null;
let roundOn = false;
let nextStep = 0;
let nextRender = 0;

/** A round's ambience and music, the music seeded from the level seed (js/audio.js startMusic). */
export function startRound(seed: number): void { roundOn = true; musicRng = makeRng(hashString("music:" + seed)); }
export function stopRound(): void {
  roundOn = false;
  if (bedSound) { try { bedSound.stop(); } catch { /* gone */ } }
  bedSound = null;
}
/** A hidden window: everything holds (the music skipped while the tab was hidden). */
export function setSuspended(on: boolean): void { suspended = on; }

/** Each frame: the clips once the mixer runs (one at a time), the bed and the notes rendered
 * one each 0.3 s after them, the bed, then the music's steps by mixer time. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const name of Object.values(SAMPLES)) load(name);
    return;
  }
  pump();
  if (loading || queue.length) return;
  try {
    if (context.currentTime >= nextRender) {
      if (!bed) { bed = ambienceClip(); nextRender = context.currentTime + 0.3; return; }
      for (let i = 0; i < SCALE.length * 2; i++) {
        if (!notes.has(i)) {
          notes.set(i, i < SCALE.length ? noteClip(SCALE[i]!, 0.4) : noteClip(SCALE[i - SCALE.length]! * 1.5, 0.3));
          nextRender = context.currentTime + 0.3;
          return;
        }
      }
    }
    const want = roundOn && !suspended;
    if (want && bed && !bedSound) bedSound = playClip(bed, { bus: "effects", gain: LEVEL.ambience, loop: true });
    else if (!want && bedSound) { try { bedSound.stop(); } catch { /* gone */ } bedSound = null; }
  } catch (e) { console.warn(`audio: ${String(e)}`); return; }
  if (!roundOn || suspended) return;
  const now = context.currentTime;
  if (now < nextStep) return;
  nextStep = Math.max(now, nextStep) + 0.62;
  const k = Math.floor(musicRng() * SCALE.length);
  const fifth = musicRng() > 0.6;
  try {
    const note = notes.get(k);
    if (note) playClip(note, { bus: "music", gain: 0.07 * LEVEL.music });
    const f = fifth ? notes.get(k + SCALE.length) : null;
    if (f) playClip(f, { bus: "music", gain: 0.04 * LEVEL.music });
  } catch { /* the mixer is full */ }
}
