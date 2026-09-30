'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
const fail = (message) => { throw new Error(message); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const same = (a, b, epsilon = 1e-6) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= epsilon;
const direction = (camera, target) => {
  const d = { x: camera.x - target.x, y: camera.y - target.y, z: camera.z - target.z };
  const length = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / length, y: d.y / length, z: d.z / length };
};

async function runViewport(browser, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => localStorage.clear());
  const page = await context.newPage();
  page.on('console', (message) => process.stderr.write(`[browser ${message.type()}] ${message.text()}\n`));
  page.on('pageerror', (error) => process.stderr.write(`[pageerror] ${error.message}\n`));
  try {
    const response = await page.goto(BASE, { waitUntil: 'networkidle' });
    if (response.status() !== 200) fail(`GET / returned ${response.status()} at ${viewport.width}x${viewport.height}`);
    await page.waitForFunction(() => window.__cad?.ready);
    if (await page.isVisible('#tour')) await page.click('#tour-skip', { force: true });

    const state = () => page.evaluate(() => ({
      shapes: window.__cad.shapes(),
      selected: window.__cad.selectedId(),
      undo: window.__cad.undoDepth(),
    }));
    const cameraState = () => page.evaluate(() => ({
      camera: window.__cad.cameraPos(),
      target: window.__cad.cameraTarget(),
    }));
    const emptyBefore = await cameraState();
    if (!(await page.locator('#btn-fit').isDisabled())) fail(`Fit build was enabled on empty plate at ${viewport.width}x${viewport.height}`);
    await page.evaluate(() => window.__cad.fitView());
    const emptyAfter = await cameraState();
    if (!same(emptyBefore.camera, emptyAfter.camera) || !same(emptyBefore.target, emptyAfter.target)) {
      fail(`empty Fit build changed the camera at ${viewport.width}x${viewport.height}`);
    }

    await page.click('#starter-car');
    await sleep(200);
    const carBeforeOrbit = await state();
    const beforeOrbit = await cameraState();
    await page.locator('#scene').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    await sleep(100);
    const beforeFit = await cameraState();
    const savedDirection = direction(beforeFit.camera, beforeFit.target);
    if (same(beforeFit.camera, beforeOrbit.camera) && same(beforeFit.target, beforeOrbit.target)) {
      fail(`camera did not orbit before Fit build at ${viewport.width}x${viewport.height}`);
    }

    await page.click('#btn-fit');
    await sleep(100);
    const afterFit = await cameraState();
    const afterFitDirection = direction(afterFit.camera, afterFit.target);
    if (!same(savedDirection, afterFitDirection)) {
      fail(`Fit build changed viewing direction at ${viewport.width}x${viewport.height}`);
    }
    const bounds = await page.evaluate(() => window.__cad.renderedBounds());
    const expectedCenter = {
      x: (bounds.world.min.x + bounds.world.max.x) / 2,
      y: (bounds.world.min.y + bounds.world.max.y) / 2,
      z: (bounds.world.min.z + bounds.world.max.z) / 2,
    };
    if (!same(afterFit.target, expectedCenter)) {
      fail(`Fit build target was not the rendered mesh sphere center at ${viewport.width}x${viewport.height}`);
    }
    const stage = await page.locator('#scene').boundingBox();
    for (const item of bounds.projected) {
      if (item.left < 8 || item.top < 8 || item.right > stage.width - 8 || item.bottom > stage.height - 8) {
        fail(`a fitted mesh was outside the 8px stage margin at ${viewport.width}x${viewport.height}: ${JSON.stringify(item)}`);
      }
    }
    const carAfterFit = await state();
    if (JSON.stringify(carAfterFit) !== JSON.stringify(carBeforeOrbit)) {
      fail(`Fit build changed the car, selection, or Undo state at ${viewport.width}x${viewport.height}`);
    }

    const addAtEdge = async (kind, gx, gz) => {
      await page.click(`#palette [data-kind="${kind}"]`);
      await sleep(50);
      const id = (await state()).selected;
      const from = await page.evaluate((shapeId) => window.__cad.screenOf(shapeId), id);
      const to = await page.evaluate(({ gx: x, gz: z, id: shapeId }) => window.__cad.screenOfCell(x, z, shapeId), { gx, gz, id });
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 8 });
      await page.mouse.up();
      for (let i = 0; i < 14; i++) await page.click('#btn-up');
      const placed = (await state()).shapes.find((shape) => shape.id === id);
      if (!placed || placed.gx !== gx || placed.gz !== gz || placed.level !== 14) {
        fail(`edge piece did not reach (${gx}, ${gz}, level 14) at ${viewport.width}x${viewport.height}`);
      }
    };
    await addAtEdge('cone', -6, -6);
    await addAtEdge('cube', 6, 6);

    await page.click('#btn-fit');
    await sleep(100);
    const edgeFit = await page.evaluate(() => ({
      camera: window.__cad.cameraPos(),
      target: window.__cad.cameraTarget(),
      bounds: window.__cad.renderedBounds(),
    }));
    const edgeDirection = direction(edgeFit.camera, edgeFit.target);
    if (!same(savedDirection, edgeDirection)) fail(`edge Fit build changed viewing direction at ${viewport.width}x${viewport.height}`);
    const edgeCenter = {
      x: (edgeFit.bounds.world.min.x + edgeFit.bounds.world.max.x) / 2,
      y: (edgeFit.bounds.world.min.y + edgeFit.bounds.world.max.y) / 2,
      z: (edgeFit.bounds.world.min.z + edgeFit.bounds.world.max.z) / 2,
    };
    if (!same(edgeFit.target, edgeCenter)) fail(`edge Fit build target missed the rendered sphere center at ${viewport.width}x${viewport.height}`);
    for (const item of edgeFit.bounds.projected) {
      if (item.left < 8 || item.top < 8 || item.right > stage.width - 8 || item.bottom > stage.height - 8) {
        fail(`an edge mesh was outside the 8px stage margin at ${viewport.width}x${viewport.height}: ${JSON.stringify(item)}`);
      }
    }

    await page.click('#btn-home');
    const home = await cameraState();
    if (!same(home.camera, beforeOrbit.camera) || !same(home.target, beforeOrbit.target)) {
      fail(`Home view did not return to its initial camera at ${viewport.width}x${viewport.height}`);
    }
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    await runViewport(browser, { width: 1200, height: 900 });
    await runViewport(browser, { width: 390, height: 844 });
  } finally {
    await browser.close();
  }
  process.stdout.write('camera fit keeps every Shape Maker piece in view without editing the build\n');
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
