// Kitchen Merge — Three.js renderer. Tabletop open-kitchen scene with a
// miniature board, stations, deterministic visual seed, pooled effects and
// quality tiers. Rendering consumes snapshots; it never mutates rules state.
import * as THREE from '../lib/three.module.js';
import { FAMILIES } from './rules.js';
import { THEMES } from './content.js';

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

const QUALITY_TIERS = {
  low:    { dpr: 1,    shadows: false, particles: 60,  envDetail: false },
  medium: { dpr: 1.5,  shadows: true,  particles: 150, envDetail: true },
  high:   { dpr: 2,    shadows: true,  particles: 300, envDetail: true },
};

export class KitchenRenderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.reducedMotion = !!opts.reducedMotion;
    this.colorblind = !!opts.colorblind;
    this.tier = opts.tier || 'high';
    this.ok = false;
    this.itemViews = new Map(); // cellIndex -> mesh
    this.particles = [];
    this.particlePool = [];
    this.callbacks = { onCellPick: null };
    this._time = 0;
    this._disposed = false;
    try {
      this._init();
      this.ok = true;
    } catch (e) {
      console.error('WebGL init failed', e);
      this.ok = false;
    }
  }

  _init() {
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1d1512);

    // Authored low-distortion near-tabletop framing; close to top-down so the
    // DOM accessibility grid aligns with projected 3D cells.
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.set(0, 10.8, 3.0);
    this.camera.lookAt(0, 0, 0.2);

    // Lights: one dominant warm key, soft cool fill, ambient bounce.
    this.key = new THREE.DirectionalLight(0xffd9a0, 2.2);
    this.key.position.set(4, 8, 3);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.fill = new THREE.HemisphereLight(0x8a7ab0, 0x2a2018, 0.7);
    this.scene.add(this.key, this.fill);

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

    // Selection marker + legal-target ghost ring.
    this.selectionRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.05, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe28a }));
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    this.ghostRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.03, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x8affc0, transparent: true, opacity: 0.8 }));
    this.ghostRing.rotation.x = -Math.PI / 2;
    this.ghostRing.visible = false;
    this.scene.add(this.ghostRing);

    // Particle pool (bounded).
    const pGeo = new THREE.SphereGeometry(0.05, 6, 6);
    const pMat = new THREE.MeshBasicMaterial({ color: 0xffe28a });
    for (let i = 0; i < QUALITY_TIERS[this.tier].particles; i++) {
      const p = new THREE.Mesh(pGeo, pMat.clone());
      p.visible = false;
      p.userData = { vel: new THREE.Vector3(), life: 0 };
      this.scene.add(p);
      this.particlePool.push(p);
    }

    this._bound = false;
    this.setTheme('hearth');
    this._resize();
  }

  setTheme(themeId) {
    const t = THEMES.find((x) => x.id === themeId) || THEMES[0];
    this.theme = t;
    this.scene.background = new THREE.Color(t.bg);
    this.key.color.set(t.key);
    this.fill.color.set(t.fill);
    if (this.floor) {
      this.floor.material.color.set(t.floor);
    } else {
      this.floor = new THREE.Mesh(
        new THREE.CylinderGeometry(6.5, 7, 0.3, 48),
        new THREE.MeshStandardMaterial({ color: t.floor, roughness: 0.9 }));
      this.floor.position.y = -0.55;
      this.floor.receiveShadow = true;
      this.scene.add(this.floor);
    }
    this._buildSurround();
    if (this.boardGroup) {
      for (const m of this.cellMeshes) m.material.color.set(t.board);
    }
  }

  // Restrained environmental storytelling: miniature stations around the board.
  _buildSurround() {
    if (this.envGroup) { this.scene.remove(this.envGroup); this._disposeGroup(this.envGroup); }
    const q = QUALITY_TIERS[this.tier];
    this.envGroup = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4c32, roughness: 0.85 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.35, metalness: 0.8 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(11, 0.4, 8.4), wood);
    counter.position.y = -0.35;
    counter.receiveShadow = true;
    this.envGroup.add(counter);
    if (q.envDetail) {
      // Shelf, hanging pans, a window glow — small original props.
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(5, 0.15, 1), wood);
      shelf.position.set(-2.5, 2.2, -4.2);
      this.envGroup.add(shelf);
      for (let i = 0; i < 3; i++) {
        const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 0.12, 16), steel);
        pan.position.set(-4 + i * 1.2, 1.6, -4.2);
        this.envGroup.add(pan);
      }
      const winMat = new THREE.MeshBasicMaterial({ color: this.theme.key });
      const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), winMat);
      win.position.set(3, 2.4, -4.4);
      this.envGroup.add(win);
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
    const tileGeo = new THREE.BoxGeometry(0.92, 0.1, 0.92);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const m = new THREE.Mesh(tileGeo, new THREE.MeshStandardMaterial({
          color: this.theme.board, roughness: 0.8,
        }));
        const { x, z } = this.cellPos(r * cols + c);
        m.position.set(x, -0.05, z);
        m.receiveShadow = true;
        m.userData.cell = r * cols + c;
        this.boardGroup.add(m);
        this.cellMeshes.push(m);
      }
    }
    this.scene.add(this.boardGroup);
    this.itemViews.forEach((v) => this.scene.remove(v));
    this.itemViews.clear();
    this.genViews.forEach((v) => this.scene.remove(v));
    this.genViews.clear();
  }

  cellPos(i) {
    const c = i % this.cols, r = Math.floor(i / this.cols);
    const w = this.cols, h = this.rows;
    return { x: (c - (w - 1) / 2) * 1.05, z: (r - (h - 1) / 2) * 1.05 };
  }

  // Synchronize views from an immutable rules snapshot.
  syncState(state) {
    if (!this.ok) return;
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
        if (view) { this.scene.remove(view); this._disposeMesh(view); }
        const mesh = this._makeItem(cell, colors);
        const { x, z } = this.cellPos(i);
        mesh.position.set(x, 0.35, z);
        mesh.userData.cell = i;
        mesh.userData.sig = sig;
        this.scene.add(mesh);
        this.itemViews.set(i, mesh);
      }
    });
    for (const [i, v] of this.itemViews) {
      if (!seen.has('i' + i)) { this.scene.remove(v); this._disposeMesh(v); this.itemViews.delete(i); }
    }
    for (const [i, v] of this.genViews) {
      if (!seen.has('g' + i)) { this.scene.remove(v); this._disposeGroup(v); this.genViews.delete(i); }
    }
  }

  _makeItem(cell, colors) {
    const geo = familyGeometry(cell.family, cell.tier);
    const mat = new THREE.MeshStandardMaterial({
      color: colors[cell.family],
      roughness: 0.55,
      metalness: 0.05,
      emissive: colors[cell.family],
      emissiveIntensity: cell.tier >= 4 ? 0.25 : 0.05,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    // Tier marker ring under higher tiers (shape cue, not color-only).
    if (cell.tier >= 3) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.3, 0.03, 6, 20),
        new THREE.MeshStandardMaterial({ color: 0xf2d38a, roughness: 0.4, metalness: 0.6 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.28;
      mesh.add(ring);
    }
    return mesh;
  }

  _makeGenerator(i, family, colors) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.48, 0.3, 12),
      new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.7 }));
    base.castShadow = true;
    const top = new THREE.Mesh(
      familyGeometry(family, 1),
      new THREE.MeshStandardMaterial({
        color: colors[family], roughness: 0.5,
        emissive: colors[family], emissiveIntensity: 0.4,
      }));
    top.position.y = 0.35;
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
      p.material.color.set(color);
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

  setQuality(tier) {
    this.tier = tier in QUALITY_TIERS ? tier : 'high';
    const q = QUALITY_TIERS[this.tier];
    this.key.castShadow = q.shadows;
    this._resize();
  }

  setReducedMotion(v) { this.reducedMotion = v; }
  setColorblind(v) { this.colorblind = v; }

  _resize() {
    if (!this.ok) return;
    const q = QUALITY_TIERS[this.tier];
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the square board fully visible in portrait.
    this.camera.position.set(0, w < h ? 13.4 : 10.8, w < h ? 2.4 : 3.0);
    this.camera.lookAt(0, 0, 0.2);
    this.camera.updateProjectionMatrix();
  }

  resize() { this._resize(); }

  render(dt) {
    if (!this.ok || this._disposed) return;
    if (document.hidden) return; // background tabs: render heartbeat stops
    this._time += dt;
    // Idle bob for generators (purely cosmetic, from wall clock).
    if (!this.reducedMotion) {
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
    this.renderer.render(this.scene, this.camera);
  }

  _disposeMesh(m) {
    if (m.geometry) m.geometry.dispose();
    if (m.material) (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
  }

  _disposeGroup(g) {
    g.traverse((o) => { if (o.isMesh) this._disposeMesh(o); });
  }

  dispose() {
    this._disposed = true;
    if (!this.ok) return;
    this._disposeGroup(this.scene);
    this.renderer.dispose();
  }
}
