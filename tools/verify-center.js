'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');

function check(actual, expected, name) {
  if (actual !== expected) {
    process.stderr.write(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\n`);
    throw new Error(name);
  }
  process.stderr.write(`PASS ${name}: ${actual}\n`);
}

async function ready(page) {
  await page.waitForFunction(() => window.__cad?.ready, null, { timeout: 30000 });
  if (await page.isVisible('#tour')) await page.click('#tour-skip', { force: true });
}

async function dragMouse(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // More steps for smoother drag or different behavior
  await page.mouse.move(to.x, to.y, { steps: 20 });
  await page.mouse.up();
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => process.stderr.write(`PAGE ERROR: ${error.message}\n`));

    await page.goto(`${BASE}/?selected-readout=${Date.now()}`, { waitUntil: 'networkidle' });
    await ready(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await ready(page);

    // 1. Add Block
    await page.click('#palette .shape[data-kind="cube"]');
    const blockId = await page.evaluate(() => window.__cad.selectedId());
    check(await page.evaluate(() => {
      const s = window.__cad.shapes().find(sh => sh.id === window.__cad.selectedId());
      return s ? { size: s.size, level: s.level, paint: s.paint, gx: s.gx, gz: s.gz } : null;
    }, blockId), { size: 30, level: 0, paint: null, gx: 0, gz: 0 }, 'added Block');

    // 2. Drag to (4, 2)
    const from = await page.evaluate((id) => window.__cad.screenOf(id), blockId);
    const to = await page.evaluate((id) => window.__cad.screenOfCell(4, 2, id), blockId);
    await dragMouse(page, from, to);
    
    const afterDrag = await page.evaluate((id) => {
      const s = window.__cad.shapes().find(sh => sh.id === id);
      return { gx: s.gx, gz: s.gz };
    }, blockId);
    check(afterDrag, { gx: 4, gz: 2 }, 'dragged Block to (4, 2)');

    // 3. Click Center
    await page.click('#btn-center');
    const afterCenter = await page.evaluate((id) => {
      const s = window.__cad.shapes().find(sh => sh.id === id);
      return { gx: s.gx, gz: s.gz, size: s.size, level: s.level, paint: s.paint };
    }, blockId);
    check(afterCenter, { gx: 0, gz: 0, size: 30, level: 0, paint: null }, 'centered Block');

    // 4. Undo and assert (4, 2)
    await page.click('#btn-undo');
    const afterUndo = await page.evaluate((id) => {
      const s = window.__cad.shapes().find(sh => sh.id === id);
      return { gx: s.gx, gz: s.gz };
    }, blockId);
    check(afterUndo, { gx: 4, gz: 2 }, 'undid Center');

    // 5. Mirrored pair check
    // Turn mirror on
    await page.click('#btn-mirror');
    check(await page.evaluate(() => window.__cad.mirror()), true, 'mirror on');

    // Add shape (will be a pair)
    await page.click('#palette .shape[data-kind="ball"]');
    const ballId = await page.evaluate(() => window.__cad.selectedId());
    const twinId = await page.evaluate(() => {
      const s = window.__cad.shapes().find(sh => sh.id === window.__cad.selectedId());
      return s.twin;
    });
    check(twinId !== null, true, 'created mirrored pair');

    // Assert Center is disabled for either selected half
    const centerBtnDisabled = await page.evaluate(() => document.getElementById('btn-center').disabled);
    check(centerBtnDisabled, true, 'Center disabled for mirrored pair');

    console.log('center tool verified for moved shapes and mirrored-pair guard');

  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
