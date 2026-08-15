# Execution Plan — Semantic Wall Authoring

Execute sequentially unless a section says it may run after a named gate. For every completed row, follow `.agents/skills/refactor-plan/references/execution_rules.md`: reopen the changed file, append the step ID and proof to `state/completed.txt`, then write that ID to `state/current_step.txt`. Record a failure in `state/blocked.txt` and leave `current_step.txt` unchanged. Section commits use explicit paths and the repository’s required conventional commit style; never stage unrelated work or game 3D models.

Every TS test “bundle” row uses this command shape with its named input/output: `RJIT_ROOT=/home/siah/creative/reactjit tools/esbuild <input> --bundle --outfile=<output> --format=iife --platform=neutral --target=es2022 --alias:@reactjit/runtime=$RJIT_ROOT/runtime --alias:@reactjit=$RJIT_ROOT/runtime`. Every TS test “run” uses `tools/v8cli <output>` as a separate command.

## Section A — Contracts and native harness (steps 1–11, sequential)

Precondition: Phase 1–5 gates in `control_board.md` are true.

- [ ] 1. Write `reports/sections/S001-011-preflight.md` with a timestamp, `git status --short` output, the current HEAD SHA, and a declaration that only paths named by steps 1–11 belong to this section.
- [ ] 2. Write `contracts/source_schema.md` with the exact v1 `ArchitectureSource { version, revision, walls }` fields from `THESIS.md`, signed integer `u` fields, `16 u = 1 m` on X/Y/Z, stable directed-edge side semantics, explicit absolute wall support, command-derived string IDs, the extension rule for floor-slab/vertical-link/top-roof families, and the rule that DCEL/mesh/collider data is never persisted; link `contracts/architecture_lattice.md` and `contracts/build_catalog.md` as the governing unit/attachment/catalog contracts.
- [ ] 3. Copy the exact architecture-kit manifest, measurement, outward-rounding, identity, hierarchy, query, and atomic-install fields from `contracts/build_catalog.md` into `contracts/source_schema.md`; state that wall height/thickness/profile defaults come from the selected measured wall-style entry, opening footprint/clearance comes from the selected measured opening-kit entry, and no default door/window dimensions exist in `WallTuning` or UI code.
- [ ] 4. Write `contracts/mutation_receipt.md` with command IDs, stale-revision rejection, created/updated/removed records, old-edge child remaps, anchor/opening remaps, derived-face boundary signatures plus predecessor/successor lineage, forward/inverse patches, affected bounds, dirty targets, and deterministic generated IDs `${commandId}:v:<n>`, `${commandId}:e:<n>`, and `${commandId}:o:<n>`.
- [ ] 5. Write `contracts/compile_bundle.md` with a versioned `ArchitectureCompileBundle` section directory plus the wall section’s ordered render bands, collider bands, material roles, door/portal rows, nav/audio/visibility flags, room faces, pick proxies, diagnostics, source hash, compiler version, and per-target hashes.
- [ ] 6. Write `contracts/wire.md` with little-endian packet headers, magic, version, byte length, source revision, family/target section tags, section counts, UTF-8 string-table offsets, maximum counts, rejection envelope, unknown-section skip rules, and rejection behavior for short, trailing, or unknown-version data.
- [ ] 7. Write `contracts/v4_migration.md` with the six legacy wall variant IDs, maximal-run grouping keys, front/back-to-side-A/B mapping, an explicit legacy-meter-value to integer opening-kit mapping, rejection of off-lattice wall vertices instead of silent rounding, non-wall ID preservation, and explicit ambiguity failures.
- [ ] 8. Create `framework/game/architecture_scale.zig` with `units_per_meter = 16`, checked integer-unit limits, exact unit-to-meter output conversion, and legacy meter-to-unit validation; replace the private 16-unit ownership in `framework/gpu/stage_scale.zig` with an import of this authority and add native scale parity assertions.
- [ ] 9. Create `framework/game/wall_types.zig` with only the contract enums, integer-`u` source/result structs, catalog-reference fields, limits, tuning table, and allocator-owned deinit methods described by steps 2–6; create `framework/game/building_catalog.zig` with measured kit rows, outward-rounded footprint validation, family/role compatibility, typed category paths/tags, stable-ID/content-hash bindings, canonical query ordering, and allocator-owned deinit methods.
- [ ] 10. Create `framework/game/building_architecture.zig` as the owner of versioned architecture source/command/compile envelopes and a minimal public re-export of `wall_types.zig`, create `framework/testing/unit/building_architecture.zig` with one source-construction and 16-u-to-1-m smoke test through that facade, and add `test-building-architecture` to `build.zig` with Zig 0.16 `std.Io` wiring copied from the neighboring `test-game-physics` target.
- [ ] 11. Run `zig build test-building-architecture -Doptimize=ReleaseFast`, write the command and exit status to `reports/sections/S001-011-preflight.md`, then commit the explicit section paths with `feat: define semantic architecture contracts and wall harness`.

