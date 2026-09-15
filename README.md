# Shape Maker

A 3D modelling toy for kids, live at
**https://cad.ichabod-crane.net**. Tap a shape, drag it, stack it, press Save,
and print the STL that falls out.

Built for someone who cannot yet type a dimension into a box, and should not
have to in order to print something they made.

## What it does

Four primitives — block, ball, tube, cone — on a 10mm grid. Add them from the
palette, drag them around the plate, make them bigger or smaller in 10mm steps,
lift them up a level at a time to stack, delete them, and undo any of it. Orbit
the camera by dragging empty space. Save writes a binary STL of everything on
the plate.

Press **Mirror** and shapes come in twos: the one you place and its twin across
the plate's centre line, moving, growing, rising and going away together. The
things a kid actually reaches for are symmetric — a face, a robot with two
arms, a car with two wheels — and building one of those a side at a time means
placing every piece twice and getting the second one slightly wrong.

Your model is still there when you come back. There is no Save-your-project
button and no file to find: the plate is written to `localStorage` after every
edit and read back on load, so closing the tab, refreshing, or the tablet
rebooting costs you nothing. A seven-year-old does not know a browser tab is
the only thing holding their snowman.

## What it deliberately does not do

No booleans, no sketching, no extrude, no rotation, no colours, no accounts,
and no project files — there is exactly one model and it is always the one you
were last working on. It is a toy, not a CAD program: a lopsided snowman a
kid can actually print beats a correct modeller they cannot drive.

## The five constraints that shaped it

1. **No typing.** Nothing in the build flow requires reading a number or
   spelling a word. There are zero `input` elements on the page, and the
   verifier asserts that.
2. **One screen.** Palette, scene, save. No modes, no menus, nothing scrolls.
3. **Undo always works.** It is a full state snapshot per edit, not an
   inverse-operation stack — snapshots cost nothing at this scale and cannot
   drift out of sync with the scene. A kid who cannot undo stops playing.
4. **Snap to a visible grid.** Blocks that nearly touch print as two loose
   blocks, so nothing is allowed to nearly touch.
5. **Survives a wrong click, and a closed tab.** No dialogs, nothing to
   confirm, and nothing lost to a refresh — the document autosaves and comes
   back. Undo covers the wrong click; autosave covers everything else.

## Three decisions worth knowing about

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

**A mirrored twin is a real shape, not a derived one.** The tempting design is
to keep one shape and reflect it at render and export time. It is also the one
that breaks undo: the snapshot holds shapes, so a reflection computed outside
the snapshot is free to survive a delete or come back in the wrong place. So
the twin is an ordinary entry in `shapes` with a `twin` field holding its
partner's id, and the pairing is symmetric — neither one is the original.
A snapshot therefore already contains both the pair and the fact that they are
a pair, and undo carries the whole feature without knowing it exists. Every
edit path grew one line and nothing else changed.

The one new rule this needs: a pair cannot rest on the centre line, because
there the twin would be exactly inside its partner — one shape to look at, two
to export. Placement skips the centre column, and dragging a pair through the
middle slides it out the other side. That is why Mirror is one button and not
a button plus an axis picker plus an offset.

## Stack

nginx on :3000, static files only. No backend, no accounts, nothing stored.
three.js r180 (MIT) is vendored into `site/vendor/three/` — no CDN, no
third-party runtime request, same as the rest of the estate.

## Link preview

