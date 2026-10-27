// Kitchen Merge on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/rules.js), content (js/content.js),
// the session with its undo, replay envelope and store (js/session.js) and the
// save document (js/save.js) are the browser build's, unchanged in what they
// decide; this module is what js/main.js did around them — the screen flow
// (title → list / setup → the round ⇄ pause → results → retry / next stage /
// title; help, settings and scores), the selection model (tap a station, tap
// an item then an identical item to merge — or drag one onto the other —
// Serve / Discard on the selected item), the lessons' goals, the event
// presentation (a sound, an announcement and the kitchen's burst and shake
// per rules event), Undo (Practice), Hint and the camera reset, progression,
// achievements, local scores and posting Journey, Daily and Challenge totals
// through score-script.js, and the lifecycle (a hidden window pauses the
// round). The screens and HUD are drawn by screens.ts (starhermit:ui), the
// kitchen by render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps (60 a second): the session's 100 ms tick,
// the lesson's 0.8 s hand-over and the hint's 3 s run on them, so play scripts
// replay exactly.
import { frame, onFixedUpdate, onPreferencesChange, onQuit, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { requestSignIn } from "starhermit:platform";
import { clipboard } from "starhermit:engine";
import { FAMILIES, TICK_MS, hashString } from "../js/rules.js";
import { ACHIEVEMENTS, CHALLENGES, JOURNEY_LEVELS, TUTORIALS, dailyLevel, practiceLevel } from "../js/content.js";
import { Session, store } from "../js/session.js";
import * as audio from "./audio.ts";
import { N, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyContrast, initStyles } from "./style.ts";

// -- the shapes this client reads ------------------------------------------------------
export interface Cell { kind: "item" | "gen"; family: string; tier?: number }
export interface Order { id: number; family: string; tier: number; timeLeft: number; maxTime: number; value: number }
export interface State {
  cols: number; rows: number; board: (Cell | null)[]; orders: Order[]; tick: number; phase: string;
  timeLeft: number | null; movesLeft: number | null; ordersTarget: number | null; fulfilled: number;
  score: { orders: number; streaks: number; efficiency: number }; streak: number;
}
export interface Level {
  id: string; kind: string; seed: number; cols?: number; rows?: number; families: string[]; theme?: string;
  timeLimit?: number | null; moveLimit?: number | null; ordersTarget?: number | null; stage?: number; mastery?: boolean;
  par?: number; date?: string; name?: string; blurb?: string; tutorialId?: string; undo?: boolean;
}
interface RulesEvent { type: string; cell?: number; family?: string; tier?: number; order?: Order; streak?: number; gained?: number; reason?: string }
export interface Result {
  levelId: string; score: number; components: { orders: number; streaks: number; efficiency: number }; fulfilled: number;
  bestStreak: number; invalidActions: number; moves: number; ticks: number; reason: string; sessionId: string;
}
interface Sess {
  state: State; level: Level; paused: boolean; undoEnabled: boolean; undoStack: unknown[]; sessionId: string;
  start(): void; stop(): void; pause(): void; resume(): void; tick(): void; undo(): boolean;
  command(c: Record<string, unknown>): { ok: boolean; reason?: string; events: RulesEvent[] };
  hint(): { action: { gen?: number; from?: number; to?: number; cell?: number } | null; text: string };
}
interface Tutorial { id: string; title: string; brief: string; goal: { kind: string; count: number }; level: Record<string, unknown> }
export type Mode = "tutorial" | "journey" | "daily" | "practice" | "challenge";
export type Screen = "title" | "setup" | "play" | "help" | "settings" | "scores" | "list";
export type ListKind = "learn" | "journey" | "practice" | "challenges";
export interface Settings { theme: string; colorblind: boolean; leftHanded: boolean; haptics: boolean; [k: string]: unknown }

export interface Round {
  session: Sess; level: Level; mode: Mode; selected: number | null; hintCells: number[]; hintMs: number;
  tutorial: (Tutorial & { done: number }) | null; lessonMs: number | null; warnedLowTime: boolean;
}

const STEP_MS = 1000 / 60;
export const app = {
  screen: "title" as Screen,
  openedFrame: 0,
  focusNext: null as string | null,
  overlay: null as null | "pause" | "results",
  overlayOpened: 0,
  settingsReturn: "title" as Screen,
  helpReturn: "title" as Screen,
  list: "learn" as ListKind,
  level: null as Level | null,
  mode: null as Mode | null,
  round: null as Round | null,
  results: null as { result: Result; newAch: string[]; next: boolean } | null,
  lb: null as null | "posting" | platform.Posted,
  scoresView: "local" as "local" | "global",
  globalRows: null as platform.Row[] | null,
  toast: null as { text: string; until: number } | null,
  explained: null as string | null,
};
export let settings: Settings = store.getSettings() as Settings;
const now = (): number => frame().time;

// ------------------------------------------------------------------ helpers
export function announce(text: string, assertive = false): void {
  if (text) ui.announce(text.slice(0, 500), { politeness: assertive ? "assertive" : "polite" });
}
/** js/main.js toast(): one at a time, 2.6 s by default. */
export function toast(text: string, ms = 2600): void { app.toast = { text, until: now() + ms / 1000 }; }
export const familyName = (f: string): string => T((FAMILIES as Record<string, { name: string }>)[f]!.name);
export const dishName = (f: string, tier: number): string => T((FAMILIES as Record<string, { tiers: string[] }>)[f]!.tiers[tier - 1]!);
export function itemLabel(c: Cell): string {
  return T("{dish} ({family} tier {tier})", { dish: dishName(c.family, c.tier!), family: familyName(c.family), tier: c.tier! });
}
export const PRACTICE_LABELS: Record<string, string> = { relaxed: N("Relaxed"), standard: N("Standard"), intense: N("Intense") };
export const PRACTICE_SUBS: Record<string, string> = { relaxed: N("No timer, two stations"), standard: N("Five minutes, three stations"), intense: N("Fast orders, all stations") };
export function levelName(level: Level): string {
  if (level.kind === "journey") return level.mastery ? T("Mastery {n}", { n: level.stage! / 8 }) : T("Stage {n}", { n: level.stage! });
  if (level.kind === "daily") return T("Daily {date}", { date: level.date! });
  if (level.kind === "practice") return T("Practice ({difficulty})", { difficulty: T(PRACTICE_LABELS[level.id.slice(9)] || level.id.slice(9)) });
  if (level.kind === "tutorial") { const t = (TUTORIALS as Tutorial[]).find((x) => x.id === level.tutorialId); return t ? T(t.title) : level.id; }
  return T(level.name || level.id);
}
export function levelBlurb(level: Level): string {
  if (level.kind === "journey") {
    if (level.mastery) return T("Limited moves. Serve efficiently.");
    return level.families.length > 1 ? T("New station: {name}", { name: familyName(level.families[level.families.length - 1]!) }) : T("Serve the orders in time.");
  }
  if (level.kind === "daily") return T("Shared seed for everyone today. Highest score wins.");
  if (level.kind === "practice") return T("Unranked. Undo allowed.");
  if (level.kind === "challenge") { const c = (CHALLENGES as { id: string; blurb: string }[]).find((x) => x.id === level.id); return c ? T(c.blurb) : ""; }
  return level.blurb ? T(level.blurb) : "";
}
export function objectiveText(level: Level): string {
  if (level.ordersTarget != null) return T("Serve {n} orders", { n: level.ordersTarget });
  if (level.timeLimit != null) return T("Serve as many orders as you can");
  return T("Free service");
}
export function tutorialLevel(t: Tutorial): Level {
  return { id: t.id, kind: "tutorial", seed: hashString(t.id), cols: 6, rows: 6, theme: "hearth", tutorialId: t.id, ...(t.level as object) } as Level;
}

// ------------------------------------------------------------------ settings
export function saveSettings(): void { store.saveSettings(settings); applySettings(); }
function applySettings(): void {
  render.setColorblind(!!settings.colorblind);
  render.setReducedMotion(preferences().reducedMotion);
}
platform.onAdopt(() => {
  settings = store.getSettings() as Settings;
  applySettings();
});

// ------------------------------------------------------------------ navigation
export function show(screen: Screen, focus: string | null = null): void {
  app.screen = screen;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  ui.setFocus(null);
  render.setActive(screen === "play" && !!app.round);
  const r = app.round;
  if (r && r.session.state.phase === "active") {
    if (screen !== "play") r.session.pause();
    else if (app.overlay !== "pause") r.session.resume();
  }
}
export function goTitle(): void { show("title", "btn-play"); }
export function back(): void {
  if (app.screen === "settings") show(app.settingsReturn, app.settingsReturn === "play" ? null : "btn-settings");
  else if (app.screen === "help") show(app.helpReturn, app.helpReturn === "play" ? null : "btn-help");
  else goTitle();
}
export function openSetup(level: Level, mode: Mode): void {
  app.level = level;
  app.mode = mode;
  show("setup", "btn-start");
}
export function openList(kind: ListKind): void { app.list = kind; show("list", "list-0"); }
export function openDaily(): void { openSetup(dailyLevel(platform.todayIso()) as Level, "daily"); }
export function openScores(): void {
  app.scoresView = "local";
  show("scores", "btn-scores-local");
  app.globalRows = null;
  if (platform.signedIn()) void platform.fetchLeaderboard().then((rows) => { app.globalRows = rows; });
}
export function openHelp(from: Screen): void { app.helpReturn = from; if (from === "play") app.overlay = null; show("help", "btn-back"); }
export function openSettings(from: Screen): void { app.settingsReturn = from; if (from === "play") app.overlay = null; show("settings", "set-theme"); }
export function play(): void {
  const p = store.getProgress() as { tutorialsDone: string[]; journeyStage: number };
  if (p.tutorialsDone.length < TUTORIALS.length) openList("learn");
  else {
    // journeyStage is the next stage to play (1-based); 0 means not started.
    const idx = Math.max(0, Math.min(p.journeyStage, 40) - 1);
    openSetup(JOURNEY_LEVELS[idx] as Level, "journey");
  }
}
export function practice(d: string): void { openSetup(practiceLevel(d) as Level, "practice"); }
export function replayTutorials(): void {
  const p = store.getProgress() as { tutorialsDone: string[] };
  p.tutorialsDone = [];
  store.saveProgress(p);
  toast(T("Tutorials will play again."));
  openList("learn");
}

// ------------------------------------------------------------------ rounds
export function startRound(level: Level, mode: Mode): void {
  endRoundEarly();
  app.level = level;
  app.mode = mode;
  let tutorial: Round["tutorial"] = null;
  if (mode === "tutorial") {
    const t = (TUTORIALS as Tutorial[]).find((x) => x.id === level.tutorialId)!;
    tutorial = { ...t, done: 0 };
  }
  const session = new Session(level, {
    ranked: mode === "daily",
    onEvent: (e: RulesEvent, st: State) => onGameEvent(e, st),
    onChange: () => { if (app.round) render.syncState(app.round.session.state); },
    onEnd: (res: Result) => showResults(res),
  }) as unknown as Sess;
  const r: Round = { session, level, mode, selected: null, hintCells: [], hintMs: 0, tutorial, lessonMs: null, warnedLowTime: false };
  app.round = r;
  app.results = null;
  app.lb = null;
  app.overlay = null;
  app.explained = null;
  render.startBoard(level.theme || settings.theme, level.cols || 6, level.rows || 6, session.state);
  show("play", "cell-0");
  tickMs = 0;
  session.start();
  audio.startRound(level.seed);
  if (tutorial) toast(T(tutorial.brief), 6000);
}
export function endRoundEarly(): void {
  const r = app.round;
  if (r) r.session.stop();
  app.round = null;
  audio.stopRound();
  render.clear();
  render.setActive(false);
}
export function leaveRound(): void { app.overlay = null; endRoundEarly(); goTitle(); }

// ------------------------------------------------------------------ selection and actions
function haptic(ms: number): void { if (settings.haptics) { try { vibrate(ms); } catch { /* no motor */ } } }
export function canAct(): boolean {
  const r = app.round;
  return !!r && app.screen === "play" && !app.overlay && r.session.state.phase === "active" && !r.session.paused;
}
export function setSelected(i: number | null): void {
  const r = app.round!;
  r.selected = i;
  render.setSelection(i);
  if (i != null) {
    const c = r.session.state.board[i];
    if (c && c.kind === "item") announce(T("Selected {item}", { item: itemLabel(c) }));
  }
}
/** Serve: the selected item matches a waiting order. */
export function canServe(): boolean {
  const r = app.round;
  if (!r || r.selected == null) return false;
  const c = r.session.state.board[r.selected];
  return !!c && c.kind === "item" && r.session.state.orders.some((o) => o.family === c.family && o.tier === c.tier);
}
export function hasSelection(): boolean {
  const r = app.round;
  return !!r && r.selected != null && r.session.state.board[r.selected]?.kind === "item";
}
export function canUndo(): boolean { const r = app.round; return !!r && r.session.undoEnabled && r.session.undoStack.length > 0; }
/** Rule refusals arrive as English sentences from rules.js; they translate here. */
function explain(reason: string | undefined): void {
  if (!reason) return;
  app.explained = reason;
  announce(T(reason), true);
  audio.cue("invalid");
}
/** One input → one acknowledged action (js/main.js onCellAction). */
export function cellAction(i: number): void {
  const r = app.round;
  if (!r || !canAct()) return;
  audio.cue("ack");
  const state = r.session.state;
  const c = state.board[i];
  if (c && c.kind === "gen") {
    const res = r.session.command({ kind: "spawn", gen: i });
    if (!res.ok) explain(res.reason);
    return;
  }
  if (r.selected == null) {
    if (c && c.kind === "item") { setSelected(i); audio.cue("select"); }
    return;
  }
  if (r.selected === i) { setSelected(null); return; }
  const sel = state.board[r.selected];
  if (!sel || sel.kind !== "item") { setSelected(c && c.kind === "item" ? i : null); return; }
  if (c && c.kind === "item") {
    const res = r.session.command({ kind: "merge", from: r.selected, to: i });
    if (res.ok) { setSelected(null); return; }
    explain(res.reason);
    setSelected(i); // re-target selection
    return;
  }
  setSelected(null);
}
export function serve(): void {
  const r = app.round;
  if (!r || !canAct() || r.selected == null) return;
  const c = r.session.state.board[r.selected];
  if (!c || c.kind !== "item") return;
  const order = r.session.state.orders.find((o) => o.family === c.family && o.tier === c.tier);
  if (!order) { explain(N("No waiting order matches this dish.")); return; }
  const res = r.session.command({ kind: "submit", cell: r.selected, order: order.id });
  if (res.ok) setSelected(null);
  else explain(res.reason);
}
export function discard(): void {
  const r = app.round;
  if (!r || !canAct() || r.selected == null) return;
  const res = r.session.command({ kind: "trash", cell: r.selected });
  if (res.ok) setSelected(null);
  else explain(res.reason);
}
export function undo(): void {
  const r = app.round;
  if (!r || !canAct()) return;
  if (r.session.undo()) { audio.cue("ack"); announce(T("Undone.")); render.syncState(r.session.state); }
}
export function hint(): void {
  const r = app.round;
  if (!r || !canAct()) return;
  const h = r.session.hint();
  r.hintCells = [];
  const a = h.action;
  if (a) for (const k of [a.gen, a.from, a.to, a.cell]) if (k != null) r.hintCells.push(k);
  r.hintMs = 3000;
  toast(T(h.text));
  announce(T(h.text));
}
export function resetCamera(): void { render.resetCamera(); }

// ------------------------------------------------------------------ events
function onGameEvent(e: RulesEvent, _state: State): void {
  const r = app.round;
  switch (e.type) {
    case "spawn":
      audio.cue("spawn");
      render.burst(e.cell!, 0xffffff, 6);
      break;
    case "merge":
      audio.cue("merge");
      render.burst(e.cell!, 0xffe28a, 14);
      render.shake(0.05);
      if (e.tier! >= 5) unlock("merge_master");
      announce(T("Merged into {dish}", { dish: dishName(e.family!, e.tier!) }));
      break;
    case "submit":
      audio.cue(e.streak! >= 3 ? "streak" : "submit");
      render.burst(e.cell!, 0x8affc0, 20);
      render.shake(0.08);
      announce(e.streak! > 1
        ? T("Served {dish} for {points} points, streak {streak}", { dish: dishName(e.order!.family, e.order!.tier), points: e.gained!, streak: e.streak! })
        : T("Served {dish} for {points} points", { dish: dishName(e.order!.family, e.order!.tier), points: e.gained! }));
      unlock("first_service");
      if (e.streak! >= 5) unlock("hot_streak");
      haptic(20);
      break;
    case "trash": audio.cue("trash"); break;
    case "expire":
      audio.cue("expire");
      announce(T("An order expired."), true);
      break;
    case "new-order":
      audio.cue("arrive");
      announce(T("New order: {dish}", { dish: dishName(e.order!.family, e.order!.tier) }));
      break;
    case "end":
      audio.cue(e.reason === "orders-complete" ? "win" : "lose");
      break;
  }
  if (r?.tutorial && (e.type === "spawn" || e.type === "merge" || e.type === "submit")) tutorialProgress(e.type);
}
function tutorialProgress(kind: string): void {
  const t = app.round?.tutorial;
  if (!t || t.goal.kind !== kind || t.done >= t.goal.count) return;
  t.done++;
  announce(T("{lesson}: {done} of {count}", { lesson: T(t.title), done: t.done, count: t.goal.count }));
  if (t.done >= t.goal.count) {
    const p = store.getProgress() as { tutorialsDone: string[] };
    if (!p.tutorialsDone.includes(t.id)) p.tutorialsDone.push(t.id);
    store.saveProgress(p);
    toast(T("Lesson complete!"));
    app.round!.lessonMs = 800;
  }
}

// ------------------------------------------------------------------ results
function showResults(result: Result): void {
  audio.stopRound();
  const mode = app.mode, level = app.level!;
  if (mode === "tutorial") { markPlayDay(); return; } // lessons end via tutorialProgress
  const newAch = evaluateAchievements();
  let next = false;
  const p = store.getProgress() as { stars: Record<string, number>; masteryStages?: number[]; masteryDone: number; journeyStage: number };
  if (mode === "journey") {
    const stage = level.stage!;
    if (result.reason === "orders-complete" || result.score > 0) {
      const stars = result.score >= level.par! ? 3 : result.score >= level.par! * 0.6 ? 2 : 1;
      p.stars[stage] = Math.max(p.stars[stage] || 0, stars);
      if (level.mastery && !p.masteryStages?.includes?.(stage)) {
        p.masteryStages = p.masteryStages || [];
        p.masteryStages.push(stage);
        p.masteryDone = p.masteryStages.length;
        if (p.masteryDone >= 5) unlock("mastery_five");
      }
      if (stage >= p.journeyStage) p.journeyStage = Math.min(stage + 1, 40);
      store.saveProgress(p);
    }
    next = stage < 40;
  }
  store.saveScore(level.id, {
    score: result.score, fulfilled: result.fulfilled, invalidActions: result.invalidActions,
    ticks: result.ticks, sessionId: result.sessionId, date: new Date(platform.nowMs()).toISOString(),
  });
  app.results = { result, newAch, next };
  postToLeaderboard(result.score, mode);
  markPlayDay();
  app.overlay = "results";
  app.overlayOpened = frame().frame;
  app.focusNext = "btn-retry";
  ui.setFocus(null);
  announce(T("Round over. Total score {score}.", { score: result.score }), true);
}
/** Signed in: a finished journey, daily or challenge round (not practice or lessons) goes to the high-score board. */
function postToLeaderboard(total: number, mode: Mode | null): void {
  app.lb = null;
  if (!platform.signedIn() || !mode || !["journey", "daily", "challenge"].includes(mode)) return;
  app.lb = "posting";
  const results = app.results;
  void platform.postLeaderboard(total).then((p) => { if (app.results === results) app.lb = p; });
}
export function leaderboardLine(): string | null {
  const lb = app.lb;
  if (!lb) return null;
  if (lb === "posting") return T("Posting score to the leaderboard…");
  if (!lb.posted) return T("Score not posted to the leaderboard.");
  return lb.rank ? T("Leaderboard rank: #{rank}", { rank: lb.rank }) : T("Score posted to the leaderboard.");
}
function evaluateAchievements(): string[] {
  const p = store.getProgress() as { achievements: Record<string, { announced: boolean }> };
  const fresh: string[] = [];
  for (const a of ACHIEVEMENTS as { key: string; name: string }[]) {
    if (p.achievements[a.key] && !p.achievements[a.key]!.announced) {
      p.achievements[a.key]!.announced = true;
      fresh.push(a.name);
    }
  }
  store.saveProgress(p);
  return fresh;
}
function unlock(key: string): void {
  const p = store.getProgress() as { achievements: Record<string, unknown> };
  if (!p.achievements[key]) {
    p.achievements[key] = { at: new Date(platform.nowMs()).toISOString(), announced: false };
    store.saveProgress(p);
    const a = (ACHIEVEMENTS as { key: string; name: string }[]).find((x) => x.key === key);
    if (a) toast(T("Achievement: {name}", { name: T(a.name) }));
  }
}
function markPlayDay(): void {
  const p = store.getProgress() as { playDays: string[] };
  const today = platform.todayIso();
  if (!p.playDays.includes(today)) {
    p.playDays.push(today);
    if (p.playDays.length >= 7) unlock("regular");
    store.saveProgress(p);
  }
}
export function retry(): void { const l = app.level, m = app.mode; app.overlay = null; if (l && m) startRound(l, m); }
export function nextStage(): void {
  app.overlay = null;
  const next = JOURNEY_LEVELS[Math.min(app.level!.stage!, 39)] as Level;
  endRoundEarly();
  openSetup(next, "journey");
}
export function resultsTitle(): void { app.overlay = null; endRoundEarly(); goTitle(); }

// ------------------------------------------------------------------ pause
export function openPause(): void {
  const r = app.round;
  if (!r || r.session.state.phase !== "active" || app.overlay || app.screen !== "play") return;
  r.session.pause();
  app.overlay = "pause";
  app.overlayOpened = frame().frame;
  app.focusNext = "btn-resume";
  ui.setFocus(null);
  announce(T("Paused."));
}
export function closePause(): void {
  app.overlay = null;
  app.overlayOpened = frame().frame;
  if (app.round) app.round.session.resume();
  ui.setFocus(null);
}

// ------------------------------------------------------------------ account
export function copyInvite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(T("Invite link copied to clipboard."), 4000); }
  catch { toast(T("Could not copy the invite link: {link}", { link }), 4000); }
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }
platform.onPlayer((signedIn) => { if (!signedIn) toast(T("Signed out of StarHermit. Progress keeps saving on this device."), 4000); });

