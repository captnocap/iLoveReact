# World v4 Fixed-Wall Migration Contract

## Scope and atomicity

The v4 reader separates structural wall candidates from ordinary `pieces`. It sends
only the strict wall candidate rows to the native migration entry point. Success
returns one validated v1 `ArchitectureSource`, a legacy-to-source identity map, and
the untouched ordinary piece array. Any malformed or ambiguous wall candidate rejects
the entire migration and leaves the original v4 file write-protected.

Non-wall piece IDs, records, ordering, material data, prefabs, objects, zones,
facades, views, and world metadata are preserved byte-for-byte by the migration
projection unless their own existing v4 validator already canonicalizes them.

## The six legacy opening variants

Only these six fixed structural IDs receive opening aliases:

| Legacy piece ID | Source wall style | Opening kind | Migration kit ID |
| --- | --- | --- | --- |
| `wall.concrete.doorway` | `wall.concrete.common` | `door` | `legacy:v4:wall:opening:door` |
| `wall.concrete.openDoorway` | `wall.concrete.common` | `arch` | `legacy:v4:wall:opening:arch` |
| `wall.metal.garageDoor` | `wall.metal.industrial` | `garageDoor` | `legacy:v4:wall:opening:garage-door` |
| `wall.stucco.window` | `wall.stucco.suburb` | `window` | `legacy:v4:wall:opening:window` |
| `wall.stucco.doubleWindow` | `wall.stucco.suburb` | `doubleWindow` | `legacy:v4:wall:opening:double-window` |
| `wall.plywood.brokenWindow` | `wall.plywood.trap_lot` | `brokenWindow` | `legacy:v4:wall:opening:broken-window` |

These aliases exist only in the v4 decoder and native migration table. They never
appear in the v5 Build palette or installed architecture catalog projection.

## Exact meter-to-cell compatibility table

The legacy renderer's authoritative opening constants are captured, not generalized:

```text
wall module width                  3.0 m = 48 u
wall module height                 3.0 m = 48 u
window/double/broken height        1.2 m
window bottom                      3.0 * 0.55 - 1.2 / 2 = 1.05 m
window top                         2.25 m
door width                         1.0 m
door/arch height                   2.1 m
arch width                         1.4 m
garage width                       2.6 m
garage height                      2.4 m
```

Each legacy rectangle is centered on the 3 m module's local U axis, converted to
`u`, and rounded outward at minimum and maximum independently. The resulting immutable
migration kits and centered module-local anchors are:

| Kind | Exact legacy mount bounds `(minU,maxU,minV,maxV)` in `u` | Outward footprint | Centered columns in a 48-u module |
| --- | --- | --- | --- |
| `door` | `(-8, 8, 0, 33.6)` | `[-8,8) × [0,34)` = 16×34 cells | `[16,32)` |
| `arch` | `(-11.2, 11.2, 0, 33.6)` | `[-12,12) × [0,34)` = 24×34 cells | `[12,36)` |
| `garageDoor` | `(-20.8, 20.8, 0, 38.4)` | `[-21,21) × [0,39)` = 42×39 cells | `[3,45)` |
| `window` | `(-9.6, 9.6, 16.8, 36)` | `[-10,10) × [16,36)` = 20×20 cells | `[14,34)` |
| `doubleWindow` | `(-17.6, 17.6, 16.8, 36)` | `[-18,18) × [16,36)` = 36×20 cells | `[6,42)` |
| `brokenWindow` | `(-9.6, 9.6, 16.8, 36)` | `[-10,10) × [16,36)` = 20×20 cells | `[14,34)` |

The table is migration compatibility data only. It does not seed defaults for newly
exported doors/windows, and it never substitutes for Studio measurement. The old
whole-wall mesh depth `0.005 m` was a rendering shim and is not interpreted as
structural wall thickness; the migrated edge receives thickness/profile/height from
its selected validated wall-style compatibility row.

## Candidate conversion

