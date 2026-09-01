// stage/ArchitectureContextMenu.tsx — the right-click quick menu for the
// SEMANTIC architecture (req_4739): drawn walls, their placed doors/windows,
// and the derived enclosure floors. The placed-piece menu's law, brought to
// the surfaces that are not pieces:
//
//   wall     — Delete (the same Del verb), FACES chips for side A / side B,
//              and the shared material picker → setSideFinish through the
//              engine. The side the click hit starts targeted.
//   opening  — Flip Facing / Delete verbs, plus PAINTINGS chips when the kit's
//              package stores paint skins (instance wardrobe, the req_3443
//              law — one palette tile, the placed opening picks its look here).
//   floor    — the material picker alone: floors are DERIVED (RULED req_4482),
//              so there is nothing to delete — the walls own its existence;
//              its finish is the editor-owned drape (worldFinishes).
//
// Rendered at the app ROOT via useContextMenu, exactly like WorldContextMenu.
import { useState } from 'react';
import { Box, Pressable } from '@reactjit/primitives';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { Asset } from '../data/types';
import type { WallSide } from '../world/architecture';
import type { PaintSkin } from '../data/paintVariants';
export type { ArchitectureContextTarget } from '../world/architecture';
import AssetPreview from '../library/AssetPreview';
import MaterialPickGrid, { QUICK_EMPTY_SLOT_BG, QUICK_MENU_W, QUICK_TILE_H, QUICK_TILE_W, SectionHead } from './MaterialPickGrid';
import { SURFACE_FINISH_CATALOG, SURFACE_FINISH_PREFIX } from '../world/surfaceFinishes';

function VerbRow({ icon, label, keyHint, onPress }: { icon: string; label: string; keyHint?: string; onPress: () => void }) {
  return (
    <C.HW_ContextRow onPress={onPress}>
      <Icon name={icon} size={12} color={accentFor('primary')} />
      <C.HW_ContextText>{label}</C.HW_ContextText>
      <C.HW_Spacer />
      <C.HW_KeyText>{keyHint ?? ''}</C.HW_KeyText>
    </C.HW_ContextRow>
  );
}

function Header({ icon, label, readout }: { icon: string; label: string; readout?: string }) {
  return (
    <Box style={{ height: 24, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 8 }}>
      <Icon name={icon} size={12} color={accentFor('textDim')} />
      <C.HW_ContextText style={{ color: accentFor('textDim') }}>{label}</C.HW_ContextText>
      <C.HW_Spacer />
      <C.HW_KeyText>{readout ?? ''}</C.HW_KeyText>
    </Box>
  );
}

/** The wall menu (req_4739): side chips target A or B; the picker dresses the
 * targeted side through the engine's setSideFinish. */
