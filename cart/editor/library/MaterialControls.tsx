import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { Asset } from '../data/types';
import { variantColor } from '../data/catalog';

export default function MaterialControls({
  asset,
  onFocus,
  onAction,
  onFavorite,
  onRename,
}: {
  asset: Asset;
  onFocus: () => void;
  onAction: (label: string) => void;
  onFavorite: (assetId: string) => void;
  onRename: (assetId: string, name: string) => void;
}) {
  const variants = asset.variants ?? ['v0', 'v1', 'v2'];
  const seed = asset.seed ?? 0;
  const usageCount = 0;
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
      <C.HW_StatGrid>
        <C.HW_StatCell>
          <C.HW_StatValue>{usageCount}</C.HW_StatValue>
          <C.HW_StatLabel>uses</C.HW_StatLabel>
        </C.HW_StatCell>
        <C.HW_StatCell>
          <C.HW_StatValue>{usageCount}</C.HW_StatValue>
          <C.HW_StatLabel>maps</C.HW_StatLabel>
        </C.HW_StatCell>
        <C.HW_StatCell>
          <C.HW_StatValue>{variants.length}</C.HW_StatValue>
          <C.HW_StatLabel>variants</C.HW_StatLabel>
        </C.HW_StatCell>
      </C.HW_StatGrid>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>recipe</C.HW_ToolLabel>
        <C.HW_ToolValue>{asset.recipe ?? 'catalog asset'}</C.HW_ToolValue>
      </C.HW_ToolRow>
      <C.HW_SelectedVariants>
        {variants.map((variant, index) => (
          <C.HW_SelectedVariant key={variant} onPress={() => onAction(`${asset.name} variant ${variant}`)}>
            <C.HW_SelectedVariantSwatch style={{ backgroundColor: variantColor(asset, index) }} />
            <C.HW_ToolValue>{variant}</C.HW_ToolValue>
            <C.HW_ToolHint>{index === 0 ? 'default' : index === 1 ? 'alt' : 'override'}</C.HW_ToolHint>
          </C.HW_SelectedVariant>
        ))}
      </C.HW_SelectedVariants>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>seed</C.HW_ToolLabel>
        <C.HW_MiniBar><C.HW_MiniFill style={{ width: `${Math.min(100, Math.max(0, seed % 100))}%` }} /></C.HW_MiniBar>
        <C.HW_ToolValue>{seed}</C.HW_ToolValue>
      </C.HW_ToolRow>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>detail</C.HW_ToolLabel>
        <C.HW_MiniBar><C.HW_MiniFill style={{ width: '0%' }} /></C.HW_MiniBar>
        <C.HW_ToolValue>—</C.HW_ToolValue>
      </C.HW_ToolRow>
      <C.HW_ToolRow>
        <C.HW_ToolLabel>bank</C.HW_ToolLabel>
        <C.HW_ToolValue>{asset.favorite ? 'pinned' : asset.recent ? 'recent' : 'catalog'}</C.HW_ToolValue>
        <C.HW_Spacer />
        <C.HW_ToolHint>no route change</C.HW_ToolHint>
      </C.HW_ToolRow>
      <C.HW_ButtonRow>
        <C.HW_SmallButton onPress={onFocus}><C.HW_FormValue>focus material</C.HW_FormValue></C.HW_SmallButton>
        <C.HW_SmallButton onPress={() => onAction('export variant')}><C.HW_FormValue>save variant</C.HW_FormValue></C.HW_SmallButton>
      </C.HW_ButtonRow>
    </C.HW_ToolPanel>
  );
}
