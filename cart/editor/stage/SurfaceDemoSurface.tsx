// SurfaceDemoSurface — the Surface Packages proof plane (req_4785, slice 2 of
// PROJECTED_SURFACE_INTEGRATION.md). A flat-as-fuck 6m x 3m wall wearing the
// brick-wall package: the compute prepass projects it into real displaced
// brick geometry from the ONE surface_brick authority, and the appearance
// re-evaluates the same cells per fragment. This route exists to be looked at
// (rjit shot editor --route /surface-demo) — the real consumer is the wall
// tool's side-finish lane (ruled req_4783), which lands in a later slice.
import { useEffect } from 'react';
import { Box, Scene3D, Text } from '../../../runtime/primitives';
import {
  composeSurfaceSession,
  surfacePackageData,
  validateSurfacePackage,
  type SurfacePackageV1,
  type SurfaceSessionEntry,
} from '../render3d/shaders/surfacePackage';

// Real-world brick sizing (measured size IS scale): 45cm x 15cm units with
// 2cm relief — reads clearly at demo distance while staying wall-plausible.
const BRICK_WALL_DEMO: SurfacePackageV1 = {
  version: 1,
  id: 'brick-wall-demo',
  name: 'Brick Wall Demo',
  surfaceFn: 'surface_brick',
  appearanceFn: 'brick',
  domain: { kind: 'chart2d', metersPerUnit: 1 },
  seed: 48_271,
  capture: { time: 0, step: 0 },
  params: { relief: 0.02, brick_length: 0.45, course_height: 0.15 },
  bounds: { minDisplacement: -0.002, maxDisplacement: 0.025 },
  evaluation: { renderSpacing: 0.008, collisionSpacing: 0.032 },
  collision: { mode: 'baked' },
};

// The second pilot: rust_sheet is an ART-ONLY appearance over the standalone
// corrugation module — no adapter refactor, the package aligns the ribs.
// Real 76mm rib pitch, 18mm deep corrugation.
const RUST_WALL_DEMO: SurfacePackageV1 = {
  version: 1,
  id: 'rust-wall-demo',
  name: 'Rust Sheet Wall Demo',
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

const SESSION: SurfaceSessionEntry[] = [
  // Brick adapter maps uv -> cells through cols=3.2/rows=6.0 (variant 0);
  // inverting them hands the module the SAME sp the compute prepass fed.
  { pkg: BRICK_WALL_DEMO, appearanceUvScale: [1 / 3.2, 1 / 6.0] },
  // rust_sheet paints corr = sin(uv.x * 55); uvScale.x = (2*pi / ribPitch)/55
  // makes the painted ridge phase equal surface_corrugated's exact rib phase.
  { pkg: RUST_WALL_DEMO, appearanceUvScale: [(2 * Math.PI) / 0.076 / 55, 1 / 3] },
];

// plane = [origin.xyz, uAxis.xyz, vAxis.xyz, sizeU, sizeV, spacing, metersPerUnit]
const WALL_PLANES: Record<string, number[]> = {
  // Brick: 6m run along +x at z=0, normal facing the camera (+z).
  'brick-wall-demo': [-3, 0, 0, 1, 0, 0, 0, 1, 0, 6, 3, 0.008, 1],
  // Rust: a 4m return wall making a corner at x=3, run along +z, normal -x.
  'rust-wall-demo': [3, 0, 0, 0, 0, 1, 0, 1, 0, 4, 3, 0.008, 1],
};

function installDemoSurfaces(): boolean {
  const host = globalThis as any;
  if (typeof host.__surface_package_formula !== 'function') return false;
  for (const entry of SESSION) {
    const errors = validateSurfacePackage(entry.pkg);
    if (errors.length > 0) {
      console.error(`[surface-demo] ${entry.pkg.id} invalid: ${errors.join(' | ')}`);
      return false;
    }
  }
  const session = composeSurfaceSession(SESSION);
  if (!session) {
    console.error('[surface-demo] session composition failed — surfaces not installed');
    return false;
  }
  if (host.__surface_package_formula(session.computeWgsl, session.renderWgsl) !== 1) {
    console.error('[surface-demo] host refused the composed formulas');
    return false;
  }
  for (const entry of SESSION) {
    const data = surfacePackageData(entry.pkg, session.selectors.get(entry.pkg.id)!);
    const plane = WALL_PLANES[entry.pkg.id];
    if (!data || !plane) {
      console.error(`[surface-demo] ${entry.pkg.id} has no packed data/plane — skipped`);
      continue;
    }
    host.__surface_package_set(entry.pkg.id, new Float32Array(plane), data);
  }
  return true;
}

export default function SurfaceDemoSurface() {
  useEffect(() => {
    const host = globalThis as any;
    const installed = installDemoSurfaces();
    if (!installed) console.error('[surface-demo] install failed — the plane will not appear');
    // Assert through the verification door, not the picture alone: poll until
    // the prepass has generated, then report the collision view + measured
    // displacement envelope (console.warn reaches the shot terminal).
    let polls = 0;
    let pollTimer: any = null;
    const verified = new Set<string>();
    const poll = () => {
      polls += 1;
      for (const entry of SESSION) {
        if (verified.has(entry.pkg.id)) continue;
        const raw = typeof host.__surface_package_info === 'function'
          ? host.__surface_package_info(entry.pkg.id)
          : '';
        if (!raw) continue;
        try {
          const status = JSON.parse(raw);
          if (status.generated && status.collisionTriangles > 0) {
            verified.add(entry.pkg.id);
            console.warn(`[surface-demo] VERIFIED ${entry.pkg.id}: ${raw}`);
          } else if (status.generated && !status.collisionOk && polls > 5) {
            verified.add(entry.pkg.id);
            console.error(`[surface-demo] ${entry.pkg.id} collision REFUSED by the bounds gate: ${raw}`);
          }
        } catch {
          console.error(`[surface-demo] ${entry.pkg.id} info door returned unparseable JSON: ${raw}`);
          verified.add(entry.pkg.id);
        }
      }
      if (verified.size >= SESSION.length) return;
      if (polls < 40) pollTimer = setTimeout(poll, 100);
      else console.error('[surface-demo] some surfaces never reported generated — check [r3d-proj] host logs');
    };
    pollTimer = setTimeout(poll, 100);
    return () => {
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (typeof host.__surface_package_clear === 'function') host.__surface_package_clear('');
    };
  }, []);

  return (
    <Box style={{ width: '100%', height: '100%' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0b0d12" showAxes={false}>
        {/* Framed on the corner so both packages read: brick facing +z, the
            corrugated rust return wall facing -x, raking light across both. */}
        <Scene3D.Camera position={[-1.6, 1.8, 5.6]} target={[1.1, 1.3, 1.1]} fov={50} />
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.35} />
        {/* Grazing key aimed to rake BOTH normals (+z brick, -x rust) —
            displacement is the whole point, so both walls must catch it. */}
        <Scene3D.DirectionalLight direction={[-0.55, 0.35, 0.75]} color="#ffffff" intensity={0.65} />
      </Scene3D>
      <Box style={{ position: 'absolute', left: 12, top: 10 }}>
        <Text style={{ fontSize: 12, color: '#8a93a6' }}>
          SURFACE PACKAGES — brick + corrugated rust · one WGSL authority each · compute-generated geometry
        </Text>
      </Box>
    </Box>
  );
}
