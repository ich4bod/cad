/*
 * Autosave, checked against the live Shape Maker in a real Chromium.
 *
 * The claim is narrow and testable: what is on the plate survives the tab
 * being closed. So this builds a document with every field that matters in a
 * non-default state -- four kinds, a resized shape, a lifted shape, a dragged
 * shape, Mirror on with a real pair -- then reloads and asserts the model
 * comes back identical, field by field, id by id.
 *
 * It also checks the two ways this could make things worse rather than better:
 * a browser that has never seen the site still gets the empty plate, and a
 * corrupt saved document is ignored rather than breaking the page.
 *
 *   docker run --rm --ipc=host \
 *     -v /srv/ichabod/apps/cad/tools:/tools:ro \
 *     -v /srv/ichabod/apps/cad/proof:/proof \
 *     -v /srv/ichabod/apps/cad/.verify/node_modules:/w/node_modules:ro \
 *     -e NODE_PATH=/w/node_modules \
 *     mcr.microsoft.com/playwright:v1.55.0-noble \
 *     node /tools/verify-autosave.js https://cad.ichabod-crane.net/
 */
'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
const OUT = process.env.OUT_DIR || '/proof';

let passed = 0;
const failures = [];

function check(name, cond, detail) {
  const line = name + (detail ? '  [' + detail + ']' : '');
  if (cond) { passed++; console.log('  PASS  ' + line); }
  else { failures.push(line); console.log('  FAIL  ' + line); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shapes = (page) => page.evaluate(() => window.__cad.shapes());
const mirrorOn = (page) => page.evaluate(() => window.__cad.mirror());
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
  await page.click(`#palette .shape[data-kind="${kind}"]`);
  await sleep(140);
};
const clickShape = async (page, id) => {
  const p = await page.evaluate((i) => window.__cad.screenOf(i), id);
  await page.mouse.click(p.x, p.y);
  await sleep(140);
};

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
  await sleep(150);
}

/** The whole document as one comparable string, so "identical" is one
 *  assertion and a difference prints as a diff rather than a boolean. */
