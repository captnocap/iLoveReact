import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import { Pressable } from '../../../runtime/primitives';
import type { Asset } from '../data/types';
import AssetPreview from './AssetPreview';

export default function MaterialCatalogRow(props: {
  asset: Asset;
  active: boolean;
  onAsset: (asset: Asset) => void;
  onFavorite: (assetId: string) => void;
  /** Recipe assets carry the OPEN verb on the row (req_4406): the flask opens
   *  this recipe's Material Lab document; plain click still selects. */
  onOpenLab?: (asset: Asset) => void;
}) {
  const Tile = props.active ? C.HW_MaterialTileOn : C.HW_MaterialTile;
  return (
    <Tile onPress={() => props.onAsset(props.asset)}>
      <C.HW_MaterialTilePreview>
        <AssetPreview asset={props.asset} />
      </C.HW_MaterialTilePreview>
      {props.onOpenLab ? (
        <Pressable
          tooltip={`Open ${props.asset.name} in the Material Lab`}
          onPress={() => props.onOpenLab!(props.asset)}
          style={{ position: 'absolute', right: 2, top: 2, width: 18, height: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 5, backgroundColor: 'rgba(4, 10, 14, 0.78)' }}
          hoverStyle={{ backgroundColor: 'rgba(4, 10, 14, 0.95)' }}
        >
          <Icon name="FlaskConical" size={11} color={accentFor('primary')} />
        </Pressable>
      ) : null}
      <C.HW_MaterialTileName numberOfLines={1} noWrap>{props.asset.name}</C.HW_MaterialTileName>
    </Tile>
  );
}
