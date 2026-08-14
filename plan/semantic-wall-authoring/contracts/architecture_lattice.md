# Architecture Lattice and Attachment Contract

## Canonical unit

The authored building unit is `u`:

- `16 u = 1 tile = 1 meter`;
- `1 u = 0.0625 m = 6.25 cm`;
- persisted structural coordinates, dimensions, opening footprints, slab thicknesses,
  storey datums, and vertical-link clearances are signed integers in `u`;
- meters are produced only at render, collision, navigation, and frozen-wire output
  boundaries.

This is the existing active Studio scale, not a new parallel grid.
`framework/gpu/stage_scale.zig` declares 16 modeling units per meter,
`framework/gpu/scene3d/gizmo.zig` draws 16 subdivisions per tile, and
`framework/gpu/scene3d/gizmo_drag.zig` uses `1/16 m` as the ordinary translation
step. The architecture implementation extracts that value into one game-owned scale
authority which the Studio scale and building compiler both consume.

Integer millimeters are forbidden as architecture source coordinates: one `u` is
62.5 mm and cannot be represented exactly by an integer millimeter. Floating-point
meters are likewise forbidden in persisted structural source.

## Lattice scope

The same `u` lattice applies on all three world axes:

```ts
type ArchitecturePoint3 = { xU: number; yU: number; zU: number };
type ArchitecturePoint2 = { xU: number; zU: number };
```

Wall endpoints, wall bases/tops, slab boundaries, slab top/bottom elevations, roof
footprints, opening rows/columns, landing anchors, stair rise/run, elevator stops,
and clearance volumes commit in whole `u` values. Arbitrary wall angles still exist:
an edge may connect any two lattice points. The lattice constrains authored handles,
not edge direction and not the semantic object model.

When two arbitrary-angle segments cross, the topology code evaluates the intersection
as an exact rational. It becomes a junction only when both coordinates resolve to
whole `u`; otherwise the draw preview returns `intersection_off_lattice` and commits
nothing. The editor may magnet the proposed endpoint to a valid existing vertex, but
the compiler never rounds a crossing and silently bends both walls.

Studio mesh editing retains its existing fine/free modifiers because a mesh is art,
not structural occupancy. V24 free placement remains available to non-structural
pieces. Structural architecture commands do not silently admit a float when a
modifier is held; adding a future off-lattice structural mode requires a distinct
source variant and compiler contract.

## Wall-surface occupancy

Every wall edge owns a two-dimensional integer surface grid:

- column `u` runs from the stable start vertex toward the stable end vertex;
- row `v` runs upward from the wall's resolved base;
- one cell is `1 u` wide by `1 u` high;
- the edge's usable column count is the number of complete `u` intervals that fit
  inside its geometric length;
- any terminal fractional remainder on an arbitrary-angle edge is margin, not an
  opening slot.

An opening kit owns its measured structural envelope and rules:

```ts
type OpeningKit = {
  id: string;
  kind: WallOpeningKind;
  widthU: number;
  heightU: number;
  occupiedMask?: readonly WallCell[];
  requiredClearMask: readonly WallCell[];
  permittedProfiles: readonly WallProfile[];
  permittedThicknessU: readonly number[];
  portalClass: PortalClass;
  assetId: string;
};

type WallOpening = {
  id: string;
  kitId: string;
  columnU: number;
  rowU: number;
  facingSide: 'a' | 'b';
  hinge: 'start' | 'end' | 'none';
};
```

The instance does not repeat `width`, `height`, sill, or clearance dimensions. Those
facts come from the selected kit. The kit dimensions are produced at Studio export by
measuring its authored mount envelope and rounding its minimum/maximum outward to the
smallest containing `u` cells. They are not guessed defaults. A differently sized door
is a different measured kit or an explicit measured size variant, never a dimension
invented at placement time.

Placement expands the measured kit masks at `(columnU, rowU)` and performs integer
set/interval tests against the wall boundary and existing occupants. The mesh may
contain casing or a moving leaf outside the void, so export records a visible semantic
mount envelope rather than blindly equating whole-mesh AABB with the cutout. The exact
measurement-to-footprint and catalog-install rules live in
`contracts/build_catalog.md`.

The native query `openingSlots(edgeId, kitId)` returns the complete ordered set of
valid integer anchors after boundary, end-clearance, sibling-mask, wall-profile, and
thickness checks. UI previews and procedural building generators consume that same
query. Neither path trial-places models, raycasts mesh bounds, or uses epsilon overlap
tests to discover whether a door fits.

## Storey datum and wall-slab joins

A storey owns one walk-plane datum in `u`. A slab attached to that storey resolves:

```text
slabTopU    = storey.walkPlaneU
slabBottomU = storey.walkPlaneU - slab.thicknessU
```

A wall never scans nearby geometry to choose its base. Its source contains exactly one
support variant:

```ts
type WallSupport =
  | { kind: 'absolute'; baseYU: number }
  | { kind: 'slab'; slabId: string; join: 'on-top' | 'at-edge' };
```

The formulas are exhaustive:

```text
absolute                  => wallBaseU = baseYU
slab + on-top             => wallBaseU = slabTopU
slab + at-edge            => wallBaseU = slabBottomU
```

`on-top` means the wall rests on the finished walk surface. `at-edge` means the slab's
thickness band meets the wall side and the wall continues down across that band. A
wall cannot carry both values. A missing/deleted slab reference is a typed source
error, not permission to search for another floor.

The wall cap is equally explicit: either `heightU` from the resolved base or a named
upper slab underside. Standard duplicated storeys use the upper slab underside, so
their clear height is derived once from two datums and one slab thickness. The next
storey datum is `current.walkPlaneU + storey.floorToFloorU`; slab thickness is never
added to that step. This prevents cumulative floor-thickness drift.

Creating a slab beside existing absolute walls does not move them. “Attach on top” and
“Attach at edge” are explicit architecture commands with one previewed result and one
undo receipt. Deleting or moving an attached slab must update or reject its dependent
walls in the same transaction.

The legacy `liftedWallBaseY` / highest-overlapping-plate scan has no equivalent in the
target architecture path and is removed when structural wall/floor placement is
severed from fixed pieces.

## Floor and vertical-link occupancy

Floor boundaries and cutout rings use integer `u` coordinates. Their sparse gameplay
surface field stays at one-meter cells (`16 x 16 u`) because that field describes tile
meaning; it does not constrain slab outline resolution.

Stairs, ramps, and elevators declare integer footprint and clearance masks. Their
atomic placement command subtracts those masks from every crossed slab and owns the
resulting cutouts. Stair treads, spiral exits, elevator stops, and wall openings at
landings therefore share one exact vertical/horizontal measure.

## Required proofs

Native tests must prove:

1. `16 u` converts to exactly `1 m` at every output boundary and source round-trips do
   not pass through integer millimeters.
2. X, Y, and Z placement use the same unit and reject non-integer structural values.
3. Opening kit masks enumerate identical valid slots for editor and procedural calls.
4. Two openings either occupy disjoint cells or return a typed collision; no epsilon
   controls the answer.
5. `on-top` and `at-edge` resolve to the two formulas above for the same slab.
6. Duplicating at least ten storeys produces exact datums with zero slab-thickness
   accumulation.
7. Adding, moving, or deleting unrelated slabs cannot change an absolute wall or a wall
   attached to a different slab.
8. No production architecture module calls or recreates `liftedWallBaseY`.
