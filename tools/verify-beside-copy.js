'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fieldsOf = (s) => ({
  kind: s.kind,
  size: s.size,
  gx: s.gx,
  gz: s.gz,
  level: s.level,
  paint: s.paint,
  lying: s.lying,
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function state(page) {
  return page.evaluate(() => ({
    shapes: window.__cad.shapes(),
    selected: window.__cad.selectedId(),
    undo: window.__cad.undoDepth(),
  }));
}

async function reset(page) {
  await page.evaluate(() => localStorage.removeItem(window.__cad.storageKey()));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__cad?.ready, { timeout: 10000 });
  await sleep(300);
  if (await page.isVisible('#tour')) await page.click('#tour-skip');
}

async function dragToCell(page, id, gx, gz) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await page.evaluate((shapeId) => window.__cad.shapes().find((s) => s.id === shapeId), id);
    if (current && current.gx === gx && current.gz === gz) return;
    const from = await page.evaluate((shapeId) => window.__cad.screenOf(shapeId), id);
    const to = await page.evaluate(({ shapeId, x, z }) => window.__cad.screenOfCell(x, z, shapeId), { shapeId: id, x: gx, z: gz });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 14 });
    await page.mouse.up();
    await sleep(180);
  }
  const actual = await page.evaluate((shapeId) => window.__cad.shapes().find((s) => s.id === shapeId), id);
  if (!actual || actual.gx !== gx || actual.gz !== gz) throw new Error(`drag missed target (${gx},${gz}): ${JSON.stringify(actual)}`);
}

