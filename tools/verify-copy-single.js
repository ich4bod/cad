'use strict';

const { chromium } = require('playwright');

const BASE = process.argv[2] || 'https://cad.ichabod-crane.net/';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });

    await page.waitForFunction(() => window.__cad && window.__cad.ready);

    if (await page.isVisible('#tour')) {
      await page.click('#tour-skip');
    }

    // 1. Add a Block
    await page.click('#palette .shape[data-kind="cube"]');
    await page.waitForSelector('.shape[data-kind="cube"]');
    await page.waitForTimeout(500);
    const shapesCount = await page.evaluate(() => window.__cad.shapes().length);
    console.log(`Shapes count after adding one: ${shapesCount}`);
    if (shapesCount === 0) throw new Error('No shapes added');

    // 2. Make it Bigger and Up
    await page.click('#btn-bigger');
    await page.waitForTimeout(500);
    await page.click('#btn-up');
    await page.waitForTimeout(500);

    const initialShape = await page.evaluate(() => window.__cad.shapes()[0]);
    
    console.log('Checking for #btn-copy...');
    const allButtonIds = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.id));
    console.log(`All button IDs: ${allButtonIds.join(', ')}`);
    
    const isButtonVisible = await page.locator('#btn-copy').isVisible();
    console.log(`Is Copy button visible? ${isButtonVisible}`);
    
    const isCopyEnabled = await page.isEnabled('#btn-copy');
    console.log(`Is Copy button enabled? ${isCopyEnabled}`);

    // 3. Click Copy
    await page.click('#btn-copy');
    await page.waitForTimeout(500);

    // 4. Assertions
    const assertions = await page.evaluate((initial) => {
      const shapes = window.__cad.shapes();
      const GRID = 10;
      const footprint = (size, gx, gz) => [
        gx * GRID - size / 2, gx * GRID + size / 2,
        gz * GRID - size / 2, gz * GRID + size / 2,
      ];
      const overlaps = (a, b, gap) =>
        a[0] < b[1] + gap && b[0] < a[1] + gap && a[2] < b[3] + gap && b[2] < a[3] + gap;

      if (shapes.length !== 2) return { ok: false, msg: `Expected 2 shapes, got ${shapes.length}` };

      const [s1, s2] = shapes;

      // Check same kind/size/level
      const sameProps = (s) => s.kind === initial.kind && s.size === initial.size && s.level === initial.level;
      if (!sameProps(s1) || !sameProps(s2)) return { ok: false, msg: 'Shapes have different kind, size, or level' };

      // Check distinct unpaired records
      if (s1.id === s2.id) return { ok: false, msg: 'Shapes have the same id' };
      if (s1.twin !== null || s2.twin !== null) return { ok: false, msg: 'Shapes are not unpaired' };

      // Check non-overlapping footprints
      const rects = shapes.map(s => footprint(s.size, s.gx, s.gz));
      if (overlaps(rects[0], rects[1], 1)) return { ok: false, msg: 'Shapes have overlapping footprints' };

      return { ok: true };
    }, initialShape);

    if (!assertions.ok) throw new Error(assertions.msg);

    // 5. Click Undo and assert only the original remains
    await page.click('#btn-undo');
    await page.waitForTimeout(500);
    const afterUndo = await page.evaluate((initial) => {
      const shapes = window.__cad.shapes();
      return shapes.length === 1 && shapes[0].id === initial.id;
    }, initialShape);
    if (!afterUndo) throw new Error('After undo, only the original remains is false');

    // 6. Reload and assert it persists
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad && window.__cad.ready);
    const afterReload = await page.evaluate((initial) => {
      const shapes = window.__cad.shapes();
      return shapes.length === 1 && shapes[0].id === initial.id;
    }, initialShape);
    if (!afterReload) throw new Error('Shape did not persist after reload');

    // 7. Viewport check
    const dims = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth
    }));
    if (dims.sw !== dims.iw) throw new Error(`Scroll width (${dims.sw}) !== inner width (${dims.iw})`);

    console.log('single-shape copy verified with undo, autosave, and phone layout');

  } catch (e) {
    console.error(e.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