export function WallEdgeContextMenu({ edgeLabel, hitSide, sideMaterials, sideFinishIds, materials, recentIds, onAssignSide, onClearSide, onDelete, onClose }: {
  edgeLabel: string;
  /** the side the right-click hit — the FACES target starts there. */
  hitSide: WallSide;
  /** what each side wears now: a Skins asset when the finish resolves to one,
   *  else null = the style's default look. */
  sideMaterials: { a: Asset | null; b: Asset | null };
  /** the RAW engine finish ids — a `surface:` id is a Surface Package (worn
   *  detection for the SURFACE chips; it resolves to no Skins asset). */
  sideFinishIds?: { a: string; b: string };
  materials: Asset[];
  recentIds: readonly string[];
  onAssignSide: (side: WallSide, assetId: string) => void;
  onClearSide: (side: WallSide) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // The targeted side — fresh per open (the menu unmounts with the popover).
  const [targetSide, setTargetSide] = useState<WallSide>(hitSide);
  const worn = targetSide === 'a' ? sideMaterials.a : sideMaterials.b;
  const activeIds = new Set(worn ? [worn.id] : []);
  return (
    <C.HW_StageContextMenu style={{ width: QUICK_MENU_W }}>
      <Header icon="BrickWall" label={edgeLabel} />
      <VerbRow icon="Trash2" label="Delete Wall" keyHint="Del" onPress={() => { onDelete(); onClose(); }} />
      <SectionHead>{`FACES · side ${targetSide.toUpperCase()}`}</SectionHead>
      <Box style={{ flexDirection: 'row', gap: 6, paddingLeft: 10, paddingRight: 10, paddingBottom: 4, flexWrap: 'wrap' }}>
        {(['a', 'b'] as const).map((side) => {
          const asset = side === 'a' ? sideMaterials.a : sideMaterials.b;
          const active = targetSide === side;
          return (
            <Pressable key={side} tooltip={`side ${side.toUpperCase()} · now: ${asset ? asset.name : 'default'} · click to dress this side`} onPress={() => setTargetSide(side)}>
              <Box style={{ width: QUICK_TILE_W, gap: 2 }}>
                <Box style={{ width: QUICK_TILE_W, height: QUICK_TILE_H, borderRadius: 4, borderWidth: active ? 2 : 1, borderColor: active ? accentFor('primary') : '#2a3442', backgroundColor: QUICK_EMPTY_SLOT_BG, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                  {asset ? <SidePreview asset={asset} /> : <C.HW_KeyText>default</C.HW_KeyText>}
                </Box>
                <C.HW_KeyText style={{ color: active ? accentFor('primary') : undefined }}>{`side ${side.toUpperCase()}`}</C.HW_KeyText>
              </Box>
            </Pressable>
          );
        })}
      </Box>
      {/* Surface Packages (req_4783): projected GEOMETRY finishes — grab one
          and the flat side grows real bricks/ribs. Chips, not tiles: a
          package's look is its projected preview, not a 2D swatch. */}
      <SectionHead>SURFACE</SectionHead>
      <Box style={{ flexDirection: 'row', gap: 6, paddingLeft: 10, paddingRight: 10, paddingBottom: 4, flexWrap: 'wrap' }}>
        {SURFACE_FINISH_CATALOG.map((entry) => {
          const finishId = `${SURFACE_FINISH_PREFIX}${entry.pkg.id}`;
          const wornId = targetSide === 'a' ? sideFinishIds?.a : sideFinishIds?.b;
          const wornNow = wornId === finishId;
          return (
            <Pressable key={entry.pkg.id} tooltip={`${entry.label} — projected geometry on side ${targetSide.toUpperCase()}${wornNow ? ' · worn now' : ''}`} onPress={() => { if (!wornNow) onAssignSide(targetSide, finishId); }}>
              <Box style={{ paddingLeft: 8, paddingRight: 8, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: wornNow ? 2 : 1, borderColor: wornNow ? accentFor('primary') : '#2a3442', backgroundColor: QUICK_EMPTY_SLOT_BG }}>
                <C.HW_KeyText style={{ color: wornNow ? accentFor('primary') : undefined }}>{entry.label}</C.HW_KeyText>
              </Box>
            </Pressable>
          );
        })}
      </Box>
      <MaterialPickGrid
        materials={materials}
        recentIds={recentIds}
        activeIds={activeIds}
        defaultTip={`reset side ${targetSide.toUpperCase()} to the wall style's look`}
        onPick={(assetId) => onAssignSide(targetSide, assetId)}
        onDefault={() => onClearSide(targetSide)}
      />
    </C.HW_StageContextMenu>
  );
}

// The side chip's worn-material thumb — the raw live preview (the chip's own
// press targets the side; a nested tile press would double-handle).
function SidePreview({ asset }: { asset: Asset }) {
  return <AssetPreview asset={asset} live />;
}

/** The opening menu (req_4739): the door/window's quick verbs + its kit's
 * stored paintings as instance wardrobe. */
export function OpeningContextMenu({ label, paintings, wornSkinId, onSetPainting, onFlip, onDelete, onClose }: {
  label: string;
  paintings: readonly PaintSkin[];
  /** the paint-skin id this opening wears, or null = the kit's base look. */
  wornSkinId: string | null;
  onSetPainting: (skinId: string | null) => void;
  onFlip: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <C.HW_StageContextMenu style={{ width: QUICK_MENU_W }}>
      <Header icon="DoorOpen" label={label} />
      <VerbRow icon="FlipHorizontal2" label="Flip Facing" onPress={onFlip} />
      <VerbRow icon="Trash2" label="Delete Opening" keyHint="Del" onPress={() => { onDelete(); onClose(); }} />
      {paintings.length > 0 ? (
        <>
          <SectionHead>PAINTINGS</SectionHead>
          <Box style={{ flexDirection: 'row', gap: 6, paddingLeft: 10, paddingRight: 10, paddingBottom: 4, flexWrap: 'wrap' }}>
            {[{ id: null as string | null, name: 'Base' }, ...paintings].map((painting) => {
              const worn = wornSkinId === painting.id;
              return (
                <Pressable key={painting.id ?? 'base'} tooltip={painting.id === null ? `the kit's base look${worn ? ' · worn now' : ''}` : `dress this ${label} in ${painting.name}${worn ? ' · worn now' : ''}`} onPress={() => { if (!worn) onSetPainting(painting.id); }}>
                  <Box style={{ paddingLeft: 8, paddingRight: 8, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: worn ? 2 : 1, borderColor: worn ? accentFor('primary') : '#2a3442', backgroundColor: QUICK_EMPTY_SLOT_BG }}>
                    <C.HW_KeyText style={{ color: worn ? accentFor('primary') : undefined }}>{painting.name}</C.HW_KeyText>
                  </Box>
                </Pressable>
              );
            })}
          </Box>
        </>
      ) : null}
    </C.HW_StageContextMenu>
  );
}

/** The floor menu (req_4739): a derived plate has no delete — its walls own
 * its existence — so the menu IS the material picker. */
export function FloorContextMenu({ wornAsset, materials, recentIds, onAssign, onClear }: {
  wornAsset: Asset | null;
  materials: Asset[];
  recentIds: readonly string[];
  onAssign: (assetId: string) => void;
  onClear: () => void;
}) {
  return (
    <C.HW_StageContextMenu style={{ width: QUICK_MENU_W }}>
      <Header icon="Grid3x3" label="Floor" readout={wornAsset ? wornAsset.name : 'default'} />
      <MaterialPickGrid
        materials={materials}
        recentIds={recentIds}
        activeIds={new Set(wornAsset ? [wornAsset.id] : [])}
        defaultTip="reset this room's floor to the derived look"
        onPick={onAssign}
        onDefault={onClear}
      />
    </C.HW_StageContextMenu>
  );
}
