# Kitchen Merge — Game Design Document (running spec)

This document describes the game as it ships today. Present tense means implemented
behaviour; anything the design wants but the code does not yet do is collected in
§17 "Design intent not yet implemented".

---

## 1. Overview

**Pitch.** Run a miniature open kitchen: tap stations to grow ingredients, merge pairs
up a five-tier chain, and serve the finished dish to a ticket before its timer burns out.

| | |
|---|---|
| Genre | Single-player merge/service puzzle with real-time order timers |
| Players | 1, plus asynchronous daily leaderboard comparison |
| Session length | 90 s (a Challenge) to ~5 min (Daily); Journey stages run 3–4.5 min |
| Platforms | Desktop and mobile browsers, portrait and landscape |
| Rendering | Three.js diorama on `<canvas id="gl">` (decorative, `aria-hidden`) over a real DOM grid of `<button>` cells that is the single interaction and accessibility surface |
| Simulation | Fixed 100 ms tick, seeded PRNG, serializable state, replayable command log |

### File map

| Path | Responsibility |
|---|---|
| `index.html` | Every screen as static markup: title, setup, play, help, settings, scores, list picker, pause and results overlays, live regions. |
| `css/style.css` | Single stylesheet: tokens, layout, three responsive breakpoints, high-contrast and colour-vision overrides, key-art backdrops. |
| `js/rules.js` | Pure rules engine — RNG, families, board, legal actions, `applyCommand`, `advance`, scoring, replay envelope. No DOM. |
| `js/content.js` | Versioned content: themes, 3 tutorials, 40 Journey stages, daily generator, practice difficulties, 4 challenges, achievements, validators. |
| `js/session.js` | Round controller: tick loop, undo stack, replay recording, `localStorage` persistence (`store`). |
| `js/render.js` | `KitchenRenderer` — Three.js scene, family silhouettes, quality tiers, particle pool, camera shake. |
| `js/audio.js` | `AudioEngine` — four gain buses, authored Opus clips with synthesised fallbacks, seeded arpeggio music, noise ambience. |
| `js/main.js` | Bootstrap, screen navigation, input (pointer/keyboard/gamepad), HUD, results, achievements, platform API adapter. |
| `server.js` | StarHermit authoritative script: static host + `/api/v1/time` and `/api/v1/scores` with replay validation. |
| `lib/three.module.js`, `lib/three.core.js` | Vendored Three.js r185, loaded through an import map. |
| `assets/` | Generated key art (`title-keyart.webp`, `results-plating.webp`). |
| `sfx/` | 14 Opus clips + `manifest.txt` (canonical), `manifest.md`, `manifest.json` (generator input). |
| `tests/` | `rules.test.js` (16 assertions, `npm test`), `validate-content.js`, `e2e.mjs` (real-UI playthrough), `smoke.cjs`/`run-smoke.mjs`. |
| `coverart.png`, `icon.png`, `favicon.svg` | Platform art. |

---

## 2. Vision and design pillars

**1. The board is the whole game.** Every rule is visible on the 6×6 grid and the order
rail beside it. *Rules in:* items that read at a glance (glyph + name + tier badge),
orders that show family, value and a draining bar. *Rules out:* off-screen economies,
menus you must open mid-round, currencies, inventories.

**2. A merge should feel like cooking, not arithmetic.** Tier names are dishes
(Sprout → Dough → Flatbread → Stuffed Roll → Harvest Loaf), not numbers, and each merge
answers with a wet pop, a particle burst and a 0.05-unit camera shake. *Rules in:* food
language everywhere in the UI. *Rules out:* "2048"-style numeric tiles and exponent talk.

**3. Pressure comes from tickets, never from twitch.** The clock that matters is the one
on each order. There is no reflex requirement, no falling pieces, no input window under
a second. *Rules in:* 45-second order timers, a 6-second streak window that rewards
planning ahead. *Rules out:* combo timers on individual inputs, drag-precision demands.

**4. Deterministic and inspectable.** Every round is a seed plus an ordered command log;
the server can replay a daily claim and re-derive the exact score. *Rules in:* seeded
streams per concern, state hashes, `compareResults` tie-breaks. *Rules out:* wall-clock
randomness, hidden difficulty adjustment, unverifiable leaderboard entries.

