# Capture note — game/items/ (V11, capture wave, 2026-06-05)

The items registry + model definitions REWRITTEN fresh into
`cart/hmsc-int/game/items/`. `cart/game_item_gallery/index.tsx` (779 lines) is
the untouched behavior reference (V15-TRANSITION). The gallery's
browsing/authoring UI is fenced OFF to the editors wave (`editors/items/`,
which also owns the V11 scale-audit workbench).

## Sources (read, never moved/copied/imported)

| piece | reference location | what it contained |
|---|---|---|
| ITEMS registry | `index.tsx:443-463` | 19 ids × {label, tone, note, model fn} |
| 19 model fns | `index.tsx:205-439` | JSX emitters over Part() — geometry/params/material/textureKey/p/r/s literals |
| 4 custom generators | `index.tsx:96-165` | Blade, Sail, BoatHull, Surfboard `def(id, defaults, generate)` over `mesh()` |
| texture keys | `index.tsx:12-24` | 13 StaticSurface keys the textured parts bind |

## Changed shape (same content, constitution's bar)

- **Models are PART TABLES, not JSX.** At identity ctx (origin 0, yaw 0,
  scale 1) the reference's `local/scl/rot` transforms are identity, so every
  `<Part>` reduces to its literal props. Each model fn became a
  `parts: ItemPart[]` array (every `.map()` statically expanded: pitchfork
  tines, vehicle wheels, pills, weed leaves+buds, cigarette tips+filters).
  The registry imports zero React — the figure lane's React-free-door
  precedent; a renderer or the bake maps parts → Scene3D.Mesh rows
  (`feedback_react_3d_is_authoring_not_runtime`).
- **`scaleStatus: 'unaudited'` on all 19** (V11: the audit is mandatory and
  has not happened). The authored numbers are carried VERBATIM — including
  the ruling's evidence: the sailboat is 1.35m long and the knife ~1.31m
  (tested, documented, deliberately NOT fixed — fixing scale is the audit's
  job, against R4's 1-tile=1m).
- **`approxItemBoundsMeters`** gives the audit numeric starting data
  (rotation-ignoring, position-centered approximation; documented as rough).
- **Texture keys renamed** into a fresh canonical namespace
  (`game-items/<id>[/<face>]`, `ITEM_TEXTURE_KEYS`) — the old
  `game-item-gallery-*-ui` keys belong to the gallery's mounted surfaces.
- **Custom generators rewritten as @reactjit/geometries-style pure
  `generate(params)` fns** with fresh ids (`game-items/blade-v1`, ...);
  defaults in `ITEM_GEOMETRY_DEFAULTS` (P2).
- One geometry name table (`ITEM_GEOMETRIES`: box/cylinder/cone/sphere/torus
  from `@reactjit/geometries` + the four customs) — parts reference geometry
  by NAME; the framework knows zero shape names.

## Deliberately NOT carried

- **Texture CONTENT** (the StaticSurface JSX labels, the cash/football/
  basketball WGSL, the CRT TV dashboard): mounted-surface authoring — it
  needs a React render target and belongs with the materials/texture capture
  + `editors/items/`. The registry carries the KEY slots (the material
  pipeline rule: old textureKey slots survive).
- **Gallery UI** (GalleryScene, Pedestal, ItemButton, orbit-drag, TV crawl
  ticker): browsing chrome — editors wave.
- **ModelCtx/local/scl/rot/Part runtime**: the identity-fold made them
  table columns; placement transforms belong to whoever instantiates parts
  (renderer/bake), not the registry.

## Verification

- 8 P4 cases (`items.test.ts`), all green under `tools/v8cli`:
  19 ids in reference order; per-item part counts (73 total after static
  expansion); structural invariants over every part (resolvable geometry,
  `#rrggbb` materials, texture keys defined, white-under-texture rule);
  spot-checked literals (knife/vehicle/cigarettes/sailboat); generator
  triangle counts + extents as exact functions of params; the V11
  boat≈knife evidence; finite positive sub-3m bounds for all 19.
- Fidelity method: the input space is literal (JSX props at identity ctx),
  so the sweep is transcription verification — counts pinned for all 19,
  literals spot-pinned. A numeric vertex sweep against the reference
  generators would require importing the reference (forbidden); extents
  and triangle counts pin the same math.
- `rjit game verify`: **GREEN — 21/21 suites, 2/2 scripts** (door test
  updated: GAME_ITEMS moved pending → live, interface asserted).

## Commands handshake

NO not-yet stub flips: the 48-command hmsc vocabulary contains no
item-targeting command (it predates the items system). An items-inspection
command (the `wv_tile` analogue over GAME_ITEMS) would be NEW vocabulary —
surfaced to the supervisor, not invented here.

## Ambiguities surfaced (NOT guessed)

1. **physics_lab's ITEM_CATALOG**: V11 says it "folds in after review" — the
   review has not happened. Not folded; the catalog stays where it is until
   ruled.
2. **`vehicle` item vs V10**: the registry carries the gallery's `vehicle`
   item verbatim, but V10 rules vehicle_lab as THE vehicle source. Whether
   the items registry should keep a toy vehicle (pickup/prop sense) or defer
   to GAME_VEHICLE is a ruling, not a capture decision.
3. **Item TYPE data**: scape's item modules carry type/cost/RangeProfile/
   enables (`cart/scape/registries/items.ts`) — gameplay semantics this
   V11 capture deliberately does not invent. The reference has only
   look + idea; merging scape's type layer is its own decision (V9/V12
   adjacent).
4. **`weed` leaf geometry**: the reference reuses the Surfboard generator
   for leaves (params length 0.46). Carried as-is — if leaves deserve their
   own generator, that's authoring work for the editor wave.
