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
      if (!sessionStorage.getItem('__verifyAirplaneCleared')) {
        localStorage.clear();
        sessionStorage.setItem('__verifyAirplaneCleared', '1');
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
    const buttonRect = (selector) => page.evaluate((sel) => {
      const button = document.querySelector(sel);
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { visible: !button.hidden && rect.width > 0 && rect.height > 0,
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }, selector);
    const rotation = (id) => page.evaluate((shapeId) => window.__cad.rotationOf(shapeId), id);

    // All six starter actions fit in the narrow, scroll-free tray.
    for (const selector of [
      '#starter-snowman', '#starter-robot', '#starter-rocket',
      '#starter-car', '#starter-castle', '#starter-airplane',
    ]) {
      const rect = await buttonRect(selector);
      expect(rect?.visible, `${selector} was not visible at 390x844`);
      expect(rect.left >= 0 && rect.right <= 390 && rect.top >= 0 && rect.bottom <= 844,
        `${selector} was outside the 390x844 viewport: ${JSON.stringify(rect)}`);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390),
      '390px viewport has horizontal overflow');

    // One tap creates the exact four ordinary records, including their orientations.
    await page.click('#starter-airplane');
    await sleep(250);
    let current = await state();
    expect(current.shapes.length === 4, `airplane created ${current.shapes.length} records instead of 4`);
    const [fuselage, wing, nose, tail] = current.shapes;
    expectedFields(fuselage, {
      id: 1, kind: 'cube', size: 60, gx: 0, gz: 1, level: 0,
      twin: null, paint: null, lying: false, sideways: 'z',
    });
    expectedFields(wing, {
      id: 2, kind: 'tube', size: 80, gx: 0, gz: 0, level: 2,
      twin: null, paint: null, lying: true, sideways: 'x',
    });
    expectedFields(nose, {
      id: 3, kind: 'cone', size: 40, gx: 0, gz: -4, level: 2,
      twin: null, paint: null, lying: true, sideways: 'z',
    });
    expectedFields(tail, {
      id: 4, kind: 'cone', size: 30, gx: 0, gz: 4, level: 2,
      twin: null, paint: null, lying: true, sideways: 'z',
    });
    expect(current.selected === fuselage.id, 'fuselage was not selected');
    expect(current.mirror === false, 'airplane starter changed Mirror');
    expect(current.undo === 1, `airplane creation had ${current.undo} Undo entries instead of 1`);
    expect(current.stored?.shapes?.length === 4, 'airplane was not autosaved');
    expect(await page.textContent('#hint') ===
      'A little airplane! Turn the wing or reshape the tail.', 'airplane hint was incorrect');

    const blockRotation = await rotation(fuselage.id);
    const wingRotation = await rotation(wing.id);
    const noseRotation = await rotation(nose.id);
    const tailRotation = await rotation(tail.id);
    expect(Math.abs(blockRotation.x) < EPS && Math.abs(blockRotation.z) < EPS,
      `fuselage was not upright: ${JSON.stringify(blockRotation)}`);
    expect(Math.abs(wingRotation.z - Math.PI / 2) < EPS && Math.abs(wingRotation.x) < EPS,
      `wing did not point left to right: ${JSON.stringify(wingRotation)}`);
    for (const [name, rendered] of [['nose', noseRotation], ['tail', tailRotation]]) {
      expect(Math.abs(rendered.x - Math.PI / 2) < EPS && Math.abs(rendered.z) < EPS,
        `${name} did not point front to back: ${JSON.stringify(rendered)}`);
    }

    // Starters are empty-only, and their one snapshot returns to an empty model.
    await page.evaluate(() => document.querySelector('#starter-airplane').click());
    const unchanged = await state();
    expect(unchanged.shapes.length === 4 && unchanged.undo === 1,
      'airplane starter rebuilt over an existing model');
    await page.click('#btn-undo');
    await sleep(150);
    current = await state();
    expect(current.shapes.length === 0 && current.undo === 0,
      'one Undo did not return the airplane to an empty plate');

    // Rebuild, reshape the wing and tail through the ordinary editor, and undo each edit.
    await page.click('#starter-airplane');
    await sleep(150);
    await page.evaluate(() => window.selectShapeById(2));
    await page.click('#reshape [data-kind="cube"]', { force: true });
    current = await state();
    expect(current.shapes.find((shape) => shape.id === 2).kind === 'cube',
      'editable wing did not reshape');
    await page.click('#btn-undo');
    current = await state();
    expect(current.shapes.find((shape) => shape.id === 2).kind === 'tube',
      'Undo did not restore the wing');
    await page.evaluate(() => window.selectShapeById(4));
    await page.click('#reshape [data-kind="tube"]', { force: true });
    current = await state();
    expect(current.shapes.find((shape) => shape.id === 4).kind === 'tube',
      'editable tail did not reshape');
    await page.click('#btn-undo');
    current = await state();
    expect(current.shapes.find((shape) => shape.id === 4).kind === 'cone',
      'Undo did not restore the tail');

    // Reload preserves the ordinary records and the selected tail.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    current = await state();
    expect(current.shapes.length === 4, 'reload did not restore the airplane');
    expect(current.selected === 4, 'reload did not preserve tail selection');
    expect(current.shapes.every((shape) => shape.twin === null && shape.paint === null),
      'reload did not preserve ordinary airplane records');
    expect(current.shapes[1].lying && current.shapes[1].sideways === 'x',
      'reload did not preserve the crossing wing orientation');
    expect(current.shapes[2].lying && current.shapes[2].sideways === 'z' &&
      current.shapes[3].lying && current.shapes[3].sideways === 'z',
      'reload did not preserve nose and tail orientation');

    // STL contains exactly the live four records using ordinary app geometry.
    const stlInfo = await page.evaluate(() => {
      const bytes = window.__cad.stl();
      const view = new DataView(Uint8Array.from(bytes).buffer);
      return { triangles: view.getUint32(80, true), expected: window.__cad.expectedTriangles() };
    });
    expect(stlInfo.triangles === stlInfo.expected,
      `STL triangle count ${stlInfo.triangles} did not equal ${stlInfo.expected}`);

    // Leave a clean saved tray and confirm the starter remains reachable after reload.
    await page.click('#btn-clear');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    expect((await state()).shapes.length === 0, 'empty airplane tray did not persist through reload');
    expect((await buttonRect('#starter-airplane')).visible, 'airplane starter was not visible on the empty tray');

    process.stdout.write('editable little airplane verified with crossing sideways pieces and undo\n');
  } catch (e) {
    process.stderr.write(`${e.stack || e}\n`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