**5. Warm, low-contrast comfort with high-contrast readability.** The fantasy is a lamp-lit
counter at the end of service. *Rules in:* amber key light, five kitchen themes, clay-like
props. *Rules out:* neon UI chrome, and any state that is signalled by colour alone —
family is always carried by silhouette, glyph and text as well.

---

## 3. Player experience

**Target player.** Someone who likes merge games but resents their meters: a puzzle player
who wants a complete, ungated ~4-minute round, plus a daily seed to compare.

**The first 60 seconds.** Play is the primary button and, on a fresh profile, it does not
start a level — it opens **Learn**, because `store.getProgress().tutorialsDone` is empty
(`main.js` `btn-play` handler). Three lessons teach one verb each and cannot be failed:

| t | What happens |
|---|---|
| 0–5 s | Title card over the kitchen key art; Play is focused by `data-autofocus`. |
| 5–12 s | Lesson 1 setup screen states the goal; Start builds a 6×6 board with one Grain station and no orders or clock. |
| 12–25 s | Toast: "Tap a glowing station… Make two Grain Sprouts." Two taps, two spawn pops, "Lesson complete!" |
| 25–40 s | Lesson 2: spawn two Sprouts, select one, select the other; they merge into Dough with a burst. |
| 40–60 s | Lesson 3: one order is waiting. Merge to the requested tier, select the dish, press **Serve** — bell, points, score. |

Nothing is locked behind the lessons: Daily, Journey, Practice, Challenges and Scores are
reachable from the title at any time. The lessons only intercept the Play button.

**Session shape.** Title → mode list → setup card (stations, board size, duration, ranked
or not) → round → results overlay with a component breakdown, achievements, and Retry /
Next Stage / Back to Title.

**The emotional beat.** The double-serve: two orders sit on the rail, you have been
building both chains in parallel, and you land the second serve inside the 6-second streak
window — the glass-chime `streak` cue fires instead of the plain bell and the HUD flips
to "Streak x2". The game is built to make that moment plannable, not lucky.

---

## 4. Core loop and rules contract

Owner of every rule below: `js/rules.js`. `js/session.js` is the only module that issues
commands; `js/main.js` never mutates state directly.

### 4.1 Board and entities

`createGame(level, seedOverride)` builds `board` as a flat array of `cols × rows`
(default 6×6; the Narrow Counter challenge is 4×5). Each cell is `null`, a **station**
`{kind:'gen', family}` or an **item** `{kind:'item', family, tier}`.

Stations are placed on the bottom row at `col = min(floor(((i*2+1)*cols)/(fams*2)), cols-1)`,
one per enabled family, which keeps them distinct whenever `cols >= families` — a property
the first unit test pins for 6×6 and 4×5 with four families.

Four families, five tiers each, with a base order value (`FAMILIES`):

| Family | Tier 1 → 5 | Base | Silhouette (`familyGeometry`) | Colour / CVD colour |
|---|---|---|---|---|
| Grain | Sprout, Dough, Flatbread, Stuffed Roll, Harvest Loaf | 10 | rotated capsule | `#d9b36a` / `#ddcc77` |
| Garden | Leaf, Chopped Veg, Garden Salad, Roast Platter, Feast Bowl | 12 | icosahedron | `#6fbf5a` / `#117733` |
| Dairy | Milk Jug, Curds, Soft Cheese, Aged Wheel, Golden Fondue | 14 | tapered cylinder | `#f2ead2` / `#f2f2f2` |
| Ember | Skewer, Sear, Grill Plate, Smoke Roast, Fire Banquet | 16 | cone | `#d96a4a` / `#cc6677` |

### 4.2 Orders

At most **3** orders are on the rail (`MAX_ORDERS`). `spawnOrder` draws family uniformly
from the level's families and tier uniformly from `1..min(level.orderMaxTier, 5)`, then
sets `value = base × tier²` and a 450-tick (45 s) timer. A served order schedules a
replacement in 30 ticks; an expired one in 40 ticks.

### 4.3 Legal actions

`legalActions(state)` returns the complete set, and hints, the action tray and validation
all consume it — there is no second copy of the rules.

| Action | Legal when | Effect |
|---|---|---|
| `spawn {gen}` | cell is a station **and** at least one cell is empty | places a tier-1 item of that family on a uniformly random empty cell (`rules` stream) |
| `merge {from,to}` | both are items, same family, same tier, `tier < 5`, `from ≠ to` | `to` becomes tier+1, `from` clears |
| `submit {cell,order}` | item family and tier both equal a waiting order's | order leaves the rail, cell clears, score awarded |
| `trash {cell}` | cell holds an item | cell clears (no score change) |

