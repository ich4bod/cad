/*
 * Parse a binary STL back out of its bytes and decide whether a slicer would
 * accept it. Nothing here trusts the exporter: it reads the file as a stranger
 * would.
 *
 *   node tools/stl-check.js my-model.stl [expectedTriangles]
 *
 * The four assertions the card asks for, plus two that are worth the lines:
 *
 *   1. triangle count  — the header's count, the byte length, and the
 *                        geometry's own count all agree
 *   2. unit normals    — every stored facet normal has |n| == 1
 *   3. closed mesh     — every edge is shared by exactly two triangles
 *   4. consistent      — each of those two uses the edge in the opposite
 *      winding          direction, which is what makes "outward" mean anything
 *   5. non-degenerate  — no zero-area facets
 *   6. positive volume — the signed volume is > 0, so the surface encloses
 *                        solid rather than being inside-out
 *
 * On 3: the vertices are welded with a tolerance rather than by exact bytes.
 * A sphere's seam vertices are computed from cos(0) and cos(2*PI) and differ in
 * the last bit or two, so exact-match welding would report a hole that is not
 * there. Tolerance also means a coordinate sitting on a rounding boundary
 * cannot split one vertex into two.
 */

'use strict';

const TOL = 1e-3;          // mm. Vertices closer than this are the same vertex.
const NORMAL_EPS = 1e-3;   // how far |n| may sit from 1, after float32 storage.

/** Weld vertices with a spatial hash, checking neighbouring buckets so a
 *  vertex on a bucket boundary still finds its twin. Returns canonical ids. */
function makeWelder() {
  const buckets = new Map();
  const reps = [];
  const key = (i, j, k) => i + ',' + j + ',' + k;

  return function weld(x, y, z) {
    const bi = Math.floor(x / TOL);
    const bj = Math.floor(y / TOL);
    const bk = Math.floor(z / TOL);

    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let dk = -1; dk <= 1; dk++) {
          const list = buckets.get(key(bi + di, bj + dj, bk + dk));
          if (!list) continue;
          for (const id of list) {
            const r = reps[id];
            if (Math.abs(r[0] - x) <= TOL &&
                Math.abs(r[1] - y) <= TOL &&
                Math.abs(r[2] - z) <= TOL) return id;
          }
        }
      }
    }

    const id = reps.length;
    reps.push([x, y, z]);
    const own = key(bi, bj, bk);
    if (!buckets.has(own)) buckets.set(own, []);
    buckets.get(own).push(id);
    return id;
  };
}

/**
 * @param {Buffer|Uint8Array} bytes  the STL file
 * @param {number|null} expected     triangle count the geometry should produce
 * @returns {{checks: Array<{name: string, ok: boolean, detail: string}>, ok: boolean, stats: object}}
 */
