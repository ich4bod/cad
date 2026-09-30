'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
const fail = (message) => { throw new Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fields = ['id', 'kind', 'size', 'level', 'paint', 'lying', 'sideways', 'twin'];

async function ready(page) {
  await page.waitForFunction(() => window.__cad?.ready, { timeout: 30000 });
  if (await page.isVisible('#tour')) await page.click('#tour-skip', { force: true });
}

async function state(page) {
  return page.evaluate(() => ({
    shapes: window.__cad.shapes(),
    selected: window.__cad.selectedId(),
    mirror: window.__cad.mirror(),
    undo: window.__cad.undoDepth(),
  }));
}

function compareMetadata(before, after, label) {
  const expected = Object.fromEntries(fields.map((field) => [field, before[field]]));
  const actual = Object.fromEntries(fields.map((field) => [field, after[field]]));
  if (!same(expected, actual)) fail(`${label} changed metadata: before=${JSON.stringify(expected)} after=${JSON.stringify(actual)}`);
}

async function freshCastle(page) {
  await page.evaluate(() => localStorage.removeItem(window.__cad.storageKey()));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.click('#starter-castle');
  await sleep(80);
  const current = await state(page);
  if (current.shapes.length !== 7) fail(`castle setup made ${current.shapes.length} records instead of seven`);
  return current;
}

async function testMoveAndUndo(page) {
  const before = await freshCastle(page);
  const moved = await page.evaluate(() => window.__cad.moveBuild(1, 0));
  if (moved !== true) fail('legal whole-build move returned false');
  const afterMove = await state(page);
  if (afterMove.undo !== before.undo + 1) fail(`legal move made ${afterMove.undo - before.undo} Undo snapshots instead of one`);
  if (afterMove.selected !== before.selected || afterMove.mirror !== before.mirror) fail('legal move changed selection or Mirror');
  if (afterMove.shapes.length !== before.shapes.length) fail('legal move changed record count');
  for (const beforeShape of before.shapes) {
    const afterShape = afterMove.shapes.find((shape) => shape.id === beforeShape.id);
    if (!afterShape) fail(`legal move lost record ${beforeShape.id}`);
    if (afterShape.gx !== beforeShape.gx + 1 || afterShape.gz !== beforeShape.gz) {
      fail(`record ${beforeShape.id} did not move exactly (+1,0): ${JSON.stringify(afterShape)}`);
    }
    compareMetadata(beforeShape, afterShape, `record ${beforeShape.id}`);
  }
  const hint = await page.locator('#hint').textContent();
  if (hint !== 'Moved the whole build.') fail(`move hint was ${JSON.stringify(hint)}`);

  await page.click('#btn-undo');
  const undone = await state(page);
  if (!same(undone.shapes, before.shapes) || undone.selected !== before.selected || undone.mirror !== before.mirror) {
    fail('one Undo did not restore the whole build, metadata, and selection');
  }
  if (undone.undo !== before.undo) fail('one Undo did not remove exactly the whole-build snapshot');

  const movedForward = await page.evaluate(() => window.__cad.moveBuild(0, -1));
  if (movedForward !== true) fail('legal forward move returned false');
  const saved = await state(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await ready(page);
  const reloaded = await state(page);
  if (!same(reloaded.shapes, saved.shapes) || reloaded.selected !== saved.selected || reloaded.mirror !== saved.mirror) {
    fail('autosave/reload did not preserve the moved whole build');
  }
}

async function testBlockedDirections(page) {
  const directions = [
    { name: 'left', dx: -1, dz: 0, button: '#btn-build-left' },
    { name: 'forward', dx: 0, dz: -1, button: '#btn-build-forward' },
    { name: 'back', dx: 0, dz: 1, button: '#btn-build-back' },
    { name: 'right', dx: 1, dz: 0, button: '#btn-build-right' },
  ];

  for (const direction of directions) {
    const before = await freshCastle(page);
    let legalMoves = 0;
    let result = true;
    let lastLegal = before;
    while (result && legalMoves < 12) {
      result = await page.evaluate(({ dx, dz }) => window.__cad.moveBuild(dx, dz), direction);
      if (result) {
        legalMoves += 1;
        lastLegal = await state(page);
      }
    }
    if (result !== false || legalMoves === 0) fail(`${direction.name} did not reach a blocked edge`);
    const blocked = await state(page);
    if (!same(blocked, lastLegal)) fail(`${direction.name} illegal move mutated state`);
    if (blocked.undo !== before.undo + legalMoves) fail(`${direction.name} made the wrong number of snapshots before block`);
    if (!(await page.locator(direction.button).isDisabled())) fail(`${direction.name} button was not disabled at its edge`);

    const stable = JSON.stringify(blocked);
    const blockedAgain = await page.evaluate(({ dx, dz }) => window.__cad.moveBuild(dx, dz), direction);
    const afterBlocked = await state(page);
    if (blockedAgain !== false || JSON.stringify(afterBlocked) !== stable) {
      fail(`${direction.name} illegal press mutated state or added an Undo snapshot`);
    }
  }
}

async function testShelf(page, viewport) {
  const layout = await page.evaluate(() => {
    const shelf = document.querySelector('#edit');
    const group = document.querySelector('#move-build');
    const buttons = [...group.querySelectorAll('button')].map((button) => {
      const rect = button.getBoundingClientRect();
      return { id: button.id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    const shelfRect = shelf.getBoundingClientRect();
    return {
      shelf: { left: shelfRect.left, right: shelfRect.right, top: shelfRect.top, bottom: shelfRect.bottom },
      buttons,
      scrollWidth: shelf.scrollWidth,
      clientWidth: shelf.clientWidth,
      pageWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewportWidth: window.innerWidth,
    };
  });
  if (viewport.width <= 700) {
    if (layout.scrollWidth <= layout.clientWidth) fail(`phone edit shelf did not overflow at ${viewport.width}px`);
    if (layout.pageWidth > layout.viewportWidth) fail(`phone page overflowed horizontally at ${viewport.width}px`);
    const end = await page.evaluate(() => {
      const shelf = document.querySelector('#edit');
      shelf.scrollLeft = shelf.scrollWidth;
      const shelfRect = shelf.getBoundingClientRect();
      const buttons = [...document.querySelectorAll('#move-build button')].map((button) => {
        const rect = button.getBoundingClientRect();
        return { id: button.id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
      return { shelf: { left: shelfRect.left, right: shelfRect.right, top: shelfRect.top, bottom: shelfRect.bottom }, buttons };
    });
    for (const button of end.buttons) {
      if (button.left < end.shelf.left - 1 || button.right > end.shelf.right + 1 || button.top < end.shelf.top - 1 || button.bottom > end.shelf.bottom + 1) {
        fail(`phone Move build button was not reachable after scrolling: ${JSON.stringify(button)}`);
      }
    }
  } else {
    for (const button of layout.buttons) {
      if (button.left < layout.shelf.left - 1 || button.right > layout.shelf.right + 1 || button.top < layout.shelf.top - 1 || button.bottom > layout.shelf.bottom + 1 || button.left < 0 || button.right > layout.viewportWidth) {
        fail(`desktop Move build button was clipped: ${JSON.stringify(button)}`);
      }
    }
  }
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.on('console', (message) => process.stderr.write(`[browser ${message.type()}] ${message.text()}\n`));
      page.on('pageerror', (error) => process.stderr.write(`[pageerror] ${error.message}\n`));
      try {
        const response = await page.goto(BASE, { waitUntil: 'networkidle' });
        if (response.status() !== 200) fail(`GET / returned ${response.status()} at ${viewport.width}x${viewport.height}`);
        await ready(page);
        if (!(await page.locator('#btn-build-left').isDisabled()) || !(await page.locator('#btn-build-forward').isDisabled()) || !(await page.locator('#btn-build-back').isDisabled()) || !(await page.locator('#btn-build-right').isDisabled())) {
          fail(`empty plate did not disable every Move build direction at ${viewport.width}px`);
        }
        await testShelf(page, viewport);
        if (viewport.width > 700) await testMoveAndUndo(page);
        await testBlockedDirections(page);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  process.stdout.write('whole Shape Maker builds move one grid cell atomically with undo\n');
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
