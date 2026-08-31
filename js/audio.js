// Kitchen Merge — procedural WebAudio. Original short transients tied to
// logical events, layered impacts, quiet ambience, adaptive music stem.
// Buses: music, effects, ambience, voice — independent volumes.
import { makeRng, hashString } from './rules.js';

// Authored one-shot samples (sfx/<name>.opus, see sfx/manifest.json) mapped to
// the logical events below. Samples are lazily fetched/decoded once the
// AudioContext exists (i.e. after the user-gesture unlock); the synthesized
// fallbacks in play() run while a clip is loading or unavailable.
const SFX_SAMPLES = {
  ack: 'ui-confirm',
  select: 'item-select',
  spawn: 'ingredient-spawn',
  merge: 'merge-pop',
  invalid: 'action-denied',
  submit: 'order-serve',
  streak: 'streak-bonus',
  expire: 'order-expire',
  trash: 'discard-item',
  win: 'round-win',
  lose: 'round-lose',
  tick: 'timer-tick',
};

export class AudioEngine {
  constructor(settings) {
    this.settings = settings; // {music, effects, ambience, voice} 0..1
    this.ctx = null;
    this.buses = {};
    this.musicTimer = null;
    this.ambNodes = null;
    this.enabled = true;
    // name -> AudioBuffer (ready) | Promise (loading) | null (failed).
    this.sampleCache = new Map();
  }

  ensure() {
    if (this.ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      const master = this.ctx.createGain();
      master.connect(this.ctx.destination);
      this.master = master;
      for (const bus of ['music', 'effects', 'ambience', 'voice']) {
        const g = this.ctx.createGain();
        g.gain.value = this.settings[bus] != null ? this.settings[bus] : 0.8;
        g.connect(master);
        this.buses[bus] = g;
      }
      return true;
    } catch { return false; }
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setVolume(bus, v) {
    this.settings[bus] = v;
    if (this.buses[bus]) this.buses[bus].gain.value = v;
  }

  // Short synthesized transient. variant seed keeps replays consistent.
  blip({ freq = 440, dur = 0.12, type = 'sine', bus = 'effects', gain = 0.3, slide = 0, seed = 1 }) {
    if (!this.enabled || !this.ensure()) return;
    this.resume();
    const rng = makeRng(hashString('av:' + seed));
    const f = freq * (1 + (rng() - 0.5) * 0.06);
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, f + slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.buses[bus]);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  noise({ dur = 0.15, bus = 'effects', gain = 0.2, freq = 1200, seed = 2 }) {
    if (!this.enabled || !this.ensure()) return;
    this.resume();
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    const rng = makeRng(hashString('noise:' + seed));
    for (let i = 0; i < len; i++) data[i] = (rng() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(filt); filt.connect(g); g.connect(this.buses[bus]);
    src.start(t);
  }

  // Lazy-fetch/decode/cache an authored clip. Only runs after the context
  // exists (post user-gesture unlock); failures are cached as null.
  loadSample(name) {
    if (!this.ctx) return null;
    let entry = this.sampleCache.get(name);
    if (entry !== undefined) return entry;
    entry = fetch('sfx/' + name + '.opus')
      .then((r) => {
        if (!r.ok) throw new Error('sfx http ' + r.status);
        return r.arrayBuffer();
      })
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((buf) => { this.sampleCache.set(name, buf); return buf; })
      .catch(() => { this.sampleCache.set(name, null); return null; });
    this.sampleCache.set(name, entry);
    return entry;
  }

  // Play a decoded clip once through the effects bus (honours its volume).
  // Returns false when the clip is not ready yet, so callers fall back.
  playSample(name) {
    if (!this.enabled || !this.ctx) return false;
    const entry = this.loadSample(name);
    if (!entry || typeof entry.then === 'function') return false;
    this.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = entry;
    src.connect(this.buses.effects);
    src.start();
    return true;
  }

  // Event → sound mapping (event hierarchy: ack < move < goal < round end).
  play(event, seed = 1) {
    const sample = SFX_SAMPLES[event];
    if (sample && this.playSample(sample)) return;
    switch (event) {
      case 'ack': this.blip({ freq: 660, dur: 0.05, gain: 0.12, seed }); break;
      case 'select': this.blip({ freq: 520, dur: 0.06, type: 'triangle', gain: 0.18, seed }); break;
      case 'spawn': this.blip({ freq: 340, dur: 0.1, type: 'triangle', gain: 0.25, slide: 160, seed }); break;
      case 'merge':
        this.blip({ freq: 420, dur: 0.14, type: 'triangle', gain: 0.28, slide: 320, seed });
        this.noise({ dur: 0.08, gain: 0.1, freq: 2000, seed });
        break;
      case 'invalid': this.blip({ freq: 180, dur: 0.18, type: 'square', gain: 0.15, slide: -60, seed }); break;
      case 'submit':
        this.blip({ freq: 620, dur: 0.12, gain: 0.3, slide: 260, seed });
        setTimeout(() => this.blip({ freq: 880, dur: 0.16, gain: 0.28, seed: seed + 1 }), 90);
        break;
      case 'streak':
        this.blip({ freq: 740, dur: 0.1, gain: 0.26, seed });
        setTimeout(() => this.blip({ freq: 990, dur: 0.1, gain: 0.26, seed: seed + 1 }), 80);
        setTimeout(() => this.blip({ freq: 1240, dur: 0.18, gain: 0.26, seed: seed + 2 }), 160);
        break;
      case 'expire': this.blip({ freq: 300, dur: 0.25, type: 'sawtooth', gain: 0.12, slide: -120, seed }); break;
      case 'trash': this.noise({ dur: 0.12, gain: 0.16, freq: 700, seed }); break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) =>
          setTimeout(() => this.blip({ freq: f, dur: 0.22, gain: 0.3, seed: seed + i }), i * 130));
        break;
      case 'lose':
        [392, 330, 262].forEach((f, i) =>
          setTimeout(() => this.blip({ freq: f, dur: 0.3, type: 'triangle', gain: 0.22, seed: seed + i }), i * 160));
        break;
      case 'tick': this.blip({ freq: 980, dur: 0.03, gain: 0.06, seed }); break;
    }
  }

  // Adaptive music: gentle seeded arpeggio, denser during streaks.
  startMusic(seed) {
    if (!this.ensure()) return;
    this.stopMusic();
    const scale = [261.6, 311.1, 392, 466.2, 523.3];
    let step = 0;
    const rng = makeRng(hashString('music:' + seed));
    this.musicTimer = setInterval(() => {
      if (document.hidden) return;
      const f = scale[Math.floor(rng() * scale.length)];
      this.blip({ freq: f, dur: 0.4, type: 'sine', bus: 'music', gain: 0.07, seed: step++ });
      if (rng() > 0.6) this.blip({ freq: f * 1.5, dur: 0.3, bus: 'music', gain: 0.04, seed: step++ });
    }, 620);
  }

  stopMusic() { if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; } }

  // Quiet ambience: filtered noise bed, very low.
  startAmbience() {
    if (!this.ensure() || this.ambNodes) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    const rng = makeRng(hashString('ambience'));
    for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 320;
    const g = this.ctx.createGain(); g.gain.value = 0.25;
    src.connect(filt); filt.connect(g); g.connect(this.buses.ambience);
    src.start();
    this.ambNodes = { src, g };
  }

  stopAmbience() {
    if (this.ambNodes) { try { this.ambNodes.src.stop(); } catch {} this.ambNodes = null; }
  }
}
