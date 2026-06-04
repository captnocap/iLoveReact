# WO-2 — First capture: game/kinds/ (the registries)

For a parallel worker. Read FIRST: `tools/oracle` before any decision
(`tools/oracle "kinds"`, `tools/oracle "tile system"`). Constitution:
docs/game/DECISIONS.md (V4, V17-TRIAGE, P2, P3, P4). Shape: docs/game/STRUCTURE.md.

## Mission
The first system capture: REWRITE the kind registries (tiles, props, NPCs,
roles, landforms) fresh into `cart/hmsc-int/game/kinds/`, to the constitution's
bar. The existing files (`cart/hmsc/world/tileKinds.ts` and siblings) are
BEHAVIOR REFERENCES — read them, do not move or import them.

## Rules that bind this work
- V17-TRIAGE: capture = rewrite, never `git mv`/copy. Old files stay untouched
  (cart/hmsc is an extraction surface, V15-TRANSITION).
- P2: every behavior-affecting VALUE in the registries must be loadable from
  data (`data/tuning/` / the registry tables themselves are the data) — no
  buried constants in logic.
- P3: one deep door per registry family; consumers never reach into internals.
- P4: behavior tests in TS — e.g. "crosswalk is walk-preferred over sidewalk",
  "lane kinds carry flow", "wall is not traversable" — asserting the TABLE'S
  MEANING so a regression in a rewrite is caught, not the file layout.
- The road grammar is LOCKED (lane trios, junction tiles, crosswalks — see
  oracle "road grammar"); the rewrite must preserve it exactly.

## Deliverables
1. `cart/hmsc-int/game/kinds/` — fresh, typed, documented registries with one
   `index.ts` door, exported through `game/index.ts` as `GAME_KINDS`.
2. TS behavior tests beside them (runnable via tools/v8cli; wire into
   compile/verify when it exists).
3. A short capture note: what the old files contained, what was deliberately
   NOT carried (dead fields like voxel `solid:false` — oracle "dead fields"),
   any meaning ambiguities found (surface them, don't guess).

## Done =
GAME_KINDS importable; tests pass under v8cli; old files untouched; capture
note committed; _index record updated if facts changed. Commit in logical units.
