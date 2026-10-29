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
| Players | 1, plus asynchronous comparison (local records; the StarHermit `high-score` board when signed in) |
| Session length | 90 s (a Challenge) to ~5 min (Daily); Journey stages run 3–4.5 min |
| Platforms | StarHermit engine 1.23.0 script game (host API 1.21, `engine.minor=19`): natively in the StarHermit client, in desktop and mobile browsers through the engine's web runtime; portrait and landscape |
| Rendering | The kitchen on `starhermit:scene` behind a grid of labelled cell widgets (`starhermit:ui`) that is the single interaction and accessibility surface |
| Simulation | Fixed 100 ms tick on the runtime's 60 Hz fixed steps, seeded PRNG, serializable state, replayable command log |

### File map

| Path | Responsibility |
|---|---|
| `starhermit.txt` | Manifest: name, owner, `server=score-script.js`, cover, `launch=index.html`, `engine.entry=native/main.ts`, `engine.version=1.23.0`, `engine.minor=19`, capabilities (platform, storage, clipboard), `control.*` and `engine.gamepad.*` defaults. |
| `index.html`, `starhermit-files.json` | The engine's web loader and file index, written by `npm run package` (`starhermit package --web .`); never edited by hand. |
| `native/main.ts` | Entry module: screen flow, rounds on the fixed steps, the selection model, drags, rule events → sound/announcements/effects, lessons, progression, achievements, results, leaderboard posting, lifecycle. |
| `native/screens.ts` | Every screen and dialog as `starhermit:ui`: title, list picker, setup, play (HUD, Orders and Actions rails, the cell grid), pause and results dialogs, How to Play, Settings, Scores, toast. |
| `native/render.ts` | The kitchen on `starhermit:scene` (port of the browser build's `js/render.js`): board, family silhouettes, stations, surround, procedural canvas textures, lights, post effects per graphics level, sparks, motes, shake, the camera fitted to the cell grid. |
| `native/platform.ts` | Save (the document in `starhermit:storage` saves, cloud sync, conflict merge, migration of the old cloud slot and legacy account settings), the `localStorage` shim, player, invite link, server clock, high-score board read and score posting. |
| `native/audio.ts` | Clips per event, the rendered ambience bed and seeded arpeggio music on the runtime's buses. |
| `native/quality.ts` | The four presets and their budgets per graphics level. |
| `native/i18n.ts`, `native/style.ts` | Locale from the runtime's interface language; the converted style sheet, theme and high-contrast tokens. |
| `js/rules.js` | Pure rules engine — RNG, families, board, legal actions, `applyCommand`, `advance`, scoring, replay envelope. |
| `js/content.js` | Versioned content: themes, 3 tutorials, 40 Journey stages, daily generator, practice difficulties, 4 challenges, achievements, validators. |
| `js/session.js` | Round controller: `tick()` per 100 ms step, undo stack, replay recording, the `store` over `localStorage` keys. |
| `js/save.js` | The save document (`parseDoc`) and the two-device merge (`mergeDocs`). |
| `js/i18n.js`, `js/locales/` | `T`, `N`, `setLocale`, `onLanguage` and the per-locale catalogues keyed by the US-English text. |
| `score-script.js` | StarHermit platform script (`server=`): range-checks a finished round's score and posts it to the `high-score` board (canonical copy). |
| `tools/ui-style.css` → `assets/ui-style.json` | The browser style sheet rewritten class-based; `npm run css` converts it. |
| `tools/gen-plays.mjs`, `tools/browser-play.mjs`, `tools/package-web.mjs`, `tools/css.mjs` | Play-script generator, GPU-Chrome browser play, web packaging, CSS conversion. |
| `assets/` | Key art (`title-keyart.webp`, `results-plating.webp`) and `ui-style.json`. |
| `sfx/` | 14 Opus clips + `manifest.txt` (canonical), `manifest.md`, `manifest.json`. |
| `tests/` | Unit tests (rules, session, save, i18n, content validation) and `native.mjs` with `tests/native/*.play`. |
| `cover.jpg`, `coverart.png`, `icon.png` | Platform art. |

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
(`native/main.ts` `play()`). Three lessons teach one verb each and cannot be failed:

| t | What happens |
|---|---|
| 0–5 s | Title card over the kitchen key art; Play is focused. |
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
commands; `native/main.ts` never mutates state directly.

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

**Unlocks and achievements.** Progression is a record in the saved progress document (device and cloud save):
`journeyStage`, per-stage `stars`, `tutorialsDone`, `achievements`, `playDays`,
`masteryStages`. Five achievements — `first_service`, `merge_master` (create a tier-5
dish), `hot_streak` (streak 5), `mastery_five`, `regular` (play on seven distinct days).
Unlocks are idempotent and announce once, on the next results screen.

---

## 6. Controls and interaction

The cell grid is the only board input surface: every cell is a `starhermit:ui` button
widget named for screen readers, drawn over the kitchen, so mouse, touch, keyboard and
gamepad all reach the same `cellAction` path.

| Input | Keyboard / mouse | Touch | Gamepad |
|---|---|---|---|
| Activate cell (spawn, select, merge target) | click, or Enter/Space on the focused cell | tap | A (South) on the focused cell |
| Move focus | arrow keys / Tab (the UI's focus navigation) | — | D-pad or left stick |
| Merge | click source, click target — or drag source onto target (> 14 px starts the drag, the target ring follows, release commits) | tap, tap — or drag | select, then A on the target |
| Deselect | click the selected cell, Esc, Backspace (`deselect`) | tap the selected cell | B (East) |
| Serve / Discard / Undo / Hint | rail buttons or `S` / `D` / `U` / `H` | rail buttons | Y (North) / X (West) / RB / LB |
| Pause | `Esc` (deselects first when an item is selected) or the II button | II button | Start |
| Reset camera | `C` | — | right stick press |

Players rebind every action in the runtime's Options (Settings › Change keys and buttons
opens the rebinding). How to Play lists the effective keys (`bindingLabel`). On a menu
sub-screen, Esc goes back like its Back button.

**Input locking.** Commands are refused unless the play screen is up with no dialog, the round
is active and not paused. Leaving the play screen (Settings or How to Play from the pause menu)
pauses the round; returning resumes it. A hidden window opens the pause menu. Pointer and touch
presses are queued and decided after the frame's UI is built; a drag that ended on a cell
swallows that cell's click, so one gesture is never two actions.

**Feedback per input.** Every cell activation plays `ack`; selection plays `select` and
announces the item; a refused command announces its reason assertively, shows it under the
action buttons and plays `invalid`; successful actions get their own cue, a bounded spark
burst and (merge and submit) a small camera shake. Serving vibrates 20 ms when haptics are on.

---

## 7. Screens and UI flow

```
title ─┬─► list (Learn | Journey | Practice | Challenges) ─► setup ─► play ─┬─► [pause] ─► settings / help / leave
       ├─► setup (Play → next Journey stage; Daily Challenge)               └─► [results] ─► retry | next stage | title
       ├─► scores (local | global)
       ├─► help
       └─► settings
```

Every screen is a centred card (`title-card` 560 px; `panel` 560 px or 720 px wide) on the
page colour, scrolling with the screen when taller than the window; each opens at its top with
its first control focused (Play, Start, the first list item…). Pause and results are
`ui.dialog`s over the round; pause focuses Resume, results focuses Retry. The title shows the
key art behind a dark scrim, with a slow lamp glow on animated graphics levels.

**Play layouts** (picked by the window's logical size):

- **Wide (≥ 1024 px):** HUD strip (objective, timer or moves, score with streak pill, II),
  Orders rail (150–220 px), playfield, Actions rail.
- **Stacked (< 1024 px, portrait or tall):** Orders strip with wrapping order chips (110 /
  130 px minimum) above the playfield, the action row (four equal buttons) below.
- **Short landscape (≤ 500 px tall, or a landscape window under 1024 × 720):** narrow rails
  (120–170 / 130–180 px) beside the board, one action per row.

Left-handed controls swap the two rails. The playfield fits a square grid of cells (at least 44
logical px, 4 px gaps, 12 px margin), centred; the 3D board is fitted to it each frame.

**Toast** sits at the bottom centre (above the action row in stacked portrait play); when it
would cover a hinted cell or a station it moves to the top edge of the board. **Safe areas**
come from the runtime (`frame().safeArea`).

---

## 8. Art direction

**Palette (style tokens).** `bg #17110d`, `panel #241b14`, `panel-2 #2f241b`, `text #f2e8da`,
`muted #b8a88f`, `accent #e8a04c`, `accent-2 #7cc98f`, `danger #d96a5a`, `focus #ffd76a`. The
runtime's high-contrast option swaps to `#000`/`#fff` with `#ffcc00`, `#00ff88` and a `#00ccff`
focus ring and drops the key-art backdrops.

**Themes** (`THEMES`, applied per level): Hearth Kitchen, Garden Veranda, Midnight Diner,
Sunrise Bakery, Coastal Galley — scene background, key and fill light, floor and board tints.
Settings › Graphics › Theme is kept from the browser build; every level names its own theme, so
it only applies to a level without one (none ship).

**Shape language.** Rounded, clay-like props on a round counter: capsule (Grain), icosahedron
(Garden), tapered cylinder (Dairy), cone (Ember) — silhouette alone identifies a family. Tier
reads three ways: size grows with tier, tiers 3+ gain a gold ring, tiers 4+ glow, and each
cell shows its glyph (`▬ ● ▮ ▲`), dish name and `T#`. Cells holding a dish an order wants are
tinted green; stations have a family-coloured outline; items a family-coloured bottom edge.

**Camera.** A 30° lens straight down at the board, its distance and view offset fitted each
frame so the board's projected footprint matches the cell grid exactly.

**Motion.** 6 sparks on spawn, 14 on merge, 20 on serve (× the level's sparks budget), from a
pool of 60 or 300 × that budget; camera shake 0.05 on merge, 0.08 on serve, decaying 0.85 per
frame. Ambient motion on Balanced and up: items breathe, station tops bob and turn, the key
light flickers, dust motes drift. The runtime's reduced-motion option stops sparks, shake and
ambient motion.

**Graphics levels.** The runtime's Options choose the level (Auto by default); the game reads
`frame().quality` and `levelIndex` and applies the browser build's presets (`native/quality.ts`):

| Preset | Shadows | AO | Bloom / grade | AA | Reflections | Detail | Materials | Wood / tile tex | LOD | Motes | Sparks |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Low | off | off | off | MSAA | off | plain | Lambert | — | ½ | — | 0.5× |
| Balanced | 1024 | off | on | FXAA | room env | detailed | Standard | 512 / 128 | ¾ | 28 | 0.75× |
| High | 2048 | on | on | SMAA | room env | detailed | Physical (clearcoat, sheen) | 512 / 128 | 1 | 40 | 1× |
| Ultra | 4096 | high | on | MSAA | room env | detailed | Physical | 1024 / 256 | 1.5 | 80 | 1.5× |

Motes and sparks grow with the level within a preset (≤ 2×). Detailed scenes add rounded
glazed tiles with a speckle texture, butcher-block wood (with bump) on the counter and station
bases, and the surround (shelf, three pans, window glow, copper rail, salt cellar). Post effects
are the runtime's `renderer.ao` (GTAO), `bloom` (threshold 0.9), `grade` (display-space S-curve,
saturation 1.1, warm highlights / cool shadows, 0.2 vignette) and `antialias`; the scene uses
ACES tone mapping at exposure 1.05 and a `RoomEnvironment` at intensity 0.5. Render scale,
pixel-ratio cap, adaptive resolution, the frame-rate limit and readout are the runtime's.
Detailed levels also give the title its warm glow and the lamp-glow drift.

---

## 9. Audio direction

**Mix.** Ambience under everything, sparse generative music, one-shots carrying the
information. The runtime's Options own master/music/effects/UI volumes, mute and the voice
limit; the game plays music on the `music` bus and effects and the ambience bed on `effects`,
with the browser build's bus defaults (music 0.6, effects 0.8, ambience 0.4) folded into each
sound's gain. The old voice bus had nothing routed to it and is gone.

**Music and ambience.** During a round: a seeded arpeggio over a five-note scale, one 0.4 s
sine note every 620 ms with a 40 % chance of an added fifth (seeded from the level seed), over a
looped 2 s filtered-noise bed (320 Hz low-pass). Both are rendered once into clips; they stop when
the round ends or is left, and hold while the window is hidden. Clips load one at a time once the
mixer runs (in browsers after the first press); a clip still loading is silent.

**SFX table** (source for `sfx/manifest.txt`):

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
| `tick` | `timer-tick.opus` | One dry mechanical timer click | Clock accent (loaded, not currently triggered) |
| `arrive` | `order-arrive.opus` | Ticket clipped to a rail, two-note chime | A new order enters the rail |
| `warn` | `time-warning.opus` | Timer rattling, three rising dry ticks | Once per round, as a timed round crosses 15 s |

---

## 10. Localization

**Languages:** en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.

The language is the runtime's interface language (`preferences().language`: the player's
choice in Options › Language, else the account's preferred language or the device's), mapped to
the nearest shipped locale (`es-MX → es-419`, `en-AU → en-GB`, `fr → fr-FR`); a change applies on
the next frame without restarting a round (every screen is rebuilt each frame). Code calls
`T('<US-English text>', vars)`; catalogues in `js/locales/` are keyed by the US-English text
(en-GB lists spelling changes, es-ES and fr-CA list their differences). Content stays English data
— family and dish names, themes, lessons, challenges, achievements, rule refusals and hint
sentences — and translates at display time; the rules match on `family` and `tier`, never on a
name. Numbers stay digits. The runtime's own Options are localized by the runtime.

---

## 11. Accessibility

- **Keyboard, gamepad and screen reader:** every screen is `starhermit:ui` widgets with
  focus navigation (arrows / Tab, D-pad / stick), activation (Enter / Space / A) and an
  accessibility tree. Each cell is a button named "Aged Wheel (Dairy tier 4), cell 14",
  "Grain station, cell 32. Activate to generate." or "Empty cell 7"; each order chip is named
  with family, value and seconds left.
- **Announcements** (`ui.announce`): polite for selection, merges, serves with points and
  streak, new orders, hints, lesson progress, pause; assertive for expiries, refusals, the
  15-second warning and round end.
- **Runtime options:** high contrast (the old palette as tokens, no key art), text size, UI
  scale, reduced motion (no sparks, shake or ambient motion).
- **Game options** (Settings): colour-vision palette (3D props and cell edges), left-handed
  controls (rails swapped), haptics.
- **Colour independence:** family is silhouette + glyph (`▬ ● ▮ ▲`) + name.
- **Target sizes:** cells are at least 44 logical px, buttons at least 44 px tall (36 px for
  the small Settings/Scores buttons).

---

## 12. StarHermit integration

The game is a StarHermit engine script game; the runtime provides sign-in, Options (sound,
graphics, language, controls, accessibility), the launch token and the browser loader.

- **Identity:** `player()` — the title line reads "Playing as {name} — Cloud save: synced /
  saving… / unreachable", or "Guest profile — progress is stored on this device." Signed out,
  the title offers **Sign in with StarHermit** (`requestSignIn`); signing out shows a toast.
  The account avatar of the browser build is not shown (the host API has no avatar).
- **Save:** the browser build's document `{ version, savedAt, settings, progress, scores }` is
  the game's save (`saves.save`, schema 1): on the device and, signed in, in the cloud slot.
  `js/session.js`'s `store` keeps its `localStorage` calls; `native/platform.ts` shims them so the
  `kitchen-merge:settings|progress|scores` keys are the document's fields (other keys go to
  device storage). A conflict merges both copies (`mergeDocs`: furthest journey stage, best
  stars, union of lessons, achievements, play days and mastery stages, score tables de-duplicated
  and capped at 20, this device's settings); an account copy that replaced the device's (another
  device saved last) is merged in the same way.
- **Migration:** the browser build's cloud slot (`game:<slug>`, the SDK's saveJSON) shows as a
  foreign save; it is parsed, merged with the device's document and saved over it once
  (`replaceForeign`). The browser build mirrored its settings into the account's settings KV:
  the four game options there (theme, colour-vision palette, left-handed, haptics) are adopted
  once and every old key (volumes, graphics, `ui.language`, `audio.options`, `graphics.gpu.*` …)
  is removed. Guests' old browser `localStorage` progress cannot migrate.
