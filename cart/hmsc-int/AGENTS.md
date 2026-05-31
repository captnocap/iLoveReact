# AGENTS.md - HMSC INT (World Editor)

`cart/hmsc-int` is the **world editor** for Hitman Shitcity. It authors the world
the game (`cart/hmsc`) boots from. Ship it with:

```sh
./scripts/ship hmsc-int
```

Keep it separate from the game cart. World authoring, inspection, and editor-only
affordances belong here. The player-facing game shell belongs in `cart/hmsc/`.

## Author a real GameState; compile = persist

The editor stages a real `GameState` — the SAME record the game boots from — and
"Compile" writes it to the shared `'hmsc'/'game-state'` localstore key via
`saveGameState`. The game boots by reading that exact key (`readStoredGameState`
in `cart/hmsc/index.tsx`). Localstore is ONE store across all carts (the host
calls `fs.init("reactjit")`, not a per-cart name — see the
`hmsc_localstore_shared_across_carts` memory), so the editor and the game share
state directly. The editor IS the channel; there is no separate one to build.

**This replaces the old "emit `wv_*` text you paste in" model.** That existed only
because an earlier note claimed there was no editor→game channel. There is. Do
NOT reintroduce a command-text export as the authoring surface. (The `wv_*`
console verbs still exist in the game for live tweaks — they are not how the
editor authors.)

## Every mutation goes through the game's own mutators

`editorWorld.ts` is the authoring spine. It never invents a parallel schema — it
calls the game's real world mutators so an authored thing is byte-identical to one
the game made (same ids, same collision, same borrow-a-tileKind gameplay):

- buildings → `resolveBuildingPlacement` (city rules + door auto-snap) + `addBuildingToWorld`
- props → `placeProp`; zones → `addZone`; tile fills → `addSurfaceRegion`
- face skins → `setBuildingFaceSkin` (applied directly, not emitted)
- ids → `nextUniqueId`; overlap checks → `rects.ts`

If you add an authorable thing, add its mutator call here — do not duplicate the
record-construction logic that already lives in `cart/hmsc/world`.

## Shape

- `index.tsx` — composition only: tool belt, staged-GameState state + undo,
  wiring tool gestures to `editorWorld` mutators, panels. Not a god file.
- `editorWorld.ts` — load / mutate / compile (persist). The only file that writes
  the boot key.
- `MapCanvas.tsx` — the 2D top-down placement surface: one `<Effect>` shader-quad
  raster + TSX overlays + pointer→cell. A PURE interaction surface; emits semantic
  gestures (tap / rect / hover) and draws a validity ghost. Knows nothing about
  tools or mutation.
- `IsoPreview.tsx` — live iso-3D preview of the staged world, drawn by the game's
  OWN renderer (`WorldStatics` from `cart/hmsc/render3d/GameWorld3D`, exported for
  reuse) under an Isometric camera from `@reactjit/cameras`, with the matching
  `TileSurfaceCaptures` mounted so floors texture. No renderer fork → can't drift.
- `address.ts` — spreadsheet addressing (A0…DP119), a display/parse skin over the
  integer cell coords. Columns are bijective base-26; chunks are 120×120.
- `buildingEditor.ts` — face-editor resolvers (which building is under a cell,
  what skin each face shows). Skin resolution itself stays in `cart/hmsc/world/buildings.ts`.

Workflow: author top-down in 2D → preview live in iso-3D → Compile to the booted
world. Verify a change by bundling (`tools/v8cli scripts/cart-bundle.mjs hmsc-int`)
— do NOT ship; the user runs builds.
