/*
 * Verifies that Save explains its STL download without changing the export.
 *
 * docker run --rm --ipc=host \
 *   -v /srv/ichabod/apps/cad/tools:/tools:ro \
 *   -v /srv/ichabod/apps/cad/proof:/proof \
 *   -v /srv/ichabod/apps/cad/.verify/node_modules:/w/node_modules:ro \
 *   -e NODE_PATH=/w/node_modules \
 *   mcr.microsoft.com/playwright:v1.55.0-noble \
 *   node /tools/verify-save-hint.js https://cad.ichabod-crane.net/
 */
'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const fs = require('fs');
const { checkSTL } = require('/tools/stl-check.js');
const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
const OUT = process.env.OUT_DIR || '/proof';
const HINT = 'Save downloads a printable .stl file.';

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(() => window.__cad && window.__cad.ready, { timeout: 20000 });
    if (await page.isVisible('#tour')) await page.click('#tour-skip');

    if (await page.isVisible('#save-hint')) throw new Error('Save hint is visible on an empty plate');
    await page.click('[data-kind="cube"]');
    await page.waitForSelector('#save-hint:not([hidden])');
    const hint = await page.locator('#save-hint').textContent();
    if (hint !== HINT) throw new Error('Save hint text was ' + JSON.stringify(hint));

    const expected = await page.evaluate(() => window.__cad.expectedTriangles());
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('#btn-download'),
    ]);
    if (download.suggestedFilename() !== 'my-model.stl') {
      throw new Error('Download was named ' + download.suggestedFilename());
    }
    const file = OUT + '/save-hint.stl';
    await download.saveAs(file);
    const result = checkSTL(fs.readFileSync(file), expected);
    if (!result.ok) {
      throw new Error('Downloaded STL failed: ' + result.checks.filter((c) => !c.ok)
        .map((c) => c.name + ' (' + c.detail + ')').join(', '));
    }

    process.stdout.write('Save hint verified without changing STL export\n');
  } catch (err) {
    process.stderr.write((err && err.stack) || String(err));
    process.stderr.write('\n');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
