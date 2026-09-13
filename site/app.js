/*
  Shape Maker — a 3D modelling toy that fits in a kid's hands.

  The whole program is four primitives on a 10mm grid. There are no booleans,
  no sketches, no extrudes, and deliberately no text input anywhere: a kid
  who cannot read a dimension box can still build a snowman and print it.

  Two design decisions carry most of the weight:

  1. Everything snaps to a 10mm grid, and every size is a multiple of 10mm.
     That is what makes "put this block next to that block" produce a single
     printable object instead of two loose blocks that fall apart.

  2. Undo is a full state snapshot, not an inverse-operation stack. Snapshots
     cost nothing at this scale and they cannot drift out of sync with the
     scene, so the Undo button always works — which is the actual requirement.
     A kid who cannot undo a mistake stops playing.
*/

import * as THREE from 'three';
import { OrbitControls } from './vendor/three/OrbitControls.js';

/* ------------------------------------------------------------------ model */

const GRID = 10;            // mm. The snap unit, and the grid you can see.
const SIZE_MIN = 10;
const SIZE_MAX = 80;
const SIZE_STEP = 10;
const SIZE_DEFAULT = 30;
const LEVEL_MAX = 14;       // how many grid steps a shape can be lifted
const BOARD = 6;            // cells from the origin in each direction

const KINDS = {
  cube: { colour: 0xff6b6b, label: 'block' },
  ball: { colour: 0x4dabf7, label: 'ball' },
  tube: { colour: 0x51cf66, label: 'tube' },
  cone: { colour: 0xffd43b, label: 'cone' },
};

/*
  Mirror.

  Symmetric is what a kid actually reaches for — a face, a robot with two arms,
  a car with two wheels — and building it a shape at a time means placing every
  piece twice and getting the second one wrong. With Mirror on, every shape is
  a pair: add one and its twin appears across the plate's centre line, and from
  then on moving, resizing, lifting or deleting either one does the same to the
  other.

  The twin is a real shape in `shapes`, not a derived thing computed at render
  or export time. That is the whole trick. `twin` holds the partner's id and is
  symmetric — neither one is the original — so a snapshot of `shapes` already
  contains both the pair and the fact that they are a pair, and Undo keeps
  working exactly as it did with no idea any of this exists. The alternative,
  recomputing twins from a rule, is how a twin survives a delete or comes back
  in the wrong place after an undo.
*/

/** shapes: [{ id, kind, size, gx, gz, level, twin }] — the entire document.
 *  `twin` is the id of this shape's mirrored partner, or null. */
let shapes = [];
let nextId = 1;
let selectedId = null;
let mirror = false;

const undoStack = [];
const UNDO_LIMIT = 80;

function snapshot() {
  return { shapes: shapes.map((s) => ({ ...s })), selectedId, nextId, mirror };
}

function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function restore(state) {
  shapes = state.shapes.map((s) => ({ ...s }));
  selectedId = state.selectedId;
  nextId = state.nextId;
  mirror = state.mirror;
}

const selected = () => shapes.find((s) => s.id === selectedId) || null;

/** The partner of a shape, if it has one. */
const twinOf = (s) => (s && s.twin != null ? shapes.find((x) => x.id === s.twin) || null : null);

/** Height of a shape's centre above the build plate. Every primitive is
 *  authored to be exactly `size` tall, so this is the same formula for all
 *  four — which is also why stacking works without the kid measuring. */
const centreY = (s) => s.size / 2 + s.level * GRID;

/* --------------------------------------------------------------- geometry */

const geoCache = new Map();

function geometryFor(kind, size) {
  const key = `${kind}:${size}`;
  const hit = geoCache.get(key);
  if (hit) return hit;

  const r = size / 2;
  let geo;
  switch (kind) {
    case 'cube': geo = new THREE.BoxGeometry(size, size, size); break;
    case 'ball': geo = new THREE.SphereGeometry(r, 32, 16); break;
    case 'tube': geo = new THREE.CylinderGeometry(r, r, size, 32); break;
    case 'cone': geo = new THREE.ConeGeometry(r, size, 32); break;
    default: throw new Error(`unknown kind ${kind}`);
  }
  geoCache.set(key, geo);
  return geo;
}

const triangleCount = (geo) =>
  (geo.index ? geo.index.count : geo.attributes.position.count) / 3;

/* ------------------------------------------------------------------ scene */

const canvas = document.getElementById('scene');
const stage = document.getElementById('stage');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe9f5);

