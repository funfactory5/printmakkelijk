// Browser test for search/download flows (Thingiverse API mocked) and all library models.
//   node tests/e2e-search.cjs [baseUrl] [--shots dir]
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const { makeCube } = require('./meshes.cjs');

const base = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8765/';
const shotsIdx = process.argv.indexOf('--shots');
const shots = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const popups = [];
  page.context().on('page', (p) => popups.push(p.url()));

  // --- mocked Thingiverse API ---
  await page.route('https://api.thingiverse.com/search/**', (route) => route.fulfill({ headers: CORS, body: JSON.stringify({
    total: 2,
    hits: [
      { id: 111, name: 'Mini Dragon', public_url: 'https://www.thingiverse.com/thing:111', thumbnail: '', creator: { name: 'maker' }, like_count: 42 },
      { id: 222, name: 'Blocked Model', public_url: 'https://www.thingiverse.com/thing:222', thumbnail: '', creator: { name: 'x' } },
    ] }) }));
  await page.route('https://api.thingiverse.com/things/111/files**', (route) => route.fulfill({ headers: CORS, body: JSON.stringify([
    { id: 1, name: 'dragon.stl', formatted_size: '1 kb', download_url: 'https://api.thingiverse.com/files/1/download', direct_url: 'https://cdn.thingiverse.com/assets/dragon.stl' },
    { id: 2, name: 'readme.pdf', download_url: 'https://api.thingiverse.com/files/2/download' },
  ]) }));
  await page.route('https://api.thingiverse.com/things/222/files**', (route) => route.fulfill({ headers: CORS, body: JSON.stringify([
    { id: 3, name: 'blocked.stl', download_url: 'https://api.thingiverse.com/files/3/download', direct_url: 'https://cdn.thingiverse.com/assets/blocked.stl' },
  ]) }));
  await page.route('https://cdn.thingiverse.com/assets/dragon.stl', (route) => route.fulfill({
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/octet-stream' }, body: makeCube(15, 0, 0) }));
  // CORS-blocked downloads (Playwright mocks bypass CORS, so abort = what fetch() sees: a TypeError).
  await page.route('https://cdn.thingiverse.com/assets/blocked.stl', (route) => route.abort('failed'));
  await page.route('https://api.thingiverse.com/files/**', (route) => route.abort('failed'));
  await page.context().route('https://www.thingiverse.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>thing</h1>' }));

  await page.addInitScript(() => localStorage.setItem('pm.seenHelp', 'true'));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#engineStatus').textContent.includes('klaar'), null, { timeout: 30000 });

  // Without token: setup box shows, site links get the query
  await page.fill('#searchInput', 'dragon');
  await page.click('#searchForm button');
  await page.waitForSelector('#tvSetup:not([hidden])');
  const href = await page.getAttribute('#siteLinks a', 'href');
  assert.ok(href.includes('printables.com/search/models?q=dragon'), href);

  // Save token → search runs
  await page.fill('#tokenInput', 'test-token');
  await page.click('#tokenForm button');
  await page.waitForSelector('.thing');
  assert.strictEqual(await page.locator('.thing').count(), 2);
  if (shots) await page.screenshot({ path: path.join(shots, '6-search.png') });

  // Slice a result: single model file is downloaded + loaded + auto-sliced
  await page.locator('.thing').first().locator('button').click();
  await page.waitForSelector('#result:not([hidden])', { timeout: 60000 });
  assert.strictEqual((await page.textContent('#rLayers')).trim(), '75');
  assert.ok((await page.inputValue('#fileName')).startsWith('dragon_'));
  console.log('thingiverse flow ok:', await page.textContent('#sliceMsg'));

  // CORS-blocked download → falls back to opening the model page
  await page.locator('.thing').nth(1).locator('button').click();
  await page.waitForFunction(() => /laat de pagina niet direct downloaden/.test(document.querySelector('#toasts').textContent), null, { timeout: 15000 });
  await page.waitForTimeout(500);
  assert.ok(popups.some((u) => u.includes('thing:222')), 'opened model page: ' + popups.join(','));
  console.log('CORS fallback ok');

  // Pasted GitHub link becomes a raw.githubusercontent.com download
  await page.route('https://raw.githubusercontent.com/**', (route) => route.fulfill({
    headers: { 'Access-Control-Allow-Origin': '*' }, body: makeCube(12, 0, 0) }));
  await page.click('.tab[data-tab="open"]');
  await page.fill('#urlInput', 'https://github.com/someone/models/blob/main/parts/gear.stl');
  await page.click('#urlForm button');
  await page.waitForFunction(() => window.pm.viewer.info().some((i) => i.name === 'gear'), null, { timeout: 15000 });
  console.log('github link ok');

  // Every library model slices on its own
  await page.click('.tab[data-tab="library"]');
  const items = await page.locator('.libitem').count();
  for (let i = 0; i < items; i++) {
    await page.evaluate(() => window.pm.viewer.clearAll());
    const title = await page.locator('.libitem').nth(i).locator('strong').textContent();
    if (/vaas/i.test(title)) await page.evaluate(() => { const v = document.querySelector('#vase'); v.checked = true; v.dispatchEvent(new Event('change')); });
    await page.locator('.libitem').nth(i).locator('button').click();
    await page.waitForFunction(() => /Klaar/.test(document.querySelector('#sliceMsg').textContent) && document.querySelector('#progress').hidden, null, { timeout: 120000 });
    await page.waitForTimeout(300);
    const layers = +(await page.textContent('#rLayers'));
    console.log(`  ${title}: ${layers} lagen, ${await page.textContent('#rTime')}, ${await page.textContent('#rFil')}`);
    assert.ok(layers > 5, title + ' has layers');
    if (/vaas/i.test(title)) {
      await page.evaluate(() => { const v = document.querySelector('#vase'); v.checked = false; v.dispatchEvent(new Event('change')); });
      await page.waitForFunction(() => document.querySelector('#progress').hidden, null, { timeout: 60000 });
    }
    if (shots && i === 0) { await page.click('#viewModel'); await page.screenshot({ path: path.join(shots, '7-keychain.png') }); }
  }

  assert.deepStrictEqual(errors, [], 'no page errors');
  await browser.close();
  console.log('✅ search/library e2e passed');
})().catch((e) => { console.error('❌', e); process.exit(1); });
