// surfacePackage.ts — the Surface Package v1 contract (Surface Packages,
// PROJECTED_SURFACE_INTEGRATION.md; ruled req_4781/4782/4783, built req_4784).
//
// A Surface Package binds ONE registered surface module (the structural field
// authority — surfaces/*.wgsl, generated into the dispatch) to ONE appearance
// material, over an explicit chart domain, with frozen capture state and
// fail-closed bounds. The package is DATA: maps and build pieces reference an
// installed package by id plus instance parameters; nothing hot-loads
// arbitrary WGSL from map data.
//
// v1 scope (ruled):
// - STATIC only. The rack (time/phase/step) is authoring-time; `capture`
//   freezes the scrubbed values into plain params and the bake proceeds like
//   any static package (req_4782 — "when it effectively comes to playing the
//   game that would ideally be a static wall").
// - The consumer is the BUILD TOOL: a package rides a wall/roof piece's
//   per-side finish slot; the chart spans the wall RUN so cell addresses (and
//   every hash) continue across segments with no restart seam (req_4783 +
//   wall-identity req_4501). The studio model editor is NOT a consumer.
// - domain kind is chart2d only. charted-mesh/object3d/stitched tubes are
//   future contract room, deliberately absent here.
//
// The D[] section (`surfacePackageData`) is deliberately a fill-shaped row:
// [0..4] header, [5]=0 palette count, [6]=param count, then the module's
// @param values in registry order. The generated mat_param() reader therefore
// works INSIDE surface modules unmodified — the compute prepass binds this
// section at mat_data_base and every knob is data-speed. Package extras ride
// AFTER the shared sections, exactly like the region harness's domainScale.
import { D_DECL, fnBody, resolveMaterialFns, splitFillDispatch } from './compose';
import { MATERIALS, SURFACES, type RegistrySurface } from './_generated/registry';

export type SurfacePackageDomain = {
  kind: 'chart2d';
  /** How many meters one sp unit spans — the anti-tiling law rides on this:
   *  the chart feeds CONTINUOUS run meters, never a wrapped preview tile. */
  metersPerUnit: number;
  /** Chart-U period in sp units for closed rings (absent = aperiodic wall run). */
  periodicU?: number;
};

/** The frozen rack state (req_4782): captured at authoring time in the world
 *  editor, baked into the static package. These are BOOKKEEPING for the editor
 *  (what the author scrubbed to when capturing); the shader-visible effect of a
 *  capture lives entirely in `params` — a surface module's signature is pure
 *  (sp, seed), so animated contributions arrive as ordinary param values. */
export type SurfacePackageCapture = {
  time: number;
  step: number;
};

export type SurfacePackageV1 = {
  version: 1;
  /** Stable id (kebab-case slug) — the content-addressed asset key derives from it. */
  id: string;
  name: string;
  /** The registered surface module fn (surfaces/*.wgsl) — the ONLY formula authority. */
  surfaceFn: string;
  /** The catalog material shading the projected geometry (kind 'surface'). */
  appearanceFn: string;
  domain: SurfacePackageDomain;
  seed: number;
  capture: SurfacePackageCapture;
  /** Overrides for the module's @param knobs, keyed by param key. Absent keys
   *  ride the registry defaults. Values are clamped-validated to [min, max]. */
  params: Record<string, number>;
  /** Conservative displacement bounds in METERS — the fail-closed envelope the
   *  bake and broadphase trust. Generated heights outside them reject the bake. */
  bounds: { minDisplacement: number; maxDisplacement: number };
  /** Evaluation lattice spacing in METERS. The collision lattice must NEST in
   *  the render lattice (an integer multiple) so collision selects indices from
   *  the one generated buffer instead of evaluating the formula a second time. */
  evaluation: { renderSpacing: number; collisionSpacing: number };
  /** v1: static bake only. Streamed/revisioned collision is a later campaign. */
  collision: { mode: 'baked' };
};

const SURFACE_BY_FN = new Map(SURFACES.map((s) => [s.fn, s]));
const MATERIAL_BY_FN = new Map(MATERIALS.map((m) => [m.fn, m]));
const ID_RE = /^[a-z][a-z0-9-]*$/;

export function surfaceModuleFor(fn: string): RegistrySurface | null {
  return SURFACE_BY_FN.get(fn) ?? null;
}

/** Fail-closed validation — every returned string is a reason the package must
 *  not reach a pipeline, a bake, or a save. Empty array = valid. */