Illegal commands never mutate the board: `applyCommand` increments `invalidActions`,
returns `explainInvalid`'s specific sentence ("Different ingredient families cannot merge."),
and the UI shows it in `#action-explain`, announces it assertively, and plays `invalid`.

### 4.4 Resolution order

1. `applyCommand` rejects when `phase !== 'active'` or `isLegal` fails.
2. The action resolves and `moves` increments.
3. On submit: streak, score, replacement-order schedule, then the `ordersTarget` check.
4. `movesLeft` decrements last; hitting 0 ends the round as `moves-exhausted`.
5. `advance(state, level)` runs every 100 ms and is independent of commands: it increments
   `tick`, decrements `timeLeft` (end at 0 → `time-up`, returning immediately), ages every
   order and expires those at 0, then services the replacement countdown.

### 4.5 Scoring

```
orders     += value                       where value = FAMILIES[family].base × tier²
streaks    += (streak - 1) × floor(value × 0.2)
efficiency  = round(emptyCells / totalCells × 100)   -- computed once, at endGame
total       = orders + streaks + efficiency
```

`streak` increments when `tick - lastSubmitTick <= 60` (6 s), otherwise resets to 1. An
expired order resets it to 0.

**Worked example.** Journey stage 1 (Grain only, 6×6, target 3 orders). Serve a Flatbread
(tier 3): `10 × 9 = 90`, streak 1, no bonus → 90. Serve a Dough (tier 2) four seconds
later: `10 × 4 = 40`, streak 2, bonus `1 × floor(40 × 0.2) = 8` → 48. Serve a Sprout ten
seconds after that: `10`, streak resets to 1, no bonus. The target is met, so `endGame`
fires with 32 of 36 cells empty → efficiency `round(0.888 × 100) = 89`. Total
`= 140 + 8 + 89 = 237`.

### 4.6 Terminal states and tie-breaks

`terminalReason` is one of `orders-complete` (win chrome and the `win` cue),
`time-up`, or `moves-exhausted` (both use the `lose` cue). Results title reads
"Round Complete" only for `orders-complete`. Free-play levels with no limit at all are
allowed only for `practice` and `tutorial` kinds; `validateLevel` rejects an unbounded
duration anywhere else.

`compareResults(a, b)` orders leaderboard entries by: score desc, orders fulfilled desc,
invalid actions asc, elapsed ticks asc, then `sessionId` lexicographically.

### 4.7 RNG, seeding, replay

`makeStreams(seed)` derives three mulberry32 streams from FNV-1a hashes of
`rules:`, `content:` and `av:` + seed, so cosmetic changes cannot shift gameplay draws.
Seeds are content-derived: `hashString('journey:' + stage)`, `hashString('daily:' + date)`,
`hashString('practice:' + difficulty + ':' + today)`, `hashString(challengeId)`.

A replay envelope (`schema 1`) carries the rules version, level id, content version, seed,
initial state hash, every command with the tick it was applied at, a rolling state hash per
command, and the terminal summary. `replayEnvelope` re-creates the level, refuses version
mismatches, duplicate command ids, hash divergence and terminal mismatch, and guards the
catch-up loop at 200 000 iterations.

### 4.8 Undo and hints

Undo exists only where `level.undo` is set (Practice) — `Session.command` pushes a
serialized snapshot before each command, capped at 60, and `undo()` also pops the last
recorded command and hash so the envelope stays consistent. Hints call `legalActions` and
prefer `submit` > `merge` > `spawn`, outlining up to three cells for 3 s and speaking the
text; there is no hint budget or penalty.

---

## 5. Modes and progression

| Mode | Board / families | Duration | Ranked | Notes |
|---|---|---|---|---|
| **Learn** (3 lessons) | 6×6, Grain only | none | no | Goal counters on spawn / merge / submit; auto-advance after 800 ms; replayable from Settings |
| **Journey** (40 stages) | 6×6, 1→4 families | 180–270 s, target 3–12 orders | no | Stage `n` unlocked once stage `n−1` is cleared; 1–3 stars vs. `par = 400 + stage × 120` |
| **Journey mastery** (every 8th stage) | 6×6, all unlocked families | 40 + 8×families moves | no | Move-limited, `ordersTarget = 5 + families`, 3 opening orders |
| **Daily** | 6×6, 2–4 families by day | 240 s | **yes** | One immutable UTC seed for everyone; submitted with its replay envelope |
| **Practice** — relaxed / standard / intense | 6×6, 2 / 3 / 4 families | none / 300 s / 210 s | no | Undo enabled; seed re-rolls daily |
| **Challenges** (4) | see below | varies | no | Fixed seeds from the challenge id |

