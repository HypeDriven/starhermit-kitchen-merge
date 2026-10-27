// The look of the menus, HUD and dialogs: the browser build's style sheet,
// rewritten class-based in tools/ui-style.css and converted once with
// `starhermit css` into assets/ui-style.json (`npm run css`), registered at
// start with the theme the runtime's own widgets (checkboxes, selects,
// dialogs, scroll bars) take. The old body.high-contrast palette is a token
// set here, applied while the runtime's high-contrast option is on.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

export const INK = {
  bg: "#17110d", panel: "#241b14", panel2: "#2f241b", text: "#f2e8da", muted: "#b8a88f", accent: "#e8a04c",
  accent2: "#7cc98f", danger: "#d96a5a", focus: "#ffd76a",
};
export const INK_HC = { ...INK, bg: "#000000", panel: "#0a0a0a", panel2: "#141414", text: "#ffffff", muted: "#dddddd", accent: "#ffcc00", accent2: "#00ff88", focus: "#00ccff" };
type Tokens = Record<string, string | number>;
let base: Tokens = {};
const HIGH_CONTRAST: Tokens = {
  bg: INK_HC.bg, panel: INK_HC.panel, "panel-2": INK_HC.panel2, text: INK_HC.text, muted: INK_HC.muted, accent: INK_HC.accent,
  "accent-2": INK_HC.accent2, focus: INK_HC.focus,
};

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  base = { ...(css.tokens as Tokens) };
  ui.setTheme({
    fontSize: 16, smallSize: 14.4, headingSize: 24, padding: 8, spacing: 8, radius: 10,
    text: INK.text, muted: INK.muted, panel: INK.panel, control: INK.panel2, hovered: "#3a2d22",
    pressed: "#1d1610", field: INK.panel2, accent: INK.accent, focus: INK.focus, outline: "#ffffff22",
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    heading: { text: { color: "$text" } },
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    checkbox: {
      text: { color: "$text" }, minHeight: 44,
      parts: { box: { background: "$panel-2", border: { width: 1, color: "#ffffff33" }, radius: 4 }, mark: { background: "$accent" } },
    },
    select: { text: { color: "$text" }, background: "$panel-2", border: { width: 1, color: "#ffffff33" }, radius: 8, minHeight: 40 },
    dialog: {
      background: "$panel", radius: 14, padding: 22, border: { width: 1, color: "#00000055" },
      parts: { backdrop: { background: "#000000aa" } },
    },
    scrollArea: { parts: { bar: { background: "$muted", radius: 4 } } },
    tooltip: { background: "$panel-2", text: { color: "$text" }, radius: 6, padding: 6 },
  });
}

let hcKey: boolean | null = null;
/** The high-contrast tokens over the sheet's while the runtime's option is on. */
export function applyContrast(highContrast: boolean): void {
  if (hcKey === highContrast) return;
  hcKey = highContrast;
  ui.setTokens(highContrast ? { ...base, ...HIGH_CONTRAST } : base);
}
export function ink(highContrast: boolean): typeof INK { return highContrast ? INK_HC : INK; }
