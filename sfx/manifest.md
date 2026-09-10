# SFX manifest — kitchen-merge

Canonical source: `manifest.txt`. Generator entries: `manifest.json`.

Generated with MOSS-SoundEffect v2.0, 48 kHz mono Opus (96 kbps VBR, loudness-normalized; 100 inference steps).

| file | event | prompt | usage |
|---|---|---|---|
| ui-confirm.opus | ack | Short soft UI button click, a gentle wooden tap with a quick muted click, clean, dry, no reverb. | Every board cell activation and the Undo confirmation — the "input received" acknowledgement. |
| item-select.opus | select | Light pluck of a small metal utensil tapping the rim of a ceramic bowl, bright short tick, close mic. | Picking up an ingredient (first tap of a two-tap merge, or the start of a drag). |
| ingredient-spawn.opus | spawn | Soft pop of a fresh vegetable landing on a wooden cutting board, gentle organic thump with a slight bounce. | A station produces a tier-1 ingredient onto a free cell. |
| merge-pop.opus | merge | Juicy wet pop of two soft food items squishing together into one, followed by a brief tiny sparkle shimmer. | Two identical items combine into the next tier. |
| action-denied.opus | invalid | Short dull double knock on a wooden kitchen door, low and muted, a gentle refusal without harshness. | Any rejected command; pairs with the written reason from explainInvalid(). |
| order-serve.opus | submit | Small brass restaurant service bell ding followed by a plate being set down softly on a counter, bright and satisfying. | A dish is served against a matching order at streak 1 or 2. |
| streak-bonus.opus | streak | Quick ascending cascade of three small glass chimes with a light kitchen clatter, cheerful and energetic. | A serve at streak 3 or higher; replaces the plain submit cue. |
| order-expire.opus | expire | Gentle descending airy sigh of steam escaping as a pot is lifted off the heat, soft and deflating. | An order's timer reaches zero and the streak resets. |
| discard-item.opus | trash | Crinkling food wrapper dropped into a metal trash bin, ending with a soft hollow clang. | The Discard action clears a cell. |
| round-win.opus | win | Cheerful small restaurant kitchen celebration, happy service bell dings, plates chiming and a short rising sparkle flourish. | Terminal reason orders-complete, under the results overlay. |
| round-lose.opus | lose | Gentle disappointed descending phrase on a wooden marimba in a quiet kitchen, soft, warm and sympathetic. | Terminal reasons time-up and moves-exhausted. |
| timer-tick.opus | tick | Single quiet mechanical kitchen timer tick, one short dry click, no ring. | Low-priority clock accent; reserved for timer emphasis. |
| order-arrive.opus | arrive | A small paper order ticket clipped onto a metal rail in a restaurant kitchen, a light paper rustle and a soft bright two-note chime, clean and inviting. | A new order enters the rail (the new-order event), so a queue change is audible without watching the left rail. |
| time-warning.opus | warn | An urgent mechanical kitchen timer beginning to rattle, three quick dry ticks rising slightly in pitch with a faint metallic tension, tense but not harsh. | Fires once per round the first time a timed round's clock crosses fifteen seconds, alongside the assertive live-region announcement. |
