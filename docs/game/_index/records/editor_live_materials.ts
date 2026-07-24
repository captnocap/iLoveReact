import type { DocIndex } from '../types';

export const editor_live_materials: DocIndex = {
  name: 'editor_live_materials',
  file: 'editor_live_materials.md',
  cart: 'cart/editor/render3d/regionFormula.ts',
  purpose: ['rendering', 'texture_bake', 'ui'],
  summary:
    'Live material regions (req_3394-3397, the lavalamp arc): texture slots wearing a liveMaterial render their faces per-frame over OBJECT-SPACE position through a host region pipeline — one continuous animated field across N faces (no per-face restarts/seams). Formula static (ground-look pattern), picks are data; membership is slot-bound host truth; a LightRig colorFrom makes the lamp glow follow the goo via host-stepped palette blending.',
  interfaces: [
    {
      name: '__model_region_formula / __model_region_bind_slot / __model_region_set / __model_region_clear',
      purpose: ['rendering', 'host_bridge'],
      kind: 'host_fn',
      sourceFile: 'framework/v8_bindings_core.zig',
      description:
        'The region doors: push the composed WGSL once (hash-gated in ensureRegionPipeline — picks never recompile), then bind regions as DATA. bind_slot resolves faces HOST-side from model_source.faceMaterialOf at draw time (face_materials_gen invalidation), so assign/cut/undo need no JS re-push; region_set takes an explicit face list for non-resident meshes. Regions draw as indexed overlays into the retained vertices at depth less_equal, after ground, before transparent — glass shells blend over their lava.',
      dependsOn: ['scene3d_region_prefix/epilogue (framework/gpu/shaders.zig)', 'model_source.faceMaterialOf'],
      consumers: ['cart/editor/stage/ModelView.tsx'],
      status: 'live',
    },
    {
      name: 'buildRegionFormula + buildRegionData',
      purpose: ['rendering', 'texture_bake'],
      kind: 'utility',
      sourceFile: 'cart/editor/render3d/regionFormula.ts',
      description:
        'Composes the region formula PER BOUND-MATERIAL SET, never per catalog (req_3400: composing all 410 materials was 735 KB WGSL and froze the app for minutes in naga; one material is ~19 KB, sub-second). Brace-extracts just the bound fn bodies from FILL_FUNCS (+ helpers prelude + transitive material calls, drift-guarded), mat_pal ACTIVE (palette recoloring works like paint inks), U.time→S.time, small if-chain dispatch under a triplanar region_rgb (p.yz/p.xz/p.xy, |normal|-weighted, deliberately UN-fracted so continuous materials never seam). Set changes recompile (hash-gated); variant/seed/palette/scale are data. buildRegionData packs a ModelLiveMaterial into the D stream; unknown fns return null loudly.',
      dependsOn: ['render3d/shaders/_generated/dispatch FILL_FUNCS'],
      consumers: ['cart/editor/stage/ModelView.tsx', 'cart/editor/inspector/RigSection.tsx'],
      status: 'live',
    },
    {
      name: 'ModelTextureSlot.liveMaterial + LightRig.colorFrom',
      purpose: ['ui', 'rendering'],
      kind: 'utility',
      sourceFile: 'cart/editor/model/modelTextureSlotAuthoring.ts',
      description:
        'The persistence contract: a slot may wear liveMaterial { fn, variant, seed, scale, palette } (normalizeModelLiveMaterial guards hand-edited manifests); a rig light may wear colorFrom = a live slot id (normalizeModelLights carries it). Rig panel: FACE RIGS cards grew a type-to-bind `live` row + motion/scale; the light editor grew `glow from`. ModelView pushes bindings keyed on the mesh hostKey and hands colorFromRegion (slot index) to the emitted lights; the host steps the light color from the region palette on the render wall-clock (regionLightRgb, 3d.zig) — no JS in the frame loop, no readback.',
      dependsOn: ['scene3d_light_region node field (framework/layout.zig, v8_app.zig)'],
      consumers: ['cart/editor/stage/Stage.tsx', 'cart/editor/stage/ModelDocumentSurface.tsx'],
      status: 'live',
    },
    {
      name: 'lava_plasma catalog material',
      purpose: ['rendering'],
      kind: 'shader',
      sourceFile: 'cart/editor/render3d/shaders/materials/lava_plasma.wgsl',
      description:
        'The four-wave sine plasma (runtime/effects/Plasma.tsx) as a catalog fill — board neon_surface, materialId 58, 3 palette slots (primary/secondary/tertiary), variants retune motion only (Classic Wave / Fast Storm / Slow Churn — the lavalamp mode). The reference material for the object-space domain: pure sin, continuous everywhere.',
      consumers: ['cart/editor/render3d/regionFormula.ts'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'formula static, picks are data (regions edition)',
      purpose: ['rendering'],
      description:
        'Same law as the painted ground (req_2693): the region WGSL compiles once per run/hot-reload; binding a material, changing a variant, or recoloring a palette ships floats, never source. And the region DOMAIN is object space, never per-face UV — continuity across faces must come from the domain (req_3395 ruling in the arc), so never reintroduce per-face bases for region-spanning materials.',
      examples: ['editor_live_materials'],
      status: 'resolved',
    },
  ],
  hazards: [
    {
      name: 'never compose the whole catalog into a live pipeline',
      purpose: ['rendering', 'shader'],
      description:
        'req_3400: the whole generated dispatch is megashader-class (735 KB and growing with the catalog) — pushing it into a pipeline that compiles ON the render thread numbs the entire app for minutes. Regions only ever draw their BOUND materials, so compose the subset. The painted ground legitimately needs the full catalog and pays its one narrated compile per run; do not let any new live pipeline copy that shape without the ground\'s justification. UI corollary: any control whose commit triggers a shader compile must be a deliberate VERB (Enter/bind), never a per-keystroke side effect.',
      evidence: ['cart/editor/render3d/regionFormula.ts', 'docs/game/_requests/req_3400.json'],
      severity: 'high',
    },
    {
      name: 'regions preview only in the editor render path',
      purpose: ['rendering'],
      description:
        'Placed props in WorldViewport and the (not-yet-existing) compiled route do not evaluate live regions yet — only the ModelView resident mesh does. Wiring livePush/world placement is the follow-up; light colorFrom tier 2 (the light PROJECTS the field onto walls via the material fn in lamp space) is designed in req_3396 but unbuilt.',
      evidence: ['cart/editor/world/livePush.ts', 'docs/game/_requests/req_3396.json'],
      severity: 'medium',
    },
    {
      name: 'un-fracted triplanar changes framed materials',
      purpose: ['rendering'],
      description:
        'region_rgb passes continuous scaled coords (no fract) so animated fields never seam — but materials whose look depends on the [0,1] uv frame (edge vignettes like plasma_glass, framed compositions) read differently as regions than as tiles. Pick continuous-friendly surface materials; do not "fix" this by fracting the domain (that reintroduces seams at every tile boundary).',
      evidence: ['cart/editor/render3d/regionFormula.ts'],
      severity: 'low',
    },
  ],
};
