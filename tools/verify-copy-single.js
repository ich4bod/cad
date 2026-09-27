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

    // 1. Add a Block
    await page.click('[data-kind="cube"]');
    await sleep(500);

    // 2. Make it Bigger and Up
    await page.click('#btn-bigger');
    await sleep(100);
    await page.click('#btn-bigger');
    await sleep(100);
    await page.click('#btn-up');
    await sleep(100);
    await page.click('#btn-up');
    await sleep(100);

    // 3. Click Copy
    await page.click('#btn-copy');
    await sleep(500);

    // 4. Assert two distinct unpaired records
    const shapes = await page.evaluate(() => window.__cad.shapes());
    if (shapes.length !== 2) {
      throw new Error(`Expected 2 shapes after copy, got ${shapes.length}`);
    }
    const [s1, s2] = shapes;
    if (s1.kind !== s2.kind || s1.size !== s2.size || s1.level !== s2.level) {
      throw new Error('Shapes do not have same kind, size, or level');
    }
    if (s1.id === s2.id) {
      throw new Error('Shapes have same ID');
    }
    if (s1.twin !== null || s2.twin !== null) {
      throw new Error('Shapes should be unpaired (twin: null)');
    }
    // Non-overlapping footprints check
    const isOverlapping = await page.evaluate(({id1, id2}) => {
      const s1 = window.__cad.shapes().find(s => s.id === id1);
      const s2 = window.__cad.shapes().find(s => s.id === id2);
      const footprint = (s) => [
        s.gx * 10 - s.size / 2, s.gx * 10 + s.size / 2,
        s.gz * 10 - s.size / 2, s.gz * 10 + s.size / 2,
      ];
      const p1 = footprint(s1);
      const p2 = footprint(s2);
      const gap = 1;
      return p1[0] < p2[1] + gap && p2[0] < p1[1] + gap && p1[2] < p2[3] + gap && p2[2] < p1[3] + gap;
    }, {id1: s1.id, id2: s2.id});
    if (isOverlapping) {
      throw new Error('Shapes overlap');
    }

    // 5. Click Undo
    await page.click('#btn-undo');
    await sleep(500);

    // 6. Assert only the original remains
    const shapesAfterUndo = await page.evaluate(() => window.__cad.shapes());
    if (shapesAfterUndo.length !== 1) {
      throw new Error(`Expected 1 shape after undo, got ${shapesAfterUndo.length}`);
    }

    // 7. Reload and assert it persists
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__cad && window.__cad.ready, null, { timeout: 5000 });
    const shapesAfterReload = await page.evaluate(() => window.__cad.shapes());
    if (shapesAfterReload.length !== 1) {
      throw new Error(`Expected 1 shape after reload, got ${shapesAfterReload.length}`);
    }

    // 8. Check scrollWidth vs innerWidth
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    }));
    if (dimensions.scrollWidth !== dimensions.innerWidth) {
      throw new Error(`ScrollWidth (${dimensions.scrollWidth}) != innerWidth (${dimensions.innerWidth})`);
    }

    process.stdout.write('single-shape copy verified with undo, autosave, and phone layout\n');

  } catch (err) {
    process.stderr.write(err.message + '\n');
    process.exit(1);
  }

  await browser.close();
})();