// ------------------------------------------------------------------ input
onAction((e) => {
  if (!e.pressed) return;
  const fresh = frame().frame !== app.openedFrame && frame().frame !== app.overlayOpened;
  if (app.screen !== "play") {
    // Escape on a sub-screen goes back, as its Back button.
    if ((e.action === "pause" || e.action === "deselect") && fresh && !ui.capturingKeys() && app.screen !== "title") back();
    return;
  }
  if (e.action === "pause") {
    if (!fresh) return;
    if (app.overlay === "pause") closePause();
    else if (!app.overlay) {
      // Escape deselects first, then pauses (the browser build's cell Escape, then its pause key).
      if (app.round?.selected != null && e.source === "keyboard") setSelected(null);
      else openPause();
    }
    return;
  }
  if (!canAct()) return;
  switch (e.action) {
    case "deselect": if (app.round!.selected != null) setSelected(null); break;
    case "serve": serve(); break;
    case "discard": discard(); break;
    case "undo": undo(); break;
    case "hint": hint(); break;
    case "camera": resetCamera(); break;
  }
});

// Board drags (taps and keys go through the cell widgets): a press on a cell
// that moves past 14 px selects its item and drags; the ring follows the cell
// under the pointer and a release on another cell acts on it there. Presses
// are queued and decided after the frame's UI is built, when the grid's
// rectangle is this frame's.
export const grid = { x: 0, y: 0, cell: 0, gap: 0, cols: 0, rows: 0 };
export function cellAt(x: number, y: number): number {
  if (!grid.cols || !grid.cell) return -1;
  const pitch = grid.cell + grid.gap;
  const c = Math.floor((x - grid.x) / pitch), r = Math.floor((y - grid.y) / pitch);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return -1;
  if ((x - grid.x) - c * pitch > grid.cell || (y - grid.y) - r * pitch > grid.cell) return -1;
  return r * grid.cols + c;
}
export const drag = { down: -1, x: 0, y: 0, dragging: false };
let lastTouch = -1e9;
const queued: { kind: "down" | "move" | "up" | "cancel"; x: number; y: number }[] = [];
function boardDown(x: number, y: number): void {
  drag.dragging = false;
  drag.down = canAct() ? cellAt(x, y) : -1;
  drag.x = x; drag.y = y;
}
function boardMove(x: number, y: number): void {
  const r = app.round;
  if (drag.down < 0 || !r) return;
  if (!drag.dragging && Math.hypot(x - drag.x, y - drag.y) > 14 * ui.preferences().scale) {
    drag.dragging = true;
    const c = r.session.state.board[drag.down];
    if (c && c.kind === "item" && canAct()) setSelected(drag.down);
  }
  if (drag.dragging) { const over = cellAt(x, y); render.setGhostTarget(over >= 0 ? over : null); }
}
function boardUp(x: number, y: number, commit: boolean): void {
  const r = app.round;
  render.setGhostTarget(null);
  const from = drag.down, dragged = drag.dragging;
  drag.down = -1;
  drag.dragging = false;
  if (!r || !commit || !dragged || from < 0) return;
  const up = cellAt(x, y);
  if (up >= 0 && up !== from) {
    if (r.selected == null) setSelected(from);
    cellAction(up);
  }
}
export function boardInput(): void {
  for (const q of queued.splice(0)) {
    if (q.kind === "down") boardDown(q.x, q.y);
    else if (q.kind === "move") boardMove(q.x, q.y);
    else boardUp(q.x, q.y, q.kind === "up");
  }
}
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6 || app.screen !== "play") return;
  queued.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y });
});
onPointerMove((x, y) => { if (drag.down >= 0 && now() - lastTouch >= 0.6) queued.push({ kind: "move", x, y }); });
onTouch((e) => {
  if (!e.primary || e.control || app.screen !== "play") return;
  lastTouch = now();
  if (e.phase === "start") queued.push({ kind: "down", x: e.x, y: e.y });
  else if (e.phase === "move") queued.push({ kind: "move", x: e.x, y: e.y });
  else if (e.phase === "end") queued.push({ kind: "up", x: e.x, y: e.y });
  else queued.push({ kind: "cancel", x: e.x, y: e.y });
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}

onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  settings = store.getSettings() as Settings;
  audio.loadSfx();
  applyLook();
  applySettings();
  render.setActive(false);
  goTitle();
});
onPreferencesChange(() => applySettings());
let hidden = false;
onSuspend(() => {
  hidden = true;
  audio.setSuspended(true);
  // A hidden window pauses the round (the browser build's visibilitychange).
  if (app.round && app.screen === "play" && !app.overlay && app.round.session.state.phase === "active") openPause();
  platform.flush();
});
onResume(() => { hidden = false; audio.setSuspended(false); });
onQuit(() => platform.flush());