`site/og.png` is the 1200×630 card a shared link previews with, and the
OpenGraph and Twitter tags in `site/index.html` point at it. The card is not
generated here: it comes from `tools/make-og.sh` in the
[ichabod-crane-net](https://github.com/ich4bod/ichabod-crane-net) repo, so
every app under the domain shares one design — the same pumpkin, the same
amber rule.

```sh
# from a checkout of ichabod-crane-net
tools/make-og.sh "Shape Maker" "A 3D modelling toy for kids." \
                 "Tap a shape, stack it, print the STL." \
                 "cad.ichabod-crane.net" /path/to/cad/site/og.png
```

The `og:image:width` and `og:image:height` tags are load-bearing: scrapers
that will not fetch and measure the image themselves use them to decide
between a large preview card and a one-line grey link.

## Verifying it

Five tools, all run against the **live** site rather than the source.

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

`tools/verify-mirror.js` does the same for the Mirror toggle: turns it on,
places a pair, and asserts the twin tracks its partner through a pointer drag,
Bigger, Smaller, Up, Down, delete and undo; that a pair slides past the centre
line rather than onto it; that a mirrored scene exports an STL passing every
check above and comes out symmetric about x = 0; that turning the toggle off
cuts the pairs loose without deleting anything, and that undo restores the
toggle along with the shapes. It finishes on a freshly reloaded page building a
single shape the old way, to show the default path is untouched.

```
docker run --rm --ipc=host \
  -v /srv/ichabod/apps/cad/tools:/tools:ro \
  -v /srv/ichabod/apps/cad/proof:/proof \
  -v /srv/ichabod/apps/cad/.verify/node_modules:/w/node_modules:ro \
  -e NODE_PATH=/w/node_modules \
  mcr.microsoft.com/playwright:v1.55.0-noble \
  node /tools/verify-mirror.js https://cad.ichabod-crane.net/
```

`tools/verify-autosave.js` proves the document survives the tab. It builds a
scene with every field off its default — all four kinds, one resized, one
lifted, one moved by a real pointer drag, Mirror on with a live pair — then
closes the tab, opens a new one in the same browser, and asserts the model
comes back identical id by id, twins included, with the Mirror button pressed
and the right shape still chosen. It then checks the restore is not inert: a
new shape gets ids that do not collide with the restored ones, and a restored
pair still resizes as a pair.

The other half of it is the ways autosave could make things worse rather than
better. A browser that has never seen the site still gets the empty plate and
the starting hint. And a saved document that has gone bad — unparseable, a
future schema version, unknown shape kinds, sizes and coordinates far outside
the legal range — is discarded or repaired rather than rendered, because
nobody should be able to brick a kid's toy by poking at `localStorage`, and a
schema change here later must degrade to an empty plate and not a blank page.

```
docker run --rm --ipc=host \
  -v /srv/ichabod/apps/cad/tools:/tools:ro \
  -v /srv/ichabod/apps/cad/proof:/proof \
  -v /srv/ichabod/apps/cad/.verify/node_modules:/w/node_modules:ro \
  -e NODE_PATH=/w/node_modules \
  mcr.microsoft.com/playwright:v1.55.0-noble \
  node /tools/verify-autosave.js https://cad.ichabod-crane.net/
```

`tools/verify-tour.js` checks the guided first minute in fresh desktop and narrow browser profiles: each step highlights a real create, delete, undo, or orbit control; completion and Skip dismiss it; and it stays dismissed after a reload in the same profile.

One consequence worth knowing when you read the older two: a reload no longer
clears the plate, so both of them now clear `localStorage` explicitly where
they want a clean one. If you write a new check that assumes a fresh page is an
empty page, it will fail, and it will be the check that is wrong.

There is no browser on the host, and that image ships browsers but not the npm
package — hence `playwright-core@1.55.0` installed into `.verify/` and mounted,
and `NODE_PATH` set, because Node resolves modules from the script's directory
rather than the working directory.

One trap, paid for twice: do not aim a verifier's drag at a shape by screen
offset when the plate is busy. A new shape can land in a far corner, behind
something else from where the camera sits, and the press grabs whatever is in
front of it — so the shape under test never moves and the failure reads like a
bug in the app. Aim at a named cell with `screenOfCell`, on a plate you control.

Last run: **verify.js 60 passed / 0 failed, verify-mirror.js 68 passed / 0 failed, verify-autosave.js 32 passed / 0 failed, verify-tour.js 25 passed / 0 failed, copy-check.js 50 passed / 0 failed.**

## Deploying

```
docker compose build && docker compose up -d
```

Traefik routes `cad.ichabod-crane.net` to it over the external `ichabod-proxy`
network. `cpus: "0.50"`, `mem_limit: 512m`, `pids_limit: 256`.
