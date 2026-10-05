// Kitchen Merge — Three.js renderer. Tabletop open-kitchen scene with a
// miniature board, stations, deterministic visual seed, pooled effects and
// graphics quality settings (see gfx.js). Rendering consumes snapshots; it
// never mutates rules state.
import * as THREE from '../lib/three.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { THEMES } from './content.js';
import { detectPreset, describe, resolve, SHADOW_MAP, PARTICLE_POOL } from './gfx.js';

const FAMILY_COLORS = {
  grain: 0xd9b36a,
  garden: 0x6fbf5a,
  dairy: 0xf2ead2,
  ember: 0xd96a4a,
};
// Accessible (color-vision safe) palette — color is always reinforced by
// geometry shape and DOM labels, so this is a secondary cue.
const FAMILY_COLORS_CB = {
  grain: 0xddcc77,
  garden: 0x117733,
  dairy: 0xf2f2f2,
  ember: 0xcc6677,
};

// Family silhouettes: each family has a distinct procedural shape so color
// is never the only differentiator.
function familyGeometry(family, tier) {
  switch (family) {
    case 'grain': {
      const g = new THREE.CapsuleGeometry(0.16 + tier * 0.03, 0.18 + tier * 0.05, 4, 10);
      g.rotateZ(Math.PI / 2);
      return g;
    }
    case 'garden': {
      return new THREE.IcosahedronGeometry(0.16 + tier * 0.045, 1);
    }
    case 'dairy': {
      return new THREE.CylinderGeometry(0.13 + tier * 0.03, 0.17 + tier * 0.03, 0.16 + tier * 0.06, 14);
    }
    case 'ember': {
      return new THREE.ConeGeometry(0.16 + tier * 0.04, 0.3 + tier * 0.08, 8);
    }
    default: return new THREE.BoxGeometry(0.3, 0.3, 0.3);
  }
}

// Colour grade + vignette (display-space colours in, display-space out).
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.2 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = src.rgb;
      vec3 lc = clamp(c, 0.0, 1.0);
      // Gentle S-curve contrast, a touch more saturation, warm highlights / cool shadows.
      vec3 s = mix(lc, lc * lc * (3.0 - 2.0 * lc), 0.18);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.97, 0.98, 1.04), vec3(1.05, 1.0, 0.94), smoothstep(0.2, 0.8, l));
      c = mix(c, s + max(c - 1.0, 0.0), uAmount);
      float d = length(vUv - 0.5);
      c *= 1.0 - uVignette * smoothstep(0.38, 0.85, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

// ---------------------------------------------------------- procedural textures
// Deterministic value noise so the look is identical on every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function canvasTexture(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  return tex;
}

// Butcher-block wood: long streaky grain with a few darker growth lines.
function woodTexture() {
  return canvasTexture(512, (g, n) => {
    const r = rng(7);
    g.fillStyle = '#d8c2a6'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 260; i++) {
      const y = r() * n, a = 0.04 + r() * 0.1, w = 1 + r() * 3;
      g.strokeStyle = r() < 0.5 ? `rgba(90,55,30,${a})` : `rgba(255,240,215,${a})`;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= n; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 * r());
      g.stroke();
    }
    // Plank seams.
    g.fillStyle = 'rgba(40,24,12,0.35)';
    for (let k = 1; k < 4; k++) g.fillRect(0, (k * n) / 4 - 1, n, 2);
  }, 2);
}

// Glazed ceramic tile: soft speckle and a slightly darker rim.
function tileTexture() {
  return canvasTexture(128, (g, n) => {
    const r = rng(11);
    g.fillStyle = '#ece4d8'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 700; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(120,90,60,0.08)' : 'rgba(255,255,255,0.10)';
      g.fillRect(r() * n, r() * n, 1 + r() * 2, 1 + r() * 2);
    }
    const grad = g.createRadialGradient(n / 2, n / 2, n * 0.25, n / 2, n / 2, n * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(60,35,20,0.22)');
    g.fillStyle = grad; g.fillRect(0, 0, n, n);
  });
}

