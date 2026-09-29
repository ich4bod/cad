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

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
    const dismissTour = (page) => page.isVisible('#tour').then(v => v && page.click('#tour-skip', { force: true }));

    await ready(page);
    // We don't want the tour to show up and hide things for our test, 
    // but the test says "clear stored document state without clearing the completed-tour key". 
    // This implies an existing tour might have been completed.
    // Let's just dismiss if it shows up.
    await dismissTour(page);

    // 1. Assert exactly one #backlink
    const linkCount = await page.evaluate(() => document.querySelectorAll('#backlink').length);
    process.stderr.write('  DEBUG: linkCount is ' + linkCount + '\n');
    check('exactly one #backlink', linkCount === 1);

    // 2. Assert #tour and #starter-models are not descendants of it
    const descendantsCheck = await page.evaluate(() => {
      const link = document.querySelector('#backlink');
      if (!link) return false;
      return link.querySelector('#tour') !== null || link.querySelector('#starter-models') !== null;
    });
    check('#tour and #starter-models are not descendants of #backlink', !descendantsCheck);

    // 3. Click Skip and assert the URL remains the CAD URL
    // Wait, if we haven't started the tour, 'Skip' might not be visible. 
    // But the test says "click Skip".
    // Let's try to click Skip if it's there.
    if (await page.isVisible('#tour-skip')) {
        await page.click('#tour-skip');
        await sleep(250);
    }
    const currentUrl = page.url();
    check('URL remains the CAD URL after skip', currentUrl.startsWith(BASE));

    // 4. Clear stored document state without clearing the completed-tour key
    await page.evaluate(() => {
      window.localStorage.removeItem('shape-maker/doc/v1');
    });
    
    // 5. Reload
    await page.reload({ waitUntil: 'networkidle' });
    await ready(page);

    // 6. Assert all three starter buttons are visible
    const snowmanVisible = await page.isVisible('#starter-snowman');
    const robotVisible = await page.isVisible('#starter-robot');
    const rocketVisible = await page.isVisible('#starter-rocket');
    check('all three starter buttons visible after reload', snowmanVisible && robotVisible && rocketVisible);

    // 7. Click Rocket
    await page.click('#starter-rocket');
    await sleep(250);

    // 8. Undo and assert URL remains CAD URL and starter tray returns
    await page.click('#btn-undo');
    await sleep(250);
    const afterUndoUrl = page.url();
    const trayVisible = await page.isVisible('#starter-models');
    check('URL remains the CAD URL after undo', afterUndoUrl.startsWith(BASE));
    check('starter tray returns after undo', trayVisible);

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
