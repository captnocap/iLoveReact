// surfacePackage.test.ts — the Surface Package v1 contract suite (req_4784).
// Locks the fail-closed validation gates, the compile-speed topology key, the
// exact structural D-section layout the Zig consumer will mirror, and the
// one-formula-authority integration: brick's material resolves its surface
// module transitively through every composer.
import {
  SURFACE_D_PARAM_COUNT_INDEX,
  SURFACE_D_SEED_INDEX,
  projectedRenderModule,
  surfaceEvalModule,
  surfacePackageData,
  surfacePackageDataLayout,
  surfacePackageTopologyKey,
  validateSurfacePackage,
  type SurfacePackageV1,
} from './surfacePackage';
import { D_DECL, fillShaderFor, fnBody, resolveMaterialFns, splitFillDispatch } from './compose';
import { SURFACES } from './_generated/registry';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const BRICK_WALL: SurfacePackageV1 = {
  version: 1,
  id: 'brick-wall',
  name: 'Brick Wall',
  surfaceFn: 'surface_brick',
  appearanceFn: 'brick',
  domain: { kind: 'chart2d', metersPerUnit: 1 },
  seed: 48_271,
  capture: { time: 0, step: 0 },
  params: {},
  bounds: { minDisplacement: -0.01, maxDisplacement: 0.1 },
  evaluation: { renderSpacing: 0.03, collisionSpacing: 0.12 },
  collision: { mode: 'baked' },
};

test('the registry carries surface_brick with its relief knob', () => {
  const brick = SURFACES.find((s) => s.fn === 'surface_brick');
  assert(brick, 'surface_brick missing from SURFACES');
  assert(brick!.params.some((p) => p.key === 'relief'), 'relief @param missing');
});

test('a well-formed brick package validates clean', () => {
  const errors = validateSurfacePackage(BRICK_WALL);
  assert(errors.length === 0, `expected no errors, got: ${errors.join(' | ')}`);
});

test('fail-closed gates reject each malformed field', () => {
  const broken: [Partial<SurfacePackageV1>, string][] = [
    [{ id: 'Bad Slug' }, 'kebab-case'],
    [{ surfaceFn: 'surface_missing' }, 'not in the generated registry'],
    [{ appearanceFn: 'no_such_material' }, 'not in the generated registry'],
    [{ bounds: { minDisplacement: 0.01, maxDisplacement: 0.1 } }, 'contain zero'],
    [{ bounds: { minDisplacement: 0.2, maxDisplacement: 0.1 } }, 'contain zero'],
    [{ bounds: { minDisplacement: Number.NaN, maxDisplacement: 0.1 } }, 'finite'],
    [{ evaluation: { renderSpacing: 0.03, collisionSpacing: 0.05 } }, 'integer multiple'],
    [{ evaluation: { renderSpacing: 0, collisionSpacing: 0.12 } }, 'positive finite'],
    [{ capture: { time: 0, step: 16 } }, '0..15'],
    [{ capture: { time: -1, step: 0 } }, 'non-negative'],
    [{ params: { relief: 99 } }, 'outside'],
    [{ params: { nonsense: 1 } }, 'not declared'],
    [{ seed: -1 }, 'unsigned 32-bit'],
    [{ collision: { mode: 'streamed' } as unknown as SurfacePackageV1['collision'] }, 'static collision only'],
    [{ domain: { kind: 'object3d', metersPerUnit: 1 } as unknown as SurfacePackageV1['domain'] }, 'chart2d only'],
  ];
  for (const [patch, needle] of broken) {
    const errors = validateSurfacePackage({ ...BRICK_WALL, ...patch });
    assert(errors.some((e) => e.includes(needle)), `patch ${JSON.stringify(patch)} did not raise '${needle}' (got: ${errors.join(' | ') || 'none'})`);
  }
});

test('the topology key is compile-speed identity only', () => {
  const key = surfacePackageTopologyKey(BRICK_WALL);
  const numericTwin = surfacePackageTopologyKey({
    ...BRICK_WALL,
    seed: 7,
    capture: { time: 12.5, step: 9 },
    params: { relief: 0.03 },
    bounds: { minDisplacement: -0.5, maxDisplacement: 0.5 },
    evaluation: { renderSpacing: 0.01, collisionSpacing: 0.02 },
  });
  assert(key === numericTwin, 'numeric edits must not move the topology key');
  const periodic = surfacePackageTopologyKey({ ...BRICK_WALL, domain: { ...BRICK_WALL.domain, periodicU: 8 } });
  assert(key !== periodic, 'periodicity is pipeline shape and must move the key');
});

