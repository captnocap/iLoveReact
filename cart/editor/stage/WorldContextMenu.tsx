// stage/WorldContextMenu.tsx — the world surface's right-click quick menu
// (req_2733/req_2737).
//
// "Keep an edit within 200px of mouse movement": right-clicking a placed build
// piece in the viewport opens this at the cursor — in ANY tool mode — with the
// piece's quick verbs (Copy / Rotate / Delete, the same registry commands the
// keymap fires) and a real skin picker:
//
//   FACES  — one chip per slot role, each wearing its ACTUAL material (empty =
//            the kind default, shown as an empty "default" slot). Click a face
//            to TARGET it; with a target set, picking a skin paints only that
//            face. With NO target, picking a skin paints EVERY face — the
//            shared face-painting law.
//   RECENT — the live recently-used materials row (EditorState.recentMaterialIds).
//   grid   — search ("search skins…") over the RANKED catalog, paged like the
//            Ink panel (every tile is a live <Effect> thumb via AssetPreview,
//            so the page size is the live-Effect budget). Footer: pager, honest
//            count, and the "default" chip that clears the target back to the
//            kind look (all faces when untargeted).
//
// Rendered at the app ROOT via useContextMenu (window origin), exactly like
// ModelContextMenu.
import { useState } from 'react';
import { Box, Pressable, TextInput } from '@reactjit/primitives';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import { commandById } from '../data/commands';
import { pieceSlotRoles } from '../world/pieceSlots';
import { pieceLook, type MaterialRef, type PlacedPiece } from '../world/pieces';
import type { Asset } from '../data/types';
import AssetPreview from '../library/AssetPreview';
import { WORLD_PIECE_DELETE_COMMAND_ID, WORLD_PIECE_ROTATE_COMMAND_ID, WORLD_PIECE_SPIN_COMMAND_ID } from '../world/pieceCommandIds';
import { isAuthoredPiece } from '../world/authoredRegistry';

// The quick verbs, in reach order. Labels are the quick-menu voice ("Copy", not
// "Duplicate Selection"); ids are the SAME registry commands the menus/keymap run,
// so this menu never grows a second dispatch path. Key hints show only keys that
// actually fire on the world surface (D was ceded to WASD, req_2558 — no dead hints).
const QUICK_VERBS: { id: string; label: string; keyHint: string; closes: boolean }[] = [
  { id: 'duplicate-selection', label: 'Copy', keyHint: '', closes: true },
  // Rotate keeps the menu open (like the model menu's light switches) so 180°/270°
  // is two more clicks without re-picking; the header's yaw readout tracks live.
  { id: WORLD_PIECE_ROTATE_COMMAND_ID, label: 'Rotate 90°', keyHint: 'R', closes: false },
  { id: WORLD_PIECE_DELETE_COMMAND_ID, label: 'Delete', keyHint: 'Del', closes: true },
  // Paint Facade (req_3062): the explicit selection opens as one canvas.
  { id: 'paint-facade', label: 'Paint Facade', keyHint: '', closes: true },
];

const MENU_W = 240;
// Tile geometry: 3 across inside MENU_W. Every mounted tile is a live <Effect>
// thumbnail, so the PAGE is the live-Effect budget — the Ink panel's discipline.
const TILE_W = 68;
const TILE_H = 38;
const PAGE_SIZE = 12;
const RECENT_MAX = 4;
const EMPTY_SLOT_BG = '#0a1118';
const TILE_EDGE = '#00000055';

function SectionHead({ children }: { children: string }) {
  return (
    <Box style={{ height: 18, flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 10 }}>
      <C.HW_KeyText>{children}</C.HW_KeyText>
    </Box>
  );
}

// One skin tile: the material's real rendered preview + its name. `active` rings
// the material the targeted face (or, untargeted, any face) currently wears.
function SkinTile({ asset, active, onPick }: { asset: Asset; active: boolean; onPick: (id: string) => void }) {
  return (
    <Pressable tooltip={asset.name} onPress={() => onPick(asset.id)}>
      <Box style={{ width: TILE_W, gap: 2 }}>
        <Box style={{ width: TILE_W, height: TILE_H, borderRadius: 4, borderWidth: active ? 2 : 1, borderColor: active ? accentFor('primary') : TILE_EDGE, backgroundColor: EMPTY_SLOT_BG, overflow: 'hidden' }}>
          {/* live (uncached) previews — see AssetPreview's `live` doc (req_2743):
              sharing the library's staticKeys from a popover crashed the GPU. */}
          <AssetPreview asset={asset} live />
        </Box>
        <C.HW_KeyText numberOfLines={1} style={{ width: TILE_W, color: active ? accentFor('primary') : undefined }}>{asset.name}</C.HW_KeyText>
      </Box>
    </Pressable>
  );
}

