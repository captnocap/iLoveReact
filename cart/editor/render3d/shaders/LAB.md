# The Material Lab — architecture as built (req_4395)

The Lab replaces the Color Studio's Material Palette bench: start from any
catalog material, stack layers (surfaces through blend modes and field-atom
masks, colormod filters, warp-atom domain distortions), tune every exposed
number live, and promote good results into the catalog as first-class
materials. Bad experiments get deleted; nothing special-cases a promoted
material anywhere downstream.

## The two-speed contract

- **Data-speed (ZERO recompile):** variant, seed, quality, every palette color,
  every tunable scalar — layer opacities, mask thresholds/softness, warp
  amounts, colormod amounts, and atom/material `@param` knobs. All of it rides
  the `D[]` sections below; the shader string is a pure function of the
  recipe's TOPOLOGY (`recipeTopologyKey`), so slider drags and commits never
  build a pipeline. The Lab inspector shows a live `composed N×` counter — the
  proof surface.
- **Compile-speed (sub-second):** add/remove/reorder/enable layers, atom or
  blend swaps, mask/warp atom changes, layer variant/seed pins. These
  recompose a per-recipe module through the same `compose.ts` machinery as
  every other per-set consumer (req_3473) — tens of KB, never the catalog.

## The D[] contract (full layout)

Every fill consumer — single previews, packed grids, region bindings — reads
one row shape. Sections default cleanly: a shorter row simply stops earlier,
and every reader falls back to its baked constant, pixel-identically.

| index | meaning |
|---|---|
| `D[0]` | materialId (recipe modules ignore it; stage modules read it as the stage index) |
| `D[1]` | variant |
| `D[2]` | seed |
| `D[3]` | quality (FILL_GRADES index) |
| `D[4]` | board index |
| `D[5]` | palette slot count `n` |
| `D[6 + 3i]` … | slot `i` RGB (i < n) — read by `mat_pal(i, baked)` |
| `D[6 + 3n]` | param count `p` |
| `D[7 + 3n + j]` | param `j` value (j < p) — read by `mat_param(j, baked)` |
| after | harness extras (the region harness appends `domainScale` here) |

Packed grids (`FILL_GRID_DATA` envelope) prepend an 8-float header + a cell
offset table; each cell offset points at a row of the shape above. Inside a
grid `arrayLength` spans every row, so the packers append explicit zero
palette/param counts — the counts are the only fence between rows.

`mat_pal` / `mat_param` add module-private `mat_slot_offset` /
`mat_param_offset` before indexing. Ordinary materials leave both at zero; a
composed recipe sets them around each call site so every layer's colors and
knobs land in the recipe's own flat tables.

## The recipe (data → one WGSL fn)

`recipe.ts` owns the schema and the ONLY emitter. A `MaterialRecipe` is
`base {fn, variant?, seed?, warp?, palette?}` + ordered layers
`{atom, variant?, seed?, blend?, opacity?, amount?, mask?, warp?, enabled?,
palette?}` + `params` (stored callee-knob values). Compiled deterministically
to `fn recipe_<id>(uv, px, variant, seed) -> vec3f` — indistinguishable from a
hand-written material.

- `recipeParams` / `recipeSlots` — the ONE walk that assigns table indices;
  the emitter and the inspector both read it, so they can never disagree.
- `recipeShader` — prelude + only the bodies the stack calls + the recipe fn +
  a `fill_pick` that always evaluates it + the standard `FILL_MAIN`.
- `recipeStageShader` / `recipeStageData` — every stage prefix in ONE module
  dispatched by materialId: the intermediates strip is one packed-grid Effect.
- `recipeData` — the full-table row (palette + params, stored values resolved).
- Masks sample the UNwarped uv (the mask stays put while content warps).
  Warps and colormods obey `amount = 0 ⇒ identity`.

## Save to catalog (promotion)

`catalogPromotion.ts` emits the recipe as a real `materials/<fn>.wgsl`:

- `@param` lines in the session table's exact order — structural tunables as
  body identifiers, callee knobs as no-op anchor lets — so the generator's own
  rewrite lands every value at the offset the body's rebasing expects.
- Dummy slot lets carry the resolved colors in flat-table order (exact 0/1
  triples nudged by 0.001 past the extraction filter).
- The recipe JSON rides a trailing `// @recipe-json` line; the generator lifts
  it into `RegistryMaterial.recipe`, and entering the Lab on a promoted
  material reopens it editable.
- The save verb writes the file and runs `build-shaders.ts` through the host
  exec door; ids.json assigns the stable id; hot reload delivers the material
  to every picker. Deleting the working recipe never touches the catalog copy.

Because every fill spec's default data row now carries the registry palette +
param tables explicitly (`withPalette`/`withParams`, section-aware), a promoted
recipe renders its STORED look everywhere — thumbnails, paint inks, region
bindings — while hand-written materials stay pixel-identical (their tables
equal their baked constants).

## Persistence & undo

- Recipes: `userdata/editor/lab-recipes.json` (per-concern V20 store,
  debounced micro-save; experiments survive restarts until deleted).
- Colors: `userdata/editor/color-library.json` — SAVED tray + RECENTS
  (req_3097) + named SETS (req_4395; files without a `sets` field seed
  deletable starters once — the old SPINE_LIBRARY hardcode and PIGMENTS dabs
  live on only as starter sets).
- Undo: lab edits snapshot whole recipes into `labHistoryRef` (cap 32),
  publish on the 'material' depth channel while the Lab owns the view, and
  claim `undo-local`/`redo-local` ahead of the studio's registered commands.

## Consumers & fallbacks

Non-registry specs (the layered road shader, imported UV patches) cannot base
a recipe — they keep the original palette-slot panel. The region path packs an
explicit param section before `domainScale`; the painted-ground harness
neutralizes BOTH readers (its D stream is cells, not tables). The full catalog
plus readers is naga-validated; drift in any generated shape fails loud in
`compose.ts` / `groundFormula.ts` guards.
