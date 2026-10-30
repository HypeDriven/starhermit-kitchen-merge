// The open kitchen on starhermit:scene, as the browser build's js/render.js
// drew it: a round counter with a theme-tinted floor disc, the board of tiles
// on a grout slab (rounded glazed ceramic with a speckle texture on detailed
// looks), the four family silhouettes (capsule, icosahedron, tapered cylinder,
// cone) growing with tier, a gold ring under tiers 3+ and glow on tiers 4+,
// stations as wooden bases with a turning, bobbing glowing item, the
// selection and drag-target rings, pooled spark bursts, the camera shake of a
// merge or serve, drifting dust motes and the flickering key light, and the
// surround on detailed looks (shelf, three hanging pans, a window glow, a
// copper rail and a salt cellar).
//
// Gaps and changes from three.js: light intensities are three.js's ÷ π (the
// engine's convention); the post chain is renderer.ao / bloom / grade /
// antialias (the grade is js/render.js's GradeShader in display space); the
// directional shadow is fitted by distance (three.js fitted an orthographic
// box); adaptive resolution, the frame-rate meter and the pixel-ratio cap are
// the runtime's. As before the camera looks straight down and is fitted so the
// board's projected footprint matches the cell grid the UI draws over it
// (setViewOffset centres it on the grid inside the window).
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CapsuleGeometry,
  ClampToEdgeWrapping, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Group, HemisphereLight, IcosahedronGeometry,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera,
  PlaneGeometry, PMREMGenerator, Points, PointsMaterial, RepeatWrapping, RoomEnvironment, RoundedBoxGeometry, SphereGeometry,
  SRGBColorSpace, TorusGeometry, renderer, scene,
  type Material, type Texture,
  type OrthographicCamera,
} from "starhermit:scene";
import { OffscreenCanvas, type OffscreenCanvasRenderingContext2D } from "starhermit:canvas";
import { THEMES } from "../js/content.js";
import { particlePool, type Look } from "./quality.ts";

const PI = Math.PI;
const KEY = 2.4;
export const FAMILY_COLORS: Record<string, number> = { grain: 0xd9b36a, garden: 0x6fbf5a, dairy: 0xf2ead2, ember: 0xd96a4a };
/** Colour-vision-safe palette (colour is always reinforced by shape and labels). */
export const FAMILY_COLORS_CB: Record<string, number> = { grain: 0xddcc77, garden: 0x117733, dairy: 0xf2f2f2, ember: 0xcc6677 };

export interface Cell { kind: "item" | "gen"; family: string; tier?: number }
export interface BoardState { cols: number; rows: number; board: (Cell | null)[] }
type Theme = (typeof THEMES)[number];

/** Geometry LOD: segment counts scaled by the look's `segments`, never below `min`. */
function seg(n: number, k: number, min = 3): number { return Math.max(min, Math.round(n * (k || 1))); }
/** Family silhouettes: each family has its own shape so colour is never the only cue. */
function familyGeometry(family: string, tier: number, k = 1): BufferGeometry {
  switch (family) {
    case "grain": {
      const g = new CapsuleGeometry(0.16 + tier * 0.03, 0.18 + tier * 0.05, seg(4, k, 2), seg(10, k, 6));
      g.rotateZ(PI / 2);
      return g;
    }
    case "garden": return new IcosahedronGeometry(0.16 + tier * 0.045, k >= 1.5 ? 2 : 1);
    case "dairy": return new CylinderGeometry(0.13 + tier * 0.03, 0.17 + tier * 0.03, 0.16 + tier * 0.06, seg(14, k, 8));
    case "ember": return new ConeGeometry(0.16 + tier * 0.04, 0.3 + tier * 0.08, 8);
    default: return new BoxGeometry(0.3, 0.3, 0.3);
  }
}

