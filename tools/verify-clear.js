'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');

let passed = 0;
const failures = [];

function check(name, cond, detail) {
  const line = name + (detail ? '  [' + detail + ']' : '');
  if (cond) { 
    passed++; 
    process.stderr.write('  PASS  ' + line + '\n'); 
  }
  else { 
    failures.push(line); 
    process.stderr.write('  FAIL  ' + line + '\n'); 
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shapes = (page) => page.evaluate(() => window.__cad.shapes());
const mirrorOn = (page) => page.evaluate(() => window.__cad.mirror());
const selectedId = (page) => page.evaluate(() => window.__cad.selectedId());
const stored = (page) => page.evaluate(() => window.__cad.stored());
const hint = (page) => page.evaluate(() => document.getElementById('hint').textContent);
const nextId = (page) => page.evaluate(() => window.__cad.stored().nextId);

async function ready(page) {
  await page.waitForFunction(() => window.__cad && window.__cad.ready, null, { timeout: 30000 });
  await sleep(250);
}

async function dismissTour(page) {
  if (await page.isVisible('#tour')) await page.click('#tour-skip', { force: true });
}

const addShape = async (page, kind) => {
  await page.click(`#palette .shape[data-kind="${kind}"]`);
  await sleep(140);
};

const clickShape = async (page, id) => {
  const p = await page.evaluate((i) => window.__cad.screenOf(i), id);
  await page.mouse.click(p.x, p.y);
  await sleep(140);
};

const resizeShape = async (page, id, delta) => {
  await clickShape(page, id);
  if (delta > 0) await page.click('#btn-bigger');
  else await page.click('#btn-smaller');
  await sleep(150);
};

const liftShape = async (page, id, delta) => {
  await clickShape(page, id);
  if (delta > 0) await page.click('#btn-up');
  else await page.click('#btn-down');
  await sleep(150);
};

const fingerprint = (list) =>
  list
    .map((s) => `${s.id}:${s.kind}:${s.size}:${s.gx},${s.gz}:L${s.level}:t${s.twin}`)
    .join(' | ');

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const errors = [];

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    
    let page = await ctx.newPage();
    page.on('request', request => process.stderr.write(`[request] ${request.url()}\n`));
    page.on('console', (m) => {
      process.stderr.write(`[browser ${m.type()}] ${m.text()}\n`);
    });
    page.on('pageerror', (e) => {
      process.stderr.write(`[pageerror] ${e.message}\n${e.stack}\n`);
      errors.push(`[pageerror] ${e.message}`);
    });
    page.on('requestfailed', request => {
      const msg = `[browser requestfailed] ${request.url()} ${request.failure().errorText}`;
      process.stderr.write(msg + '\n');
      if (!request.url().includes('rum?') && !request.url().includes('cloudflareinsights.com')) {
        errors.push(msg);
      }
    });

    await page.goto(BASE + '/?v=' + Date.now(), { waitUntil: 'networkidle' });

    await ready(page);

    await dismissTour(page);

    // Mirror on
    await page.click('#btn-mirror');
    await sleep(140);
    check('mirror on', (await mirrorOn(page)) === true);

    // Build a pair
    await addShape(page, 'cube');
    await sleep(140);
    let list = await shapes(page);
    const pair = list.filter(s => s.twin !== null);
    check('pair exists', pair.length === 2);
    const pairIds = pair.map(p => p.id);

    // Add two more
    await addShape(page, 'ball');
    await sleep(140);
    list = await shapes(page);
    const other1 = list.find(s => !pairIds.includes(s.id));

    await addShape(page, 'tube');
    await sleep(140);
    list = await shapes(page);
    const other2 = list.find(s => !pairIds.includes(s.id) && s.id !== other1.id);

    // Non-default size/height
    await resizeShape(page, other1.id, 10);
    await liftShape(page, other2.id, 1);
    await sleep(200);

    // Select a shape
    await clickShape(page, other1.id);
    await sleep(140);

    // Record exact exposed state
    const recordedShapes = await shapes(page);
    const recordedFingerprint = fingerprint(recordedShapes);
    const recordedSelectedId = await selectedId(page);
    const recordedMirror = await mirrorOn(page);
    const recordedNextId = await nextId(page);
    const recordedStorage = await stored(page);
    const recordedStorageFingerprint = fingerprint(recordedStorage.shapes);

    // Click Clear
    const clearBtn = page.locator('#btn-clear');
    try {
      await clearBtn.waitFor({ state: 'attached', timeout: 5000 });
    } catch (e) {
      console.error('--- DOM AT FAILURE ---');
      console.error(await page.content());
      console.error('--- END DOM ---');
      throw e;
    }
    await clearBtn.click();
    await sleep(200);

    // Assert zero shapes, Mirror on, empty storage, Clear/Save/Copy disabled and Undo enabled
    check('zero shapes', (await shapes(page)).length === 0);
    check('mirror on', (await mirrorOn(page)) === true);
    check('empty storage', (await stored(page)).shapes.length === 0);
    check('Clear disabled', (await page.isDisabled('#btn-clear')) === true);
    check('Save disabled', (await page.isDisabled('#btn-download')) === true);
    check('Copy disabled', (await page.isDisabled('#btn-copy')) === true);
    check('Undo enabled', (await page.isDisabled('#btn-undo')) === false);

    // Click Undo
    await page.click('#btn-undo');
    await sleep(200);

    // Deep-compare every recorded shape/selection/twin field
    const afterUndoShapes = await shapes(page);
    check('undone shapes count', afterUndoShapes.length === recordedShapes.length);
    check('undone shapes fingerprint', fingerprint(afterUndoShapes) === recordedFingerprint);
    check('undone selected_id', (await selectedId(page)) === recordedSelectedId);
    check('undone mirror', (await mirrorOn(page)) === recordedMirror);

    // Click Clear again
    await page.click('#btn-clear');
    await sleep(200);

    // Reload
    await page.reload();
    // Set viewport for phone layout test
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    await dismissTour(page);

    // Assert zero shapes, Mirror on, the exact restored-empty hint, preserved next id in storage, and no horizontal overflow
    check('zero shapes after reload', (await shapes(page)).length === 0);
    check('mirror on after reload', (await mirrorOn(page)) === true);
    check('restored-empty hint', (await hint(page)) === 'Clean plate. Tap a shape to start.');
    
    const reloadStored = await stored(page);
    check('preserved next id in storage', reloadStored.nextId === recordedNextId);
    
    // Check for horizontal overflow
    const overflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    check('no horizontal overflow at 390x844', !overflow);

    // Add a Block and assert it becomes a fresh mirrored pair with ids at or above the preserved next id
    await addShape(page, 'cube');
    await sleep(200);
    const finalShapes = await shapes(page);
    const finalPair = finalShapes.filter(s => s.twin !== null);
    check('new block is a pair', finalPair.length === 2);
    const minId = Math.min(finalPair[0].id, finalPair[1].id);
    check('ids are >= preserved next id', minId >= recordedNextId);

    if (failures.length || errors.length) {
      for (const f of failures) console.error('  FAILED: ' + f);
      for (const e of errors) console.error('  ' + e);
      process.exitCode = 1;
      return;
    }
    console.log('clear verified for one-step undo, empty autosave, reload, mirror, and phone layout');
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