let tickMs = 0;
onFixedUpdate(() => {
  if (hidden) return;
  const r = app.round;
  if (!r) return;
  if (r.lessonMs !== null) {
    r.lessonMs -= STEP_MS;
    if (r.lessonMs <= 0) { r.lessonMs = null; endRoundEarly(); openList("learn"); return; }
  }
  if (r.hintMs > 0) { r.hintMs -= STEP_MS; if (r.hintMs <= 0) r.hintCells = []; }
  if (r.session.paused || r.session.state.phase !== "active") return;
  tickMs += STEP_MS;
  while (tickMs >= TICK_MS - 1e-6) {
    tickMs -= TICK_MS;
    r.session.tick();
    if (app.round !== r) return;
    // One-shot audible warning the first time a timed round crosses 15 s.
    const s = r.session.state;
    if (s.timeLeft != null) {
      const urgent = Math.ceil(s.timeLeft * TICK_MS / 1000) <= 15;
      if (urgent && !r.warnedLowTime) { r.warnedLowTime = true; audio.cue("warn"); announce(T("Fifteen seconds left."), true); }
      if (!urgent) r.warnedLowTime = false;
    }
  }
});

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  audio.update();
  applyContrast(ui.preferences().highContrast);
  if (app.toast && app.toast.until < now()) app.toast = null;
});
onRender(() => {
  drawScreens();
  boardInput();
  render.update(frameDt);
});
