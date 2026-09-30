'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
const fail = (message) => { throw new Error(message); };
const EPS = 1e-4;

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('__verifySailboatCleared')) {
        localStorage.clear();
        sessionStorage.setItem('__verifySailboatCleared', '1');
      }
    });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    if (await page.isVisible('#tour')) await page.click('#tour-skip', { force: true });

    const state = () => page.evaluate(() => ({
      shapes: window.__cad.shapes(),
      selected: window.__cad.selectedId(),
      mirror: window.__cad.mirror(),
      undo: window.__cad.undoDepth(),
      stored: window.__cad.stored(),
    }));
    const expect = (condition, message) => { if (!condition) fail(message); };
    const expectedFields = (shape, expected) => {
      for (const [key, value] of Object.entries(expected)) {
        expect(shape[key] === value,
          `shape ${shape.id} ${key} was ${JSON.stringify(shape[key])}, expected ${JSON.stringify(value)}`);
      }
    };
    const rotation = (id) => page.evaluate((shapeId) => window.__cad.rotationOf(shapeId), id);
    const rectOf = (selector) => page.evaluate((sel) => {
      const button = document.querySelector(sel);
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { visible: !button.hidden && rect.width > 0 && rect.height > 0,
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }, selector);
    const xSpan = (shape) => [shape.gx * 10 - shape.size / 2, shape.gx * 10 + shape.size / 2];
    const ySpan = (shape) => [shape.level * 10, shape.level * 10 + shape.size];

    // All seven starter buttons remain reachable in the dismissed-tour phone tray.
    const starterSelectors = [
      '#starter-snowman', '#starter-robot', '#starter-rocket', '#starter-car',
      '#starter-castle', '#starter-airplane', '#starter-sailboat',
    ];
    for (const selector of starterSelectors) {
      const rect = await rectOf(selector);
      expect(rect?.visible, `${selector} was not visible at 390x844`);
      expect(rect.bottom - rect.top >= 44,
        `${selector} was shorter than 44px: ${JSON.stringify(rect)}`);
      expect(rect.left >= 0 && rect.right <= 390 && rect.top >= 0 && rect.bottom <= 844,
        `${selector} was outside the 390x844 viewport: ${JSON.stringify(rect)}`);
      expect(await page.evaluate((sel) => {
        const button = document.querySelector(sel);
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
        return hit === button || button.contains(hit);
      }, selector), `${selector} was covered at its center`);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390),
      '390px viewport has horizontal overflow');

    // One tap creates the exact five painted records in the requested order.
    await page.click('#starter-sailboat');
    await sleep(250);
    let current = await state();
    expect(current.shapes.length === 5, `sailboat created ${current.shapes.length} records instead of 5`);
    const [hull, mast, bow, rightSail, leftSail] = current.shapes;
    expectedFields(hull, { id: 1, kind: 'cube', size: 80, gx: 0, gz: 0, level: 0,
      twin: null, paint: 'sky', lying: false, sideways: 'z' });
    expectedFields(mast, { id: 2, kind: 'tube', size: 50, gx: 0, gz: 0, level: 8,
      twin: null, paint: 'coral', lying: false, sideways: 'z' });
    expectedFields(bow, { id: 3, kind: 'cone', size: 40, gx: 0, gz: -6, level: 2,
      twin: null, paint: 'sky', lying: true, sideways: 'z' });
    expectedFields(rightSail, { id: 4, kind: 'cube', size: 40, gx: 2, gz: 0, level: 9,
      twin: null, paint: 'sun', lying: false, sideways: 'z' });
    expectedFields(leftSail, { id: 5, kind: 'cube', size: 30, gx: -2, gz: 0, level: 10,
      twin: null, paint: 'sun', lying: false, sideways: 'z' });
    expect(current.selected === mast.id, 'mast was not selected');
    expect(current.mirror === false, 'sailboat starter changed Mirror');
    expect(await windowNextId(page) === 6, 'sailboat did not advance ids to 6');
    expect(current.undo === 1, `sailboat creation had ${current.undo} Undo entries instead of 1`);
    expect(current.stored?.shapes?.length === 5, 'sailboat was not autosaved');
    expect(await page.textContent('#hint') ===
      'A little sailboat! Move it across the plate or repaint every piece.', 'sailboat hint was incorrect');

    // The records make a continuous mast and the specified overlapping sails.
    expect(ySpan(hull)[1] === ySpan(mast)[0] && ySpan(mast)[1] === 130,
      'mast did not begin at the hull top and reach 130mm');
    expect(JSON.stringify(xSpan(rightSail)) === JSON.stringify([0, 40]) &&
      JSON.stringify(ySpan(rightSail)) === JSON.stringify([90, 130]),
      `right sail geometry was wrong: ${JSON.stringify({ x: xSpan(rightSail), y: ySpan(rightSail) })}`);
    expect(JSON.stringify(xSpan(leftSail)) === JSON.stringify([-35, -5]) &&
      JSON.stringify(ySpan(leftSail)) === JSON.stringify([100, 130]),
      `left sail geometry was wrong: ${JSON.stringify({ x: xSpan(leftSail), y: ySpan(leftSail) })}`);
    expect(xSpan(rightSail)[0] <= xSpan(mast)[1] && xSpan(rightSail)[1] >= xSpan(mast)[0],
      'right sail did not touch or overlap the mast');
    expect(xSpan(leftSail)[1] >= -5 && xSpan(leftSail)[0] <= -10,
      'left sail did not overlap the mast edge from -10mm through -5mm');

    const mastRotation = await rotation(mast.id);
    const bowRotation = await rotation(bow.id);
    expect(Math.abs(mastRotation.x) < EPS && Math.abs(mastRotation.z) < EPS,
      `mast was not upright: ${JSON.stringify(mastRotation)}`);
    expect(Math.abs(bowRotation.x - Math.PI / 2) < EPS && Math.abs(bowRotation.z) < EPS,
      `bow was not lying sideways z: ${JSON.stringify(bowRotation)}`);

    // Starters are empty-only; one Undo returns this build to an empty model.
    await page.evaluate(() => document.querySelector('#starter-sailboat').click());
    expect((await state()).shapes.length === 5, 'sailboat starter rebuilt over an existing model');
    await page.click('#btn-undo');
    await sleep(150);
    current = await state();
    expect(current.shapes.length === 0 && current.undo === 0,
      'one Undo did not return the sailboat to an empty plate');

    // Rebuild, move the whole build, paint it through the ordinary controls, and Undo the paint.
    await page.click('#starter-sailboat');
    await sleep(150);
    const beforeMove = await state();
    expect(await page.evaluate(() => window.__cad.moveBuild(1, 2)) === true,
      'editable whole-build movement was rejected');
    const moved = await state();
    for (const before of beforeMove.shapes) {
      const after = moved.shapes.find((shape) => shape.id === before.id);
      expect(after.gx === before.gx + 1 && after.gz === before.gz + 2,
        `shape ${before.id} did not move with the whole build`);
    }
    await page.click('#btn-paint-build');
    await page.click('[data-paint="violet"]');
    current = await state();
    expect(current.shapes.every((shape) => shape.paint === 'violet'),
      'whole-build painting did not reach every sailboat piece');
    expect(await page.textContent('#hint') === 'Painted the whole build violet!',
      'whole-build sailboat paint hint was incorrect');
    await page.click('#btn-undo');
    current = await state();
    expect(current.shapes.every((shape) => shape.paint === beforeMove.shapes.find((s) => s.id === shape.id).paint),
      'Undo did not restore the sailboat colors after painting');

    // Reload preserves the ordinary editable records and selected mast.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    current = await state();
    expect(current.shapes.length === 5 && current.selected === 2,
      'reload did not preserve the moved sailboat and mast selection');
    expect(current.shapes.every((shape) => shape.twin === null),
      'reload did not preserve ordinary sailboat records');

    // STL contains exactly the five live records using ordinary app geometry.
    const stlInfo = await page.evaluate(() => {
      const bytes = window.__cad.stl();
      const view = new DataView(Uint8Array.from(bytes).buffer);
      return { triangles: view.getUint32(80, true), expected: window.__cad.expectedTriangles() };
    });
    expect(stlInfo.triangles === stlInfo.expected,
      `STL triangle count ${stlInfo.triangles} did not equal ${stlInfo.expected}`);

    await page.click('#btn-clear');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    expect((await state()).shapes.length === 0, 'empty sailboat tray did not persist through reload');

    process.stdout.write('editable little sailboat verified with painted hull mast sails and undo\n');
  } catch (e) {
    process.stderr.write(`${e.stack || e}\n`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();

async function windowNextId(page) {
  return page.evaluate(() => window.__cad.nextId());
}
