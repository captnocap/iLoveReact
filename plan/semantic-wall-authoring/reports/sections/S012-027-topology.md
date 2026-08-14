# Section B — Native Validation and Planar Topology

## Predicate gate — step 17

- Timestamp: `2026-08-14T14:48:54-07:00`
- Command: `tools/zig/zig build test-building-architecture -Doptimize=ReleaseFast --summary all`
- Exit: `0`
- Summary: `3/3` build steps succeeded; `15/15` tests passed.
- Runtime: `2ms`; reported maximum resident set: `6M` for the test runner.

Passing exact-predicate cases:

- horizontal/vertical proper intersection at a whole-`u` point;
- diagonal/diagonal proper intersection at a whole-`u` point;
- parallel-line classification with no line or segment intersection;
- typed collinear-overlap detection and rejection;
- endpoint-touch classification plus inclusive endpoint-on-segment behavior;
- widened orientation and intersection at the full supported coordinate magnitude;
- exact intersection at negative coordinates;
- typed rejection of a fractional rational crossing;
- canonical rational parameter reduction and exact ordering.

The harness uses the repository-pinned Zig 0.16 compiler. No float epsilon,
`atan2`, or coordinate rounding participates in these predicates.

## Deterministic topology gate — step 26

Run 1:

- Timestamp: `2026-08-14T15:04:43-07:00`
- Command: `tools/zig/zig build test-building-architecture -Doptimize=ReleaseFast --summary all`
- Exit: `0`
- Summary: `3/3` build steps succeeded; `29/29` tests passed.
- Runtime: `3ms`; reported maximum resident set: `6M` for the test runner.

Run 2:

- Timestamp: `2026-08-14T15:05:01-07:00`
- Command: `tools/zig/zig build test-building-architecture -Doptimize=ReleaseFast --summary all`
- Exit: `0`
- Summary: `3/3` build steps succeeded; `29/29` tests passed.
- Runtime: `4ms`; reported maximum resident set: `6M` for the test runner.
- Compile state: cached; `10ms` compile-step check.

Golden two-room face hashes, in canonical floor/stable-edge/direction order:

1. `c176f07ee864969f1dccc246594e764a7acd8fd34cda82424ff482db1795ea5d`
2. `52f3e5822c628a0ae74fe676279c2fbedfb9e151f92713d386343fdf926e6d34`

All four vertex/edge source permutations produce these two hashes in this exact
order and byte-identical ordered diagnostics. The hashes are SHA-256 over canonical,
length-prefixed boundary records; delimiter-bearing stable IDs cannot alias them.