Section A exit: contracts exist on disk, the empty native harness runs, and `wall_types.zig` has no imports from editor or previous-era carts.

## Section B — Native validation and planar topology (steps 12–27, sequential)

Precondition: Section A exit is recorded.

- [ ] 12. Expand `framework/game/building_architecture.zig` with declarations for `validateCatalog`, `queryCatalog`, `validateSource`, `applyCommand`, `compile`, `raycast`, `openingSlots`, and `migrateLegacyWallModules` without V8 or renderer imports.
- [ ] 13. Add source/catalog validation tests to `framework/testing/unit/building_architecture.zig` for duplicate IDs, missing vertices, cross-floor endpoints, zero/short edges, non-integer structural values rejected at the wire/DTO boundary, unknown kits, non-finite/empty measurements, incorrect outward-rounded footprints, incompatible family/role/kind fields, invalid category paths/tags, an ID text that cannot override typed role, out-of-range clearance masks, and overlapping occupied/clearance masks.
- [ ] 14. Implement scalar, ID, reference, floor, catalog lookup, measurement/footprint, family/role, and exact cell-mask validation in `wall_types.zig` and `building_catalog.zig` until the tests from step 13 pass with typed rejection codes.
- [ ] 15. Create `framework/game/wall_topology.zig` with integer-`u` point/vector types, widened orientation, collinearity, proper intersection, endpoint-on-segment, rational intersection ordering, and exact lattice-intersection validation.
- [ ] 16. Add predicate tests to `framework/testing/unit/building_architecture.zig` for horizontal/vertical/diagonal intersections, parallel lines, collinear overlap, endpoint touch, large valid coordinates, and negative coordinates.
- [ ] 17. Run `zig build test-building-architecture -Doptimize=ReleaseFast` and record the passing predicate cases in `reports/sections/S012-027-topology.md`.
- [ ] 18. Add derived vertex, half-edge, face, exterior, hole, and diagnostic structs plus allocator-owned deinit methods to `framework/game/wall_topology.zig`.
- [ ] 19. Add topology tests for one square, two adjacent rooms, a T junction, an X junction, disconnected squares, a hole loop, a dangling edge, and a reversed source-edge direction.
- [ ] 20. Implement per-floor vertex indexing, twin creation, deterministic angular sorting without `atan2`, `next`/`prev` linking, cycle traversal, signed doubled area, and exterior/hole classification in `framework/game/wall_topology.zig`.
- [ ] 21. Add permutation tests that feed identical source records in at least four vertex/edge orders and assert byte-identical ordered face signatures and diagnostics.
- [ ] 22. Implement canonical output ordering by floor, stable source ID, direction, and cycle rotation in `framework/game/wall_topology.zig` until step 21 passes.
- [ ] 23. Add degenerate-input tests for duplicate coincident edges, partial collinear overlap, self-loop, intersection on an opening clearance zone, and face traversal exceeding the half-edge count.
- [ ] 24. Implement explicit diagnostics for every degenerate case from step 23; no case may silently drop a source edge.
- [ ] 25. Wire `building_architecture.validateSource` to wall scalar validation plus normalized topology construction and destruction.
- [ ] 26. Run `zig build test-building-architecture -Doptimize=ReleaseFast` twice and record both exits plus the deterministic face hashes in `reports/sections/S012-027-topology.md`.
- [ ] 27. Reopen `framework/game/wall_topology.zig`, confirm it imports no V8/world-loader/editor module, then commit the explicit section paths with `feat: add deterministic wall topology`.

Section B exit: integer predicates, derived DCEL, room faces, holes, exterior classification, and deterministic ordering pass native tests.

## Section C — Native wall mutation (steps 28–43, sequential)

Precondition: Section B exit is recorded.

