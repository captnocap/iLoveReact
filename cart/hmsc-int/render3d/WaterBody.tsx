import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { WaterBody as WaterBodyData } from '../design';
import { WATER_LOOK, waterHeightGrid } from '../game/kinds/waterBodies';

// The renderer for an authored body of water (world/water). A body is FACTORS —
// a footprint + one surface level — and renders as ONE host heightfield mesh: a
// rippling top surface at surfaceY plus the heightfield's own perimeter skirt
// dropped to the basin floor, so it's a translucent VOLUME with a moving surface
// (wade in and the blue surrounds you; 'disc' rounds off via the skirt). Same
// dynamic-heightfield path painted terrain uses — the host reuses ONE slot per
// body and re-bakes on each version bump, so the wave animates without leaking
// geometry slots. Translucent (opacity → 3d.zig's transparent pass, the glass path).
//
// The wave is baked into the height grid JS-side per tick (the host heightfield
// path bakes a static grid); WaterBodies owns the clock so only the water subtree
// re-renders each frame, never the whole WorldStatics.

// Wave animation cadence — gentle ripple, cheap re-bake. ~20fps reads as smooth
// water without burning a regen every display frame.
const WATER_TICK_MS = 50;

const WaterBodyMesh = memo(function WaterBodyMesh(props: { body: WaterBodyData; t: number; tick: number }) {
  const b = props.body;
  const centerX = b.x + b.width / 2;
  const centerZ = b.z + b.depth / 2;
  // The grid recomputes each tick (new t) — a fresh heights array per frame, the
  // dynamicKey version bumped in lockstep, so the host re-bakes the ripple into
  // the body's reused slot (the Landform live-edit pattern, leak-free).
  const field = useMemo(
    () => waterHeightGrid(b.shape, b.width, b.depth, b.surfaceY, props.t),
    [b.shape, b.width, b.depth, b.surfaceY, props.t],
  );
  const material = useMemo(() => ({ color: WATER_LOOK.color, opacity: WATER_LOOK.opacity }), []);
  return (
    <Scene3D.Mesh
      geometry={Geometry.Heightfield}
      params={{ heights: field.heights, cols: field.cols, rows: field.rows, width: b.width, depth: b.depth, base: field.base }}
      dynamicKey={`water_${b.id}~${props.tick}`}
      material={material}
      position={[centerX, 0, centerZ]}
    />
  );
});

// Owns the wave clock so ticking re-renders ONLY the water meshes, not the static
// world around them. Idle when there are no bodies (no timer, no work).
export const WaterBodies = memo(function WaterBodies(props: { bodies: readonly WaterBodyData[] }) {
  const active = props.bodies.length > 0;
  const [tick, setTick] = useState(0);
  const tickRef = useRef(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => { tickRef.current += 1; setTick(tickRef.current); }, WATER_TICK_MS);
    return () => clearInterval(id);
  }, [active]);
  const t = (tick * WATER_TICK_MS) / 1000; // seconds
  return (
    <>
      {props.bodies.map((body) => (
        <WaterBodyMesh key={body.id} body={body} t={t} tick={tick} />
      ))}
    </>
  );
});
