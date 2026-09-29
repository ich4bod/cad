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

    // 1. Assert tray is visible initially
    check('tray visible initially', await page.isVisible('#starter-models'));

    // 2. Click starter rocket
    try {
      await page.click('#starter-rocket');
    } catch (e) {
      console.error('--- FAIL: #starter-rocket not clickable ---');
      console.error(await page.content());
      throw e;
    }
    await sleep(250);

    // 3. Assert tray is hidden and four records exist
    check('tray hidden after click', !(await page.isVisible('#starter-models')));

    const sList = await shapes(page);
    check('four records created', sList.length === 4);

    // Validate exact order/coordinates/twin symmetry
    // Order: s1 (tube 40, 0,0,0, twin null), s2 (cone 40, 0,0,4, twin null), s3 (cube 20, -3,0,0, twin s4), s4 (cube 20, 3,0,0, twin s3)
    const s1 = sList[0];
    const s2 = sList[1];
    const s3 = sList[2];
    const s4 = sList[3];

    check('s1 correct', s1 && s1.kind === 'tube' && s1.size === 40 && s1.gx === 0 && s1.gz === 0 && s1.level === 0 && s1.twin === null);
    check('s2 correct', s2 && s2.kind === 'cone' && s2.size === 40 && s2.gx === 0 && s2.gz === 0 && s2.level === 4 && s2.twin === null);
    check('s3 correct', s3 && s3.kind === 'cube' && s3.size === 20 && s3.gx === -3 && s3.gz === 0 && s3.level === 0 && s3.twin === s4.id);
    check('s4 correct', s4 && s4.kind === 'cube' && s4.size === 20 && s4.gx === 3 && s4.gz === 0 && s4.level === 0 && s4.twin === s3.id);

    const sid = await selectedId(page);
    check('left fin (s3) selected', sid === s3.id);

    // 4. Check undo depth
    const undoDepth = await page.evaluate(() => window.__cad.undoDepth());
    check('one undo entry', undoDepth === 1);

    // 5. Autosave check
    const doc = await stored(page);
    check('autosave works', doc && doc.shapes.length === 4);

    // 6. Test To plate and Center enablement
    // Test To plate on s2
    // To select s2, we click it in the scene. We need its screen position.
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

    // Test Center is disabled for s3 (the twin)
    // First undo the "To plate"
    await page.click('#btn-undo');
    await sleep(250);
    // Now select s3
    const screenS3 = await page.evaluate((id) => window.__cad.screenOf(id), s3.id);
    await page.mouse.move(screenS3.x, screenS3.y);
    await page.mouse.down();
    await sleep(100);
    await page.mouse.move(screenS3.x + 10, screenS3.y);
    await page.mouse.up();
    await sleep(250);
    check('s3 selected', (await selectedId(page)) === s3.id);
    check('Center disabled for s3 (twin)', await page.isDisabled('#btn-center'));

    // 7. Undo to empty
    await page.click('#btn-undo'); // undo the move/paint/plate... wait, how many undos?
    // Let's check current undo stack.
    // 1: build
    // 2: to plate
    // 3: select s3 (no, that's not an undo)
    // wait, addShape, resize, lift, toPlate, centerSelected, removeSelected, toggleMirror, paintSelected, undo, duplicateSelected, addShape.
    // All these do pushUndo.
    // My sequence:
    // buildRocket (1 undo)
    // select s2 (no undo)
    // click toPlate (2 undos)
    // select s3 (no undo)
    // current undo stack should have 2 entries.
    
    // Undo to empty:
    await page.click('#btn-undo'); // undo plate
    await sleep(250);
    await page.click('#btn-undo'); // undo build
    await sleep(250);
    check('zero shapes after undoing to empty', (await shapes(page)).length === 0);

    // 8. Rebuild/reload and validate STL
    await page.click('#starter-rocket');
    await sleep(250);
    await page.reload();
    await ready(page);

    const sListReloaded = await shapes(page);
    check('four shapes after reload', sListReloaded.length === 4);
    
    // Validate STL
    const stlData = await stl(page);
    const fs = require('fs');
    const path = require('path');
    const tempStl = path.join(__dirname, 'temp_rocket.stl');
    fs.writeFileSync(tempStl, Buffer.from(stlData));
    const stlChecker = require('./stl-check.js');
    const stlRes = stlChecker.checkSTL(Buffer.from(stlData));
    stlChecker.report(stlRes, tempStl);
    check('STL is valid', stlRes.ok);

    // Remove the temporary STL
    if (fs.existsSync(tempStl)) fs.unlinkSync(tempStl);

    // 9. Check overflow at 390x844
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check('no horizontal overflow at 390x844', !overflow);

    // 10. Check all three starter buttons are visible
    check('snowman button visible', await page.isVisible('#starter-snowman'));
    check('robot button visible', await page.isVisible('#starter-robot'));
    check('rocket button visible', await page.isVisible('#starter-rocket'));

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
