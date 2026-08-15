# Building Pipeline Sequence — Walls → Slabs → Vertical Links → Top Roofs

## Sequence thesis

Walls are the first family, not a standalone subsystem. They establish the versioned `ArchitectureSource`, command/receipt journal, fixed-point planar predicates, sectioned host wire, `ArchitectureCompileBundle`, live reconciliation, content-addressed freeze, and severance discipline.

Floor slabs extend those boundaries next. A slab’s top is the walkable floor of its own storey and its underside is the ceiling/cover of the storey below. Stairs, ramps, and elevators follow immediately because placing a vertical link must mutate every slab it crosses. A weather roof then caps only the topmost storey; intermediate storeys use the next slab, never stacked roof pieces.

This keeps the V24 rule intact: wall, floor, ramp/stairs, elevator, and roof are semantic pieces; the 1 m grid is their snap/gameplay substrate, not their object model. Every structural family shares the existing `16 u = 1 m` authoring lattice on X, Y, and Z as locked in `contracts/architecture_lattice.md`.

Reusable art enters through the measured, hierarchical architecture-kit catalog in
`contracts/build_catalog.md`. Wall styles, doors, windows, trims, floor finishes,
stair/rail kits, elevator parts, and roof skins remain organized/queryable catalog
assets; semantic wall/slab/link/roof records remain the structural source.

## 1. Wall foundation

The wall execution plan establishes:

- `building_architecture.zig` as the public native facade;
- `ArchitectureSource { version, revision, walls }` as the first document version;
- a host wire and compile bundle sectioned by architecture family/target;
- focused `wall_*` topology, mutation, geometry, and migration modules;
- stable wall-face boundary signatures and predecessor/successor lineage for later slab and roof bindings.
- integer wall-surface occupancy and native opening-kit slot enumeration for later procedural building generation;
- explicit absolute wall bases with no participation in legacy highest-overlapping-floor lifting.

The wall deliverable stays bounded: editable spans/openings, detected rooms, one derived gameplay/render pipeline, v4 migration, and complete removal of fixed wall variants. Slab, vertical-link, and roof records are not smuggled into the wall slice.

## 2. Dual-sided floor slabs

### Interim ruled lane: derived enclosure floors (req_4482, 2026-08-15)

Before this slab phase begins, the engine already floors every enclosed room:
each interior topology face compiles to a derived plate (`floor_geometry.zig`,
floor-family bundle section) — 1 u thick, rising from the lowest boundary wall
base, courtyard holes kept open. USER RULING: these floors are DERIVED, never
authored — "the floor has to react with it" when walls move, reshape, or are
deleted, and "the user will still end up with an actual floor tool but this is
to quickly solve for enclosed shapes." When the authored `FloorSlab` family
below lands, an authored slab should supersede the derived plate for its room;
do not migrate derived plates into records — they are compiler output.

### Current problem

The active editor treats a floor as a rectangular drag-fill of independent 3 m plate pieces. Each plate has its own transform and replacement slot. There is no durable boundary, shared vertex, hole, stair/atrium cutout, room binding, ceiling identity, or one surface spanning a storey. A staircase currently remains on top of an uncut plate. The previous-era 3×3 micro-grid preserved useful 1 m gameplay surface meaning, but tying that field to a 3 m authored module conflicts with V24’s “grid is substrate” rule.

### Target source

```ts
type FloorSlab = {
  id: string;
  storeyId: string;
  boundary:
    | { mode: 'free'; rings: ArchitectureRing[] }
    | { mode: 'room-face'; faceSignature: string };
  thicknessU: number;
  styleId: string;
  floorFinish: SurfaceFinish;
  ceilingFinish: SurfaceFinish;
  edgeFinish: SurfaceFinish;
  cutouts: SlabCutout[];
  cellOverrides: SparseSurfaceCell[];
};

type Storey = {
  id: string;
  ordinal: number;
  walkPlaneU: number;
  floorToFloorU: number;
};

type SlabCutout = {
  id: string;
  boundary: ArchitectureRing;
  owner: { kind: 'manual' } | { kind: 'vertical-link'; linkId: string };
};
```

