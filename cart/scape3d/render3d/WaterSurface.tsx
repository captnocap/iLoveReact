// Live A13 canal water, captured onto the heightfield face.
//
// The water heightfield mesh (world/entity.tsx) samples `textureKey="water-a13"`
// instead of a baked bitmap. This offscreen <StaticSurface staticKey="water-a13">
// renders the canonical @reactjit/effects <Water> into that key, so the mesh
// face shows the REAL animated A13 shader — not the dead still-frame the old
// waterA13Tex() baked.
//
// StaticSurface caches its capture (it's a paint cache), and a U.time-only
// Effect never mutates the React subtree, so nothing would force a re-capture
// on its own → the texels would freeze. Bumping <Water frame> on a ~60fps tick
// mutates the subtree each frame, which advances the surface's dirty_frame and
// forces re-capture; at re-capture U.time has advanced, so the water flows.
// (The mesh's wave displacement is separate — host-side geometry in 3d.zig.)
//
// Mounted once in index.tsx; offscreen (left:-99999) so it only feeds the key.
import { useEffect, useState } from 'react';
import { StaticSurface } from '@reactjit/primitives';
import { Water } from '@reactjit/effects';

const TEX = 256; // capture resolution stretched across each water face

export function WaterSurface() {
  const [frame, setFrame] = useState(0);

  // No requestAnimationFrame in the cart host — setTimeout fallback (16ms ≈ 60fps).
  useEffect(() => {
    const g: any = globalThis;
    const sched = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: any) => setTimeout(fn, 16);
    const cancel = g.cancelAnimationFrame ? g.cancelAnimationFrame.bind(g) : clearTimeout;
    let handle: any = 0;
    const loop = () => { setFrame((f) => (f + 1) & 0xffffff); handle = sched(loop); };
    handle = sched(loop);
    return () => cancel(handle);
  }, []);

  return (
    <StaticSurface staticKey="water-a13" style={{ position: 'absolute', left: -99999, top: 0, width: TEX, height: TEX }}>
      <Water variant={0} frame={frame} style={{ width: TEX, height: TEX }} />
    </StaticSurface>
  );
}
