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
// clips (OfflineAudioContext, one context a clip) with the old filter and
// envelope; the synthesized stand-ins the browser build played while a clip
// decoded are not ported, so a clip still loading is silent. Every clip starts
// loading at start-up (the mixer takes them before it runs); the bed and the
// music still wait for it.
import { context, createClip, loadClip, OfflineAudioContext, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
import { hashString, makeRng } from "../js/rules.js";

const LEVEL = { music: 0.6, effects: 0.8, ambience: 0.4 };
export type Cue = "ack" | "select" | "spawn" | "merge" | "invalid" | "submit" | "streak" | "expire" | "trash" | "win" | "lose" | "tick" | "arrive" | "warn";
const SAMPLES: Record<Cue, string> = {
  ack: "ui-confirm", select: "item-select", spawn: "ingredient-spawn", merge: "merge-pop", invalid: "action-denied",
  submit: "order-serve", streak: "streak-bonus", expire: "order-expire", trash: "discard-item", win: "round-win",
  lose: "round-lose", tick: "timer-tick", arrive: "order-arrive", warn: "time-warning",
};

const clips = new Map<string, AudioClip>();
let suspended = false;

/** Loads every clip at once (onStart); a cue whose clip is still loading is skipped. */
export function loadSfx(): void {
  for (const name of new Set(Object.values(SAMPLES))) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`));
  }
  renderMusic();
}

/** Plays a cue's sample (once loaded). */
export function cue(name: Cue): void {
  const file = SAMPLES[name];
  const clip = clips.get(file);
  if (!clip || suspended) return;
  try { playClip(clip, { bus: "effects", gain: LEVEL.effects }); }
  catch { /* the mixer is full this frame: skip it */ }
}

// -- the ambience bed and the music -----------------------------------------------------------
const RATE = 22050;
/** js/audio.js startAmbience: two seconds of seeded noise through a 320 Hz low-pass at 0.25, looped.
 * Q 0 dB: the old RBJ filter's linear Q 1. Filtered periodic noise is periodic once settled: no crossfade. */
async function ambienceClip(): Promise<AudioClip> {
  const n = RATE * 2, settle = Math.round(0.25 * RATE);
  const off = new OfflineAudioContext(1, settle + n, RATE);
  const noise = off.createNoise({ seed: hashString("ambience"), seconds: 2 });
  const lp = off.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 320; lp.Q.value = 0;
  const g = off.createGain();
  g.gain.value = 0.25;
  noise.connect(lp).connect(g).connect(off.destination);
  noise.start();
  const r = await off.startRendering();
  return createClip([r.getChannelData(0).slice(settle)], RATE);
}
/** js/audio.js blip: a sine, 8 ms attack, exponential decay to 0.001 over `dur`. */
async function noteClip(freq: number, dur: number): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round((dur + 0.02) * RATE), RATE);
  const osc = off.createOscillator();
  osc.frequency.value = freq;
  const env = off.createGain();
  env.gain.setValueAtTime(0, 0);
  env.gain.linearRampToValueAtTime(1, 0.008);
  env.gain.exponentialRampToValueAtTime(0.001, dur);
  osc.connect(env).connect(off.destination);
  osc.start();
  return createClip(await off.startRendering());
}
const SCALE = [261.6, 311.1, 392, 466.2, 523.3];
const notes = new Map<number, AudioClip>(); // 0..4 the scale (0.4 s), 5..9 its fifths (0.3 s)
let musicRng = makeRng(hashString("music:1"));
let bed: AudioClip | null = null;
let bedSound: Sound | null = null;
let roundOn = false;
let nextStep = 0;

/** The bed and the notes (0..4 the scale, 5..9 its fifths), from onStart. */
function renderMusic(): void {
  const warn = (e: unknown): void => console.warn(`audio: ${String(e)}`);
  ambienceClip().then((c) => { bed = c; }, warn);
  for (let i = 0; i < SCALE.length * 2; i++) {
    (i < SCALE.length ? noteClip(SCALE[i]!, 0.4) : noteClip(SCALE[i - SCALE.length]! * 1.5, 0.3)).then((c) => { notes.set(i, c); }, warn);
  }
}

/** A round's ambience and music, the music seeded from the level seed (js/audio.js startMusic). */
export function startRound(seed: number): void { roundOn = true; musicRng = makeRng(hashString("music:" + seed)); }
export function stopRound(): void {
  roundOn = false;
  if (bedSound) { try { bedSound.stop(); } catch { /* gone */ } }
  bedSound = null;
}
/** A hidden window: everything holds (the music skipped while the tab was hidden). */
export function setSuspended(on: boolean): void { suspended = on; }

/** Each frame once the mixer runs: the bed, then the music's steps by mixer time. */
export function update(): void {
  if (context.state !== "running") return;
  try {
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