const camera = new THREE.PerspectiveCamera(45, 1, 1, 2000);
camera.position.set(115, 105, 150);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 15, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.enablePan = false;          // panning is how a kid loses the model
controls.minDistance = 70;
controls.maxDistance = 420;
controls.maxPolarAngle = Math.PI / 2 - 0.05;   // never go under the floor
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb4cc, 2.0));

const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(90, 160, 70);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 500;
const span = (BOARD + 3) * GRID;
Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span });
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);

// The build plate. Shadows land here, and it is what a drag ray hits.
const plate = new THREE.Mesh(
  new THREE.PlaneGeometry(BOARD * 2 * GRID, BOARD * 2 * GRID),
  new THREE.MeshLambertMaterial({ color: 0xeef3fa })
);
plate.rotation.x = -Math.PI / 2;
plate.receiveShadow = true;
scene.add(plate);

const grid = new THREE.GridHelper(BOARD * 2 * GRID, BOARD * 2, 0x9db4d0, 0xc8d6e5);
grid.position.y = 0.05;
scene.add(grid);

/* ------------------------------------------------------------- shape mesh */

const meshes = new Map();     // id -> THREE.Mesh
const shapeGroup = new THREE.Group();
scene.add(shapeGroup);

function makeMesh(s) {
  const mesh = new THREE.Mesh(
    geometryFor(s.kind, s.size),
    new THREE.MeshLambertMaterial({ color: KINDS[s.kind].colour })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.id = s.id;

  // Selection halo: the same geometry, grown a little and drawn inside-out,
  // so it peeks around the edges as a coloured rim. Obvious at a glance and
  // it never covers the shape it is marking.
  const halo = new THREE.Mesh(
    mesh.geometry,
    new THREE.MeshBasicMaterial({ color: 0x1c7ed6, side: THREE.BackSide })
  );
  halo.scale.setScalar(1.09);
  halo.visible = false;
  halo.name = 'halo';
  mesh.add(halo);

  return mesh;
}

function placeMesh(mesh, s) {
  mesh.position.set(s.gx * GRID, centreY(s), s.gz * GRID);
}

/** Rebuild the scene graph from `shapes`. Cheap at this scale, and it means
 *  there is exactly one path from state to pixels. */
function syncScene() {
  for (const [id, mesh] of meshes) {
    if (!shapes.some((s) => s.id === id)) {
      shapeGroup.remove(mesh);
      mesh.children.forEach((c) => c.material.dispose());
      mesh.material.dispose();
      meshes.delete(id);
    }
  }

  for (const s of shapes) {
    let mesh = meshes.get(s.id);
    if (!mesh) {
      mesh = makeMesh(s);
      meshes.set(s.id, mesh);
      shapeGroup.add(mesh);
    } else if (mesh.geometry !== geometryFor(s.kind, s.size)) {
      mesh.geometry = geometryFor(s.kind, s.size);
      mesh.children[0].geometry = mesh.geometry;
    }
    placeMesh(mesh, s);
    // A mirrored twin lights up with the shape you picked, because the next
    // thing you do is going to happen to both of them.
    mesh.children[0].visible =
      s.id === selectedId || (s.twin != null && s.twin === selectedId);
  }
}

/* ------------------------------------------------------------------- edit */

/** Every cell, nearest the middle first. */
function* cells() {
  for (let ring = 0; ring <= BOARD; ring++) {
    for (let gx = -ring; gx <= ring; gx++) {
      for (let gz = -ring; gz <= ring; gz++) {
        if (Math.max(Math.abs(gx), Math.abs(gz)) === ring) yield { gx, gz };
      }
    }
  }
}

/** A shape's footprint seen from above, [x0, x1, z0, z1] in mm. */
const footprint = (size, gx, gz) => [
  gx * GRID - size / 2, gx * GRID + size / 2,
  gz * GRID - size / 2, gz * GRID + size / 2,
];

const overlaps = (a, b, gap) =>
  a[0] < b[1] + gap && b[0] < a[1] + gap && a[2] < b[3] + gap && b[2] < a[3] + gap;

/*
  Where a new shape lands.

  "The first empty cell" is the obvious answer and it is wrong: a shape is
  30mm across on a 10mm grid, so it covers three cells in each direction and
  the cell next door is still inside it. Placing by empty cell buried every
  new shape in the one before it — you tapped Ball and nothing appeared,
  because the ball was inside the block.

  So the test is the footprint, not the cell: spiral out until the new shape's
  square clears every square already down, with a millimetre to spare.

  With Mirror on the same spiral runs, with two extra demands: the cell's
  reflection has to be clear too, and the pair must not land on top of each
  other. That second one is what keeps the first mirrored shape off the centre
  line — a pair placed at gx=0 would be one shape wearing another.
*/
function freeCell(paired) {
  const placed = shapes.map((s) => footprint(s.size, s.gx, s.gz));
  const clear = (gx, gz) => !placed.some((p) => overlaps(footprint(SIZE_DEFAULT, gx, gz), p, 1));
  const pairFits = (gx, gz) =>
    gx !== 0 && clear(-gx, gz) &&
    !overlaps(footprint(SIZE_DEFAULT, gx, gz), footprint(SIZE_DEFAULT, -gx, gz), 1);

  for (const c of cells()) {
    if (!clear(c.gx, c.gz)) continue;
    if (paired && !pairFits(c.gx, c.gz)) continue;
    return c;
  }
  // Board carpeted. Fall back to a cell nothing is centred on, then give up
  // and stack near the middle — both better than refusing to add the shape.
  const taken = (gx, gz) => shapes.some((s) => s.gx === gx && s.gz === gz);
  for (const c of cells()) {
    if (taken(c.gx, c.gz)) continue;
    if (paired && (c.gx === 0 || taken(-c.gx, c.gz))) continue;
    return c;
  }
  return paired ? { gx: 2, gz: 0 } : { gx: 0, gz: 0 };
}

function addShape(kind) {
  pushUndo();
  const { gx, gz } = freeCell(mirror);
  const s = { id: nextId++, kind, size: SIZE_DEFAULT, gx, gz, level: 0, twin: null };
  shapes.push(s);
  selectedId = s.id;

  if (mirror) {
    const t = { ...s, id: nextId++, gx: -gx, twin: s.id };
    s.twin = t.id;
    shapes.push(t);
  }

  after(mirror ? `Two ${KINDS[kind].label}s! Drag one and both move.`
               : `A ${KINDS[kind].label}! Drag it to move it.`);
}

function resize(delta) {
  const s = selected();
  if (!s) return;
  const size = Math.min(SIZE_MAX, Math.max(SIZE_MIN, s.size + delta));
  if (size === s.size) return;
  pushUndo();
  s.size = size;
  const t = twinOf(s);
  if (t) t.size = size;
  after(delta > 0 ? 'Bigger!' : 'Smaller!');
}

function lift(delta) {
  const s = selected();
  if (!s) return;
  const level = Math.min(LEVEL_MAX, Math.max(0, s.level + delta));
  if (level === s.level) return;
  pushUndo();
  s.level = level;
  const t = twinOf(s);
  if (t) t.level = level;
  after(delta > 0 ? 'Up it goes.' : 'Back down.');
}

function removeSelected() {
  const s = selected();
  if (!s) return;
  pushUndo();
  const t = twinOf(s);
  const going = t ? new Set([s.id, t.id]) : new Set([s.id]);
  shapes = shapes.filter((x) => !going.has(x.id));
  selectedId = null;
  after(t ? 'Both gone. Undo brings them back.' : 'Gone. Undo brings it back.');
}

/*
  The toggle, and the only control this feature adds.

  Turning it on does not reach back and twin what is already on the plate —
  you turn Mirror on to put two eyes on a head you have already built, and
  duplicating the head would be a rude surprise. Turning it off cuts every
  existing pair loose rather than deleting anything: both shapes stay exactly
  where they are and go back to moving on their own.

  Both directions are one snapshot, so both undo.
*/
function toggleMirror() {
  pushUndo();
  mirror = !mirror;
  if (!mirror) for (const s of shapes) s.twin = null;
  after(mirror ? 'Mirror on. New shapes come in twos.'
               : 'Mirror off. Every shape is on its own now.');
}

function undo() {
  if (!undoStack.length) return;
  restore(undoStack.pop());
  after('Undone.');
}

/** Every edit ends here: redraw, re-enable the right buttons, say something. */
function after(message) {
  syncScene();
  updateUI();
  if (message) setHint(message);
}

/* --------------------------------------------------------------- pointers */

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();

let drag = null;
let downAt = null;

function setPointer(e) {
  const r = canvas.getBoundingClientRect();
  pointer.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1
  );
}

