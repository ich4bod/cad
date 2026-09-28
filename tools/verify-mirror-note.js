'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');

function check(actual, expected, name) {
  if (actual !== expected) {
    process.stderr.write(`FAIL ${name}: expected ${expected}, got ${actual}\n`);
    throw new Error(name);
  }
  process.stderr.write(`PASS ${name}: ${actual}\n`);
}

async function ready(page) {
  await page.waitForFunction(() => window.__cad?.ready, null, { timeout: 30000 });
  if (await page.isVisible('#tour')) await page.click('#tour-skip', { force: true });
}

async function noteHidden(page) {
  return page.locator('#mirror-note').evaluate((note) => note.hidden);
}

async function selectShape(page, id) {
  const point = await page.evaluate((shapeId) => window.__cad.screenOf(shapeId), id);
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction((shapeId) => window.__cad.selectedId() === shapeId, id);
}

async function clean(page) {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await ready(page);
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => process.stderr.write(`PAGE ERROR: ${error.message}\n`));

    await page.goto(`${BASE}/?mirror-note=${Date.now()}`, { waitUntil: 'networkidle' });
    await ready(page);
    await clean(page);

    check(await noteHidden(page), true, 'empty selection hides mirror note');
    await page.click('#palette .shape[data-kind="cube"]');
    check(await noteHidden(page), true, 'ordinary Block hides mirror note');

    await page.click('#btn-mirror');
    await page.click('#palette .shape[data-kind="ball"]');
    const pair = await page.evaluate(() => window.__cad.shapes().filter((shape) => shape.twin !== null));
    check(pair.length, 2, 'Mirror adds a Ball pair');
    await selectShape(page, pair[0].id);
    check(await noteHidden(page), false, 'first paired half shows mirror note');
    await selectShape(page, pair[1].id);
    check(await noteHidden(page), false, 'second paired half shows mirror note');

    await page.reload({ waitUntil: 'networkidle' });
    await ready(page);
    check(await noteHidden(page), false, 'reload keeps mirror note for selected pair half');

    await clean(page);
    await page.click('#btn-mirror');
    await page.click('#palette .shape[data-kind="ball"]');
    check(await noteHidden(page), false, 'new pair shows mirror note before Undo');
    await page.click('#btn-undo');
    check(await noteHidden(page), true, 'Undoing pair hides mirror note');

    console.log('mirror relationship note verified for both paired halves');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
