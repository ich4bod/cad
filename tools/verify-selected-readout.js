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

async function readout(page) {
  return page.locator('#selected-readout').textContent();
}

async function dragMouse(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps
    );
  }
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

    check(await readout(page), 'No shape selected', 'empty model');
    await page.click('#palette .shape[data-kind="cube"]');
    check(await readout(page), 'Block · 30mm · level 0 · grid (0, 0)', 'added Block');

    const blockId = await page.evaluate(() => window.__cad.selectedId());
    const from = await page.evaluate((id) => window.__cad.screenOf(id), blockId);
    const to = await page.evaluate((id) => window.__cad.screenOfCell(4, 2, id), blockId);
    await dragMouse(page, from, to);
    const dragged = await page.evaluate(() => {
      const s = window.__cad.shapes().find((shape) => shape.id === window.__cad.selectedId());
      return { gx: s.gx, gz: s.gz, readout: document.querySelector('#selected-readout').textContent };
    });
    check(dragged.readout, `Block · 30mm · level 0 · grid (${dragged.gx}, ${dragged.gz})`, 'dragged Block grid location');

    await page.click('#btn-bigger');
    await page.click('#btn-up');
    check(await readout(page), `Block · 40mm · level 1 · grid (${dragged.gx}, ${dragged.gz})`, 'edited Block');

    await page.click('#btn-delete');
    check(await readout(page), 'No shape selected', 'deleted Block');
    check(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, 'no horizontal overflow at 390x844');

    console.log('selected shape readout verifies live grid location');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
