/*
 * The Mirror toggle, checked against the live Shape Maker in a real Chromium.
 *
 * The interesting claim is not "a second shape appears" — it is that the twin
 * is ordinary state, so every existing edit path carries it without knowing it
 * exists. So this drives the real buttons and real pointer drags and asserts
 * the twin tracks the shape through move, resize, lift, delete and undo, that
 * the pair exports as a printable STL, and that with the toggle off nothing
 * behaves differently from the way it shipped.
 *
 *   docker run --rm --ipc=host \
 *     -v /srv/ichabod/apps/cad/tools:/tools:ro \
 *     -v /srv/ichabod/apps/cad/proof:/proof \
 *     -v /srv/ichabod/apps/cad/.verify/node_modules:/w/node_modules:ro \
 *     -e NODE_PATH=/w/node_modules \
 *     mcr.microsoft.com/playwright:v1.55.0-noble \
 *     node /tools/verify-mirror.js https://cad.ichabod-crane.net/
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

const consoleErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const mirrorOn = (page) => page.evaluate(() => window.__cad.mirror());
const pressed = (page) => page.getAttribute('#btn-mirror', 'aria-pressed');

const addShape = async (page, kind) => {
  await page.click(`#palette .shape[data-kind="${kind}"]`);
  await sleep(140);
};
const clickShape = async (page, id) => {
  const p = await page.evaluate((i) => window.__cad.screenOf(i), id);
  await page.mouse.click(p.x, p.y);
  await sleep(140);
  return p;
};
const toggleMirror = async (page) => {
  await page.click('#btn-mirror');
  await sleep(140);
};

/** The shape with this id, from a freshly read model. */
const byId = (s, id) => s.find((x) => x.id === id);

/** Everything about a pair that has to stay equal, as one comparable string. */
const shared = (x) => `${x.kind}/${x.size}/${x.level}`;

