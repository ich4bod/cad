/* Keyboard inspection smoke test. Run with the Playwright container as the other verifiers do. */
'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const base = (process.argv[2] || 'http://host.docker.internal:8080').replace(/\/$/, '');
const fail = (message) => { throw new Error(message); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await page.goto(base + '/', { waitUntil: 'load' });
  if (response.status() !== 200) fail(`GET / returned ${response.status()}`);
  await page.waitForFunction(() => window.__cad?.ready);
  if (await page.isVisible('#tour')) await page.click('#tour-skip');

  const scene = page.locator('#scene');
  if (await scene.getAttribute('tabindex') !== '0') fail('scene is not keyboard focusable');
  if (await scene.getAttribute('aria-describedby') !== 'scene-keys') fail('scene has no keyboard instructions');
  await page.keyboard.press('Tab');
  if (!(await scene.evaluate((el) => document.activeElement === el))) fail('scene did not receive keyboard focus');
  const outline = await scene.evaluate((el) => getComputedStyle(el).outlineWidth);
  if (outline !== '4px') fail(`focused scene has no visible focus outline (${outline})`);

  await page.keyboard.press(']');
  const selected = await page.evaluate(() => window.__cad.selectedId());
  if (selected !== null) fail('empty scene selected a shape');
  await page.keyboard.press('ArrowLeft');
  const turned = await page.evaluate(() => window.__cad.cameraPos());
  await page.keyboard.press('Home');
  const reset = await page.evaluate(() => window.__cad.cameraPos());
  if (Math.hypot(reset.x - 115, reset.y - 105, reset.z - 150) > 0.01) fail('Home did not reset the view');
  if (Math.hypot(turned.x - reset.x, turned.y - reset.y, turned.z - reset.z) < 1) fail('ArrowLeft did not rotate the view');

  // From the focused canvas, Tab reaches the normal button controls. Enter
  // performs their existing actions, so no mouse is needed to make a model.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await scene.focus();
  await page.keyboard.press(']');
  const first = await page.evaluate(() => window.__cad.selectedId());
  await page.keyboard.press(']');
  const second = await page.evaluate(() => window.__cad.selectedId());
  if (!first || !second || first === second) fail('bracket keys did not cycle shapes');
  const hint = await page.locator('#hint').textContent();
  if (!hint.startsWith('Selected ')) fail('selection state was not announced');
  if (errors.length) fail(errors.join(' | '));

  await browser.close();
  console.log('PASS keyboard inspection: focus, selection, rotation, reset, and live announcement');
})().catch((error) => { console.error(error); process.exit(1); });
