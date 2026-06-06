// TexturePreview — a swatch preview for ANY TextureDef, both authoring kinds.
//
// A react-authored texture IS 2D UI, so the preview renders it at a
// representative grid — the exact markup the game bakes onto a face/tile/part.
// A shader-authored one (a recipe default or a studio-materialized custom) is an
// <Effect> with its frozen data[]. One component, both sources — the "texture is
// one concept" rule applied to previewing. Shared by the Objects tab and the
// texture studio.

import { Box, Effect, Text } from '@reactjit/primitives';
import type { TextureDef } from '@game/textures/registry';
import { accentFor } from './studio.cls';

const PREVIEW_PX = 300;
// Representative bake grid for react facades: a 4×4-cell mid-rise face.
const PREVIEW_CTX = { widthMeters: 12, heightMeters: 12, cols: 4, floors: 4, perception: { high: 0 } };

export function TexturePreview(props: { def: TextureDef; caption?: string }) {
  const { def } = props;
  const content = def.source.kind === 'react'
    ? def.source.render(PREVIEW_CTX)
    : <Effect shader={def.source.shader} data={def.source.data} style={{ width: '100%', height: '100%' }} />;
  return (
    <Box style={{ flexGrow: 1, minHeight: 0, padding: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: accentFor('bg') }}>
      <Box style={{ width: PREVIEW_PX, height: PREVIEW_PX, borderWidth: 1, borderColor: accentFor('border'), overflow: 'hidden' }}>
        {content}
      </Box>
      <Text fontSize={11} color={accentFor('textDim')} style={{ fontFamily: 'monospace', marginTop: 12 }}>
        {props.caption ?? `${def.label} · texture`}
      </Text>
    </Box>
  );
}
