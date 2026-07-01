import { Effect, StaticSurface } from '@reactjit/primitives';
import type { ReactNode } from 'react';
import { C } from '../workspace.cls';
import type { Asset } from '../data/types';
import { textureBlobDataUrl } from '../data/hmscAssetCatalog';
import { DecalSurface } from '../textures/decalRender';

const PREVIEW_FILL = { width: '100%', height: '100%' };
const DECAL_PREVIEW_SIZE = 68;

export default function AssetPreview({ asset }: { asset: Asset }) {
  const preview = asset.preview ?? { kind: 'color' as const, color: asset.color };
  let content: ReactNode;

  if (preview.kind === 'shader') {
    content = <Effect shader={preview.shader} data={preview.data} style={PREVIEW_FILL} />;
  } else if (preview.kind === 'image') {
    content = <C.HW_MaterialTileImage source={preview.source} />;
  } else if (preview.kind === 'texture-blob') {
    const source = textureBlobDataUrl(preview.ref);
    content = source ? <C.HW_MaterialTileImage source={source} /> : null;
  } else if (preview.kind === 'decal') {
    content = (
      <C.HW_DecalPreviewFrame>
        <DecalSurface doc={preview.doc} width={DECAL_PREVIEW_SIZE} height={DECAL_PREVIEW_SIZE} />
      </C.HW_DecalPreviewFrame>
    );
  } else {
    const color = preview.kind === 'color' ? preview.color : asset.color;
    content = <C.HW_PreviewFallback style={{ backgroundColor: color }} />;
  }

  return (
    <StaticSurface staticKey={`editor:asset-preview:${asset.id}:${preview.kind}`} style={PREVIEW_FILL}>
      {content ?? <C.HW_PreviewFallback style={{ backgroundColor: asset.color }} />}
    </StaticSurface>
  );
}
