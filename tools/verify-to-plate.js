'use strict';

const { chromium } = require('playwright-core');

const RAW_URL = process.argv[2] || 'https://cad.ichabod-crane.net/';
const BASE = RAW_URL.endsWith('/') ? RAW_URL.slice(0, -1) : RAW_URL;

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  try {
    await page.goto(BASE + '/', { waitUntil: 'load' });

    // 1. dismiss tour
    if (await page.isVisible('#tour')) {
      await page.click('#tour-skip');
    }

    // 2. add Block
    await page.click('.shape[data-kind="cube"]');

    // 3. capture state
    const initialState = await page.evaluate(() => {
      const s = window.__cad.shapes().find(x => x.kind === 'cube');
      if (!s) return null;
      return { gx: s.gx, gz: s.gz, size: s.size, paint: s.paint };
    });
    if (!initialState) throw new Error('Could not find cube shape');

    // 4. raise it three levels
    for (let i = 0; i < 3; i++) {
      await page.click('#btn-up');
    }

    // 5. click To plate
    await page.click('#btn-plate');

    // 6. assert level zero and unchanged grid/size/paint
    const afterPlateState = await page.evaluate((expected) => {
      const s = window.__cad.shapes().find(x => x.kind === 'cube');
      if (!s) return null;
      return {
        level: s.level,
        gx: s.gx,
        gz: s.gz,
        size: s.size,
        paint: s.paint
      };
    }, initialState);

    if (!afterPlateState) throw new Error('Could not find cube shape after toPlate');
    if (afterPlateState.level !== 0) throw new Error(`Expected level 0, got ${afterPlateState.level}`);
    if (afterPlateState.gx !== initialState.gx) throw new Error(`gx changed: ${initialState.gx} -> ${afterPlateState.gx}`);
    if (afterPlateState.gz !== initialState.gz) throw new Error(`gz changed: ${initialState.gz} -> ${afterPlateState.gz}`);
    if (afterPlateState.size !== initialState.size) throw new Error(`size changed: ${initialState.size} -> ${afterPlateState.size}`);
    if (afterPlateState.paint !== initialState.paint) throw new Error(`paint changed: ${initialState.paint} -> ${afterPlateState.paint}`);

    // 7. Undo and assert level three
    await page.click('#btn-undo');
    const afterUndo = await page.evaluate(() => {
      const s = window.__cad.shapes().find(x => x.kind === 'cube');
      return s ? s.level : null;
    });
    if (afterUndo !== 3) throw new Error(`Expected level 3 after undo, got ${afterUndo}`);

    // 8. add Ball
    await page.click('.shape[data-kind="ball"]');

    // 9. turn Mirror on
    await page.click('#btn-mirror');

    // 10. raise it twice
    for (let i = 0; i < 2; i++) {
      await page.click('#btn-up');
    }

    // 11. capture mirrored state
    const mirroredInitialState = await page.evaluate(() => {
      const s = window.__cad.shapes().filter(x => x.kind === 'ball' && x.twin !== null);
      if (s.length !== 2) return null;
      return s.map(x => ({ gx: x.gx, gz: x.gz, size: x.size, paint: x.paint }));
    });
    if (!mirroredInitialState || mirroredInitialState.length !== 2) throw new Error('Could not find mirrored ball pair');

    // 12. click To plate
    await page.click('#btn-plate');

    // 13. assert both zero and unchanged
    const afterMirrorPlateState = await page.evaluate((expected) => {
      const s = window.__cad.shapes().filter(x => x.kind === 'ball' && x.twin !== null);
      if (s.length !== 2) return null;
      return s.map(x => ({
        level: x.level,
        gx: x.gx,
        gz: x.gz,
        size: x.size,
        paint: x.paint
      }));
    }, mirroredInitialState);

    if (!afterMirrorPlateState || afterMirrorPlateState.length !== 2) throw new Error('Could not find mirrored ball pair after toPlate');
    for (let i = 0; i < 2; i++) {
      if (afterMirrorPlateState[i].level !== 0) throw new Error(`Ball ${i+1} level not 0: ${afterMirrorPlateState[i].level}`);
      if (afterMirrorPlateState[i].gx !== mirroredInitialState[i].gx) throw new Error(`Ball ${i+1} gx changed`);
      if (afterMirrorPlateState[i].gz !== mirroredInitialState[i].gz) throw new Error(`Ball ${i+1} gz changed`);
      if (afterMirrorPlateState[i].size !== mirroredInitialState[i].size) throw new Error(`Ball ${i+1} size changed`);
      if (afterMirrorPlateState[i].paint !== mirroredInitialState[i].paint) throw new Error(`Ball ${i+1} paint changed`);
    }

    // 14. Undo and assert both two
    await page.click('#btn-undo');
    const afterUndoMirror = await page.evaluate(() => {
      const s = window.__cad.shapes().filter(x => x.kind === 'ball' && x.twin !== null);
      if (s.length !== 2) return null;
      return s.map(x => x.level);
    });
    if (!afterUndoMirror || afterUndoMirror[0] !== 2 || afterUndoMirror[1] !== 2) {
      throw new Error(`Mirrored pair level not 2 after undo: ${afterUndoMirror}`);
    }

    console.log('to plate verified for single and mirrored shapes with undo');

  } catch (e) {
    console.error(e.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
