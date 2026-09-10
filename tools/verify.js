/*
 * Drives the live Shape Maker in a real Chromium and checks the card's
 * acceptance criteria against what the browser actually does — real clicks,
 * real pointer drags, a real download — then parses the downloaded STL bytes
 * back and asserts they are printable.
 *
 *   docker run --rm --ipc=host \
 *     -v /srv/ichabod/apps/cad/tools:/tools:ro \
 *     -v /srv/ichabod/apps/cad/proof:/proof \
 *     -v /srv/ichabod/apps/cad/.verify/node_modules:/w/node_modules:ro \
 *     -e NODE_PATH=/w/node_modules \
 *     mcr.microsoft.com/playwright:v1.55.0-noble \
 *     node /tools/verify.js https://cad.ichabod-crane.net/
 */
'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const fs = require('fs');
const { checkSTL, report } = require('/tools/stl-check.js');

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
const OUT = process.env.OUT_DIR || '/proof';
const HOST = new URL(BASE).host;

let passed = 0;
const failures = [];

function check(name, cond, detail) {
  const line = name + (detail ? '  [' + detail + ']' : '');
  if (cond) { passed++; console.log('  PASS  ' + line); }
  else { failures.push(line); console.log('  FAIL  ' + line); }
}

const offsite = [];
const consoleErrors = [];
const badResponses = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A real press-move-move-release, so OrbitControls and the drag handler see
 *  the same event stream a finger produces. */
async function dragMouse(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps
    );
    await sleep(12);
  }
  await page.mouse.up();
  await sleep(120);
}

const shapes = (page) => page.evaluate(() => window.__cad.shapes());
const addShape = async (page, kind) => {
  await page.click(`#palette .shape[data-kind="${kind}"]`);
  await sleep(120);
};
const clickShape = async (page, id) => {
  const p = await page.evaluate((i) => window.__cad.screenOf(i), id);
  await page.mouse.click(p.x, p.y);
  await sleep(120);
  return p;
};

/** Click Save, catch the download, return its bytes. */
async function downloadSTL(page, name) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#btn-download'),
  ]);
  check('download is named my-model.stl', dl.suggestedFilename() === 'my-model.stl',
    dl.suggestedFilename());
  const path = `${OUT}/${name}`;
  await dl.saveAs(path);
  return fs.readFileSync(path);
}

