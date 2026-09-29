'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const errors = [];
    let passed = 0;
    const failures = [];

    function check(name, cond, detail) {
      const line = name + (detail ? '  [' + detail + ']' : '');
      if (cond) { 
        passed++; 
        process.stderr.write('  PASS  ' + line + '\n'); 
      }
      else { 
        failures.push(line); 
        process.stderr.write('  FAIL  ' + line + '\n'); 
      }
    }

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    let page = await ctx.newPage();
    page.on('console', (m) => {
      process.stderr.write(`[browser ${m.type()}] ${m.text()}\n`);
    });
    page.on('pageerror', (e) => {
      process.stderr.write(`[pageerror] ${e.message}\n`);
      errors.push(`[pageerror] ${e.message}`);
    });
    page.on('requestfailed', request => {
      const msg = `[browser requestfailed] ${request.url()} ${request.failure()?.errorText}`;
      process.stderr.write(msg + '\n');
      if (!request.url().includes('rum?') && !request.url().includes('cloudflareinsights.com')) {
        errors.push(msg);
      }
    });

    await page.goto(BASE, { waitUntil: 'networkidle' });

    const ready = (page) => page.waitForFunction(() => window.__cad && window.__cad.ready, null, { timeout: 30000 });
    
    await ready(page);

    // 1. Load at 390x844
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(100);

    // 2. Assert exactly one #backlink
    const backlinkCount = await page.evaluate(() => document.querySelectorAll('#backlink').length);
    check('exactly one #backlink', backlinkCount === 1);

    // 3. Assert #tour and #starter-models are not descendants of #backlink
    const invalidDescendants = await page.evaluate(() => {
      const backlink = document.querySelector('#backlink');
      if (!backlink) return false;
      const tour = document.querySelector('#tour');
      const starterModels = document.querySelector('#starter-models');
      const tourInBacklink = tour && backlink.contains(tour);
      const starterModelsInBacklink = starterModels && backlink.contains(starterModels);
      return tourInBacklink || starterModelsInBacklink;
    });
    check('#tour and #starter-models are not descendants of #backlink', !invalidDescendants);

    // 4. Click Skip and assert the URL remains the CAD URL
    // First check if tour is visible
    const tourVisible = await page.isVisible('#tour');
    if (tourVisible) {
      await page.click('#tour-skip', { force: true });
      await sleep(250);
    }
    const currentUrl = page.url();
    check('URL remains CAD URL after skip', currentUrl === BASE || currentUrl.startsWith(BASE + '/'));

    // 5. Clear stored document state without clearing the completed-tour key
    await page.evaluate(() => {
      window.localStorage.removeItem('shape-maker/doc/v1');
    });
    await sleep(250);

    // 6. Reload, assert all three starter buttons are visible
    await page.reload({ waitUntil: 'networkidle' });
    await ready(page);
    
    const snowmanBtn = await page.isVisible('#starter-snowman');
    const robotBtn = await page.isVisible('#starter-robot');
    const rocketBtn = await page.isVisible('#starter-rocket');
    check('all three starter buttons are visible', snowmanBtn && robotBtn && rocketBtn);

    // 7. Click Rocket
    await page.click('#starter-rocket');
    await sleep(500); // Wait for build to happen

    // 8. Undo and assert the URL remains the CAD URL and the starter tray returns
    await page.click('#btn-undo');
    await sleep(500);
    
    const urlAfterUndo = page.url();
    check('URL remains CAD URL after undo', urlAfterUndo === BASE || urlAfterUndo.startsWith(BASE + '/'));

    const starterModelsVisible = await page.isVisible('#starter-models');
    check('starter tray returns', starterModelsVisible);

    if (failures.length || errors.length) {
      for (const f of failures) console.error('  FAILED: ' + f);
      for (const e of errors) console.error('  ' + e);
      process.exitCode = 1;
      return;
    }
    console.log('footer link boundary keeps tour starters and undo inside Shape Maker');
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