`SparseSurfaceCell` retains authored 1 m (`16 x 16 u`) tile-kind intent for
navigation/material/gameplay without turning every cell into a floor object.
Slab rings and cutouts retain 1 u outline resolution. `SlabCutout.owner` prevents a
staircase/elevator void and its link from drifting into independent sources of truth.

### Storey meaning

- `Storey.walkPlaneU` is the one vertical datum for the storey; its attached slab top is that exact value and the slab extrudes downward by `thicknessU`.
- The same slab underside closes the room/ceiling volume immediately below.
- A multi-storey building repeats wall volume → upper slab; it does not place a roof at each level.
- The topmost occupied storey receives a weather roof only when authored; an open roof deck may intentionally stop at a slab.
- Room volumes compile vertically between a lower walkable surface and the next slab underside or the top roof underside.
- Duplicating a storey adds `floorToFloorU` to the datum. It never adds slab thickness separately.

### Wall/slab attachment law

A wall does not discover support from overlap. Its support is either an absolute base
or one named slab plus exactly one join mode:

- `on-top`: wall base = slab top / storey walk plane;
- `at-edge`: wall base = slab bottom, so the slab thickness band meets the wall side.

The command UI exposes these as separate choices and records the choice in source.
Creating a nearby floor never changes an absolute wall. Moving/deleting a referenced
slab updates or rejects all dependents in the same mutation receipt. A missing slab
reference is an error; there is no nearest/highest-floor fallback. Standard wall caps
bind to an explicit height or a named upper slab underside.

Floor severance deletes structural use of `liftedWallBaseY`,
`liftWallsOntoFloors`, `WALL_REST_MAX_RISE_METERS`, and the overlap scan in
`framework/game/build.zig`. No replacement helper may infer one join mode from scene
geometry.

### Wall compatibility

- “Fill Room” creates a first-class slab bound to a detected wall face; it does not make every enclosed room grow a slab automatically.
- A bound slab resolves its boundary from the current face signature. Wall mutation receipts expose face lineage, so one unambiguous successor updates the binding in the same architecture transaction.
- A split/merge with multiple successors yields a dependency diagnostic; it never guesses which region owns the slab.
- “Detach Boundary” materializes the resolved rings, after which wall edits do not move the slab.
- Free slabs can cross rooms and form balconies, bridges, landings, courtyards, mezzanines, and roof decks.
- Walls remain legal without slabs, and rooms can remain open to terrain or sky.

### Derived outputs

One native `floor_*` family performs polygon validation, hole containment, deterministic triangulation, slab extrusion, floor/ceiling/edge material roles, collider surfaces, walkable navigation cells, lower-storey ceiling closure, sound/visibility separation, selection proxies, affected-target hashes, and frozen output. Live and shipped worlds consume the same facts.

### Migration and severance

Compatible adjacent 3 m plates coalesce into maximal slabs by
storey/datum/style/finish. Their nine-cell semantic fields map into each slab’s sparse
1 m surface field. Legacy wall/floor relationships are migrated only when the saved
placement proves one exact join; ambiguous cases produce diagnostics and preserve the
original file. Incompatible overlaps become separate slabs or explicit diagnostics.
After parity, floor use is removed from `resolveRunPlacements`, `placementSlotKey`,
`pieceVisualShapes`, ordinary `pieceInstanceRows`, and the fixed-piece palette.

Slab completion means a user can fill a room, draw a free deck, cut a manual atrium, paint floor and ceiling independently, mutate surrounding walls, save/reload, prefab/stamp, compile, and traverse the result with preview/frozen parity.

## 3. Vertical-link assemblies

### Current problem

Active stairs are fixed catalog models/box steps with a fixed high edge. The author must anticipate the exit direction while modeling rather than choosing it when placing. Active ramps share the same fixed-footprint assumption. Active elevators are independent 3×3 frame pieces; they do not cut slabs, and the editor has no stable shaft/stop record. Previous-era code recovered elevator shafts by scanning float-aligned stacked pieces after placement.

### Target source

```ts
type VerticalLink = {
  id: string;
  kind: 'straight-stair' | 'l-stair' | 'u-stair' | 'spiral-stair'
      | 'ramp' | 'elevator';
  bottomElevationU: number;
  topElevationU: number;
  footprint: ArchitectureRing;
  clearanceEnvelope: ArchitectureVolume;
  entry: LandingAnchor;
  exit: LandingAnchor;
  styleId: string;
  parameters: VerticalLinkParameters;
  servedSlabIds: string[];
};
```