/** Every STL assertion, folded into this run's pass/fail tally. */
function assertSTL(bytes, expected, label) {
  console.log('');
  const result = checkSTL(bytes, expected);
  report(result, label);
  console.log('');
  for (const c of result.checks) check('STL/' + label + ': ' + c.name, c.ok, c.detail);
  return result;
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    acceptDownloads: true,
    deviceScaleFactor: 1,
  });

  ctx.on('request', (r) => {
    const h = new URL(r.url()).host;
    if (h && h !== HOST) offsite.push(r.url());
  });
  ctx.on('response', (r) => {
    if (r.status() >= 400) badResponses.push(r.status() + ' ' + r.url());
  });

  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  console.log('Shape Maker — live verification of ' + BASE);
  console.log('');
  console.log('CRITERION 2 + 3 — the app loads and the four primitives work');

  const resp = await page.goto(BASE + '/', { waitUntil: 'load', timeout: 45000 });
  check('GET / is 200 over https', resp.status() === 200, String(resp.status()));

  await page.waitForFunction(() => window.__cad && window.__cad.ready, { timeout: 20000 });
  check('three.js booted and the app is ready', true, 'window.__cad.ready');

  const canvasLive = await page.evaluate(() => {
    const c = document.getElementById('scene');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return { w: c.width, h: c.height, gl: !!gl };
  });
  check('WebGL canvas is sized and live',
    canvasLive.gl && canvasLive.w > 400 && canvasLive.h > 200,
    canvasLive.w + 'x' + canvasLive.h);

  check('starts empty — nothing to clear on arrival', (await shapes(page)).length === 0, '0 shapes');
  check('Save is disabled with an empty scene',
    await page.isDisabled('#btn-download'), 'disabled');
  check('Undo is disabled with nothing done',
    await page.isDisabled('#btn-undo'), 'disabled');

  // ---- place all four primitives -----------------------------------------
  for (const kind of ['cube', 'ball', 'tube', 'cone']) await addShape(page, kind);
  let s = await shapes(page);
  check('all four primitives placed', s.length === 4, s.length + ' shapes');
  check('one of each kind',
    JSON.stringify(s.map((x) => x.kind)) === JSON.stringify(['cube', 'ball', 'tube', 'cone']),
    s.map((x) => x.kind).join(','));
  check('every shape landed on a grid cell',
    s.every((x) => Number.isInteger(x.gx) && Number.isInteger(x.gz)),
    s.map((x) => `(${x.gx},${x.gz})`).join(' '));
  check('no two shapes share a cell',
    new Set(s.map((x) => x.gx + ',' + x.gz)).size === 4, 'distinct cells');

  await page.screenshot({ path: OUT + '/01-four-primitives.png' });

  // ---- move one -----------------------------------------------------------
  const target = s[0];
  const before = { gx: target.gx, gz: target.gz };
  const camBeforeDrag = await page.evaluate(() => window.__cad.cameraPos());
  const at = await page.evaluate((i) => window.__cad.screenOf(i), target.id);
  await dragMouse(page, at, { x: at.x + 150, y: at.y + 60 });
  s = await shapes(page);
  const moved = s.find((x) => x.id === target.id);
  check('dragging a shape moves it',
    moved.gx !== before.gx || moved.gz !== before.gz,
    `(${before.gx},${before.gz}) -> (${moved.gx},${moved.gz})`);
  check('the moved shape is still grid-snapped',
    Number.isInteger(moved.gx) && Number.isInteger(moved.gz),
    `(${moved.gx},${moved.gz})`);
  const camAfterDrag = await page.evaluate(() => window.__cad.cameraPos());
  check('dragging a shape does not also orbit the camera',
    Math.hypot(camAfterDrag.x - camBeforeDrag.x, camAfterDrag.y - camBeforeDrag.y,
      camAfterDrag.z - camBeforeDrag.z) < 1.0,
    'camera moved ' + Math.hypot(camAfterDrag.x - camBeforeDrag.x,
      camAfterDrag.y - camBeforeDrag.y, camAfterDrag.z - camBeforeDrag.z).toFixed(3) + 'mm');
  check('shape count unchanged by a move', s.length === 4, s.length);

  // ---- scale one ----------------------------------------------------------
  const ballId = s[1].id;
  await clickShape(page, ballId);
  check('clicking a shape selects it',
    await page.evaluate(() => window.__cad.selectedId()) === ballId, 'id ' + ballId);
  const size0 = s[1].size;
  await page.click('#btn-bigger');
  await page.click('#btn-bigger');
  await sleep(120);
  s = await shapes(page);
  check('Bigger scales the selected shape in grid steps',
    s.find((x) => x.id === ballId).size === size0 + 20,
    size0 + 'mm -> ' + s.find((x) => x.id === ballId).size + 'mm');
  await page.click('#btn-smaller');
  await sleep(120);
  s = await shapes(page);
  check('Smaller scales it back down',
    s.find((x) => x.id === ballId).size === size0 + 10,
    s.find((x) => x.id === ballId).size + 'mm');

  // ---- stack one, which is the case that makes welding matter -------------
  await page.click('#btn-up');
  await page.click('#btn-up');
  await sleep(120);
  s = await shapes(page);
  check('Up lifts the shape off the plate in grid steps',
    s.find((x) => x.id === ballId).level === 2,
    'level ' + s.find((x) => x.id === ballId).level);

  // ---- delete one, then undo it ------------------------------------------
  const doomed = s[3];
  await clickShape(page, doomed.id);
  await page.click('#btn-delete');
  await sleep(150);
  s = await shapes(page);
  check('Delete removes the selected shape', s.length === 3, s.length + ' shapes');
  check('the right shape was the one removed',
    !s.some((x) => x.id === doomed.id), 'id ' + doomed.id + ' gone');
  await page.screenshot({ path: OUT + '/02-one-deleted.png' });

  await page.click('#btn-undo');
  await sleep(150);
  s = await shapes(page);
  const restored = s.find((x) => x.id === doomed.id);
  check('Undo brings the deleted shape back', s.length === 4 && !!restored,
    s.length + ' shapes');
  check('it comes back exactly as it was',
    restored && restored.kind === doomed.kind && restored.size === doomed.size &&
    restored.gx === doomed.gx && restored.gz === doomed.gz && restored.level === doomed.level,
    JSON.stringify(restored));
  await page.screenshot({ path: OUT + '/03-undo-restored.png' });

  // ---- orbit by dragging empty space -------------------------------------
  const cam0 = await page.evaluate(() => window.__cad.cameraPos());
  const box = await page.locator('#stage').boundingBox();
  const sky = { x: box.x + 90, y: box.y + 70 };     // above the model, empty
  const preOrbit = JSON.stringify(await shapes(page));
  await dragMouse(page, sky, { x: sky.x + 260, y: sky.y + 40 });
  const cam1 = await page.evaluate(() => window.__cad.cameraPos());
  const swung = Math.hypot(cam1.x - cam0.x, cam1.y - cam0.y, cam1.z - cam0.z);
  check('dragging empty space orbits the camera', swung > 5, swung.toFixed(1) + 'mm of travel');
  check('orbiting changed no geometry', JSON.stringify(await shapes(page)) === preOrbit, 'model untouched');
  await page.screenshot({ path: OUT + '/04-orbited.png' });

  // ---- criterion 4: download and prove the STL ---------------------------
  console.log('');
  console.log('CRITERION 4 — the downloaded STL is printable');
  const expected = await page.evaluate(() => window.__cad.expectedTriangles());
  const bytes = await downloadSTL(page, 'scene-a.stl');
  check('the download is a non-trivial file', bytes.length > 10000, bytes.length + ' bytes');
  const rA = assertSTL(bytes, expected, 'four-primitives');
  check('STL/four-primitives: the model sits on the build plate',
    Math.abs(rA.stats.bbox.min[1]) < 0.02, 'min y = ' + rA.stats.bbox.min[1]);

  // A second scene, deliberately the hard one: three balls stacked into a
  // snowman, each touching the next. Exported naively that is a non-manifold
  // mesh, so this is the case the weld exists for.
  console.log('');
  console.log('CRITERION 4 (again) — a stacked snowman, the touching-shapes case');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__cad && window.__cad.ready);
  check('a refresh clears the scene', (await shapes(page)).length === 0, 'empty after reload');

  for (let i = 0; i < 3; i++) await addShape(page, 'ball');
  s = await shapes(page);
  const base = s[0];

  // Build the column the way a child would: lift each ball by three grid steps
  // (30mm, one ball's height) so it rests on the one below, then drag it over
  // the base cell. Everything goes through the same buttons and the same
  // pointer drags — nothing is poked into the model directly.
  for (const [idx, lifts] of [[1, 3], [2, 6]]) {
    const id = s[idx].id;
    await clickShape(page, id);
    for (let k = 0; k < lifts; k++) await page.click('#btn-up');
    await sleep(100);

    const from = await page.evaluate((i) => window.__cad.screenOf(i), id);
    const to = await page.evaluate(
      ({ gx, gz, i }) => window.__cad.screenOfCell(gx, gz, i),
      { gx: base.gx, gz: base.gz, i: id });
    await dragMouse(page, from, to);
  }

  s = await shapes(page);
  const column = s.filter((x) => x.gx === base.gx && x.gz === base.gz);
  check('snowman is three balls', s.length === 3 && s.every((x) => x.kind === 'ball'),
    s.map((x) => `${x.kind}@(${x.gx},${x.gz})L${x.level}`).join(' '));
  check('all three stacked into one column', column.length === 3,
    column.length + ' of 3 at cell (' + base.gx + ',' + base.gz + ')');
  check('each ball rests on the one below it',
    JSON.stringify(s.map((x) => x.level).sort((a, b) => a - b)) === JSON.stringify([0, 3, 6]),
    'levels ' + s.map((x) => x.level).join(','));
  await page.screenshot({ path: OUT + '/05-snowman.png' });

  const expectedB = await page.evaluate(() => window.__cad.expectedTriangles());
  const bytesB = await downloadSTL(page, 'snowman.stl');
  assertSTL(bytesB, expectedB, 'snowman');

  // ---- no typing anywhere in the build flow ------------------------------
  console.log('');
  console.log('DESIGN CONSTRAINTS — no typing, one screen, no dialogs');
  const inputs = await page.evaluate(() =>
    document.querySelectorAll('input, textarea, select, [contenteditable="true"]').length);
  check('no text input anywhere in the build flow', inputs === 0, inputs + ' input elements');
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map((b) => ({
      label: b.querySelector('span') ? b.querySelector('span').textContent.trim() : '',
      w: Math.round(b.getBoundingClientRect().width),
      h: Math.round(b.getBoundingClientRect().height),
    })));
  check('every button carries a word, not just a picture',
    buttons.every((b) => b.label.length > 0), buttons.map((b) => b.label).join(','));
  check('every button is finger-sized (>=56px)',
    buttons.every((b) => b.w >= 56 && b.h >= 56),
    'smallest ' + Math.min(...buttons.map((b) => Math.min(b.w, b.h))) + 'px');
  check('the whole toy is one screen — nothing scrolls',
    await page.evaluate(() =>
      document.documentElement.scrollHeight <= window.innerHeight + 1), 'no scroll');

  // ---- criterion 2 + 6 ----------------------------------------------------
  console.log('');
  console.log('CRITERION 2 + 6 — vendored, self-contained, linked home');
  check('no third-party runtime requests', offsite.length === 0,
    offsite.length ? offsite.slice(0, 4).join(' ') : 'all requests to ' + HOST);
  check('no 4xx/5xx responses', badResponses.length === 0,
    badResponses.length ? badResponses.slice(0, 4).join(' ') : 'none');
  check('no console errors', consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : 'none');
  const three = await page.evaluate(() => {
    const a = document.querySelector('script[type="importmap"]');
    return a ? a.textContent : '';
  });
  check('three.js resolves to a vendored path', three.includes('./vendor/three/'),
    three.replace(/\s+/g, ' ').trim().slice(0, 80));
  const back = await page.getAttribute('#backlink', 'href');
  check('back-link points at ichabod-crane.net', back === 'https://ichabod-crane.net/', back);
  const backVisible = await page.isVisible('#backlink');
  check('the back-link is visible', backVisible, 'visible');

  await browser.close();

  console.log('');
  console.log('---------------------------------------------');
  console.log(passed + ' checks passed, ' + failures.length + ' failed');
  if (failures.length) {
    console.log('');
    for (const f of failures) console.log('  FAILED: ' + f);
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
})().catch((e) => { console.error(e); process.exit(2); });