- [ ] 28. Create `framework/game/wall_mutation.zig` with `applyCommand(allocator, source, command)` and private patch builders; expose no individual mutation helper outside this module.
- [ ] 29. Add draw-wall tests for an empty source, exact coincident endpoint reuse, explicit magnet target reuse, adjacent one-unit endpoints remaining distinct, non-integer rejection, arbitrary-angle lattice endpoints, reversed drag direction, and stale source revision.
- [ ] 30. Implement whole-`u` draw validation, exact/explicit endpoint reuse, stable command-derived IDs, source revision increment, forward patch, inverse patch, and affected floor bounds in `framework/game/wall_mutation.zig`.
- [ ] 31. Add crossing tests for one lattice-aligned X split, one lattice-aligned T split, a stroke crossing three edges, stable intersection order along a reversed stroke, typed rejection of an off-lattice rational intersection, and rejection of a collinear overlap.
- [ ] 32. Implement ordered intersection insertion and source-edge splitting in `framework/game/wall_mutation.zig`; accept only exact lattice intersections and preserve the original directed edge’s side A/B orientation on every child.
- [ ] 33. Add split-remap tests for opening cell masks before/after a split column, a mask intersecting the split clearance, and wall anchors on both child cell ranges.
- [ ] 34. Implement child-edge lineage, opening column adjustment, anchor column adjustment, and cell-clearance rejection in `framework/game/wall_mutation.zig`.
- [ ] 35. Add opening command and `openingSlots` tests for insert, move, delete, measured-kit change, facing/hinge change, every ordered valid anchor on a known wall, identical interactive/procedural results from one catalog snapshot, multiple disjoint masks, end-clearance rejection, occupied-mask collision, clearance-mask collision, thickness/profile rejection, and half-wall height rejection.
- [ ] 36. Implement opening-slot enumeration, exact mask validation, and patch emission in `framework/game/wall_mutation.zig` using validated measured entries from `building_catalog.zig`; the instance stores no width, height, sill, or clearance copy.
- [ ] 37. Add edge command tests for delete, vertex delete/cascade, integer-`u` absolute base, height, thickness, full/half profile, style, side-A finish, side-B finish, and deletion of the final incident edge/vertex.
- [ ] 38. Implement the edge/vertex/profile/style/side-finish commands in `framework/game/wall_mutation.zig` with orphan-vertex removal in the same receipt.
- [ ] 39. Add receipt round-trip tests that apply forward then inverse patches for every command family and assert the original source bytes and revision are restored.
- [ ] 40. Implement canonical source serialization for test hashing in `framework/game/wall_types.zig` and close every round-trip failure in `wall_mutation.zig`.
- [ ] 41. Wire `building_architecture.applyCommand` to wall validation, mutation, candidate-topology validation, and ownership-safe result cleanup.
- [ ] 42. Construct every mutation test with `std.testing.allocator`, run `zig build test-building-architecture -Doptimize=ReleaseFast`, and record the zero-leak exit output in `reports/sections/S028-043-mutation.md`.
- [ ] 43. Reopen the receipt and patch types, assert every allocation has a documented owner/deinit path, then commit the explicit section paths with `feat: add atomic wall mutation receipts`.

Section C exit: draw, split, edit, opening, anchor, forward, and inverse mutations are native, deterministic, and leak-free.

## Section D — Geometry, gameplay outputs, and compile bundle (steps 44–60, sequential)

Precondition: Section C exit is recorded.

- [ ] 44. Create `framework/game/wall_geometry.zig` with renderer-neutral surface bands, collider bands, material roles, wall-face pick proxies, and opening pick proxies.
- [ ] 45. Add geometry tests for one solid span, side-A/side-B normals, 90-degree join, 45-degree join, near-parallel bevel fallback at miter ratio 4, T join, X join, open end caps, and half-wall top caps.
- [ ] 46. Implement offset-line intersection, miter limiting, bevel fallback, end caps, side surfaces, and exact `u`-to-meter output conversion in `framework/game/wall_geometry.zig`.
- [ ] 47. Add opening partition tests for one door kit, two window kits on one edge, kit-derived window row/header, arch with no fill, broken-window kit with no pane, garage kit, sliding-double-door kit, and openings adjacent at the one-unit clearance limit.
- [ ] 48. Implement sorted interval subtraction plus face bands, jambs, reveals, sills, headers, caps, panes, and leaf attachment frames in `framework/game/wall_geometry.zig`.
- [ ] 49. Add parity tests that assert every visible solid band has one collider/cover band with identical horizontal and vertical extent, while every traversable opening has neither a solid collider nor a nav blocker in its interval.
- [ ] 50. Implement collider, cover, sound, sightline, traversal, door, and portal lowering from the shared interval partitions in `framework/game/wall_geometry.zig`.
- [ ] 51. Add UV/material tests for metric texture scale across 0°, 45°, and arbitrary-angle walls plus stable side-A/side-B roles after reload and source-order permutation.
- [ ] 52. Implement planar UV coordinates and generated roles `face`, `reveal`, `jamb`, `sill`, `header`, `cap`, and `end` in `framework/game/wall_geometry.zig`.
- [ ] 53. Create `framework/game/wall_compile.zig` with the wall section of `ArchitectureCompileBundle`, deterministic arrays, source/compiler/tuning/catalog hashes, per-target hashes, diagnostics, and affected-bounds filtering.
- [ ] 54. Add compile tests for deterministic bundle bytes, room-face boundary signatures, dirty-target sets for material-only/opening/topology edits, and unchanged hashes outside affected floors.
- [ ] 55. Implement compile orchestration over `wall_topology` and `wall_geometry`, then wire the wall family branch of `building_architecture.compile` to it.
- [ ] 56. Add raycast tests for both wall sides, opening void misses, jamb hits, nearest-edge selection, and returned edge/opening IDs with local integer wall-surface columns/rows.
- [ ] 57. Implement the wall-family branch of `building_architecture.raycast` through geometry pick proxies rather than catalog boxes.
- [ ] 58. Run `zig build test-building-architecture -Doptimize=ReleaseFast` twice and record bundle hashes plus allocator status in `reports/sections/S044-060-compile.md`.
- [ ] 59. Run `rg -n '\b[0-9]+(\.[0-9]+)?\b' framework/game/wall_geometry.zig framework/game/wall_compile.zig`, classify each non-test hit in the section report as unit conversion, indexing, wire constant, or tuning-table reference, and move every unclassified literal into `WallTuning` or the opening-kit table.
- [ ] 60. Commit the explicit section paths with `feat: compile wall geometry rooms and portals`.

