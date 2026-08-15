# Section F — Editor source and persistence (v4 migration DELETED by req_4462)

## Architecture DTO proof

Commands:

```text
tools/esbuild cart/editor/world/architecture.test.ts --bundle --platform=node --format=iife --target=es2022 --outfile=/tmp/editor-architecture.test.js
tools/v8cli /tmp/editor-architecture.test.js
```

Result: bundle **41.9 KB**; V8 exit 0; **10 passed, 0 failed**.

The cases prove strict v1 source and measured catalog DTOs, whole and bounded `u`
on every structural axis, rejection of float/millimeter aliases and derived topology,
global ID/reference integrity, recursive clone isolation, stable directed edge sides,
kit-owned outward-rounded opening dimensions, typed catalog compatibility, and
recomputed summaries.

## Catalog and initialization proof

Commands:

```text
tools/esbuild cart/editor/world/architectureCatalog.test.ts --bundle --outfile=/tmp/editor-architecture-catalog.test.js --format=iife --platform=neutral --target=es2022 --alias:@reactjit/runtime=/home/siah/creative/reactjit/runtime --alias:@reactjit=/home/siah/creative/reactjit/runtime
tools/v8cli /tmp/editor-architecture-catalog.test.js
tools/esbuild cart/editor/bootIsClean.test.ts --bundle --outfile=/tmp/editor-boot-is-clean.test.js --format=iife --platform=neutral --target=es2022 --alias:@reactjit/runtime=/home/siah/creative/reactjit/runtime --alias:@reactjit=/home/siah/creative/reactjit/runtime
tools/v8cli /tmp/editor-boot-is-clean.test.js
```

Results: catalog **5 passed, 0 failed**; complete boot regression suite
**28 passed, 0 failed**. Typed roles beat ID text, category moves preserve identity,
palette and procedural calls share native query rows, skins do not multiply entries,
and named-world architecture initializes by recursive clone without arming a tool or
entering `worldPieces`.

## v5 world-store proof

Commands:

```text
RJIT_ROOT=/home/siah/creative/reactjit tools/esbuild cart/editor/data/worldStore.test.ts --bundle --outfile=/tmp/editor-world-store.test.js --format=iife --platform=neutral --target=es2022 --alias:@reactjit/runtime=$RJIT_ROOT/runtime --alias:@reactjit=$RJIT_ROOT/runtime
tools/v8cli /tmp/editor-world-store.test.js
```

Result: **7 passed, 0 failed** — v5 round-trip, strict architecture/wall-piece
rejection, malformed-file write protection with byte preservation, pre-v5 wall-piece
drop with ordinary preservation (req_4462), first-save-after-v4-load rewriting the
disk file as v5, ordinary payload preservation, and architecture-aware debounce
identity.

## v4 migration — DELETED

USER RULING req_4462 (2026-08-14): no legacy wall compatibility. Steps 81–84's
migration artifacts (native RJLM decoder, hidden compatibility catalog, wire
migrate packets, host binding, TS boundary, nine-fixture test file) were deleted
in the amended Step 85. Record: `contracts/v4_migration.md` (RETIRED tombstone).
Post-deletion native proof:

```text
tools/zig/zig build test-building-architecture -Doptimize=ReleaseFast --summary all
=> 121/121 passed; 3/3 build steps
```

Architecture-host boundary after removing `migrateV4`:

```text
tools/v8cli /tmp/editor-architecture-host.test.js
=> 8 passed, 0 failed
```
