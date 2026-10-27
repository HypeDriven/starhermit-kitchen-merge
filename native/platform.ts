// The game's data and the StarHermit platform, on the runtime's modules:
// - the save is the browser build's document ({ version, savedAt, settings,
//   progress, scores }, js/save.js), unchanged: it is the game's save
//   (starhermit:storage `saves`) on the device and in the player's cloud slot,
//   two devices' copies merged on a conflict (mergeDocs: progress only grows).
//   The slot the browser build wrote (the JS SDK's saveJSON of the same
//   document, key game:<slug>) shows as foreign and is merged in and replaced
//   once;
// - js/session.js's `store` keeps reading and writing `localStorage`: here a
//   shim whose kitchen-merge:settings / progress / scores keys are that
//   document's fields and whose other keys (snapshot slots) are the device's
//   starhermit:storage;
// - the game's own options (theme, colour-vision palette, left-handed layout,
//   haptics) stay in the document's settings as before. The browser build
//   also mirrored its settings key by key into the account's settings
//   (patchSettings) and kept ui.language and the options panel's
//   audio.options / graphics.gpu.* there: those legacy keys are read once
//   (the four game options adopted), then removed. Volumes, mute, graphics,
//   language, reduced motion, high contrast and text size are the runtime's
//   Options;
// - the player, the invite link, the platform's clock for the daily, the
//   high-score board (read for Scores › Global) and posting a finished round's
//   total through score-script.js (a practice session whose socket carries
//   { type: 'result', scores }, as the JS SDK's submitScores did; the script
//   range-checks it) with the rank on the high-score board.
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime, sessions,
  type Leaderboard,
} from "starhermit:platform";
import { saves, settings as kv, storage } from "starhermit:storage";
import { DOC_KEYS, LS_PREFIX, mergeDocs, parseDoc } from "../js/save.js";

type Doc = { version: number; savedAt: string; settings: Record<string, unknown>; progress: Record<string, unknown>; scores: Record<string, unknown> };

// --- the save and the localStorage shim ----------------------------------------------
let current: Doc | null = null;
let lastSavedAt = 0;
let adoptHook: (() => void) | null = null;
/** fn() when the account's copy (another device, the browser build) was merged in. */
export function onAdopt(fn: () => void): void { adoptHook = fn; }

function persist(): void {
  if (!current) return;
  try { saves.save(current as unknown as JsonValue, { schema: 1 }); }
  catch (e) { console.warn(`save: ${String(e)}`); }
}
const docField = (key: string): string | null => {
  if (!key.startsWith(LS_PREFIX)) return null;
  const f = key.slice(LS_PREFIX.length);
  return (DOC_KEYS as string[]).includes(f) ? f : null;
};
const shim = {
  getItem(key: string): string | null {
    const f = docField(key);
    if (f) return current ? JSON.stringify((current as unknown as Record<string, unknown>)[f]) : null;
    try { return storage.getText(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    const f = docField(key);
    if (f) {
      let v: unknown;
      try { v = JSON.parse(value); } catch { return; }
      if (!current) current = { version: 1, savedAt: "", settings: {}, progress: {}, scores: {} };
      (current as unknown as Record<string, unknown>)[f] = v;
      current.savedAt = new Date(nowMs()).toISOString();
      persist();
      return;
    }
    try { storage.set(key, String(value)); } catch (e) { console.warn(`storage ${key}: ${String(e)}`); }
  },
  removeItem(key: string): void {
    if (docField(key)) return;
    try { storage.remove(key); } catch { /* gone */ }
  },
};
(globalThis as unknown as { localStorage: typeof shim }).localStorage = shim;

/** Merges another copy into the device's (and saves); whether anything changed. */
function adopt(other: unknown): boolean {
  const remote = parseDoc(other);
  if (!remote) return false;
  const next = mergeDocs(remote, current) as Doc;
  const sig = (d: Doc | null): string => (d ? JSON.stringify([d.settings, d.progress, d.scores]) : "");
  if (current && sig(next) === sig(current)) return false;
  current = next;
  persist();
  adoptHook?.();
  return true;
}

saves.onConflict((local, remote) => ({ merged: mergeDocs(parseDoc(remote.data), parseDoc(local?.data ?? null)) as unknown as JsonValue }));
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  // The account's save replaced the device's (another device saved last): merge it in.
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    adopt(cur.data);
  }
});

