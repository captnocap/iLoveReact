// Editor-owned decal document renderer (DECALEDIT-0606,
// the painted.ts / paintedRender.tsx split: decal.ts stores, this renders).
//
// <DecalSurface doc width height /> draws the doc scaled to the target pixel
// size — positions/sizes stretch independently on x/y (a billboard face fills
// its bucket), text scales by the smaller axis (glyphs can't stretch). The
// SAME component serves three mounts:
//   • the registry's react-source hydration (registry.tsx customTextureDef →
//     TextureCapture bakes it like any facade),
//   • the /compose editor's stage (scale = fit, plus selection chrome OVER it),
//   • the /compose live 3D preview (a StaticSurface the billboard mesh samples;
//     StaticSurface's subtree-mutation invalidation re-bakes as you edit).
//
// Absolute children take raw PIXELS (the engine resolves no % left/top —
// memory abs_left_top_no_percent), which is exactly what the doc stores.

import { Box, Effect, Graph, Image, Text } from '@reactjit/primitives';
import type { DecalAlign, DecalDoc, DecalNode, DecalPathNode } from './decal';
import { shaderSpec } from './shaders';

function alignItems(align: DecalAlign | undefined): 'flex-start' | 'center' | 'flex-end' {
  return align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
}

// Graph.Path opacity rides in the stroke color's alpha (the engine has no opacity
// prop on a path — memory: alpha-hex strokes like '#ffffff08'). Append a 2-digit
// alpha to a #rrggbb; pass through anything already carrying alpha or non-hex.
function withAlpha(color: string, a: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  const byte = Math.max(0, Math.min(255, Math.round(a * 255)));
  return color + byte.toString(16).padStart(2, '0');
}

// A neon path: layered Graph.Path strokes — wide soft glow halos under a bright
// core, with a white-hot inner line for the lit-tube read. The path `d` is in
// doc-pixel coords, so a Graph spanning the whole surface (originTopLeft,
// viewZoom = sx) maps it 1:1 at bake (sx=sy=1). [[feedback_shader_vs_polyline]]:
// stroke work is line geometry (Graph.Path capsules), never a fragment shader.
function NeonPathView(props: { node: DecalPathNode; sx: number; sy: number }) {
  const { node, sx } = props;
  const core = node.stroke;
  const glow = node.glow ?? node.stroke;
  const coreW = node.strokeWidth;
  const glowW = node.glowWidth ?? node.strokeWidth * 3.5;
  const glowA = node.glowOpacity ?? 0.5;
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', opacity: node.opacity ?? 1 }}>
      <Graph style={{ width: '100%', height: '100%' }} viewX={0} viewY={0} viewZoom={sx} originTopLeft>
        {node.fill ? <Graph.Path d={node.d} fill={node.fill} stroke="none" strokeWidth={0} /> : null}
        {/* outer → inner glow falloff, then the saturated core, then a hot center */}
        <Graph.Path d={node.d} fill="none" stroke={withAlpha(glow, glowA * 0.4)} strokeWidth={glowW} />
        <Graph.Path d={node.d} fill="none" stroke={withAlpha(glow, glowA * 0.7)} strokeWidth={glowW * 0.55} />
        <Graph.Path d={node.d} fill="none" stroke={core} strokeWidth={coreW} />
        <Graph.Path d={node.d} fill="none" stroke={withAlpha('#ffffff', 0.85)} strokeWidth={Math.max(0.5, coreW * 0.4)} />
      </Graph>
    </Box>
  );
}

function DecalNodeView(props: { node: DecalNode; sx: number; sy: number }) {
  const { node, sx, sy } = props;
  if (node.hidden) return null;
  const frame = {
    position: 'absolute' as const,
    left: node.x * sx,
    top: node.y * sy,
    width: node.w * sx,
    height: node.h * sy,
    opacity: node.opacity ?? 1,
  };
  if (node.kind === 'rect') {
    const spec = node.fillShaderId ? shaderSpec(node.fillShaderId) : undefined;
    const fill = spec && node.fillData ? (
      <Effect shader={spec.shader} data={node.fillData} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }} />
    ) : null;
    return (
      <Box
        style={{
          ...frame,
          backgroundColor: fill ? '#00000000' : node.bg || '#00000000',
          borderRadius: (node.borderRadius ?? 0) * Math.min(sx, sy),
          borderWidth: (node.borderWidth ?? 0) * Math.min(sx, sy),
          borderColor: node.borderColor ?? '#00000000',
          overflow: fill ? 'hidden' : undefined,
        }}
      >
        {fill}
      </Box>
    );
  }
  if (node.kind === 'image') {
    return (
      <Box style={{ ...frame, borderRadius: (node.borderRadius ?? 0) * Math.min(sx, sy), overflow: 'hidden' }}>
        <Image src={node.src} style={{ width: '100%', height: '100%' }} />
      </Box>
    );
  }
  if (node.kind === 'path') {
    return <NeonPathView node={node} sx={sx} sy={sy} />;
  }
  // text — the box owns position + alignment; the glyphs scale by min axis
  const fontScale = Math.min(sx, sy);
  return (
    <Box style={{ ...frame, justifyContent: 'center', alignItems: alignItems(node.align) }}>
      <Text
        fontSize={Math.max(1, node.fontSize * fontScale)}
        color={node.color}
        style={{
          fontWeight: node.fontWeight ?? 400,
          fontFamily: node.fontFamily ?? undefined,
          letterSpacing: (node.letterSpacing ?? 0) * fontScale,
        }}
      >
        {node.text}
      </Text>
    </Box>
  );
}

/** The decal doc rendered at an exact pixel size (defaults to the doc's own). */
export function DecalSurface(props: { doc: DecalDoc; width?: number; height?: number }) {
  const w = props.width ?? props.doc.width;
  const h = props.height ?? props.doc.height;
  const sx = w / props.doc.width;
  const sy = h / props.doc.height;
  return (
    <Box style={{ width: w, height: h, position: 'relative', backgroundColor: props.doc.bg || '#00000000', overflow: 'hidden' }}>
      {props.doc.nodes.map((node) => (
        <DecalNodeView key={node.id} node={node} sx={sx} sy={sy} />
      ))}
    </Box>
  );
}
