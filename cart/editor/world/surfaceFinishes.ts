// world/surfaceFinishes.ts — Surface Packages on wall sides (req_4783/4785).
//
// The RULED consumer: "use the wall tool, make a flat as fuck wall, grab the
// shader and put it on, and it adds the geometry to it." A wall side finish
// whose id carries the `surface:` prefix names a Surface Package instead of a
// Skins asset. The engine still owns the wall (semantic kind, gameplay
// collision box, openings); this lane turns the side's FACE render bands into
// projected surfaces — real displaced geometry from the one WGSL authority.
//
// Chart continuity falls out of the band protocol: every face band carries
// its columnStartU/rowBottomU, which become the projected chart origin
// (sp_origin), so brick courses COUNT THROUGH openings and across run
// segments instead of restarting per band — the req_4501 run-identity ruling
// realized in the projection domain, and the boundary rule at opening rims
// arrives for free because a void simply has no face band.
import { ARCHITECTURE_UNITS_PER_METER } from './architecture';
import type { WallRenderBand } from './architectureBake';
import { ensureSurfaceSession } from '../render3d/surfaceSession';
import { surfacePackageData, type SurfacePackageV1, type SurfaceSessionEntry } from '../render3d/shaders/surfacePackage';

export const SURFACE_FINISH_PREFIX = 'surface:';

export type SurfaceFinishEntry = SurfaceSessionEntry & { label: string };

// The built-in package catalog (the Surface Lab authors more later). Sizing is
// physical (measured size IS scale — req_4562): standard 215mm bricks laid in
// 75mm courses with 10mm joints; 76mm-pitch corrugated sheet.
const BRICK_WALL: SurfacePackageV1 = {
  version: 1,
  id: 'brick-wall',
  name: 'Brick Wall',
  surfaceFn: 'surface_brick',
  appearanceFn: 'brick',
  domain: { kind: 'chart2d', metersPerUnit: 1 },
  seed: 48_271,
  capture: { time: 0, step: 0 },
  params: { relief: 0.012, brick_length: 0.225, course_height: 0.085 },
  bounds: { minDisplacement: -0.0012, maxDisplacement: 0.016 },
  evaluation: { renderSpacing: 0.006, collisionSpacing: 0.024 },
  collision: { mode: 'baked' },
};

const CORRUGATED_RUST: SurfacePackageV1 = {
  version: 1,
  id: 'corrugated-rust',
  name: 'Corrugated Rust',
  surfaceFn: 'surface_corrugated',
  appearanceFn: 'rust_sheet',
  domain: { kind: 'chart2d', metersPerUnit: 1 },
  seed: 9_117,
  capture: { time: 0, step: 0 },
  params: { relief: 0.018, rib_pitch: 0.076 },
  bounds: { minDisplacement: -0.01, maxDisplacement: 0.01 },
  evaluation: { renderSpacing: 0.008, collisionSpacing: 0.032 },
  collision: { mode: 'baked' },
};

export const SURFACE_FINISH_CATALOG: readonly SurfaceFinishEntry[] = [
  // brick's adapter maps uv -> cells through cols=3.2/rows=6.0 (variant 0).
  { pkg: BRICK_WALL, appearanceUvScale: [1 / 3.2, 1 / 6.0], label: 'Brick Wall' },
  // rust_sheet paints corr = sin(uv.x * 55): (2*pi/ribPitch)/55 equates the
  // painted ridge phase with surface_corrugated's exact rib phase.
  { pkg: CORRUGATED_RUST, appearanceUvScale: [(2 * Math.PI) / 0.076 / 55, 1 / 3], label: 'Corrugated Rust' },
];

const CATALOG_BY_ID = new Map(SURFACE_FINISH_CATALOG.map((e) => [`${SURFACE_FINISH_PREFIX}${e.pkg.id}`, e]));

/** The package a side-finish material id names, or null for ordinary ids. */
export function surfaceFinishForId(materialId: string): SurfaceFinishEntry | null {
  return CATALOG_BY_ID.get(materialId) ?? null;
}

/** The host refuses lattices above its ceiling (PROJ_MAX_VERTS, mirrored
 *  here with margin). A long wall at the package's declared spacing can
 *  exceed it, so the lane COARSENS spacing just enough to fit — the declared
 *  spacing is the finest the package wants, never a hard promise. Loud. */
const PROJ_VERT_BUDGET = 1_000_000;

export type ProjectedPlaneFit = {
  plane: Float32Array;
  /** the spacing actually used — the declared one, or coarsened to budget. */
  renderSpacing: number;
  coarsened: boolean;
};

/** Derive one projected plane from an engine face band. The plane sits the
 *  package's |minDisplacement| proud of the band (plus a hair) so recessed
 *  mortar never dips into the sealed wall body and z-fights it; the chart
 *  origin carries the band's column/row start so the field CONTINUES across
 *  bands; the band's engine-emitted normal rides along as the AUTHORITATIVE
 *  outward direction (band quads wind by edge direction, so one side of
 *  every wall is a left-handed frame — the host flips projection and winding
 *  to face the supplied normal, req_4786). Returns null for a degenerate quad. */
