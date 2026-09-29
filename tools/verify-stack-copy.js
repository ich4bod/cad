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
    await page.waitForFunction(() => window.__cad?.ready, { timeout: 10000 });
    if (await page.isVisible('#tour')) await page.click('#tour-skip');
    const state = () => page.evaluate(() => ({ shapes: window.__cad.shapes(), selected: window.__cad.selectedId(), undo: window.__cad.undoDepth() }));
    const click = async (sel, n = 1) => { for (let i = 0; i < n; i++) { await page.click(sel, { force: true }); await sleep(80); } };
    await page.evaluate(() => window.addShape('cube')); await sleep(100);
    await page.evaluate(() => window.paintSelected('violet')); await sleep(100);
    await click('#btn-bigger');
    await click('#btn-up', 2);
    const before = await state();
    const base = before.shapes[0];
    if (base.size !== 40 || base.level !== 2 || base.paint !== 'violet') throw new Error('single setup failed');
    await page.click('#btn-stack-copy'); await sleep(150);
    let after = await state();
    if (after.shapes.length !== 2) throw new Error('single stack did not add one');
    const copy = after.shapes[1];
    if (copy.id === base.id || copy.twin !== null || copy.kind !== base.kind || copy.size !== base.size || copy.gx !== base.gx || copy.gz !== base.gz || copy.paint !== base.paint || copy.level !== 6 || after.selected !== copy.id || after.undo !== before.undo + 1) throw new Error('single stack fields or undo wrong');
    await page.click('#btn-undo'); await sleep(120);
    after = await state();
    if (JSON.stringify(after.shapes) !== JSON.stringify(before.shapes) || after.selected !== before.selected) throw new Error('single undo did not restore');
    await page.click('#btn-mirror'); await sleep(100); await page.evaluate(() => window.addShape('ball')); await sleep(100); await click('#btn-up');
    const pairBefore = await state();
    if (pairBefore.shapes.length !== 4) throw new Error('pair setup failed');
    const pair = pairBefore.shapes.slice(-2);
    await page.click('#btn-stack-copy'); await sleep(150);
    const pairAfter = await state();
    const fresh = pairAfter.shapes.filter(s => s.id > Math.max(...pair.map(x => x.id)));
    if (fresh.length !== 2 || fresh.some(s => s.level !== 4) || fresh[0].twin !== fresh[1].id || fresh[1].twin !== fresh[0].id) throw new Error('pair stack records wrong');
    for (const p of pair) { const n = fresh.find(x => x.gx === p.gx && x.gz === p.gz); if (!n) throw new Error('pair stack position wrong'); }
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__cad?.ready);
    if ((await state()).shapes.length !== 6) throw new Error('stack persistence failed');
    const stl = await page.evaluate(() => window.__cad.stl());
    if (!stl.length || !stl[0].startsWith('solid')) throw new Error('STL validation failed');
    await page.evaluate(() => localStorage.clear()); await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__cad?.ready);
    await page.evaluate(() => window.addShape('cube')); await sleep(100); await click('#btn-bigger', 5); await click('#btn-up', 7);
    if (!(await page.isDisabled('#btn-stack-copy'))) throw new Error('stack cap was not disabled');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > 390 || document.body.scrollWidth > 390);
    if (overflow) throw new Error('390px horizontal overflow');
    process.stdout.write('stack copy verified for single and mirrored editable layers\n');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