// -- procedural textures (deterministic) ----------------------------------------------------
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
type Ctx = OffscreenCanvasRenderingContext2D;
function canvasTexture(size: number, paint: (g: Ctx, px: number) => void, repeat = 1): Texture {
  const c = new OffscreenCanvas(size, size);
  paint(c.getContext("2d")!, size);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  return tex;
}
/** Butcher-block wood: long streaky grain with a few darker plank seams (drawn in 512-px units). */
function woodTexture(size: number): Texture {
  return canvasTexture(size, (g, px) => {
    const n = 512;
    g.scale(px / n, px / n);
    const r = rng(7);
    g.fillStyle = "#d8c2a6"; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 260; i++) {
      const y = r() * n, a = 0.04 + r() * 0.1, w = 1 + r() * 3;
      g.strokeStyle = r() < 0.5 ? `rgba(90,55,30,${a})` : `rgba(255,240,215,${a})`;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= n; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3 * r());
      g.stroke();
    }
    g.fillStyle = "rgba(40,24,12,0.35)";
    for (let k = 1; k < 4; k++) g.fillRect(0, (k * n) / 4 - 1, n, 2);
  }, 2);
}
/** Glazed ceramic tile: soft speckle and a slightly darker rim (drawn in 128-px units). */
function tileTexture(size: number): Texture {
  return canvasTexture(size, (g, px) => {
    const n = 128;
    g.scale(px / n, px / n);
    const r = rng(11);
    g.fillStyle = "#ece4d8"; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 700; i++) {
      g.fillStyle = r() < 0.5 ? "rgba(120,90,60,0.08)" : "rgba(255,255,255,0.10)";
      g.fillRect(r() * n, r() * n, 1 + r() * 2, 1 + r() * 2);
    }
    const grad = g.createRadialGradient(n / 2, n / 2, n * 0.25, n / 2, n / 2, n * 0.72);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(60,35,20,0.22)");
    g.fillStyle = grad; g.fillRect(0, 0, n, n);
  });
}
function dotTexture(): Texture {
  const t = canvasTexture(64, (g, n) => {
    const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, n, n);
  });
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  return t;
}

// -- renderer, camera, lights ------------------------------------------------------------------
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const camera = new PerspectiveCamera(30, 1, 0.1, 100);
camera.up.set(0, 0, -1);
const key = new DirectionalLight(0xffd9a0, KEY);
key.position.set(3.5, 9, 2.5);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.shadow.radius = 3;
const fill = new HemisphereLight(0x8a7ab0, 0x2a2018, 0.7);
scene.add(key, key.target, fill);
scene.background = new Color(0x1d1512);

let look: Look | null = null;
let theme: Theme = THEMES[0]!;
let reducedMotion = false;
let colorblind = false;
let cols = 0, rows = 0;
let last: BoardState | null = null;

let boardGroup = new Group();
scene.add(boardGroup);
let boardBase: Mesh | null = null;
let cellMeshes: Mesh[] = [];
const itemViews = new Map<number, Mesh>();
const genViews = new Map<number, Group>();
let floor: Mesh | null = null;
let envGroup: Group | null = null;

// Selection marker + drag-target ring: colours above 1 so they catch the bloom.
const selectionRing = new Mesh(new TorusGeometry(0.42, 0.05, 8, 32), new MeshBasicMaterial({ color: new Color(0xffe28a).multiplyScalar(1.6) }));
selectionRing.rotation.x = -PI / 2;
selectionRing.visible = false;
scene.add(selectionRing);
const ghostRing = new Mesh(new TorusGeometry(0.38, 0.03, 8, 32), new MeshBasicMaterial({ color: new Color(0x8affc0).multiplyScalar(1.4), transparent: true, opacity: 0.8 }));
ghostRing.rotation.x = -PI / 2;
ghostRing.visible = false;
scene.add(ghostRing);

// Spark pool (small spheres) and dust motes.
const pGeo = new SphereGeometry(0.05, 6, 6);
interface Spark { mesh: Mesh<MeshBasicMaterial>; vx: number; vy: number; vz: number; life: number }
let sparks: Spark[] = [];
const MOTE_CAP = 160;
const motePos = new Float32Array(MOTE_CAP * 3);
const moteSeed: { x: number; y: number; z: number; p: number; s: number }[] = [];
{
  const r = rng(3);
  for (let i = 0; i < MOTE_CAP; i++) moteSeed.push({ x: (r() - 0.5) * 7, y: 0.8 + r() * 1.6, z: (r() - 0.5) * 7, p: r() * PI * 2, s: 0.2 + r() * 0.5 });
}
const moteGeo = new BufferGeometry();
moteGeo.setAttribute("position", new BufferAttribute(motePos, 3));
const motes = new Points(moteGeo, new PointsMaterial({
  map: dotTexture(), color: 0xffd8a0, size: 0.09, transparent: true, opacity: 0.55, depthWrite: false, blending: AdditiveBlending,
}));
motes.frustumCulled = false;
motes.visible = false;
scene.add(motes);

