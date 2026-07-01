import { C } from '../workspace.cls';
import type { Asset } from '../data/types';
import AssetPreview from './AssetPreview';

export default function MaterialCatalogRow(props: {
  asset: Asset;
  active: boolean;
  onAsset: (asset: Asset) => void;
  onFavorite: (assetId: string) => void;
}) {
  const Tile = props.active ? C.HW_MaterialTileOn : C.HW_MaterialTile;
  return (
    <Tile onPress={() => props.onAsset(props.asset)}>
      <C.HW_MaterialTilePreview>
        <AssetPreview asset={props.asset} />
      </C.HW_MaterialTilePreview>
      <C.HW_MaterialTileName numberOfLines={1} noWrap>{props.asset.name}</C.HW_MaterialTileName>
    </Tile>
  );
}