function pickShape(e) {
  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...meshes.values()], false);
  return hits.length ? hits[0] : null;
}

/*
  This listener sits on #stage in the capture phase, which is what lets it run
  before the OrbitControls listener bound to the canvas itself. When the press
  lands on a shape we stop the event there: the shape gets dragged and the
  camera stays put. Anywhere else, we do nothing and OrbitControls orbits.
*/
stage.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas || e.button !== 0 && e.pointerType === 'mouse') return;

  const hit = pickShape(e);
  downAt = { x: e.clientX, y: e.clientY, onShape: !!hit };
  if (!hit) return;

  const s = shapes.find((x) => x.id === hit.object.userData.id);
  if (!s) return;

  selectedId = s.id;
  syncScene();
  updateUI();

  dragPlane.constant = -centreY(s);
  raycaster.ray.intersectPlane(dragPlane, hitPoint);

  drag = {
    id: s.id,
    offX: hitPoint.x - s.gx * GRID,
    offZ: hitPoint.z - s.gz * GRID,
    undone: false,
  };

  canvas.classList.add('is-dragging');
  canvas.setPointerCapture?.(e.pointerId);
  e.stopPropagation();
}, true);

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const s = shapes.find((x) => x.id === drag.id);
  if (!s) return;

  setPointer(e);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return;

  const clamp = (v) => Math.max(-BOARD, Math.min(BOARD, v));
  let gx = clamp(Math.round((hitPoint.x - drag.offX) / GRID));
  const gz = clamp(Math.round((hitPoint.z - drag.offZ) / GRID));

  // A twinned shape cannot rest on the centre line: its twin would be inside
  // it, and the pair would look like one shape and export as two. So the
  // centre column is skipped — drag through the middle and the pair swaps
  // sides — which needs no second control and nothing to explain.
  const t = twinOf(s);
  if (t && gx === 0) gx = s.gx > 0 ? -1 : 1;

  if (gx === s.gx && gz === s.gz) return;

  // Snapshot the position it is leaving, once, the first time it actually
  // moves — so Undo after a drag puts it back where it started.
  if (!drag.undone) { pushUndo(); drag.undone = true; }

  s.gx = gx;
  s.gz = gz;
  placeMesh(meshes.get(s.id), s);

  if (t) {
    t.gx = -gx;
    t.gz = gz;
    placeMesh(meshes.get(t.id), t);
  }
});