Challenges: *Speed Service* (90 s, Grain+Garden, tier ≤ 2, Midnight theme), *Thirty Moves*
(30 moves, Grain+Dairy, Sunrise), *Narrow Counter* (4×5 board, all four stations, 240 s,
Coastal), *Gourmet Rush* (300 s, Ember+Dairy, orders up to tier 5, Garden).

**Difficulty curve** (`journeyLevel`): families grow one per six stages (1→4), maximum
ordered tier grows one per eight stages (1→4), the time limit rises from 180 s to a 270 s
cap, and the order target rises from 3 to 12. Every eighth stage swaps the clock for a move
limit — the mastery test of the concepts introduced since the last one. The theme rotates
every eight stages through the five themes.

**Unlocks and achievements.** Progression is a strictly local `localStorage` record:
`journeyStage`, per-stage `stars`, `tutorialsDone`, `achievements`, `playDays`,
`masteryStages`. Five achievements — `first_service`, `merge_master` (create a tier-5
dish), `hot_streak` (streak 5), `mastery_five`, `regular` (play on seven distinct days).
Unlocks are idempotent and announce once, on the next results screen.

---

## 6. Controls and interaction

The DOM grid is the only input surface; the canvas is `aria-hidden` and never receives
pointer events, so mouse, touch, keyboard and gamepad all traverse the same code path.

| Input | Desktop | Mobile |
|---|---|---|
| Activate cell | click | tap |
| Select ingredient | click item | tap item |
| Merge | click source, click target | tap, tap — **or** drag from source to target (>14 px starts the drag, ghost ring follows, drop commits) |
| Deselect | click the selected cell, or Esc | tap the selected cell |
| Serve / Discard / Undo / Hint | rail buttons, or `S` / `D` / `U` / `H` | rail buttons (full-width in the wrapped rail) |
| Pause | `Esc` or the ⏸ button | ⏸ button |
| Move focus | arrow keys (roving `tabindex`, clamped at edges) | — |
| Reset camera | `C` | — |
| Gamepad | A = activate focused, B = deselect, Start = pause, left stick = focus movement | — |

**Input locking.** Commands are refused while `phase !== 'active'` or `session.paused`;
opening any screen other than `play` pauses the session, and returning resumes it unless
the pause overlay is open. Backgrounding the tab auto-pauses. A drag that has committed
swallows the synthetic click in a capture-phase handler so one gesture is never two actions.

**Feedback per input.** Every cell activation plays `ack`; selection plays `select` and
announces the item name; a rejected command writes the reason, announces it assertively and
plays `invalid`; successful actions get their own cue, a bounded particle burst and (merge
and submit only) a small camera shake. Serving vibrates for 20 ms when haptics are on.

---

## 7. Screens and UI flow

```
boot ─► title ─┬─► setup ─► play ─┬─► [pause overlay] ─► settings/help/leave
               │                  └─► [results overlay] ─► retry | next | title
               ├─► list (Learn | Journey | Practice | Challenges) ─► setup
               ├─► scores (local | global daily)
               ├─► help
               └─► settings
```

`show(name)` toggles the seven `.screen` sections, focuses the first `[data-autofocus]` or
`.btn`, and pauses/resumes the session. Pause and results are `role="dialog"`
`aria-modal="true"` overlays layered above the play screen; pause restores the previously
focused element on close, results focuses Retry.

**Desktop (≥1024 px).** Play is a three-column grid: order rail, playfield, action tray,
under a HUD strip carrying objective, timer, score, streak pill and pause.

**Tablet / small desktop (≤1023 px).** Columns collapse to rows: the order rail wraps into
a horizontal strip of order chips above the board, the action tray into a row below it.

**Portrait phone (≤640 px).** Same stacked layout with tightened type and 110 px order
chips; the board keeps a 44 px minimum cell (`fitBoard` clamps `Math.max(44, …)`).

