/*
 * Loads the live Shape Maker in a real Chromium and asserts that no copy
 * anywhere on it names a specific child. The design goal is still "a kid can
 * drive this" — the banned list is about the personal claim, not the intent,
 * so generic "kid"/"kids" passes and is expected to appear.
 *
 * Checks the rendered DOM, the document title and meta description, and the
 * text of every same-origin script and stylesheet the page pulls in, because
 * the claim lived in source comments as well as in visible copy.
 *
 *   docker run --rm --ipc=host \
 *     -v /srv/ichabod/apps/cad/tools:/tools:ro \
 *     -v /srv/ichabod/apps/cad/proof:/proof \
 *     -v /srv/ichabod/apps/cad/.verify/node_modules:/w/node_modules:ro \
 *     -e NODE_PATH=/w/node_modules \
 *     mcr.microsoft.com/playwright:v1.55.0-noble \
 *     node /tools/copy-check.js https://cad.ichabod-crane.net/
 */
'use strict';

let chromium;
try { chromium = require('playwright').chromium; }
catch (e) { chromium = require('playwright-core').chromium; }

const fs = require('fs');

const BASE = (process.argv[2] || 'https://cad.ichabod-crane.net/').replace(/\/$/, '');
const OUT = process.env.OUT_DIR || '/proof';

/* Each entry is [label, regex]. Word boundaries matter: "son" must not fire on
 * "reason", and "child" must not fire on the DOM's own appendChild/children. */
const BANNED = [
  ['my son', /\bmy\s+son\b/i],
  ["zach's son", /\bzach'?s?\s+son\b/i],
  ['your son', /\byour\s+son\b/i],
  ['bare "son"', /\bsons?\b/i],
  ['7-year-old', /\b7[\s-]?year[\s-]?old\b/i],
  ['seven-year-old', /\bseven[\s-]?year[\s-]?old\b/i],
  ['named owner', /\bzach\b/i],
];

/* appendChild / .children / childNodes are three.js and DOM API names, not
 * copy. Strip them before the "child" scan so the scan can stay strict. */
const stripDomApi = (s) =>
  s.replace(/append[Cc]hild|removeChild|replaceChild|\.children\b|childNodes|childElementCount|firstChild|lastChild/g, '');

let passed = 0;
const failures = [];

function scan(where, text) {
  const cleaned = stripDomApi(text);
  for (const [label, re] of BANNED) {
    const m = cleaned.match(re);
    if (m) failures.push(`${where}: found ${label} — "${m[0]}"`);
    else passed++;
  }
  const kid = /\bkids?\b/i.test(cleaned);
  return kid;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });

  const assets = new Map();
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.startsWith(BASE)) return;
    const ct = (res.headers()['content-type'] || '');
    if (!/javascript|css|html/.test(ct)) return;
    if (/vendor\/three/.test(url)) return;   // third-party, not our copy
    try { assets.set(url, await res.text()); } catch (e) { /* binary */ }
  });

  await page.goto(BASE + '/', { waitUntil: 'networkidle' });

  const dom = await page.content();
  const visible = await page.evaluate(() => document.body.innerText);
  const title = await page.title();
  const desc = await page.evaluate(() => {
    const m = document.querySelector('meta[name="description"]');
    return m ? m.content : '';
  });

  console.log('Scanning live copy at ' + BASE);
  scan('rendered DOM', dom);
  scan('visible text', visible);
  scan('title', title);
  scan('meta description', desc);
  for (const [url, text] of assets) scan(url.replace(BASE, ''), text);

  // The design goal must survive the deletion: generic kid phrasing stays.
  const keptIntent = /\bkids?\b/i.test(desc) || /\bkids?\b/i.test(dom);
  if (keptIntent) { passed++; console.log('  PASS  kid-simple intent still stated in page copy'); }
  else failures.push('kid-simple intent was deleted along with the personal claim');

  console.log('\n  meta description: ' + desc);
  console.log('  title:            ' + title);
  console.log('  assets scanned:   ' + [...assets.keys()].map((u) => u.replace(BASE, '')).join(', '));

  await page.screenshot({ path: OUT + '/06-copy-corrected.png' });

  const summary = failures.length
    ? `\nFAILED — ${failures.length} banned phrase(s):\n` + failures.map((f) => '  ' + f).join('\n')
    : `\nPASSED — ${passed} checks, no banned phrase in any live copy.`;
  console.log(summary);
  fs.writeFileSync(OUT + '/copy-check-output.txt',
    `copy-check ${BASE} ${new Date().toISOString()}\n${summary}\n`);

  await browser.close();
  process.exit(failures.length ? 1 : 0);
})();