const fingerprint = (list) =>
  list
    .map((s) => `${s.id}:${s.kind}:${s.size}:${s.gx},${s.gz}:L${s.level}:t${s.twin}`)
    .join(' | ');

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];

  /* ---------------------------------------------------- 1. build a document */

  // One context, one tab. Closing the tab and opening a new one in the SAME
  // context is exactly the case the card is about: the browser is still the
  // browser, the tab is gone.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  ctx.on('console', (m) => { if (m.type() === 'error') errors.push('[build] ' + m.text()); });
  ctx.on('pageerror', (e) => errors.push('[build] pageerror ' + e.message));

  let page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await ready(page);
  await dismissTour(page);

  check('starts empty in a fresh profile', (await shapes(page)).length === 0);
  check('nothing saved before the first edit', (await stored(page)) === null);

  for (const kind of ['cube', 'ball', 'tube', 'cone']) await addShape(page, kind);
  let list = await shapes(page);
  check('four shapes placed', list.length === 4, `${list.length}`);

  // Resize one and lift another, so size and level are both off their defaults.
  await clickShape(page, list[0].id);
  await page.click('#btn-bigger');
  await sleep(120);
  await page.click('#btn-bigger');
  await sleep(120);

  await clickShape(page, list[1].id);
  await page.click('#btn-up');
  await sleep(120);
  await page.click('#btn-up');
  await sleep(120);
  await page.click('#btn-up');
  await sleep(120);

  // Drag a third with a real pointer, so a position that was never produced by
  // a button gets saved too -- drags do not go through the same code path.
  const dragId = list[2].id;
  await clickShape(page, dragId);
  const from = await page.evaluate((i) => window.__cad.screenOf(i), dragId);
  const to = await page.evaluate(
    (i) => window.__cad.screenOfCell(-4, 3, i), dragId
  );
  await dragMouse(page, from, to);

  // Mirror on, then a pair -- twin ids are the field most likely to come back
  // wrong, because they are cross-references inside the saved array.
  await page.click('#btn-mirror');
  await sleep(140);
  await addShape(page, 'cube');
  await sleep(140);

  const before = await shapes(page);
  const beforeMirror = await mirrorOn(page);
  const beforeSelected = await selectedId(page);
  const beforePrint = fingerprint(before);

  check('mirror is on before reload', beforeMirror === true);
  check('a mirrored pair exists', before.filter((s) => s.twin !== null).length === 2,
    `${before.filter((s) => s.twin !== null).length} twinned`);
  check('six shapes before reload', before.length === 6, `${before.length}`);

  const savedDoc = await stored(page);
  check('document written to localStorage', !!savedDoc && Array.isArray(savedDoc.shapes),
    savedDoc ? `${savedDoc.shapes.length} shapes, v${savedDoc.v}` : 'nothing stored');
  check('saved copy matches the live model',
    !!savedDoc && fingerprint(savedDoc.shapes) === beforePrint);

  await page.screenshot({ path: `${OUT}/12-autosave-before.png` });

  /* ------------------------------------------- 2. close the tab, open again */

  await page.close();
  page = await ctx.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await ready(page);

  const after = await shapes(page);
  const afterPrint = fingerprint(after);

  check('every shape came back', after.length === before.length,
    `${before.length} -> ${after.length}`);
  check('document is identical after reopening the tab', afterPrint === beforePrint,
    afterPrint === beforePrint ? '' : `\n      before: ${beforePrint}\n      after:  ${afterPrint}`);
  check('mirror state came back on', (await mirrorOn(page)) === true);
  check('the pressed Mirror button agrees',
    (await page.getAttribute('#btn-mirror', 'aria-pressed')) === 'true');
  check('the chosen shape came back chosen', (await selectedId(page)) === beforeSelected,
    `${beforeSelected} -> ${await selectedId(page)}`);
  check('Save is enabled on a restored document',
    (await page.isDisabled('#btn-download')) === false);
  check('Undo is empty on a restored document',
    (await page.isDisabled('#btn-undo')) === true);

  await page.screenshot({ path: `${OUT}/13-autosave-after-reload.png` });

  /* ------------------------------ 3. a restored document is still editable */

  // The restore is worth nothing if what comes back is inert. A new shape has
  // to get an id that does not collide with a restored one, and the pair has
  // to still move together.
  const maxIdBefore = after.reduce((n, s) => Math.max(n, s.id), 0);
  await addShape(page, 'ball');
  const grown = await shapes(page);
  const fresh = grown.filter((s) => !after.some((a) => a.id === s.id));
  check('a new shape gets fresh ids after a restore',
    fresh.length === 2 && fresh.every((s) => s.id > maxIdBefore),
    fresh.map((s) => s.id).join(','));

  const pair = after.find((s) => s.twin !== null);
  await clickShape(page, pair.id);
  await page.click('#btn-bigger');
  await sleep(150);
  const resized = await shapes(page);
  const a = resized.find((s) => s.id === pair.id);
  const b = resized.find((s) => s.id === pair.twin);
  check('a restored pair still moves as a pair', !!a && !!b && a.size === b.size,
    a && b ? `${a.size} / ${b.size}` : 'twin missing');

  // And the edits made after a restore are themselves saved.
  const reSaved = await stored(page);
  check('edits after a restore are saved too',
    !!reSaved && fingerprint(reSaved.shapes) === fingerprint(resized));

  await page.screenshot({ path: `${OUT}/14-autosave-still-editable.png` });
  await page.close();
  await ctx.close();

  /* ------------------------------------- 4. a browser that has never been here */

  const clean = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const cleanErrors = [];
  clean.on('console', (m) => { if (m.type() === 'error') cleanErrors.push(m.text()); });
  clean.on('pageerror', (e) => cleanErrors.push('pageerror ' + e.message));

  const cleanPage = await clean.newPage();
  await cleanPage.goto(BASE + '/', { waitUntil: 'networkidle' });
  await ready(cleanPage);
  await dismissTour(cleanPage);

  check('a fresh profile still loads empty', (await shapes(cleanPage)).length === 0);
  check('a fresh profile has Save and Undo off',
    (await cleanPage.isDisabled('#btn-download')) === true &&
    (await cleanPage.isDisabled('#btn-undo')) === true);
  check('a fresh profile shows the starting hint',
    (await cleanPage.textContent('#hint')).includes('Tap a shape below to start'),
    await cleanPage.textContent('#hint'));
  check('no console errors on a fresh profile', cleanErrors.length === 0,
    cleanErrors.join(' ; '));

  await cleanPage.screenshot({ path: `${OUT}/15-autosave-fresh-profile.png` });
  await cleanPage.close();
  await clean.close();

  /* --------------------------------------------- 5. a saved document gone bad */

  // Nobody should be able to brick a kid's toy by poking at localStorage, and
  // a schema change here later must degrade to an empty plate, not a blank page.
  for (const [label, value] of [
    ['not JSON at all', 'not json {{{'],
    ['an object of the wrong shape', '{"v":1,"shapes":"nope"}'],
    ['a future version', '{"v":99,"shapes":[]}'],
    ['shapes of unknown kinds', '{"v":1,"shapes":[{"id":1,"kind":"dodecahedron","size":30,"gx":0,"gz":0,"level":0,"twin":null}],"nextId":2,"mirror":false}'],
    ['nonsense numbers', '{"v":1,"shapes":[{"id":1,"kind":"cube","size":99999,"gx":-400,"gz":"x","level":-9,"twin":7}],"nextId":0,"mirror":"yes"}'],
  ]) {
    const bad = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const badErrors = [];
    bad.on('console', (m) => { if (m.type() === 'error') badErrors.push(m.text()); });
    bad.on('pageerror', (e) => badErrors.push('pageerror ' + e.message));

    const bp = await bad.newPage();
    // Seed the store before app.js runs, on the right origin.
    await bp.goto(BASE + '/favicon.svg');
    await bp.evaluate(
      ([k, v]) => window.localStorage.setItem(k, v),
      ['shape-maker/doc/v1', value]
    );
    await bp.goto(BASE + '/', { waitUntil: 'networkidle' });
    await ready(bp);
    await dismissTour(bp);

    const got = await shapes(bp);
    const ok = got.every(
      (s) => ['cube', 'ball', 'tube', 'cone'].includes(s.kind) &&
             s.size >= 10 && s.size <= 80 &&
             Math.abs(s.gx) <= 6 && Math.abs(s.gz) <= 6 &&
             s.level >= 0 && s.level <= 14 &&
             (s.twin === null || got.some((x) => x.id === s.twin))
    );
    check(`survives ${label}`, ok && badErrors.length === 0,
      `${got.length} shapes${badErrors.length ? '; errors: ' + badErrors.join(' ; ') : ''}`);

    // And it is still usable, not just non-crashing.
    await bp.click('#palette .shape[data-kind="cube"]');
    await sleep(160);
    check(`still usable after ${label}`, (await shapes(bp)).length === got.length + 1);

    await bp.close();
    await bad.close();
  }

  await browser.close();

  console.log('');
  if (errors.length) console.log('  console errors during build: ' + errors.join(' ; '));
  console.log(`  ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log('');
    for (const f of failures) console.log('  FAILED: ' + f);
    process.exit(1);
  }
  console.log('  AUTOSAVE OK');
}

main().catch((e) => { console.error(e); process.exit(1); });