- **Invite link:** signed in, **Invite a friend** copies `inviteLink()` to the clipboard.
- **Clock:** the daily's date is the platform's (`serverNow()`), else the device's UTC date.
- **Leaderboards:** signed in, every finished Journey, Daily or Challenge round (not Practice or
  lessons) posts its total through `score-script.js` (a practice session whose socket carries
  `{ type: 'result', scores: { 'high-score': total } }`; the script range-checks 0–100,000 and
  posts it); results show "Leaderboard rank: #N" (or posting / posted / not posted). Scores ›
  Global reads the high-score board (guests too). Per the platform policy, results are the
  server script's; solo totals stay range-checked client totals, as before.
- **Not used:** multiplayer, rooms, matchmaking, chat, platform achievements (the five
  achievements are flags in the saved progress), commerce.

---

## 13. Technical architecture

**Layering.** `js/rules.js` (pure) ← `js/session.js` (tick, undo, envelope, store) ←
`native/main.ts` (flow, input, platform) → `native/render.ts` / `native/audio.ts` (presentation,
driven by the event list each command and tick returns) and `native/screens.ts` (UI built every
frame from the state). Rendering never mutates rules state.

**Time.** `setFixedRate(60)`; every 6 fixed steps (100 ms) `onFixedUpdate` calls
`session.tick()`, so a round is identical at any frame rate and in play scripts. The lesson's
0.8 s hand-over and the hint's 3 s outline run on the same steps.