Section D exit: one native compile bundle owns visible surfaces, collision, materials, picks, rooms, portals, navigation, sound, and visibility facts.

## Section E — Versioned host boundary (steps 61–73, sequential)

Precondition: Section D exit is recorded.

- [ ] 61. Create `framework/game/architecture_wire.zig` with bounded sectioned encoders/decoders for catalog install/query, source, command, mutation result, compile bundle, raycast request/result, and migration request/result packets from `contracts/wire.md`.
- [ ] 62. Add native wire tests for a golden measured architecture-kit entry, empty source, a wall with two openings, catalog query filters/results, all command tags, all rejection tags, short header, bad magic, future version, excessive count, invalid string offset, trailing bytes, and encode/decode/encode byte identity.
- [ ] 63. Implement the wire codec in `framework/game/architecture_wire.zig` and retain the golden packet bytes as explicit test arrays in `framework/testing/unit/building_architecture.zig`.
- [ ] 64. Add marshal-only architecture functions to `framework/v8_bindings_game_build.zig` for catalog validate/install/query, source validate, mutate, compile, raycast, opening-slot enumeration, migrate-v4, architecture-scale metadata, and read-only measured catalog rows.
- [ ] 65. Register the wall host names in `framework/v8_bindings_game_build.zig` under the existing `registerGameBuild` function and preserve the `game_build` ingredient gate.
- [ ] 66. Extend `runtime/game/build.ts` with typed catalog install/query, wall packet calls, and scale/catalog readback; leave non-wall `BUILD_CATALOG_IDS` and fixed-piece raycast functions intact during parity.
- [ ] 67. Create `cart/editor/world/architectureHost.ts` with catalog/source/command serializers, result decoders, packet count/version assertions, rejection-code mapping, and a hard capability error when architecture host calls are absent.
- [ ] 68. Create `cart/editor/world/architectureHost.test.ts` with a fake host for measured catalog install/query, golden packet decode, every rejection code, stale revision, malformed result lengths, and absent-host failure.
- [ ] 69. Bundle `architectureHost.test.ts` with `tools/esbuild` using the repository aliases and output `/tmp/editor-architecture-host.test.js`.
- [ ] 70. Run `tools/v8cli /tmp/editor-architecture-host.test.js` and record its pass count in `reports/sections/S061-073-host.md`.
- [ ] 71. Run `zig build test-building-architecture -Doptimize=ReleaseFast` and record the wire test count in `reports/sections/S061-073-host.md`.
- [ ] 72. Run `SHIP_RUN_PACKAGE=0 ./tools/rjit ship editor`, record the ReleaseFast build result, and leave all produced binaries untracked.
- [ ] 73. Reopen both sides of the wire, list every shared magic/version/limit field in the report, then commit the explicit section paths with `feat: expose semantic walls through the host`.

Section E exit: the editor can validate, mutate, compile, pick, and migrate architecture through one bounded native interface.

## Section F — Editor source, persistence, and v4 migration (steps 74–88, sequential)

Precondition: Section E exit is recorded.

