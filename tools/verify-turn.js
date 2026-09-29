'use strict';
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'https://cad.ichabod-crane.net/';

const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const fieldsOf = (s) => ({ id: s.id, kind: s.kind, size: s.size, gx: s.gx, gz: s.gz, level: s.level, paint: s.paint, twin: s.twin });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => localStorage.clear());
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    if (await page.isVisible('#tour')) await page.click('#tour-skip');

    const state = () => page.evaluate(() => ({
      shapes: window.__cad.shapes(),
      selected: window.__cad.selectedId(),
      undo: window.__cad.undoDepth(),
    }));
    const turnButton = () => page.evaluate(() => ({
      text: document.querySelector('#btn-turn').textContent.trim(),
      aria: document.querySelector('#btn-turn').getAttribute('aria-label'),
      disabled: document.querySelector('#btn-turn').disabled,
    }));
    const expect = (condition, message) => { if (!condition) throw new Error(message); };
    const expectButton = async (text, disabled = false) => {
      const button = await turnButton();
      expect(button.text === text, `Turn text was ${JSON.stringify(button.text)}, expected ${JSON.stringify(text)}`);
      expect(button.aria === text, `Turn aria-label was ${JSON.stringify(button.aria)}, expected ${JSON.stringify(text)}`);
      expect(button.disabled === disabled, `Turn disabled was ${button.disabled}, expected ${disabled}`);
    };

    await page.evaluate(() => window.addShape('cube'));
    await expectButton('Lay down', true);
    await page.click('#btn-clear');
    await page.evaluate(() => window.addShape('ball'));
    await expectButton('Lay down', true);
    await page.click('#btn-clear');

    await page.evaluate(() => window.addShape('tube'));
    await page.waitForSelector('#paint:not([hidden])');
    let before = await state();
    const id = before.selected;
    const original = before.shapes.find((s) => s.id === id);
    expect(original.kind === 'tube' && original.size === 30, 'new Tube was not 30mm');
    expect(original.lying === false, 'new Tube was not upright');
    const originalFields = fieldsOf(original);
    const originalStl = await page.evaluate(() => window.__cad.stl());
    await expectButton('Lay down');

    const turnUndo = before.undo;
    await page.click('#btn-turn');
    let turned = await state();
    const turnedShape = turned.shapes.find((s) => s.id === id);
    expect(turnedShape.lying === true, 'Tube did not lie down');
    expect(turned.undo === turnUndo + 1, 'turn did not add exactly one Undo entry');
    for (const key of Object.keys(originalFields)) {
      expect(turnedShape[key] === originalFields[key], `turn changed ${key}`);
    }
    expect((await turnButton()).text === 'Stand up', 'lying Tube did not say Stand up');
    expect((await page.textContent('#hint')).trim() === 'Lying down.', 'lying hint was incorrect');
    const lyingStl = await page.evaluate(() => window.__cad.stl());
    expect(!sameBytes(originalStl, lyingStl), 'lying Tube STL did not change');

    await page.click('#btn-undo');
    const undone = await state();
    const undoneShape = undone.shapes.find((s) => s.id === id);
    expect(undoneShape.lying === false, 'Undo did not restore upright Tube');
    expect(sameBytes(originalStl, await page.evaluate(() => window.__cad.stl())), 'Undo did not restore original STL');
    await expectButton('Lay down');

    await page.click('#btn-turn');
    expect((await state()).shapes.find((s) => s.id === id).lying === true, 'Tube did not lie down for reload test');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    const reloaded = await state();
    const reloadedShape = reloaded.shapes.find((s) => s.id === id);
    expect(reloadedShape && reloadedShape.lying === true, 'lying Tube did not persist through reload');
    await expectButton('Stand up');

    await page.click('#btn-copy');
    const copied = await state();
    const copy = copied.shapes.find((s) => s.id === copied.selected);
    expect(copy && copy.id !== id && copy.lying === true, 'Copy did not preserve lying orientation');

    await page.click('#btn-clear');
    expect((await state()).shapes.length === 0, 'clear did not empty the plate');
    await page.click('#btn-mirror');
    await page.evaluate(() => window.addShape('cone'));
    const pairBefore = (await state()).shapes;
    expect(pairBefore.length === 2 && pairBefore.every((s) => s.twin !== null && s.kind === 'cone' && s.lying === false), 'mirrored Cone pair was not created');
    await expectButton('Lay down');
    const pairIds = pairBefore.map((s) => s.id);
    const pairTurnUndo = (await state()).undo;
    await page.click('#btn-turn');
    let pairState = await state();
    expect(pairState.undo === pairTurnUndo + 1, 'mirrored turn did not add one Undo entry');
    expect(pairState.shapes.filter((s) => pairIds.includes(s.id)).every((s) => s.lying === true), 'mirrored turn did not update both records');
    await expectButton('Stand up');
    const pairStandUndo = pairState.undo;
    await page.click('#btn-turn');
    pairState = await state();
    expect(pairState.undo === pairStandUndo + 1, 'mirrored stand did not add one Undo entry');
    expect(pairState.shapes.filter((s) => pairIds.includes(s.id)).every((s) => s.lying === false), 'mirrored stand did not update both records');
    await expectButton('Lay down');

    await page.click('#btn-turn');
    pairState = await state();
    expect(pairState.shapes.filter((s) => pairIds.includes(s.id)).every((s) => s.lying === true), 'Cone did not lie down before reshape');
    await page.click('#reshape [data-kind="cube"]', { force: true });
    pairState = await state();
    expect(pairState.shapes.every((s) => s.kind === 'cube' && s.lying === true), 'lying Cone did not retain orientation as Block');
    await expectButton('Lay down', true);
    await page.click('#reshape [data-kind="cone"]', { force: true });
    pairState = await state();
    expect(pairState.shapes.every((s) => s.kind === 'cone' && s.lying === true), 'Block did not restore lying Cone orientation');
    await expectButton('Stand up');

    const stlInfo = await page.evaluate(() => {
      const bytes = window.__cad.stl();
      const view = new DataView(Uint8Array.from(bytes).buffer);
      return { triangles: view.getUint32(80, true), expected: window.__cad.expectedTriangles() };
    });
    expect(stlInfo.triangles === stlInfo.expected, `STL triangle count ${stlInfo.triangles} did not equal ${stlInfo.expected}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth) <= 390, 'page has horizontal overflow at 390px');

    process.stdout.write('sideways tubes and cones verified across mirror undo reload copy reshape and STL\n');
  } catch (e) {
    console.error(e.stack || e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
