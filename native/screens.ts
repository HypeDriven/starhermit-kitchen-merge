// The browser build's DOM shell (index.html + js/main.js + css/style.css) as
// starhermit:ui, built every frame: the title card over the key art (Play,
// Daily Challenge, Journey, Practice, Challenges, Scores, How to Play,
// Settings, Invite a friend / Sign in, the profile line), the list picker
// (Learn, Journey, Practice, Challenges), the mode setup card, the round (the
// HUD strip with objective, timer, score, streak pill and pause; the Orders
// rail; the playfield with the kitchen and the cell grid over it; the Actions
// rail with Serve, Discard, Undo, Hint and the last refusal), the pause and
// results dialogs, How to Play, Settings, Scores and the toast. The browser's
// media queries are layouts picked by the window's logical size: wide
// (≥ 1024 px: rails beside the board), stacked (orders strip above, action
// row below) and short landscape (≤ 500 px tall: narrow rails beside the
// board); the left-handed option swaps the rails.
import { frame, openMenu } from "starhermit:engine";
import { bindingLabel, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { totalScore } from "../js/rules.js";
import { CHALLENGES, JOURNEY_LEVELS, THEMES, TUTORIALS } from "../js/content.js";
import { store } from "../js/session.js";
import { N, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import {
  PRACTICE_LABELS, PRACTICE_SUBS, app, back, canServe, canUndo, cellAction, closePause, copyInvite, discard, dishName, drag,
  familyName, grid, hasSelection, hint, itemLabel, leaderboardLine, leaveRound, levelBlurb, levelName, nextStage, objectiveText,
  openDaily, openHelp, openList, openPause, openScores, openSettings, openSetup, play, practice, replayTutorials, resultsTitle,
  retry, saveSettings, serve, settings, show, signIn, startRound, tutorialLevel, undo, type Cell, type Level, type Mode,
} from "./main.ts";
import { ink } from "./style.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  return { lw: Math.max(1, (f.width - sa.left - sa.right) / sc), lh: Math.max(1, (f.height - sa.top - sa.bottom) / sc), sc, ox: sa.left / sc, oy: sa.top / sc };
}
const lastHeight = new Map<string, number>();
const pr = (): ui.UiPreferences => ui.preferences();
function textWidth(text: string, style: string | readonly string[], kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: typeof style === "string" ? style : [...style] }).width / pr().scale;
}
const buttonWidth = (text: string, style: readonly string[]): number => textWidth(text, style, "button") + 4;
const detailed = (): boolean => frame().quality !== "low" && !pr().highContrast;

