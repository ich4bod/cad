/*
 * Verifies that an STL gets a friendly, safely normalized download name
 * without turning its model name into persistent document state.
 *
 * docker run --rm --ipc=host \
 *   -v /srv/ichabod/apps/cad/tools:/tools:ro \
 *   -v /srv/ichabod/apps/cad/proof:/proof \
 *   -v /srv/ichabod/apps/cad/.verify/node_modules:/w/node_modules:ro \
 *   -e NODE_PATH=/w/node_modules \
 *   mcr.microsoft.com/playwright:v1.55.0-noble \
 *   node /tools/verify-model-name.js https://cad.ichabod-crane.net/
 */
'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const fs = require('fs');
const { checkSTL } = require('/tools/stl-check.js');
const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
const OUT = process.env.OUT_DIR || '/proof';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(() => window.__cad && window.__cad.ready, { timeout: 20000 });
    if (await page.isVisible('#tour')) await page.click('#tour-skip');

    if (!await page.isDisabled('#model-name')) throw new Error('Model name is enabled on an empty plate');
    await page.click('[data-kind="cube"]');
    if (await page.isDisabled('#model-name')) throw new Error('Model name is disabled after adding a Block');
    await page.fill('#model-name', ' My Robot!!! ');

    const expected = await page.evaluate(() => window.__cad.expectedTriangles());
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('#btn-download'),
    ]);
    if (download.suggestedFilename() !== 'my-robot.stl') {
      throw new Error('Download was named ' + download.suggestedFilename());
    }
    const file = OUT + '/model-name.stl';
    await download.saveAs(file);
    const result = checkSTL(fs.readFileSync(file), expected);
    if (!result.ok) {
      throw new Error('Downloaded STL failed: ' + result.checks.filter((c) => !c.ok)
        .map((c) => c.name + ' (' + c.detail + ')').join(', '));
    }

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__cad && window.__cad.ready, { timeout: 20000 });
    if (await page.inputValue('#model-name') !== '') throw new Error('Model name persisted after reload');

    process.stdout.write('model name download normalization verified without persistent state\n');
  } catch (err) {
    process.stderr.write((err && err.stack) || String(err));
    process.stderr.write('\n');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