let envTex: Texture | null = null;
let textures: { wood: Texture; tile: Texture; size: string } | null = null;
const detailed = (): boolean => !!look && look.detailed;
const budget = (): Look["budget"] => look?.budget ?? { material: "standard", wood: 512, tile: 128, segments: 1, motes: 28, sparks: 1, bloomRes: 0.5, aoRes: 0.5 };
function tex(): { wood: Texture; tile: Texture } {
  const b = budget();
  const size = `${b.wood}:${b.tile}`;
  if (!textures || textures.size !== size) {
    if (textures) { textures.wood.dispose(); textures.tile.dispose(); }
    textures = { wood: woodTexture(b.wood), tile: tileTexture(b.tile), size };
  }
  return textures;
}

interface StdParams {
  color: number | Color; roughness?: number; metalness?: number; map?: Texture | null; bumpMap?: Texture | null; bumpScale?: number;
  emissive?: number | Color; emissiveIntensity?: number;
}
interface PhysParams { clearcoat?: number; clearcoatRoughness?: number; sheen?: number; sheenColor?: Color; sheenRoughness?: number }
/** Material class per budget (js/render.js _mat): Lambert on Low, standard on Balanced, physical on High/Ultra where asked. */
function mat(std: StdParams, phys?: PhysParams): Material {
  const kind = budget().material;
  if (kind === "lambert") {
    const { roughness: _r, metalness: _m, bumpMap: _b, bumpScale: _s, ...rest } = std;
    return new MeshLambertMaterial(rest);
  }
  if (kind === "physical" && phys) return new MeshPhysicalMaterial({ ...std, ...phys });
  return new MeshStandardMaterial(std);
}

function disposeTree(o: Object3D): void {
  o.traverse((ch) => {
    const m = ch as Mesh;
    if (m.geometry && m.geometry !== pGeo) m.geometry.dispose();
    const mt = (m as { material?: Material | Material[] }).material;
    if (mt) for (const x of Array.isArray(mt) ? mt : [mt]) x.dispose(); // shared textures are kept
  });
}

/** Cell centre in world units (js/render.js cellPos). */
function cellPos(i: number): { x: number; z: number } {
  const c = i % cols, r = Math.floor(i / cols);
  return { x: (c - (cols - 1) / 2) * 1.05, z: (r - (rows - 1) / 2) * 1.05 };
}