**Landscape phone (≤500 px tall).** Back to three columns with 120–170 px rails, so the
board keeps the full height between HUD and bottom edge.

**Safe areas.** `env(safe-area-inset-*)` feeds four custom properties consumed by every
screen's padding, the HUD, the overlays and the toast, and `viewport-fit=cover` is set.
Never clipped: the HUD score and timer, all three order chips, the four action buttons,
the results total, and the board itself — `fitBoard` sizes the grid from the measured
playfield box on every resize and orientation change.

---

## 8. Art direction

**Palette (CSS tokens).** `--bg #17110d`, `--panel #241b14`, `--panel-2 #2f241b`,
`--text #f2e8da`, `--muted #b8a88f`, `--accent #e8a04c`, `--accent-2 #7cc98f`,
`--danger #d96a5a`, `--focus #ffd76a`. High contrast swaps to `#000`/`#fff` with
`#ffcc00`, `#00ff88` and a `#00ccff` focus ring, and drops both key-art backdrops.

**Themes** (`THEMES`, applied to the 3D scene per level): Hearth Kitchen, Garden Veranda,
Midnight Diner, Sunrise Bakery, Coastal Galley — each supplies scene background, key and
fill light colours, floor and board tints, and a UI accent.

**Shape language.** Rounded, chunky, clay-like props on a round wooden plinth: capsule,
icosahedron, cylinder, cone — one per family, so silhouette alone identifies a family in
grayscale. Tier reads three ways: dimensions grow with tier, tiers 3+ gain a gold marker
ring, tiers 4+ gain emissive glow, and the DOM cell always shows the dish name and a `T#`
badge. The scene surround is deliberately sparse — counter, shelf, three hanging pans, a
warm window plane — and the extra props only exist at medium/high quality.

**The hero** is the board: the camera is a 30° lens at `(0, 10.8, 3.0)` looking at the
board centre, near enough to top-down that the DOM grid overlays the projected 3D cells.

**Typography.** System UI stack (`"Segoe UI", system-ui, sans-serif`); 2.6 rem title,
tabular-lining numerals for timer and score so digits do not jitter; a "Larger text" body
class for players who need it.

**Motion.** Short and event-tiered: 6 particles on spawn, 14 on merge, 20 on serve, all
drawn from a bounded pool (60/150/300 by quality tier); camera shake 0.05 on merge, 0.08 on
serve, decaying at 0.85 per frame. **Reduced motion** disables shake in `render()` and every
CSS animation and transition via `@media (prefers-reduced-motion: reduce)`; nothing is
communicated by motion alone.

**Visual assets the design calls for.** A title backdrop that shows all four families as a
single lamp-lit diorama (so the fantasy lands before any text is read), and a results wash
of a finished plate (so the score screen feels like a completed service). Both ship — see §15.

---

## 9. Audio direction

**Mix philosophy.** A quiet kitchen at the end of service: ambience sits under everything,
music is sparse and generative, and one-shots carry the information. Event priority runs
`ack < select/move < goal < round end`, and cues never stack more than three deep.

**Buses.** `music`, `effects`, `ambience`, `voice` — four `GainNode`s into a master gain,
each with its own slider (defaults 0.6 / 0.8 / 0.4 / 0.8) persisted in settings. The
`AudioContext` is only created after a user gesture; every audio path no-ops safely
without one.

**Music and ambience.** Music is a seeded arpeggio over a five-note scale, one note per
620 ms with a 40 % chance of an added fifth, seeded from the level seed, and it skips while
the tab is hidden. Ambience is a looped 2-second filtered-noise bed (320 Hz lowpass) at
low gain. Both start on round start and stop on round end or leave.

**SFX table.** Authored clips are lazily fetched, decoded and cached on first use; until a
clip is ready — or if it 404s — the synthesised fallback in `AudioEngine.play()` fires, so
every event is always audible. This table is the source for `sfx/manifest.txt`.