export function bandToProjectedPlane(band: WallRenderBand, entry: SurfaceFinishEntry): ProjectedPlaneFit | null {
  const [q0, q1, , q3] = [band.quad[0]!, band.quad[1]!, band.quad[2]!, band.quad[3]!];
  const u = [q1[0] - q0[0], q1[1] - q0[1], q1[2] - q0[2]];
  const v = [q3[0] - q0[0], q3[1] - q0[1], q3[2] - q0[2]];
  const sizeU = Math.hypot(u[0]!, u[1]!, u[2]!);
  const sizeV = Math.hypot(v[0]!, v[1]!, v[2]!);
  if (sizeU < 0.01 || sizeV < 0.01) return null;
  const un = [u[0]! / sizeU, u[1]! / sizeU, u[2]! / sizeU];
  const vn = [v[0]! / sizeV, v[1]! / sizeV, v[2]! / sizeV];
  const lift = Math.max(0, -entry.pkg.bounds.minDisplacement) + 0.001;
  const n = band.normal;
  const mpu = entry.pkg.domain.metersPerUnit;
  const spOriginU = band.columnStartU / ARCHITECTURE_UNITS_PER_METER / mpu;
  const spOriginV = band.rowBottomU / ARCHITECTURE_UNITS_PER_METER / mpu;
  let renderSpacing = entry.pkg.evaluation.renderSpacing;
  const vertsAt = (s: number) => (Math.floor(sizeU / s) + 1) * (Math.floor(sizeV / s) + 1);
  let coarsened = false;
  if (vertsAt(renderSpacing) > PROJ_VERT_BUDGET) {
    renderSpacing = Math.sqrt((sizeU * sizeV) / PROJ_VERT_BUDGET) * 1.02;
    coarsened = true;
    console.warn(`[surfaceFinishes] ${entry.pkg.id} on a ${sizeU.toFixed(1)}x${sizeV.toFixed(1)}m band: declared ${entry.pkg.evaluation.renderSpacing}m spacing exceeds the ${PROJ_VERT_BUDGET}-vert budget — coarsened to ${renderSpacing.toFixed(4)}m`);
  }
  const plane = new Float32Array([
    q0[0] + n[0] * lift, q0[1] + n[1] * lift, q0[2] + n[2] * lift,
    un[0]!, un[1]!, un[2]!,
    vn[0]!, vn[1]!, vn[2]!,
    sizeU, sizeV,
    renderSpacing, mpu,
    spOriginU, spOriginV,
    n[0], n[1], n[2],
  ]);
  return { plane, renderSpacing, coarsened };
}

/** A stable install id for one band's surface — edge + side + band window. */
export function bandSurfaceId(band: WallRenderBand): string {
  return `arch:${band.edgeId}:${band.side ?? 'x'}:${band.columnStartU}:${band.rowBottomU}:${band.rowTopU}`;
}

// The ids this lane currently has installed — stale ones clear on every push
// so a deleted/repainted wall's surfaces vanish with it. Only ARCH-owned ids
// are ever cleared here; other pushers' surfaces are untouched.
let installedIds = new Set<string>();

/** Install/refresh the projected surfaces for every face band wearing a
 *  surface finish, and clear the ones that no longer exist. Returns the ids
 *  (bandSurfaceId) of the bands whose surfaces are ACTUALLY installed — the
 *  bake keeps the flat face mesh for every unclaimed band, so a refused or
 *  failed install degrades to the ordinary wall look instead of a hole in
 *  the shell (fail OPEN for rendering; the refusal itself stays loud). Safe
 *  to call with an empty list (clears the lane). */
export function pushWallSurfaceFinishes(bands: readonly WallRenderBand[]): Set<string> {
  const host = globalThis as any;
  if (typeof host.__surface_package_set !== 'function') return new Set();
  const wanted = new Map<string, { band: WallRenderBand; entry: SurfaceFinishEntry }>();
  const entries: SurfaceFinishEntry[] = [];
  for (const band of bands) {
    if (band.role !== 'face') continue;
    const entry = surfaceFinishForId(band.materialId);
    if (!entry) continue;
    if (!entries.includes(entry)) entries.push(entry);
    wanted.set(bandSurfaceId(band), { band, entry });
  }
  for (const id of installedIds) {
    if (!wanted.has(id)) host.__surface_package_clear(id);
  }
  if (wanted.size === 0) {
    installedIds = new Set();
    return installedIds;
  }
  const sel = ensureSurfaceSession(entries);
  if (!sel) {
    console.error('[surfaceFinishes] session compose/push failed — wall surface finishes not installed');
    installedIds = new Set();
    return installedIds;
  }
  const nextInstalled = new Set<string>();
  for (const [id, { band, entry }] of wanted) {
    const fit = bandToProjectedPlane(band, entry);
    if (!fit) continue;
    // A coarsened lattice repacks the D extras with the EFFECTIVE spacings so
    // the host's collision view derives its nested stride from the truth.
    const pkg = fit.coarsened
      ? {
        ...entry.pkg,
        evaluation: {
          renderSpacing: fit.renderSpacing,
          collisionSpacing: fit.renderSpacing * Math.max(1, Math.round(entry.pkg.evaluation.collisionSpacing / entry.pkg.evaluation.renderSpacing)),
        },
      }
      : entry.pkg;
    const data = surfacePackageData(pkg, sel.get(entry.pkg.id)!);
    if (!data) continue;
    if (host.__surface_package_set(id, fit.plane, data) === 1) {
      nextInstalled.add(id);
    } else {
      console.error(`[surfaceFinishes] host refused surface '${id}' (${entry.pkg.id}) — its band keeps the flat wall look; see [r3d-proj] host logs`);
    }
  }
  installedIds = nextInstalled;
  return installedIds;
}
