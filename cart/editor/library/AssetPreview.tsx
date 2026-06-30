import { Effect } from '@reactjit/primitives';
import { C } from '../workspace.cls';
import type { Asset } from '../data/types';
import { textureBlobDataUrl } from '../data/hmscAssetCatalog';
import { DecalSurface } from '../../hmsc-int/game/textures/decalRender';

const PREVIEW_FILL = { width: '100%', height: '100%' };
const DECAL_PREVIEW_SIZE = 68;

export default function AssetPreview({ asset }: { asset: Asset }) {
  const preview = asset.preview ?? { kind: 'color' as const, color: asset.color };

  if (preview.kind === 'shader') {
    return <Effect shader={preview.shader} data={preview.data} style={PREVIEW_FILL} />;
  }

  if (preview.kind === 'image') {
    return <C.HW_MaterialTileImage source={preview.source} />;
  }

  if (preview.kind === 'texture-blob') {
    const source = textureBlobDataUrl(preview.ref);
    if (source) return <C.HW_MaterialTileImage source={source} />;
  }

  if (preview.kind === 'decal') {
    return (
      <C.HW_DecalPreviewFrame>
        <DecalSurface doc={preview.doc} width={DECAL_PREVIEW_SIZE} height={DECAL_PREVIEW_SIZE} />
      </C.HW_DecalPreviewFrame>
    );
  }

  const color = preview.kind === 'color' ? preview.color : asset.color;
  return <C.HW_PreviewFallback style={{ backgroundColor: color }} />;
}
