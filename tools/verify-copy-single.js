'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '') + '?v=' + Date.now();

let passed = 0;
const failures = [];

function check(name, cond, detail) {
  const line = name + (detail ? '  [' + detail + ']' : '');
  if (cond) { passed++; console.log('  PASS  ' + line); }
  else { failures.push(line); console.log('  FAIL  ' + line); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shapes = (page) => page.evaluate(() => window.__cad.shapes());
const selectedId = (page) => page.evaluate(() => window.__cad.selectedId());
const stored = (page) => page.evaluate(() => window.__cad.stored());

async function ready(page) {
  await page.waitForFunction(() => window.__cad && window.__cad.ready, null, { timeout: 30000 });
  await sleep(250);
}

async function dismissTour(page) {
  if (await page.isVisible('#tour')) await page.click('#tour-skip');
}

const addShape = async (page, kind) => {
  await page.evaluate((k) => window.addShape(k), kind);
  await sleep(250);
};

const clickShape = async (page, id) => {
  const p = await page.evaluate((i) => window.__cad.screenOf(i), id);
  if (!p) throw new Error('Could not find screen position for shape ' + id);
  await page.mouse.click(p.x, p.y);
  await sleep(140);
};

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  ctx.on('console', (m) => { if (m.type() === 'error') errors.push('[build] ' + m.text()); });
  ctx.on('pageerror', (e) => errors.push('[build] pageerror ' + e.message));

  let page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await ready(page);
  await dismissTour(page);

  /* ------------------------------------------- 1. set up: add a Block, make it Bigger and Up */

  await addShape(page, 'cube');
  await sleep(250);
  let list = await shapes(page);
  console.log('Shapes after addShape:', JSON.stringify(list));
  if (!list.length) throw new Error('No shapes found after addShape');
  const originalId = list[0].id;
  await clickShape(page, originalId);
  
  await page.click('#btn-bigger');
  await sleep(120);
  await page.click('#btn-bigger');
  await sleep(120);
  
  await page.click('#btn-up');
  await sleep(120);
  await page.click('#btn-up');
  await sleep(120);

  list = await shapes(page);
  const sh = list.find(s => s.id === originalId);
  check('block is bigger and up', sh.size > 30 && sh.level > 0, `size: ${sh.size}, level: ${sh.level}`);

  /* ------------------------------------------- 2. click Copy and assert properties */

  await page.click('#btn-copy');
  await sleep(250);

  list = await shapes(page);
  check('two shapes exist', list.length === 2, list.length);
  
  const newS = list.find(s => s.id !== originalId);
  if (newS) {
    check('new shape is unpaired', newS.twin === null, `twin: ${newS.twin}`);
    check('new shape matches original kind/size/level', 
      newS.kind === sh.kind && newS.size === sh.size && newS.level === sh.level,
      `kind: ${newS.kind}, size: ${newS.size}, level: ${newS.level}`);
      
    const oldS = list.find(s => s.id === originalId);
    const overlaps = (a, b) =>
      a[0] < b[1] + 1 && b[0] < a[1] + 1 && a[2] < b[3] + 1 && b[2] < a[3] + 1;
    
    const footprint = (s) => [
      s.gx * 10 - s.size / 2, s.gx * 10 + s.size / 2,
      s.gz * 10 - s.size / 2, s.gz * 10 + s.size / 2,
    ];

    const rectA = footprint(oldS);
    const rectB = footprint(newS);
    check('footprints do not overlap', !overlaps(rectA, rectB), `A: ${rectA.join(',')}, B: ${rectB.join(',')}`);
  } else {
    check('new shape exists', false, 'could not find second shape');
  }

  /* ------------------------------------------- 3. click Undo and assert original remains */

  await page.click('#btn-undo');
  await sleep(250);
  list = await shapes(page);
  check('only original remains after undo', list.length === 1 && list[0].id === originalId, list.length);

  /* ------------------------------------------- 4. reload and assert it persists */

  await page.reload({ waitUntil: 'networkidle' });
  await ready(page);
  list = await shapes(page);
  check('shape persists after reload', list.length === 1 && list[0].id === originalId, list.length);

  /* ------------------------------------------- 5. phone layout assertion */

  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(500);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const innerWidth = await page.evaluate(() => window.innerWidth);
  check('phone layout: no horizontal scroll', scrollWidth === innerWidth, `width: ${scrollWidth}, inner: ${innerWidth}`);

  await browser.close();

  if (errors.length) console.log('  console errors during build: ' + errors.join(' ; '));
  if (failures.length) {
    console.log('');
    for (const f of failures) console.log('  FAILED: ' + f);
    process.exit(1);
  }
  console.log('\nsingle-shape copy verified with undo, autosave, and phone layout');
}

main().catch((e) => { console.error(e); process.exit(1); });
