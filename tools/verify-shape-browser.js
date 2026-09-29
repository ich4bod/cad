'use strict';
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('playwright-core').chromium; }
const BASE = (process.argv[2] || 'http://host.docker.internal:8080').replace(/\/$/, '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(() => localStorage.clear());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    if (await page.isVisible('#tour')) await page.click('#tour-skip', { force: true });
    const state = () => page.evaluate(() => ({ shapes: window.__cad.shapes(), selected: window.__cad.selectedId(), undo: window.__cad.undoDepth() }));
    if (await page.isEnabled('#btn-previous-shape') || await page.isEnabled('#btn-next-shape')) throw new Error('empty browser buttons are enabled');
    await page.click('#starter-rocket');
    await sleep(250);
    const built = await state();
    if (built.shapes.length !== 4 || built.undo !== 1) throw new Error('rocket model or undo depth is wrong');
    const ids = built.shapes.map((s) => s.id);
    const left = ids[2], right = ids[3];
    if (built.selected !== left) throw new Error('rocket did not select left fin');
    const modelBefore = JSON.stringify(built.shapes);
    await page.click('#btn-next-shape');
    if ((await state()).selected !== right) throw new Error('Next did not select right fin');
    for (const expected of [ids[0], ids[1], ids[2], ids[3]]) {
      await page.click('#btn-next-shape');
      if ((await state()).selected !== expected) throw new Error('Next did not wrap through every record');
    }
    await page.click('#btn-previous-shape');
    if ((await state()).selected !== ids[2]) throw new Error('Previous did not select the preceding record');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.locator('#scene').focus();
    await page.keyboard.press(']');
    if ((await state()).selected !== ids[3]) throw new Error('bracket selection changed');
    await page.locator('#scene').focus();
    await page.keyboard.press('[');
    if ((await state()).selected !== ids[2]) throw new Error('bracket selection changed');
    const after = await state();
    if (JSON.stringify(after.shapes) !== modelBefore || after.undo !== 1) throw new Error('browser changed model or undo depth');
    if (!(await page.locator('#selected-readout').textContent()).includes('Block')) throw new Error('readout did not update');
    const sky = await page.locator('#scene').boundingBox();
    await page.mouse.click(sky.x + sky.width / 2, sky.y + 12);
    if ((await state()).selected !== null) throw new Error('empty sky did not clear selection');
    await page.click('#btn-previous-shape');
    if ((await state()).selected !== ids[3]) throw new Error('Previous did not select the last record from empty');
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(100);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow || errors.length) throw new Error(overflow ? '390x844 overflow' : errors.join(' | '));
    console.log('visible shape browser verified across selection wrap and empty state');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