export function validateSurfacePackage(pkg: SurfacePackageV1): string[] {
  const errors: string[] = [];
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (pkg.version !== 1) errors.push(`unsupported version ${String(pkg.version)}`);
  if (!ID_RE.test(pkg.id)) errors.push(`id '${pkg.id}' is not a kebab-case slug`);
  if (typeof pkg.name !== 'string' || pkg.name.trim().length === 0) errors.push('name is empty');

  const module = SURFACE_BY_FN.get(pkg.surfaceFn);
  if (!module) errors.push(`surface module '${pkg.surfaceFn}' is not in the generated registry`);
  const appearance = MATERIAL_BY_FN.get(pkg.appearanceFn);
  if (!appearance) errors.push(`appearance material '${pkg.appearanceFn}' is not in the generated registry`);
  else if (appearance.kind !== 'surface') errors.push(`appearance material '${pkg.appearanceFn}' is kind '${appearance.kind}' — packages shade with 'surface' materials`);

  if (pkg.domain.kind !== 'chart2d') errors.push(`domain kind '${String((pkg.domain as { kind: string }).kind)}' — v1 supports chart2d only`);
  if (!finite(pkg.domain.metersPerUnit) || pkg.domain.metersPerUnit <= 0) errors.push('domain.metersPerUnit must be a positive finite number');
  if (pkg.domain.periodicU !== undefined && (!finite(pkg.domain.periodicU) || pkg.domain.periodicU <= 0)) {
    errors.push('domain.periodicU must be absent or a positive finite number');
  }

  if (!Number.isInteger(pkg.seed) || pkg.seed < 0 || pkg.seed > 0xffff_ffff) errors.push('seed must be an unsigned 32-bit integer');
  if (!finite(pkg.capture.time) || pkg.capture.time < 0) errors.push('capture.time must be a non-negative finite number');
  if (!Number.isInteger(pkg.capture.step) || pkg.capture.step < 0 || pkg.capture.step > 15) errors.push('capture.step must be an integer step index 0..15');

  if (module) {
    const known = new Map(module.params.map((p) => [p.key, p]));
    for (const [key, value] of Object.entries(pkg.params)) {
      const spec = known.get(key);
      if (!spec) errors.push(`param '${key}' is not declared by ${pkg.surfaceFn}`);
      else if (!finite(value) || value < spec.min || value > spec.max) {
        errors.push(`param '${key}' = ${String(value)} is outside [${spec.min}, ${spec.max}]`);
      }
    }
  }

  const { minDisplacement, maxDisplacement } = pkg.bounds;
  if (!finite(minDisplacement) || !finite(maxDisplacement)) errors.push('bounds must be finite');
  else {
    if (minDisplacement > 0 || maxDisplacement < 0) errors.push('bounds must contain zero — zero displacement is the base face');
    if (minDisplacement >= maxDisplacement) errors.push('bounds.minDisplacement must be below bounds.maxDisplacement');
  }

  const { renderSpacing, collisionSpacing } = pkg.evaluation;
  if (!finite(renderSpacing) || renderSpacing <= 0) errors.push('evaluation.renderSpacing must be a positive finite number');
  if (!finite(collisionSpacing) || collisionSpacing <= 0) errors.push('evaluation.collisionSpacing must be a positive finite number');
  if (finite(renderSpacing) && finite(collisionSpacing) && renderSpacing > 0) {
    const ratio = collisionSpacing / renderSpacing;
    if (Math.abs(ratio - Math.round(ratio)) > 1e-6 || Math.round(ratio) < 1) {
      errors.push('evaluation.collisionSpacing must be an integer multiple of renderSpacing (the collision lattice nests in the render lattice)');
    }
  }

  if (pkg.collision.mode !== 'baked') errors.push(`collision mode '${String((pkg.collision as { mode: string }).mode)}' — v1 bakes static collision only`);
  return errors;
}

/** Compile-speed identity (the recipeTopologyKey discipline): the key moves
 *  only when the composed WGSL or pipeline shape must move. Numeric values —
 *  seed, capture, params, bounds, spacing — are data-speed and excluded. */
export function surfacePackageTopologyKey(pkg: SurfacePackageV1): string {
  return `sp1:${pkg.surfaceFn}:${pkg.appearanceFn}:${pkg.domain.kind}:${pkg.domain.periodicU !== undefined ? 'periodic' : 'open'}`;
}

// ── the structural D section ────────────────────────────────────────────────
// Fill-shaped row (mat_param-compatible), then package extras. The Zig
// consumer mirrors these offsets; surfacePackage.test.ts locks them.
export const SURFACE_D_SEED_INDEX = 2;
export const SURFACE_D_PARAM_COUNT_INDEX = 6;
export const SURFACE_D_EXTRA_FLOATS = 8;

export type SurfacePackageDataLayout = {
  paramBase: number;
  paramCount: number;
  captureTimeIndex: number;
  captureStepIndex: number;
  metersPerUnitIndex: number;
  periodicUIndex: number;
  minDisplacementIndex: number;
  maxDisplacementIndex: number;
  renderSpacingIndex: number;
  collisionSpacingIndex: number;
  totalFloats: number;
};

export function surfacePackageDataLayout(paramCount: number): SurfacePackageDataLayout {
  const paramBase = SURFACE_D_PARAM_COUNT_INDEX + 1;
  const extrasBase = paramBase + paramCount;
  return {
    paramBase,
    paramCount,
    captureTimeIndex: extrasBase,
    captureStepIndex: extrasBase + 1,
    metersPerUnitIndex: extrasBase + 2,
    periodicUIndex: extrasBase + 3,
    minDisplacementIndex: extrasBase + 4,
    maxDisplacementIndex: extrasBase + 5,
    renderSpacingIndex: extrasBase + 6,
    collisionSpacingIndex: extrasBase + 7,
    totalFloats: extrasBase + SURFACE_D_EXTRA_FLOATS,
  };
}

