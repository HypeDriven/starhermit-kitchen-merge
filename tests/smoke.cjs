// Headless browser smoke test: load the game, walk the main flow,
// capture console errors. Requires: node server.js running on $PORT.
const puppeteer = require('puppeteer-core');

(async () => {
  const port = process.env.PORT || 8137;
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  const fails = [];
  const check = (cond, name) => { console.log((cond ? 'ok — ' : 'FAIL — ') + name); if (!cond) fails.push(name); };

  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 800));

  check(await page.$eval('#screen-title', (e) => !e.classList.contains('hidden')), 'title screen visible');
  check(await page.$eval('#set-theme', (e) => e.options.length === 5), 'theme select populated (JS boot ran)');
  const webgl = await page.evaluate(() => { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); });
  console.log('  (webgl available in headless: ' + webgl + ')');

  // First Play press opens Learn (tutorials not done).
  await page.click('#btn-play');
  await new Promise((r) => setTimeout(r, 300));
  check(await page.$eval('#screen-list', (e) => !e.classList.contains('hidden')), 'learn list opens for new player');
  check(await page.$eval('#list-items', (e) => e.children.length === 3), 'three lessons listed');

  // Start lesson 1.
  await page.click('#list-items .btn');
  await new Promise((r) => setTimeout(r, 300));
  check(await page.$eval('#screen-setup', (e) => !e.classList.contains('hidden')), 'setup screen shows');
  await page.click('#btn-start');
  await new Promise((r) => setTimeout(r, 800));
  check(await page.$eval('#screen-play', (e) => !e.classList.contains('hidden')), 'play screen shows');
  const cells = await page.$eval('#board-dom', (e) => e.children.length);
  check(cells === 36, 'board has 36 DOM cells, got ' + cells);
  const gens = await page.$$eval('#board-dom .cell[data-kind="gen"]', (els) => els.length);
  check(gens === 1, 'lesson 1 has one generator, got ' + gens);

  // Tap the generator twice → lesson 1 completes.
  const genSel = '#board-dom .cell[data-kind="gen"]';
  await page.click(genSel);
  await new Promise((r) => setTimeout(r, 300));
  const items1 = await page.$$eval('#board-dom .cell[data-kind="item"]', (els) => els.length);
  check(items1 === 1, 'spawn produced an item');
  await page.click(genSel);
  await new Promise((r) => setTimeout(r, 1200));
  check(await page.$eval('#screen-list', (e) => !e.classList.contains('hidden')), 'lesson completes and returns to Learn');

  // Pause flow from a journey round.
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    localStorage.setItem('kitchen-merge:progress', JSON.stringify({ journeyStage: 1, stars: {}, tutorialsDone: ['learn-1', 'learn-2', 'learn-3'], achievements: {}, playDays: [], masteryDone: 0 }));
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await new Promise((r) => setTimeout(r, 400));
  await page.click('#btn-journey');
  await new Promise((r) => setTimeout(r, 300));
  const stages = await page.$$eval('#list-items .btn', (els) => els.length);
  check(stages === 40, 'journey lists 40 stages');
  const locked = await page.$$eval('#list-items .btn.locked', (els) => els.length);
  check(locked === 38, 'locked stages enforced, got ' + locked);
  await page.click('#list-items .btn');
  await new Promise((r) => setTimeout(r, 200));
  await page.click('#btn-start');
  await new Promise((r) => setTimeout(r, 600));
  // Merge flow: spawn two grain items, select one then the other.
  const genSel2 = '#board-dom .cell[data-kind="gen"]';
  await page.click(genSel2);
  await new Promise((r) => setTimeout(r, 250));
  await page.click(genSel2);
  await new Promise((r) => setTimeout(r, 250));
  const twoItems = await page.$$eval('#board-dom .cell[data-kind="item"]', (els) => els.map((e) => e.dataset.index));
  check(twoItems.length === 2, 'two items on board');
  await page.click(`#board-dom .cell[data-index="${twoItems[0]}"]`);
  await new Promise((r) => setTimeout(r, 150));
  await page.click(`#board-dom .cell[data-index="${twoItems[1]}"]`);
  await new Promise((r) => setTimeout(r, 250));
  const merged = await page.$$eval('#board-dom .cell[data-kind="item"]', (els) => els.map((e) => e.textContent));
  check(merged.length === 1 && merged[0].includes('Dough'), 'merge produced Dough: ' + JSON.stringify(merged));

  // Pause overlay.
  await page.click('#btn-pause');
  await new Promise((r) => setTimeout(r, 200));
  check(await page.$eval('#overlay-pause', (e) => !e.classList.contains('hidden')), 'pause overlay opens');
  await page.click('#btn-resume');
  await new Promise((r) => setTimeout(r, 200));
  check(await page.$eval('#overlay-pause', (e) => e.classList.contains('hidden')), 'resume closes pause');

  // Keyboard: Esc opens pause.
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 200));
  check(await page.$eval('#overlay-pause', (e) => !e.classList.contains('hidden')), 'Esc pauses');
  await page.click('#btn-leave');
  await new Promise((r) => setTimeout(r, 300));
  check(await page.$eval('#screen-title', (e) => !e.classList.contains('hidden')), 'leave returns to title');

  // Hint button exists and announces.
  check(errors.length === 0, 'no console/page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

  await browser.close();
  console.log(fails.length ? '\nSMOKE FAILED: ' + fails.length : '\nSMOKE PASSED');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('SMOKE ERROR', e); process.exit(1); });
