# Thesis — One Semantic Wall, Many Derived Consequences

## The change

Replace fixed 3 m wall-variant placements with one persisted semantic wall model:

- a wall is a stable directed edge between two stable floor-local vertices;
- structural placement uses the existing three-axis `16 u = 1 m` lattice;
- wall height, thickness, profile, style, and side-A/side-B materials are edge properties;
- doors, windows, arches, and related cutouts are mutable kit-sized cell masks on that edge;
- junctions, half-edges, faces/rooms, miters, render bands, colliders, cover, sound blockers, portals, navigation openings, and bake dirtiness are deterministic compiler products;
- shipped runtime data contains frozen/content-addressed products, never an editor-time wall generator.

This follows the valuable part of the supplied Sims-style research—the planar architectural graph and mutable openings—without binding the implementation to unverified franchise internals such as a particular stencil technique or a persisted DCEL.

## Persist facts; derive topology

The persisted source document is an extensible `ArchitectureSource` root. Version 1 contains the wall family: stable `WallVertex` and `WallEdge` records plus their `WallOpening` children. Later source versions add first-class floor-slab, vertical-link, and top-roof families without replacing the document, command journal, host wire, or compiler boundary. It does **not** persist `next`, `prev`, `twin`, face membership, tessellated mesh vertices, collider boxes, or room polygons as co-equal truths.

The native wall compiler rebuilds a normalized planar graph and DCEL from those facts. This is essential because stored adjacency becomes stale the instant an edge is split or deleted. A single deterministic derivation also prevents the current editor/compile divergence where visible wall bands, collision, and door records can be computed by separate paths.

## Proposed source contract

Names are illustrative but the responsibilities are fixed:

```ts
type ArchitectureSource = {
  version: 1;
  revision: number;
  walls: WallSource;
};

type WallSource = {
  vertices: WallVertex[];
  edges: WallEdge[];
  anchors: WallAnchor[];
};

type WallVertex = {
  id: string;
  floor: number;
  xU: number;
  zU: number;
};

type WallEdge = {
  id: string;
  startVertexId: string; // direction is stable for material/facing semantics
  endVertexId: string;
  support: { kind: 'absolute'; baseYU: number }; // v1; slab joins arrive with slabs
  heightU: number;
  thicknessU: number;
  profile: 'full' | 'half';
  styleId: string;
  sideA: WallSideFinish;
  sideB: WallSideFinish;
  openings: WallOpening[];
};

type WallOpening = {
  id: string;
  kind: 'door' | 'window' | 'doubleWindow' | 'brokenWindow'
      | 'garageDoor' | 'slidingDoor' | 'arch';
  kitId: string;
  columnU: number; // from the stable start vertex on its local surface grid
  rowU: number;    // upward from the resolved wall base
  facingSide: 'a' | 'b';
  hinge: 'start' | 'end' | 'none';
};
```

`WallEdit` remains the public semantic vocabulary required by V24. At the source boundary, `halfHeight` lowers to the wall profile and opening-valued edits lower to `WallOpening.kind`; `solid` means no opening. This removes the accidental one-edit-per-module restriction without discarding the decision’s gameplay language.

Authored structural coordinates and dimensions are signed integer `u`, with the
existing Studio contract `16 u = 1 tile = 1 meter`. The same lattice applies to X,
Y, and Z. Integer millimeters are not a valid source representation because one unit
is 62.5 mm. Segment predicates use widened integer arithmetic; derived rendering
converts to meters only at output boundaries. Arbitrary wall angles come from joining
any two lattice points, not from float persistence.

Each wall owns a local integer `(columnU, rowU)` surface grid. Opening dimensions and
clearance masks live only in the installed opening-kit catalog; an opening instance stores
the kit and its integer anchor. Studio export measures each kit's visible semantic mount
envelope, rounds outward to the smallest containing lattice cells, validates it, and
publishes the resulting catalog entry. Placement is exact mask/interval occupancy, and the
same native `openingSlots(edgeId, kitId)` query serves hand placement, prefabs, and
procedural generation. A mesh AABB never decides what fits.

