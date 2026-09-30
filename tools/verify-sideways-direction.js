'use strict';
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'https://cad.ichabod-crane.net/';
const EPS = 1e-4;
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('__verifySidewaysCleared')) {
        localStorage.clear();
        sessionStorage.setItem('__verifySidewaysCleared', '1');
      }
    });
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    if (await page.isVisible('#tour')) await page.click('#tour-skip');

    const expect = (condition, message) => { if (!condition) throw new Error(message); };
    const state = () => page.evaluate(() => ({
      shapes: window.__cad.shapes(), selected: window.__cad.selectedId(), undo: window.__cad.undoDepth(),
    }));
    const selected = async () => {
      const s = await state();
      return s.shapes.find((shape) => shape.id === s.selected);
    };
    const button = () => page.evaluate(() => {
      const b = document.querySelector('#btn-turn-sideways');
      return { text: b.textContent.trim(), aria: b.getAttribute('aria-label'), disabled: b.disabled };
    });
    const rotation = () => page.evaluate(() => window.__cad.rotationOf(window.__cad.selectedId()));
    const expectDirection = async (direction) => {
      const s = await selected();
      const r = await rotation();
      expect(s.sideways === direction, `state direction was ${s.sideways}, expected ${direction}`);
      if (direction === 'x') {
        expect(Math.abs(r.z - Math.PI / 2) < EPS && Math.abs(r.x) < EPS, `render rotation was ${JSON.stringify(r)}, expected positive Z`);
      } else {
        expect(Math.abs(r.x - Math.PI / 2) < EPS && Math.abs(r.z) < EPS, `render rotation was ${JSON.stringify(r)}, expected positive X`);
      }
    };

    await page.evaluate(() => window.addShape('tube'));
    expect((await selected()).sideways === 'z', 'new Tube did not default to z');
    await page.click('#btn-turn');
    expect((await button()).disabled === false, 'sideways button stayed disabled for lying Tube');
    await expectDirection('z');
    const zStl = await page.evaluate(() => window.__cad.stl());
    const beforeSideways = await state();
    await page.click('#btn-turn-sideways');
    const turned = await state();
    expect(turned.undo === beforeSideways.undo + 1, 'sideways turn did not add one Undo entry');
    expect((await page.textContent('#hint')).trim() === 'Now it points left to right.', 'x direction hint was incorrect');
    await expectDirection('x');
    const xStl = await page.evaluate(() => window.__cad.stl());
    expect(!sameBytes(zStl, xStl), 'x direction did not change STL');

    await page.click('#btn-undo');
    await expectDirection('z');
    await page.click('#btn-turn-sideways');
    await expectDirection('x');
    const originalId = (await selected()).id;
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    await expectDirection('x');

    await page.click('#btn-copy');
    expect((await selected()).sideways === 'x', 'Copy did not preserve x direction');
    await page.click('#btn-stack-copy');
    expect((await selected()).sideways === 'x', 'Stack copy did not preserve x direction');
    await page.click('#btn-beside-copy');
    expect((await selected()).sideways === 'x', 'Beside copy did not preserve x direction');

    await page.click('#btn-turn');
    let s = await selected();
    expect(s.lying === false && s.sideways === 'x', 'standing up did not preserve x direction');
    expect((await button()).disabled, 'sideways button was enabled while standing');
    await page.click('#btn-turn');
    s = await selected();
    expect(s.lying === true && s.sideways === 'x', 're-laying did not preserve x direction');
    await expectDirection('x');
    expect(originalId !== (await selected()).id, 'copy test did not select a copy');

    await page.click('#btn-clear');
    await page.click('#btn-mirror');
    await page.evaluate(() => window.addShape('cone'));
    await page.click('#btn-turn');
    const pairBefore = await state();
    const pairIds = pairBefore.shapes.map((shape) => shape.id);
    await page.click('#btn-turn-sideways');
    const pairX = await state();
    expect(pairX.shapes.filter((shape) => pairIds.includes(shape.id)).every((shape) => shape.lying && shape.sideways === 'x'), 'paired Cones did not turn together to x');
    const pairRotations = await page.evaluate((ids) => ids.map((id) => window.__cad.rotationOf(id)), pairIds);
    expect(pairRotations.every((r) => Math.abs(r.z - Math.PI / 2) < EPS && Math.abs(r.x) < EPS), 'paired Cone render rotations did not point along x');
    await page.click('#btn-undo');
    const pairUndo = await state();
    expect(pairUndo.shapes.filter((shape) => pairIds.includes(shape.id)).every((shape) => shape.lying && shape.sideways === 'z'), 'one Undo did not restore both paired directions');

    const key = await page.evaluate(() => window.__cad.storageKey());
    await page.evaluate((storageKey) => {
      localStorage.setItem(storageKey, JSON.stringify({
        v: 1, shapes: [{ id: 44, kind: 'tube', size: 30, gx: 0, gz: 0, level: 0, twin: null, paint: null, lying: true }],
        selectedId: 44, nextId: 45, mirror: false,
      }));
    }, key);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    const oldLoaded = await selected();
    expect(oldLoaded.sideways === 'z', 'old stored record did not default to z');

    await page.click('#btn-clear');
    expect(await page.isVisible('#starter-shelf'), 'phone starter shelf was not reachable after clearing');
    const phone = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      shelf: document.querySelector('#starter-shelf').getBoundingClientRect().width,
      first: document.querySelector('#starter-shelf span').getBoundingClientRect().width,
    }));
    expect(phone.width <= 390 && phone.shelf > 0 && phone.first > 0, `phone shelf layout was not reachable: ${JSON.stringify(phone)}`);

    process.stdout.write('sideways piece direction survives pairs undo reload copies and STL\n');
  } catch (e) {
    console.error(e.stack || e);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