/** The browser build's cloud save: merged with this device's progress, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  adopt(old.text);
  if (!current) current = { version: 1, savedAt: new Date(nowMs()).toISOString(), settings: {}, progress: {}, scores: {} };
  try { saves.save(current as unknown as JsonValue, { schema: 1, replaceForeign: true }); }
  catch (e) { console.warn(`save migration: ${String(e)}`); }
}

/** For the title line: offline (a guest) | saving | synced | error. */
export function syncState(): "offline" | "saving" | "synced" | "error" {
  if (!player()) return "offline";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "error";
  if (st === "loading" || st === "uploading" || st === "foreign" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

// --- the browser build's account settings (legacy keys) -------------------------------
/** The game options the old settings mirror carried, adopted into the document's settings. */
const GAME_OPTIONS = ["theme", "colorblind", "leftHanded", "haptics"];
/** Every key the browser build wrote to the account's settings. */
const BROWSER_KEYS = [
  "music", "effects", "ambience", "voice", "graphics", "reducedMotion", "highContrast", "colorblind", "largeText",
  "leftHanded", "holdToConfirm", "haptics", "theme", "ui.language", "audio.options",
];
const isBrowserKey = (k: string): boolean => BROWSER_KEYS.includes(k) || k.startsWith("graphics.gpu.");
function importLegacy(): void {
  const keys = kv.legacyKeys();
  if (!keys || !keys.length) return;
  const adopted: Record<string, unknown> = {};
  for (const key of keys) {
    if (!GAME_OPTIONS.includes(key)) continue;
    const v = kv.legacy(key);
    if (key === "theme" ? typeof v === "string" : typeof v === "boolean") adopted[key] = v;
  }
  if (Object.keys(adopted).length) {
    // The browser build applied the account's settings over the device's at boot.
    const settings = { ...(current?.settings ?? {}), ...adopted };
    shim.setItem(LS_PREFIX + "settings", JSON.stringify(settings));
    adoptHook?.();
  }
  for (const key of keys) if (isBrowserKey(key)) kv.removeLegacy(key);
}

/** Reads the device's save (from onStart, before the game reads its store). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  current = parseDoc(cur?.data ?? null) as Doc | null;
  kv.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  refreshPlayer();
  void serverTime().catch(() => undefined);
}

// --- the player and the clock ----------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  board = null;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
const playerListeners = new Set<(signedIn: boolean) => void>();
export function onPlayer(fn: (signedIn: boolean) => void): void { playerListeners.add(fn); }
onPlayerChange((p) => { refreshPlayer(); for (const fn of playerListeners) fn(!!p); });

/** Now in ms by the platform's clock when it has answered, else the device's. */
export function nowMs(): number {
  try { return serverNow() ?? Date.now(); } catch { return Date.now(); }
}
/** Today's UTC date (YYYY-MM-DD) by nowMs(): the daily's seed. */
export function todayIso(): string { return new Date(nowMs()).toISOString().slice(0, 10); }

// --- the StarHermit high-score board ---------------------------------------------------
let board: Leaderboard | null = null;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? list[0] ?? null;
  return board;
}
export interface Posted { posted: boolean; rank: number | null }
export interface Row { rank: number; name: string; score: number }

/** The high-score board's top entries (Scores › Global); null when there is none or it is unreachable. */
export async function fetchLeaderboard(pageSize = 50): Promise<Row[] | null> {
  try {
    const b = await highScoreBoard();
    if (!b) return null;
    const r = await leaderboards.entries(b.id, { pageSize });
    return r.items.map((e) => ({ rank: e.rank, name: e.displayName, score: e.score }));
  } catch { return null; }
}

/** Signed in only: post a finished round's total through score-script.js; never rejects. */
export async function postLeaderboard(total: number): Promise<Posted> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (v: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(v);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
