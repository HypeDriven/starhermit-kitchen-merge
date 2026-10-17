// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts a Relaxed Practice round and keeps playing through the visible board (tap a station to spawn,
// merge identical pairs, serve matching dishes), so items, merge bursts and the ambient scene animate.
// A finished round is restarted with Retry.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

const visible = (sel) => `${sel}:not(.hidden)`;
const cell = (i) => `#board-dom .cell[data-index="${i}"]`;

export async function setPreset(page, preset) {
  await page.waitForSelector(visible('#screen-title'), { timeout: 20000 });
  await page.click('#btn-settings');
  await page.waitForSelector(visible('#screen-settings'));
  await page.selectOption('#set-tier', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.click('#screen-settings [data-back]');
  await page.waitForSelector(visible('#screen-title'));
}

async function launch(page) {
  await page.click('#btn-practice');
  await page.locator('#list-items .btn', { hasText: 'Relaxed' }).click();
  await page.click('#btn-start');
  await page.waitForSelector(visible('#screen-play'));
}

async function board(page) {
  return page.evaluate(() => {
    const items = [], gens = [];
    let match = -1;
    document.querySelectorAll('#board-dom .cell').forEach((el, i) => {
      if (el.dataset.kind === 'gen') gens.push(i);
      else if (el.dataset.kind === 'item') {
        const t = el.querySelector('.tier');
        items.push({ i, family: el.dataset.family, tier: t ? parseInt(t.textContent.slice(1), 10) : 1 });
        if (el.classList.contains('match')) match = i;
      }
    });
    return { items, gens, match };
  });
}

export async function start(page) {
  await launch(page);
  let stopped = false, g = 0;
  page.once('close', () => { stopped = true; });
  (async () => {
    while (!stopped) {
      try {
        if (await page.locator(visible('#overlay-results')).count()) {
          await page.click('#btn-retry', { timeout: 2000 });
          continue;
        }
        const b = await board(page);
        if (b.match >= 0) {
          await page.click(cell(b.match), { timeout: 1000 });
          await page.click('#btn-serve:not([disabled])', { timeout: 1000 });
        } else {
          const pair = b.items.find((a) => b.items.some((x) => x.i !== a.i && x.family === a.family && x.tier === a.tier && a.tier < 5));
          if (pair && b.items.length > 6) {
            const other = b.items.find((x) => x.i !== pair.i && x.family === pair.family && x.tier === pair.tier);
            await page.click(cell(pair.i), { timeout: 1000 });
            await page.click(cell(other.i), { timeout: 1000 });
          } else if (b.gens.length) {
            await page.click(cell(b.gens[g++ % b.gens.length]), { timeout: 1000 });
          }
        }
      } catch { /* screen changing */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  })();
  await page.waitForTimeout(3000);
}