// -- theme, surround and board -------------------------------------------------------------------
let themeKey = "";
function applyTheme(id: string): void {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0]!;
  const b = budget();
  const k = [t.id, detailed(), b.material, b.segments, b.wood].join("|");
  theme = t;
  if (k === themeKey) return;
  themeKey = k;
  scene.background = new Color(t.bg);
  key.color.set(t.key);
  fill.color.set(t.fill);
  if (floor) { scene.remove(floor); disposeTree(floor); }
  floor = new Mesh(new CylinderGeometry(6.5, 7, 0.3, seg(48, b.segments, 16)), mat({ color: t.floor, roughness: 0.9 }));
  floor.position.y = -0.55;
  floor.receiveShadow = true;
  scene.add(floor);
  buildSurround();
  for (const m of cellMeshes) (m.material as MeshStandardMaterial).color.set(t.board);
  if (boardBase) (boardBase.material as MeshStandardMaterial).color.set(t.board).multiplyScalar(0.45);
}
function buildSurround(): void {
  if (envGroup) { scene.remove(envGroup); disposeTree(envGroup); }
  const d = detailed();
  const g = new Group();
  const k = budget().segments;
  const wood = d
    ? mat({ color: 0x967660, roughness: 0.72, map: tex().wood, bumpMap: tex().wood, bumpScale: 0.6 })
    : mat({ color: 0x6a4c32, roughness: 0.85 });
  const steel = mat({ color: 0x9aa2ad, roughness: 0.3, metalness: 0.85 });
  const counter = new Mesh(new BoxGeometry(11, 0.4, 8.4), wood);
  counter.position.y = -0.35;
  counter.receiveShadow = true;
  g.add(counter);
  if (d) {
    const shelf = new Mesh(new BoxGeometry(5, 0.15, 1), wood);
    shelf.position.set(-2.5, 2.2, -4.2);
    g.add(shelf);
    for (let i = 0; i < 3; i++) {
      const pan = new Mesh(new CylinderGeometry(0.35, 0.3, 0.12, seg(24, k, 8)), steel);
      pan.position.set(-4 + i * 1.2, 1.6, -4.2);
      pan.castShadow = true;
      g.add(pan);
    }
    const win = new Mesh(new PlaneGeometry(2.2, 1.6), new MeshBasicMaterial({ color: new Color(theme.key).multiplyScalar(1.3) }));
    win.position.set(3, 2.4, -4.4);
    g.add(win);
    const copper = mat({ color: 0xc27a4a, roughness: 0.28, metalness: 0.9 });
    const rail = new Mesh(new CylinderGeometry(0.04, 0.04, 7.5, seg(12, k, 6)), copper);
    rail.rotation.z = PI / 2;
    rail.position.set(0, 0.02, 4.0);
    g.add(rail);
    const cellar = new Mesh(new CylinderGeometry(0.3, 0.26, 0.28, seg(24, k, 8)), mat({ color: 0x4f5f6c, roughness: 0.4 }, { clearcoat: 0.6 }));
    cellar.position.set(-4.6, 0, 3.4);
    cellar.castShadow = true;
    g.add(cellar);
  }
  scene.add(g);
  envGroup = g;
}
function clearViews(): void {
  for (const v of itemViews.values()) { scene.remove(v); disposeTree(v); }
  itemViews.clear();
  for (const v of genViews.values()) { scene.remove(v); disposeTree(v); }
  genViews.clear();
}
function buildBoard(c: number, r: number): void {
  cols = c; rows = r;
  scene.remove(boardGroup);
  disposeTree(boardGroup);
  boardGroup = new Group();
  cellMeshes = [];
  const d = detailed();
  boardBase = new Mesh(new BoxGeometry(cols * 1.05 + 0.2, 0.1, rows * 1.05 + 0.2), mat({ color: new Color(theme.board).multiplyScalar(0.45), roughness: 0.95 }));
  boardBase.position.y = -0.14;
  boardBase.receiveShadow = true;
  boardGroup.add(boardBase);
  const k = budget().segments;
  const tileGeo = d ? new RoundedBoxGeometry(0.94, 0.12, 0.94, seg(3, k, 1), 0.05) : new BoxGeometry(0.92, 0.1, 0.92);
  for (let i = 0; i < cols * rows; i++) {
    const m = new Mesh(tileGeo, d
      ? mat({ color: theme.board, roughness: 0.55, map: tex().tile }, { clearcoat: 0.35, clearcoatRoughness: 0.4 })
      : mat({ color: theme.board, roughness: 0.8 }));
    const p = cellPos(i);
    m.position.set(p.x, -0.05, p.z);
    m.receiveShadow = true;
    boardGroup.add(m);
    cellMeshes.push(m);
  }
  scene.add(boardGroup);
  clearViews();
  fitShadow();
}
/** The key light's ortho shadow box fitted to the board (render.js _fitShadow). */
function fitShadow(): void {
  const half = (Math.max(cols || 6, rows || 6) * 1.05) / 2 + 0.9;
  const cam = key.shadow.camera as OrthographicCamera;
  cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 2; cam.far = 22;
  cam.updateProjectionMatrix();
}

