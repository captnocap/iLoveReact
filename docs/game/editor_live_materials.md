# editor_live_materials — live material regions on model faces (req_3394–3397)

The lavalamp capability: faces of a model bound to a catalog material that the
host evaluates **per frame over object-space position**, instead of baking to
the paint atlas. One region spanning N faces samples ONE continuous animated
field — continuity is a property of the domain, so there are no per-face
restarts and no seams (the "every face = brand new full instance paint"
compounding failure this arc was opened about, req_3395).

## The three layers

**Host (framework/gpu).** `scene3d_region_prefix/epilogue` (shaders.zig) + a
region pipeline built by `ensureRegionPipeline` (3d.zig) — the exact
ground-look pattern: the cart pushes ONE composed WGSL body defining
`region_rgb(p: vec3f, n: vec3f) -> vec3f` via `__model_region_formula`
(hash-gated; picks never recompile), and per-region material data arrives as a
D stream (spec data[] + palette section + domainScale) through
`__model_region_bind_slot` / `__model_region_set`. Each region draws as an
**indexed overlay** into the mesh's retained vertices at depth `less_equal`
(same triangles as the base draw → equal depth → region wins), between the
ground pass and the transparent pass — so a glass shell (transparent pass)
blends over its lava. Regions are emissive (self-lit) + aerial fog.

**Slot-bound membership.** `__model_region_bind_slot(key, regionId, slotIndex,
data)` resolves faces HOST-side at draw time from `model_source.faceMaterialOf`
— `face_materials_gen` bumps on every face-material write, so assigning more
faces, cuts, and undo flow into the region with **no JS re-push**. The general
`__model_region_set(key, regionId, facesU32, data)` takes an explicit face
list for non-resident meshes.

**Cart (cart/editor).** `render3d/regionFormula.ts` composes the formula
**per bound-material SET, never per catalog** (req_3400: the first cut
composed all 410 materials — 735 KB of WGSL — and froze the app for minutes in
naga; a one-material module is ~19 KB, sub-second). `buildRegionFormula(fns)`
brace-extracts just the bound fn bodies out of `FILL_FUNCS` (plus the helpers
prelude and any material fn they call) with drift guards, keeps `mat_pal`
ACTIVE (regions carry a real palette section — recoloring works like paint
inks), rewrites `U.time → S.time`, and emits a small if-chain dispatch under
the triplanar `region_rgb` (p.yz / p.xz / p.xy, |normal|-weighted,
deliberately **un-fracted** so continuous materials never seam). Changing the
bound SET recompiles (hash-gated); variant/seed/palette/scale are pure data.
`ModelTextureSlot` gains `liveMaterial { fn, variant, seed, scale, palette }`
(manifest-normalized in modelTextureSlotAuthoring.ts); ModelView pushes
formula + per-slot data keyed on the mesh hostKey; the Rig panel's FACE RIGS
cards grew a `live` row — a thumbnail of the bound material + a `pick` verb
opening the shared thumbnail picker — plus motion/scale rows.

**Materials are picked BY LOOK, never by name (req_3401, user ruling: "i dont
know the shaders by any formal name only by the way they look").** The picker
is ONE organ: `shell/MaterialPickerPopover.tsx` (paged live-thumbnail grid +
variant chips + scrim, rendered at the app root), which MapTexturePicker (the
map brush look) now also rides. A pick patches the slot and the popover stays
open, so looks compare live on the mesh. No surface may resolve a material
from a typed string.

## The light follows the goo (req_3396 tier 1)

`LightRig.colorFrom = <slot id>` → ModelView passes `colorFromRegion` (slot
index) on the emitted Point/SpotLight → `scene3d_light_region` node field →
drawScene overrides that light's color from the region's **palette slots**,
host-stepped on the same wall-clock the shader animates with (`regionLightRgb`,
3d.zig). Zero JS in the frame loop, zero GPU readback — the material is a
procedural program whose palette is data. The Rig light editor's `glow from`
row cycles fixed-color ↔ live slots. Tier 2 (light *projects* the field onto
receiving surfaces via the same material fn in lamp space) is designed
(req_3396 resolution) and not yet built.

## Authoring a lavalamp

1. Model the lamp: glass shell part (glass = atlas alpha), inner blob part.
2. Face mode → select the blob's faces → FACE RIGS **M** (new slot).
3. On the slot card: `live` → type `lava plasma` (motion: Slow Churn).
4. EMITTED LIGHTS **+** → `glow from` → the lava slot.
5. Save. The binding persists in the manifest's `textureSlots[].liveMaterial`.

`lava_plasma` (materials/lava_plasma.wgsl, board neon_surface, id 58) is the
reference material — the four-wave sine plasma from runtime/effects/Plasma.tsx
as a catalog fill with 3 palette slots (primary/secondary/tertiary).

## Boundaries / follow-ups

- Regions preview in the **editor render path** (ModelView viewport). Placed
  props in the world and the compiled route are follow-ups (compile does not
  exist yet — user ruling req_3397: the old compiled worlds are prior-era).
- REGION_POOL = 16 simultaneous regions; REGION_DATA_FLOATS = 256 (overflow is
  loud, truncation logged).
- Framework changes require a host rebuild; the JS side hot-reloads.

## The Material Lab (req_4395)

The Color Studio bench is replaced by the **Material Lab** for catalog
materials: any of the 410 fill materials opens as the BASE of a stackable
recipe — surface layers through `surface_blend` kinds, field-atom masks,
warp-atom domain distortions, colormod filters — compiled deterministically to
ONE standard-signature fn (`render3d/shaders/recipe.ts`; architecture doc:
`render3d/shaders/LAB.md`, atom authoring: `render3d/shaders/ATOM_CONTRACT.md`).

- **Two-speed law**: the shader string is a function of TOPOLOGY only
  (`recipeTopologyKey`); every number — opacities, thresholds, warp amounts,
  atom `@param` knobs, palette colors — rides the D[] palette/param sections
  (`mat_pal` / `mat_param` with call-site offsets), zero recompiles.
- **Atoms** live in `render3d/shaders/atoms/` (field/warp/colormod, exact
  per-kind signatures, prefix-enforced), swept by the same build-shaders run,
  shaken into composed modules only when called.
- **Save to catalog** (`catalogPromotion.ts`) emits a real materials/*.wgsl
  with the recipe JSON embedded (`@recipe-json` → `RegistryMaterial.recipe`),
  runs the generator through the host exec door, and the material joins every
  picker with a stable id; reopening it in the Lab is editable.
- **The color library is REAL end to end** (req_3097 + req_4395): SAVED +
  RECENTS + named SETS persist in `userdata/editor/color-library.json`; the
  hardcoded SPINE_LIBRARY sets and PIGMENTS dabs live on only as deletable
  starter sets. Lab recipes persist per-concern in
  `userdata/editor/lab-recipes.json`.
- The D[] param section rides AFTER the palette section; the region harness
  packs it explicitly before `domainScale`, and the painted-ground harness
  neutralizes `mat_param` exactly like `mat_pal`.
