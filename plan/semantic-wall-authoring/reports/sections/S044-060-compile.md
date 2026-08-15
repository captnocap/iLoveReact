# Section D — Wall Geometry, Gameplay, and Compile Bundle

## Deterministic compile and allocator gate — step 58

- Timestamp: `2026-08-14T16:56:41-07:00`
- Command, run 1: `tools/zig/zig build test-building-architecture -Doptimize=ReleaseFast --summary all`
- Run 1: exit `0`; `3/3` build steps succeeded; `105/105` tests passed; test runtime `32ms`, test-runner MaxRSS `7M`; ReleaseFast compile `52s`, MaxRSS `1G`.
- Command, run 2: `tools/zig/zig build test-building-architecture -Doptimize=ReleaseFast --summary all`
- Run 2: exit `0`; `3/3` build steps succeeded; `105/105` tests passed; test runtime `33ms`, test-runner MaxRSS `6M`; cached compile check `10ms`, MaxRSS `40M`.
- Allocator result: zero leaks, double frees, or invalid frees. Sources, topology, raw geometry, every cloned compile row, room boundaries, door/portal records, section metadata, canonical bytes, hashes, pick hits, and optional IDs are exercised through `std.testing.allocator` and recursively deinitialized.

Pinned deterministic room fixture:

| Product | SHA-256 on run 1 | SHA-256 on run 2 |
|---|---|---|
| RJAB bundle | `a225e819f3c1b1735becbd5e2c7407150686c980ff6f29858fb9f13db0b1b15d` | `a225e819f3c1b1735becbd5e2c7407150686c980ff6f29858fb9f13db0b1b15d` |
| Wall section | `79c29b454e6ee8b00c2ef929a38eb0b463eb94e5d7a5f9e9a627c12c9c06508d` | `79c29b454e6ee8b00c2ef929a38eb0b463eb94e5d7a5f9e9a627c12c9c06508d` |

The two digests are permanent test constants. The same test compiles a source-array
permutation and requires byte-identical canonical bundle bytes and hashes. The focused
matrix also proves metric geometry and UVs, measured opening partitioning, shared
render/collision/cover/navigation/audio/visibility intervals, canonical room
boundaries, exact per-floor target invalidation, bounds filtering, directed wall and
opening-frame picks, true opening voids, and integer local hit coordinates.

## Numeric literal audit — step 59

Command:

`rg -n '\b[0-9]+(\.[0-9]+)?\b' framework/game/wall_geometry.zig framework/game/wall_compile.zig`

Every reported non-test hit is classified below. Line groups are from the formatted
source at the audit boundary.

| Classification | File and lines | Meaning |
|---|---|---|
| Wire constants | `wall_compile.zig:13-15,181,278,280,283,297,1472` | Four-byte RJAB magic, v1 bundle/section tags, the single present wall directory entry and its first index/initial offset, and the zero-reserved/one-based optional-side wire tag. These define the Section D encoder format rather than gameplay behavior. |
| Indexing, cardinality, and additive identities | `wall_compile.zig:216,311,419-421,430,447,463,478,596,599,648,689,705,709,788,811,889,913,919,929,957,1021,1100,1104,1106,1108,1115,1119,1121,1123,1162,1506,1508,1513,1539,1543` | Empty-slice/diagnostic checks, copy and canonical side-order indices, iterator origins, initialized-prefix counts, area sum identities, and zero-length ownership guards. Side order `0/1/2` implements the contracted A/B/generated ordering. |
| Integer-unit conversion and half-open bounds | `wall_compile.zig:937,940-941` | Integer ceiling of half thickness and the required one-unit exclusive maximum for conservative affected-bounds intersection. No meter or opening dimension is invented. |
| Quad/index topology and interval partition indexing | `wall_geometry.zig:67,69,138,189,209,301,340-341,382,384-414,643,759,797-800,814,849-853,870,878,894,929,1022-1024,1184,1189` | Four-corner quad storage, empty/initialized-prefix ownership, two endpoint cuts per opening, interval cursor arithmetic, degree/cardinality classification for miter/T/X/end cases, integer square-root search, half-edge iteration, UV corner selection, and zero-length release guards. |
| Metric/unit basis and mathematical identities | `wall_geometry.zig:202-203,252-294,310,360-361,522,533-552,570,598,616,751,767,783,805-809,838,1016,1026-1029` | Zero/one/-one axis components, source-origin and non-negative interval checks, half-thickness division by two, plane/line zero identities, the standard half-angle miter formula, normalized directions, world-up, and the planar UV origin/basis. These are coordinate algebra, not adjustable dimensions. |

Behavior thresholds are not numeric literals in either audited file. Miter limiting
reads `types.wall_tuning.miter_limit_ratio`; ray parallel/bounds tolerances read
`types.wall_tuning.ray_parallel_epsilon` and `ray_bounds_epsilon`; opening width,
height, row, clearance, and portal behavior continue to come only from measured
catalog entries. The audit found one unclassified semantic fallback: a missing edge or
vertex silently returned floor `0` during compile sorting/hashing. It was removed;
validated compiler inputs now make either missing reference unreachable rather than
misclassifying output onto the ground floor. No other numeric hit required promotion
to `WallTuning` or an opening-kit measurement.
