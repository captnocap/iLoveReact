import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { Asset } from '../data/types';
import { variantColor } from '../data/catalog';

export default function MaterialCatalogRow(props: {
  asset: Asset;
  active: boolean;
  onAsset: (asset: Asset) => void;
  onFavorite: (assetId: string) => void;
  onVariant: (label: string) => void;
}) {
  const Row = props.active ? C.HW_MaterialCardOn : C.HW_MaterialCard;
  const variants = props.asset.variants ?? ['base', 'aged', 'wet'];
  const bank = props.asset.favorite ? 'favorite' : props.asset.recent ? 'recent' : 'catalog';
  const seed = props.asset.seed ?? 0;
  return (
    <Row onPress={() => props.onAsset(props.asset)}>
      <C.HW_MaterialSwatch style={{ backgroundColor: props.asset.color }} />
      <C.HW_MaterialInfo>
        <C.HW_MaterialTitleRow>
          <C.HW_MaterialName>{props.asset.name}</C.HW_MaterialName>
          <C.HW_Spacer />
          <C.HW_MaterialStat>{props.asset.used} uses</C.HW_MaterialStat>
        </C.HW_MaterialTitleRow>
        <C.HW_MaterialStatsRow>
          <C.HW_MaterialStat>{props.asset.recipe ?? 'catalog asset'}</C.HW_MaterialStat>
          <C.HW_MaterialStat>seed {seed}</C.HW_MaterialStat>
          <C.HW_MaterialStat>{bank}</C.HW_MaterialStat>
        </C.HW_MaterialStatsRow>
        <C.HW_VariantStrip>
          {variants.map((variant, index) => (
            <C.HW_VariantPill key={variant} onPress={() => props.onVariant(`${props.asset.name} variant ${variant}`)}>
              <C.HW_VariantSwatch style={{ backgroundColor: variantColor(props.asset, index) }} />
              <C.HW_VariantLabel>{variant}</C.HW_VariantLabel>
            </C.HW_VariantPill>
          ))}
        </C.HW_VariantStrip>
      </C.HW_MaterialInfo>
      <C.HW_MaterialActions>
        <C.HW_IconMiniButton onPress={() => props.onFavorite(props.asset.id)}>
          <Icon name="Star" size={13} color={accentFor(props.asset.favorite ? 'warning' : 'textFaint')} />
        </C.HW_IconMiniButton>
      </C.HW_MaterialActions>
    </Row>
  );
}