window.addEventListener('pointerup', (e) => {
  if (drag) {
    drag = null;
    canvas.classList.remove('is-dragging');
    updateUI();
  } else if (downAt && !downAt.onShape) {
    // A tap on empty space with no orbiting means "never mind" — let go of
    // the selection. A drag of the camera leaves the selection alone.
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    if (moved < 6 && selectedId !== null) {
      selectedId = null;
      after('');
    }
  }
  downAt = null;
});

window.addEventListener('pointercancel', () => {
  drag = null;
  downAt = null;
  canvas.classList.remove('is-dragging');
});

/* ------------------------------------------------------------------- STL */

const WELD_BASE = 0.20;     // mm each shape is inflated at export time
const WELD_SPREAD = 0.06;   // mm, the range the per-shape jitter spans

/*
  Why inflate at all.

  Two blocks snapped to touching grid cells share a face exactly. Exported as
  they look, that face appears twice and every edge on it belongs to four
  triangles — a non-manifold mesh, which is precisely the thing slicers refuse.
  Growing each shape a fifth of a millimetre turns every "touching" into a real
  overlap, so the union is watertight.

  The jitter is the second half of that. Two shapes of the same kind and size
  dropped in the same cell would otherwise be inflated by the same amount and
  land on *identical* triangles — and identical triangles put four faces on
  every shared edge, which is the non-manifold case again. Stepping the
  inflation by the golden ratio gives every id its own distinct value, with no
  modulus to collide on, so that can't happen.

  A fifth of a millimetre is well under one 0.4mm nozzle width. Nobody will
  ever see it; the slicer will.
*/
const weldFor = (s) => WELD_BASE + ((s.id * 0.6180339887) % 1) * WELD_SPREAD;

function exportTriangles() {
  const tris = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  for (const s of shapes) {
    const weld = weldFor(s);
    const f = (s.size + weld) / s.size;
    // Grown about its own centre, then lifted by half the growth so the
    // bottom face stays exactly where the kid put it, on the plate.
    pos.set(s.gx * GRID, centreY(s) + weld / 2, s.gz * GRID);
    scl.setScalar(f);
    m.compose(pos, q, scl);

    const geo = geometryFor(s.kind, s.size).toNonIndexed();
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      tris.push([
        new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m),
        new THREE.Vector3().fromBufferAttribute(p, i + 1).applyMatrix4(m),
        new THREE.Vector3().fromBufferAttribute(p, i + 2).applyMatrix4(m),
      ]);
    }
    geo.dispose();
  }
  return tris;
}

