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

async function count(page) {
  return page.locator('#shape-count').textContent();
}

async function ready(page) {
  await page.waitForFunction(() => window.__cad?.ready, null, { timeout: 30000 });
  if (await page.isVisible('#tour')) await page.click('#tour-skip', { force: true });
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => process.stderr.write(`PAGE ERROR: ${error.message}\n`));

    await page.goto(`${BASE}/?shape-count=${Date.now()}`, { waitUntil: 'networkidle' });
    await ready(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await ready(page);
    check(await count(page), '0 shapes', 'empty model');

    await page.click('#palette .shape[data-kind="cube"]');
    check(await count(page), '1 shape', 'single Block');

    await page.click('#btn-mirror');
    await page.click('#palette .shape[data-kind="ball"]');
    check(await count(page), '3 shapes', 'mirrored Ball pair');

    await page.click('#btn-undo');
    check(await count(page), '1 shape', 'undo mirrored pair');

    await page.reload({ waitUntil: 'networkidle' });
    await ready(page);
    check(await count(page), '1 shape', 'reload persisted model');

    console.log('shape count verified for single and mirrored shapes');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