async function downloadSTL(page, name) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#btn-download'),
  ]);
  const path = `${OUT}/${name}`;
  await dl.saveAs(path);
  return fs.readFileSync(path);
}

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

  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  console.log('Shape Maker — Mirror toggle, live at ' + BASE);
  console.log('');
  console.log('THE TOGGLE — one button, and it starts off');

  const resp = await page.goto(BASE + '/', { waitUntil: 'load', timeout: 45000 });
  check('GET / is 200 over https', resp.status() === 200, String(resp.status()));
  await page.waitForFunction(() => window.__cad && window.__cad.ready, { timeout: 20000 });

  check('Mirror starts off', (await mirrorOn(page)) === false, 'mirror() === false');
  check('the button says so', (await pressed(page)) === 'false', 'aria-pressed="false"');
  check('Mirror is a real button, enabled with an empty scene',
    !(await page.isDisabled('#btn-mirror')), 'enabled');
  check('the toggle adds exactly one control',
    (await page.evaluate(() => document.querySelectorAll('#symmetry button').length)) === 1,
    '1 button in #symmetry');

  await toggleMirror(page);
  check('tapping it turns Mirror on', (await mirrorOn(page)) === true, 'mirror() === true');
  check('and the button shows it', (await pressed(page)) === 'true', 'aria-pressed="true"');

  // ---- a shape placed with Mirror on arrives as a pair --------------------
  console.log('');
  console.log('PLACING — one tap, two shapes, across the centre line');

  await addShape(page, 'cube');
  let s = await shapes(page);
  check('one tap placed two shapes', s.length === 2, s.length + ' shapes');

  const aId = s[0].id;
  const bId = s[1].id;
  let a = s[0];
  let b = s[1];

  check('the two shapes know about each other',
    a.twin === bId && b.twin === aId, `${aId}<->${bId}`);
  check('the twin sits at the mirrored grid cell',
    b.gx === -a.gx && b.gz === a.gz, `(${a.gx},${a.gz}) | (${b.gx},${b.gz})`);
  check('the pair is placed off the centre line',
    a.gx !== 0 && b.gx !== 0, `gx ${a.gx} and ${b.gx}`);
  check('the pair does not overlap itself',
    Math.abs(a.gx - b.gx) * 10 >= a.size, `${Math.abs(a.gx - b.gx) * 10}mm apart, ${a.size}mm wide`);
  check('the twin matches in kind, size and height',
    shared(a) === shared(b), shared(a) + ' | ' + shared(b));
  check('both are grid-snapped',
    [a, b].every((x) => Number.isInteger(x.gx) && Number.isInteger(x.gz)), 'integers');

  await page.screenshot({ path: OUT + '/07-mirror-pair.png' });

  // ---- drag one, the other tracks it -------------------------------------
  console.log('');
  console.log('DRAGGING — move one, the other mirrors the move');

  const at = await page.evaluate((i) => window.__cad.screenOf(i), aId);
  await dragMouse(page, at, { x: at.x + 130, y: at.y + 70 });
  s = await shapes(page);
  const aMoved = byId(s, aId);
  const bMoved = byId(s, bId);
  check('the dragged shape moved',
    aMoved.gx !== a.gx || aMoved.gz !== a.gz,
    `(${a.gx},${a.gz}) -> (${aMoved.gx},${aMoved.gz})`);
  check('the twin tracked it across the centre line',
    bMoved.gx === -aMoved.gx && bMoved.gz === aMoved.gz,
    `(${aMoved.gx},${aMoved.gz}) | (${bMoved.gx},${bMoved.gz})`);
  check('a drag still adds no shapes', s.length === 2, s.length + ' shapes');

  // ---- resize and lift both ------------------------------------------------
  console.log('');
  console.log('RESIZING AND LIFTING — the twin matches');

  await clickShape(page, aId);
  check('clicking one of a pair selects it',
    (await page.evaluate(() => window.__cad.selectedId())) === aId, 'id ' + aId);

  const size0 = aMoved.size;
  await page.click('#btn-bigger');
  await page.click('#btn-bigger');
  await sleep(140);
  s = await shapes(page);
  check('Bigger grows both',
    byId(s, aId).size === size0 + 20 && byId(s, bId).size === size0 + 20,
    byId(s, aId).size + 'mm and ' + byId(s, bId).size + 'mm');

  await page.click('#btn-smaller');
  await sleep(140);
  s = await shapes(page);
  check('Smaller shrinks both',
    byId(s, aId).size === size0 + 10 && byId(s, bId).size === size0 + 10,
    byId(s, aId).size + 'mm and ' + byId(s, bId).size + 'mm');

  await page.click('#btn-up');
  await page.click('#btn-up');
  await sleep(140);
  s = await shapes(page);
  check('Up lifts both to the same height',
    byId(s, aId).level === 2 && byId(s, bId).level === 2,
    'levels ' + byId(s, aId).level + ' and ' + byId(s, bId).level);

  await page.click('#btn-down');
  await sleep(140);
  s = await shapes(page);
  check('Down lowers both',
    byId(s, aId).level === 1 && byId(s, bId).level === 1,
    'levels ' + byId(s, aId).level + ' and ' + byId(s, bId).level);

  // ---- the centre line is skipped, not landed on --------------------------
  console.log('');
  console.log('THE CENTRE LINE — a pair slides past it instead of onto it');

  const cur = byId(s, aId);
  const from = await page.evaluate((i) => window.__cad.screenOf(i), aId);
  const middle = await page.evaluate(
    ({ gz, i }) => window.__cad.screenOfCell(0, gz, i), { gz: cur.gz, i: aId });
  await dragMouse(page, from, middle);
  s = await shapes(page);
  const aMid = byId(s, aId);
  const bMid = byId(s, bId);
  check('the dragged shape did not stop on the centre line', aMid.gx !== 0, 'gx ' + aMid.gx);
  check('so the pair never becomes one shape inside another',
    !(aMid.gx === bMid.gx && aMid.gz === bMid.gz && aMid.level === bMid.level),
    `(${aMid.gx},${aMid.gz}) | (${bMid.gx},${bMid.gz})`);
  check('and the pair is still a mirrored pair',
    bMid.gx === -aMid.gx && bMid.gz === aMid.gz, 'mirrored');

  await page.screenshot({ path: OUT + '/08-mirror-centre-line.png' });

  // ---- export the symmetric model ----------------------------------------
  console.log('');
  console.log('EXPORT — a mirrored model is still a printable STL');

  // Build something worth exporting: a second pair, stacked, so the STL under
  // test is the symmetric case *and* the touching-shapes case at once.
  await addShape(page, 'ball');
  s = await shapes(page);
  check('a second tap makes a second pair', s.length === 4, s.length + ' shapes');
  const pairs = s.filter((x) => x.twin != null).length;
  check('every shape on the plate is paired', pairs === 4, pairs + ' of ' + s.length);

  const expected = await page.evaluate(() => window.__cad.expectedTriangles());
  check('the export counts the twins too', expected > 0, expected + ' triangles expected');
  const bytes = await downloadSTL(page, 'mirror-pairs.stl');
  check('the download is a non-trivial file', bytes.length > 10000, bytes.length + ' bytes');
  const r = assertSTL(bytes, expected, 'mirrored');
  check('STL/mirrored: the model sits on the build plate',
    r.stats.bbox.min[1] > -0.02, 'min y = ' + r.stats.bbox.min[1]);
  check('STL/mirrored: the mesh is symmetric about x = 0',
    Math.abs(r.stats.bbox.min[0] + r.stats.bbox.max[0]) < 0.15,
    `x spans ${r.stats.bbox.min[0].toFixed(3)} to ${r.stats.bbox.max[0].toFixed(3)}`);

  await page.screenshot({ path: OUT + '/09-mirror-export.png' });

  // ---- delete takes both, undo brings both back ---------------------------
  console.log('');
  console.log('DELETE AND UNDO — the pair is one thing to remove and one to restore');

  const beforeDelete = await shapes(page);
  await clickShape(page, aId);
  await page.click('#btn-delete');
  await sleep(160);
  s = await shapes(page);
  check('deleting one of a pair removes both', s.length === beforeDelete.length - 2,
    s.length + ' shapes left');
  check('the twin did not survive the delete',
    !s.some((x) => x.id === aId || x.id === bId), 'both ' + aId + ' and ' + bId + ' gone');
  check('the other pair was left alone',
    s.length === 2 && s[0].twin === s[1].id, 'second pair intact');

  await page.click('#btn-undo');
  await sleep(160);
  s = await shapes(page);
  const aBack = byId(s, aId);
  const bBack = byId(s, bId);
  check('Undo brings both back', s.length === beforeDelete.length && !!aBack && !!bBack,
    s.length + ' shapes');
  check('they come back exactly as they were',
    JSON.stringify(s.map((x) => x).sort((p, q) => p.id - q.id)) ===
    JSON.stringify(beforeDelete.map((x) => x).sort((p, q) => p.id - q.id)),
    'state identical');
  check('and they come back still paired',
    aBack.twin === bId && bBack.twin === aId, `${aId}<->${bId}`);

  await page.screenshot({ path: OUT + '/10-mirror-undo.png' });

  // ---- toggling off: no twins, and nothing else changes -------------------
  console.log('');
  console.log('MIRROR OFF — single shapes again, and the old behaviour intact');

  const beforeOff = (await shapes(page)).length;
  await toggleMirror(page);
  check('the button turned off', (await pressed(page)) === 'false' && !(await mirrorOn(page)),
    'aria-pressed="false"');
  s = await shapes(page);
  check('turning Mirror off deletes nothing', s.length === beforeOff, s.length + ' shapes');
  check('but it cuts every pair loose', s.every((x) => x.twin === null),
    s.filter((x) => x.twin !== null).length + ' still paired');

  await addShape(page, 'cone');
  s = await shapes(page);
  check('with Mirror off one tap places one shape', s.length === beforeOff + 1,
    beforeOff + ' -> ' + s.length);
  check('the new shape has no twin', s[s.length - 1].twin === null, 'twin === null');

  // Undo is a full snapshot, so it has to restore the toggle as well as the
  // shapes — otherwise the next tap does something the button is not showing.
  // Walk back rather than counting clicks: how many edits the steps above
  // pushed is exactly the sort of thing that should not be hard-coded here.
  let steps = 0;
  while (steps < 10 && !(await mirrorOn(page))) {
    if (await page.isDisabled('#btn-undo')) break;
    await page.click('#btn-undo');
    await sleep(120);
    steps++;
  }
  check('undoing past the toggle turns Mirror back on', (await mirrorOn(page)) === true,
    steps + ' undos');
  check('and the button agrees with the model', (await pressed(page)) === 'true',
    'aria-pressed="true"');
  s = await shapes(page);
  check('the pairs are paired again', s.length > 0 && s.every((x) => x.twin !== null),
    s.length + ' shapes, all paired');

  // ---- no regression: with Mirror off, on a clean plate, nothing changed --
  //
  // On a plate that already has four shapes on it the corner cell a new shape
  // lands in can sit behind one of them, and a drag aimed at its centre grabs
  // whatever is in front. That is a fact about the camera, not about Mirror,
  // so this runs on a fresh page where the shape under test is the only thing
  // there — which is also the honest way to check "unchanged from today".
  //
  // Getting that empty plate used to be one reload. Since autosave landed a
  // reload deliberately brings the document back — that is the point of it,
  // and verify-autosave.js is what proves it — so a clean plate now has to be
  // asked for, by clearing the store first. What this section is actually
  // about is unchanged: one shape, on its own, behaving the way it shipped.
  console.log('');
  console.log('NO REGRESSION — default behaviour on a clean plate');

  await page.evaluate(() => window.localStorage.removeItem(window.__cad.storageKey()));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.__cad && window.__cad.ready);
  check('clearing the save gives a clean plate and the toggle off',
    (await shapes(page)).length === 0 && (await mirrorOn(page)) === false,
    'empty, mirror off');

  await addShape(page, 'cube');
  s = await shapes(page);
  check('one tap, one block, at the middle of the plate',
    s.length === 1 && s[0].gx === 0 && s[0].gz === 0,
    s.length + ' shape at (' + s[0].gx + ',' + s[0].gz + ')');
  const solo = s[0];
  check('and it has no twin', solo.twin === null, 'twin === null');

  const soloAt = await page.evaluate((i) => window.__cad.screenOf(i), solo.id);
  const soloTo = await page.evaluate(
    (i) => window.__cad.screenOfCell(3, 1, i), solo.id);
  await dragMouse(page, soloAt, soloTo);
  s = await shapes(page);
  check('it drags to the cell it was dragged to',
    s.length === 1 && s[0].gx === 3 && s[0].gz === 1,
    `(${s[0].gx},${s[0].gz})`);

  await page.click('#btn-bigger');
  await page.click('#btn-up');
  await sleep(140);
  s = await shapes(page);
  check('Bigger and Up still act on one shape alone',
    s.length === 1 && s[0].size === 40 && s[0].level === 1,
    s[0].size + 'mm at level ' + s[0].level);

  await page.click('#btn-delete');
  await sleep(160);
  check('Delete removes the one shape', (await shapes(page)).length === 0, 'empty');
  await page.click('#btn-undo');
  await sleep(160);
  s = await shapes(page);
  check('Undo brings it back unchanged',
    s.length === 1 && s[0].size === 40 && s[0].level === 1 && s[0].gx === 3 && s[0].gz === 1,
    JSON.stringify(s[0]));

  // ---- the five constraints still hold ------------------------------------
  console.log('');
  console.log('DESIGN CONSTRAINTS — still no typing, one screen, no dialogs');

  const inputs = await page.evaluate(() =>
    document.querySelectorAll('input, textarea, select, [contenteditable="true"]').length);
  check('the toggle introduced no text input', inputs === 0, inputs + ' input elements');

  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map((b) => ({
      label: b.querySelector('span') ? b.querySelector('span').textContent.trim() : '',
      w: Math.round(b.getBoundingClientRect().width),
      h: Math.round(b.getBoundingClientRect().height),
    })));
  check('Mirror carries a word, like every other button',
    buttons.some((b) => b.label === 'Mirror'), buttons.map((b) => b.label).join(','));
  check('every button is still finger-sized (>=56px)',
    buttons.every((b) => b.w >= 56 && b.h >= 56),
    'smallest ' + Math.min(...buttons.map((b) => Math.min(b.w, b.h))) + 'px');
  check('the toy is still one screen — nothing scrolls',
    await page.evaluate(() =>
      document.documentElement.scrollHeight <= window.innerHeight + 1), 'no scroll');

  // The bottom bar has to survive a phone, because it grew a button.
  await page.setViewportSize({ width: 390, height: 780 });
  await sleep(300);
  check('nothing scrolls on a phone-sized screen either',
    await page.evaluate(() =>
      document.documentElement.scrollHeight <= window.innerHeight + 1), '390x780');
  check('Mirror is still reachable on a phone', await page.isVisible('#btn-mirror'), 'visible');
  await page.screenshot({ path: OUT + '/11-mirror-phone.png' });

  check('no console errors anywhere in the run', consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : 'none');

  await browser.close();

  console.log('');
  console.log('---------------------------------------------');
  console.log(passed + ' checks passed, ' + failures.length + ' failed');
  fs.writeFileSync(OUT + '/verify-mirror-output.txt',
    `verify-mirror ${BASE} ${new Date().toISOString()}\n` +
    `${passed} passed, ${failures.length} failed\n` +
    failures.map((f) => '  FAILED: ' + f).join('\n') + '\n');
  if (failures.length) {
    console.log('');
    for (const f of failures) console.log('  FAILED: ' + f);
    process.exit(1);
  }
  console.log('ALL CHECKS PASSED');
})().catch((e) => { console.error(e); process.exit(2); });
