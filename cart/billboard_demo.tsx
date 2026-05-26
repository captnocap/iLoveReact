// billboard_demo — 2D content rendered ONTO a 3D mesh face.
//
// The bridge: wrap any 2D subtree in <StaticSurface staticKey="X"> (it renders
// to an offscreen GPU texture), then a <Scene3D.Mesh textureKey="X"> samples
// that texture as its diffuse map. Two flavors:
//   • LEFT  — a live <Box><Text> UI (the "screen" / monitor case)
//   • RIGHT — an <Effect> WGSL fragment shader (the "Effect as material" case)
//
// One mesh shares ONE diffuse texture across all 6 faces, so a FAT box smears
// the image onto its thin side faces ("text on the edges"). A screen is really
// a THIN panel, so the sides collapse to a hairline and the issue disappears
// without any extra geometry. Ship: ./scripts/ship billboard_demo

import { useEffect, useState } from 'react';
import { Box, Text, Scene3D, StaticSurface, Effect, Filter } from '@reactjit/runtime/primitives';

const TEX_W = 512;
const TEX_H = 256;

// Animated plasma: pure uv + time, no geometry. ys[0] = time (seconds-ish).
// (VsOut / the storage binding are injected by the Effect primitive.)
const FX_SHADER = `
@group(0) @binding(1) var<storage, read> ys: array<f32>;
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let t = ys[0];
  let uv = in.uv;
  let r = 0.5 + 0.5 * sin(t + uv.x * 6.2831);
  let g = 0.5 + 0.5 * sin(t * 1.3 + uv.y * 6.2831 + 2.0);
  let b = 0.5 + 0.5 * sin(t * 0.7 + (uv.x + uv.y) * 5.0 + 4.0);
  return vec4f(r, g, b, 1.0);
}
`;

export default function BillboardDemo() {
  const [tick, setTick] = useState(0);

  // No requestAnimationFrame in the cart host — fall back to setTimeout.
  useEffect(() => {
    const g: any = globalThis;
    const sched = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : (fn: any) => setTimeout(fn, 16);
    const cancel = g.cancelAnimationFrame ? g.cancelAnimationFrame.bind(g) : clearTimeout;
    let handle: any = 0;
    const loop = () => { setTick((t) => (t + 1) & 0xffffff); handle = sched(loop); };
    handle = sched(loop);
    return () => cancel(handle);
  }, []);

  // A screen faces the viewer — so ROCK it gently (±~28°) instead of fully
  // spinning. The thin side faces stay near edge-on the whole time, so they
  // never broadside the camera; the motion still reads unmistakably as 3D.
  const rock = Math.sin(tick * 0.022) * 0.5;

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0a0d14' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0a0d14">
        <Scene3D.Camera position={[0, 1.0, 5.0]} target={[0, 0, 0]} fov={50} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.6} />
        <Scene3D.DirectionalLight direction={[0.4, 0.9, 0.5]} color="#ffffff" intensity={0.8} />

        {/* LEFT: live Box+Text UI. Thin panel + rocking → edge stays hidden. */}
        <Scene3D.Mesh
          geometry="box" material="#ffffff" textureKey="bb-screen"
          position={[-1.4, 0, 0]} sizeX={2.2} sizeY={1.1} sizeZ={0.006}
          rotation={[0, rock, 0]}
        />

        {/* RIGHT: Effect shader, rocking the opposite way. */}
        <Scene3D.Mesh
          geometry="box" material="#ffffff" textureKey="bb-fx"
          position={[1.4, 0, 0]} sizeX={2.2} sizeY={1.1} sizeZ={0.006}
          rotation={[0, -rock, 0]}
        />
      </Scene3D>

      {/* Offscreen capture sources — parked off-screen; only their textures
          are sampled by the meshes above. */}
      <StaticSurface staticKey="bb-screen" style={{ position: 'absolute', left: -99999, top: 0, width: TEX_W, height: TEX_H }}>
        {/* A <Filter> nested in the capture: its CRT pass is folded into the
            captured texture, so the mesh face shows FILTERED content (not the
            raw UI, and with no leak to the screen). Filter needs explicit 100%
            size or the host crashes at load. */}
        <Filter shader="crt" intensity={0.85} style={{ width: '100%', height: '100%' }}>
          <Box style={{ width: '100%', height: '100%', backgroundColor: '#ff4422', padding: 28, gap: 14 }}>
            <Text style={{ fontSize: 46, color: '#ffffff', fontWeight: 'bold' }}>HELLO 3D</Text>
            <Box style={{ height: 6, width: '64%', backgroundColor: '#ffffff' }} />
            <Text style={{ fontSize: 24, color: '#ffe0d6' }}>live Box + Text on a mesh</Text>
            <Text style={{ fontSize: 24, color: '#ffe0d6' }}>frame {tick}</Text>
          </Box>
        </Filter>
      </StaticSurface>

      <StaticSurface staticKey="bb-fx" style={{ position: 'absolute', left: -99999, top: 0, width: TEX_W, height: TEX_H }}>
        <Effect shader={FX_SHADER} data={[tick * 0.05]} style={{ width: TEX_W, height: TEX_H }} />
      </StaticSurface>
    </Box>
  );
}
