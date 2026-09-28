'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');

function check(actual, expected, name) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    process.stderr.write(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\n`);
    throw new Error(name);
  }
  process.stderr.write(`PASS ${name}: ${JSON.stringify(actual)}\n`);
}

async function ready(page) {
  await page.waitForFunction(() => window.__cad?.ready, null, { timeout: 30000 });
  if (await page.isVisible('#tour')) await page.click('#tour-skip', { force: true });
}

async function summary(page) {
  return page.locator('#print-ready').evaluate((element) => ({
    hidden: element.hidden,
    text: element.textContent,
  }));
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => process.stderr.write(`PAGE ERROR: ${error.message}\n`));

    await page.goto(`${BASE}/?print-ready=${Date.now()}`, { waitUntil: 'networkidle' });
    await ready(page);
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await ready(page);

    check(await summary(page), { hidden: true, text: 'Ready to print: 0 shapes' }, 'empty plate hides summary');
    await page.click('#palette .shape[data-kind="cube"]');
    check(await summary(page), { hidden: false, text: 'Ready to print: 1 shape' }, 'one Block uses singular');

    await page.click('#btn-mirror');
    await page.click('#palette .shape[data-kind="ball"]');
    check(await summary(page), { hidden: false, text: 'Ready to print: 3 shapes' }, 'Mirror Ball pair makes plural three');

    await page.click('#btn-clear');
    check(await summary(page), { hidden: true, text: 'Ready to print: 0 shapes' }, 'Clear hides summary');
    await page.click('#btn-undo');
    check(await summary(page), { hidden: false, text: 'Ready to print: 3 shapes' }, 'Undo restores three-shape summary');

    process.stdout.write('print readiness summary verified across plate changes\n');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
