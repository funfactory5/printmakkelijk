// End-to-end test in a real browser:  node tests/e2e.cjs [baseUrl] [--shots dir]
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const { makeCube } = require('./meshes.cjs');

const base = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:8765/';
const shotsIdx = process.argv.indexOf('--shots');
const shots = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('pm.seenHelp', 'true'));
  await page.goto(base);

  await page.waitForFunction(() => document.querySelector('#engineStatus').textContent.includes('klaar'), null, { timeout: 30000 });
  console.log('engine ready');
  await shot(page, '1-empty');

  // Upload an STL (auto-slice is on by default)
  await page.click('.tab[data-tab="open"]');
  await page.setInputFiles('#fileInput', { name: 'testcube.stl', mimeType: 'model/stl', buffer: makeCube(20, 0, 0) });
  await page.waitForSelector('#result:not([hidden])', { timeout: 60000 });
  const layers = await page.textContent('#rLayers');
  const time = await page.textContent('#rTime');
  const file = await page.inputValue('#fileName');
  console.log('sliced:', { layers, time, file, msg: await page.textContent('#sliceMsg') });
  assert.strictEqual(layers.trim(), '100');
  assert.ok(/min|u/.test(time));
  assert.ok(/^testcube_PLA_02mm\.gcode$/.test(file), file);
  await shot(page, '2-sliced-layers');

  // Download works and contains real G-code
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadBtn')]);
  const stream = await dl.createReadStream();
  let gcode = '';
  for await (const chunk of stream) gcode += chunk;
  assert.ok(gcode.includes(';LAYER:99') && gcode.includes('M190 S60') && /;TIME:\d+/.test(gcode));
  console.log('download ok', dl.suggestedFilename(), gcode.length, 'bytes');

  // Layer slider
  await page.fill('#layerSlider', '10');
  await page.dispatchEvent('#layerSlider', 'input');
  assert.ok((await page.textContent('#layerLabel')).startsWith('11 / 100'));

  // Settings change → re-slice (PETG + fine)
  await page.click('#materialSeg button[data-value="PETG"]');
  await page.waitForFunction(() => /PETG/.test(document.querySelector('#sliceMsg').textContent), null, { timeout: 60000 });
  assert.ok(/PETG/.test(await page.inputValue('#fileName')));
  console.log('re-slice ok:', await page.textContent('#sliceMsg'));

  // Library: keychain with name (text geometry) + box (2 parts)
  await page.click('#viewModel');
  await page.click('.tab[data-tab="library"]');
  await page.locator('.libitem').first().locator('button').click();
  await page.locator('.libitem').nth(3).locator('button').click();
  await page.waitForFunction(() => window.pm.viewer.count === 4, null, { timeout: 15000 });
  await page.waitForFunction(() => /Klaar/.test(document.querySelector('#sliceMsg').textContent) && !document.querySelector('#progress:not([hidden])'), null, { timeout: 90000 });
  await page.waitForTimeout(500);
  console.log('plate with 4 objects sliced:', await page.textContent('#sliceMsg'), await page.textContent('#rLayers'));
  await page.click('#viewModel');
  await shot(page, '3-plate');
  await page.click('#viewGcode');
  await shot(page, '4-plate-layers');

  // Mobile layout renders without horizontal scroll
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.ok(!overflow, 'no horizontal scroll on mobile');
  await shot(page, '5-mobile');

  const real = errors.filter((e) => !/favicon/.test(e));
  if (real.length) console.log('console errors:', real);
  assert.strictEqual(real.length, 0, 'no console errors');
  await browser.close();
  console.log('✅ e2e passed');
})().catch((e) => { console.error('❌', e); process.exit(1); });