function dotTexture() {
  const t = canvasTexture(64, (g, n) => {
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, n, n);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function detectMobile() {
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
    return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  } catch { return false; }
}

export class KitchenRenderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.reducedMotion = !!opts.reducedMotion;
    this.colorblind = !!opts.colorblind;
    this.ok = false;
    this.itemViews = new Map(); // cellIndex -> mesh
    this.particlePool = [];
    this.callbacks = { onCellPick: null };
    this._time = 0;
    this._disposed = false;
    this.adaptiveScale = 1;
    this._frames = [];
    this.fps = 0;
    this.size = [0, 0];
    this.pixelRatio = 1;
    this.postKey = null;
    this.composer = null;
    this.postFailed = false;
    try {
      this._init(opts.graphics || {});
      this.ok = true;
    } catch {
      // The DOM board is fully playable without WebGL; main.js shows #gl-fallback.
      this.ok = false;
    }
  }

  _init(graphics) {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    this.gpu = this._gpuName();
    this.mobile = detectMobile();
    this.detected = detectPreset(this.gpu, { mobile: this.mobile });

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1d1512);
    this._motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

    // Straight-down camera; _alignCamera fits the board to the DOM grid.
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.set(0, 10.8, 3.0);
    this.camera.lookAt(0, 0, 0.2);

    // Lights: one dominant warm key with fitted PCF shadows, a soft hemisphere
    // fill, and (with reflections on) a studio environment for PBR highlights.
    this.key = new THREE.DirectionalLight(0xffd9a0, 2.4);
    this.key.position.set(3.5, 9, 2.5);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 3;
    this.fill = new THREE.HemisphereLight(0x8a7ab0, 0x2a2018, 0.7);
    this.scene.add(this.key, this.key.target, this.fill);

    // Board interaction layer (raycast only against this).
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshBasicMaterial({ visible: false }));
    this.pickPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this.pickPlane);

    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);
    this.cellMeshes = [];
    this.genViews = new Map();

    // Selection marker + legal-target ghost ring. Colours above 1.0 so they
    // catch the bloom pass (bloom only picks up emissive highlights).
    this.selectionRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.05, 8, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe28a).multiplyScalar(1.6) }));
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    this.ghostRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.03, 8, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8affc0).multiplyScalar(1.4), transparent: true, opacity: 0.8 }));
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.ghostRing.visible = false;
    this.scene.add(this.ghostRing);

    this._pGeo = new THREE.SphereGeometry(0.05, 6, 6);

    // Ambient dust motes drifting through the lamp light.
    const motes = 40;
    const pos = new Float32Array(motes * 3);
    const r = rng(3);
    this._moteSeed = [];
    for (let i = 0; i < motes; i++) {
      this._moteSeed.push({ x: (r() - 0.5) * 7, y: 0.8 + r() * 1.6, z: (r() - 0.5) * 7, p: r() * Math.PI * 2, s: 0.2 + r() * 0.5 });
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(mg, new THREE.PointsMaterial({
      map: dotTexture(), color: 0xffd8a0, size: 0.09, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.motes.visible = false;
    this.scene.add(this.motes);

    this.envTexture = null;
    this.textures = null;
    this._bound = false;
    this.theme = THEMES[0];
    this.setGraphics(graphics);
    this.setTheme('hearth');
    this._resize();
  }

  _gpuName() {
    try {
      const gl = this.renderer.getContext();
      let name = gl.getParameter(gl.RENDERER);
      if (!name || /^webkit webgl$/i.test(name)) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) name = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      }
      return String(name || '');
    } catch { return ''; }
  }

  // ---------------------------------------------------------------- graphics settings

  /** Apply saved graphics settings (`{}` = Auto) live. */
  setGraphics(saved) {
    const json = JSON.stringify(saved || {});
    if (json === this._gfxJson) return;
    this._gfxJson = json;
    const prev = this.q;
    const g = resolve(saved || {}, this.detected);
    this.q = g;
    if (!this.renderer) return;

    // Shadows: the key light's map size; frustum is fitted in _fitShadow().
    const size = SHADOW_MAP[g.shadows];
    this.renderer.shadowMap.enabled = size > 0;
    this.key.castShadow = size > 0;
    if (size > 0 && this.key.shadow.mapSize.x !== size) {
      this.key.shadow.mapSize.set(size, size);
      if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
    }
    this._fitShadow();

    // Image-based lighting.
    if (g.reflections === 'on') {
      if (!this.envTexture) {
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        const room = new RoomEnvironment();
        this.envTexture = pmrem.fromScene(room, 0.04).texture;
        room.dispose();
        pmrem.dispose();
      }
      this.scene.environment = this.envTexture;
      this.scene.environmentIntensity = 0.5;
      this.fill.intensity = 0.45;
    } else {
      this.scene.environment = null;
      this.fill.intensity = 0.7;
    }

    // Particle pool size.
    if (!prev || prev.particles !== g.particles) this._buildParticles(PARTICLE_POOL[g.particles]);

    // Detail: surround props, procedural textures and physical materials.
    if (prev && prev.detail !== g.detail) this._rebuildForDetail();

    this._applyMotion();
    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null; // rebuild the post chain on the next frame
    this.postFailed = false;
    this._fpsVisible(g.showFps);
    // Materials pick up shadow/environment changes on recompile.
    this.scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
    });
    if (typeof document !== 'undefined') {
      document.body.dataset.gfxPreset = g.preset;
      document.body.classList.toggle('gfx-detailed', g.detail === 'detailed');
    }
  }

  /** What the settings panel shows: GPU, auto choice, resolved tiers, cost and frame rate. */
  graphicsInfo(words) {
    const px = [Math.round(this.size[0] * this.pixelRatio), Math.round(this.size[1] * this.pixelRatio)];
    return {
      gpu: this.gpu || 'unknown GPU',
      detected: this.detected,
      resolved: this.q,
      summary: describe(this.q, px[0] ? px : null, words),
      fps: Math.round(this.fps || 0),
      adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed,
    };
  }

  _motionOn() {
    const prefers = this._motionQuery ? this._motionQuery.matches : false;
    return !this.reducedMotion && !prefers;
  }

  _applyMotion() {
    const animated = this.q && this.q.ambient === 'animated' && this._motionOn();
    if (this.motes) this.motes.visible = !!animated;
    this._ambientOn = !!animated;
    if (typeof document !== 'undefined') document.body.classList.toggle('gfx-animated', !!animated);
  }

  _fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  _fitShadow() {
    const cols = this.cols || 6, rows = this.rows || 6;
    const half = (Math.max(cols, rows) * 1.05) / 2 + 0.9;
    const cam = this.key.shadow.camera;
    Object.assign(cam, { left: -half, right: half, top: half, bottom: -half, near: 2, far: 22 });
    cam.updateProjectionMatrix();
  }

  _buildParticles(n) {
    for (const p of this.particlePool) { this.scene.remove(p); p.material.dispose(); }
    this.particlePool = [];
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(this._pGeo, new THREE.MeshBasicMaterial({ color: 0xffe28a }));
      p.visible = false;
      p.userData = { vel: new THREE.Vector3(), life: 0 };
      this.scene.add(p);
      this.particlePool.push(p);
    }
  }

  _detailed() { return this.q && this.q.detail === 'detailed'; }

  _tex() {
    if (!this.textures) this.textures = { wood: woodTexture(), tile: tileTexture() };
    return this.textures;
  }

  _rebuildForDetail() {
    this._themeKey = null;
    this.setTheme(this.theme.id);
    if (this.cols) {
      const state = this._lastState;
      this.buildBoard(this.cols, this.rows);
      if (state) this.syncState(state);
    }
  }

  setTheme(themeId) {
    const t = THEMES.find((x) => x.id === themeId) || THEMES[0];
    const key = t.id + '|' + (this.q && this.q.detail);
    this.theme = t;
    if (key === this._themeKey) return; // settings changed elsewhere: nothing to rebuild
    this._themeKey = key;
    this.scene.background = new THREE.Color(t.bg);
    this.key.color.set(t.key);
    this.fill.color.set(t.fill);
    if (!this.floor) {
      this.floor = new THREE.Mesh(
        new THREE.CylinderGeometry(6.5, 7, 0.3, 48),
        new THREE.MeshStandardMaterial({ color: t.floor, roughness: 0.9 }));
      this.floor.position.y = -0.55;
      this.floor.receiveShadow = true;
      this.scene.add(this.floor);
    }
    this.floor.material.color.set(t.floor);
    this._buildSurround();
    for (const m of this.cellMeshes) m.material.color.set(t.board);
    if (this.boardBase) this.boardBase.material.color.set(t.board).multiplyScalar(0.45);
  }

  // Restrained environmental storytelling: miniature stations around the board.
  _buildSurround() {
    if (this.envGroup) { this.scene.remove(this.envGroup); this._disposeGroup(this.envGroup); }
    const detailed = this._detailed();
    this.envGroup = new THREE.Group();
    const wood = detailed
      ? new THREE.MeshStandardMaterial({ color: 0x967660, roughness: 0.72, map: this._tex().wood, bumpMap: this._tex().wood, bumpScale: 0.6 })
      : new THREE.MeshStandardMaterial({ color: 0x6a4c32, roughness: 0.85 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.3, metalness: 0.85 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(11, 0.4, 8.4), wood);
    counter.position.y = -0.35;
    counter.receiveShadow = true;
    this.envGroup.add(counter);
    if (detailed) {
      // Shelf, hanging pans, a window glow — small original props.
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(5, 0.15, 1), wood);
      shelf.position.set(-2.5, 2.2, -4.2);
      this.envGroup.add(shelf);
      for (let i = 0; i < 3; i++) {
        const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.12, 24), steel);
        pan.position.set(-4 + i * 1.2, 1.6, -4.2);
        pan.castShadow = true;
        this.envGroup.add(pan);
      }
      // Window glow: bright enough to bloom softly.
      const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.theme.key).multiplyScalar(1.3) });
      const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), winMat);
      win.position.set(3, 2.4, -4.4);
      this.envGroup.add(win);
      // Copper utensil rail and a salt cellar along the counter edges.
      const copper = new THREE.MeshStandardMaterial({ color: 0xc27a4a, roughness: 0.28, metalness: 0.9 });
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 7.5, 12), copper);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, 0.02, 4.0);
      this.envGroup.add(rail);
      const cellar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.28, 24), new THREE.MeshPhysicalMaterial({ color: 0x4f5f6c, roughness: 0.4, clearcoat: 0.6 }));
      cellar.position.set(-4.6, 0, 3.4);
      cellar.castShadow = true;
      this.envGroup.add(cellar);
    }
    this.scene.add(this.envGroup);
  }

  // Build board cells for a given grid size.
  buildBoard(cols, rows) {
    this.cols = cols; this.rows = rows;
    this._disposeGroup(this.boardGroup);
    this.scene.remove(this.boardGroup);
    this.boardGroup = new THREE.Group();
    this.cellMeshes = [];
    const detailed = this._detailed();
    // Grout slab under the tiles.
    this.boardBase = new THREE.Mesh(
      new THREE.BoxGeometry(cols * 1.05 + 0.2, 0.1, rows * 1.05 + 0.2),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(this.theme.board).multiplyScalar(0.45), roughness: 0.95 }));
    this.boardBase.position.y = -0.14;
    this.boardBase.receiveShadow = true;
    this.boardGroup.add(this.boardBase);
    const tileGeo = detailed ? new RoundedBoxGeometry(0.94, 0.12, 0.94, 3, 0.05) : new THREE.BoxGeometry(0.92, 0.1, 0.92);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const mat = detailed
          ? new THREE.MeshPhysicalMaterial({ color: this.theme.board, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.4, map: this._tex().tile })
          : new THREE.MeshStandardMaterial({ color: this.theme.board, roughness: 0.8 });
        const m = new THREE.Mesh(tileGeo, mat);
        const { x, z } = this.cellPos(r * cols + c);
        m.position.set(x, -0.05, z);
        m.receiveShadow = true;
        m.userData.cell = r * cols + c;
        this.boardGroup.add(m);
        this.cellMeshes.push(m);
      }
    }
    this.scene.add(this.boardGroup);
    this.itemViews.forEach((v) => { this.scene.remove(v); this._disposeGroup(v); });
    this.itemViews.clear();
    this.genViews.forEach((v) => { this.scene.remove(v); this._disposeGroup(v); });
    this.genViews.clear();
    this._fitShadow();
  }

  cellPos(i) {
    const c = i % this.cols, r = Math.floor(i / this.cols);
    const w = this.cols, h = this.rows;
    return { x: (c - (w - 1) / 2) * 1.05, z: (r - (h - 1) / 2) * 1.05 };
  }

  // Synchronize views from an immutable rules snapshot.
  syncState(state) {
    if (!this.ok) return;
    this._lastState = state;
    if (state.cols !== this.cols || state.rows !== this.rows) this.buildBoard(state.cols, state.rows);
    const seen = new Set();
    const colors = this.colorblind ? FAMILY_COLORS_CB : FAMILY_COLORS;
    state.board.forEach((cell, i) => {
      if (!cell) return;
      if (cell.kind === 'gen') {
        seen.add('g' + i);
        if (!this.genViews.has(i)) this._makeGenerator(i, cell.family, colors);
        return;
      }
      const key = 'i' + i;
      seen.add(key);
      const view = this.itemViews.get(i);
      const sig = cell.family + ':' + cell.tier;
      if (!view || view.userData.sig !== sig) {
        if (view) { this.scene.remove(view); this._disposeGroup(view); }
        const mesh = this._makeItem(cell, colors);
        const { x, z } = this.cellPos(i);
        mesh.position.set(x, 0.35, z);
        mesh.userData.cell = i;
        mesh.userData.sig = sig;
        mesh.userData.phase = i * 0.7;
        this.scene.add(mesh);
        this.itemViews.set(i, mesh);
      }
    });
    for (const [i, v] of this.itemViews) {
      if (!seen.has('i' + i)) { this.scene.remove(v); this._disposeGroup(v); this.itemViews.delete(i); }
    }
    for (const [i, v] of this.genViews) {
      if (!seen.has('g' + i)) { this.scene.remove(v); this._disposeGroup(v); this.genViews.delete(i); }
    }
  }

  _itemMaterial(color, extra = {}) {
    if (this._detailed()) {
      // Glazed, clay-like props: clearcoat catches the lamp and environment.
      return new THREE.MeshPhysicalMaterial({
        color, roughness: 0.48, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.28,
        sheen: 0.3, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.6, ...extra,
      });
    }
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...extra });
  }

  _makeItem(cell, colors) {
    const geo = familyGeometry(cell.family, cell.tier);
    const mat = this._itemMaterial(colors[cell.family], {
      emissive: colors[cell.family],
      emissiveIntensity: cell.tier >= 5 ? 0.45 : cell.tier >= 4 ? 0.25 : 0.05,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Tier marker ring under higher tiers (shape cue, not color-only).
    if (cell.tier >= 3) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.03, 8, 28),
        new THREE.MeshStandardMaterial({ color: 0xf2d38a, roughness: 0.25, metalness: 0.9 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.28;
      ring.castShadow = true;
      mesh.add(ring);
    }
    return mesh;
  }

  _makeGenerator(i, family, colors) {
    const g = new THREE.Group();
    const detailed = this._detailed();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.48, 0.3, detailed ? 32 : 12),
      detailed
        ? new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.6, map: this._tex().wood })
        : new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.7 }));
    base.castShadow = true;
    base.receiveShadow = true;
    // Glowing station item: emissive above the bloom threshold.
    const top = new THREE.Mesh(
      familyGeometry(family, 1),
      this._itemMaterial(colors[family], { emissive: colors[family], emissiveIntensity: 0.3 }));
    top.position.y = 0.35;
    top.castShadow = true;
    g.add(base, top);
    const { x, z } = this.cellPos(i);
    g.position.set(x, 0.15, z);
    g.userData.cell = i;
    g.userData.top = top;
    this.scene.add(g);
    this.genViews.set(i, g);
  }

  setSelection(cellIndex) {
    if (cellIndex == null) { this.selectionRing.visible = false; return; }
    const { x, z } = this.cellPos(cellIndex);
    this.selectionRing.position.set(x, 0.06, z);
    this.selectionRing.visible = true;
  }

  setGhostTarget(cellIndex) {
    if (cellIndex == null) { this.ghostRing.visible = false; return; }
    const { x, z } = this.cellPos(cellIndex);
    this.ghostRing.position.set(x, 0.06, z);
    this.ghostRing.visible = true;
  }

  // Bounded burst effect at a cell (merge/submit tier events).
  burst(cellIndex, color = 0xffe28a, count = 14) {
    if (this.reducedMotion || !this.ok) return;
    const { x, z } = this.cellPos(cellIndex);
    let spawned = 0;
    for (const p of this.particlePool) {
      if (spawned >= count) break;
      if (p.visible) continue;
      p.visible = true;
      p.material.color.set(color).multiplyScalar(1.5);
      p.position.set(x, 0.4, z);
      p.userData.life = 1;
      p.userData.vel.set((Math.random() - 0.5) * 2.4, Math.random() * 2.4 + 1, (Math.random() - 0.5) * 2.4);
      spawned++;
    }
  }

  // Low-amplitude event-tiered shake, disabled by reduced motion.
  shake(amount = 0.08) {
    if (this.reducedMotion) return;
    this._shake = Math.max(this._shake || 0, amount);
  }

  pick(clientX, clientY) {
    if (!this.ok) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [...this.cellMeshes];
    for (const g of this.genViews.values()) targets.push(...g.children);
    const hits = this.raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    let o = hits[0].object;
    while (o && o.userData.cell == null) o = o.parent;
    return o ? o.userData.cell : null;
  }

  setReducedMotion(v) { this.reducedMotion = v; if (this.q) this._applyMotion(); }
  setColorblind(v) { this.colorblind = v; }

  _resize() {
    if (!this.ok && !this.renderer) return;
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._alignCamera();
    this.size = [0, 0]; // render() re-applies size and pixel ratio
  }

  /**
   * The DOM board (the clickable, labelled grid) is the authoritative layout.
   * The 3D board is viewed straight down and scaled so its projected footprint
   * matches the DOM board's pixel box exactly, so props sit on the cells the
   * player taps at every aspect ratio.
   */
  fitToDom(sizePx) { this._domSize = sizePx; this._alignCamera(); }
  _alignCamera() {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    const cols = this.cols || 6;
    const worldHalfW = (cols * 1.05) / 2;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const size = this._domSize || Math.min(w, h) - 24;
    // px = x * h / (2 * dist * tanV)  →  dist so that worldHalfW → size / 2
    const dist = worldHalfW * h / (size * tanV);
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(0, dist, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  resize() { this._resize(); }

  // ---------------------------------------------------------------- post-processing

  _postKey(w, h) {
    const g = this.q;
    return g.post ? [g.ao, g.bloom, g.grade, g.antialias, w, h, this.pixelRatio].join('|') : 'none';
  }

  _buildPost(w, h) {
    const g = this.q;
    if (this.composer) { this.composer.dispose(); this.composer = null; }
    if (!g.post || this.postFailed) return;
    try {
      const pw = Math.round(w * this.pixelRatio), ph = Math.round(h * this.pixelRatio);
      const target = new THREE.WebGLRenderTarget(pw, ph, {
        type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0,
      });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(this.pixelRatio);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const ao = new GTAOPass(this.scene, this.camera, pw, ph);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        const hi = g.ao === 'high';
        ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 0.6, scale: 1.0, samples: hi ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8 });
        // Motes and sparks are additive light, not surfaces: keep them out of the AO depth/normal pass.
        const aoRender = ao.render.bind(ao);
        ao.render = (...args) => {
          const hidden = [this.motes, ...this.particlePool].filter((o) => o.visible);
          hidden.forEach((o) => { o.visible = false; });
          try { aoRender(...args); } finally { hidden.forEach((o) => { o.visible = true; }); }
        };
        composer.addPass(ao);
      }
      if (g.bloom === 'on') {
        // High threshold: only glowing stations, rings, sparks and the window bloom.
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.35, 0.9));
      }
      if (g.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      composer.addPass(new OutputPass());
      if (g.antialias === 'smaa') {
        const smaa = new SMAAPass();
        smaa.setSize(pw, ph);
        composer.addPass(smaa);
      }
      if (g.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch (e) {
      // Post-processing is an enhancement: render directly if the chain cannot be built.
      this.postError = String((e && e.stack) || e);
      this.postFailed = true;
      this.composer = null;
    }
  }

  // Adaptive resolution: step the render scale down when frames are slow, back up when fast.
  _adapt(dtMs) {
    const f = this._frames;
    f.push(dtMs);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = `${Math.round(this.fps)} fps · ${Math.round(this.pixelRatio * 100) / 100}×`;
    if (!this.q.adaptive) return false;
    const before = this.adaptiveScale;
    if (avg > 26) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.1);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
    return before !== this.adaptiveScale;
  }

  render(dt) {
    if (!this.ok || this._disposed) return;
    if (document.hidden) return; // background tabs: render heartbeat stops
    this._time += dt;
    const t = this._time;
    const moving = this._motionOn();
    if (moving) {
      // Generators turn slowly (existing idle cue).
      for (const g of this.genViews.values()) {
        if (g.userData.top) g.userData.top.rotation.y += dt * 0.8;
      }
      // Particles.
      for (const p of this.particlePool) {
        if (!p.visible) continue;
        p.userData.life -= dt * 1.6;
        if (p.userData.life <= 0) { p.visible = false; continue; }
        p.userData.vel.y -= dt * 4;
        p.position.addScaledVector(p.userData.vel, dt);
        p.scale.setScalar(Math.max(0.1, p.userData.life));
      }
      if (this._shake > 0.001) {
        this.camera.position.x = (Math.random() - 0.5) * this._shake;
        this._shake *= 0.85;
      } else if (this._shake) {
        this.camera.position.x = 0;
        this._shake = 0;
      }
    }
    if (this._ambientOn) {
      // Gentle idle life: items breathe, station tops bob, the lamp flickers
      // like a hearth, dust drifts through the light.
      for (const v of this.itemViews.values()) {
        v.position.y = 0.35 + Math.sin(t * 1.6 + v.userData.phase) * 0.025;
      }
      for (const g of this.genViews.values()) {
        if (g.userData.top) g.userData.top.position.y = 0.35 + Math.sin(t * 2.1 + g.userData.cell) * 0.04;
      }
      this.key.intensity = 2.4 * (1 + Math.sin(t * 7.3) * 0.015 + Math.sin(t * 2.9) * 0.02);
      const pos = this.motes.geometry.attributes.position;
      this._moteSeed.forEach((m, i) => {
        pos.setXYZ(i,
          m.x + Math.sin(t * m.s + m.p) * 0.6,
          m.y + Math.sin(t * m.s * 0.7 + m.p * 2) * 0.3,
          m.z + Math.cos(t * m.s * 0.8 + m.p) * 0.6);
      });
      pos.needsUpdate = true;
    } else if (this.key.intensity !== 2.4) {
      this.key.intensity = 2.4;
      for (const v of this.itemViews.values()) v.position.y = 0.35;
    }

    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return; // play screen hidden (menus): nothing to draw
    const rescale = this._adapt(dt * 1000);
    // the canvas sits in the zoomed #app (ui-scale.js): scale its backing store too
    const dpr = Math.min(window.devicePixelRatio || 1, this.q.dprCap) * ((window.UIScale && window.UIScale.value) || 1);
    const ratio = Math.min(3, dpr * this.q.scale * this.adaptiveScale);
    if (w !== this.size[0] || h !== this.size[1] || ratio !== this.pixelRatio || rescale) {
      this.size = [w, h];
      this.pixelRatio = ratio;
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(w, h, false);
    }
    const key = this._postKey(w, h);
    if (key !== this.postKey) {
      this.postKey = key;
      this._buildPost(w, h);
    }
    if (this.composer) {
      try { this.composer.render(dt); } catch (e) { this.postError = String((e && e.stack) || e); this.postFailed = true; this.composer.dispose(); this.composer = null; this.renderer.setRenderTarget(null); this.renderer.render(this.scene, this.camera); }
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  _disposeMesh(m) {
    if (m.geometry && m.geometry !== this._pGeo) m.geometry.dispose();
    // Shared procedural textures are kept; only materials are released.
    if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
  }

  _disposeGroup(g) {
    g.traverse((o) => { if (o.isMesh) this._disposeMesh(o); });
  }

  dispose() {
    this._disposed = true;
    if (!this.ok) return;
    this._disposeGroup(this.scene);
    if (this.composer) this.composer.dispose();
    this.renderer.dispose();
  }
}
