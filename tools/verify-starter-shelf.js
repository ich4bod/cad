'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
const expected = [
  'Start with a Block',
  'Then add a Ball',
  'Try Mirror for pairs',
  'Save when it is yours',
];

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(BASE + '/?v=' + Date.now(), { waitUntil: 'networkidle' });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__cad && window.__cad.ready, null, { timeout: 30000 });
    if (await page.isVisible('#tour')) await page.click('#tour-skip', { force: true });

    const shelf = page.locator('#starter-shelf');
    for (const text of expected) {
      if (!(await shelf.getByText(text, { exact: true }).isVisible())) {
        throw new Error('missing visible starter label: ' + text);
      }
    }
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) throw new Error('horizontal overflow at 390x844');

    await page.click('#palette .shape[data-kind="cube"]');
    await page.waitForTimeout(150);
    if (await shelf.isVisible()) throw new Error('starter shelf remained visible after adding Block');

    process.stdout.write('empty plate starter shelf verified\n');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(error.stack + '\n');
  process.exitCode = 1;
});
