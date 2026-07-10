# Editor painted flora

Active surface: `cart/editor/` and its `/play` route. Last verified: 2026-07-10.

## In one sentence

Map Paint stores tiny flora-kind indices in three RLE-friendly lanes, while a
fixed Zig recipe system expands those cells into literal grass, bushes, palms,
and shared-mesh tree species; every non-palm painted tree is one 24-byte GPU
instance regardless of the shared mesh's detail.

## Authoring contract

`cart/editor/world/floraKinds.ts` is the cart-owned catalog and painter legend.
Its order is persisted by index, so it is append-only. The original nine entries
remain indices 0–8; the active additions append NW Pine, Maple, Oak, Western Red
Cedar, Spruce, Tall Grass, Reeds, Low Bush, and Dense Bush.

Each definition owns its `[spec, count, chance]` population record. `FLORA_SPECS`
is derived from that same table rather than maintained as a parallel flat list.
`cart/editor/stage/mapPaint.ts` pushes the table through `mapSetFloraSpecs` when
the native map layer is seeded. The host painter stores only the flora kind index
in the structural `grass`, `tree`, or `bush` lane; a cell may hold all three.

## Fixed recipe system

`framework/world/foliage.zig` owns the append-only recipe vocabulary:

- 0–3: grass, bush, flowers, palm (the existing wire ids)
- 4–8: pine, maple, oak, cedar, spruce
- 9–12: tall grass, reeds, low bush, dense bush

`framework/game/map/engine.zig` validates the pushed ids at its boundary.
Unknown recipe ids become inert rather than being clamped into a different
plant. Grass and bush shape variants select named `FoliageConfig` tuning tables.
Tree rows are deterministic from `(species, cellKey)` and carry position, yaw,
crown radius, height, and leaf tint.

## The plane wrapped around the tree

`framework/world/flora_geometry.zig` is the shared geometry boundary. It builds
each immutable tree mesh once when the loader is constructed:

- Pine, cedar, and spruce repeat one tapered branch plane around the trunk in
  staggered 360-degree tiers. This is the user's plane→cylinder drawing made
  literal without runtime lathe geometry.
- Maple and oak carry tapered swept branch tubes plus crossed broad crown cards,
  preserving the useful shape from the hmsc-era `PathTube`/`wood_probe` work.

The old `cart/wood_probe.tsx` result (req_1149, `77cc25443`) was a lab-only demo;
it never entered Map Paint or the active editor. It remains reference, not a
second flora implementation.

## Render and memory contract

`world_loader.zig` expands painted cells off the frame thread into per-family
row sets, records chunk segments for frustum culling, and preserves the existing
elastic-buffer behavior. Short grass/flower/bush families may density-thin at a
distance; palm parts and whole-tree silhouettes always draw complete.

Non-palm tree meshes route through the existing `~frond~` pipeline. UV bands in
`framework/gpu/shaders.zig` distinguish feathered leaves, broad leaves, conifer
sprays, deciduous crown cards, and bark. Bark suppresses wind; canopy cards sway.
The renderer's `SlimInstance` remains compile-time asserted at 24 bytes. A pine,
maple, oak, cedar, or spruce uses exactly one such GPU row for the whole tree.
Palm remains the intentional complex exception: one ordinary lit trunk row plus
multiple 24-byte frond rows.

Map storage is unchanged: each painted lane cell is still an `i16` kind index
inside the native row-RLE map store. Shared vertex geometry is paid once per
species, not once per painted cell.

## Compiled-world path

The optional FLORA game-file lump stays a recipe, not expanded geometry.
`world_loader.zig` accepts the new spec ids, produces one stride-13 staging row
per non-palm tree (the thirteenth value is only its batch shape id), then the GPU
packs the first twelve values into the same 24-byte slim instance. This prepares
the compiled loader without adding new work to the previous-era hmsc authoring
surface.

## Verification

- `zig build test-world-flora -Doptimize=ReleaseFast`
- `zig build test-game-map -Doptimize=ReleaseFast`
- no-V8 `world_loader` ReleaseFast compile
- `cart/editor/world/floraKinds.test.ts` through `tools/esbuild` + `tools/v8cli`
- editor ReleaseFast ship/self-shot and the repository's 60-second frame-time
  gate before review

## CHANGESET — req_2875 / req_2876

What: the active flora painter gains five real tree species plus grass and bush
shape variants. Why: the prior oak/PathTube outcome never left a probe cart, and
the painter exposed only palms. Affects: the editor flora catalog, native map
spec boundary, fixed foliage recipes, loader row families, shared tree geometry,
and the existing frond shader. Breaking changes: none; original legend and recipe
ids are unchanged, with all content appended.
