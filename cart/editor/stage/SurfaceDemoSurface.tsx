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
  projectedRenderModule,
  surfaceEvalModule,
  surfacePackageData,
  validateSurfacePackage,
  type SurfacePackageV1,
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

// The brick adapter maps uv -> cells through cols=3.2/rows=6.0 (variant 0);
// inverting them hands the module the SAME sp the compute prepass fed, so the
// color cells land exactly on the geometry cells.
const BRICK_APPEARANCE_UV_SCALE: [number, number] = [1 / 3.2, 1 / 6.0];

function installDemoSurfaces(): boolean {
  const host = globalThis as any;
  if (typeof host.__surface_package_formula !== 'function') return false;
  const errors = validateSurfacePackage(BRICK_WALL_DEMO);
  if (errors.length > 0) {
    console.error(`[surface-demo] package invalid: ${errors.join(' | ')}`);
    return false;
  }
  const computeWgsl = surfaceEvalModule(BRICK_WALL_DEMO);
  const renderWgsl = projectedRenderModule(BRICK_WALL_DEMO, BRICK_APPEARANCE_UV_SCALE);
  const data = surfacePackageData(BRICK_WALL_DEMO);
  if (!computeWgsl || !renderWgsl || !data) {
    console.error('[surface-demo] module composition failed — surfaces not installed');
    return false;
  }
  if (host.__surface_package_formula(computeWgsl, renderWgsl) !== 1) {
    console.error('[surface-demo] host refused the composed formulas');
    return false;
  }
  const spacing = BRICK_WALL_DEMO.evaluation.renderSpacing;
  const mpu = BRICK_WALL_DEMO.domain.metersPerUnit;
  // plane = [origin.xyz, uAxis.xyz, vAxis.xyz, sizeU, sizeV, spacing, metersPerUnit]
  const wall = new Float32Array([
    -3, 0, 0, // origin: left-bottom corner
    1, 0, 0, // u -> +x along the run
    0, 1, 0, // v -> +y up the wall (normal faces +z, toward the camera)
    6, 3, // 6m x 3m
    spacing, mpu,
  ]);
  host.__surface_package_set(BRICK_WALL_DEMO.id, wall, data);
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
    const poll = () => {
      polls += 1;
      const raw = typeof host.__surface_package_info === 'function'
        ? host.__surface_package_info(BRICK_WALL_DEMO.id)
        : '';
      if (raw) {
        try {
          const status = JSON.parse(raw);
          if (status.generated && status.collisionTriangles > 0) {
            console.warn(`[surface-demo] VERIFIED ${BRICK_WALL_DEMO.id}: ${raw}`);
            return;
          }
          if (status.generated && !status.collisionOk && polls > 5) {
            console.error(`[surface-demo] collision REFUSED by the bounds gate: ${raw}`);
            return;
          }
        } catch {
          console.error(`[surface-demo] info door returned unparseable JSON: ${raw}`);
          return;
        }
      }
      if (polls < 40) pollTimer = setTimeout(poll, 100);
      else console.error('[surface-demo] surface never reported generated — check [r3d-proj] host logs');
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
        {/* Slightly off-axis, so the raking key light shows the brick relief. */}
        <Scene3D.Camera position={[-2.2, 1.7, 4.6]} target={[0, 1.4, 0]} fov={50} />
        <Scene3D.Fog enabled={false} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.35} />
        {/* Grazing key from the upper left — displacement is the whole point. */}
        <Scene3D.DirectionalLight direction={[0.75, 0.35, 0.55]} color="#ffffff" intensity={0.65} />
      </Scene3D>
      <Box style={{ position: 'absolute', left: 12, top: 10 }}>
        <Text style={{ fontSize: 12, color: '#8a93a6' }}>
          SURFACE PACKAGES — brick-wall-demo · one WGSL authority · compute-generated geometry
        </Text>
      </Box>
    </Box>
  );
}
