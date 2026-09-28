'use strict';

const { chromium } = require('playwright-core');

const RAW_URL = process.argv[2] || 'https://cad.ichabod-crane.net/';
const BASE = RAW_URL.endsWith('/') ? RAW_URL.slice(0, -1) : RAW_URL;

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  // Listen for console logs
  page.on('console', msg => console.error(`BROWSER LOG [${msg.type()}]: ${msg.text()}`));

  try {
    console.error(`Navigating to ${BASE}/...`);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('body');
    console.error('Page loaded.');

    // 1. dismiss tour
    if (await page.isVisible('#tour')) {
      console.error('Dismissing tour...');
      await page.click('#tour-skip');
    }

    // 2. add Block
    console.error('Looking for cube button...');
    const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.getAttribute('data-kind')));
    console.error('Available data-kinds on buttons:', buttons);
    
    await page.click('button[data-kind="cube"]');
    console.error('Block added.');

    // Wait for the shape to be added to the internal state and UI to update
    await page.waitForFunction(() => window.__cad.shapes().some(s => s.kind === 'cube'));
    console.error('Shape in state.');

    // 3. capture state
    const initialState = await page.evaluate(() => {
      const s = window.__cad.shapes().find(x => x.kind === 'cube');
      if (!s) return null;
      return { gx: s.gx, gz: s.gz, size: s.size, paint: s.paint };
    });
    if (!initialState) throw new Error('Could not find cube shape in window.__cad.shapes()');
    console.error('Initial state:', initialState);

    // 4. raise it three levels
    console.error('Raising level...');
    for (let i = 0; i < 3; i++) {
      await page.click('#btn-up');
    }
    await page.waitForFunction(() => window.__cad.shapes().find(x => x.kind === 'cube')?.level === 3);
    console.error('Level reached 3.');

    // 5. click To plate
    console.error('Clicking To plate...');
    await page.waitForSelector('#btn-plate:not([disabled])');
    await page.click('#btn-plate');

    // 6. assert level zero and unchanged grid/size/paint
    const afterPlateState = await page.evaluate(() => {
      const s = window.__cad.shapes().find(x => x.kind === 'cube');
      if (!s) return null;
      return {
        level: s.level,
        gx: s.gx,
        gz: s.gz,
        size: s.size,
        paint: s.paint
      };
    });

    if (!afterPlateState) throw new Error('Could not find cube shape after toPlate');
    if (afterPlateState.level !== 0) throw new Error(`Expected level 0, got ${afterPlateState.level}`);
    if (afterPlateState.gx !== initialState.gx) throw new Error(`gx changed: ${initialState.gx} -> ${afterPlateState.gx}`);
    if (afterPlateState.gz !== initialState.gz) throw new Error(`gz changed: ${initialState.gz} -> ${afterPlateState.gz}`);
    if (afterPlateState.size !== initialState.size) throw new Error(`size changed: ${initialState.size} -> ${afterPlateState.size}`);
    if (afterPlateState.paint !== initialState.paint) throw new Error(`paint changed: ${initialState.paint} -> ${afterPlateState.paint}`);
    console.error('Single shape toPlate verified.');

    // 7. Undo and assert level three
    await page.click('#btn-undo');
    await page.waitForFunction(() => window.__cad.shapes().find(x => x.kind === 'cube')?.level === 3);
    console.error('Undo verified.');

    // 8. turn Mirror on
    console.error('Turning Mirror on...');
    await page.click('#btn-mirror');

    // 9. add Ball
    console.error('Adding Ball...');
    await page.click('button[data-kind="ball"]');
    await page.waitForFunction(() => window.__cad.shapes().some(s => s.kind === 'ball'));

    // 10. raise it twice
    console.error('Raising mirrored level...');
    for (let i = 0; i < 2; i++) {
      await page.click('#btn-up');
    }
    await page.waitForFunction(() => window.__cad.shapes().filter(x => x.kind === 'ball' && x.twin !== null).length === 2);
    await page.waitForFunction(() => window.__cad.shapes().filter(x => x.kind === 'ball' && x.twin !== null).every(x => x.level === 2));

    // 11. capture mirrored state
    const mirroredInitialState = await page.evaluate(() => {
      const s = window.__cad.shapes().filter(x => x.kind === 'ball' && x.twin !== null);
      if (s.length !== 2) return null;
      return s.map(x => ({ gx: x.gx, gz: x.gz, size: x.size, paint: x.paint }));
    });
    if (!mirroredInitialState || mirroredInitialState.length !== 2) throw new Error('Could not find mirrored ball pair');
    console.error('Mirrored initial state captured.');

    // 12. click To plate
    console.error('Clicking To plate for mirrored pair...');
    await page.waitForSelector('#btn-plate:not([disabled])');
    await page.click('#btn-plate');

    // 13. assert both zero and unchanged
    const afterMirrorPlateState = await page.evaluate(() => {
      const s = window.__cad.shapes().filter(x => x.kind === 'ball' && x.twin !== null);
      if (s.length !== 2) return null;
      return s.map(x => ({
        level: x.level,
        gx: x.gx,
        gz: x.gz,
        size: x.size,
        paint: x.paint
      }));
    });

    if (!afterMirrorPlateState || afterMirrorPlateState.length !== 2) throw new Error('Could not find mirrored ball pair after toPlate');
    for (let i = 0; i < 2; i++) {
      if (afterMirrorPlateState[i].level !== 0) throw new Error(`Ball ${i+1} level not 0: ${afterMirrorPlateState[i].level}`);
      if (afterMirrorPlateState[i].gx !== mirroredInitialState[i].gx) throw new Error(`Ball ${i+1} gx changed`);
      if (afterMirrorPlateState[i].gz !== mirroredInitialState[i].gz) throw new Error(`Ball ${i+1} gz changed`);
      if (afterMirrorPlateState[i].size !== mirroredInitialState[i].size) throw new Error(`Ball ${i+1} size changed`);
      if (afterMirrorPlateState[i].paint !== mirroredInitialState[i].paint) throw new Error(`Ball ${i+1} paint changed`);
    }
    console.error('Mirrored shape toPlate verified.');

    // 14. Undo and assert both two
    console.error('Undoing mirrored pair...');
    await page.click('#btn-undo');
    await page.waitForFunction(() => {
      const s = window.__cad.shapes().filter(x => x.kind === 'ball' && x.twin !== null);
      return s.length === 2 && s.every(x => x.level === 2);
    });

    console.log('to plate verified for single and mirrored shapes with undo');

  } catch (e) {
    console.error('TEST FAILED:', e.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