function checkSTL(bytes, expected = null) {
  const buf = Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength || bytes.length);
  const checks = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail: String(detail) }); };

  if (buf.length < 84) {
    check('file is at least a header', false, buf.length + ' bytes');
    return { checks, ok: false, stats: {} };
  }

  // An ASCII STL would start with "solid" and have no 4-byte count. Rule it
  // out explicitly, because the rest of this only makes sense for binary.
  const lead = buf.slice(0, 5).toString('latin1');
  check('binary STL, not ASCII', lead !== 'solid', 'leading bytes ' + JSON.stringify(lead));

  const declared = buf.readUInt32LE(80);
  const byLength = (buf.length - 84) / 50;

  check('byte length matches the declared triangle count',
    Number.isInteger(byLength) && byLength === declared,
    'header says ' + declared + ', bytes imply ' + byLength);

  if (!Number.isInteger(byLength) || byLength !== declared) {
    return { checks, ok: false, stats: { declared, byLength } };
  }

  if (expected !== null) {
    check('triangle count matches the scene geometry',
      declared === expected, 'STL ' + declared + ' vs geometry ' + expected);
  }

  const weld = makeWelder();
  const edges = new Map();           // "a|b" (a<b) -> count
  const directed = new Map();        // "a>b" -> count
  let badNormals = 0, worstNormal = 0;
  let disagreeing = 0, worstDot = 1;
  let degenerate = 0;
  let volume2 = 0;                   // 6x the signed volume
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let t = 0; t < declared; t++) {
    const o = 84 + t * 50;

    const nx = buf.readFloatLE(o);
    const ny = buf.readFloatLE(o + 4);
    const nz = buf.readFloatLE(o + 8);

    const v = [];
    for (let k = 0; k < 3; k++) {
      const p = o + 12 + k * 12;
      const x = buf.readFloatLE(p);
      const y = buf.readFloatLE(p + 4);
      const z = buf.readFloatLE(p + 8);
      v.push([x, y, z]);
      for (let a = 0; a < 3; a++) {
        const c = [x, y, z][a];
        if (c < min[a]) min[a] = c;
        if (c > max[a]) max[a] = c;
      }
    }

    // 2: the stored normal must be a unit vector.
    const len = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(len) || Math.abs(len - 1) > NORMAL_EPS) badNormals++;
    if (Number.isFinite(len)) worstNormal = Math.max(worstNormal, Math.abs(len - 1));
    else worstNormal = Infinity;

    // 5 + 4: winding-derived normal, for area and for agreement.
    const ab = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
    const ac = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
    const cr = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    const crLen = Math.hypot(cr[0], cr[1], cr[2]);
    if (crLen < 1e-9) {
      degenerate++;
    } else if (Number.isFinite(len) && len > 0) {
      const dot = (cr[0] * nx + cr[1] * ny + cr[2] * nz) / (crLen * len);
      if (dot < 0.99) disagreeing++;
      worstDot = Math.min(worstDot, dot);
    }

    // 6: divergence theorem, summed over facets.
    volume2 += v[0][0] * cr[0] + v[0][1] * cr[1] + v[0][2] * cr[2];

    // 3 + 4: edge bookkeeping on welded vertex ids.
    const id = v.map((p) => weld(p[0], p[1], p[2]));
    for (let k = 0; k < 3; k++) {
      const a = id[k];
      const b = id[(k + 1) % 3];
      if (a === b) continue;                 // degenerate edge, counted above
      const u = a < b ? a + '|' + b : b + '|' + a;
      edges.set(u, (edges.get(u) || 0) + 1);
      const d = a + '>' + b;
      directed.set(d, (directed.get(d) || 0) + 1);
    }
  }

  check('every facet normal is unit length',
    badNormals === 0,
    badNormals + ' bad, worst |n|-1 = ' + worstNormal.toExponential(2));

  check('no degenerate facets', degenerate === 0, degenerate + ' zero-area');

  // 3: the closed-mesh assertion.
  const counts = new Map();
  for (const n of edges.values()) counts.set(n, (counts.get(n) || 0) + 1);
  const notTwo = [...counts.entries()].filter(([n]) => n !== 2);
  check('mesh is closed: every edge shared by exactly two triangles',
    notTwo.length === 0,
    notTwo.length === 0
      ? edges.size + ' edges, all shared twice'
      : notTwo.map(([n, c]) => c + ' edges used ' + n + 'x').join(', '));

  // 4: and used once in each direction.
  const badDir = [...directed.entries()].filter(([, n]) => n !== 1).length;
  check('winding is consistent: each edge traversed once per direction',
    badDir === 0, badDir + ' directed edges not used exactly once');

  check('normals agree with facet winding',
    disagreeing === 0,
    disagreeing + ' disagree, worst dot = ' + worstDot.toFixed(4));

  const volume = volume2 / 6;
  check('signed volume is positive (surface encloses solid)',
    volume > 0, volume.toFixed(1) + ' mm^3');

  const ok = checks.every((c) => c.ok);
  return {
    checks,
    ok,
    stats: {
      triangles: declared,
      vertices: undefined,
      edges: edges.size,
      volumeMm3: Number(volume.toFixed(2)),
      bbox: {
        min: min.map((n) => Number(n.toFixed(3))),
        max: max.map((n) => Number(n.toFixed(3))),
      },
      bytes: buf.length,
    },
  };
}

function report(result, label) {
  console.log('STL assertions' + (label ? ' — ' + label : ''));
  for (const c of result.checks) {
    console.log('  ' + (c.ok ? 'PASS' : 'FAIL') + '  ' + c.name + '  [' + c.detail + ']');
  }
  console.log('  stats: ' + JSON.stringify(result.stats));
  console.log(result.ok ? '  ALL STL ASSERTIONS PASSED' : '  STL ASSERTIONS FAILED');
  return result.ok;
}

module.exports = { checkSTL, report };

if (require.main === module) {
  const fs = require('fs');
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node stl-check.js <file.stl> [expectedTriangles]');
    process.exit(2);
  }
  const expected = process.argv[3] ? Number(process.argv[3]) : null;
  const ok = report(checkSTL(fs.readFileSync(path), expected), path);
  process.exit(ok ? 0 : 1);
}