Architecture-kit export writes a typed manifest declaration with family, role,
semantic kind, category path, theme/gameplay tags, measurement, pivot, clearance mask,
and asset references. Human-readable IDs may mirror paths such as
`build:wall:opening:door:<slug>`, but behavior queries explicit fields rather than
parsing names. Hierarchical palette organization and procedural selection are two
views of the same installed catalog. The full contract is
`contracts/build_catalog.md`.

Version 1 walls use an explicit absolute base. When floor slabs join the architecture
root, wall support expands to `{ slabId, join: 'on-top' | 'at-edge' }`. `on-top`
resolves to slab top and `at-edge` resolves to slab bottom. No compiler or UI path may
scan overlapping slabs and choose for the wall. Storey datums advance by an exact
floor-to-floor unit count; slab thickness is not added again, so storeys cannot drift.
The full invariant and formulas are locked in
`contracts/architecture_lattice.md`.

All behavioral dimensions live in named native tuning/catalog tables: 16 units per
meter, minimum wall length, exact endpoint snap policy, opening masks/clearance cells,
height bounds, miter limit, bevel fallback, and output quantization. Screen-space
magnet radius is interaction tuning and resolves to an explicit target ID; it is not a
world-space weld tolerance. No interaction or geometry constant is buried in UI code.

## Mutation contract

Every structural edit is one command over one source revision. The native authority returns either a typed rejection or a complete mutation receipt containing:

- created, updated, and removed vertices/edges/openings;
- old-to-new edge remaps produced by intersection splitting;
- opening and wall-anchor remaps after a split;
- predecessor/successor lineage for derived wall-face boundary signatures;
- the affected floor bounds and semantic dirty targets;
- the resulting source revision/hash.

The application layer applies the receipt atomically and records its inverse. React never hand-edits half-edge pointers, redistributes openings, or guesses which derived outputs are dirty.

Drawing a wall snaps endpoints to integer architecture units, exactly reuses coincident
vertices, inserts valid segment intersections, splits crossed edges, rejects
zero-length/overlapping invalid geometry, and preserves edge orientation. Inserting an
opening ray-picks a wall side, selects an integer wall-surface anchor, expands the
catalog kit's occupied/clearance masks, and validates them before committing.

## Geometry strategy

The first production slice uses straight wall spans at arbitrary angles. Curves remain a later semantic spline type; authored curves will not be persisted as a bag of micro-edges.

For live editing and frozen compilation, the compiler subtracts sorted opening intervals from each wall face and emits deterministic rectangular bands plus jamb/sill/header/cap surfaces. Existing live box ingress can carry the initial output because it already preserves render/collider parity. A compact generated wall mesh packet can replace boxes later if profiling proves the instance count is material.

Junctions use offset-line intersection with a named miter limit and bevel/end-cap fallback. The singular formula from the research is not adopted unchecked near parallel or reflex angles.

Shader stencil cutouts are explicitly not the first implementation. They hide pixels but do not themselves produce correct thickness, jambs, picking, collision, portal, or bake data. A future renderer optimization may consume the same semantic opening records without changing authoring state.

## Room and gameplay strategy

The compiler angularly sorts directed edges, builds twins, traverses face cycles, rejects degenerate cycles, and classifies bounded faces by signed area and containment. Room faces are derived artifacts with deterministic signatures; the infinite exterior is explicit.

Gameplay room markers remain a separate semantic family under V24. They annotate detected faces; they do not create enclosure. The active editor has no conforming `WorldMarker` authority today, so this wall refactor exposes exact boundary signatures and deterministic overlap lineage for that separate lane but does not smuggle room roles into wall records or repurpose `WorldObject`. A future marker reconciliation command must surface ambiguous splits/merges rather than silently assigning gameplay meaning to the wrong room.

