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

    const shapes = (page) => page.evaluate(() => window.__cad.shapes());
    const selectedId = (page) => page.evaluate(() => window.__cad.selectedId());
    const stored = (page) => page.evaluate(() => window.__cad.stored());
    const stl = (page) => page.evaluate(() => window.__cad.stl());
    const ready = (page) => page.waitForFunction(() => window.__cad && window.__cad.ready, null, { timeout: 30000 });
    const dismissTour = (page) => page.isVisible('#tour').then(v => v && page.click('#tour-skip', { force: true }));

    await ready(page);
    await dismissTour(page);

    // 1. Assert tray is visible initially (since shapes.length === 0)
    check('tray visible initially', await page.isVisible('#starter-models'));

    // 2. Click starter
    try {
      if (!(await page.isVisible('#starter-snowman'))) {
        await page.evaluate(() => document.getElementById('starter-snowman').click());
      } else {
        await page.click('#starter-snowman');
      }
    } catch (e) {
      console.error('--- FAIL: #starter-snowman not clickable ---');
      console.error(await page.content());
      throw e;
    }
    await sleep(250);

    // 3. Assert tray is hidden after click (since snowman now exists)
    check('tray hidden after click', !(await page.isVisible('#starter-models')));

    // 4. Assert the exact three records and selected id
    const sList = await shapes(page);
    check('three records created', sList.length === 3);

    const s1 = sList.find(s => s.size === 50 && s.level === 0);
    const s2 = sList.find(s => s.size === 40 && s.level === 5);
    const s3 = sList.find(s => s.size === 30 && s.level === 9);

    check('s1 correct', s1 && s1.kind === 'ball' && s1.gx === 0 && s1.gz === 0);
    check('s2 correct', s2 && s2.kind === 'ball' && s2.gx === 0 && s2.gz === 0);
    check('s3 correct', s3 && s3.kind === 'ball' && s3.gx === 0 && s3.gz === 0);
    
    const sid = await selectedId(page);
    check('s3 selected', sid === s3.id);

    check('all pieces have no paint and no twins', sList.every(s => s.paint === null && s.twin === null));

    // 5. Check stored document
    const doc = await stored(page);
    const sListSorted = [...sList].sort((a, b) => a.id - b.id);
    const docShapesSorted = [...doc.shapes].sort((a, b) => a.id - b.id);
    const fingerprint = (list) => list.map((s) => `${s.id}:${s.kind}:${s.size}:${s.gx},${s.gz}:L${s.level}:t${s.twin}`).join(' | ');
    check('stored document matches', fingerprint(docShapesSorted) === fingerprint(sListSorted));

    // 6. Undo
    await page.click('#btn-undo');
    await sleep(250);
    check('zero shapes after undo', (await shapes(page)).length === 0);
    check('tray visible after undo', await page.isVisible('#starter-models'));

    // 7. Create again
    await page.click('#starter-snowman');
    await sleep(250);
    const sListAgain = await shapes(page);
    check('three shapes restored after second creation', sListAgain.length === 3);

    // 8. Reload
    await page.reload();
    await ready(page);
    await dismissTour(page);
    const sListReloaded = await shapes(page);
    check('three shapes after reload', sListReloaded.length === 3);
    
    const s1R = sListReloaded.find(s => s.size === 50 && s.level === 0);
    const s2R = sListReloaded.find(s => s.size === 40 && s.level === 5);
    const s3R = sListReloaded.find(s => s.size === 30 && s.level === 9);
    check('reloaded s1 correct', s1R && s1R.kind === 'ball' && s1R.gx === 0 && s1R.gz === 0);
    check('reloaded s2 correct', s2R && s2R.kind === 'ball' && s2R.gx === 0 && s2R.gz === 0);
    check('reloaded s3 correct', s3R && s3R.kind === 'ball' && s3R.gx === 0 && s3R.gz === 0);

    // 9. Download and validate STL
    const stlData = await stl(page);
    const fs = require('fs');
    const path = require('path');
    const tempStl = path.join(__dirname, 'temp_snowman.stl');
    fs.writeFileSync(tempStl, Buffer.from(stlData));
    
    const stlChecker = require('./stl-check.js');
    const stlRes = stlChecker.checkSTL(Buffer.from(stlData));
    stlChecker.report(stlRes, tempStl);
    check('STL is valid', stlRes.ok);
    
    // 10. Check overflow
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check('no horizontal overflow at 390x844', !overflow);

    if (failures.length || errors.length) {
      for (const f of failures) console.error('  FAILED: ' + f);
      for (const e of errors) console.error('  ' + e);
      process.exitCode = 1;
      return;
    }
    console.log('editable snowman starter verified with undo autosave and STL');
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
