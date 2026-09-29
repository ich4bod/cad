'use strict';
let chromium;
try { chromium = require('playwright').chromium; } catch (e) { chromium = require('playwright-core').chromium; }
const BASE = process.argv[2] || 'https://cad.ichabod-crane.net/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => localStorage.clear());
    const page = await context.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__cad?.ready);
    if (await page.isVisible('#tour')) await page.click('#tour-skip');
    const state = () => page.evaluate(() => ({ shapes: window.__cad.shapes(), selected: window.__cad.selectedId(), undo: window.__cad.undoDepth() }));
    const click = async (sel, n = 1) => { for (let i = 0; i < n; i++) { await page.click(sel, { force: true }); await sleep(80); } };
    const dragTo = async (id, gx, gz) => {
      const from = await page.evaluate((id) => window.__cad.screenOf(id), id);
      const to = await page.evaluate(({ gx, gz, id }) => window.__cad.screenOfCell(gx, gz, id), { gx, gz, id });
      await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }); await page.mouse.up(); await sleep(120);
    };
    const add = async () => { await page.evaluate(() => window.addShape('cube')); await sleep(100); return (await state()).selected; };

    const first = await add(); await click('#btn-bigger'); await click('#btn-stack-copy'); await click('#btn-up', 3);
    let s = await state(); const upper = s.shapes.find(x => x.id === s.selected);
    if (upper.level !== 7) throw new Error('stack setup failed');
    await page.click('#btn-drop'); await sleep(100); s = await state();
    if (s.shapes.find(x => x.id === upper.id).level !== 4) throw new Error('support Drop did not land at level 4');
    await page.click('#btn-undo'); await sleep(100);
    if ((await state()).shapes.find(x => x.id === upper.id).level !== 7) throw new Error('Undo did not restore level 7');
    await dragTo(upper.id, 4, 4); await page.click('#btn-drop'); await sleep(100);
    if ((await state()).shapes.find(x => x.id === upper.id).level !== 0) throw new Error('empty Drop did not land on plate');

    await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__cad?.ready); if (await page.isVisible('#tour')) await page.click('#tour-skip');
    const base = await add(); await click('#btn-up', 0);
    const middle = await add(); await click('#btn-up', 3);
    const top = await add(); await click('#btn-up', 9);
    for (const id of [base, middle, top]) { await page.evaluate((id) => window.selectShapeById(id), id); await sleep(30); if (await page.isEnabled('#btn-center')) await page.click('#btn-center'); await sleep(60); }
    await page.evaluate((id) => window.selectShapeById(id), top); await sleep(80); await page.click('#btn-drop'); await sleep(100);
    s = await state(); if (s.shapes.find(x => x.id === top).level !== 6) throw new Error('highest support was not selected');
    await page.evaluate((id) => window.selectShapeById(id), middle); await sleep(50); await click('#btn-up', 4);
    await page.evaluate((id) => window.selectShapeById(id), top); await sleep(50); await page.click('#btn-drop'); await sleep(100);
    if ((await state()).shapes.find(x => x.id === top).level !== 3) throw new Error('higher support incorrectly considered');
    const before = await state();
    await page.evaluate((id) => window.selectShapeById(id), top); await page.waitForSelector('#btn-drop:disabled');
    const guarded = await page.evaluate(() => document.querySelector('#btn-drop').disabled);
    if (!guarded) throw new Error('Drop was not disabled at landing level');
    const topBefore = before.shapes.find(x => x.id === top);
    if (topBefore.size !== 30 || topBefore.gx !== 0 || topBefore.gz !== 0 || topBefore.paint !== null) throw new Error('shape fields changed');
    await page.click('#btn-mirror'); await add(); await page.waitForSelector('#btn-drop:disabled');
    if (!(await page.evaluate(() => document.querySelector('#btn-drop').disabled))) throw new Error('Drop was enabled for mirrored pair');
    process.stdout.write('support-aware Drop verified for stacked plate and guarded pair states\n');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