The link is first-class and never a prefab. Catalog/style assets supply materials, rails, car/door kits, and visual vocabulary; gameplay meaning, landings, clearance, served levels, and cutouts live on the semantic link.

### Atomic placement law

Placing or editing a vertical link is one architecture command that:

1. validates entry/exit landing support and head/body clearance;
2. identifies every crossed `FloorSlab`;
3. creates or resizes link-owned `SlabCutout` records on those slabs;
4. rejects intersections with protected structure or incompatible cutouts;
5. compiles the path/heightfield, rail/guard geometry, collision, navigation portal, cover, sound/visibility opening, pick proxies, and frozen outputs;
6. removes/remaps its owned cutouts when moved, resized, reoriented, or deleted.

No UI or model-export path independently punches a floor.

### Spiral staircase placement

A spiral stair is parametric editor/compiler source, not a fixed mesh whose exit was chosen in Studio:

```ts
type SpiralStairParameters = {
  centerU: ArchitecturePoint;
  innerRadiusU: number;
  outerRadiusU: number;
  startAngleMilliDegrees: number;
  turnMilliDegrees: number;
  handedness: 'clockwise' | 'counterclockwise';
  treadCount: number;
};
```

The user places the center/entry, drags or rotates the desired exit, chooses handedness/radius when wanted, and the editor derives rise, tread transforms, rail path, landing anchors, circular clearance, and slab cutouts. The resulting mesh/instances are baked as content-addressed output; `/play` does not generate staircase geometry.

Straight, L, and U stairs use the same entry/exit/clearance contract with family-specific parameters. A custom Studio stair kit must publish semantic tread/rail/landing roles, but it cannot override the structural path or cutout contract.

### Elevator assembly

The elevator remains the ruled first-class vertical-link piece, never a prefab. The stacking UX becomes mutation of one stable shaft:

- placing the first segment creates a shaft/link record;
- placing an aligned segment above/below extends that record and adds a stop instead of leaving a second unrelated piece;
- selecting the shaft exposes add/remove stop and extend handles, with the world remaining the configuration rather than a required floor-count dialog;
- the shaft footprint cuts every crossed slab; served stops additionally receive landing/door clearance;
- the compiler derives shaft walls, stop doors, car path, live-car collision identity, navigation transitions, room/visibility/audio separation, and frozen elevator rows;
- deleting a stop repairs only its landing contract; shortening/deleting the shaft removes now-unowned slab cutouts atomically.

This preserves the useful previous behavior—one car and stops authored by the built world—without float-position scanning or uncut floors.

### Vertical-link completion

Completion means a spiral stair can be placed anywhere a valid footprint/clearance exists and can choose its exit during placement; all stair/ramp variants cut and restore slabs correctly; elevator segments extend one shaft with correct stops/cutouts; preview geometry, collision, nav, room closure, save/reload, undo/redo, prefabs, frozen output, and `/play` agree.

## 4. Correct top-roof pipeline

### Current problem

The active roof is a catalog box. Shed roofs are one ramp, gables are two ramps, and “gable ends” are rectangular boxes. Active persisted pieces cannot carry native `roofSpan`; arbitrary footprints, concave corners, hips, valleys, holes, overhangs, fascia, soffits, and correct collision do not exist. Profile names and pitch affect an approximation, not roof topology.

### Target source

```ts
type RoofRegion = {
  id: string;
  topFloor: number;
  eaveElevationU: number;
  footprint:
    | { mode: 'free'; rings: ArchitectureRing[] }
    | { mode: 'top-envelope'; boundarySignature: string };
  profile: 'flat' | 'shed' | 'gable' | 'hip' | 'pyramid';
  pitchRisePer1000: number;
  ridgeRule: RoofRidgeRule;
  overhangU: number;
  thicknessU: number;
  styleId: string;
  topFinish: SurfaceFinish;
  undersideFinish: SurfaceFinish;
  edgeFinish: SurfaceFinish;
  openings: RoofOpening[];
};
```

A top-envelope binding targets the highest compatible wall/slab envelope selected for that structure. Adding a storey invalidates or deliberately moves that binding through an architecture command; it never leaves a weather roof trapped between storeys. “Detach Footprint” materializes free rings. An open roof deck may deliberately have no roof record.

