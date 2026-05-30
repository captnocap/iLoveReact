# AGENTS.md - HMSC INT

This cart is internal tooling for Hitman Shitcity. Ship it with:

```sh
./tools/rjit ship hmsc-int
```

Keep it separate from the game cart. Map authoring, world inspection, chunk
visualization, and editor-only affordances belong here. The player-facing game
shell belongs in `cart/hmsc/`.

## Emit, don't mutate

This cart reads the shared world (`readStoredGameState` / `readLivePlayerSnapshot`)
one-way; it cannot mutate the running game. Editors STAGE intent and EMIT
`wv_*` command text you copy and run in the game console — the chunk painter
(`emitChunkCommands`) and the building face editor (`buildingEditor.ts` →
`wv_building face <id> <role> <skin>`) both follow this. A live-apply editor
would need a new hmsc-int → game command channel that doesn't exist yet; don't
fake one by writing stored state behind the game's back.

## Building face editor

`buildingEditor.ts` loads a building by id (click its footprint on the map, or a
chip in the BUILDING FACES panel) and stages a skin per face role
(front/back/left/right/top), emitting the minimal `wv_building face` set for the
faces that changed. Skin resolution is NOT re-implemented here — it calls
`buildingRoleSkin` in `cart/hmsc/world/buildings.ts`. Building ids are allocated
collision-free via `world/idgen.ts`, so loading by id is unambiguous.