| Event id | File | Description | Usage context |
|---|---|---|---|
| `ack` | `ui-confirm.opus` | Soft wooden UI tap, dry, no reverb | Every cell activation; Undo confirmation |
| `select` | `item-select.opus` | Utensil ticking a ceramic bowl rim | Picking up an ingredient |
| `spawn` | `ingredient-spawn.opus` | Vegetable landing on a board, soft bounce | A station produces a tier-1 item |
| `merge` | `merge-pop.opus` | Wet squish into one, with a sparkle tail | Two identical items become the next tier |
| `invalid` | `action-denied.opus` | Dull double knock, muted refusal | Any rejected command, with its written reason |
| `submit` | `order-serve.opus` | Brass service bell, plate set down | Serving at streak 1–2 |
| `streak` | `streak-bonus.opus` | Three ascending glass chimes | Serving at streak 3+ |
| `expire` | `order-expire.opus` | Steam sighing off the heat | An order timer hits zero |
| `trash` | `discard-item.opus` | Wrapper into a metal bin, hollow clang | Discard clears a cell |
| `win` | `round-win.opus` | Kitchen celebration, bells and sparkle | Terminal `orders-complete` |
| `lose` | `round-lose.opus` | Warm descending marimba phrase | Terminal `time-up` / `moves-exhausted` |
| `tick` | `timer-tick.opus` | One dry mechanical timer click | Clock accent |
| `arrive` | `order-arrive.opus` | Ticket clipped to a rail, two-note chime | A new order enters the rail |
| `warn` | `time-warning.opus` | Timer rattling, three rising dry ticks | Once per round, as a timed round crosses 15 s |

---

## 10. Localization

**Required languages:** en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.

**Today the game ships English only**, and it ships it as literals: UI chrome in
`index.html`, dish and family names in `FAMILIES` (`rules.js`), level names and blurbs in
`content.js`, invalid-action sentences in `explainInvalid`, and runtime strings (toasts,
announcements, results labels) in `main.js`. `<html lang="en">` is static.

The design's requirements for the localized build, which the current structure is close to
but does not yet satisfy, are in §17: one string catalogue per locale keyed by id, language
chosen from `navigator.languages` with a Settings override and a regional fallback chain
(`fr-CA → fr-FR → en-US`), and layout that tolerates **+40 %** string expansion — the order
chips, action buttons and HUD labels are the tight spots, and the wrapping rails already
give them room to grow. Dish names are localizable content, not identifiers: the engine
matches on `family` and `tier`, never on a display name.

---

## 11. Accessibility

- **Keyboard-only path is complete**: every screen is reachable and every round is
  playable — arrow keys move a roving-`tabindex` focus across the grid, Enter/Space
  activates, Esc deselects then pauses, and `S`/`D`/`U`/`H` reach the rail actions.
- **Focus** is visible everywhere (`3px solid var(--focus)` with a 2 px offset), moved to
  the first control on each screen change, moved into dialogs on open, and restored on
  pause close.
- **Screen-reader announcements**: two live regions — polite (`#live`) for selection,
  merges, serves with points and streak, new orders, hints and lesson progress; assertive
  (`#live-assertive`) for expiries, refusals, the 15-second warning and round end. Every
  cell carries a descriptive `aria-label` ("Aged Wheel (Dairy tier 4), cell 14"); every
  order chip carries family, value and seconds remaining.
- **Contrast**: body text `#f2e8da` on `#17110d` (~14:1); the key-art backdrop is behind a
  near-opaque scrim and disabled entirely in high-contrast mode.
- **Colour independence**: family is silhouette + glyph (`▬ ● ▮ ▲`) + name; a colour-vision
  palette is available and applies to both the 3D props and the DOM cells.
- **Reduced motion** removes camera shake and all CSS transitions.
- **Target sizes**: 44 px minimum on every button, and `fitBoard` refuses to draw a grid
  cell smaller than 44 px — the mobile e2e pass asserts this.
- **Other switches**: larger text, left-handed layout (RTL flip of the play grid only),
  haptics on/off, and a quality tier for low-power devices.
- The 3D view is optional: if WebGL fails, `#gl-fallback` announces "3D view unavailable —
  the accessible board below is fully playable", and it is.

---

## 12. StarHermit integration

`starhermit.txt` declares `name`, `launch=index.html`, `owner`, `server=server.js`,
`cover=coverart.png`, per https://wiki.starhermit.com/ conventions.

**Used:**
- **Server script** — `server.js` hosts the static build and the game API.
- **Authoritative time** — `GET /api/v1/time`; the client measures a round-trip-adjusted
  offset and derives the daily date from it, so the Daily seed is the same for everyone.