/** Pack a validated package's structural D section. Returns null (loudly) for
 *  an unknown module — callers never push a stream the shader would misread. */
export function surfacePackageData(pkg: SurfacePackageV1): Float32Array | null {
  const module = SURFACE_BY_FN.get(pkg.surfaceFn);
  if (!module) {
    console.error(`[surfacePackage] unknown surface module '${pkg.surfaceFn}' — data not packed`);
    return null;
  }
  const values = module.params.map((p) => pkg.params[p.key] ?? p.default);
  const layout = surfacePackageDataLayout(values.length);
  const out = new Float32Array(layout.totalFloats);
  out[0] = 0; // materialId slot — unused by modules
  out[1] = 0; // variant — modules are variant-free
  out[SURFACE_D_SEED_INDEX] = pkg.seed;
  out[3] = 0; // quality — unused
  out[4] = 0; // board — unused
  out[5] = 0; // palette count — modules carry no palette
  out[SURFACE_D_PARAM_COUNT_INDEX] = values.length;
  values.forEach((value, i) => { out[layout.paramBase + i] = value; });
  out[layout.captureTimeIndex] = pkg.capture.time;
  out[layout.captureStepIndex] = pkg.capture.step;
  out[layout.metersPerUnitIndex] = pkg.domain.metersPerUnit;
  out[layout.periodicUIndex] = pkg.domain.periodicU ?? 0;
  out[layout.minDisplacementIndex] = pkg.bounds.minDisplacement;
  out[layout.maxDisplacementIndex] = pkg.bounds.maxDisplacement;
  out[layout.renderSpacingIndex] = pkg.evaluation.renderSpacing;
  out[layout.collisionSpacingIndex] = pkg.evaluation.collisionSpacing;
  return out;
}

/** The composed WGSL the compute prepass consumes: shared prelude + the
 *  package's surface module (plus everything it calls, transitively) + the
 *  sp_eval entry the pipeline invokes per lattice point. The projected
 *  compute harness (framework/gpu/shaders.zig projected_compute_prefix) owns
 *  the D declaration, so D_DECL is replaced — the ground/region discipline.
 *  Derivative built-ins are FRAGMENT-ONLY in WGSL, and the shared prelude's
 *  helpers use fwidth for their AA windows: a compute module cannot carry
 *  them, so every fwidth call is rewritten to a constant-width stub (cs_fw).
 *  Structural evaluation never needs screen derivatives — the affected
 *  helpers are appearance AA conveniences that just have to COMPILE here. */
export function surfaceEvalModule(pkg: SurfacePackageV1): string | null {
  const need = resolveMaterialFns([pkg.surfaceFn]);
  if (!need) return null;
  const { prelude } = splitFillDispatch();
  return [
    'fn cs_fw(v: f32) -> f32 { return 0.001; }',
    prelude,
    ...need.map((fn) => fnBody(fn)!),
    `fn sp_eval(sp: vec2f) -> SurfaceSample {
  return ${pkg.surfaceFn}(sp, D[${SURFACE_D_SEED_INDEX}]);
}`,
  ].join('\n')
    .replace(D_DECL, '// (D is declared by the projected compute harness — framework/gpu/shaders.zig)')
    .replaceAll('fwidth(', 'cs_fw(');
}

/** The composed WGSL the projected RENDER pass consumes: the appearance
 *  material (plus its transitive calls — including the surface module an
 *  adapter shades) behind `fn sp_rgb(sp, px) -> vec3f`. `appearanceUvScale`
 *  maps the continuous chart coordinate into the material's uv domain so the
 *  color cells land EXACTLY on the geometry cells (for an adapter material
 *  like brick, the scale inverts its internal cols/rows so the module inside
 *  sees the same sp the compute prepass fed — one cell address everywhere).
 *  Per-fragment re-evaluation is LAW (ruled amendments): geometry density
 *  never blurs the appearance. */
export function projectedRenderModule(
  pkg: SurfacePackageV1,
  appearanceUvScale: [number, number],
): string | null {
  const need = resolveMaterialFns([pkg.appearanceFn, pkg.surfaceFn]);
  if (!need) return null;
  const { prelude } = splitFillDispatch();
  const w32 = (v: number) => {
    const s = String(v);
    return /[.e]/.test(s) ? s : `${s}.0`;
  };
  return [
    prelude,
    ...need.map((fn) => fnBody(fn)!),
    `fn sp_rgb(sp: vec2f, px: vec2f) -> vec3f {
  return ${pkg.appearanceFn}(sp * vec2f(${w32(appearanceUvScale[0])}, ${w32(appearanceUvScale[1])}), px, 0.0, D[${SURFACE_D_SEED_INDEX}]);
}`,
  ].join('\n')
    .replace(D_DECL, '// (D is declared by the projected render harness — framework/gpu/shaders.zig)')
    .replace(/\bU\.time\b/g, 'S.time');
}