**Determinism and replay.** Unchanged from the browser build: commands are stamped with their
tick, the replayer advances to each command's tick, state hashes are FNV-1a over the
deterministic fields.

**Performance.** Item and station views are keyed by `family:tier`; geometry and materials are
disposed when they change; canvas textures are painted once per budget; post effects and budgets
follow the graphics level; the kitchen is drawn only on the play screen.

**Security.** Leaderboard names are drawn as text widgets, never markup.

---

## 14. Testing and acceptance criteria

`npm test` = `test:unit` + `test:native`:

- `tests/rules.test.js` — 16 rules checks (station placement, orders, spawn/merge/submit
  legality and scoring, terminals, expiry, serialization, deterministic replay, tamper and
  duplicate rejection, fuzz, a random full game).
- `tests/session.test.mjs` — the clock advances only on `tick()` while started and unpaused,
  time-up results, practice undo.
- `tests/save.test.mjs` — the browser build's cloud save parses as the engine save and
  migrates intact; `mergeDocs` semantics; the store reads and writes through the shimmed keys.
- `tests/i18n.test.mjs` — every key (from `tests/i18n-keys.mjs`: `T`/`N` calls in `js/` and
  `native/`, content display fields, rule refusals and hints) in all locales with matching
  placeholders, no stray keys.
