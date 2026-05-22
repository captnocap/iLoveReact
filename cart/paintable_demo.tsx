/**
 * paintable_demo — smoke test for framework/gpu/paintable.zig.
 *
 * Drag to paint. The brush draws into a persistent R8Unorm GPU texture
 * (no CPU mask array), and an <Effect> samples that texture every frame
 * and tints painted pixels.
 *
 * Validates:
 *   1. <Paintable id w h /> allocates a real wgpu.Texture during host_tree
 *      CREATE, before any consumer paints.
 *   2. usePaintable().paint.circle(...) routes through __paintable_circle
 *      → paintable.zig's brush render pass.
 *   3. <Effect textures={[id]} /> binds the paintable's view + sampler at
 *      @binding(2) / @binding(3); the shader samples it via textureLoad.
 */

import { Box, Pressable, Effect, Paintable } from '@reactjit/runtime/primitives';
import { usePaintable } from '@reactjit/runtime/hooks/usePaintable';
import { useRef, useState } from 'react';

const TEX_W = 1024;
const TEX_H = 1024;
const SURFACE_PX = 720; // displayed size; mouse maps from this to texture

// Shader samples the bound paintable texture (binding 2/3) and tints
// painted pixels. R8Unorm reads back as vec4f with the value in .r.
const WGSL = `
@group(0) @binding(2) var mask_tex: texture_2d<f32>;
@group(0) @binding(3) var mask_samp: sampler;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let m = textureSampleLevel(mask_tex, mask_samp, in.uv, 0.0).r;
  if (m < 0.05) { return vec4f(0.05, 0.06, 0.10, 1.0); }
  // Hue cycles slowly with time so we can see the live readback,
  // not just a frozen capture.
  let hue = fract(U.time * 0.1);
  let r = 0.5 + 0.5 * sin(hue * 6.28318);
  let g = 0.5 + 0.5 * sin(hue * 6.28318 + 2.09439);
  let b = 0.5 + 0.5 * sin(hue * 6.28318 + 4.18879);
  return vec4f(r * m, g * m, b * m, 1.0);
}
`;

export default function PaintableDemo() {
  const mask = usePaintable({ id: 'demo-mask', w: TEX_W, h: TEX_H });
  const [drawing, setDrawing] = useState(false);
  // Refs for the drag handlers — onMouseMove fires per frame and we
  // don't want any of this in React state.
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const stampAt = (px: number, py: number) => {
    // Scale display px → texture px.
    const tx = (px / SURFACE_PX) * TEX_W;
    const ty = (py / SURFACE_PX) * TEX_H;
    mask.paint.circle(tx, ty, 20, 1);
    // If we have a last position, also stamp interpolated points so a
    // fast drag doesn't leave a dotted trail.
    const prev = lastRef.current;
    if (prev) {
      const dx = tx - prev.x;
      const dy = ty - prev.y;
      const dist = Math.hypot(dx, dy);
      const steps = Math.min(32, Math.ceil(dist / 6));
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        mask.paint.circle(prev.x + dx * t, prev.y + dy * t, 20, 1);
      }
    }
    lastRef.current = { x: tx, y: ty };
  };

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0c0e14', alignItems: 'center', justifyContent: 'center' }}>
      <Pressable
        onMouseDown={(e: any) => {
          setDrawing(true);
          lastRef.current = null;
          stampAt(e.x, e.y);
        }}
        onMouseMove={(e: any) => {
          if (!drawing) return;
          stampAt(e.x, e.y);
        }}
        onMouseUp={() => {
          setDrawing(false);
          lastRef.current = null;
        }}
        style={{ width: SURFACE_PX, height: SURFACE_PX, backgroundColor: '#000', position: 'relative' }}
      >
        <Paintable id={mask.id} w={TEX_W} h={TEX_H} />
        <Effect
          shader={WGSL}
          textures={[mask.id]}
          style={{ position: 'absolute', left: 0, top: 0, width: SURFACE_PX, height: SURFACE_PX }}
        />
      </Pressable>
    </Box>
  );
}