interface Btn { id: string; text: string; style?: string[]; disabled?: boolean; act: () => void; label?: string }
const PLAIN = ["btn"];
/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null = null): void {
  const style = b.style ?? PLAIN;
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  let s: ui.Style = width != null ? { width } : {};
  // A tight button (four actions in a phone's row) narrows its side padding before its label wraps.
  if (width != null && !b.label && buttonWidth(b.text, style) > width && textWidth(b.text, style, "button") - 24 <= width) {
    s = { width, padding: { top: 10, bottom: 10, start: 6, end: 6 } };
  } else if (b.label) opts.content = () => { ui.style({ text: { align: "center" } }).label(b.text); };
  else if (width != null && buttonWidth(b.text, style) > width) {
    const inner = Math.max(20, width - 36);
    opts.content = () => { ui.style({ text: { align: "center" } }).paragraph(b.text, inner); };
  }
  if (ui.style(...style, s).id(b.id).button(b.label ?? b.text, opts)) b.act();
}
/** Buttons at their own widths in rows that wrap at `width` (CSS flex-wrap). */
function flow(label: string, list: Btn[], width: number, gap = 10): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  for (const b of list) {
    const bw = Math.min(width, buttonWidth(b.text, b.style ?? PLAIN));
    if (rows[rows.length - 1]!.length && used + gap + bw > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + bw;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button(b, buttonWidth(b.text, b.style ?? PLAIN) > width ? width : null);
    }, { spacing: gap, align: "center" }));
  }, { spacing: gap, width });
}
/** Buttons in rows of equal width (a menu column, or a row of `perRow`). */
function menu(label: string, list: Btn[], width: number, perRow = 1, gap = 10): void {
  ui.column(label, () => {
    for (let i = 0; i < list.length; i += perRow) {
      const row = list.slice(i, i + perRow);
      const bw = (width - gap * (perRow - 1)) / perRow;
      ui.row(`${label}-r${i}`, () => { for (const b of row) button(b, bw); }, { spacing: gap });
    }
  }, { spacing: gap, width });
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "body", id?: string, center = false): void {
  if (!text) return;
  const styles: (string | ui.Style)[] = [cls];
  if (center) styles.push({ text: { align: "center" } });
  let u = ui.style(...styles);
  if (id) u = u.id(id);
  if (ui.measureText(text, { style: styles }).width / pr().scale <= width) u.label(text);
  else u.paragraph(text, width);
}
function heading(cls: string, text: string, width: number, id?: string): void {
  if (ui.measureText(text, { kind: "heading", style: [cls] }).width / pr().scale <= width) (id ? ui.id(id) : ui).style(cls).heading(text);
  else ui.style(cls).paragraph(text, width);
}
const keyName = (action: string): string => bindingLabel(action, "keyboard") || "—";

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  const L = layoutNow();
  const f = frame();
  const P = ink(pr().highContrast);
  grid.cols = 0;
  if (app.screen !== "play") draw.rect(0, 0, f.width, f.height, P.bg);
  switch (app.screen) {
    case "title": titleScreen(L); break;
    case "setup": setupScreen(L); break;
    case "list": listScreen(L); break;
    case "help": helpScreen(L); break;
    case "settings": settingsScreen(L); break;
    case "scores": scoresScreen(L); break;
    case "play": playScreen(L); break;
  }
  if (app.screen === "play") overlays(L);
  toast(L);
  const opened = app.overlay ? app.overlayOpened : app.openedFrame;
  if (app.focusNext) {
    const age = f.frame - opened;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

/** A centred card (`.title-card` / `.panel`, `.panel.wide`), scrolling with the screen when taller than the window. */
function card(key: string, L: Layout, maxW: number, cls: string, build: (w: number) => void): void {
  const pad = 16;
  const cw = Math.min(maxW, L.lw * (maxW > 600 ? 0.94 : 0.92), L.lw - 2 * pad);
  const inner = cw - 56 - 2;
  const avail = L.lh - 2 * pad;
  const h = lastHeight.get(key) ?? 0;
  const scroll = h > avail;
  const fresh = frame().frame - app.openedFrame <= 5;
  ui.place(`page-${key}`, { anchor: "top-start", x: L.ox, y: L.oy }, () => {
    const body = (): void => {
      const r = ui.column(`${key}-card`, () => build(inner), { style: cls, width: cw, spacing: 0 });
      lastHeight.set(key, r.height / L.sc);
    };
    if (scroll) {
      ui.scrollArea(`${key}-scroll`, { width: L.lw, height: L.lh }, () => ui.column(`${key}-sc`, body, { width: L.lw - 12, align: "center", padding: { top: pad, bottom: pad } }), fresh ? { scrollTo: { top: 0 } } : undefined);
    } else {
      ui.column(`${key}-outer`, body, { width: L.lw, height: L.lh, align: "center", justify: "center" });
    }
  }, { width: L.lw });
}
const gapV = (n: number): void => { ui.widget("", { role: "none", size: { width: 1, height: n } }); };

// ------------------------------------------------------------------ title
function titleScreen(L: Layout): void {
  const f = frame();
  const hc = pr().highContrast;
  if (!hc) {
    // The key art behind a dark scrim (#screen-title), and the slow lamp glow when animated.
    draw.box(0, 0, f.width, f.height, {
      background: [
        { type: "linear", stops: [{ color: "#17110de0" }, { color: "#17110df2" }] },
        { image: "assets/title-keyart.webp", size: "cover", position: { x: 0.5, y: 0.62 } },
        "#17110d",
      ],
    });
    if (detailed() && !pr().reducedMotion) {
      const k = (Math.sin(f.time * Math.PI / 7) + 1) / 2;
      const dy = (k - 0.5) * 0.03 * f.height;
      draw.box(0, dy, f.width, f.height, {
        opacity: 0.55 + 0.45 * k,
        background: { type: "radial", center: { x: 0.5, y: 0.4 }, radius: { x: 0.4, y: 0.35 }, stops: [{ color: "#e8a04c22" }, { color: "#e8a04c00", at: 0.7 }] },
      });
    }
  }
  const p = store.getProgress() as { journeyStage: number };
  card("title", L, 560, "title-card", (w) => {
    ui.style(detailed() ? "title-glow" : "title").id("title-heading").heading("Kitchen Merge");
    gapV(4);
    para(T("Generate, merge, serve. A welcoming open kitchen."), w, "tagline", "tagline");
    gapV(16);
    const journeyPill = p.journeyStage > 0 ? T("Stage {n}/40", { n: Math.min(p.journeyStage, 40) }) : "";
    const list: Btn[] = [
      { id: "btn-play", text: T("Play"), style: ["primary", "big"], act: play },
      { id: "btn-daily", text: T("Daily Challenge"), act: openDaily },
      { id: "btn-journey", text: T("Journey") + (journeyPill ? ` — ${journeyPill}` : ""), act: () => openList("journey") },
      { id: "btn-practice", text: T("Practice"), act: () => openList("practice") },
      { id: "btn-challenge", text: T("Challenges"), act: () => openList("challenges") },
      { id: "btn-scores", text: T("Scores"), act: openScores },
      { id: "btn-help", text: T("How to Play"), act: () => openHelp("title") },
      { id: "btn-settings", text: T("Settings"), act: () => openSettings("title") },
    ];
    if (platform.inviteLink()) list.push({ id: "btn-invite", text: T("Invite a friend"), act: copyInvite });
    if (!platform.signedIn()) list.push({ id: "btn-signin", text: T("Sign in with StarHermit"), act: signIn });
    ui.column("title-menu", () => {
      for (const b of list) {
        if (b.id === "btn-journey" && journeyPill) {
          // The journey status pill inside the button (#journey-status).
          if (ui.style("btn", { width: w }).id(b.id).button(b.text, {
            content: () => ui.row("journey-face", () => { ui.label(T("Journey")); ui.style("pill").label(journeyPill); }, { spacing: 8, align: "center" }),
          })) b.act();
        } else button(b, w);
      }
    }, { spacing: 10, width: w });
    gapV(12);
    const sync: Record<string, string> = {
      synced: N("Cloud save: synced"), saving: N("Cloud save: saving…"), error: N("Cloud save unreachable — progress is safe on this device"),
    };
    const st = platform.syncState();
    const line = platform.signedIn()
      ? T("Playing as {name} — {status}", { name: platform.displayName() || "…", status: sync[st] ? T(sync[st]!) : T("Signed in.") })
      : T("Guest profile — progress is stored on this device.");
    para(line, w, "muted", "profile-line", true);
  });
}

// ------------------------------------------------------------------ list, setup
function listItems(): { label: string; sub: string; locked: boolean; act: () => void }[] {
  const p = store.getProgress() as { tutorialsDone: string[]; journeyStage: number; stars: Record<string, number> };
  switch (app.list) {
    case "learn":
      return (TUTORIALS as { id: string; title: string; brief: string; level: object }[]).map((t) => ({
        label: T(t.title) + (p.tutorialsDone.includes(t.id) ? " ✓" : ""),
        sub: T(t.brief).slice(0, 60) + "…",
        locked: false,
        act: () => openSetup(tutorialLevel(t as never), "tutorial"),
      }));
    case "journey":
      return (JOURNEY_LEVELS as Level[]).map((l) => {
        const locked = l.stage! > Math.max(1, p.journeyStage);
        const stars = p.stars[l.stage!] || 0;
        return {
          label: (l.mastery ? "★ " : "") + levelName(l) + (stars ? " " + "★".repeat(stars) : ""),
          sub: locked ? T("Locked") : levelBlurb(l), locked, act: () => openSetup(l, "journey"),
        };
      });
    case "practice":
      return ["relaxed", "standard", "intense"].map((d) => ({ label: T(PRACTICE_LABELS[d]!), sub: T(PRACTICE_SUBS[d]!), locked: false, act: () => practice(d) }));
    default:
      return (CHALLENGES as { name: string; blurb: string; level: Level }[]).map((c) => ({
        label: T(c.name), sub: T(c.blurb), locked: false, act: () => openSetup(c.level, "challenge"),
      }));
  }
}
const LIST_TITLES: Record<string, string> = { learn: N("Learn"), journey: N("Journey"), practice: N("Practice"), challenges: N("Challenges") };
function listScreen(L: Layout): void {
  const items = listItems();
  card("list", L, 720, "panel", (w) => {
    heading("h2", T(LIST_TITLES[app.list]!), w, "list-heading");
    gapV(12);
    const gap = 10;
    const lwid = w - 14; // room for the scroll bar
    const cols = Math.max(1, Math.floor((lwid + gap) / (150 + gap)));
    const cw = (lwid - gap * (cols - 1)) / cols;
    const body = (): void => {
      ui.column("list-items", () => {
        for (let i = 0; i < items.length; i += cols) {
          ui.row(`list-r${i}`, () => {
            for (let j = i; j < Math.min(items.length, i + cols); j++) {
              const it = items[j]!;
              const inner = cw - 30;
              if (ui.style("list-btn", { width: cw }).id(`list-${j}`).button(`${it.label}. ${it.sub}`, {
                ...(it.locked ? { disabled: true } : {}),
                content: () => ui.column(`li-${j}`, () => { para(it.label, inner, "list-label"); para(it.sub, inner, "list-sub"); }, { spacing: 2, width: inner }),
              })) it.act();
            }
          }, { spacing: gap, align: "stretch" });
        }
      }, { spacing: gap, width: lwid });
    };
    // .list: max-height 60vh, scrolling.
    const maxH = Math.max(160, L.lh * 0.6);
    const h = lastHeight.get("list-items") ?? 0;
    const fresh = frame().frame - app.openedFrame <= 5;
    if (h > maxH) ui.scrollArea("list-scroll", { width: w, height: maxH }, () => { const r = ui.column("list-measure", body); lastHeight.set("list-items", r.height / L.sc); }, fresh ? { scrollTo: { top: 0 } } : undefined);
    else { const r = ui.column("list-measure", body); lastHeight.set("list-items", r.height / L.sc); }
    gapV(16);
    flow("list-back", [{ id: "btn-back", text: T("Back"), act: () => { show("title", "btn-play"); } }], w);
  });
}
function setupScreen(L: Layout): void {
  const level = app.level, mode = app.mode;
  if (!level || !mode) { show("title"); return; }
  card("setup", L, 560, "panel", (w) => {
    heading("h2", T("Mode Setup"), w, "setup-heading");
    gapV(12);
    ui.column("setup-details", () => {
      para(levelName(level), w, "strong", "setup-name");
      const blurb = mode === "tutorial" ? "" : levelBlurb(level);
      if (blurb) para(blurb, w);
      para(T("Stations: {list}. Board: {cols}×{rows}.", { list: level.families.map(familyName).join(", "), cols: level.cols || 6, rows: level.rows || 6 }), w);
      const dur: string[] = [];
      if (level.timeLimit != null) dur.push(T("{n}s time limit", { n: Math.round(level.timeLimit / 10) }));
      if (level.moveLimit != null) dur.push(T("{n} moves", { n: level.moveLimit }));
      if (level.ordersTarget != null) dur.push(T("serve {n} orders", { n: level.ordersTarget }));
      para(dur.join(" · ") || T("No time pressure"), w);
      para(mode === "daily" ? T("Ranked — validated on the daily board.") : mode === "practice" ? T("Unranked practice. Undo enabled.") : T("Solo progression."), w);
      if (mode === "tutorial") {
        const t = (TUTORIALS as { id: string; brief: string }[]).find((x) => x.id === level.tutorialId);
        if (t) para(T(t.brief), w);
      }
    }, { spacing: 12, width: w });
    gapV(16);
    flow("setup-row", [
      { id: "btn-start", text: T("Start"), style: ["primary"], act: () => startRound(level, mode as Mode) },
      { id: "btn-back", text: T("Back"), act: () => show("title", "btn-play") },
    ], w);
  });
}

// ------------------------------------------------------------------ help, settings, scores
function helpScreen(L: Layout): void {
  card("help", L, 720, "panel", (w) => {
    heading("h2", T("How to Play"), w, "help-heading");
    gapV(12);
    const controls = T("Pointer or touch: tap to select, tap target to act. Keyboard: arrow keys move focus, Enter selects, {serve} serves, {discard} discards, {undo} undoes (practice), {hint} hints, {pause} pauses, {camera} resets the camera.", {
      serve: keyName("serve"), discard: keyName("discard"), undo: keyName("undo"), hint: keyName("hint"), pause: keyName("pause"), camera: keyName("camera"),
    });
    const cards: [string, string][] = [
      [T("Generate"), T("Tap a station (round base with a glowing item) to produce a tier-1 ingredient on a free cell.")],
      [T("Merge"), T("Select an item, then select an identical item to merge them into the next tier. Chains run from tier 1 up to tier 5.")],
      [T("Serve"), T("When a dish matches a customer order, select it and press Serve before the order expires. Quick consecutive serves build a streak bonus.")],
      [T("Efficiency"), T("Empty board cells at round end add an efficiency bonus. Discard clutter with Discard.")],
      [T("Controls"), controls],
    ];
    const gap = 12;
    const cols = Math.max(1, Math.floor((w + gap) / (200 + gap)));
    const cw = (w - gap * (cols - 1)) / cols;
    ui.column("help-cards", () => {
      for (let i = 0; i < cards.length; i += cols) {
        ui.row(`help-r${i}`, () => {
          for (let j = i; j < Math.min(cards.length, i + cols); j++) {
            const [h, t] = cards[j]!;
            ui.column(`help-${j}`, () => { para(h, cw - 28, "h3"); para(t, cw - 28, "card-text"); }, { style: "card", width: cw, spacing: 6 });
          }
        }, { spacing: gap, align: "stretch" });
      }
    }, { spacing: gap, width: w });
    gapV(16);
    flow("help-back", [{ id: "btn-back", text: T("Back"), act: back }], w);
  });
}
function group(id: string, title: string, w: number, build: (inner: number) => void): void {
  ui.column(id, () => { para(title, w - 30, "legend"); build(w - 30); }, { style: "group", width: w, spacing: 8 });
}
function toggle(key: "colorblind" | "leftHanded" | "haptics", label: string): void {
  const cur = !!settings[key];
  const next = ui.id(`set-${key}`).checkbox(T(label), cur);
  if (next !== cur) { settings[key] = next; saveSettings(); }
}
function settingsScreen(L: Layout): void {
  card("settings", L, 720, "panel", (w) => {
    heading("h2", T("Settings"), w, "settings-heading");
    gapV(12);
    const gap = 14;
    const cols = w >= 2 * 220 + gap ? 2 : 1;
    const gw = (w - gap * (cols - 1)) / cols;
    const groups: (() => void)[] = [
      () => group("set-audio", T("Audio"), gw, (inner) => {
        para(T("Volumes, mute, graphics quality, language, reduced motion, high contrast and text size are in the StarHermit Options."), inner, "muted");
        flow("set-options", [{ id: "btn-options", text: T("Open Options"), act: () => openMenu() }], inner);
      }),
      () => group("set-gfx", T("Graphics"), gw, (inner) => {
        const ids = THEMES.map((t) => t.id);
        const cur = Math.max(0, ids.indexOf(settings.theme));
        ui.row("theme-row", () => {
          para(T("Theme"), Math.max(60, inner * 0.35));
          ui.spacer();
          const next = ui.style({ width: Math.min(220, inner * 0.62) }).id("set-theme").select(T("Theme"), cur, THEMES.map((t) => T(t.name)));
          if (next !== cur) { settings.theme = ids[next]!; saveSettings(); }
        }, { width: inner, align: "center", spacing: 10 });
      }),
      () => group("set-a11y", T("Accessibility"), gw, (inner) => {
        toggle("colorblind", N("Color-vision palette"));
        toggle("leftHanded", N("Left-handed controls"));
        toggle("haptics", N("Haptics"));
        flow("set-a11y-btns", [
          { id: "btn-replay-tutorial", text: T("Replay tutorials"), style: ["small-btn"], act: replayTutorials },
          { id: "btn-rebind", text: T("Change keys and buttons"), style: ["small-btn"], act: () => requestRebind() },
        ], inner, 8);
      }),
    ];
    ui.column("settings-grid", () => {
      for (let i = 0; i < groups.length; i += cols) {
        ui.row(`set-r${i}`, () => { for (let j = i; j < Math.min(groups.length, i + cols); j++) groups[j]!(); }, { spacing: gap, align: "stretch" });
      }
    }, { spacing: gap, width: w });
    gapV(16);
    flow("settings-back", [{ id: "btn-back", text: T("Back"), act: back }], w);
  });
}
/** A table of text cells (the browser build built it with textContent: other players' names are never markup). */
function table(id: string, w: number, head: string[], rows: string[][], widths: number[]): void {
  const cols = widths.map((k) => k * w);
  const row = (rid: string, cells: string[], cls: string): void => {
    ui.row(rid, () => cells.forEach((c, i) => ui.column(`${rid}-${i}`, () => para(c, cols[i]! - 10, cls), { width: cols[i]!, padding: { start: 4 } })), { style: "score-row", width: w, align: "center" });
  };
  ui.column(id, () => {
    row(`${id}-h`, head, "score-th");
    rows.forEach((r, i) => row(`${id}-${i}`, r, "body"));
  }, { spacing: 0, width: w });
}
function scoresScreen(L: Layout): void {
  card("scores", L, 720, "panel", (w) => {
    heading("h2", T("Scores"), w, "scores-heading");
    gapV(4);
    flow("scores-tabs", [
      { id: "btn-scores-local", text: T("Local"), style: [app.scoresView === "local" ? "small-on" : "small-btn"], act: () => { app.scoresView = "local"; } },
      { id: "btn-scores-global", text: T("Global (daily)"), style: [app.scoresView === "global" ? "small-on" : "small-btn"], act: () => { app.scoresView = "global"; } },
    ], w);
    gapV(12);
    ui.column("scores-list", () => {
      if (app.scoresView === "local") {
        const all = store.getScores() as Record<string, { sessionId: string; score: number; fulfilled: number; date: string }[]>;
        const ids = Object.keys(all).sort();
        if (!ids.length) para(T("No scores yet — play a round!"), w, "muted");
        for (const id of ids) {
          table(`t-${id}`, w, [id, T("Score"), T("Served"), T("When")],
            all[id]!.slice(0, 5).map((e) => [String(e.sessionId).slice(0, 6), String(e.score), String(e.fulfilled), String(e.date).slice(0, 10)]), [0.4, 0.2, 0.18, 0.22]);
        }
      } else {
        const rows = app.globalRows ?? [];
        if (!rows.length) para(T("No global scores available (offline or empty board)."), w, "muted");
        else table("t-global", w, ["#", T("Player"), T("Score"), T("Validated")], rows.map((e) => [String(e.rank), e.name, String(e.score), "—"]), [0.12, 0.48, 0.2, 0.2]);
      }
    }, { spacing: 12, width: w });
    gapV(16);
    flow("scores-back", [{ id: "btn-back", text: T("Back"), act: () => show("title", "btn-scores") }], w);
  });
}

// ------------------------------------------------------------------ the round
type PlayKind = "wide" | "stacked" | "land";
function playKind(L: Layout): PlayKind {
  // Short landscape windows (the old ≤ 500 px breakpoint, and landscape tablets too short for the
  // stacked rails above and below 44 px cells) keep the rails beside the board.
  if (L.lw > L.lh && (L.lh <= 500 || (L.lw < 1024 && L.lh < 720))) return "land";
  return L.lw >= 1024 ? "wide" : "stacked";
}
function hud(L: Layout): number {
  const r = app.round!;
  const s = r.session.state;
  const P = ink(pr().highContrast);
  let timer = "", urgent = false;
  if (s.timeLeft != null) {
    const secs = Math.ceil(s.timeLeft * 100 / 1000);
    timer = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
    urgent = secs <= 15;
  } else if (s.movesLeft != null) { timer = T("{n} moves", { n: s.movesLeft }); urgent = s.movesLeft <= 5; }
  const phone = L.lw <= 640 && L.lh > L.lw;
  const res = ui.place("hud", { anchor: "top-start", x: L.ox, y: L.oy }, () => {
    ui.row("hud-row", () => {
      ui.column("hud-left", () => {
        ui.style("hud-title", phone ? { text: { size: 13.6 } } : {}).id("hud-objective").label(objectiveText(r.level));
        if (timer) ui.style(urgent ? "hud-urgent" : "hud-timer").id("hud-timer").label(timer);
      }, { spacing: 2 });
      ui.spacer();
      ui.row("hud-score", () => {
        ui.style("hud-score").id("hud-score").label(String(totalScore(s)));
        if (s.streak >= 2) ui.style("pill").id("hud-streak").label(T("Streak x{n}", { n: s.streak }));
      }, { spacing: 8, align: "center" });
      ui.spacer();
      if (ui.style("small-btn").id("btn-pause").button(T("Pause"), { content: () => ui.style({ text: { color: P.text } }).label("II") })) openPause();
    }, { width: L.lw - 24, align: "center", spacing: 12 });
  }, { style: "hud", width: L.lw, ...(L.oy > 0 ? {} : {}) });
  return Math.max(52, res.height / L.sc);
}
function ordersRail(w: number, strip: boolean): void {
  const s = app.round!.session.state;
  para(T("Orders").toLocaleUpperCase(), w, "rail-title");
  const chipMin = strip ? (w < 400 ? 110 : 130) : w;
  const per = strip ? Math.max(1, Math.floor((w + 8) / (chipMin + 8))) : 1;
  const cw = strip ? (w - 8 * (per - 1)) / per : w;
  const chips = s.orders.map((o, i) => () => {
    const name = dishName(o.family, o.tier);
    const exp = o.timeLeft < 100;
    ui.id(`order-${i}`).widget(T("Order: {name}, value {value}, {n} seconds left", { name, value: o.value, n: Math.ceil(o.timeLeft / 10) }), {
      role: "image", size: { width: cw, height: 52 },
      draw: (q, st) => {
        const k = st.scale;
        const P = ink(st.highContrast);
        draw.roundRect(q.x, q.y, q.width, q.height, 10 * k, P.panel2);
        draw.roundRect(q.x, q.y, 4 * k, q.height, 2 * k, exp ? P.danger : P.accent);
        const vw = draw.measureText(String(o.value), { size: 16 * k }).width;
        draw.text(name, q.x + 14 * k, q.y + 8 * k, { size: 16 * k, weight: "700", color: P.text, clip: { x: q.x, y: q.y, width: q.width - vw - 20 * k, height: q.height } });
        draw.text(String(o.value), q.x + q.width - 10 * k, q.y + 8 * k, { size: 16 * k, color: P.accent, align: "end" });
        const bx = q.x + 14 * k, bw = q.width - 24 * k, by = q.y + q.height - 14 * k;
        draw.roundRect(bx, by, bw, 6 * k, 3 * k, "#00000055");
        const f = Math.max(0, o.timeLeft / o.maxTime);
        if (f > 0) draw.roundRect(bx, by, Math.max(6 * k * Math.min(1, f * 10), bw * f), 6 * k, 3 * k, exp ? P.danger : P.accent2);
      },
    });
  });
  ui.column("orders", () => {
    for (let i = 0; i < chips.length; i += per) ui.row(`orders-r${i}`, () => { for (const c of chips.slice(i, i + per)) c(); }, { spacing: 8 });
  }, { spacing: 8, width: w });
  const prog = s.ordersTarget != null ? T("Orders: {done}/{target}", { done: s.fulfilled, target: s.ordersTarget }) : T("Served: {n}", { n: s.fulfilled });
  para(prog, w, "muted", "hud-progress");
}
function actionButtons(): Btn[] {
  return [
    { id: "btn-serve", text: T("Serve"), style: ["primary"], disabled: !canServe(), act: serve },
    { id: "btn-trash", text: T("Discard"), disabled: !hasSelection(), act: discard },
    { id: "btn-undo", text: T("Undo"), disabled: !canUndo(), act: undo },
    { id: "btn-hint", text: T("Hint"), act: hint },
  ];
}
function actionsRail(w: number, row: boolean): void {
  para(T("Actions").toLocaleUpperCase(), w, "rail-title");
  if (row) menu("action-tray", actionButtons(), w, 4, 8);
  else menu("action-tray", actionButtons(), w, 1, 8);
  if (app.explained) para(T(app.explained), w, "muted", "action-explain");
}
/** A rail of fixed size whose content scrolls when taller. */
function rail(id: string, x: number, y: number, w: number, h: number | null, build: (w: number) => void): number {
  const pad = 10;
  const ch = lastHeight.get(id) ?? 0;
  const r = ui.place(id, { anchor: "top-start", x, y }, () => {
    const inner = (): void => {
      const c = ui.column(`${id}-in`, () => build(w - 2 * pad - (h != null && ch > h ? 12 : 0)), { spacing: 8 });
      lastHeight.set(id, c.height / pr().scale + 2 * pad);
    };
    ui.column(`${id}-col`, () => {
      if (h != null && ch > h) ui.scrollArea(`${id}-scroll`, { width: w - 2 * pad, height: h - 2 * pad }, inner);
      else inner();
    }, { style: "rail", width: w, ...(h != null ? { height: h } : {}) });
  }, { width: w });
  return r.height / pr().scale;
}

function playScreen(L: Layout): void {
  const r = app.round;
  if (!r) { show("title"); return; }
  const f = frame();
  const P = ink(pr().highContrast);
  const kind = playKind(L);
  const top = hud(L);
  const pad = kind === "stacked" && L.lw <= 640 ? 4 : 8;
  let x0 = pad, x1 = L.lw - pad, y0 = top + pad, y1 = L.lh - pad;
  const left = !settings.leftHanded;
  if (kind === "wide" || kind === "land") {
    const lw = kind === "wide" ? Math.min(220, Math.max(150, L.lw * 0.17)) : Math.min(170, Math.max(120, L.lw * 0.17));
    const rw = kind === "wide" ? lw : Math.min(180, Math.max(130, L.lw * 0.18));
    const h = y1 - y0;
    const ordersW = lw, actionsW = rw;
    const ox = L.ox, oy = L.oy;
    if (left) {
      rail("rail-left", ox + x0, oy + y0, ordersW, h, (w) => ordersRail(w, false));
      rail("rail-right", ox + x1 - actionsW, oy + y0, actionsW, h, (w) => actionsRail(w, false));
      x0 += ordersW + pad; x1 -= actionsW + pad;
    } else {
      rail("rail-right", ox + x0, oy + y0, actionsW, h, (w) => actionsRail(w, false));
      rail("rail-left", ox + x1 - ordersW, oy + y0, ordersW, h, (w) => ordersRail(w, false));
      x0 += actionsW + pad; x1 -= ordersW + pad;
    }
  } else {
    const w = x1 - x0;
    const oh = rail("rail-left", L.ox + x0, L.oy + y0, w, null, (iw) => ordersRail(iw, true));
    y0 += oh + pad;
    const ah = lastHeight.get("rail-right") ?? 120;
    rail("rail-right", L.ox + x0, L.oy + y1 - ah, w, null, (iw) => actionsRail(iw, true));
    y1 -= ah + pad;
  }
  // The playfield: the kitchen behind, the page colour around it.
  const sc = L.sc;
  const X = (L.ox + x0) * sc, Y = (L.oy + y0) * sc, Wd = Math.max(1, (x1 - x0) * sc), Hd = Math.max(1, (y1 - y0) * sc);
  const band = (x: number, y: number, w: number, h: number): void => { if (w > 0.5 && h > 0.5) draw.rect(x, y, w, h, P.bg); };
  band(0, 0, f.width, Y);
  band(0, Y + Hd, f.width, f.height - Y - Hd);
  band(0, Y, X, Hd);
  band(X + Wd, Y, f.width - X - Wd, Hd);
  board(x0, y0, x1 - x0, y1 - y0, L);
}

const GLYPHS: Record<string, string> = { grain: "▬", garden: "●", dairy: "▮", ember: "▲" };
const FAM_CSS: Record<string, string> = { grain: "#d9b36a", garden: "#6fbf5a", dairy: "#f2ead2", ember: "#d96a4a" };
const FAM_CSS_CB: Record<string, string> = { grain: "#ddcc77", garden: "#44aa99", dairy: "#f2f2f2", ember: "#cc6677" };
/** The cell grid over the kitchen (the browser build's #board-dom): a labelled button per cell. */
function board(x: number, y: number, w: number, h: number, L: Layout): void {
  const r = app.round!;
  const st = r.session.state;
  const { cols, rows } = st;
  const gap = 4;
  // fitBoard: square cells (at least 44 px), centred, 12 px of padding; the 3D board spans pitch × cols.
  const pitch = Math.max(44 + gap, Math.floor(Math.min((w - 24) / cols, (h - 24) / rows)));
  const cell = pitch - gap;
  const gw = cols * pitch - gap, gh = rows * pitch - gap;
  const gx = x + (w - gw) / 2, gy = y + (h - gh) / 2;
  const sc = L.sc;
  const f = frame();
  render.setGrid((L.ox + gx + gw / 2) * sc, (L.oy + gy + gh / 2) * sc, cols * pitch * sc, f.width, f.height);
  grid.x = (L.ox + gx) * sc; grid.y = (L.oy + gy) * sc; grid.cell = cell * sc; grid.gap = gap * sc; grid.cols = cols; grid.rows = rows;
  const hints = new Set(r.hintCells);
  const famColors = settings.colorblind ? FAM_CSS_CB : FAM_CSS;
  ui.place("board", { anchor: "top-start", x: L.ox + gx, y: L.oy + gy }, () => {
    ui.grid("board-grid", () => {
      for (let i = 0; i < cols * rows; i++) {
        const c = st.board[i] as Cell | null;
        const label = !c ? T("Empty cell {n}", { n: i + 1 })
          : c.kind === "gen" ? T("{family} station, cell {n}. Activate to generate.", { family: familyName(c.family), n: i + 1 })
            : T("{item}, cell {n}", { item: itemLabel(c), n: i + 1 });
        const match = !!c && c.kind === "item" && st.orders.some((o) => o.family === c.family && o.tier === c.tier);
        const res = ui.id(`cell-${i}`).widget(label, {
          role: "button", size: { width: cell, height: cell },
          draw: (q, s) => drawCell(q, s, c, i === r.selected, hints.has(i), match, famColors),
        });
        // A drag that ended on this cell already acted (the browser build swallowed its click).
        if (res.activated && !drag.dragging) cellAction(i);
      }
    }, { columns: Array.from({ length: cols }, () => cell), gap });
  });
}
function drawCell(q: ui.Rect, s: ui.WidgetState, c: Cell | null, selected: boolean, hinted: boolean, match: boolean, fam: Record<string, string>): void {
  const k = s.scale;
  const P = ink(s.highContrast);
  const rad = 10 * k;
  if (c) {
    const bg = c.kind === "gen" ? "#ffffff14" : match ? "#2f6b3f88" : "#00000070";
    draw.roundRect(q.x, q.y, q.width, q.height, rad, bg);
  }
  const col = c ? fam[c.family] ?? "#888888" : "#888888";
  if (c?.kind === "gen") draw.strokeRoundRect(q.x, q.y, q.width, q.height, rad, col, 2 * k);
  else draw.strokeRoundRect(q.x, q.y, q.width, q.height, rad, "#ffffff22", k);
  if (c?.kind === "item") {
    // The family colour along the cell's bottom edge (inset 0 -3px).
    draw.roundRect(q.x + rad * 0.6, q.y + q.height - 3 * k, q.width - rad * 1.2, 3 * k, 1.5 * k, col);
  }
  if (selected) draw.strokeRoundRect(q.x - 1 * k, q.y - 1 * k, q.width + 2 * k, q.height + 2 * k, rad, P.focus, 3 * k);
  else if (hinted) draw.strokeRoundRect(q.x - 1 * k, q.y - 1 * k, q.width + 2 * k, q.height + 2 * k, rad, P.accent2, 3 * k);
  if (!c) return;
  const shadow = { color: "#000000", x: 0, y: k };
  const lines: { text: string; size: number; color: string }[] = [{ text: GLYPHS[c.family] ?? "?", size: 18.4, color: P.text }];
  if (c.kind === "gen") lines.push({ text: T("{family} station", { family: familyName(c.family) }), size: 11.5, color: P.text });
  else {
    lines.push({ text: dishName(c.family, c.tier!), size: 11.5, color: P.text });
    lines.push({ text: "T" + c.tier, size: 10, color: P.muted });
  }
  const ts = s.highContrast ? 1 : 1;
  const maxW = q.width - 4 * k;
  const sized = lines.map((l) => {
    let size = Math.max(10, l.size) * k * ts * pr().textScale;
    // Lines wrap at words (CSS); a word wider than the cell shrinks instead of breaking.
    const widest = Math.max(...l.text.split(/\s+/).map((wd) => draw.measureText(wd, { size }).width));
    if (widest > maxW) size *= maxW / widest;
    const m = draw.measureText(l.text, { size, maxWidth: maxW });
    return { ...l, size, h: m.height };
  });
  const total = sized.reduce((a, l) => a + l.h, 0);
  let ty = q.y + (q.height - total) / 2;
  for (const l of sized) {
    draw.text(l.text, q.x + q.width / 2, ty, { size: l.size, color: l.color, align: "center", maxWidth: maxW, shadow, clip: { x: q.x, y: q.y, width: q.width, height: q.height } });
    ty += l.h;
  }
}

// ------------------------------------------------------------------ dialogs
function overlays(L: Layout): void {
  if (app.overlay === "pause") {
    const w = Math.min(560, L.lw * 0.92) - 44;
    const open = ui.dialog(T("Paused"), "", true, () => {
      heading("h2", T("Paused"), w, "pause-heading");
      gapV(16);
      menu("pause-menu", [
        { id: "btn-resume", text: T("Resume"), style: ["primary"], act: closePause },
        { id: "btn-pause-settings", text: T("Settings"), act: () => openSettings("play") },
        { id: "btn-pause-help", text: T("How to Play"), act: () => openHelp("play") },
        { id: "btn-leave", text: T("Leave Round"), style: ["danger"], act: leaveRound },
      ], w);
    });
    if (!open && frame().frame !== app.overlayOpened && app.overlay === "pause") closePause();
  } else if (app.overlay === "results" && app.results) {
    const { result, newAch, next } = app.results;
    const w = Math.min(720, L.lw * 0.94) - 44;
    const ends: Record<string, string> = { "orders-complete": N("All orders served!"), "time-up": N("Time is up"), "moves-exhausted": N("Out of moves") };
    const body = (iw: number): void => {
      heading("h2", result.reason === "orders-complete" ? T("Round Complete") : T("Round Over"), iw, "results-heading");
      para(ends[result.reason] ? T(ends[result.reason]!) : result.reason, iw, "muted", "results-reason");
      const rows: [string, number][] = [
        [N("Orders served"), result.components.orders], [N("Streak bonuses"), result.components.streaks],
        [N("Board efficiency"), result.components.efficiency], [N("Dishes served"), result.fulfilled],
        [N("Best streak"), result.bestStreak], [N("Invalid actions"), result.invalidActions],
      ];
      const bw = Math.min(iw, 360);
      ui.column("results-breakdown", () => {
        for (const [k, v] of rows) ui.row(`res-${k}`, () => { para(T(k), bw - 70, "muted"); ui.spacer(); ui.style("body").label(String(v)); }, { width: bw, align: "center" });
      }, { spacing: 4, width: bw });
      para(T("Total: {score}", { score: result.score }), iw, "total", "results-total");
      if (newAch.length) para(T("Achievement unlocked: {names}", { names: newAch.map((a) => T(a)).join(", ") }), iw, "achievements", "results-achievements");
      const lb = leaderboardLine();
      if (lb) para(lb, iw, "muted", "results-lb");
    };
    const footer = (iw: number): void => {
      const btns: Btn[] = [{ id: "btn-retry", text: T("Retry"), style: ["primary"], act: retry }];
      if (next) btns.push({ id: "btn-next", text: T("Next Stage"), act: nextStage });
      btns.push({ id: "btn-results-title", text: T("Back to Title"), act: resultsTitle });
      menu("results-menu", btns, iw);
    };
    const fh = (lastHeight.get("results-foot") ?? 160) + 16;
    const avail = Math.max(100, L.lh * 0.9 - 60 - fh);
    const h = lastHeight.get("results-body") ?? 0;
    const fresh = frame().frame - app.overlayOpened <= 4;
    ui.dialog(T("Round Over"), "", true, () => {
      const inner = (): void => {
        const c = ui.column("results-wash", () => body(w - 28), { style: pr().highContrast ? undefined : "results-wash", width: w, spacing: 10, padding: 14 } as ui.Layout);
        lastHeight.set("results-body", c.height / L.sc);
      };
      if (h > avail) ui.scrollArea("results-scroll", { width: w + 14, height: avail }, inner, fresh ? { scrollTo: { top: 0 } } : undefined);
      else inner();
      const c = ui.column("results-foot", () => footer(w), { width: w, padding: { top: 16 } });
      lastHeight.set("results-foot", c.height / L.sc - 16);
    });
  }
}
// ------------------------------------------------------------------ toast
function toast(L: Layout): void {
  const t = app.toast;
  if (!t) return;
  const w = Math.min(L.lw * 0.9, 520);
  const tw = Math.min(w, textWidth(t.text, "toast") + 36);
  const th = (ui.measureText(t.text, { style: ["toast"], width: Math.max(40, tw - 36) }).height / L.sc) + 20;
  let bottom = 20;
  const play = app.screen === "play" && app.round;
  if (play && playKind(L) === "stacked" && L.lh > L.lw) bottom = (lastHeight.get("rail-right") ?? 130) + 20;
  let at: { anchor: "bottom" | "top"; y: number } = { anchor: "bottom", y: bottom };
  if (play && grid.cols) {
    // Over a hinted cell or a station, the toast moves to the top of the playfield.
    const sc = L.sc;
    const tx = ((L.ox + (L.lw - tw) / 2) * sc), ty = (L.oy + L.lh - bottom - th) * sc;
    const hit = (y0: number): boolean => {
      const st = app.round!.session.state;
      for (let i = 0; i < st.board.length; i++) {
        if (!(app.round!.hintCells.includes(i) || st.board[i]?.kind === "gen")) continue;
        const cx = grid.x + (i % grid.cols) * (grid.cell + grid.gap), cy = grid.y + Math.floor(i / grid.cols) * (grid.cell + grid.gap);
        if (cx < tx + tw * sc && cx + grid.cell > tx && cy < y0 + th * sc && cy + grid.cell > y0) return true;
      }
      return false;
    };
    if (hit(ty)) {
      const topY = grid.y - 8 * sc;
      if (!hit(topY)) at = { anchor: "top", y: Math.max(0, topY / sc - L.oy - 4) };
    }
  }
  ui.place("toast", { anchor: at.anchor, y: at.y }, () => {
    if (textWidth(t.text, "toast") + 36 <= w) ui.style("toast").id("toast").label(t.text);
    else ui.style("toast").id("toast").paragraph(t.text, w - 36);
  });
}