- `tests/validate-content.js` — all 48 content entries valid, reachable and soft-lock free.
- `tests/native.mjs` — the web index matches the files (`npm run package` ran last), `tsc`
  (no `skipLibCheck`), `starhermit check .` with zero warnings, and every `tests/native/*.play`
  as a signed-out `--render-check`:
  `learn-journey.play` (the three lessons through Play, then Journey stage 1 to "All orders
  served!", Next Stage, the journey pill), `challenge-moves.play` (Thirty Moves played out to
  "Out of moves" with merges, serves and a discard), `practice.play` (station taps, Undo, Hint,
  pause → Settings → back, How to Play, Leave Round), `screens.play` (How to Play, Settings with
  Open Options, Scores local and global, the Daily set-up, the Journey list).
  `npm run plays` regenerates the first two from the rules (tools/gen-plays.mjs).
- `npm run test:browser` (`tools/browser-play.mjs`) — the packaged loader in Chrome on the GPU at
  1366 × 768, a 390 × 844 phone and an 844 × 390 phone held sideways (DPR 3): title, Play →
  Learn, Lesson 1, the station activated twice by keys (desktop) or taps (phones), back to the
  Learn list; fails on console errors or warnings or the runtime's error screen.
  `~/games/tools/engine-web-smoke.mjs` loads it at desktop and phone too.
