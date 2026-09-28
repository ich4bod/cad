/* Verify the startup-only hint shown when a saved Shape Maker model returns. */
'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
const RESTORE_HINT = 'Your saved shape is back on the plate.';
const EMPTY_HINT = 'Clean plate. Tap a shape to start.';

const fail = (message) => { throw new Error(message); };

async function ready(page) {
  await page.waitForFunction(() => window.__cad && window.__cad.ready, null, { timeout: 30000 });
}

async function hint(page) {
  return page.textContent('#hint');
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let page = await context.newPage();

  await page.goto(BASE + '/', { waitUntil: 'load' });
  await ready(page);
  await page.click('#palette .shape[data-kind="cube"]');
  await page.waitForTimeout(150);
  if ((await page.evaluate(() => window.__cad.shapes())).length !== 1) fail('Block was not added');

  await page.reload({ waitUntil: 'load' });
  await ready(page);
  if ((await hint(page)) !== RESTORE_HINT) fail(`restored Block hint was ${JSON.stringify(await hint(page))}`);
  const restored = await page.evaluate(() => window.__cad.shapes());
  if (restored.length !== 1 || restored[0].kind !== 'cube') fail('restored Block was not visible');

  await page.click('#btn-clear');
  await page.waitForTimeout(100);
  await page.reload({ waitUntil: 'load' });
  await ready(page);
  if ((await hint(page)) !== EMPTY_HINT) fail(`empty restored hint was ${JSON.stringify(await hint(page))}`);

  await page.goto(BASE + '/favicon.svg', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.setItem('shape-maker/doc/v1', 'not valid json'));
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await ready(page);
  if ((await hint(page)) === RESTORE_HINT) fail('malformed storage showed the restore hint');

  await context.close();
  await browser.close();
  process.stdout.write('saved model restore hint verified for full and empty plates\n');
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
