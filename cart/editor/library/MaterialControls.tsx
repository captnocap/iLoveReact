import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { Asset } from '../data/types';
import { variantColor } from '../data/catalog';

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
  return (
    <C.HW_ToolPanel>
      <C.HW_GroupTitle>
        <Icon name="Sparkles" size={12} color={accentFor('primary')} />
        <C.HW_GroupText>SELECTED MATERIAL</C.HW_GroupText>
      </C.HW_GroupTitle>
      <C.HW_RenameRow>
        <C.HW_RenameInput value={asset.name} onChange={(name) => onRename(asset.id, name)} />
        <C.HW_IconMiniButton onPress={() => onFavorite(asset.id)}>
          <Icon name="Star" size={13} color={accentFor(asset.favorite ? 'warning' : 'textFaint')} />
        </C.HW_IconMiniButton>
      </C.HW_RenameRow>
      {/* Usage/maps counts removed: nothing tracks material usage yet, so those
          were fabricated zeros. Restore real cells when a usage signal exists. */}
      <C.HW_StatGrid>
        <C.HW_StatCell>
          <C.HW_StatValue>{variants.length}</C.HW_StatValue>
          <C.HW_StatLabel>variants</C.HW_StatLabel>
        </C.HW_StatCell>
      </C.HW_StatGrid>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>recipe</C.HW_ToolLabel>
        <C.HW_ToolValue numberOfLines={1} noWrap>{asset.recipe ?? 'catalog asset'}</C.HW_ToolValue>
      </C.HW_ToolRow>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>source</C.HW_ToolLabel>
        <C.HW_ToolValue numberOfLines={1} noWrap>{asset.sourceKind ?? 'indexed'}</C.HW_ToolValue>
      </C.HW_ToolRow>
      {/* A chip is a VERB: it opens the Color Studio on that take. */}
      <C.HW_SelectedVariants>
        {variants.map((variant, index) => (
          <C.HW_SelectedVariant key={variant} onPress={() => onFocus(index)}>
            <C.HW_SelectedVariantSwatch style={{ backgroundColor: variantColor(asset, index) }} />
            <C.HW_ToolValue numberOfLines={1} noWrap>{variant}</C.HW_ToolValue>
            <C.HW_ToolHint>{index === 0 ? 'default' : index === 1 ? 'alt' : 'override'}</C.HW_ToolHint>
          </C.HW_SelectedVariant>
        ))}
      </C.HW_SelectedVariants>
      {/* Plain readout — the old bar drew seed%100 as a fill width, a slider
          that wasn't one. The real seed control lives in the focus page. */}
      <C.HW_ToolRow>
        <C.HW_ToolLabel>seed</C.HW_ToolLabel>
        <C.HW_ToolValue>{seed}</C.HW_ToolValue>
      </C.HW_ToolRow>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>bank</C.HW_ToolLabel>
        <C.HW_ToolValue numberOfLines={1} noWrap>{asset.favorite ? 'pinned' : asset.recent ? 'recent' : asset.semanticKind ?? 'indexed'}</C.HW_ToolValue>
      </C.HW_ToolRow>
      <C.HW_ButtonRow>
        <C.HW_SmallButton onPress={onFocus}><C.HW_FormValue>focus material</C.HW_FormValue></C.HW_SmallButton>
      </C.HW_ButtonRow>
    </C.HW_ToolPanel>
  );
}
