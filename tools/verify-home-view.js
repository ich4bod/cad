/* Home view browser check. Run with the Playwright container used by the other verifiers. */
'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const base = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
const sameVector = (actual, expected) =>
  Math.hypot(actual.x - expected.x, actual.y - expected.y, actual.z - expected.z) < 0.01;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const response = await page.goto(base + '/', { waitUntil: 'load' });
  if (response.status() !== 200) throw new Error(`GET / returned ${response.status()}`);
  await page.waitForFunction(() => window.__cad?.ready);
  if (await page.isVisible('#tour')) await page.click('#tour-skip');

  const before = await page.evaluate(() => ({
    camera: window.__cad.cameraPos(), target: window.__cad.cameraTarget(),
  }));
  const scene = page.locator('#scene');
  await scene.hover();
  await page.mouse.down();
  await page.mouse.move(300, 360, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const orbited = await page.evaluate(() => ({
    camera: window.__cad.cameraPos(), target: window.__cad.cameraTarget(),
  }));
  if (sameVector(orbited.camera, before.camera) && sameVector(orbited.target, before.target)) {
    throw new Error('orbit did not change the camera state');
  }

  await page.click('#btn-home');
  const restored = await page.evaluate(() => ({
    camera: window.__cad.cameraPos(), target: window.__cad.cameraTarget(),
  }));
  if (!sameVector(restored.camera, before.camera) || !sameVector(restored.target, before.target)) {
    throw new Error('Home view did not restore the initial camera state');
  }

  await browser.close();
  console.log('home view restores the Shape Maker camera');
})().catch(async (error) => { console.error(error); process.exit(1); });