- [ ] 74. Create `cart/editor/world/architecture.ts` with v1 source DTOs plus measured architecture-kit/catalog DTOs from the two governing contracts, strict validators, empty source, deep clone, canonical ID lookup, discriminated architecture selection, tool state, and derived summary types.
- [ ] 75. Create `cart/editor/world/architecture.test.ts` with valid/invalid DTO cases, duplicate/missing ID cases, whole-`u`/range checks, rejection of millimeter/float structural fields, clone isolation, stable edge-side lookup, kit-owned opening dimensions, and no acceptance of derived topology fields.
- [ ] 76. Bundle `architecture.test.ts` to `/tmp/editor-architecture.test.js` with `tools/esbuild`, then run it with `tools/v8cli` and record the pass count in `reports/sections/S074-088-persistence.md`.
- [ ] 77. Add `architecture`, `architectureSelection`, and `architectureTool` fields to `EditorState` in `cart/editor/data/types.ts`; keep ordinary non-wall instances in `worldPieces`.
- [ ] 78. Create `cart/editor/world/architectureCatalog.ts` with manifest-to-install DTO projection, hierarchy/search projection, and structured query requests plus `architectureCatalog.test.ts` for typed-role-over-ID, category moves, palette/query parity, and skin non-expansion; extend `ModelPlaceable` with `architecture-kit`, then initialize editor architecture fields and the installed catalog in `initialState.ts` from `WorldSave` plus validated disk manifest projections.
- [ ] 79. Advance `WorldSave` to version 5 in `cart/editor/data/worldStore.ts`, add `architecture`, reject wall-kind records in v5 `pieces`, and replace long positional save parameters with one named snapshot input object.
- [ ] 80. Create `cart/editor/data/worldStore.test.ts` with v5 round-trip, strict architecture rejection, malformed-file write protection, ordinary-piece preservation, and debounce snapshot identity cases.
- [ ] 81. Create `cart/editor/world/wallMigration.ts` that parses strict v4 wall candidates, calls `architectureHost.migrateLegacyModules`, and returns v5 architecture plus untouched ordinary pieces and diagnostics.
- [ ] 82. Add native migration tests for maximal straight runs, a corner, separate floors, front/back materials, each legacy edit ID to its declared integer kit, centered opening-column conversion, off-lattice coordinate rejection without rounding, conflicting modules, and stable legacy-derived IDs.
- [ ] 83. Implement `building_architecture.migrateLegacyWallModules` in a focused `framework/game/wall_migration.zig` imported only by the facade and tests.
- [ ] 84. Create `cart/editor/world/wallMigration.test.ts` with explicit v4 JSON fixtures for the cases from step 82 plus a malformed/ambiguous fixture that keeps the source write-protected.
- [ ] 85. AMENDED by req_4462 (was: route v1–v4 loads through `wallMigration.ts`). Pre-v5 loads in `worldStore.ts` return in-memory v5 with empty architecture, DROP legacy wall-kind pieces with a loud diagnostic, preserve every ordinary piece, skip the persisted-snapshot cache so the first save rewrites the file as v5, and never write a pre-v5 shape.
- [ ] 86. Update `AppFrame` save, flush, map-switch, and close calls to pass the named snapshot object containing architecture exactly once per call site.
- [ ] 87. Bundle and run `worldStore.test.ts` separately with `tools/esbuild` and `tools/v8cli`; record its pass count plus `test-building-architecture` in `reports/sections/S074-088-persistence.md`. (The `wallMigration.test.ts` run is void — the file is deleted.)
- [ ] 88. Reopen the pre-v5 parser and v5 validator, confirm the legacy decoder can only return v5 source or an error, then commit the explicit section paths with `feat: persist semantic walls without legacy migration`.

**AMENDMENT (req_4462, 2026-08-14).** USER RULING, verbatim: "there is literally fuck
all reason to keep any compatability of those. delete them all and were both in a
better place." The entire v4 wall-migration lane was deleted the same day:
`framework/game/wall_migration.zig`, `cart/editor/world/wallMigration.ts` and its
fixtures, `building_architecture.migrateLegacyWallModules`, wire packet kinds 17/18,
section tags 50/51, rejection code 19 (numeric values stay reserved forever), the
`__game_build_arch_migrate_v4` host binding, and `architectureHost.migrateV4`.
Steps 81–84's recorded completions describe artifacts that no longer exist; the
governing record is `contracts/v4_migration.md` (RETIRED tombstone). Downstream:
Section J steps 134–135 no longer have alias strings to keep anywhere — the six
legacy edit IDs and seven base wall IDs survive only in the fixed-wall build catalog
that severance deletes; step 142's grep gains no migration-decoder exemption.

Section F exit: v5 is the only writable shape; pre-v5 documents load with legacy
walls dropped (req_4462) and can never write back as a pre-v5 or wall-carrying shape.

## Section G — Commands, undo, prefabs, finishes, and anchors (steps 89–103, sequential)

Precondition: Section F exit is recorded.

- [ ] 89. Create `cart/editor/world/architectureCommand.ts` with one planner/apply/inverse boundary over native mutation receipts and command IDs for draw, delete, profile, dimensions, style, side finish, opening, anchor, and prefab stamp operations.
- [ ] 90. Create `cart/editor/world/architectureCommand.test.ts` with success/rejection, stale revision, one journal entry per command, forward/inverse byte restoration, stable selection remap, and affected-bounds propagation cases.
- [ ] 91. Add an architecture adapter to `cart/editor/data/applicationCommands.ts` that reads one document snapshot, calls the planner once, and applies one complete receipt.
- [ ] 92. Add architecture command routing cases to `cart/editor/data/applicationCommands.test.ts` for UI, shortcut, API, and automation sources with identical state transitions.
- [ ] 93. Add architecture command IDs/descriptions, including File → Export Architecture Kit roles, to `cart/editor/data/commands.ts` and semantic event payloads to `cart/editor/data/editorEvents.ts`.
- [ ] 94. Add command/event contract cases to `commands.test.ts` and `editorEvents.test.ts` proving every architecture-kit export role is reachable beneath the typed hierarchy without exposing DCEL indices or packet buffers.
- [ ] 95. Extend `WorldPrefab` in `cart/editor/world/prefabs.ts` with a local vertex/edge/opening graph and retain local ordinary pieces as a separate payload field.
- [ ] 96. Replace wall cases in `prefabFromPieces` and `stampWorldPrefab` with architecture capture and a single `stampPrefab` mutation command; ordinary piece behavior remains unchanged.
- [ ] 97. Expand `cart/editor/world/prefabs.test.ts` with a four-wall room, two openings, rotated stamp, weld into an existing endpoint, crossing split, side finishes, and one-action undo.
- [ ] 98. Add edge-side finish mapping to `cart/editor/world/architecture.ts` and route wall paint intents away from `pieceSlots.ts`; retain `pieceSlots.ts` for ordinary pieces.
- [ ] 99. Add stable derived wall-face IDs to `cart/editor/world/facadeBake.ts` and tests proving a facade stays attached after unrelated topology edits and remaps after its own edge split.
- [ ] 100. Add optional semantic wall anchors to ordinary `PlacedPiece` in `cart/editor/world/pieces.ts` and derive their world transforms only from native compile outputs.
- [ ] 101. Add anchor attach/detach/split-remap cases to `architectureCommand.test.ts` and persistence cases to `worldStore.test.ts`.
- [ ] 102. Bundle and run the architecture command, application command, commands, editor events, prefabs, facade, and world-store tests; record each pass count in `reports/sections/S089-103-commands.md`.
- [ ] 103. Run `rg -n 'architecture:' cart/editor`, label every hit in `reports/sections/S089-103-commands.md` as initialization, load, or command receipt application, replace every unlabeled write with command dispatch, then commit the explicit section paths with `feat: integrate wall commands prefabs and anchors`.

