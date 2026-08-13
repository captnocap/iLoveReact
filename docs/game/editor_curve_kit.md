# Editor curve kit

Active surface: `cart/editor/` and its `/play` route. Last verified: 2026-08-12.

## In one sentence

`cart/editor/data/curves.ts` turns the curves of everyday objects — arcs,
conics, superellipses, splines, catenaries, clothoids, helixes, spirals, eggs —
into pure param→points helpers, and five File → New Mesh kinds (Vessel, Arch,
Spring, Egg, Tray) lathe/extrude those samples into authored parts through two
loft stitchers in `editMesh.ts`.

## The kit contract (req_4319)

Every helper is a pure function: parameters in, sampled points out — `Vec2[]`
profiles, `Vec3[]` paths, or `Vec3[][]` ring stacks. There are no resident curve
objects and no NURBS; outputs are arc-length spaced by default so lofted quads
come out uniform. Three researched decisions are hard-coded: `curveThrough` is
centripetal Catmull-Rom (the only cusp-proof member of the family),
`polyRound` clamps every fillet radius to the room its segments give it, and
curve OFFSETTING is deliberately absent (exact offsets are degree-10 and grow
cusps; offset the sampled polyline instead). Full provenance: the 10-angle
research run `research_runs/2026-08-12__everyday-curves-modeling-algorithms/`.

## The UI path (req_4322)

`PRIMITIVE_MESHES` (data/commands.ts) drives File → New Mesh and Edit → Mesh →
Add Primitive from ONE list; the five curve kinds appended there flow through
the same registry-driven pipeline as cube/cylinder: `PRIMITIVE_FIELDS`
(assetCatalog.ts) describes each kind's dialog knobs (NewMeshDialog needs no
per-kind code), `primitiveParamsFromU` converts u → meters key-list-driven, and
`primitiveEditMesh` maps params onto curve samples + a stitcher:

- **Vessel** — mouth/belly/foot diameters + height → three potter's stations →
  `vesselProfile` → `revolveRings` → `ringLoft`. Solid, both ends capped.
- **Arch** — span/rise/depth; the RISE picks the mason's strike (under span/2
  segmental, at span/2 semicircular, above it two-centered gothic) →
  `arch` outline → `outlinePrism`.
- **Spring** — coil ⌀, height, turns, wire ⌀ → `helix` path + circular section →
  `sweepRings` (rotation-minimizing frames) → `ringLoft`.
- **Egg** — length/breadth/tip-shift → `eggProfile` (Hügelschäffer, radius 0 at
  both poles) → `revolveRings`; closes without caps.
- **Tray** — size/thickness/roundness (superellipse exponent 2–8) →
  `superellipse` outline → `outlinePrism`, rotated flat.

The stitchers (`ringLoft`, `outlinePrism` in model/editMesh.ts) wall rings with
quads, collapse pole rings to fans, cap open ends as single authored n-gons
(the cylinder-cap convention, req_3763), and normalize winding by whole-mesh
signed volume — one global test, so concave profiles (a vase neck) orient
correctly where per-face center tests would not. Parts are named from the
registry at creation ("Vessel 1"), same as every primitive (V33 naming law).

## The pen path (req_4324) — pick the points yourself

The mesh pen tools (Path Plane, Pen Edges — and the paint Pen fill) gained
CURVE MODES: the pen kit (runtime/paint/PenPathOverlay) stays curve-agnostic
via an optional `curveModes` prop, and the editor passes interpretations built
on the curve kit (`stage/penCurveModes.ts`). Your clicks become control points;
preview and commit run the SAME interpret so they can never disagree:

- **PEN** — today's behavior: sharp corners, drag for Bézier handles.
- **SMOOTH** — centripetal spline through every click, open or closed.
- **ARC** — clicks consumed as a-b-c triples, each struck as a circular arc
  through all three (arc3pt, chained; three clicks IS one arc; a leftover
  click continues straight).
- **HANG** — first and last clicks are endpoints, a middle click sets the
  catenary sag; a click above the chord flips it into an arch.

Interpreted output flows through the existing meshAppendPathPlane /
meshAppendPathEdges doors under the pen's shared 64-point budget
(`capPenPoints`); in curve modes clicks place sharp control points and drags
reposition them (handle-minting stays a plain-pen behavior).

## Curve Pull (req_4325/req_4326) — bend live topology by dragging

The native answer to "select 3 vertices and pull": arm **Curve Pull** (Edit menu
/ model context menu, a Move-gizmo modifier, not a modal session), select one
run of vertices (two anchors and everything between — 3 selected verts is the
minimal case), and drag the move gizmo. The run bends through a circular arc:
endpoints hold as anchors, the grabbed middle vertex follows the drag exactly,
and every vertex between lands on the arc at its own original arc-length
station. Host-native per the Zig-first law:

- `framework/gpu/mesh_edit.zig` — `curvePullBegin/Apply/End`: validates the
  selection is ONE open path (the Align Loop path law; loops and branches
  refuse), orders it by walking the selected authored edges, solves the 3D
  circumcircle per frame from grab-time base + offset (ABSOLUTE application —
  a wandering drag can never compound), warps stations so the grabbed vertex
  sits exactly under the cursor, and lands mirror twins + welded corners
  through the same `syncTransformedVerts` tail every rigid tool uses.
  Collinear pulls degrade to a tent falloff instead of erupting.
- `framework/gpu/3d.zig` — the arm flag + Move-drag branch (stepped readout
  shows "bend ±N.NNu"; armed with an invalid selection the drag falls back to
  plain move and the readout says why); release always drops the captured run;
  one journal entry per pull like every gizmo drag.
- `__mesh_curve_pull_arm(on)` door; TS toggle rides the standard tool pipeline
  (`mesh-curve-pull` command row, ModelToolApi.curvePull, snapshot flag).

Auto loop-cut densification (cuts inserted when the run is too coarse to show
the bend) is the OPEN follow-up — v1 bends the vertices you selected; loop-cut
the band first for deeper curves.

## Tests

`data/curves.test.ts` (38 behaviors: interpolation exactness, sag accuracy,
clothoid-at-constant-curvature-is-a-circle, frame transport, the bowl pipeline)
and `data/assetCatalog.primitives.test.ts` (11: registry/menu/icon alignment,
u-conversion coverage, every kind finite + grounded + positive-volume closed,
per-kind shape behaviors). Both bundle via `tools/esbuild` with the `@reactjit`
aliases and run under `tools/v8cli`; the game verify runner discovers them.

## Usage reference

The published artifact "Curve Kit" documents every helper with figures drawn by
the shipped code: https://claude.ai/code/artifact/756043af-ffbb-42d1-adef-62fa0da167ad