Doors and arches derive navigation portals, collision gaps, sound/visibility behavior, and door records from the same kit-sized `WallOpening` record used to generate visible geometry. Side-specific materials live on the stable directed edge and lower to derived half-edges. Wall-mounted props later attach by `{ edgeId, side, columnU, rowU }` and use the same split-remap receipt.

## What remains unchanged

- Floors, roofs, stairs, props, flora, zones, and terrain remain on their current source models during the wall migration; new semantic walls never participate in legacy automatic wall lifting.
- The Studio model pipeline remains the way to author reusable art, measured door/window kits, wall styles, trim, and special props. Export installs catalog assets consumed by structural mutation; it never exports a whole static wall as structural authority.
- `WorldSave` remains the authored document family and keeps atomic/debounced save behavior; it advances through a versioned migration.
- Creative Build and Sims Plan Build remain views/tools over one architecture document.
- Live editor generation remains allowed, but package/install compilation freezes outputs according to V29.
- Existing mapfile/gamefile render, collider, door, room/portal, navigation, and audio consumers remain the shipped-runtime destinations.

## Explicit first-slice boundary

The initial release includes straight spans between 1/16 m lattice points, arbitrary
angles, T/X intersections, closed-room detection, side materials, full/half profiles,
multiple kit-sized doors/windows/arches per edge, exact slot enumeration, move/delete
of openings, measured architecture-kit export/install, hierarchical palette/query,
edge/vertex deletion, prefab capture/stamp, legacy v4 migration, live render/collision
parity, and frozen bake output.

The initial release does not include floor-slab authoring, vertical-link authoring, top-roof authoring, Bézier walls, continuous thickness handles, camera-stepped cutaway, structural destruction simulation, new WorldMarker authoring UI, or automatic reassignment of room gameplay roles. Those building families follow the sequence in `BUILDING_ENVELOPE_SEQUENCE.md` and extend the same architecture root/compiler; none may add a parallel building representation.

## Done standard

The refactor is done only when all of the following are true:

1. A user can draw a wall span, leave the tool, return, and add/move/delete multiple compatible openings without replacing or exporting the wall.
2. Crossings and endpoint joins produce one normalized graph transaction with stable remaps, no duplicate coincident edges, and deterministic room faces.
3. The same source revision drives preview geometry, collision, door/portal records, side materials, room detection, compile dirtying, and frozen output.
4. Saving/reloading and undo/redo preserve wall IDs, openings, side orientation, and topology. A v4 world migrates deterministically and saves as the new version.
5. Connected wall graphs round-trip through prefab capture/stamp without importing previous-era code.
6. Static door/window wall catalog variants are absent from the primary build palette and no longer participate in structural placement or edge-slot replacement.
7. Native unit tests prove normalization, face traversal, interval validation, split remapping, geometry/collider parity, and deterministic hashes. TS tests prove command, persistence, prefab, and UI-adapter contracts.
8. A `ReleaseFast` editor build passes. A clean frozen-world build passes after legacy structural paths are severed.
9. Spikewatch stays silent for at least 60 seconds of representative wall drawing, opening dragging, and `/play` traversal.
10. The user confirms the exact visual/interaction checklist: junctions have no visible holes, openings reveal real voids and jambs, side materials stay on the chosen side, room boundaries update, and doors route correctly in `/play`.
11. Architecture source round-trips integer `u` without millimeter conversion; the same unit governs horizontal placement, wall height, opening rows, slab elevation, and vertical links.
12. Procedural and interactive opening placement receive the same ordered valid slots for every wall/kit pair.
13. No wall base is inferred from overlapping geometry; absolute, `on-top`, and `at-edge` supports obey their exact formulas, and ten duplicated storeys accumulate zero slab-thickness drift.
14. Every opening footprint is derived by outward rounding its recorded Studio mount measurement; no plan/UI tuning constant invents a door or window size.
15. The hierarchical palette and procedural query see the same typed architecture-kit entries, and changing a category path cannot change behavior or invalidate source references.
