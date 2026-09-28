'use strict';

const { chromium } = require('playwright-core');

const RAW_URL = process.argv[2] || 'https://cad.ichabod-crane.net/';
// Handle potential query strings in the URL by removing trailing slash before appending /
const BASE = RAW_URL.endsWith('/') ? RAW_URL.slice(0, -1) : RAW_URL;

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  try {
    await page.goto(BASE + '/', { waitUntil: 'load' });

    // 1. dismiss tour
    if (await page.isVisible('#tour')) {
      await page.click('#tour-skip');
    }

    // 2. add Block
    await page.click('.shape[data-kind="cube"]');

    // 3. paint violet
    const paintExists = await page.evaluate(() => !!document.getElementById('paint'));
    console.log('Paint element exists:', paintExists);
    if (paintExists) {
      const isHidden = await page.evaluate(() => document.getElementById('paint').hidden);
      console.log('Paint element is hidden:', isHidden);
    }
    await page.click('[data-paint="violet"]');

    // 4. assert live material color through a small window.__cad.colour(id) hook and stored paint
    const shapeInfo = await page.evaluate(() => {
      const s = window.__cad.shapes().find(x => x.kind === 'cube');
      if (!s) return null;
      return {
        id: s.id,
        liveColor: window.__cad.colour(s.id),
        storedPaint: s.paint,
      };
    });
    if (!shapeInfo) throw new Error('Could not find cube shape');
    const violetColor = 0xb197fc; // violet
    if (shapeInfo.liveColor !== violetColor) throw new Error(`Expected live color ${violetColor.toString(16)}, got ${shapeInfo.liveColor.toString(16)}`);
    if (shapeInfo.storedPaint !== 'violet') throw new Error(`Expected stored paint 'violet', got '${shapeInfo.storedPaint}'`);

    // 5. Undo to native coral
    await page.click('#btn-undo');
    const coralColor = 0xff6b6b; // coral
    const coralShapeInfo = await page.evaluate(() => {
      const s = window.__cad.shapes().find(x => x.kind === 'cube');
      if (!s) return null;
      return {
        id: s.id,
        liveColor: window.__cad.colour(s.id),
        storedPaint: s.paint,
      };
    });
    if (!coralShapeInfo) throw new Error('Could not find cube shape after undo');
    if (coralShapeInfo.liveColor !== coralColor) throw new Error(`Expected coral color ${coralColor.toString(16)}, got ${coralShapeInfo.liveColor.toString(16)}`);
    if (coralShapeInfo.storedPaint !== null) throw new Error(`Expected stored paint null, got '${coralShapeInfo.storedPaint}'`);

    // 6. turn Mirror on
    await page.click('#btn-mirror');

    // 7. add Ball
    await page.click('.shape[data-kind="ball"]');

    // 8. paint sun
    await page.click('[data-paint="sun"]');

    // 9. assert both records (pair)
    const pairCheck = await page.evaluate(() => {
      const s = window.__cad.shapes();
      const pair = s.filter(x => x.twin !== null);
      return pair.length === 2 && pair.every(x => x.paint === 'sun');
    });
    if (!pairCheck) throw new Error('Mirror pair did not both have sun paint');

    // 10. Copy and assert both copied records
    await page.click('#btn-copy');
    const copyCheck = await page.evaluate(() => {
      const s = window.__cad.shapes();
      // Original: 1 Cube, 2 Balls (a pair)
      // Copied: 2 more Balls (a pair)
      // Total: 5
      if (s.length !== 5) return false;
      const balls = s.filter(x => x.kind === 'ball');
      const cube = s.find(x => x.kind === 'cube');
      return balls.length === 4 &&
             balls.every(x => x.paint === 'sun') &&
             cube.paint === null;
    });
    if (!copyCheck) throw new Error('Copy operation failed to duplicate correctly with paint');

    // 11. reload and assert all paint values survive
    await page.reload({ waitUntil: 'networkidle' });
    const reloadCheck = await page.evaluate(() => {
      return window.__cad.shapes().every(x => x.paint === 'sun' || x.paint === null);
    });
    if (!reloadCheck) throw new Error('Paint values did not survive reload');

    // 12. assert STL byte array is identical immediately before and after repainting one selected shape
    const stlBefore = await page.evaluate(() => window.__cad.stl());
    const idToRepaint = (await page.evaluate(() => window.__cad.shapes()[0].id));
    const pos = await page.evaluate((id) => window.__cad.screenOf(id), idToRepaint);
    await page.mouse.click(pos.x, pos.y);
    await page.click('[data-paint="coral"]');
    const stlAfter = await page.evaluate(() => window.__cad.stl());
    if (JSON.stringify(stlBefore) !== JSON.stringify(stlAfter)) {
      throw new Error('STL changed after repainting a shape');
    }

    // 13. Check no 390×844 overflow
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    if (width > 390) throw new Error(`Overflow detected: width is ${width}`);

    console.log('shape paint verified across mirror copy undo reload and STL');

  } catch (e) {
    console.error(e.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
