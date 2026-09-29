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
    const undoDepth = (page) => page.evaluate(() => window.__cad.undoDepth());

    await ready(page);
    await dismissTour(page);

    // 1. Viewport and overflow check
    await page.setViewportSize({ width: 390, height: 844 });
    await sleep(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check('no 390x844 overflow', !overflow);

    await page.setViewportSize({ width: 1280, height: 900 });

    // 2. Trigger rocket
    await page.click('#starter-rocket');
    await sleep(500);

    // 3. Assert records
    const sList = await shapes(page);
    check('four records created', sList.length === 4);

    const s1 = sList[0];
    const s2 = sList[1];
    const s3 = sList[2];
    const s4 = sList[3];

    check('s1 correct', s1 && s1.kind === 'tube' && s1.size === 40 && s1.gx === 0 && s1.gz === 0 && s1.level === 0 && s1.twin === null && s1.paint === null);
    check('s2 correct', s2 && s2.kind === 'cone' && s2.size === 40 && s2.gx === 0 && s2.gz === 0 && s2.level === 4 && s2.twin === null && s2.paint === null);
    check('s3 correct', s3 && s3.kind === 'cube' && s3.size === 20 && s3.gx === -3 && s3.gz === 0 && s3.level === 0 && s3.twin === s4.id && s3.paint === null);
    check('s4 correct', s4 && s4.kind === 'cube' && s4.size === 20 && s4.gx === 3 && s4.gz === 0 && s4.level === 0 && s4.twin === s3.id && s4.paint === null);

    const sid = await selectedId(page);
    check('left fin (s3) selected', sid === s3.id);

    // 4. Undo entry & Autosave
    const initialUndoDepth = await undoDepth(page);
    check('one undo entry', initialUndoDepth === 1);
    const doc = await stored(page);
    check('autosave works', doc && doc.shapes.length === 4);

    // 5. Test To plate and Center
    // Pick s2 (cone)
    const screenS2 = await page.evaluate((id) => window.__cad.screenOf(id), s2.id);
    await page.mouse.move(screenS2.x, screenS2.y);
    await page.mouse.down();
    await sleep(100);
    await page.mouse.move(screenS2.x + 10, screenS2.y);
    await page.mouse.up();
    await sleep(250);
    check('s2 selected', (await selectedId(page)) === s2.id);
    check('To plate enabled for s2', await page.isEnabled('#btn-plate'));
    await page.click('#btn-plate');
    await sleep(250);
    const sListPlate = await shapes(page);
    const s2Plate = sListPlate.find(s => s.id === s2.id);
    check('s2 level is 0 after To plate', s2Plate.level === 0);

    // Undo the to plate
    await page.click('#btn-undo');
    await sleep(250);

    // Select s3 (the one selected by rocket starter)
    const screenS3 = await page.evaluate((id) => window.__cad.screenOf(id), s3.id);
    await page.mouse.move(screenS3.x, screenS3.y);
    await page.mouse.down();
    await sleep(100);
    await page.mouse.move(screenS3.x + 10, screenS3.y);
    await page.mouse.up();
    await sleep(250);
    check('s3 selected', (await selectedId(page)) === s3.id);
    check('Center disabled for s3 (twin)', await page.isDisabled('#btn-center'));

    // 6. Undo to empty (ensures we leave an empty tray)
    while (await undoDepth(page) > 0) {
      if (!(await page.isEnabled('#btn-undo'))) break;
      await page.click('#btn-undo');
      await sleep(250);
    }
    check('zero shapes after undoing to empty', (await shapes(page)).length === 0);

    // 7. Rebuild, validate STL
    await page.click('#starter-rocket', { force: true });
    await sleep(500);
    const stlData = await stl(page);
    const fs = require('fs');
    const path = require('path');
    const tempStl = path.join(__dirname, 'temp_rocket.stl');
    fs.writeFileSync(tempStl, Buffer.from(stlData));
    const stlChecker = require('./stl-check.js');
    const stlRes = stlChecker.checkSTL(Buffer.from(stlData));
    stlChecker.report(stlRes, tempStl);
    check('STL is valid', stlRes.ok);
    if (fs.existsSync(tempStl)) fs.unlinkSync(tempStl);

    // 8. Reload and assert empty and buttons (this works because we undid to empty before building again, 
    // and then the rebuild was saved... wait. If I rebuild, then reload, it loads the rebuild.
    // The card says "rebuild/reload and validate STL; assert all three starter buttons visible on a fresh empty plate".
    // If I rebuild, I have 4 shapes. If I then reload, I have 4 shapes.
    // I'll follow the "empty plate" requirement by undoing the rebuild too!)
    
    // Let's undo the rebuild
    while (await undoDepth(page) > 0) {
      if (!(await page.isEnabled('#btn-undo'))) break;
      await page.click('#btn-undo');
      await sleep(250);
    }
    check('zero shapes after undoing rebuild', (await shapes(page)).length === 0);

    // Now reload for the final check
    await page.reload({ waitUntil: 'networkidle' });
    await ready(page);
    const sListFinal = await shapes(page);
    check('zero shapes on fresh reload', sListFinal.length === 0);
    check('all three starter buttons visible', 
      await page.isVisible('#starter-snowman') && 
      await page.isVisible('#starter-robot') && 
      await page.isVisible('#starter-rocket')
    );

    if (failures.length || errors.length) {
      for (const f of failures) console.error('  FAILED: ' + f);
      for (const e of errors) console.error('  ' + e);
      process.exitCode = 1;
      return;
    }
    console.log('editable rocket starter verified with linked fins undo and STL');
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
