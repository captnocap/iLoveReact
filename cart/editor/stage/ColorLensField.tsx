// editor/stage/ColorLensField.tsx — the Color Studio "Field" lens: a flat perceptual field
// (hue across x, lightness up y) with the live-harmony nodes on it. Two things were broken: the
// field had NO background (a bordered black box — the colour field itself was never drawn), and
// the nodes positioned with `left:'50%'` percentage strings, which this framework's absolute
// layout does NOT support (it consumes raw pixels), so every dot collapsed to the origin and
// clipped away. Fixed: the field is painted by a WGSL <Effect> quad, nodes placed in measured
// pixels from onLayout.
import { useState } from 'react';
import { Effect } from '@reactjit/runtime/primitives';
import { C } from '../workspace.cls';
import { fieldNodes } from '../data/colorSpine';
import type { OklchColor } from '../../../runtime/paint/colors';

// x = hue (0..1), y = lightness (top = light); saturation on P[0] tracks the current chroma.
// effect_math (hsl2rgb) is auto-prepended by the framework.
const FIELD_SHADER = `
@group(0) @binding(1) var<storage, read> P: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let hue = clamp(in.uv.x, 0.0, 1.0);
  let light = clamp(1.0 - in.uv.y, 0.0, 1.0);
  let rgb = hsl2rgb(hue, P[0], light);
  return vec4f(rgb, 1.0);
}
`;

export default function ColorLensField(props: { current: OklchColor; onPick: (color: OklchColor) => void }) {
  const nodes = fieldNodes(props.current);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 168 });
  const sat = Math.max(0.35, Math.min(0.95, props.current.c * 2 + 0.4));
  return (
    <C.HW_LensBody>
      <C.HW_FieldSurface onLayout={(r: any) => setSize({ w: r.width, h: r.height })}>
        <Effect shader={FIELD_SHADER} data={[sat]} style={{ position: 'absolute', left: 0, top: 0, width: size.w || 1, height: size.h || 168 }} />
        {size.w > 0 && nodes.map((node, index) => (
          <C.HW_FieldNode
            key={index}
            onPress={() => props.onPick(node.color)}
            style={{
              left: (node.xPct / 100) * size.w,
              top: (node.yPct / 100) * size.h,
              width: node.isCurrent ? 26 : 18,
              height: node.isCurrent ? 26 : 18,
              marginLeft: node.isCurrent ? -13 : -9,
              marginTop: node.isCurrent ? -13 : -9,
              backgroundColor: node.css,
              borderWidth: node.isCurrent ? 2.5 : 2,
              borderColor: node.isCurrent ? '#ffffff' : 'rgba(255,255,255,.65)',
            }}
          />
        ))}
        <C.HW_FieldAxisLabel style={{ left: 7, bottom: 6 }}>hue -&gt;</C.HW_FieldAxisLabel>
        <C.HW_FieldAxisLabel style={{ left: 7, top: 6 }}>light ^</C.HW_FieldAxisLabel>
      </C.HW_FieldSurface>
    </C.HW_LensBody>
  );
}
