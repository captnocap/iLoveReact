// The selected-asset detail card (req_3135, concept 4): thumbnail + name +
// metadata + variant chips + the focus verb, pinned at the dock's foot.
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { Asset } from '../data/types';
import { variantColor } from '../data/catalog';
import AssetPreview from './AssetPreview';

export default function MaterialControls({
  asset,
  onFocus,
  onFavorite,
  onRename,
}: {
  asset: Asset;
  // Opens the Color Studio on this material; a variant chip passes its take
  // index so the studio lands on that take.
  onFocus: (variant?: number) => void;
  onFavorite: (assetId: string) => void;
  onRename: (assetId: string, name: string) => void;
}) {
  const variants = (asset.variants?.length ? asset.variants : ['source']).slice(0, 3);
  const seed = asset.seed ?? 0;
  const bank = asset.favorite ? 'pinned' : asset.recent ? 'recent' : asset.semanticKind ?? 'indexed';
  return (
    <C.HW_DetailCard>
      <C.HW_DetailTop>
        <C.HW_DetailThumb>
          <AssetPreview asset={asset} />
        </C.HW_DetailThumb>
        <C.HW_DetailText>
          <C.HW_DetailNameRow>
            <C.HW_RenameInput value={asset.name} onChange={(name: string) => onRename(asset.id, name)} />
            <C.HW_IconMiniButton onPress={() => onFavorite(asset.id)}>
              <Icon name="Star" size={13} color={accentFor(asset.favorite ? 'warning' : 'textFaint')} />
            </C.HW_IconMiniButton>
          </C.HW_DetailNameRow>
          <C.HW_DetailMeta>{asset.recipe ?? 'catalog asset'} · {asset.sourceKind ?? 'indexed'}</C.HW_DetailMeta>
          <C.HW_DetailMeta>{variants.length} variant{variants.length === 1 ? '' : 's'} · seed {seed} · {bank}</C.HW_DetailMeta>
        </C.HW_DetailText>
      </C.HW_DetailTop>
      {/* A chip is a VERB: it opens the Color Studio on that take. */}
      <C.HW_VariantStrip>
        {variants.map((variant, index) => (
          <C.HW_VariantPill key={variant} onPress={() => onFocus(index)}>
            <C.HW_VariantSwatch style={{ backgroundColor: variantColor(asset, index) }} />
            <C.HW_VariantLabel numberOfLines={1} noWrap>{variant}</C.HW_VariantLabel>
            <C.HW_ToolHint>{index === 0 ? 'default' : index === 1 ? 'alt' : 'override'}</C.HW_ToolHint>
          </C.HW_VariantPill>
        ))}
      </C.HW_VariantStrip>
      <C.HW_VerbRow>
        <C.HW_VerbPrimary onPress={onFocus}>
          <Icon name="Sparkles" size={12} color={accentFor('primary')} />
          <C.HW_VerbText>focus material</C.HW_VerbText>
        </C.HW_VerbPrimary>
      </C.HW_VerbRow>
    </C.HW_DetailCard>
  );
}