- **Daily leaderboard** — `GET /api/v1/scores?day=` and `POST /api/v1/scores`. Submissions
  carry the replay envelope; the server re-derives the level from the day (never trusting a
  client seed), replays the log, and marks the entry `validated` only if the replayed score
  matches. Unvalidated entries are kept on a casual board rather than dropped. Per-IP token
  bucket: 30 requests/minute → 429; bodies over 512 KB → 413; entries are idempotent by
  session id and the top 100 per day are retained.
- **Sessions** — a per-round `sessionId` identifies leaderboard rows.

**Not used:** platform identity/accounts (players are a local "Guest profile"), presence,
matchmaking, real-time multiplayer, cloud saves, platform achievements (the five
achievements are local), and any commerce. The whole game runs offline: `platform.fetchTime`
failing simply sets `online = false`, the title line reads "Offline mode", the Daily falls
back to the device date, and results say "Offline — score saved locally only."

---

## 13. Technical architecture

**Layering.** `rules.js` (pure, importable in Node and the browser, and imported directly by
`server.js`) ← `session.js` (timing, undo, persistence, envelope) ← `main.js` (DOM, input,
platform) → `render.js` / `audio.js` (presentation only, consuming snapshots and events).
Rendering never mutates rules state, and audio/VFX are driven by the event list every
command and tick returns.

**Determinism and replay.** One `TICK_MS = 100` fixed step; commands are stamped with the
tick they applied at; the replayer advances to each command's tick before applying it, then
runs out the clock to the recorded terminal tick. State hashes are FNV-1a over the
deterministic fields only — `_streams`, selection and undo stack are excluded.

**Persistence.** `localStorage` under `kitchen-merge:` — `settings`, `progress`, `scores`
(top 20 per board id), and snapshot slots. Every access is wrapped so private-mode failures
degrade to defaults instead of throwing.

**Performance budgets.** Quality tiers cap device pixel ratio at 1 / 1.5 / 2, toggle shadows
and surround detail, and size the particle pool at 60 / 150 / 300. Geometry and materials are
disposed when items change tier or the board is rebuilt; item and station views are keyed by
`family:tier` so unchanged cells are never re-created. The simulation is a 100 ms interval
independent of the render loop, so a slow frame cannot alter the outcome.

**Security posture.** Score rows come from other players: leaderboard tables are built with
`createElement`/`textContent`, never `innerHTML`. The static server refuses dotfiles, any
path escaping the game root, and the data directory.

**How the e2e drives the real UI.** `tests/e2e.mjs` starts its own static server on an
ephemeral port and drives system Chrome through `playwright-core`, clicking the visible
buttons and reading the DOM board (`data-kind`, `data-family`, the `T#` badge, the `.match`
class) to decide its next move — exactly the information a sighted player has. It never
calls into the modules.

---

## 14. Testing and acceptance criteria

**`npm test` → `tests/rules.test.js`, 16 checks, all passing:** station placement on 6×6 and
4×5 boards; initial orders; spawn legality and effect; illegal spawn reason and
`invalidActions` counting; merge family/tier constraints; submit scoring and streak;
`orders-complete` terminal with efficiency; `time-up` via `advance` and order expiry;
expiry clearing the streak; serialization round-trip and hash stability; identical
seed+commands → identical hashes; rejection of a tampered terminal score; rejection of
duplicate command ids; a malformed-command fuzz that must neither hang nor corrupt state; a
random full game that must terminate; and `legalActions` empty after the end.

**`npm run validate` → `tests/validate-content.js`:** 48 content entries (3 tutorials, 40
Journey stages, a daily, 4 challenges) all pass `validateLevel` — ids and numeric seeds,
known families, board large enough for its stations, bounded duration, order tier in range.

**`npm run test:e2e` → `tests/e2e.mjs`:** two passes — desktop 1280×800 and mobile 390×844
with touch — covering title, settings toggle applying to `<body>`, the three lessons
(asserting a tier-2 Dough actually appears after the merge), the 40-stage Journey list with
39 locked, stage 1 played to "All orders served!", persisted progression, pause via button
and Esc, pause→settings, leave, a Practice round with hint and undo, the local scores table,
and a full touch playthrough with a 44 px minimum cell assertion. Any page error or
non-benign console message fails the run.

**QA bar (per `agents/qa.md`), as checkable statements:**
- Every feature the UI exposes is operable in the browser at both viewports. ✔ e2e
- No console errors or warnings during a full playthrough. ✔ e2e asserts this
- No text or control is cut off or under browser chrome / a cutout at desktop, portrait or
  landscape. ✔ safe-area padding + `fitBoard`; verified by the mobile pass
