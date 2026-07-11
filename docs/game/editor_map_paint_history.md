# Editor Map Paint history

Active surface: `cart/editor/`. Last verified: 2026-07-10.

## User contract — req_2935

Map Paint owns its undo/redo history. While Map Paint is armed, Ctrl+Z,
Ctrl+Shift+Z, and the bottom-dock buttons must never consume the building/world
piece history. One undo unit is the native gesture the user just completed.

Covered mutation boundaries:

- terrain brush, ramp, slope, and smooth strokes;
- water, tile, flora, and zone strokes;
- tile-material binding edits, zone drops, and chunk growth;
- road/light-rail/railway Finish and Delete;
- TC Stop placement and deletion.

Draft-only path edits keep their local Undo Point/Cancel behavior. Finish is the
durable history boundary.

## Native journal

`framework/game/map/engine.zig` owns two bounded snapshot stacks beside the
RMAP mutations. A gesture captures the compact RMAP concern before it mutates;
successful completion pushes that snapshot to undo and clears redo. Undo
captures the current concern for redo, restores the target through the same
RMAP loader, recompiles road tiles from recipes, marks loaded chunks dirty, and
micro-saves the restored map.

The limits are P2 tuning: 64 entries and 64 MiB per stack. Oldest snapshots are
evicted when either limit is reached and the dropped count remains observable.
Snapshots shrink to their actual encoded length, rather than retaining the
worst-case serializer allocation.

Map load, reset, and named-document changes clear the journal. History never
crosses map documents.

## Command routing

The V8/runtime boundary exposes `mapHistory`, `mapUndo`, and `mapRedo`.
`AppFrame` checks the active concern before its existing building undo route:

- model document → mesh or texture-paint journal;
- world document + Map Paint armed → native RMAP journal;
- ordinary world editing → building/world-piece history.

After a map restore, the RMAP tile-binding table is mirrored back into React
chrome so a later option change cannot overwrite restored native data with a
stale binding list. `BuildDock` polls the owning history at 2 Hz and displays
the real native undo/redo depths.

## Verification

`framework/testing/unit/game_map.zig` paints one terrain gesture, proves the
native height changes, undoes to the exact prior RMAP, then redoes to the
painted height. Existing map-format tests cover every serialized channel, road
undercoat recompilation, rail/elevation/control recipes, and legacy migration.

## CHANGESET — req_2935

What: a bounded native Map Paint gesture journal plus concern-aware editor
undo/redo routing. Why: Ctrl+Z after terrain painting previously consumed the
building stack and deleted an unrelated building. Affects: map engine, V8 and
runtime map doors, AppFrame command routing, and bottom-dock history readouts.
Breaking changes: none; world-piece and model histories retain their existing
owners whenever Map Paint is not armed.