- Each graphics tier renders natively: `starhermit . --render-check --quality low|balanced|high|ultra
  --script tests/native/practice.play`.

---

## 15. Asset inventory

| Path | Purpose | Status |
|---|---|---|
| `assets/title-keyart.webp` | Title backdrop: lamp-lit miniature counter (FLUX.2 klein, 1536×864) | shipped (title screen) |
| `assets/results-plating.webp` | Results-panel wash: a plate under a service lamp (FLUX.2 klein, 1024×576) | shipped (results dialog) |
| `assets/ui-style.json` | The UI style sheet, converted from `tools/ui-style.css` | generated (`npm run css`) |
| `cover.jpg`, `coverart.png`, `icon.png` | Platform cover and icon | shipped |
| `sfx/*.opus` (14) + manifests | The event clips of §9 (MOSS-SoundEffect v2.0, 48 kHz mono Opus) | shipped |
| 3D props | Procedural `starhermit:scene` geometry in `native/render.ts` | shipped — parametric per tier |
| Music, ambience | Rendered at runtime into clips (`native/audio.ts`) | shipped |

---

## 16. Known limitations

- **Guests' old browser progress:** progress kept only in a browser's `localStorage` (never
  signed in) cannot reach the engine build; cloud saves migrate.
- **The theme setting** only applies to levels without a theme of their own, and every shipped
  level names one (as in the browser build).
- **Lessons 1 and 2 show two orders:** `createGame` opens `level.openOrders || 2` orders, so a
  lesson's `openOrders: 0` still gets two (a rules quirk kept for replay compatibility).
- **Next Stage** shows after any scored Journey round, not only a won one (as before).
- **Cell focus at the grid's edge** moves on to the neighbouring rail buttons (the UI's spatial
  focus navigation); the browser build's roving focus stopped at the edge.
- **Practice seeds** re-roll by the device's UTC date.
- **The daily board is by session id, not by player** in the local tables; the platform board is
  per player.
- **Snapshots** (`store.saveSnapshot`) exist but no screen resumes a round in progress.
- **No hint budget**, and the order draw is uniform (a variance quirk, not a soft lock).
- **Avatar:** the host API has no avatar, so the title line shows the name only.

## 17. Design intent not yet implemented

1. **Resume-in-progress** from the title, using the snapshot slots.
2. **Spoken order callouts** (the old voice bus's intended use).
3. **Player-scoped daily identity** in the local tables.
