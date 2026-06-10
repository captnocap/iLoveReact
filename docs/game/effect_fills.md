# effect_fills cart inventory

Source cart: `cart/effect_fills/` (`index.tsx` 370 lines + `cart.json` + `CATALOG.md`)
Load-bearing dependency: `cart/hmsc-int/render3d/fillShader.ts` (1653 lines — the actual shader)

Reviewed: 2026-06-04

## High-level purpose

`effect_fills` is the **procedural-texture evaluation gallery**: ~170 swatches, every one a single `<Effect>` quad running the same WGSL mega-shader (`FILL_SHADER`), parameterized by a 5-float data array `[materialId, variant, seed, quality, board]`. Eight boards (A–H) × 7–8 materials each × 3 authored variants, with a global runtime **quality grade** toggle (PSX → PS2 → Preview → Std → Max) applied across every swatch at once.

It is an *art-direction instrument*, not a tech demo: `CATALOG.md` maps every swatch ID to the scape3d thingymajigger/zone/system it's a candidate texture for, names the bake path, and ranks pull priorities against the game's TONE duality (Drive/Miami "dream" pole vs Spun "squalor" pole). The cart is also a **multi-AI authorship record**: boards A–D were authored by codex, E–F by Claude, G–H by Kimi — attribution carried in cart.json, board headers, and the source comments.

The cart itself is nearly stateless (one `useState` for the quality grade). The real engineering lives in the shader file and its game-side registration.

## Files touched by this behavior

- `cart/effect_fills/index.tsx`: the gallery — board/material tables, the seed-spread formulas, swatch grid, quality toggle.
- `cart/effect_fills/cart.json`: manifest (window 1120×860 + a description that doubles as the board map).
- `cart/effect_fills/CATALOG.md`: the eval document — ID scheme, per-swatch scape3d target tables, the two texture-integration paths, pull priorities, open questions. **Documentation as a first-class cart artifact** — the only cart in this series shipping its own catalog doc.
- `cart/hmsc-int/render3d/fillShader.ts`: **the canonical WGSL**. One exported template string: ~30 shared noise/pattern helpers (`rand`, `fbm`, `snoise`, `speckle`, `line_near`, `vertical_drips`, `blotch`, `crack_field`, `segment_mark`, `neon_grime`, …), then ~58 material functions (`road`, `brick`, `mold_wall`, `blade_steel`, `neon_tube`, `crt_screen`, `cash_stack`, `blood_pool`, `fogged_mirror`, `stained_glass`, `asphalt`, `plank_deck`, …), a per-board `quality_pass` finisher, and an `fs_main` dispatch chain. The header is explicit about ownership: *authored in effect_fills, canonical copy lives game-side* because the game's texture catalog registers these looks — "exactly one copy of the WGSL."
- `cart/hmsc-int/render3d/textureShaders.ts`: the game-side consumer — wraps every board material into a `ShaderSpec` (named, range-bounded, draggable params; "never a bare data[] of magic numbers") for the texture-studio Materialize pipeline.
- `runtime/primitives.tsx`: `Effect` (the one user-WGSL surface; `data` → `effectData` → storage buffer `D`), `ScrollView` (`showScrollbar`), Box/Col/Row/Text/Pressable.
- `v8_app.zig`: Effect prelude — provides the `U` uniforms the shader reads (`U.time`, `U.size_w`, `U.size_h`) and binds `D` at `@group(0) @binding(1)`.

## Host functions vs JavaScript functions

Cart-side host calls: **none**. The entire cart is declarative — the only "API" is the Effect contract: a 5-float `data` array crossing as `effectData` into the storage buffer, plus the host-supplied `U.time`/`U.size_*` uniforms that animate the live fills. Input is one `Pressable` row (quality toggle). All texture generation runs on the GPU per fragment; JS computes only the 5 floats.

## The parameter contract (the load-bearing interface)

```
D[0] materialId  — which material within the board
D[1] variant     — 0|1|2, the material's three authored takes
D[2] seed        — float; boards spread it via per-board prime formulas
D[3] quality     — 0 PSX · 1 PS2 · 2 Preview · 3 Std · 4 Max
D[4] board       — 0..7 = A..H
```