test('the D section is a mat_param-compatible row with locked extras', () => {
  const data = surfacePackageData({ ...BRICK_WALL, params: { relief: 0.05 }, capture: { time: 3.5, step: 7 } })!;
  assert(data !== null, 'packing failed');
  const brick = SURFACES.find((s) => s.fn === 'surface_brick')!;
  const layout = surfacePackageDataLayout(brick.params.length);
  assert(data.length === layout.totalFloats, `expected ${layout.totalFloats} floats, got ${data.length}`);
  assert(data[SURFACE_D_SEED_INDEX] === 48_271, 'seed must sit at the fill-row seed index');
  assert(data[5] === 0, 'palette count must be an explicit zero (mat_param walks past it)');
  assert(data[SURFACE_D_PARAM_COUNT_INDEX] === brick.params.length, 'param count mismatch');
  const reliefAt = brick.params.findIndex((p) => p.key === 'relief');
  assert(Math.abs(data[layout.paramBase + reliefAt]! - 0.05) < 1e-6, 'relief override must land in the param table');
  assert(Math.abs(data[layout.captureTimeIndex]! - 3.5) < 1e-6, 'capture time extra misplaced');
  assert(data[layout.captureStepIndex] === 7, 'capture step extra misplaced');
  assert(data[layout.renderSpacingIndex] !== 0 && data[layout.collisionSpacingIndex] !== 0, 'spacing extras missing');
});

test('absent param overrides pack the registry defaults', () => {
  const data = surfacePackageData(BRICK_WALL)!;
  const brick = SURFACES.find((s) => s.fn === 'surface_brick')!;
  const layout = surfacePackageDataLayout(brick.params.length);
  brick.params.forEach((p, i) => {
    assert(Math.abs(data[layout.paramBase + i]! - p.default) < 1e-6, `param '${p.key}' must default to ${p.default}`);
  });
});

test('surfaceEvalModule composes one authority behind sp_eval', () => {
  const src = surfaceEvalModule(BRICK_WALL)!;
  assert(src !== null, 'module not composed');
  assert(src.includes('struct SurfaceSample'), 'SurfaceSample contract missing from the prelude');
  assert(src.includes('fn surface_brick(sp: vec2f, seed: f32) -> SurfaceSample {'), 'surface module body missing');
  assert(src.includes(`fn sp_eval(sp: vec2f) -> SurfaceSample {`), 'sp_eval entry missing');
  assert(src.includes(`D[${SURFACE_D_SEED_INDEX}]`), 'sp_eval must read the seed from the packed section');
  assert(!src.includes(D_DECL), 'the compute harness owns the D declaration — the module must not carry one');
  assert(!src.includes('fwidth('), 'fwidth is fragment-only — the compute module must carry only cs_fw stubs');
  assert(src.includes('fn cs_fw(v: f32) -> f32'), 'the cs_fw stub must be defined');
  assert(!src.includes('fn fill_pick'), 'the eval module must not drag the fill dispatch along');
});

test('projectedRenderModule shades through sp_rgb over the same cells', () => {
  const src = projectedRenderModule(BRICK_WALL, [1 / 3.2, 1 / 6.0])!;
  assert(src !== null, 'render module not composed');
  assert(src.includes('fn sp_rgb(sp: vec2f, px: vec2f) -> vec3f {'), 'sp_rgb entry missing');
  assert(src.includes('fn brick(') && src.includes('fn surface_brick('), 'adapter and module must both ride along');
  assert(src.includes('0.3125'), 'the appearance uv scale must invert the adapter cols exactly');
  assert(!src.includes(D_DECL), 'the render harness owns the D declaration');
  assert(!/\bU\.time\b/.test(src), 'U.time must be rewritten to S.time for the scene harness');
});

test('brick the material resolves its module transitively everywhere', () => {
  const { surfaces } = splitFillDispatch();
  assert(surfaces.has('surface_brick'), 'dispatch split must find the surface module');
  assert(fnBody('surface_brick'), 'fnBody must span the surfaces map');
  const need = resolveMaterialFns(['brick']);
  assert(need !== null && need.includes('surface_brick'), 'brick must pull surface_brick transitively');
  const composed = fillShaderFor(['brick']);
  assert(composed.includes('fn brick(') && composed.includes('fn surface_brick('), 'per-set fill module must carry the adapter AND its module');
});

log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} surface package suite failures`);