- Every input is acknowledged within one frame, visually and audibly. ✔ §6
- A player can reach a completed round from a cold load using only what is on screen. ✔ e2e

---

## 15. Asset inventory

| Path | Purpose | Source tool | Status |
|---|---|---|---|
| `assets/title-keyart.webp` | Title-screen backdrop: lamp-lit miniature counter showing all four families | FLUX.2 klein, 1536×864, seed 20260909, 28 steps → WebP q80 (39 KB) | generated this pass, wired (CSS `#screen-title`) |
| `assets/results-plating.webp` | Results-panel wash: finished plate under a service lamp | FLUX.2 klein, 1024×576, seed 771102, 28 steps → WebP q80 (20 KB) | generated this pass, wired (CSS `#overlay-results .panel`) |
| `coverart.png` | StarHermit cover (`cover=` in `starhermit.txt`) | pre-existing | shipped |
| `icon.png`, `favicon.svg` | Platform icon and browser favicon | pre-existing | shipped |
| `sfx/ui-confirm.opus` … `sfx/timer-tick.opus` (12 clips) | Events `ack`, `select`, `spawn`, `merge`, `invalid`, `submit`, `streak`, `expire`, `trash`, `win`, `lose`, `tick` | MOSS-SoundEffect v2.0, 48 kHz mono Opus | shipped |
| `sfx/order-arrive.opus` | Event `arrive` — a new order reaches the rail | MOSS-SoundEffect v2.0, 100 steps | generated this pass, wired (`js/audio.js`, `new-order` event) |
| `sfx/time-warning.opus` | Event `warn` — timed round crosses 15 s | MOSS-SoundEffect v2.0, 100 steps | generated this pass, wired (`js/main.js` `updateHud`) |
| `sfx/manifest.txt` | Canonical clip → event → description → context table | authored | shipped (regenerated this pass) |
| `sfx/manifest.json` / `manifest.md` | Generator input / human-readable mirror | authored | in sync with `manifest.txt` |
| 3D props | Stations, ingredients, board, surround | procedural Three.js geometry in `render.js` | shipped — no imported meshes; the family silhouettes are the accessibility cue and must stay parametric per tier |
| Music, ambience | Seeded arpeggio, filtered-noise bed | procedural WebAudio | shipped |

No character animation is needed: the game has no humanoid.

---

## 16. Known limitations

- **English only.** See §10 and §17.
- **Guest profiles only.** Progress, achievements and local scores live in one browser's
  `localStorage`; clearing site data loses them, and there is no cross-device sync.
- **The Daily board is by session id, not by player.** A returning player gets a new
  `sessionId` each round, so the board shows rounds rather than people; resubmission is
  idempotent only within a single round.
- **`restoreState` does not rewind the RNG.** Snapshots restore the deterministic fields,
  but replaying the command log is the authoritative restoration path; snapshot slots exist
  in `store` and no screen currently offers "resume a round in progress".
- **Undo and the daily board are intentionally exclusive.** Undo is enabled only for
  Practice; a Practice envelope is never submitted.
- **Global scores need a manual tab switch.** The Scores screen fetches the daily board when
  it opens but renders it only when "Global (daily)" is pressed.
- **No hint budget.** Hints are unlimited and unpenalised in every mode, including the Daily.
- **Order draw is uniform**, so a level with four families can hand out three orders of the
  same family; the board is large enough that this is a variance quirk, not a soft lock.

---

## 17. Design intent not yet implemented

1. **Localization.** Nine locales are required; the game ships English literals. The intended
   shape is a per-locale string catalogue keyed by id, `navigator.languages` detection with a
   Settings override, a regional fallback chain, `<html lang>` updated at boot, and a +40 %
   expansion allowance in the order chips, action tray and HUD.
2. **Voice bus is a mix path with nothing routed to it.** The slider and gain node exist; no
   cue currently plays through `voice`. Spoken order callouts are the intended use.
3. **Resume-in-progress.** `store.saveSnapshot` / `loadSnapshot` are implemented but unused;
   the design wants a round interrupted by a closed tab to be resumable from the title.
4. **Player-scoped daily identity.** Once platform identity is available, leaderboard rows
   should key on the player rather than a per-round session id.