Section G exit: architecture edits are one command path with undo/redo, persistence, prefab decomposition, side finishes, facade identity, and anchor remaps.

## Section H — Live preview and authoring UI (steps 104–120, sequential)

Precondition: Section G exit is recorded.

- [ ] 104. Create `cart/editor/world/wallPreview.ts` that converts decoded compile-bundle rows into retained live-piece, material, collider, door, pick-proxy, room-face, and diagnostic inputs keyed by target hash.
- [ ] 105. Create `cart/editor/world/wallPreview.test.ts` with full bundle install, affected-floor replacement, unchanged-hash retention, removed-edge eviction, malformed identity rejection, and source-selection lookup cases.
- [ ] 106. Split `pushLiveWorld` in `cart/editor/world/livePush.ts` into ordinary-piece and compiled-wall inputs; remove wall records from ordinary `pieceInstanceRows` before publishing.
- [ ] 107. Create `framework/world_loader/live_wall_bundle.zig` for target-hash decoding and retained-output replacement, then export only set/apply/clear lifecycle calls through `live_inputs.zig`.
- [ ] 108. Add native world-loader tests for affected wall output replacement, collider parity, door identity retention, wall-hide behavior, and resource cleanup, then add the focused build target beside existing `test-world-*` targets.
- [ ] 109. Create `cart/editor/world/wallTools.ts` with pure draw/opening gesture states, floor-plane-to-integer-`u` conversion, explicit vertex magnet targets, cancellation, native opening-slot selection, transient preview descriptions, and semantic command construction.
- [ ] 110. Create `cart/editor/world/wallTools.test.ts` with click-click draw, drag draw, Escape cancel, floor change cancel, one-unit and one-meter snaps, arbitrary-angle lattice endpoints, non-integer structural rejection, exact opening slot/side/facing selection, invalid preview, and one commit per gesture.
- [ ] 111. Replace wall use of `resolveRunPlacements` in `WorldViewport.tsx` with `wallTools`; merge native wall-face picks with ordinary piece picks by ray distance and dispatch architecture commands only on commit.
- [ ] 112. Create `cart/editor/data/architectureKitExport.ts` with save-before-measure input validation, mount-envelope outward rounding, typed manifest construction, and content-hash install receipt validation; create `architectureKitExport.test.ts` with asymmetric/fractional bounds, invalid envelopes, role mismatches, and stable re-export cases.
- [ ] 113. Change `BuildBar.tsx` to render nested Wall Styles/Openings/category groups from `architectureCatalog.ts`, then add `ArchitectureController` to `WorldEditorSurface.tsx` and `Stage.tsx` as one object containing tool, selection, dispatch, derived summaries, catalog hierarchy, and diagnostics.
- [ ] 114. Create `cart/editor/inspector/WallBody.tsx` with edge length/read-only endpoints, height, thickness, full/half profile, style, side finishes, opening list, and command-backed actions.
- [ ] 115. Create `cart/editor/inspector/WallOpeningBody.tsx` with kind, kit, editable integer column/row, read-only kit width/height/clearance, facing, hinge, move, and delete controls constrained by host catalog metadata.
- [ ] 116. Create `cart/editor/shell/ExportArchitectureKitDialog.tsx` with explicit family/role/kind, category path, semantic mount envelope, pivot, tags, material roles, and clearance-mask fields; route discriminated architecture selection to the new inspector bodies and keep `PieceBody.tsx` free of wall-specific optional fields.
- [ ] 117. Add wall/opening quick verbs to `WorldContextMenu.tsx`: copy edge properties, add opening, set half/full, flip opening facing, delete opening, and delete edge through `ArchitectureController`.
- [ ] 118. Add one architecture controller adapter, one derived compile effect, and the save/measure/manifest/install orchestration from `architectureKitExport.ts` to `AppFrame.tsx`; remove wall geometry, intersection, opening validation, catalog meaning inference, and packet parsing from the shell.
- [ ] 119. Bundle and run `wallPreview.test.ts`, `wallTools.test.ts`, `architectureCommand.test.ts`, `architectureHost.test.ts`, `architectureCatalog.test.ts`, `architectureKitExport.test.ts`, `pieces.test.ts`, and `piecePlacementCommand.test.ts`, then run `SHIP_RUN_PACKAGE=0 ./tools/rjit ship editor`; record results in `reports/sections/S104-120-ui.md`.
- [ ] 120. Reopen `WorldViewport.tsx` and `AppFrame.tsx`, list their remaining wall responsibilities in the report, then commit the explicit section paths with `feat: add mutable wall and opening authoring`.

