# Shape Maker

A 3D modelling toy for a seven-year-old, live at
**https://cad.ichabod-crane.net**. Tap a shape, drag it, stack it, press Save,
and print the STL that falls out.

Built for Zach's son, who can drive a tablet but cannot yet type a dimension
into a box.

## What it does

Four primitives — block, ball, tube, cone — on a 10mm grid. Add them from the
palette, drag them around the plate, make them bigger or smaller in 10mm steps,
lift them up a level at a time to stack, delete them, and undo any of it. Orbit
the camera by dragging empty space. Save writes a binary STL of everything on
the plate.

## What it deliberately does not do

No booleans, no sketching, no extrude, no rotation, no colours, no saved
projects, no accounts. It is a toy, not a CAD program: a lopsided snowman a
child can actually print beats a correct modeller he cannot drive.

## The five constraints that shaped it

1. **No typing.** Nothing in the build flow requires reading a number or
   spelling a word. There are zero `input` elements on the page, and the
   verifier asserts that.
2. **One screen.** Palette, scene, save. No modes, no menus, nothing scrolls.
3. **Undo always works.** It is a full state snapshot per edit, not an
   inverse-operation stack — snapshots cost nothing at this scale and cannot
   drift out of sync with the scene. A child who cannot undo stops playing.
4. **Snap to a visible grid.** Blocks that nearly touch print as two loose
   blocks, so nothing is allowed to nearly touch.
5. **Survives a wrong click.** No dialogs. Refresh clears everything.

## Two decisions worth knowing about

**Placement tests footprints, not cells.** A shape is 30mm across on a 10mm
grid, so it covers three cells each way and the cell next door is still inside
it. The first version placed new shapes in the first *empty cell* and buried
every one of them in the shape before — you tapped Ball and nothing appeared,
because the ball was inside the block. `freeCell` now spirals out until the new
shape's square clears every square already down.

**Export inflates each shape by ~0.2mm.** Two blocks snapped to touching cells
share a face exactly, and exported as they look, that face appears twice and
every edge on it belongs to four triangles — a non-manifold mesh, which is what
slicers refuse. Growing each shape a fifth of a millimetre turns every "touching"
into a real overlap, so the union is watertight. The per-shape jitter is stepped
by the golden ratio so two identical shapes dropped in one cell can never be
inflated to identical triangles. A fifth of a millimetre is well under one
0.4mm nozzle width; nobody will see it, the slicer will.

## Stack

nginx on :3000, static files only. No backend, no accounts, nothing stored.
three.js r180 (MIT) is vendored into `site/vendor/three/` — no CDN, no
third-party runtime request, same as the rest of the estate.

## Verifying it

Two tools, both run against the **live** site rather than the source.

`tools/stl-check.js` parses a binary STL as a stranger would and asserts the
things a slicer cares about: triangle count agrees with the geometry, every
facet normal is unit length, every edge is shared by exactly two triangles,
winding is consistent, no degenerate facets, and the signed volume is positive.
Vertices are welded with a tolerance, not by exact bytes — a sphere's seam
vertices come from `cos(0)` and `cos(2*PI)` and differ in the last bit.

```
node tools/stl-check.js my-model.stl [expectedTriangles]
```

`tools/verify.js` drives the live URL in a real Chromium: places all four
primitives, drags one, scales one, stacks one, deletes one, undoes the delete,
orbits, downloads the STL and runs every assertion above on the downloaded
bytes — then builds a three-ball snowman, which is the touching-shapes case the
weld exists for, and does it again.

```
docker run --rm --ipc=host \
  -v /srv/ichabod/apps/cad/tools:/tools:ro \
  -v /srv/ichabod/apps/cad/proof:/proof \
  -v /srv/ichabod/apps/cad/.verify/node_modules:/w/node_modules:ro \
  -e NODE_PATH=/w/node_modules \
  mcr.microsoft.com/playwright:v1.55.0-noble \
  node /tools/verify.js https://cad.ichabod-crane.net/
```

There is no browser on the host, and that image ships browsers but not the npm
package — hence `playwright-core@1.55.0` installed into `.verify/` and mounted,
and `NODE_PATH` set, because Node resolves modules from the script's directory
rather than the working directory.

Last run: **60 checks passed, 0 failed.**

## Deploying

```
docker compose build && docker compose up -d
```

Traefik routes `cad.ichabod-crane.net` to it over the external `ichabod-proxy`
network. `cpus: "0.50"`, `mem_limit: 512m`, `pids_limit: 256`.
