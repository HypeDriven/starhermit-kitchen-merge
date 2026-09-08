/**
 * Kitchen Merge — end-to-end playthrough test.
 *
 * Drives the real visible UI in headless Chrome (playwright-core + system
 * Chrome): title → settings → Learn lessons 1-3 (spawn/merge/serve) →
 * Journey stage 1 played to the results screen → next stage with
 * pause/resume/Esc/pause-settings → Practice with hint + undo.
 * Two passes: desktop 1280x800, then a fresh context at mobile 390x844
 * with touch. Screenshots land in /tmp/kitchen-merge-e2e-<stage>-<pass>.png.
 *
 * Self-contained: embeds a minimal static server on an ephemeral port.
 * (server.js is the StarHermit authoritative script — not used here.)
 * The game detects the missing /api backend and runs in its supported
 * offline mode; ranked daily submission is the only feature that needs the
 * platform backend and is not exercised.
 *
 * Run: npm run test:e2e
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ts': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (url.pathname === '/' || url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// Benign GPU/swiftshader noise (from tools/production_game_audit.mjs).
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const SHOT = (stage, pass) => `/tmp/kitchen-merge-e2e-${stage}-${pass}.png`;
const visible = (sel) => `${sel}:not(.hidden)`;
const cell = (i) => `#board-dom .cell[data-index="${i}"]`;

async function boardInfo(page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll('#board-dom .cell')];
    const items = [];
    const gens = [];
    let match = -1;
    cells.forEach((el, i) => {
      if (el.dataset.kind === 'gen') gens.push(i);
      else if (el.dataset.kind === 'item') {
        const t = el.querySelector('.tier');
        items.push({ i, family: el.dataset.family, tier: t ? parseInt(t.textContent.slice(1), 10) : 1 });
        if (el.classList.contains('match')) match = i;
      }
    });
    return { items, gens, match, count: cells.length };
  });
}

// Play a round through the visible board UI until `untilSel` is visible.
// Strategy mirrors the hint engine: serve a matching dish, else merge an
// identical pair, else tap a station to spawn. Lesson completions return to
// the list after an 800 ms toast delay, so a click may race that teardown —
// if the target screen is up, the round is done and that is success.
async function playRound(page, untilSel, { timeout = 90000 } = {}) {
  const deadline = Date.now() + timeout;
  const done = () => page.locator(visible(untilSel)).isVisible();
  let actions = 0;
  while (Date.now() < deadline) {
    if (await done()) return actions;
    const b = await boardInfo(page);
    try {
      if (b.match >= 0) {
        await page.click(cell(b.match), { timeout: 5000 });
        await page.waitForSelector('#btn-serve:not([disabled])', { timeout: 3000 });
        await page.click('#btn-serve', { timeout: 5000 });
      } else {
        const pair = b.items.find((a) => b.items.some((x) => x.i !== a.i && x.family === a.family && x.tier === a.tier && a.tier < 5));
        if (pair) {
          const other = b.items.find((x) => x.i !== pair.i && x.family === pair.family && x.tier === pair.tier);
          await page.click(cell(pair.i), { timeout: 5000 });
          await page.click(cell(other.i), { timeout: 5000 });
        } else if (b.gens.length) {
          await page.click(cell(b.gens[0]), { timeout: 5000 });
        } else {
          await page.waitForTimeout(300);
        }
      }
    } catch (e) {
      if (await done()) return actions;
      const diag = await page.evaluate(() => ({
        screens: [...document.querySelectorAll('.screen')].map((s) => s.id + (s.classList.contains('hidden') ? ':H' : ':V')).join(' '),
        overlays: [...document.querySelectorAll('.overlay')].map((s) => s.id + (s.classList.contains('hidden') ? ':H' : ':V')).join(' '),
      }));
      console.error('playRound click diagnostics:', JSON.stringify(diag));
      if (process.env.E2E_TRACE) console.error('transitions:', JSON.stringify(await page.evaluate(() => window.__log)));
      throw e;
    }
    actions++;
    await page.waitForTimeout(220);
  }
  throw new Error(`playRound timed out waiting for ${untilSel}`);
}

async function runPass(browser, pass, viewport, hasTouch) {
  const context = await browser.newContext({ viewport, hasTouch });
  const page = await context.newPage();
  if (process.env.E2E_TRACE) {
    await page.addInitScript(() => {
      window.__log = [];
      window.addEventListener('DOMContentLoaded', () => {
        const rec = () => {
          const vis = [...document.querySelectorAll('.screen')].filter((s) => !s.classList.contains('hidden')).map((s) => s.id).join(',');
          const last = window.__log[window.__log.length - 1];
          if (!last || last.vis !== vis) window.__log.push({ t: performance.now() | 0, vis, toast: document.getElementById('toast').textContent, live: document.getElementById('live').textContent });
        };
        new MutationObserver(rec).observe(document.getElementById('app'), { attributes: true, subtree: true, attributeFilter: ['class'] });
        rec();
      });
    });
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (browserNoise.test(m.text())) return;
    // The game probes the platform API on boot and falls back to its
    // supported offline mode; our static server 404s those probes.
    if (/Failed to load resource/.test(m.text()) && (m.location()?.url || '').includes('/api/')) return;
    errors.push(`console: ${m.text()}`);
  });

  const step = async (name, fn) => {
    await fn();
    console.log(`ok - [${pass}] ${name}`);
  };
  const base = `http://localhost:${server.address().port}`;

  await step('load → title visible', async () => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForSelector(visible('#screen-title'), { timeout: 10000 });
    const themes = await page.locator('#set-theme option').count();
    if (themes !== 5) throw new Error(`theme select not populated (JS boot failed?), got ${themes}`);
    await page.screenshot({ path: SHOT('title', pass) });
  });

  if (pass === 'desktop') {
    await step('settings open → toggle → close', async () => {
      await page.click('#btn-settings');
      await page.waitForSelector(visible('#screen-settings'));
      await page.check('#set-high-contrast');
      if (!(await page.evaluate(() => document.body.classList.contains('high-contrast')))) {
        throw new Error('high-contrast not applied to body');
      }
      await page.screenshot({ path: SHOT('settings', pass) });
      await page.uncheck('#set-high-contrast');
      await page.click('#screen-settings [data-back]');
      await page.waitForSelector(visible('#screen-title'));
    });

    // New player: Play opens the Learn list (tutorials not done yet).
    await step('Play → Learn list with 3 lessons', async () => {
      await page.click('#btn-play');
      await page.waitForSelector(visible('#screen-list'));
      const lessons = await page.locator('#list-items .btn').count();
      if (lessons !== 3) throw new Error(`expected 3 lessons, got ${lessons}`);
      await page.screenshot({ path: SHOT('learn', pass) });
    });

    await step('lesson 1 (generate) completes', async () => {
      await page.locator('#list-items .btn').nth(0).click();
      await page.waitForSelector(visible('#screen-setup'));
      await page.click('#btn-start');
      await page.waitForSelector(visible('#screen-play'));
      const b = await boardInfo(page);
      if (b.count !== 36) throw new Error(`expected 36 cells, got ${b.count}`);
      if (b.gens.length !== 1) throw new Error(`expected 1 station, got ${b.gens.length}`);
      await page.click(cell(b.gens[0]));
      await page.waitForFunction(() => document.querySelectorAll('#board-dom .cell[data-kind="item"]').length === 1);
      await page.screenshot({ path: SHOT('lesson1', pass) });
      await page.click(cell(b.gens[0]));
      await page.waitForSelector(visible('#screen-list'), { timeout: 6000 });
    });

    await step('lesson 2 (merge) completes', async () => {
      await page.locator('#list-items .btn').nth(1).click();
      await page.click('#btn-start');
      await page.waitForSelector(visible('#screen-play'));
      const done = await playRound(page, '#screen-list');
      if (done < 3) throw new Error('lesson 2 finished without spawn+merge actions');
      const b = await boardInfo(page);
      if (!b.items.some((it) => it.family === 'grain' && it.tier === 2)) {
        throw new Error('expected a tier-2 Dough after merge: ' + JSON.stringify(b.items));
      }
    });

    await step('lesson 3 (serve an order) completes', async () => {
      await page.locator('#list-items .btn').nth(2).click();
      await page.click('#btn-start');
      await page.waitForSelector(visible('#screen-play'));
      await page.waitForSelector('#orders-list .order');
      const orderName = await page.locator('#orders-list .order-name').first().textContent();
      console.log(`  [${pass}] waiting order: ${orderName}`);
      await playRound(page, '#screen-list');
      await page.screenshot({ path: SHOT('lesson3-done', pass) });
    });

    await step('journey list: 40 stages, only stage 1 unlocked', async () => {
      await page.click('#screen-list [data-back]');
      await page.waitForSelector(visible('#screen-title'));
      await page.click('#btn-journey');
      await page.waitForSelector(visible('#screen-list'));
      const stages = await page.locator('#list-items .btn').count();
      if (stages !== 40) throw new Error(`expected 40 stages, got ${stages}`);
      const locked = await page.locator('#list-items .btn.locked').count();
      if (locked !== 39) throw new Error(`expected 39 locked stages, got ${locked}`);
    });

    await step('journey stage 1 played to results screen', async () => {
      await page.locator('#list-items .btn').first().click();
      await page.waitForSelector(visible('#screen-setup'));
      await page.screenshot({ path: SHOT('setup', pass) });
      await page.click('#btn-start');
      await page.waitForSelector(visible('#screen-play'));
      await page.waitForTimeout(800);
      await page.screenshot({ path: SHOT('play', pass) });
      await playRound(page, '#overlay-results');
      const rows = await page.locator('#results-breakdown dt').count();
      if (rows < 6) throw new Error(`expected results breakdown rows, got ${rows}`);
      const reason = await page.textContent('#results-reason');
      const total = await page.textContent('#results-total');
      console.log(`  [${pass}] results: ${reason} / ${total}`);
      if (reason !== 'All orders served!') throw new Error(`unexpected end reason: ${reason}`);
      if (!(await page.locator(visible('#btn-next')).isVisible())) throw new Error('Next Stage not offered');
      await page.screenshot({ path: SHOT('results', pass) });
    });

    await step('progression persisted (stage 2 unlocked, stars saved)', async () => {
      const p = await page.evaluate(() => JSON.parse(localStorage.getItem('kitchen-merge:progress')));
      if (p.journeyStage !== 2) throw new Error('journeyStage not advanced: ' + JSON.stringify(p));
      if (!(p.stars['1'] >= 1)) throw new Error('stage 1 stars not saved');
      if (p.tutorialsDone.length !== 3) throw new Error('tutorials not marked done');
    });

    await step('next stage → pause/resume (button + Esc) → pause settings → leave', async () => {
      await page.click('#btn-next');
      await page.waitForSelector(visible('#screen-setup'));
      await page.click('#btn-start');
      await page.waitForSelector(visible('#screen-play'));
      const b = await boardInfo(page);
      await page.click(cell(b.gens[0]));
      await page.waitForFunction(() => document.querySelectorAll('#board-dom .cell[data-kind="item"]').length === 1);
      await page.click('#btn-pause');
      await page.waitForSelector(visible('#overlay-pause'));
      await page.screenshot({ path: SHOT('pause', pass) });
      await page.click('#btn-resume');
      await page.waitForSelector('#overlay-pause.hidden', { state: 'attached' });
      await page.keyboard.press('Escape');
      await page.waitForSelector(visible('#overlay-pause'));
      await page.click('#btn-pause-settings');
      await page.waitForSelector(visible('#screen-settings'));
      await page.click('#screen-settings [data-back]');
      await page.waitForSelector(visible('#screen-play'));
      await page.keyboard.press('Escape');
      await page.waitForSelector(visible('#overlay-pause'));
      await page.click('#btn-leave');
      await page.waitForSelector(visible('#screen-title'));
    });

    await step('practice relaxed: hint + merge + undo', async () => {
      await page.click('#btn-practice');
      await page.waitForSelector(visible('#screen-list'));
      await page.locator('#list-items .btn', { hasText: 'Relaxed' }).click();
      await page.click('#btn-start');
      await page.waitForSelector(visible('#screen-play'));
      const b = await boardInfo(page);
      await page.click(cell(b.gens[0]));
      await page.waitForFunction(() => document.querySelectorAll('#board-dom .cell[data-kind="item"]').length === 1);
      await page.click('#btn-hint');
      await page.waitForSelector(visible('#toast'));
      const hint = await page.textContent('#toast');
      if (!hint) throw new Error('hint produced no toast');
      console.log(`  [${pass}] hint: ${hint}`);
      await page.click(cell(b.gens[0]));
      await page.waitForFunction(() => document.querySelectorAll('#board-dom .cell[data-kind="item"]').length === 2);
      const b2 = await boardInfo(page);
      await page.click(cell(b2.items[0].i));
      await page.click(cell(b2.items[1].i));
      await page.waitForFunction(() => document.querySelectorAll('#board-dom .cell[data-kind="item"]').length === 1);
      await page.waitForSelector('#btn-undo:not([disabled])');
      await page.click('#btn-undo');
      await page.waitForFunction(() => document.querySelectorAll('#board-dom .cell[data-kind="item"]').length === 2);
      await page.screenshot({ path: SHOT('practice', pass) });
      await page.keyboard.press('Escape');
      await page.click('#btn-leave');
      await page.waitForSelector(visible('#screen-title'));
    });

    await step('scores screen shows the saved local score', async () => {
      await page.click('#btn-scores');
      await page.waitForSelector(visible('#screen-scores'));
      const tables = await page.locator('#scores-list table').count();
      if (tables < 1) throw new Error('no local scores recorded');
      await page.click('#screen-scores [data-back]');
      await page.waitForSelector(visible('#screen-title'));
    });
  } else {
    // Mobile pass: fresh profile — go straight to Journey stage 1 via touch.
    await step('journey stage 1 playable by touch to results', async () => {
      await page.click('#btn-journey');
      await page.waitForSelector(visible('#screen-list'));
      await page.locator('#list-items .btn').first().click();
      await page.waitForSelector(visible('#screen-setup'));
      await page.click('#btn-start');
      await page.waitForSelector(visible('#screen-play'));
      const box = await page.locator('#board-dom .cell').first().boundingBox();
      if (!box || box.width < 44 || box.height < 44) throw new Error('board cells too small on mobile: ' + JSON.stringify(box));
      await page.waitForTimeout(600);
      await page.screenshot({ path: SHOT('play', pass) });
      await playRound(page, '#overlay-results');
      const reason = await page.textContent('#results-reason');
      if (reason !== 'All orders served!') throw new Error(`unexpected end reason: ${reason}`);
      await page.screenshot({ path: SHOT('results', pass) });
      await page.click('#btn-results-title');
      await page.waitForSelector(visible('#screen-title'));
    });

    await step('pause/resume on mobile', async () => {
      await page.click('#btn-practice');
      await page.locator('#list-items .btn', { hasText: 'Relaxed' }).click();
      await page.click('#btn-start');
      await page.waitForSelector(visible('#screen-play'));
      const b = await boardInfo(page);
      await page.click(cell(b.gens[0]));
      await page.click('#btn-pause');
      await page.waitForSelector(visible('#overlay-pause'));
      await page.screenshot({ path: SHOT('pause', pass) });
      await page.click('#btn-resume');
      await page.waitForSelector('#overlay-pause.hidden', { state: 'attached' });
      await page.keyboard.press('Escape');
      await page.waitForSelector(visible('#overlay-pause'));
      await page.click('#btn-leave');
      await page.waitForSelector(visible('#screen-title'));
    });
  }

  await context.close();
  if (errors.length) {
    throw new Error(`[${pass}] page errors:\n` + errors.join('\n'));
  }
  console.log(`ok - [${pass}] no page errors`);
}

let browser = null;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--mute-audio'],
  });
  await runPass(browser, 'desktop', { width: 1280, height: 800 }, false);
  await runPass(browser, 'mobile', { width: 390, height: 844 }, true);
  console.log('\nE2E PASS — kitchen-merge, desktop + mobile, no page errors');
} catch (e) {
  console.error('\nE2E FAIL:', e.message || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
