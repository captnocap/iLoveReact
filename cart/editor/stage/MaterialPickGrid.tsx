// stage/MaterialPickGrid.tsx — the quick-menu material picker, factored out of
// WorldContextMenu (req_2733/req_2737) so the architecture quick menu
// (req_4739: walls, floors) offers the IDENTICAL search/recent/grid/pager
// surface. One vocabulary: a skin tile is a skin tile wherever it appears.
import { useState } from 'react';
import { Box, Pressable, TextInput } from '@reactjit/primitives';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { Asset } from '../data/types';
import AssetPreview from '../library/AssetPreview';

export const QUICK_MENU_W = 240;
// Tile geometry: 3 across inside QUICK_MENU_W. Every mounted tile is a live
// <Effect> thumbnail, so the PAGE is the live-Effect budget — the Ink panel's
// discipline.
export const QUICK_TILE_W = 68;
export const QUICK_TILE_H = 38;
const PAGE_SIZE = 12;
const RECENT_MAX = 4;
export const QUICK_EMPTY_SLOT_BG = '#0a1118';
const TILE_EDGE = '#00000055';

export function SectionHead({ children }: { children: string }) {
  return (
    <Box style={{ height: 18, flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 10 }}>
      <C.HW_KeyText>{children}</C.HW_KeyText>
    </Box>
  );
}

// One skin tile: the material's real rendered preview + its name. `active` rings
// the material the targeted face (or, untargeted, any face) currently wears.
export function SkinTile({ asset, active, onPick }: { asset: Asset; active: boolean; onPick: (id: string) => void }) {
  return (
    <Pressable tooltip={asset.name} onPress={() => onPick(asset.id)}>
      <Box style={{ width: QUICK_TILE_W, gap: 2 }}>
        <Box style={{ width: QUICK_TILE_W, height: QUICK_TILE_H, borderRadius: 4, borderWidth: active ? 2 : 1, borderColor: active ? accentFor('primary') : TILE_EDGE, backgroundColor: QUICK_EMPTY_SLOT_BG, overflow: 'hidden' }}>
          {/* live (uncached) previews — see AssetPreview's `live` doc (req_2743):
              sharing the library's staticKeys from a popover crashed the GPU. */}
          <AssetPreview asset={asset} live />
        </Box>
        <C.HW_KeyText numberOfLines={1} style={{ width: QUICK_TILE_W, color: active ? accentFor('primary') : undefined }}>{asset.name}</C.HW_KeyText>
      </Box>
    </Pressable>
  );
}

/** Search + RECENT + paged grid + footer (pager, honest count, default chip).
 *  `activeIds` rings what the target currently wears; `onPick` assigns and
 *  `onDefault` clears back to the surface's own look. */
export default function MaterialPickGrid({ materials, recentIds, activeIds, defaultTip, onPick, onDefault }: {
  /** the RANKED material catalog (Skins tab, overrides applied, rankAssets order) */
  materials: Asset[];
  /** live recently-used material ids, most recent first (EditorState.recentMaterialIds) */
  recentIds: readonly string[];
  /** asset ids the target currently wears — their tiles ring active */
  activeIds: ReadonlySet<string>;
  defaultTip: string;
  onPick: (assetId: string) => void;
  onDefault: () => void;
}) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const q = query.trim().toLowerCase();
  const filtered = q ? materials.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : materials;
  const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const p = Math.min(page, maxPage);
  const pageTiles = filtered.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
  // Recents hide while searching — the grid IS the search result then.
  const recentTiles = q ? [] : recentIds.map((id) => materials.find((m) => m.id === id)).filter((m): m is Asset => !!m).slice(0, RECENT_MAX);

  return (
    <>
      {/* Search — narrows the ranked catalog; paging resets with each keystroke. */}
      <Box style={{ paddingLeft: 10, paddingRight: 10, paddingBottom: 4 }}>
        <TextInput
          text={query}
          placeholder="search skins…"
          onChangeText={(t: string) => { setQuery(t); setPage(0); }}
          style={{ backgroundColor: QUICK_EMPTY_SLOT_BG, borderWidth: 1, borderColor: q ? accentFor('primary') : '#2a3442', borderRadius: 3, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, color: accentFor('textDim'), fontSize: 10 }}
        />
      </Box>

      {recentTiles.length ? (
        <>
          <SectionHead>RECENT</SectionHead>
          <Box style={{ flexDirection: 'row', gap: 6, paddingLeft: 10, paddingRight: 10, paddingBottom: 4, flexWrap: 'wrap' }}>
            {recentTiles.map((m) => <SkinTile key={m.id} asset={m} active={activeIds.has(m.id)} onPick={onPick} />)}
          </Box>
        </>
      ) : null}

      <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 10, paddingRight: 10, paddingBottom: 4 }}>
        {pageTiles.map((m) => <SkinTile key={m.id} asset={m} active={activeIds.has(m.id)} onPick={onPick} />)}
        {filtered.length === 0 ? <C.HW_KeyText>no skin by that name</C.HW_KeyText> : null}
      </Box>

      {/* Footer — pager + honest count + the default chip. Mirrors the map
          texture picker. */}
      <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 10, paddingBottom: 4 }}>
        <Pressable tooltip="previous page" onPress={() => setPage(Math.max(0, p - 1))} style={{ width: 22, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a3442' }}>
          <Icon name="ChevronLeft" size={11} color={accentFor('textDim')} />
        </Pressable>
        <C.HW_KeyText>{`${filtered.length} materials · ${p + 1}/${maxPage + 1}`}</C.HW_KeyText>
        <C.HW_Spacer />
        <Pressable
          tooltip={defaultTip}
          onPress={onDefault}
          style={{ paddingLeft: 8, paddingRight: 8, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a3442' }}
        >
          <C.HW_KeyText>default</C.HW_KeyText>
        </Pressable>
        <Pressable tooltip="next page" onPress={() => setPage(Math.min(maxPage, p + 1))} style={{ width: 22, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a3442' }}>
          <Icon name="ChevronRight" size={11} color={accentFor('textDim')} />
        </Pressable>
      </Box>
    </>
  );
}