function buildSTL() {
  const tris = exportTriangles();
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);

  const header = 'Shape Maker - cad.ichabod-crane.net - units mm';
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  dv.setUint32(80, tris.length, true);

  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();
  let o = 84;

  for (const [a, b, c] of tris) {
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    n.crossVectors(ab, ac).normalize();   // CCW winding => outward normal

    dv.setFloat32(o, n.x, true); dv.setFloat32(o + 4, n.y, true); dv.setFloat32(o + 8, n.z, true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, v.x, true); dv.setFloat32(o + 4, v.y, true); dv.setFloat32(o + 8, v.z, true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }

  return new Uint8Array(buf);
}

function download() {
  if (!shapes.length) return;
  const blob = new Blob([buildSTL()], { type: 'model/stl' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'my-model.stl';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  setHint('Saved! Open my-model.stl in your printer app.');
}

/* --------------------------------------------------------------------- UI */

const els = {
  hint: document.getElementById('hint'),
  undo: document.getElementById('btn-undo'),
  save: document.getElementById('btn-download'),
  bigger: document.getElementById('btn-bigger'),
  smaller: document.getElementById('btn-smaller'),
  up: document.getElementById('btn-up'),
  down: document.getElementById('btn-down'),
  del: document.getElementById('btn-delete'),
  mirror: document.getElementById('btn-mirror'),
};

function setHint(text) {
  els.hint.textContent = text ||
    (shapes.length ? 'Tap a shape to choose it. Drag the sky to spin around.'
                   : 'Tap a shape below to start');
}

function updateUI() {
  const s = selected();
  els.undo.disabled = undoStack.length === 0;
  els.save.disabled = shapes.length === 0;
  els.bigger.disabled = !s || s.size >= SIZE_MAX;
  els.smaller.disabled = !s || s.size <= SIZE_MIN;
  els.up.disabled = !s || s.level >= LEVEL_MAX;
  els.down.disabled = !s || s.level <= 0;
  els.del.disabled = !s;
  // Mirror is the one control here that has an on and an off, so it is the one
  // control that shows its state. It is never disabled: there is no scene it
  // is wrong to turn on or off in.
  els.mirror.setAttribute('aria-pressed', String(mirror));
}

for (const btn of document.querySelectorAll('#palette .shape')) {
  btn.addEventListener('click', () => addShape(btn.dataset.kind));
}
els.bigger.addEventListener('click', () => resize(SIZE_STEP));
els.smaller.addEventListener('click', () => resize(-SIZE_STEP));
els.up.addEventListener('click', () => lift(1));
els.down.addEventListener('click', () => lift(-1));
els.del.addEventListener('click', removeSelected);
els.mirror.addEventListener('click', toggleMirror);
els.undo.addEventListener('click', undo);
els.save.addEventListener('click', download);

// Grown-ups get the keyboard shortcut they will reach for anyway.
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
});

/* ------------------------------------------------------------------ frame */

function resizeRenderer() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

new ResizeObserver(resizeRenderer).observe(stage);
resizeRenderer();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

setHint('');
updateUI();

/* ------------------------------------------------- hook for the verifier */

window.__cad = {
  shapes: () => shapes.map((s) => ({ ...s })),
  selectedId: () => selectedId,
  mirror: () => mirror,
  undoDepth: () => undoStack.length,
  /** Where a shape's centre lands on screen, so the verifier can drag it with
   *  a real pointer instead of poking at the model behind the UI's back. */
  screenOf: (id) => {
    const s = shapes.find((x) => x.id === id);
    if (!s) return null;
    const r = canvas.getBoundingClientRect();
    const v = new THREE.Vector3(s.gx * GRID, centreY(s), s.gz * GRID).project(camera);
    return {
      x: r.left + ((v.x + 1) / 2) * r.width,
      y: r.top + ((1 - v.y) / 2) * r.height,
    };
  },
  /** Screen position of a grid cell, taken at the height shape `forId` is
   *  currently being dragged through, which is the plane a drag follows. */
  screenOfCell: (gx, gz, forId) => {
    const s = shapes.find((x) => x.id === forId);
    if (!s) return null;
    const r = canvas.getBoundingClientRect();
    const v = new THREE.Vector3(gx * GRID, centreY(s), gz * GRID).project(camera);
    return {
      x: r.left + ((v.x + 1) / 2) * r.width,
      y: r.top + ((1 - v.y) / 2) * r.height,
    };
  },
  cameraPos: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z }),
  stl: () => Array.from(buildSTL()),
  /** What the STL's triangle count must equal, read off the live geometry. */
  expectedTriangles: () =>
    shapes.reduce((n, s) => n + triangleCount(geometryFor(s.kind, s.size)), 0),
  ready: true,
};
