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
cards grew a `live` row — typing edits a **draft**, the binding (and its one
small compile) happens on Enter / the `bind` verb only — plus motion/scale
rows.

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