- **Swatch IDs are stable**: `<Board><NN>` where `NN = materialId*3 + variant + 1` (e.g. `E07` = Sunset Sky v0). Quality is a runtime grade *on top*, never baked into the ID — so an eval verdict ("pull E07") survives grade changes.
- **Seed spread** (`fillData`, index.tsx:104): each board uses a distinct prime-coefficient formula (`A: m*17 + v*5 + 3`, `B: m*23 + v*11 + 41`, … `H: m*47 + v*29 + 313`) so no two swatches anywhere share a seed. These coefficients are **duplicated** in `textureShaders.ts`'s `FILL_BOARDS[].seedCoef` so the game's specs reproduce the exact authored swatches — a two-copy invariant that must stay in sync (sync-by-hand hazard noted below).

## The shader (where the work is)

`fs_main` (fillShader.ts:1566): reads the 5 floats → optional UV quantization for retro grades (PSX snaps to a 32² grid, PS2 to 64²) → `px = uv * U.size` for resolution-aware speckle/dither → a board-then-material if/else dispatch into one of ~58 material functions → radial vignette → `quality_pass` → saturate.

Material functions are pure `(uv, px, variant, seed) → vec3f` color builders composed from the shared helper set — fbm bases, speckle grains, crack fields, drip masks, SDF line/segment marks. The `variant` float branches *within* a material (e.g. road v0 = dashed center line, v1 = side lines, v2 = plain).

**Animated fills** read `U.time`: water waves + caustics (A), grass wind (A), **neon tube buzz** (`sin(U.time*40)` flicker gated by a slower duty cycle), **CRT roll + per-frame static snow** (`floor(U.time*50)` reseeding), charcoal **ember** glow (G). The catalog marks exactly these as `Live?` and prescribes the expensive path only for them.

**`quality_pass`** (line 1505) is the unifying finisher: above Preview it *adds* detail (fine fbm grain, flecks, scratches scaled by `q`); below it applies the **retro register** — ordered-random dither, color quantization to 6–12 levels, partial desaturation, scanline-ish banding. Catalog framing: PSX/PS2 "is the game's intended retro register, not a downgrade." On top, each board gets a tone-specific grade: B/F get condemned shadow-mold + lint (squalor), E gets **bloom and almost no grime** ("the dream pole should read clean and lit"), G gets highlight frost-bloom that preserves translucency, H gets aggregate fleck that keeps SDF crispness. The TONE duality is enforced *in the post-pass*, not just in the palettes.

## Game-side consumption (why the shader lives in hmsc)

`textureShaders.ts` is the canonical texture-shader catalog (the LOCKED material-pipeline vocabulary: shader recipes → Materialize → stored material → per-tile/face slot; canvas = exactly 1 tile). `fillSpec()` (line 237) turns each board material into a `ShaderSpec`:

- base params: `seed` (default = the board formula's variant-0 seed) and `grade` (detail grade, default Std) as integer sliders;
- one variant entry per authored take, each carrying a `seedShift` param defaulting to the board formula's per-variant offset — so every spec opens on its exact authored swatch but every knob is tunable;
- `buildData` re-emits the 5-float layout.

`FILL_SPECS = FILL_BOARDS.flatMap(...)` registers all ~58 materials alongside the game's own ROAD shader. So the eval cart and the game texture studio are two front-ends over one WGSL + one data contract.

`CATALOG.md` prescribes the two integration paths (mirroring the `twod_on_3d_faces` memory): (1) **bake once → RGBA buffer → `Scene3D.Mesh textureKey`** content-hash cache for the static majority — one GPU texture shared across every user of a style; (2) **live `StaticSurface staticKey` → `Mesh textureKey`** only for buzz/roll/ember fills, since StaticSurface caches paint and animation requires per-frame re-render.

## Gallery structure (the cart code itself)

`EffectFills` renders a fixed header row (title + `QualityToggle` — 5 segmented buttons + the active grade's note) over a `ScrollView` of eight board sections. Each section = `BoardHeader` (title/subtitle, with authorship) + a `Row` of per-material `Col`s, each column = material name + 3 stacked `Swatch`es. `Swatch` = a 125×125 bordered Box containing the absolutely-positioned `<Effect>` plus a corner ID chip (`monospace` label like `E07`).

Code-shape note: there are **eight near-identical `*Column` components** (`MaterialColumn`, `GrungeColumn`, `PropColumn`, `ViceColumn`, `SurfaceColumn`, `ContraColumn`, `LiminalColumn`, `AltColumn`) differing only in board id, key prefix, and ID letter — a textbook collapse-to-one-parameterized-component candidate. Likewise the eight material-name tables in index.tsx duplicate the names in `textureShaders.ts`'s `FILL_BOARDS` *and* the tables in CATALOG.md — three copies of the material/variant naming.

Perf shape: ~170 simultaneous live Effect quads, each its own fragment shader pass over 125² px; `fillData` builds a fresh 5-float array per render, but the cart re-renders only on quality toggle, so there's no churn (and no StaticSurface, so no inline-data rebake trap).

## What is not here

- No host calls, no persistence, no picking/selection state — verdicts are recorded by humans in CATALOG.md, not by the cart.
- No bake button — the bake → `textureKey` path is prescribed in the catalog but executed elsewhere (texture studio / customTextures).
- No per-swatch param tweaking — that's textureShaders' job; the gallery is fixed authored takes only.
- No Scene3D — these are 2D quads; evaluating them *on meshes* under game lighting is the next step the catalog points at (lit meshes read darker; see the plane-culling memory's brightness note).
- Quality affects all boards globally; no per-board grade comparison side-by-side.

## Integration-relevant observations

- **The mega-shader-with-selector pattern** (one WGSL, `D[]` picks the look) is now the canonical texture architecture: one pipeline/shader-module for the whole material library, selection by uniform data instead of shader swaps. Same family as ShaderPixelIcon's palette-lookup quad but scaled to 58 materials.
- **Eval cart + catalog doc + game-side spec registration** is a complete authoring loop: author swatches → human eval against named game targets → registry specs with the same seeds. The piece that keeps it honest is the **shared data contract + duplicated seed coefficients**; any drift between `fillData` and `seedCoef` silently invalidates the eval. Extraction candidate: export the board/material/seed tables from one module both sides import (the shader file is the natural home).
- **Quality as a runtime grade** (retro quantize/dither at the low end, additive detail at the high end, per-board tone finishing) is a reusable idea for the whole game: one detail slider that means something artistic, not just LOD.
- **Stable swatch IDs** decoupled from runtime knobs is the right evaluation hygiene — IDs survived three authoring sessions across three different AIs without collision because the scheme is positional.
- **Multi-AI board authorship** worked here because the contract (data layout, helper library, ID scheme, board allocation) was fixed first — a useful precedent for parallel art generation.
- The catalog's "strongest candidates" list (stucco facade, sunset sky, CRT, baggie/blood pool) and its open question (textures pointing at thingymajiggers that don't exist — car, corkboard) are *game-planning* outputs living in a cart directory; the coherence pass should decide where such verdict docs belong.

## Glossary

Board: One of eight themed swatch sets (A Environment, B Condemned, C Props, D Neon Rot, E Neon Surface, F Contraband, G Liminal, H Second Pass); `D[4]` selects it.

Detail grade / quality: `D[3]` ∈ {PSX, PS2, Preview, Std, Max} — runtime finishing level: UV snap + dither + quantization below Preview, additive grain/scratch detail above.

Dream pole / squalor pole: The TONE.md duality the boards serve — E is the lit Drive/Miami register (bloom, no grime), B/D/F the condemned register (mold, lint, rot); enforced per-board in `quality_pass`.

FILL_SHADER: The single canonical WGSL fragment in `cart/hmsc-int/render3d/fillShader.ts` containing every material function; imported by both the eval cart and the game catalog.

fillSpec / ShaderSpec: textureShaders.ts's named, slider-bounded wrapper of one board material (seed + grade base params, per-variant seedShift) whose `buildData` re-emits the 5-float contract.

Live fill: A material reading `U.time` (water, grass, neon-tube buzz, CRT roll/static, embers) — must take the StaticSurface→textureKey live path, not the bake path.

Material function: A pure WGSL `(uv, px, variant, seed) → vec3f` look builder; ~58 exist, composed from the shared noise/pattern helper set.

quality_pass: The unifying post-pass — luma/grain/fleck/scratch finishing scaled by grade, per-board tone grading, and the retro dither/quantize register at PSX/PS2.

Seed spread: Per-board prime formulas (`m*17+v*5+3` etc.) giving every swatch a unique seed; duplicated as `seedCoef` game-side so specs reproduce authored swatches exactly.

Swatch ID: `<Board><NN>`, `NN = materialId*3 + variant + 1` — the stable evaluation handle; quality never changes it.

Variant: `D[1]` ∈ {0,1,2} — a material's three authored takes (e.g. road: center-dash / side-lines / plain), branched inside the material function.