Section H exit: the active editor draws semantic spans, returns later to mutate openings, and previews native-derived wall consequences without TS topology.

## Section I — Frozen compile and `/play` consumption (steps 121–131, sequential)

Precondition: Section H exit is recorded.

- [ ] 121. Add wall source and compile-bundle cache keys to `framework/world/compile_cache.zig` using source, compiler, tuning, installed measured catalog snapshot, and resolved content hashes.
- [ ] 122. Add wall target invalidation rules to `framework/world/chunk_dirty.zig` for render, collision, cover, door/portal, nav, room, visibility, and audio outputs using mutation-receipt affected bounds.
- [ ] 123. Add golden native tests that lower one two-room structure with a door and two windows into current frozen render, collider, door, portal/nav, room, visibility, audio, and material records.
- [ ] 124. Add wall lowering beside each existing mapfile/gamefile writer owner; serialize generated assets by content hash and keep authored source out of runtime-only geometry lumps.
- [ ] 125. Extend the corresponding mapfile/gamefile readers only for new frozen fields required by step 124; no reader imports `wall_mutation.zig` or `wall_topology.zig`.
- [ ] 126. Add round-trip tests that decode the golden frozen file and assert render voids, collider voids, door IDs, portal endpoints, room boundary signatures, material sides, and hash stability.
- [ ] 127. Route editor Compile through `building_architecture.compile` and the cache/lowering path; remove any package path that bakes structural walls from `pieceVisualShapes` or an exported whole-wall model.
- [ ] 128. Route `/play` to the frozen door/collider/nav/room outputs and retain only door-state transforms/parameters as runtime mutation.
- [ ] 129. Run `zig build test-building-architecture -Doptimize=ReleaseFast` plus every modified `test-world-*` target and record commands/exits in `reports/sections/S121-131-frozen.md`.
- [ ] 130. Run `SHIP_RUN_PACKAGE=0 ./tools/rjit ship editor`, compile the wall fixture through the normal editor compile verb, and record the produced content hashes without adding generated assets or 3D models to Git.
- [ ] 131. Reopen the shipped runtime dependency graph, record the absence of `wall_mutation.zig` and editor imports, then commit the explicit section paths with `feat: freeze semantic walls into world outputs`.

Section I exit: editor-time mutation produces content-addressed frozen outputs, and `/play` consumes those outputs without dynamic shape generation.

## Section J — Switch and severance build (steps 132–148, sequential)

Precondition: Sections A–I are committed and green. The pre-severance section commit is the recoverable archive for legacy branches embedded inside shared files; record its SHA before deleting them.

