# Editor painted flora

Active surface: `cart/editor/` and its `/play` route. Last verified: 2026-07-10.

## In one sentence

Map Paint stores tiny flora-kind indices in three RLE-friendly lanes, while a
fixed Zig recipe system expands those cells into literal grass, bushes, palms,
and shared wrapped tree/shrub species; every wrapped painted plant is one
24-byte GPU instance regardless of the shared mesh's detail.

## Authoring contract

`cart/editor/world/floraKinds.ts` is the cart-owned catalog and painter legend.
Its order is persisted by index, so it is append-only. The original nine entries
remain indices 0–8; the active additions append NW Pine, Maple, Oak, Western Red
Cedar, Spruce, Tall Grass, Reeds, Low Bush, Dense Bush, Mophead Hydrangea,
Panicle Hydrangea, Leafy Thicket, and Wild Weed Bush.

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
- 13–16: mophead hydrangea, panicle hydrangea, leafy thicket, wild weed

`framework/game/map/engine.zig` validates the pushed ids at its boundary.
Unknown recipe ids become inert rather than being clamped into a different
plant. Grass and bush shape variants select named `FoliageConfig` tuning tables.
Wrapped rows are deterministic from `(species, cellKey)` and carry position,
yaw, radius, height, and foliage tint.

## The plane wrapped around the tree

`framework/world/flora_geometry.zig` is the shared geometry boundary. It builds
each immutable wrapped mesh once when the loader is constructed:

- Pine, cedar, and spruce repeat one tapered branch plane around the trunk in
  staggered 360-degree tiers. This is the user's plane→cylinder drawing made
  literal without runtime lathe geometry.
- Maple and oak carry tapered swept branch tubes plus crossed broad crown cards,
  preserving the useful shape from the hmsc-era `PathTube`/`wood_probe` work.
- Mophead hydrangea wraps woody stems, ovate leaf cards, and round
  pink/purple/blue flower clusters into one mesh.
- Panicle hydrangea uses taller green stems and tapered cream-to-blush flower
  cones; leafy thicket builds a dense 360-degree broadleaf dome; wild weed uses
  airy green stems with narrow irregular leaves.

The old `cart/wood_probe.tsx` result (req_1149, `77cc25443`) was a lab-only demo;
it never entered Map Paint or the active editor. It remains reference, not a
second flora implementation.

## Render and memory contract

`world_loader.zig` expands painted cells off the frame thread into per-family
row sets, records chunk segments for frustum culling, and preserves the existing
elastic-buffer behavior. Short grass/flower/bush families may density-thin at a
distance; palm parts and whole wrapped-plant silhouettes always draw complete.

Wrapped meshes route through the existing `~frond~` pipeline. UV bands in
`framework/gpu/shaders.zig` distinguish feathered leaves, broad leaves, conifer
sprays, deciduous crowns, bark, shrub leaves, both hydrangea bloom shapes, weed
leaves, and green stems. Woody bark stays planted; stems flex lightly; leaves and
blooms sway. The renderer's `SlimInstance` remains compile-time asserted at 24
bytes. Every pine, maple, oak, cedar, spruce, hydrangea, thicket, or wild weed
uses exactly one GPU row for the whole plant. Palm remains the intentional
complex exception: one ordinary lit trunk row plus multiple 24-byte frond rows.

The `~frond~` pipeline has culling disabled and its half-Lambert lighting is
already double-sided. Wrapped geometry therefore emits each leaf, spray, and
bloom card once; the old coplanar reversed duplicate was pure vertex/overdraw.
That gate-driven correction cuts the four new shrub meshes from 660–756 vertices
to 414–486 without changing their silhouette or per-instance memory.

Within each named map document, each painted lane cell is still an `i16` kind
index inside that document's native row-RLE `painting.rmap`. Shared vertex
geometry is paid once per species, not once per painted cell.

## Compiled-world path

The optional FLORA game-file lump stays a recipe, not expanded geometry.
`world_loader.zig` accepts the new spec ids, produces one stride-13 staging row
per wrapped plant (the thirteenth value is only its batch shape id), then the GPU
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

Final gate witness: 784 wrapped shrub instances across the four new species,
149,164 visible triangles in 12 draw calls, rich-scene median 4.16 ms, and zero
spike windows through 60.0 seconds at the standard 1.15× / +500 µs detector.

## CHANGESET — req_2875 / req_2876

What: the active flora painter gains five real tree species plus grass and bush
shape variants. Why: the prior oak/PathTube outcome never left a probe cart, and
the painter exposed only palms. Affects: the editor flora catalog, native map
spec boundary, fixed foliage recipes, loader row families, shared tree geometry,
and the existing frond shader. Breaking changes: none; original legend and recipe
ids are unchanged, with all content appended.

## CHANGESET — req_2877

What: the bush lane appends mophead hydrangea, panicle hydrangea, leafy thicket,
and wild weed bush using the tree expansion's shared wrapped-mesh path. Why: the
generic multi-card bush/flower populations could vary density but not whole-plant
silhouette, bloom form, or garden-versus-wild character. Affects: the active
editor catalog, append-only recipe vocabulary, wrapped geometry registry,
loader family tables, and frond UV-band shader. Breaking changes: none; old
legend indices, recipe ids, and shape ids remain stable, and each new complete
plant is exactly one existing 24-byte GPU instance.
