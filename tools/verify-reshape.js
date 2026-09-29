'use strict';
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'https://cad.ichabod-crane.net/';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => localStorage.clear());
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad?.ready);
    if (await page.isVisible('#tour')) await page.click('#tour-skip');
    const state = () => page.evaluate(() => ({ shapes: window.__cad.shapes(), selected: window.__cad.selectedId(), undo: window.__cad.undoDepth() }));
    await page.evaluate(() => window.addShape('cube'));
    await page.waitForSelector('#paint:not([hidden])');
    await page.click('#paint [data-paint="violet"]', { force: true });
    await page.click('#btn-up'); await page.click('#btn-up');
    let before = await state();
    const id = before.selected;
    const old = before.shapes.find((s) => s.id === id);
    const fields = ((s) => ({ id: s.id, size: s.size, gx: s.gx, gz: s.gz, level: s.level, paint: s.paint, twin: s.twin }))(old);
    const stlBlock = await page.evaluate(() => window.__cad.stl());
    await page.click('#reshape [data-kind="ball"]', { force: true });
    let after = await state();
    const changed = after.shapes.find((s) => s.id === id);
    if (changed.kind !== 'ball') throw new Error('single reshape did not change kind');
    for (const key of Object.keys(fields)) if (changed[key] !== fields[key]) throw new Error(`field changed: ${key}`);
    if (JSON.stringify(stlBlock) === JSON.stringify(await page.evaluate(() => window.__cad.stl()))) throw new Error('STL did not change');
    const pressed = await page.$$eval('.reshape-kind', (els) => els.map((e) => [e.dataset.kind, e.getAttribute('aria-pressed')]));
    if (JSON.stringify(pressed) !== JSON.stringify([['cube','false'],['ball','true'],['tube','false'],['cone','false']])) throw new Error('pressed state incorrect');
    if (await page.textContent('#hint') !== 'Now it’s a Ball.') throw new Error('single reshape hint incorrect');
    await page.click('#btn-undo'); await sleep(80);
    const undone = (await state()).shapes.find((s) => s.id === id);
    if (undone.kind !== 'cube') throw new Error('undo did not restore Block');
    for (const key of Object.keys(fields)) if (undone[key] !== fields[key]) throw new Error(`undo field changed: ${key}`);

    await page.click('#btn-mirror');
    await page.evaluate(() => window.addShape('tube'));
    await page.waitForSelector('#reshape:not([hidden])');
    const pairBefore = (await state()).shapes.filter((s) => s.twin !== null);
    if (pairBefore.length !== 2) throw new Error('mirror pair missing');
    const pairFields = pairBefore.map((s) => ((x) => ({ id:x.id,size:x.size,gx:x.gx,gz:x.gz,level:x.level,paint:x.paint,twin:x.twin }))(s));
    await page.click('#reshape [data-kind="cone"]', { force: true });
    const pairAfter = (await state()).shapes.filter((s) => pairFields.some((x) => x.id === s.id));
    if (pairAfter.length !== 2 || pairAfter.some((s) => s.kind !== 'cone')) throw new Error('pair reshape failed');
    for (const oldFields of pairFields) { const s = pairAfter.find((x) => x.id === oldFields.id); for (const key of Object.keys(oldFields)) if (s[key] !== oldFields[key]) throw new Error(`pair field changed: ${key}`); }
    const depth = (await state()).undo;
    await page.click('#reshape [data-kind="cone"]', { force: true });
    if ((await state()).undo !== depth) throw new Error('current-kind press added undo');
    await page.reload({ waitUntil: 'networkidle' });
    if ((await state()).shapes.filter((s) => s.twin !== null).some((s) => s.kind !== 'cone')) throw new Error('cone pair did not persist');
    if (await page.evaluate(() => document.documentElement.scrollWidth) > 390) throw new Error('horizontal overflow');
    process.stdout.write('in-place shape changes verified for single mirrored undo paint and STL\n');
  } catch (e) { console.error(e.stack || e); process.exitCode = 1; }
  finally { await browser.close(); }
})();
