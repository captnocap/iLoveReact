// game/textures/decalRender.tsx — the decal doc's React half (DECALEDIT-0606,
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

import { Box, Effect, Image, Text } from '@reactjit/primitives';
import type { DecalAlign, DecalDoc, DecalNode } from './decal';
import { shaderSpec } from './shaders';

function alignItems(align: DecalAlign | undefined): 'flex-start' | 'center' | 'flex-end' {
  return align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
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