- [ ] 132. Write `reports/severance_fixes.md` with timestamp, pre-severance SHA, the legacy symbols/IDs listed in `REUSE_MAP.md`, an empty build-failure table, and an empty forward-fix table.
- [ ] 133. Remove edit-specific structural wall rows and `CatalogRow.edit` consumption from `cart/editor/world/buildCatalog.ts`; wall-style/opening projections now come only from validated installed architecture-kit entries.
- [ ] 134. Remove the six edit-specific wall IDs from active `BUILD_CATALOG` placement rows in `framework/game/build.zig`; keep string aliases only in `wall_migration.zig`.
- [ ] 135. Remove the six edit-specific wall IDs from active `BUILD_CATALOG_IDS` in `runtime/game/build.ts`; keep their v4 strings only in the migration contract/decoder.
- [ ] 136. Remove wall handling from `resolvePlacement`, `resolveRunPlacements`, `supportsRunPlacement`, `placementSlotKey`, fixed-box picking, and `pieceInstanceRows` in `cart/editor/world/pieces.ts`.
- [ ] 137. Remove `openingFor` and every wall branch from `cart/editor/world/pieceShapes.ts`; keep non-wall shapes and explicit v4 fixture data outside production rendering.
- [ ] 138. Make `piecePlacementCommand.ts` reject wall-kind candidates and delete wall replacement assertions from `piecePlacementCommand.test.ts` after architecture-command assertions cover the same user operations.
- [ ] 139. Remove Door Wall/Garage Door Wall starters and static export targets from `buildStarters.ts`, `buildExports.ts`, `authoredRegistry.ts`, and `buildPieceStarter.ts`; retain the active measured Architecture Kit export roles and catalog projection built in Section H.
- [ ] 140. Remove Door Wall special-case structural export/compile code from `AppFrame.tsx`; leave the generic model save plus measured architecture-kit manifest/install orchestration intact.
- [ ] 141. Remove live structural use of `PlacedBuildPiece.edit`, `applyWallEdit`, fixed wall bounds, wall variant raycast branches, and wall-kind participation in `liftedWallBaseY` from `framework/game/build.zig`; keep the public semantic enum in `wall_types.zig`, and leave any temporary non-wall rest behavior named as legacy in the floor-follow-on contract.
- [ ] 142. Run `rg -n 'wall\.concrete\.doorway|wall\.concrete\.openDoorway|wall\.metal\.garageDoor|wall\.stucco\.window|wall\.stucco\.doubleWindow|wall\.plywood\.brokenWindow|openingFor\(|resolveRunPlacements|liftedWallBaseY' cart/editor runtime framework` and copy every remaining production hit with its disposition into `reports/severance_fixes.md`; any hit reachable from semantic walls is a hard failure.
- [ ] 143. Run `tools/rjit clean --bin`, then run `SHIP_RUN_PACKAGE=0 ./tools/rjit ship editor`; append each compiler/linker error to the build-failure table before changing code.
- [ ] 144. Resolve each recorded build error by adding the missing new-path dependency or removing the stale caller, and append the exact file/symbol resolution to the forward-fix table; never restore a deleted structural wall branch.
- [ ] 145. Repeat step 143 and step 144 until the ReleaseFast editor build exits zero with no legacy structural import or catalog hit outside `wall_migration.zig`, explicit v4 fixtures, contracts, and plan reports.
- [ ] 146. Run all native and TS tests named by Sections B–I without the legacy structural path and record every exit in `reports/severance_fixes.md`.
- [ ] 147. Delete obsolete legacy-only tests/fixtures that exercise runtime placement/rendering of wall variants; retain v4 migration fixtures that lower directly to v5 architecture.
- [ ] 148. Commit the explicit severance paths with `refactor: sever fixed wall variants`; set `legacy_deleted: true` only after reopening all remaining grep hits and classifying them as migration data or documentation.

Section J exit: no live placement, preview, compile, or `/play` path can construct a structural wall from the fixed-module implementation.

## Section K — Final proof and user verification (steps 149–158, sequential)

Precondition: Section J exit is recorded.

- [ ] 149. Run `tools/rjit clean --bin` and `SHIP_RUN_PACKAGE=0 ./tools/rjit ship editor` from the severed tree; write the clean build command, exit, and binary path to `reports/closure_summary.md`.
- [ ] 150. Run `zig build test-building-architecture -Doptimize=ReleaseFast` and every modified `test-world-*` target; write test names, counts, and exits to `reports/closure_summary.md`.
- [ ] 151. Bundle and run every modified or new editor TS test file separately with `tools/esbuild` and `tools/v8cli`; write pass counts and exits to `reports/closure_summary.md`.
- [ ] 152. Run the wall fixture compile twice from identical v5 source and record byte-identical source, bundle, target, and frozen artifact hashes in `reports/closure_summary.md`.
- [ ] 153. Run `git status --short`, `git diff --check`, and the legacy-symbol search from step 142; write the exact outputs and the no-game-3D-model assertion to `reports/closure_summary.md`.
- [ ] 154. Ask the user to export one door/window kit with a fractional/asymmetric mount envelope into a nested Wall category, find it through that hierarchy, draw a four-wall room with one T junction, insert the kit only at returned integer slots, attempt it on a visibly too-small wall, move it, toggle half height on one edge, paint opposite wall sides differently, save/reload, undo/redo, and report any wrong measurement, catalog clutter, guessed fit, material swap, stale room boundary, or lost opening.
- [ ] 155. Ask the user to enter `/play`, walk through the door, collide with the remaining bands, confirm windows block walking, and report door routing or visibility/audio errors.
- [ ] 156. Ask the user to arm spikewatch at baseline and keep it armed through at least 60 seconds of wall drawing, opening dragging, save/reload, and representative `/play`; record the report and any new rhythmic spike class in `reports/closure_summary.md`.
- [ ] 157. Apply only defects reported by steps 154–156 through the owning source/compiler/UI boundary, rerun the affected automated checks, and repeat the relevant user check until no defect or new spike class remains.
- [ ] 158. Finish `reports/closure_summary.md` with removed legacy paths, forward severance fixes, final hashes, automated results, user verification, frame-time result, retained v4 decoder scope, and no-model-commit status; set the four Phase 7 gates true and commit the explicit report/control paths with `refactor: complete semantic wall migration`.

Final exit: all Phase 7 gates are true, the old structural path is absent, clean build and tests pass, hashes are deterministic, spikewatch is silent, and the user has confirmed the interaction/visual contract.