function itemMaterial(color: number, extra: Omit<StdParams, "color"> = {}): Material {
  if (detailed()) {
    return mat({ color, roughness: 0.48, metalness: 0, ...extra }, {
      clearcoat: 0.7, clearcoatRoughness: 0.28, sheen: 0.3, sheenColor: new Color(0xffffff), sheenRoughness: 0.6,
    });
  }
  return mat({ color, roughness: 0.55, metalness: 0.05, ...extra });
}
const colors = (): Record<string, number> => (colorblind ? FAMILY_COLORS_CB : FAMILY_COLORS);
function makeItem(cell: Cell): Mesh {
  const k = budget().segments;
  const tier = cell.tier ?? 1;
  const c = colors()[cell.family] ?? 0xffffff;
  const mesh = new Mesh(familyGeometry(cell.family, tier, k), itemMaterial(c, {
    emissive: c, emissiveIntensity: tier >= 5 ? 0.45 : tier >= 4 ? 0.25 : 0.05,
  }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (tier >= 3) {
    // Tier marker ring under higher tiers (a shape cue, not colour only).
    const ring = new Mesh(new TorusGeometry(0.3, 0.03, seg(8, k, 4), seg(28, k, 12)), mat({ color: 0xf2d38a, roughness: 0.25, metalness: 0.9 }));
    ring.rotation.x = -PI / 2;
    ring.position.y = -0.28;
    ring.castShadow = true;
    mesh.add(ring);
  }
  return mesh;
}
function makeGenerator(i: number, family: string): void {
  const g = new Group();
  const d = detailed();
  const k = budget().segments;
  const c = colors()[family] ?? 0xffffff;
  const base = new Mesh(new CylinderGeometry(0.42, 0.48, 0.3, d ? seg(32, k, 12) : 12),
    d ? mat({ color: 0x8a6a4a, roughness: 0.6, map: tex().wood }) : mat({ color: 0x5a4632, roughness: 0.7 }));
  base.castShadow = true;
  base.receiveShadow = true;
  const top = new Mesh(familyGeometry(family, 1, k), itemMaterial(c, { emissive: c, emissiveIntensity: 0.3 }));
  top.position.y = 0.35;
  top.castShadow = true;
  g.add(base, top);
  const p = cellPos(i);
  g.position.set(p.x, 0.15, p.z);
  g.userData = { cell: i, top };
  scene.add(g);
  genViews.set(i, g);
}

// -- camera fit (the cell grid the UI draws is the authoritative layout) -------------------------
let view = { cx: 0, cy: 0, size: 1, W: 1, H: 1 };
let camDist = 12;
let shakeAmt = 0;
function alignCamera(): void {
  const { cx, cy, size, W, H } = view;
  camera.aspect = W / H;
  camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
  const worldHalfW = ((cols || 6) * 1.05) / 2;
  const tanV = Math.tan((camera.fov / 2) * PI / 180);
  // px = x · H / (2 · dist · tanV): the board's half width lands on half the grid's width.
  camDist = worldHalfW * H / (Math.max(1, size) * tanV);
  camera.position.set(0, camDist, 0);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  fitShadow();
}

// -- the game's calls ------------------------------------------------------------------------------
/** The cell grid's centre and width (window pixels) inside the W × H window. */
export function setGrid(cx: number, cy: number, size: number, W: number, H: number): void {
  const next = { cx, cy, size, W: Math.max(1, W), H: Math.max(1, H) };
  if ((Object.keys(next) as (keyof typeof next)[]).every((k) => Math.abs(next[k] - view[k]) < 0.25)) return;
  view = next;
  alignCamera();
}
export function resetCamera(): void { shakeAmt = 0; alignCamera(); }
/** Whether the kitchen draws (only on the play screen). */
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }

/** A round's board: its theme and grid. */
export function startBoard(themeId: string, c: number, r: number, state: BoardState): void {
  applyTheme(themeId);
  buildBoard(c, r);
  setSelection(null);
  setGhostTarget(null);
  syncState(state);
  alignCamera();
}
/** Reconciles views from a rules snapshot: item and station views are keyed by family:tier. */
export function syncState(state: BoardState): void {
  last = state;
  if (state.cols !== cols || state.rows !== rows) buildBoard(state.cols, state.rows);
  const seenItems = new Set<number>(), seenGens = new Set<number>();
  state.board.forEach((cell, i) => {
    if (!cell) return;
    if (cell.kind === "gen") {
      seenGens.add(i);
      if (!genViews.has(i)) makeGenerator(i, cell.family);
      return;
    }
    seenItems.add(i);
    const v = itemViews.get(i);
    const sig = `${cell.family}:${cell.tier}`;
    if (!v || v.userData.sig !== sig) {
      if (v) { scene.remove(v); disposeTree(v); }
      const mesh = makeItem(cell);
      const p = cellPos(i);
      mesh.position.set(p.x, 0.35, p.z);
      mesh.userData = { cell: i, sig, phase: i * 0.7 };
      scene.add(mesh);
      itemViews.set(i, mesh);
    }
  });
  for (const [i, v] of itemViews) if (!seenItems.has(i)) { scene.remove(v); disposeTree(v); itemViews.delete(i); }
  for (const [i, v] of genViews) if (!seenGens.has(i)) { scene.remove(v); disposeTree(v); genViews.delete(i); }
}
export function setSelection(cell: number | null): void {
  if (cell == null || !cols) { selectionRing.visible = false; return; }
  const p = cellPos(cell);
  selectionRing.position.set(p.x, 0.06, p.z);
  selectionRing.visible = true;
}
export function setGhostTarget(cell: number | null): void {
  if (cell == null || !cols) { ghostRing.visible = false; return; }
  const p = cellPos(cell);
  ghostRing.position.set(p.x, 0.06, p.z);
  ghostRing.visible = true;
}
/** A bounded burst at a cell (spawn 6, merge 14, serve 20 × the look's sparks). */
export function burst(cell: number, color: number, count: number): void {
  if (reducedMotion || !cols) return;
  const n = Math.max(1, Math.round(count * budget().sparks));
  const p = cellPos(cell);
  let spawned = 0;
  for (const s of sparks) {
    if (spawned >= n) break;
    if (s.mesh.visible) continue;
    s.mesh.visible = true;
    s.mesh.material.color.set(color).multiplyScalar(1.5);
    s.mesh.position.set(p.x, 0.4, p.z);
    s.life = 1;
    s.vx = (Math.random() - 0.5) * 2.4; s.vy = Math.random() * 2.4 + 1; s.vz = (Math.random() - 0.5) * 2.4;
    spawned++;
  }
}
/** Low-amplitude camera shake (merge 0.05, serve 0.08); none with reduced motion. */
export function shake(amount: number): void { if (!reducedMotion) shakeAmt = Math.max(shakeAmt, amount); }
export function setReducedMotion(on: boolean): void { reducedMotion = on; }
/** The colour-vision palette: rebuilds the props in it. */
export function setColorblind(on: boolean): void {
  if (on === colorblind) return;
  colorblind = on;
  if (last && cols) { clearViews(); syncState(last); }
}
function buildSparks(n: number): void {
  for (const s of sparks) { scene.remove(s.mesh); s.mesh.material.dispose(); }
  sparks = [];
  for (let i = 0; i < n; i++) {
    const mesh = new Mesh(pGeo, new MeshBasicMaterial({ color: 0xffe28a }));
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0 });
  }
}
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  const before = look;
  look = next;
  const shadows = next.shadows > 0;
  renderer.shadowMap.enabled = shadows;
  key.castShadow = shadows;
  if (shadows) key.shadow.mapSize = next.shadows;
  if (next.reflections) {
    if (!envTex) {
      try { envTex = (() => {
        // three r183+: RoomEnvironment(renderer) with the room lowered (engine environment-ports rule)
        const room = new RoomEnvironment(renderer);
        room.position.y = -3.5;
        return new PMREMGenerator(renderer).fromScene(room, 0.04).texture;
      })(); }
      catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
    }
    scene.environment = envTex;
    scene.environmentIntensity = 0.5;
    fill.intensity = 0.45;
  } else {
    scene.environment = null;
    fill.intensity = 0.7;
  }
  const hi = next.ao === "high";
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.45, distanceExponent: 1.4, thickness: 0.6, scale: 1.0, samples: hi ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: hi ? 6 : 4, rings: 2, samples: hi ? 16 : 8, radiusExponent: 2 },
  };
  // High threshold: only glowing stations, rings, sparks and the window bloom (UnrealBloomPass 0.4, 0.35, 0.9).
  renderer.bloom = next.bloom ? { strength: 0.4, radius: 0.35, threshold: 0.9, resolution: next.budget.bloomRes } : null;
  // js/render.js GradeShader (before OutputPass, so on linear HDR colour): a gentle S-curve, a touch more saturation,
  // warm highlights / cool shadows and the 0.2 vignette.
  renderer.grade = next.grade ? {
    space: "linear", contrastCurve: "s", contrast: 0.18, saturation: 1.1,
    shadows: [0.97, 0.98, 1.04], highlights: [1.05, 1.0, 0.94], split: [0.2, 0.8],
    vignette: { amount: 0.2, inner: 0.38, outer: 0.85 },
    overRange: "keep", // minor 29: mix(c, s + max(c - 1, 0), amount) as the page's grade
  } : null;
  renderer.antialias = next.antialias;
  const pb = before?.budget;
  if (!before || particlePool(before) !== particlePool(next)) buildSparks(particlePool(next));
  // Asset variants (material class, LOD, textures, detail) are built into the meshes.
  if (before && (before.detailed !== next.detailed || pb!.material !== next.budget.material || pb!.segments !== next.budget.segments || pb!.wood !== next.budget.wood || pb!.tile !== next.budget.tile)) {
    themeKey = "";
    applyTheme(theme.id);
    if (cols && last) { const st = last; buildBoard(cols, rows); syncState(st); }
  }
}
/** Leaves the round: nothing on the board. */
export function clear(): void {
  clearViews();
  scene.remove(boardGroup);
  disposeTree(boardGroup);
  boardGroup = new Group();
  cellMeshes = [];
  boardBase = null;
  cols = rows = 0;
  last = null;
  selectionRing.visible = ghostRing.visible = false;
  for (const s of sparks) { s.mesh.visible = false; s.life = 0; }
}

