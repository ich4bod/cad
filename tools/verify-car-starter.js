'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
const fail = (message) => { throw new Error(message); };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('__verifyCarCleared')) {
        localStorage.clear();
        sessionStorage.setItem('__verifyCarCleared', '1');
      }
    });
    const page = await context.newPage();
    page.on('console', (message) => process.stderr.write(`[browser ${message.type()}] ${message.text()}\n`));
    page.on('pageerror', (error) => process.stderr.write(`[pageerror] ${error.message}\n`));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    if (await page.isVisible('#tour')) await page.click('#tour-skip', { force: true });

    const state = () => page.evaluate(() => ({
      shapes: window.__cad.shapes(),
      selected: window.__cad.selectedId(),
      undo: window.__cad.undoDepth(),
      stored: window.__cad.stored(),
    }));
    const expect = (condition, message) => { if (!condition) fail(message); };
    const byId = (list, id) => list.find((shape) => shape.id === id);
    const expectedFields = (shape, expected) => {
      for (const [key, value] of Object.entries(expected)) {
        expect(shape[key] === value, `shape ${shape.id} ${key} was ${JSON.stringify(shape[key])}, expected ${JSON.stringify(value)}`);
      }
    };
    const buttonRect = (selector) => page.evaluate((sel) => {
      const button = document.querySelector(sel);
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { visible: !button.hidden && rect.width > 0 && rect.height > 0,
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }, selector);

    // 1. The repaired narrow starter tray keeps all four actions on-screen.
    const starterButtons = ['#starter-snowman', '#starter-robot', '#starter-rocket', '#starter-car'];
    for (const selector of starterButtons) {
      const rect = await buttonRect(selector);
      expect(rect?.visible, `${selector} was not visible at 390x844`);
      expect(rect.left >= 0 && rect.right <= 390 && rect.top >= 0 && rect.bottom <= 844,
        `${selector} was outside the 390x844 viewport: ${JSON.stringify(rect)}`);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390), '390px viewport has horizontal overflow');

    // 2. One tap creates the exact editable car, with one initial Undo snapshot.
    await page.click('#starter-car');
    await sleep(250);
    let current = await state();
    expect(current.shapes.length === 6, `car created ${current.shapes.length} records instead of 6`);
    const [bodyLeft, bodyRight, leftFront, leftBack, rightFront, rightBack] = current.shapes;
    expectedFields(bodyLeft, { id: 1, kind: 'cube', size: 40, gx: -2, gz: 0, level: 2, twin: null, paint: null, lying: false });
    expectedFields(bodyRight, { id: 2, kind: 'cube', size: 40, gx: 2, gz: 0, level: 2, twin: null, paint: null, lying: false });
    expectedFields(leftFront, { id: 3, kind: 'tube', size: 20, gx: -2, gz: -3, level: 0, twin: 4, paint: null, lying: true });
    expectedFields(leftBack, { id: 4, kind: 'tube', size: 20, gx: -2, gz: 3, level: 0, twin: 3, paint: null, lying: true });
    expectedFields(rightFront, { id: 5, kind: 'tube', size: 20, gx: 2, gz: -3, level: 0, twin: 6, paint: null, lying: true });
    expectedFields(rightBack, { id: 6, kind: 'tube', size: 20, gx: 2, gz: 3, level: 0, twin: 5, paint: null, lying: true });
    expect(current.selected === bodyLeft.id, 'first body block was not selected');
    expect(current.undo === 1, `car creation had ${current.undo} Undo entries instead of 1`);
    expect(current.stored?.shapes?.length === 6, 'car was not autosaved');

    const bodyBottom = bodyLeft.level * 10 + bodyLeft.size / 2 - bodyLeft.size / 2;
    const wheelTop = leftFront.level * 10 + leftFront.size / 2 + leftFront.size / 2;
    expect(bodyBottom === 20, `body bottom was ${bodyBottom}mm instead of 20mm`);
    expect(wheelTop === 20, `lying wheel top was ${wheelTop}mm instead of 20mm`);
    expect(bodyLeft.gx * 10 + bodyLeft.size / 2 === bodyRight.gx * 10 - bodyRight.size / 2,
      'body blocks did not touch at x=0');
    expect(leftFront.gz === -3 && leftBack.gz === 3 && rightFront.gz === -3 && rightBack.gz === 3,
      'wheel axes were not front-to-back in the exact order');
    expect(await page.textContent('#hint') === 'A little car! Change the body or roll the wheels around.', 'car hint was incorrect');

    // A starter is an empty-tray action only, and its single Undo returns to empty.
    await page.evaluate(() => document.querySelector('#starter-car').click());
    expect((await state()).shapes.length === 6, 'car starter rebuilt over an existing model');
    await page.click('#btn-undo');
    await sleep(150);
    current = await state();
    expect(current.shapes.length === 0 && current.undo === 0, 'one Undo did not return the car to an empty plate');

    // 3. Rebuild and exercise the wheels through the normal edit controls.
    await page.click('#starter-car');
    await sleep(150);
    current = await state();
    expect(current.shapes.length === 6 && current.selected === 1, 'car did not rebuild with body selected');
    await page.evaluate(() => window.selectShapeById(3));
    await page.click('#btn-turn');
    current = await state();
    expect(byId(current.shapes, 3).lying === false && byId(current.shapes, 4).lying === false,
      'turning a wheel did not update its live twin');
    await page.click('#btn-undo');
    current = await state();
    expect(byId(current.shapes, 3).lying === true && byId(current.shapes, 4).lying === true,
      'Undo did not restore the sideways wheel pair');
    await page.click('#reshape [data-kind="cube"]', { force: true });
    current = await state();
    expect(byId(current.shapes, 3).kind === 'cube' && byId(current.shapes, 4).kind === 'cube',
      'reshaping a wheel did not update its live twin');
    expect(byId(current.shapes, 3).lying === true && byId(current.shapes, 4).lying === true,
      'reshaping a wheel did not preserve its orientation');
    await page.click('#reshape [data-kind="tube"]', { force: true });
    current = await state();
    expect(byId(current.shapes, 3).kind === 'tube' && byId(current.shapes, 4).kind === 'tube',
      'wheel did not become editable Tube again');

    // 4. Autosave/reload preserves the ordinary editable car state.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    current = await state();
    expect(current.shapes.length === 6, 'reload did not restore the car');
    expect(byId(current.shapes, 3).lying === true && byId(current.shapes, 4).lying === true,
      'reload did not preserve wheel orientation');
    expect(byId(current.shapes, 3).kind === 'tube' && byId(current.shapes, 4).kind === 'tube',
      'reload did not preserve wheel reshaping');

    // 5. STL is the six live records, with exactly the app geometry triangle count.
    const stlInfo = await page.evaluate(() => {
      const bytes = window.__cad.stl();
      const view = new DataView(Uint8Array.from(bytes).buffer);
      return { triangles: view.getUint32(80, true), expected: window.__cad.expectedTriangles() };
    });
    expect(stlInfo.triangles === stlInfo.expected,
      `STL triangle count ${stlInfo.triangles} did not equal ${stlInfo.expected}`);

    // Return to an empty tray so the visible starter set is also checked after reload.
    await page.click('#btn-clear');
    await page.click('#btn-undo');
    expect((await state()).shapes.length === 6, 'clear/Undo did not restore the car');
    await page.click('#btn-clear');
    expect((await state()).shapes.length === 0, 'clear did not empty the car tray');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    expect((await state()).shapes.length === 0, 'empty car tray did not persist through reload');

    process.stdout.write('editable little car starter verified with four sideways wheels and undo\n');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