async function click(page, selector, count = 1) {
  for (let i = 0; i < count; i++) {
    await page.click(selector, { force: true });
    await sleep(90);
  }
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      if (!sessionStorage.getItem('beside-copy-cleared')) {
        localStorage.clear();
        sessionStorage.setItem('beside-copy-cleared', '1');
      }
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()); });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__cad?.ready, { timeout: 10000 });
    if (await page.isVisible('#tour')) await page.click('#tour-skip');

    const button = page.locator('#btn-beside-copy');
    if (await button.count() !== 1) throw new Error('Beside copy button missing');
    if ((await page.textContent('#btn-beside-copy')).trim() !== 'Beside copy') throw new Error('Beside copy label wrong');

    // A painted, lying 30mm Tube at level 2 copies three grid cells right.
    await page.evaluate(() => window.addShape('tube'));
    await page.evaluate(() => window.paintSelected('violet'));
    await click(page, '#btn-up', 2);
    await click(page, '#btn-turn');
    const beforeSingle = await state(page);
    const single = beforeSingle.shapes[0];
    if (!single || single.kind !== 'tube' || single.size !== 30 || single.gx !== 0 || single.gz !== 0 || single.level !== 2 || single.paint !== 'violet' || single.lying !== true) throw new Error('single setup failed');
    if (await button.isDisabled()) throw new Error('Beside copy disabled for legal single');
    await page.click('#btn-beside-copy');
    await sleep(140);
    const afterSingle = await state(page);
    if (afterSingle.shapes.length !== 2) throw new Error('single beside copy did not add one record');
    const copySingle = afterSingle.shapes.find((s) => s.id !== single.id);
    if (!copySingle || copySingle.twin !== null || copySingle.gx !== 3 || copySingle.gz !== 0 || !same(fieldsOf(copySingle), { ...fieldsOf(single), gx: 3 })) throw new Error('single copy fields or position wrong');
    if (afterSingle.selected !== copySingle.id || afterSingle.undo !== beforeSingle.undo + 1) throw new Error('single selection or undo wrong');
    await page.click('#btn-undo');
    await sleep(120);
    const undoneSingle = await state(page);
    if (!same(undoneSingle.shapes, beforeSingle.shapes) || undoneSingle.selected !== beforeSingle.selected) throw new Error('single undo did not restore exact state');

    // A blocked right candidate falls back to left, without collision checks.
    await reset(page);
    await page.evaluate(() => window.addShape('cube'));
    let fallbackBefore = await state(page);
    await dragToCell(page, fallbackBefore.selected, 6, 0);
    fallbackBefore = await state(page);
    if (fallbackBefore.shapes[0].gx !== 6 || fallbackBefore.shapes[0].gz !== 0) throw new Error('fallback source was not placed at (6,0)');
    if (await button.isDisabled()) throw new Error('Beside copy disabled for fallback case');
    await page.click('#btn-beside-copy');
    await sleep(120);
    const fallbackAfter = await state(page);
    const fallbackCopy = fallbackAfter.shapes.find((s) => s.id !== fallbackBefore.shapes[0].id);
    if (!fallbackCopy || fallbackCopy.gx !== 3 || fallbackCopy.gz !== 0) throw new Error('fallback did not choose left');

    // The 20mm mirrored example at (-2,0) and (2,0) copies to (0,0) and (4,0).
    await reset(page);
    await page.click('#btn-mirror');
    await page.evaluate(() => window.addShape('cube'));
    let pairBefore = await state(page);
    const pairSelected = pairBefore.selected;
    await dragToCell(page, pairSelected, -2, 0);
    await click(page, '#btn-smaller');
    pairBefore = await state(page);
    const pairSources = pairBefore.shapes.slice();
    if (pairSources.length !== 2 || !pairSources.some((s) => s.gx === -2 && s.gz === 0) || !pairSources.some((s) => s.gx === 2 && s.gz === 0) || pairSources.some((s) => s.size !== 20)) throw new Error('pair setup failed');
    const sourceSelected = pairBefore.selected;
    const sourceById = pairSources.find((s) => s.id === sourceSelected);
    const sourceTwin = pairSources.find((s) => s.id === sourceById.twin);
    const undoBeforePair = pairBefore.undo;
    await page.click('#btn-beside-copy');
    await sleep(140);
    let pairAfter = await state(page);
    const freshPair = pairAfter.shapes.filter((s) => !pairSources.some((source) => source.id === s.id));
    if (freshPair.length !== 2 || freshPair[0].id <= Math.max(...pairSources.map((s) => s.id)) || freshPair[1].id !== freshPair[0].twin || freshPair[0].twin !== freshPair[1].id) throw new Error('fresh pair ids or links wrong');
    const copiedSelected = freshPair.find((s) => s.id === pairAfter.selected);
    if (!copiedSelected || copiedSelected.gx !== sourceById.gx + 2 || copiedSelected.gz !== sourceById.gz || copiedSelected.kind !== sourceById.kind || copiedSelected.size !== sourceById.size || copiedSelected.level !== sourceById.level || copiedSelected.paint !== sourceById.paint || copiedSelected.lying !== sourceById.lying) throw new Error('selected pair half wrong');
    const copiedTwin = freshPair.find((s) => s.id === copiedSelected.twin);
    if (!copiedTwin || copiedTwin.gx !== sourceTwin.gx + 2 || copiedTwin.gz !== sourceTwin.gz || copiedTwin.kind !== sourceTwin.kind || copiedTwin.size !== sourceTwin.size || copiedTwin.level !== sourceTwin.level || copiedTwin.paint !== sourceTwin.paint || copiedTwin.lying !== sourceTwin.lying) throw new Error('pair translation or fields wrong');
    const unchangedSources = pairAfter.shapes.filter((s) => pairSources.some((source) => source.id === s.id));
    if (!same(unchangedSources, pairSources) || pairAfter.undo !== undoBeforePair + 1) throw new Error('sources changed or pair undo wrong');
    const copiedState = pairAfter;
    await page.click('#btn-undo');
    await sleep(120);
    const pairUndone = await state(page);
    if (!same(pairUndone.shapes, pairBefore.shapes) || pairUndone.selected !== pairBefore.selected) throw new Error('pair undo did not restore exact state');
    await page.click('#btn-beside-copy');
    await sleep(120);
    pairAfter = await state(page);
    if (!same(pairAfter.shapes, copiedState.shapes) || pairAfter.selected !== copiedState.selected) throw new Error('pair copy could not be repeated');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__cad?.ready, { timeout: 10000 });
    const reloadedPair = await state(page);
    if (!same(reloadedPair.shapes, pairAfter.shapes) || reloadedPair.selected !== pairAfter.selected) throw new Error('pair persistence failed');
    const stl = await page.evaluate(() => {
      const bytes = window.__cad.stl();
      const view = new DataView(Uint8Array.from(bytes).buffer);
      return { length: bytes.length, triangles: view.getUint32(80, true), expected: window.__cad.expectedTriangles() };
    });
    if (stl.triangles !== stl.expected || stl.length !== 84 + stl.triangles * 50 || stl.triangles <= 0) throw new Error('generated STL validation failed');

    // At the centre an 80mm shape has no legal translated centre.
    await reset(page);
    await page.evaluate(() => window.addShape('cube'));
    await click(page, '#btn-bigger', 5);
    if (!(await page.locator('#btn-beside-copy').isDisabled())) throw new Error('80mm centre piece did not disable Beside copy');
    if (await page.evaluate(() => window.__cad.shapes()[0].size) !== 80) throw new Error('80mm setup failed');
    if (await page.evaluate(() => document.documentElement.scrollWidth > 390 || document.body.scrollWidth > 390)) throw new Error('390px horizontal overflow');
    if (pageErrors.length) throw new Error('page errors: ' + pageErrors.join(' | '));
    process.stdout.write('beside copy verified for directional fallback single pair undo and STL\n');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