// -- the frame -------------------------------------------------------------------------------------
let time = 0;
/** Each rendered frame: particles, shake and the ambient motion (items breathe, station tops bob and turn, the lamp flickers, dust drifts). */
export function update(dtIn: number): void {
  const dt = Math.min(0.05, Math.max(0, dtIn));
  time += dt;
  const t = time;
  const moving = !reducedMotion;
  if (moving) {
    for (const g of genViews.values()) (g.userData.top as Mesh).rotation.y += dt * 0.8;
    for (const s of sparks) {
      if (!s.mesh.visible) continue;
      s.life -= dt * 1.6;
      if (s.life <= 0) { s.mesh.visible = false; continue; }
      s.vy -= dt * 4;
      s.mesh.position.set(s.mesh.position.x + s.vx * dt, s.mesh.position.y + s.vy * dt, s.mesh.position.z + s.vz * dt);
      s.mesh.scale.setScalar(Math.max(0.1, s.life));
    }
  }
  if (shakeAmt > 0.001 && moving) {
    camera.position.x = (Math.random() - 0.5) * shakeAmt;
    shakeAmt *= 0.85;
  } else if (shakeAmt) {
    camera.position.x = 0;
    shakeAmt = 0;
  }
  const ambient = !!look && look.animated && moving;
  motes.visible = ambient && !!cols;
  if (ambient) {
    for (const v of itemViews.values()) v.position.y = 0.35 + Math.sin(t * 1.6 + (v.userData.phase as number)) * 0.025;
    for (const g of genViews.values()) (g.userData.top as Mesh).position.y = 0.35 + Math.sin(t * 2.1 + (g.userData.cell as number)) * 0.04;
    key.intensity = KEY * (1 + Math.sin(t * 7.3) * 0.015 + Math.sin(t * 2.9) * 0.02);
    const n = Math.min(MOTE_CAP, look!.budget.motes);
    moteGeo.setDrawRange(0, n);
    for (let i = 0; i < n; i++) {
      const m = moteSeed[i]!;
      motePos[i * 3] = m.x + Math.sin(t * m.s + m.p) * 0.6;
      motePos[i * 3 + 1] = m.y + Math.sin(t * m.s * 0.7 + m.p * 2) * 0.3;
      motePos[i * 3 + 2] = m.z + Math.cos(t * m.s * 0.8 + m.p) * 0.6;
    }
    (moteGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
  } else if (key.intensity !== KEY) {
    key.intensity = KEY;
    for (const v of itemViews.values()) v.position.y = 0.35;
  }
}
