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

    // 2. Click starter robot
    try {
      if (!(await page.isVisible('#starter-robot'))) {
        await page.click('#starter-robot');
      } else {
        await page.click('#starter-robot');
      }
    } catch (e) {
      console.error('--- FAIL: #starter-robot not clickable ---');
      console.error(await page.content());
      throw e;
    }
    await sleep(250);

    // 3. Assert tray is hidden and four records exist
    check('tray hidden after click', !(await page.isVisible('#starter-models')));

    const sList = await shapes(page);
    check('four records created', sList.length === 4);

    // Validate exact order/coordinates/twin symmetry
    // Order: s1 (cube 50, 0,0,0, twin null), s2 (cube 30, 0,0,5, twin null), s3 (tube 20, -3,0,1, twin s4), s4 (tube 20, 3,0,1, twin s3)
    const s1 = sList[0];
    const s2 = sList[1];
    const s3 = sList[2];
    const s4 = sList[3];

    check('s1 correct', s1 && s1.kind === 'cube' && s1.size === 50 && s1.gx === 0 && s1.gz === 0 && s1.twin === null);
    check('s2 correct', s2 && s2.kind === 'cube' && s2.size === 30 && s2.gx === 0 && s2.gz === 0 && s2.twin === null);
    check('s3 correct', s3 && s3.kind === 'tube' && s3.size === 20 && s3.gx === -3 && s3.gz === 0 && s3.twin === s4.id);
    check('s4 correct', s4 && s4.kind === 'tube' && s4.size === 20 && s4.gx === 3 && s4.gz === 0 && s4.twin === s3.id);

    const sid = await selectedId(page);
    check('left arm (s3) selected', sid === s3.id);

    // 4. Check undo depth
    const undoDepth = await page.evaluate(() => window.__cad.undoDepth());
    check('one undo entry', undoDepth === 1);

    // 5. Autosave check
    const doc = await stored(page);
    check('autosave works', doc && doc.shapes.length === 4);

    // 6. Move/paint left arm and assert twin follows
    // Paint left arm
    await page.click('[data-paint="violet"]');
    await sleep(250);
    const sListPainted = await shapes(page);
    const s3P = sListPainted.find(s => s.id === s3.id);
    const s4P = sListPainted.find(s => s.id === s4.id);
    check('left arm painted violet', s3P && s3P.paint === 'violet');
    check('right arm painted violet (twin)', s4P && s4P.paint === 'violet');

    // Move left arm
    // We need the screen position of s3 to click and drag
    const screenS3 = await page.evaluate((id) => window.__cad.screenOf(id), s3.id);
    await page.mouse.move(screenS3.x, screenS3.y);
    await page.mouse.down();
    await sleep(100);
    // Drag a bit to the right (which would move s3 to gx=-2, s4 to gx=2)
    await page.mouse.move(screenS3.x + 50, screenS3.y);
    await page.mouse.up();
    await sleep(250);

    const sListMoved = await shapes(page);
    const s3M = sListMoved.find(s => s.id === s3.id);
    const s4M = sListMoved.find(s => s.id === s4.id);
    check('left arm moved', s3M.gx !== -3);
    check('right arm moved (twin)', s4M.gx === -s3M.gx);

    // 7. Undo edits (undo the move, then the paint, then the build)
    await page.click('#btn-undo'); // undo move
    await sleep(250);
    const sListUndone = await shapes(page);
    const s3U = sListUndone.find(s => s.id === s3.id);
    const s4U = sListUndone.find(s => s.id === s4.id);
    check('left arm back to original pos', s3U.gx === -3 && s3U.gz === 0);
    check('left arm color restored', s3U.paint === 'violet');

    await page.click('#btn-undo'); // undo paint
    await sleep(250);
    const sListUndone2 = await shapes(page);
    const s3U2 = sListUndone2.find(s => s.id === s3.id);
    const s4U2 = sListUndone2.find(s => s.id === s4.id);
    check('left arm back to original pos', s3U2.gx === -3 && s3U2.gz === 0);
    check('left arm color restored', s3U2.paint === null);
    
    await page.click('#btn-undo'); // undo build
    await sleep(250);
    check('zero shapes after undoing build', (await shapes(page)).length === 0);

    // 8. Rebuild/reload and validate STL
    await page.click('#starter-robot');
    await sleep(250);
    await page.reload();
    await ready(page);
    await dismissTour(page);
    
    const sListReloaded = await shapes(page);
    check('four shapes after reload', sListReloaded.length === 4);
    
    // Validate STL
    const stlData = await stl(page);
    const fs = require('fs');
    const path = require('path');
    const tempStl = path.join(__dirname, 'temp_robot.stl');
    fs.writeFileSync(tempStl, Buffer.from(stlData));
    const stlChecker = require('./stl-check.js');
    const stlRes = stlChecker.checkSTL(Buffer.from(stlData));
    stlChecker.report(stlRes, tempStl);
    check('STL is valid', stlRes.ok);

    // 9. Check overflow at 390x844
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check('no horizontal overflow at 390x844', !overflow);

    if (failures.length || errors.length) {
      for (const f of failures) console.error('  FAILED: ' + f);
      for (const e of errors) console.error('  ' + e);
      process.exitCode = 1;
      return;
    }
    console.log('editable robot starter verified with linked arms undo and STL');
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
