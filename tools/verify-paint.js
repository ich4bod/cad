'use strict';

const { chromium } = require('playwright-core');

const RAW_URL = process.argv[2] || 'https://cad.ichabod-crane.net/';
const BASE = RAW_URL.endsWith('/') ? RAW_URL.slice(0, -1) : RAW_URL;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  const shapes = () => page.evaluate(() => window.__cad.shapes());
  const paint = async (id, name) => {
    await page.evaluate((shapeId) => window.selectShapeById(shapeId), id);
    await page.click(`[data-paint="${name}"]`);
  };
  const paintsById = async () => page.evaluate(() =>
    Object.fromEntries(window.__cad.shapes().map((shape) => [shape.id, shape.paint])));

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__cad?.ready, null, { timeout: 30000 });
    if (await page.isVisible('#tour')) await page.click('#tour-skip');

    // Seven-piece castle with deliberately mixed starting colors.
    await page.click('#starter-castle');
    const castle = await shapes();
    assert(castle.length === 7, `Expected seven castle pieces, got ${castle.length}`);
    await paint(1, 'coral');
    await paint(4, 'sky');
    await paint(7, 'leaf');
    const mixed = await paintsById();
    assert(mixed[1] === 'coral' && mixed[4] === 'sky' && mixed[7] === 'leaf',
      `Mixed castle colors were not applied: ${JSON.stringify(mixed)}`);

    // Whole-build yellow is one edit, then one Undo restores the mixed castle.
    await page.click('#btn-paint-build');
    assert(await page.evaluate(() => window.__cad.paintBuildEnabled()), 'Whole-build mode did not turn on');
    assert(await page.locator('#btn-paint-build').textContent() === 'Choose a color for every piece' &&
      await page.locator('#btn-paint-build').getAttribute('aria-label') === 'Choose a color for every piece',
      'Pressed whole-build label was wrong');
    await page.click('[data-paint="sun"]');
    assert(!(await page.evaluate(() => window.__cad.paintBuildEnabled())), 'Whole-build mode stayed on');
    assert((await page.locator('#hint').textContent()) === 'Painted the whole build sun!', 'Whole-build hint was wrong');
    assert((await shapes()).every((shape) => shape.paint === 'sun'), 'Whole-build yellow did not reach every piece');
    await page.click('#btn-undo');
    assert(JSON.stringify(await paintsById()) === JSON.stringify(mixed), 'One Undo did not restore mixed colors');

    // Whole-build Unpaint works with no selection and has its distinct hint.
    await page.evaluate(() => window.selectShapeById(null));
    assert(await page.locator('#btn-paint-build').isEnabled(), 'Whole-build toggle was unavailable without selection');
    await page.click('#btn-paint-build');
    await page.click('[data-paint="none"]');
    assert((await shapes()).every((shape) => shape.paint === null), 'Whole-build Unpaint left a painted piece');
    assert((await page.locator('#hint').textContent()) === 'Unpainted the whole build!', 'Whole-build Unpaint hint was wrong');

    // Ordinary Unpaint still clears a selected mirrored pair together.
    await page.click('#btn-clear');
    await page.click('#btn-mirror');
    await page.click('.shape[data-kind="ball"]');
    const pair = (await shapes()).filter((shape) => shape.kind === 'ball');
    assert(pair.length === 2 && pair.every((shape) => shape.twin !== null), 'Mirror ball pair was not created');
    await page.click('[data-paint="sun"]');
    assert((await shapes()).filter((shape) => shape.kind === 'ball').every((shape) => shape.paint === 'sun'),
      'Named paint did not reach the selected mirrored pair');
    await page.click('[data-paint="none"]');
    const unpaintedPair = (await shapes()).filter((shape) => shape.kind === 'ball');
    assert(unpaintedPair.every((shape) => shape.paint === null), 'Selected-pair Unpaint left paint behind');
    assert((await page.locator('#hint').textContent()) === 'Unpainted!', 'Selected-pair Unpaint hint was wrong');

    // The mode is UI-only: reload resets it while the document remains saved.
    await page.click('#btn-paint-build');
    assert(await page.evaluate(() => window.__cad.paintBuildEnabled()), 'Could not enable mode before reload');
    await page.reload({ waitUntil: 'networkidle' });
    assert(!(await page.evaluate(() => window.__cad.paintBuildEnabled())), 'Whole-build mode persisted across reload');
    assert(await page.locator('#btn-paint-build').textContent() === 'Paint whole build' &&
      await page.locator('#btn-paint-build').getAttribute('aria-label') === 'Paint whole build',
      'Reload label was not idle');
    const stored = await page.evaluate(() => window.__cad.stored());
    assert(!Object.prototype.hasOwnProperty.call(stored, 'paintBuild'), 'UI mode was persisted in the document');

    // The full paint control stays reachable at the required phone width.
    const reachability = await page.evaluate(() => {
      const button = document.querySelector('#btn-paint-build').getBoundingClientRect();
      const unpaint = document.querySelector('[data-paint="none"]').getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth,
        toggleLeft: button.left,
        toggleRight: button.right,
        unpaintRight: unpaint.right,
      };
    });
    assert(reachability.scrollWidth <= 390, `Phone overflow detected: ${JSON.stringify(reachability)}`);
    assert(reachability.toggleLeft >= 0 && reachability.toggleRight <= 390 && reachability.unpaintRight <= 390,
      `Paint controls were not reachable on phone: ${JSON.stringify(reachability)}`);

    console.log('paint palette applies to selected mirrored and whole builds with undo');
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
