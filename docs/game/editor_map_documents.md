# Editor map documents

Active surface: `cart/editor/` and its `/play` route. Last verified: 2026-07-10.

## Boundary

One map is a named directory, not whichever unrelated fixed files happen to be
present when the editor boots:

```text
zig-out/game/editor/maps/<stem>/
  painting.rmap   native terrain, chunks, flora, water, roads, painted cells
  world.json      placed pieces/props, semantic objects, zone definitions, id sequence
zig-out/game/editor/maps/_last.txt
```

The two concern files keep their own formats and micro-save paths, but the
directory stem is the document boundary. `world.json` also embeds that stem as
`document`; Open rejects a file whose embedded id does not match its directory.
Names are normalized into non-reserved stems capped at 64 characters. A
malformed authoring row rejects the whole JSON concern rather than being silently
dropped and then lost on the next save.
Catalog models/materials and game-wide physics globals are shared project
content, not map placements, and intentionally remain outside the map directory.

## New/Open transaction

File → New Map Workspace (`Ctrl+N`) creates a uniquely named clean document.
The active-map pill in the chrome and File → Open Workspace open the saved-map
picker, which can create a named map or open a previous one.

A switch follows one ordered boundary:

1. Parse and validate the target `world.json` without changing live state.
2. Synchronously flush the outgoing `world.json` and native `painting.rmap`.
3. Disable the outgoing native autosave target.
4. Load the target RMAP, or seed one chunk only when that concern is genuinely
   missing. A malformed existing RMAP is refused.
5. Write/validate the target world concern and commit `_last.txt`.
6. Replace—never merge—pieces, semantic objects/markers, zones, material
   bindings, selection, floor, paint claim, and world undo/redo state.

If steps 4–5 fail, the just-flushed outgoing RMAP is reloaded and its pointer and
React state remain active. The debounced JSON writer retains the stem it was
scheduled for, so an outgoing timer cannot retarget itself into an incoming
document.

On cold boot, an invalid `world.json` is write-protected and left byte-for-byte
in its original directory; the editor points at a uniquely named clean recovery
map instead. Thus the first debounce cannot turn a parse failure into destructive
data loss or pair a partial JSON load with the damaged document's painting.

## Native reset law

`framework/game/map/engine.zig::reset` now starts an unbound map: it clears the
previous autosave path and the map-scoped tile-binding table in addition to
chunks/roads/strokes. Callers must explicitly bind a document after loading or
seeding it. This prevents a test/reset/grow sequence from overwriting the map
that was open before the reset, and prevents a fresh map inheriting another
map's painted-material palette.

## Hot reload and migration

Hot state is a view cache only. `persistView.ts` redacts map pieces, semantic
objects, zones, bindings, selections, and world undo stacks; boot always takes
those slices from the active named document. Therefore stale in-process state
cannot resurrect placements or markers from the prior map.

The first boot with the former fixed files registers exactly one `legacy`
document. The native owner imports `painted-map.rmap` host-side and the JSON owner
upgrades `world-pieces.json` from v1 to a stem-tagged v2. Once both named concern
files exist, the migration marker is removed; deleting a named concern later can
never fall back to and resurrect the old fixed-file data.

## Verification

- `cart/editor/data/mapDocuments.test.ts`: path separation, embedded-id
  rejection, gated legacy upgrade, and replace-not-merge state transition.
- `zig build test-game-map -Doptimize=ReleaseFast`: native reset clears both
  autosave identity and map-scoped material bindings.
- ReleaseFast editor build plus a native create/open/reopen probe proves chunk
  counts and placed-piece saves remain paired per stem.

## CHANGESET — req_2881 / req_2882

What: replace the two fixed editor save paths with named, isolated map-document
directories and real New/Open commands. Why: a reset/replaced RMAP could boot
beside the independently restored old pieces JSON, producing floating build
pieces over blank chunks; hot state was a second resurrection path. Affects:
editor persistence, map-paint activation, hot restore, File commands, chrome,
and the map picker. Breaking changes: none to authored bytes; the former fixed
files migrate once into `legacy`. Native reset now intentionally disables its
autosave target until a caller binds one.
