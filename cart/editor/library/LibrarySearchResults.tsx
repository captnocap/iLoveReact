import { useState } from 'react';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { Asset, ModelPackage } from '../data/types';
import { librarySearchHitKey, resolveLibrarySearchSelection, type LibrarySearchHit } from '../data/librarySearch';

function assetKind(asset: Asset): string {
  if (asset.tab === 'Skins') return 'MATERIAL';
  if (asset.tab === 'Build') return 'BUILD';
  return 'PROP';
}

export default function LibrarySearchResults(props: {
  hits: LibrarySearchHit[];
  activeAssetId: string;
  activeDocumentId: string;
  onAsset: (asset: Asset) => void;
  onModel: (model: ModelPackage) => void;
}) {
  const [preferredSelection, setPreferredSelection] = useState<string | null>(null);
  const selectedKey = resolveLibrarySearchSelection(
    props.hits,
    preferredSelection,
    props.activeAssetId,
    props.activeDocumentId,
  );
  return (
    <C.HW_ContentTree>
      {props.hits.length === 0 ? (
        <C.HW_EmptyState>
          <Icon name="SearchX" size={16} color={accentFor('textFaint')} />
          <C.HW_StatusText>no matching assets</C.HW_StatusText>
        </C.HW_EmptyState>
      ) : props.hits.map((hit) => {
        const item = hit.kind === 'model' ? hit.model : hit.asset;
        const key = librarySearchHitKey(hit);
        const active = key === selectedKey;
        const Row = active ? C.HW_TreeRowOn : C.HW_TreeRow;
        const Label = active ? C.HW_TreeLabelOn : C.HW_TreeLabel;
        const Count = active ? C.HW_TreeCountOn : C.HW_TreeCount;
        const color = accentFor(active ? 'stageBadgeText' : 'textDim');
        return (
          <Row
            key={key}
            onPress={() => {
              setPreferredSelection(key);
              if (hit.kind === 'model') props.onModel(hit.model);
              else props.onAsset(hit.asset);
            }}
          >
            <Icon name={hit.kind === 'model' ? 'Box' : hit.asset.tab === 'Skins' ? 'Palette' : 'Package'} size={13} color={color} />
            <Label numberOfLines={1} noWrap>{item.name}</Label>
            <C.HW_Spacer />
            <Count>{hit.kind === 'model' ? hit.model.kind.toUpperCase() : assetKind(hit.asset)}</Count>
          </Row>
        );
      })}
    </C.HW_ContentTree>
  );
}
