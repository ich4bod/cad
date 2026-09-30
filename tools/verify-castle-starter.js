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
      if (!sessionStorage.getItem('__verifyCastleCleared')) {
        localStorage.clear();
        sessionStorage.setItem('__verifyCastleCleared', '1');
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
      mirror: window.__cad.mirror(),
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

    // 1. All five starter actions fit in the narrow tray.
    const starterButtons = ['#starter-snowman', '#starter-robot', '#starter-rocket', '#starter-car', '#starter-castle'];
    for (const selector of starterButtons) {
      const rect = await buttonRect(selector);
      expect(rect?.visible, `${selector} was not visible at 390x844`);
      expect(rect.left >= 0 && rect.right <= 390 && rect.top >= 0 && rect.bottom <= 844,
        `${selector} was outside the 390x844 viewport: ${JSON.stringify(rect)}`);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390), '390px viewport has horizontal overflow');

    // 2. One tap creates the exact seven ordinary, upright, unpainted records.
    await page.click('#starter-castle');
    await sleep(250);
    let current = await state();
    expect(current.shapes.length === 7, `castle created ${current.shapes.length} records instead of 7`);
    const [leftBase, leftTop, leftRoof, rightBase, rightTop, rightRoof, bridge] = current.shapes;
    expectedFields(leftBase, { id: 1, kind: 'cube', size: 30, gx: -3, gz: 0, level: 0, twin: null, paint: null, lying: false });
    expectedFields(leftTop, { id: 2, kind: 'cube', size: 30, gx: -3, gz: 0, level: 3, twin: null, paint: null, lying: false });
    expectedFields(leftRoof, { id: 3, kind: 'cone', size: 30, gx: -3, gz: 0, level: 6, twin: null, paint: null, lying: false });
    expectedFields(rightBase, { id: 4, kind: 'cube', size: 30, gx: 3, gz: 0, level: 0, twin: null, paint: null, lying: false });
    expectedFields(rightTop, { id: 5, kind: 'cube', size: 30, gx: 3, gz: 0, level: 3, twin: null, paint: null, lying: false });
    expectedFields(rightRoof, { id: 6, kind: 'cone', size: 30, gx: 3, gz: 0, level: 6, twin: null, paint: null, lying: false });
    expectedFields(bridge, { id: 7, kind: 'cube', size: 40, gx: 0, gz: 0, level: 4, twin: null, paint: null, lying: false });
    expect(current.selected === bridge.id, 'bridge was not selected');
    expect(current.mirror === false, 'castle starter changed Mirror');
    expect(current.undo === 1, `castle creation had ${current.undo} Undo entries instead of 1`);
    expect(current.stored?.shapes?.length === 7, 'castle was not autosaved');
    expect(await page.textContent('#hint') === 'A little castle! Raise the bridge or change the towers.', 'castle hint was incorrect');

    // Tower records touch vertically, and the bridge overlaps each tower by 5mm.
    expect(leftBase.level * 10 + leftBase.size === leftTop.level * 10, 'left tower blocks did not touch');
    expect(leftTop.level * 10 + leftTop.size === leftRoof.level * 10, 'left tower roof did not touch');
    expect(rightBase.level * 10 + rightBase.size === rightTop.level * 10, 'right tower blocks did not touch');
    expect(rightTop.level * 10 + rightTop.size === rightRoof.level * 10, 'right tower roof did not touch');
    const bridgeLeft = bridge.gx * 10 - bridge.size / 2;
    const bridgeRight = bridge.gx * 10 + bridge.size / 2;
    const leftInner = leftBase.gx * 10 + leftBase.size / 2;
    const rightInner = rightBase.gx * 10 - rightBase.size / 2;
    expect(bridgeLeft === -20 && bridgeRight === 20, 'bridge did not span x=-20 through 20');
    expect(leftInner - bridgeLeft === 5 && bridgeRight - rightInner === 5, 'bridge did not overlap each tower by 5mm');
    expect(bridge.level * 10 === 40, 'bridge bottom was not 40mm');

    // A starter is empty-tray only; its one snapshot restores an empty plate.
    await page.evaluate(() => document.querySelector('#starter-castle').click());
    expect((await state()).shapes.length === 7, 'castle starter rebuilt over an existing model');
    await page.click('#btn-undo');
    await sleep(150);
    current = await state();
    expect(current.shapes.length === 0 && current.undo === 0, 'one Undo did not return the castle to an empty plate');

    // 3. Rebuild, exercise an ordinary editable piece, and restore the castle.
    await page.click('#starter-castle');
    await sleep(150);
    await page.click('#reshape [data-kind="tube"]', { force: true });
    current = await state();
    expect(byId(current.shapes, 7).kind === 'tube', 'selected bridge was not editable');
    await page.click('#btn-undo');
    current = await state();
    expect(byId(current.shapes, 7).kind === 'cube', 'Undo did not restore the bridge kind');

    // 4. Autosave/reload preserves ordinary editable records and selection.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    current = await state();
    expect(current.shapes.length === 7, 'reload did not restore the castle');
    expect(current.selected === 7, 'reload did not preserve bridge selection');
    expect(current.shapes.every((shape) => shape.twin === null && shape.paint === null && shape.lying === false),
      'reload did not preserve ordinary castle records');

    // 5. STL contains the seven live records using the app's ordinary geometry.
    const stlInfo = await page.evaluate(() => {
      const bytes = window.__cad.stl();
      const view = new DataView(Uint8Array.from(bytes).buffer);
      return { triangles: view.getUint32(80, true), expected: window.__cad.expectedTriangles() };
    });
    expect(stlInfo.triangles === stlInfo.expected,
      `STL triangle count ${stlInfo.triangles} did not equal ${stlInfo.expected}`);

    // Clear/Undo is still one-step, then leave an empty saved tray.
    await page.click('#btn-clear');
    expect((await state()).shapes.length === 0, 'clear did not empty the castle');
    await page.click('#btn-undo');
    expect((await state()).shapes.length === 7, 'clear/Undo did not restore the castle');
    await page.click('#btn-clear');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    expect((await state()).shapes.length === 0, 'empty castle tray did not persist through reload');

    process.stdout.write('editable little castle verified with twin towers bridge and undo\n');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
