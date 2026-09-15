'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
let passed = 0;
const failures = [];
const check = (name, ok, detail = '') => {
  const line = `${name}${detail ? ` [${detail}]` : ''}`;
  if (ok) { passed++; console.log(`  PASS  ${line}`); }
  else { failures.push(line); console.log(`  FAIL  ${line}`); }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ready(page) {
  await page.waitForTimeout(500);
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];
  for (const viewport of [{ width: 1280, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'narrow' }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${viewport.name}: ${error.message}`));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await ready(page);

    check(`${viewport.name}: fresh session shows tour`, await page.locator('#tour').isVisible());
    for (let step = 0; step < 4; step++) {
      const state = await page.evaluate(() => window.__cad.tour());
      const target = await page.locator(state.target).count();
      const highlighted = await page.locator(state.target).getAttribute('data-tour-active');
      check(`${viewport.name}: step ${step + 1} targets a real control`, target === 1, state.target);
      check(`${viewport.name}: step ${step + 1} highlights its control`, highlighted === 'true');
      if (step < 3) await page.click('#tour-next');
    }
    await page.click('#tour-next');
    check(`${viewport.name}: completion dismisses tour`, !(await page.locator('#tour').isVisible()));
    await page.reload({ waitUntil: 'networkidle' });
    await ready(page);
    check(`${viewport.name}: returning session stays tour-free`, !(await page.locator('#tour').isVisible()));
    await context.close();
  }

  const skipContext = await browser.newContext();
  const skipPage = await skipContext.newPage();
  await skipPage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await ready(skipPage);
  await skipPage.click('#tour-skip');
  check('skip dismisses tour', !(await skipPage.locator('#tour').isVisible()));
  await skipPage.reload({ waitUntil: 'networkidle' });
  await ready(skipPage);
  check('skip persists for returning session', !(await skipPage.locator('#tour').isVisible()));
  await skipContext.close();
  await browser.close();

  check('no browser page errors', errors.length === 0, errors.join('; '));
  console.log(`\n${passed} passed / ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