export default function WorldContextMenu({ piece, materials, recentIds, resolveMaterial, onAssignSlot, onClearSlot, onCommand, onClose }: {
  /** the LIVE selected piece from EditorState (yaw/slots update while the menu is open) */
  piece: PlacedPiece;
  /** the RANKED material catalog (Skins tab, overrides applied, rankAssets order) */
  materials: Asset[];
  /** live recently-used material ids, most recent first (EditorState.recentMaterialIds) */
  recentIds: string[];
  resolveMaterial: (ref: MaterialRef) => { label: string; color: string };
  /** role null = paint EVERY face the piece exposes (the FacePainter law) */
  onAssignSlot: (id: string, role: string | null, assetId: string) => void;
  /** role null = clear EVERY face back to the kind default */
  onClearSlot: (id: string, role: string | null) => void;
  onCommand: (id: string, source: string) => void;
  onClose: () => void;
}) {
  // The TARGETED face, or null = paint every face. Fresh per open (menu unmounts).
  const [targetRole, setTargetRole] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const roles = pieceSlotRoles(piece.pieceId);
  const label = pieceLook(piece.pieceId)?.label ?? piece.pieceId;
  // Spin (SPINPROP req_3128) is an authored-prop verb: only mesh placements render
  // through the live mesh-ref path that animates; catalog boxes would ignore it.
  const spinning = (piece.spinDegPerSec ?? 0) !== 0;
  const verbs = isAuthoredPiece(piece.pieceId)
    ? [...QUICK_VERBS, { id: WORLD_PIECE_SPIN_COMMAND_ID, label: spinning ? 'Stop Spin' : 'Spin', keyHint: '', closes: false }]
    : QUICK_VERBS;

  const q = query.trim().toLowerCase();
  const filtered = q ? materials.filter((m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : materials;
  const maxPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const p = Math.min(page, maxPage);
  const pageTiles = filtered.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
  // Recents hide while searching — the grid IS the search result then.
  const recentTiles = q ? [] : recentIds.map((id) => materials.find((m) => m.id === id)).filter((m): m is Asset => !!m).slice(0, RECENT_MAX);

  // What each face wears now (asset when resolvable — its real preview draws in
  // the chip; a non-asset shader binding falls back to its resolver colour).
  const wornAssetIds = new Set<string>();
  for (const role of roles) {
    const ref = piece.slots?.[role];
    if (ref && 'assetId' in ref) wornAssetIds.add(ref.assetId);
  }
  const targetRef = targetRole ? piece.slots?.[targetRole] : undefined;
  const tileActive = (assetId: string): boolean =>
    targetRole ? !!targetRef && 'assetId' in targetRef && targetRef.assetId === assetId : wornAssetIds.has(assetId);

  const pick = (assetId: string) => onAssignSlot(piece.id, targetRole, assetId);

  return (
    <C.HW_StageContextMenu style={{ width: MENU_W }}>
      {/* What the verbs apply to + live yaw (and spin, when on) readout. */}
      <Box style={{ height: 24, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 8 }}>
        <Icon name="Box" size={12} color={accentFor('textDim')} />
        <C.HW_ContextText style={{ color: accentFor('textDim') }}>{label}</C.HW_ContextText>
        <C.HW_Spacer />
        <C.HW_KeyText>{spinning ? `${piece.yawDegrees}° · ${piece.spinDegPerSec}°/s` : `${piece.yawDegrees}°`}</C.HW_KeyText>
      </Box>
      {verbs.map((verb) => (
        <C.HW_ContextRow key={verb.id} onPress={() => { onCommand(verb.id, 'world-context'); if (verb.closes) onClose(); }}>
          <Icon name={commandById(verb.id).icon} size={12} color={accentFor('primary')} />
          <C.HW_ContextText>{verb.label}</C.HW_ContextText>
          <C.HW_Spacer />
          <C.HW_KeyText>{verb.keyHint}</C.HW_KeyText>
        </C.HW_ContextRow>
      ))}

      {roles.length ? (
        <>
          {/* FACES — the piece's real slots, each wearing its actual look (empty =
              default). Click to target one; click again to go back to all-faces. */}
          <SectionHead>{targetRole ? `FACES · ${targetRole}` : 'FACES · all'}</SectionHead>
          <Box style={{ flexDirection: 'row', gap: 6, paddingLeft: 10, paddingRight: 10, paddingBottom: 4, flexWrap: 'wrap' }}>
            {roles.map((role) => {
              const ref = piece.slots?.[role];
              const active = targetRole === role;
              const wornAsset = ref && 'assetId' in ref ? materials.find((m) => m.id === ref.assetId) : undefined;
              const bound = ref ? resolveMaterial(ref) : null;
              const tip = `${role} · now: ${bound ? bound.label : 'default'} · click to skin just this face`;
              return (
                <Pressable key={role} tooltip={tip} onPress={() => setTargetRole((cur) => (cur === role ? null : role))}>
                  <Box style={{ width: TILE_W, gap: 2 }}>
                    <Box style={{ width: TILE_W, height: TILE_H, borderRadius: 4, borderWidth: active ? 2 : 1, borderColor: active ? accentFor('primary') : '#2a3442', backgroundColor: bound && !wornAsset ? bound.color : EMPTY_SLOT_BG, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                      {wornAsset ? <AssetPreview asset={wornAsset} live /> : !bound ? <C.HW_KeyText>default</C.HW_KeyText> : null}
                    </Box>
                    <C.HW_KeyText style={{ color: active ? accentFor('primary') : undefined }}>{role}</C.HW_KeyText>
                  </Box>
                </Pressable>
              );
            })}
          </Box>

          {/* Search — narrows the ranked catalog; paging resets with each keystroke. */}
          <Box style={{ paddingLeft: 10, paddingRight: 10, paddingBottom: 4 }}>
            <TextInput
              text={query}
              placeholder="search skins…"
              onChangeText={(t: string) => { setQuery(t); setPage(0); }}
              style={{ backgroundColor: EMPTY_SLOT_BG, borderWidth: 1, borderColor: q ? accentFor('primary') : '#2a3442', borderRadius: 3, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, color: accentFor('textDim'), fontSize: 10 }}
            />
          </Box>

          {recentTiles.length ? (
            <>
              <SectionHead>RECENT</SectionHead>
              <Box style={{ flexDirection: 'row', gap: 6, paddingLeft: 10, paddingRight: 10, paddingBottom: 4, flexWrap: 'wrap' }}>
                {recentTiles.map((m) => <SkinTile key={m.id} asset={m} active={tileActive(m.id)} onPick={pick} />)}
              </Box>
            </>
          ) : null}

          <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 10, paddingRight: 10, paddingBottom: 4 }}>
            {pageTiles.map((m) => <SkinTile key={m.id} asset={m} active={tileActive(m.id)} onPick={pick} />)}
            {filtered.length === 0 ? <C.HW_KeyText>no skin by that name</C.HW_KeyText> : null}
          </Box>

          {/* Footer — pager + honest count + the default chip (clears the target,
              or every face when untargeted). Mirrors the map texture picker. */}
          <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 10, paddingBottom: 4 }}>
            <Pressable tooltip="previous page" onPress={() => setPage(Math.max(0, p - 1))} style={{ width: 22, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a3442' }}>
              <Icon name="ChevronLeft" size={11} color={accentFor('textDim')} />
            </Pressable>
            <C.HW_KeyText>{`${filtered.length} materials · ${p + 1}/${maxPage + 1}`}</C.HW_KeyText>
            <C.HW_Spacer />
            <Pressable
              tooltip={targetRole ? `reset ${targetRole} to the kind default` : 'reset every face to the kind default'}
              onPress={() => onClearSlot(piece.id, targetRole)}
              style={{ paddingLeft: 8, paddingRight: 8, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a3442' }}
            >
              <C.HW_KeyText>default</C.HW_KeyText>
            </Pressable>
            <Pressable tooltip="next page" onPress={() => setPage(Math.min(maxPage, p + 1))} style={{ width: 22, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2a3442' }}>
              <Icon name="ChevronRight" size={11} color={accentFor('textDim')} />
            </Pressable>
          </Box>
        </>
      ) : null}
    </C.HW_StageContextMenu>
  );
}