### Correct native solver

- Flat roofs triangulate/extrude footprints and holes directly.
- Shed roofs evaluate one height plane from an authored fall direction.
- Gable roofs use an authored/derived ridge direction and real plane/end intersections.
- Hip and pyramid roofs use a deterministic fixed-point straight-skeleton/offset-wavefront solver, producing ridges, hips, and valleys for convex and concave footprints.
- Overhang is a tuning-owned polygon offset; invalid collapse produces a diagnostic.
- Roof openings clip planes and generate curbs/reveals rather than hiding fragments.
- Fascia, soffit, ridge caps, valleys, underside, UVs, material roles, collision, walkable slopes/nav, rain cover, top-room closure, visibility/audio, and pick proxies derive from one roof plane graph.

The roof plane graph is cache data. Persisting generated ridges, triangles, or ramp boxes as source would recreate the wall/DCEL failure.

### Migration and severance

Legacy flat/shed/gable rows coalesce by compatible topmost footprint/profile/pitch/style. Intermediate roof rows beneath authored upper storeys become migration conflicts; they are not silently reclassified as floors. The old `roofProfile(pieceId)`, ramp-box generation, rectangular gable-end approximation, `RoofSpan`, fixed roof catalog placement, and static roof instance path are deleted in the roof severance build.

Roof completion means only topmost envelopes receive weather roofs, arbitrary footprints produce correct planes/junctions, adding/removing a storey handles bindings explicitly, overhang/material/opening edits round-trip, collision/nav/top-room closure agree with visuals, frozen hashes are deterministic, and `/play` generates no roof geometry.

## Shared architecture kernels

Slabs and roofs reuse a native polygon layer extracted after wall predicates are proven:

- integer `u` points and widened predicates;
- canonical rings, winding, containment, holes, and boundary signatures;
- deterministic triangulation;
- polygon clipping/offset operations;
- lineage and dependency diagnostics;
- target hashing and affected-bounds indexing.

Vertical links reuse slab cutout and volume-clearance boundaries, while keeping family-specific path/geometry solvers. Wall DCEL traversal, slab triangulation, stair generation, elevator behavior, and roof straight-skeleton construction remain focused modules; the shared architecture facade does not become a geometry mega-module.

## Remaining build grammar fit

After the envelope/vertical core, the same semantic rules apply to the rest of Build Mode:

| Family | Correct source shape |
| --- | --- |
| Pillars/columns | vertical structural axis + section/profile + level span; slab intersections derive, not overlap blindly |
| Fences/railings | mutable edge paths with posts/panels derived by spacing; stair/roof paths can supply support curves |
| Trim/fascia/baseboards | decorators bound to stable wall/slab/roof edges with lineage remaps |
| Arches | wall openings/kits, not a parallel wall-kind placement path |
| Signs and wall props | semantic surface anchors with edge/face remaps |
| Prefabs | named compositions of these source families that decompose through normal mutation commands |

The catalog groups each row below its structural family and role, then permits further
category folders and tags without adding semantic kinds. Procedural builders query the
same typed catalog rows the palette displays, so installing a measured
door/window/style asset makes it discoverable to hand authoring and generation in the
same operation.

Each family receives its own inventory-through-severance plan. None returns to fixed exported geometry as structural authority.

## Order gates

1. Wall migration reaches Phase 7 severance with the general facade/wire/bundle and face-lineage facts in place.
2. Floor slabs receive their own inventory-through-severance refactor and establish dual floor/ceiling surfaces plus owned cutouts.
3. Vertical links receive their own inventory-through-severance refactor; stairs/ramps and elevator use the slab mutation contract before roof source work begins.
4. Top roofs receive their own inventory-through-severance refactor after slab polygons, holes, elevation, material roles, and vertical clearances are proven.
5. Remaining build families migrate through the same architecture source/command/compile/freeze boundaries.
6. Plan Build and Creative Build edit identical architecture families throughout; neither receives a private floorplan, shaft, stair, or roof representation.
7. Every family consumes `contracts/architecture_lattice.md`; no family introduces a meter, millimeter, float-snap, or overlap-derived vertical authority beside it.
