'use strict';
let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();

  try {
    await page.goto(process.argv[2] || 'https://cad.ichabod-crane.net/', { waitUntil: 'domcontentloaded' });

    await page.setViewportSize({ width: 390, height: 844 });

    await page.waitForFunction(() => window.__cad && window.__cad.ready, null, { timeout: 5000 });

    // Dismiss tour
    const tourLink = await page.evaluate(() => {
      const tour = document.getElementById('tour');
      if (tour && !tour.hidden) return true;
      return false;
    });
    if (tourLink) {
      await page.click('#tour-skip');
      await sleep(500);
    }

    // 1. Turn Mirror ON
    await page.click('#btn-mirror');
    await sleep(100);

    // 2. Add a Ball
    await page.click('[data-kind="ball"]');
    await sleep(500);

    // 3. Make it Bigger and Up
    await page.click('#btn-bigger');
    await sleep(100);
    await page.click('#btn-up');
    await sleep(100);

    // Get the IDs of the pair
    const shapes = await page.evaluate(() => window.__cad.shapes());
    if (shapes.length !== 2) {
        throw new Error(`Expected 2 shapes after adding ball with Mirror on, got ${shapes.length}`);
    }
    const [s1, s2] = shapes;
    if (s1.twin === null || s2.twin === null) {
        throw new Error('Shapes are not paired');
    }
    const initialPair = [s1, s2];

    // 4. Copy either side (tap s1, then copy)
    const pos1 = await page.evaluate((i) => window.__cad.screenOf(i), s1.id);
    await page.mouse.click(pos1.x, pos1.y);
    await sleep(100);
    await page.click('#btn-copy');
    await sleep(500);

    // 5. Assert four records, two new reciprocal twins, same fields, symmetric x values, selection on the clicked side
    const newShapes = await page.evaluate(() => window.__cad.shapes());
    if (newShapes.length !== 4) {
      throw new Error(`Expected 4 shapes after copy, got ${newShapes.length}`);
    }

    // The original two + the two new ones.
    // We need to find the new ones. They should have higher IDs.
    const maxId = Math.max(...newShapes.map(s => s.id));
    const newOnes = newShapes.filter(s => s.id > initialPair[0].id && s.id > initialPair[1].id);
    
    if (newOnes.length !== 2) {
        throw new Error(`Expected 2 new shapes, found ${newOnes.length}`);
    }
    
    const [n1, n2] = newOnes.sort((a, b) => a.id - b.id);
    if (n1.twin === null || n2.twin === null || n1.twin !== n2.id || n2.twin !== n1.id) {
        throw new Error('New shapes are not reciprocal twins');
    }

    // Check same fields as original
    const orig = initialPair[0];
    if (n1.kind !== orig.kind || n1.size !== orig.size || n1.level !== orig.level) {
        throw new Error('New shapes have wrong kind, size, or level');
    }
    if (n2.kind !== orig.kind || n2.size !== orig.size || n2.level !== orig.level) {
        throw new Error('New shapes have wrong kind, size, or level');
    }

    // Check symmetric x values
    if (Math.abs(n1.gx + n2.gx) > 0.001 || Math.abs(n1.gz - n2.gz) > 0.001) {
        throw new Error(`X symmetry failed: ${n1.gx}, ${n2.gx}`);
    }

    // Check selection on the clicked side (s1's side)
    const selectedId = await page.evaluate(() => window.__cad.selectedId());
    const sideS1 = Math.sign(s1.gx);
    const sideSelected = await page.evaluate((id) => {
        const s = window.__cad.shapes().find(sh => sh.id === id);
        return s ? Math.sign(s.gx) : 0;
    }, selectedId);

    if (sideSelected !== sideS1) {
        throw new Error(`Selection is on the wrong side. Clicked ${sideS1}, selected ${sideSelected}`);
    }

    // 6. Undo removes both duplicates
    await page.click('#btn-undo');
    await sleep(500);
    const afterUndoShapes = await page.evaluate(() => window.__cad.shapes());
    if (afterUndoShapes.length !== 2) {
        throw new Error(`Expected 2 shapes after undo, got ${afterUndoShapes.length}`);
    }
    // Ensure the original two are still there
    const originalIds = initialPair.map(s => s.id);
    if (!afterUndoShapes.every(s => originalIds.includes(s.id))) {
        throw new Error('Original shapes were not preserved after undo');
    }

    // 7. Reload and assert it persists
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__cad && window.__cad.ready, null, { timeout: 5000 });
    const afterReloadShapes = await page.evaluate(() => window.__cad.shapes());
    if (afterReloadShapes.length !== 2) {
        throw new Error(`Expected 2 shapes after reload, got ${afterReloadShapes.length}`);
    }

    process.stdout.write('mirrored-pair copy verified with one undo and autosave\n');

  } catch (err) {
    process.stderr.write(err.message + '\n');
    process.exit(1);
  }

  await browser.close();
})();
