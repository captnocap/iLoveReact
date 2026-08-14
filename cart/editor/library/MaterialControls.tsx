// The selected-asset detail card (req_3135, concept 4): thumbnail + name +
// metadata + variant takes + the open verb, pinned at the dock's foot.
//
// Cleaned up in req_4435, all four defects in one card:
//   • It mounted with a catalog default at boot, so the drawer arrived focused
//     on something the user had never clicked and could not even see in the
//     tree's scroll position. `asset` is nullable now; null renders the
//     designed empty state.
//   • It printed "3 variants" directly above three variant chips. The chips
//     ARE the count; the sentence was the same fact, worse.
//   • The chips overflowed: three abreast in ~236px could not fit a name and
//     its role tag, so they overlapped. Takes are rows now (HW_VariantStrip is
//     a column) and both halves are legible.
//   • The name appeared as the title AND again as the slug in the meta line.
//     The slug shows only when it says something the title does not.
//   • "focus material" opened the Material Lab. The label says that now.
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { Asset } from '../data/types';
import { variantColor } from '../data/catalog';
import AssetPreview from './AssetPreview';
import FocusEmpty from '../inspector/FocusEmpty';

/** The role each take plays for the material — take 0 is what gets used unless
 *  something asks for another. */
const TAKE_ROLES = ['default', 'alt', 'override'] as const;

/** Is this slug just the title, lowercased and hyphenated? Then it is the same
 *  fact twice and the card drops it. */
function slugRestatesName(slug: string, name: string): boolean {
  return slug.toLowerCase() === name.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
}

export default function MaterialControls({
  asset,
  onFocus,
  onFavorite,
  onRename,
}: {
  /** NULL when nothing is selected — the card shows its empty state, never a
   *  catalog default (req_4435). */
  asset: Asset | null;
  // Opens the Material Lab on this material; a take row passes its index so
  // the lab lands on that take.
  onFocus: (variant?: number) => void;
  onFavorite: (assetId: string) => void;
  onRename: (assetId: string, name: string) => void;
}) {
  if (!asset) {
    return (
      <C.HW_DetailCard>
        <FocusEmpty
          shows="Material"
          fill="click a material in the list above"
          icon="Palette"
        />
      </C.HW_DetailCard>
    );
  }
  const takes = (asset.variants?.length ? asset.variants : ['source']).slice(0, TAKE_ROLES.length);
  const seed = asset.seed ?? 0;
  const bank = asset.favorite ? 'pinned' : asset.recent ? 'recent' : asset.semanticKind ?? 'indexed';
  const slug = asset.recipe && !slugRestatesName(asset.recipe, asset.name) ? asset.recipe : null;
  const source = asset.sourceKind ?? 'indexed';
  return (
    <C.HW_DetailCard>
      <C.HW_DetailTop>
        <C.HW_DetailThumb>
          <AssetPreview asset={asset} />
        </C.HW_DetailThumb>
        <C.HW_DetailText>
          <C.HW_DetailNameRow>
            <C.HW_RenameInput value={asset.name} onChange={(name: string) => onRename(asset.id, name)} />
            <C.HW_IconMiniButton
              onPress={() => onFavorite(asset.id)}
              tooltip={asset.favorite ? 'Unpin from Favorites' : 'Pin to Favorites'}
            >
              <Icon name="Star" size={13} color={accentFor(asset.favorite ? 'warning' : 'textFaint')} />
            </C.HW_IconMiniButton>
          </C.HW_DetailNameRow>
          <C.HW_DetailMeta>{slug ? `${slug} · ${source}` : source}</C.HW_DetailMeta>
          <C.HW_DetailMeta>{`seed ${seed} · ${bank}`}</C.HW_DetailMeta>
        </C.HW_DetailText>
      </C.HW_DetailTop>
      {/* A take row is a VERB: it opens the Material Lab on that take. */}
      <C.HW_VariantStrip>
        {takes.map((take, index) => (
          <C.HW_VariantPill
            key={take}
            onPress={() => onFocus(index)}
            tooltip={`Open ${asset.name} — ${take} (${TAKE_ROLES[index]}) in the Material Lab`}
          >
            <C.HW_VariantSwatch style={{ backgroundColor: variantColor(asset, index) }} />
            <C.HW_VariantLabel>{take}</C.HW_VariantLabel>
            <C.HW_VariantRole>{TAKE_ROLES[index]}</C.HW_VariantRole>
          </C.HW_VariantPill>
        ))}
      </C.HW_VariantStrip>
      <C.HW_VerbRow>
        <C.HW_VerbPrimary
          onPress={() => onFocus()}
          tooltip={`Open ${asset.name} in the Material Lab as a working recipe`}
        >
          <Icon name="FlaskConical" size={12} color={accentFor('primary')} />
          <C.HW_VerbText>Open in Material Lab</C.HW_VerbText>
        </C.HW_VerbPrimary>
      </C.HW_VerbRow>
    </C.HW_DetailCard>
  );
}