For a legacy wall module centered at `(x, y, z)` with normalized yaw `theta`, define:

```text
d = (cos(theta), -sin(theta))
n = (sin(theta),  cos(theta))
startMeters = (x,z) - 1.5 * d
endMeters   = (x,z) + 1.5 * d
```

`startMeters * 16`, `endMeters * 16`, and `y * 16` must each be exact signed
integers under exact decimal-to-rational parsing of the saved number. Off-lattice
vertices or bases reject as `legacy_off_lattice`; they are never rounded. Yaw must
resolve to a finite direction whose two module endpoints land on the lattice.

The directed edge follows legacy local `+U` (`d`). Legacy local `+V` (`n`) is
therefore edge side A. Material slots map exactly:

```text
legacy slots.front -> edge.sideA
legacy slots.back  -> edge.sideB
legacy slots.sides -> generated jamb/cap/end fallback finish
```

Missing slots retain the mapped wall-style defaults. Slot references are copied as
typed material references; their text is never parsed for meaning.

## Maximal-run grouping

A maximal run contains only modules with identical values for this complete key:

```text
floor
absolute baseYU
exact oriented direction d
exact infinite-line cross-product
mapped wall style ID
resolved heightU, thicknessU, and profile
canonical side-A finish
canonical side-B finish
canonical generated-side finish
behavior-affecting wall overrides
```

Modules in a group are sorted by exact projection along `d`. Consecutive modules
merge only when one's end vertex equals the next one's start vertex exactly. A gap,
overlap, opposite yaw, finish change, style change, floor/base change, or structural
override change terminates the run. Opening variants participate using their mapped
base style; their measured child opening is placed at its original module's centered
column plus its offset within the merged run.

An isolated module is a valid maximal run. T and corner contacts share exact vertex
IDs after all run endpoints are indexed; they do not merge non-collinear edges.

## Stable migrated identity

Runs are canonically ordered by floor, base, start point, end point, style, then the
UTF-8 ordering of their member legacy IDs. Each run derives a migration command ID
from the SHA-256 hash of that ordered member-ID list:

```text
migrate-v4:<member-id-hash>:v:0
migrate-v4:<member-id-hash>:v:1
migrate-v4:<member-id-hash>:e:0
migrate-v4:<member-id-hash>:o:<legacy-piece-id>
```

Shared endpoint coordinates resolve to the first canonical vertex ID and all later
run endpoint references remap to it. Reordering the v4 piece array cannot change any
generated ID.

## Explicit ambiguity failures

Migration rejects instead of choosing when any of these conditions occurs:

- duplicate wall modules occupy the same directed span;
- partially overlapping collinear modules are not exact consecutive modules;
- opposite-yaw modules overlap while carrying incompatible front/back finishes;
- a mapped opening footprint overlaps another migrated opening or a run endpoint;
- a wall piece has non-unit instance scale, continuous spin, generated-site
  provenance, surface flora, or wall-local data with no declared architecture
  mapping;
- a sticker cannot be represented losslessly by an existing semantic wall anchor;
- material slot data is malformed or a behavior override conflicts within a run;
- an opening alias is unknown, a required compatibility wall style/kit is absent, or
  a catalog hash differs from the migration table;
- any vertex, base, height, thickness, opening anchor, or mask is off-lattice;
- normalization produces a topology diagnostic that v1 source validation rejects.

Every failure returns the exact legacy piece IDs and code. No source, migrated save,
or partial catalog install is written.

## Required proofs

1. Each of the six IDs produces the exact table row above.
2. Four contiguous compatible modules become one edge; any one key change produces
   two runs.
3. Input permutation produces byte-identical source and migration maps.
4. Front/back finishes remain on the same physical side at yaw 0, 90, 180, and 270.
5. Corners and T contacts reuse exact vertices without merging edges.
6. Off-lattice input and every ambiguity class reject without modifying the v4 file.
7. Ordinary pieces preserve IDs, values, and ordering exactly.
