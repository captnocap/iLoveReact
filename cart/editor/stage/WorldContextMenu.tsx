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
//   picker — search / RECENT / paged grid / default chip, the shared
//            MaterialPickGrid (req_4739 factored it out so walls and floors
//            offer the identical surface).
//
// Rendered at the app ROOT via useContextMenu (window origin), exactly like
// ModelContextMenu.
import { useState } from 'react';
import { Box, Pressable } from '@reactjit/primitives';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import { commandById } from '../data/commands';
import { pieceSlotEntries } from '../world/pieceSlots';
import { pieceLook, type MaterialRef, type PlacedPiece } from '../world/pieces';
import type { Asset } from '../data/types';
import AssetPreview from '../library/AssetPreview';
import MaterialPickGrid, { QUICK_EMPTY_SLOT_BG, QUICK_MENU_W, QUICK_TILE_H, QUICK_TILE_W, SectionHead } from './MaterialPickGrid';
import { WORLD_PIECE_DELETE_COMMAND_ID, WORLD_PIECE_ROTATE_COMMAND_ID, WORLD_PIECE_SPIN_COMMAND_ID } from '../world/pieceCommandIds';
import { isAuthoredPiece, paintSkinIdOf } from '../world/authoredRegistry';
import type { PaintSkin } from '../data/paintVariants';

// The quick verbs, in reach order. Labels are the quick-menu voice ("Copy", not
// "Duplicate Selection"); ids are the SAME registry commands the menus/keymap run,
// so this menu never grows a second dispatch path. Key hints show only keys that
// actually fire on the world surface (D was ceded to WASD, req_2558 — no dead hints).
const QUICK_VERBS: { id: string; label: string; keyHint: string; closes: boolean }[] = [
  { id: 'duplicate-selection', label: 'Copy', keyHint: '', closes: true },
  { id: 'create-prefab', label: 'Create Prefab…', keyHint: '', closes: true },
  // Rotate keeps the menu open (like the model menu's light switches) so 180°/270°
  // is two more clicks without re-picking; the header's yaw readout tracks live.
  { id: WORLD_PIECE_ROTATE_COMMAND_ID, label: 'Rotate 90°', keyHint: 'R', closes: false },
  { id: WORLD_PIECE_DELETE_COMMAND_ID, label: 'Delete', keyHint: 'Del', closes: true },
  // Paint Facade (req_3062): the explicit selection opens as one canvas.
  { id: 'paint-facade', label: 'Paint Facade', keyHint: '', closes: true },
];

export default function WorldContextMenu({ piece, materials, recentIds, resolveMaterial, onAssignSlot, onClearSlot, paintings = [], basePaintingId = null, onSetPainting, onCommand, onClose }: {
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
  /** the model's STORED paintings (req_3443) — the palette lists one entry per
   *  model; which painting THIS instance wears is chosen here. Empty = no section. */
  paintings?: readonly PaintSkin[];
  /** the painting the model's current BASE look IS (req_3459) — when set, the
   *  redundant "Current" chip collapses into that named painting's chip, and a
   *  base-wearing instance rings it as worn. */
  basePaintingId?: string | null;
  /** dress the instance in a stored painting; null returns it to the base look */
  onSetPainting?: (id: string, skinId: string | null) => void;
  onCommand: (id: string, source: string) => void;
  onClose: () => void;
}) {
  // The TARGETED face, or null = paint every face. Fresh per open (menu unmounts).
  const [targetRole, setTargetRole] = useState<string | null>(null);
  const roleEntries = pieceSlotEntries(piece.pieceId);
  const roles = roleEntries.map((role) => role.id);
  const roleLabel = (id: string | null) => roleEntries.find((role) => role.id === id)?.label ?? id ?? 'all';
  const label = pieceLook(piece.pieceId)?.label ?? piece.pieceId;
  // Spin (SPINPROP req_3128) is an authored-prop verb: only mesh placements render
  // through the live mesh-ref path that animates; catalog boxes would ignore it.
  const spinning = (piece.spinDegPerSec ?? 0) !== 0;
  const verbs = isAuthoredPiece(piece.pieceId)
    ? [...QUICK_VERBS, { id: WORLD_PIECE_SPIN_COMMAND_ID, label: spinning ? 'Stop Spin' : 'Spin', keyHint: '', closes: false }]
    : QUICK_VERBS;

  // What each face wears now (asset when resolvable — its real preview draws in
  // the chip; a non-asset shader binding falls back to its resolver colour).
  const wornAssetIds = new Set<string>();
  for (const role of roles) {
    const ref = piece.slots?.[role];
    if (ref && 'assetId' in ref) wornAssetIds.add(ref.assetId);
  }
  const targetRef = targetRole ? piece.slots?.[targetRole] : undefined;
  const activeIds = targetRole
    ? new Set(targetRef && 'assetId' in targetRef ? [targetRef.assetId] : [])
    : wornAssetIds;

  return (
    <C.HW_StageContextMenu style={{ width: QUICK_MENU_W }}>
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

      {paintings.length > 0 && onSetPainting && isAuthoredPiece(piece.pieceId) ? (
        <>
          {/* PAINTINGS (req_3443) — the model's stored looks, one chip each. The
              palette carries ONE entry per model; the placed instance picks its
              look HERE. Swap keeps the menu open (like Rotate) so the change is
              visible under the cursor. req_3459: a "Current" chip appears ONLY
              when the model's live base look matches no saved painting — when it
              IS one (the common case right after Save Painting), that painting's
              own chip carries it, and a base-wearing instance rings it as worn. */}
          <SectionHead>PAINTINGS</SectionHead>
          <Box style={{ flexDirection: 'row', gap: 6, paddingLeft: 10, paddingRight: 10, paddingBottom: 4, flexWrap: 'wrap' }}>
            {(basePaintingId ? [...paintings] : [{ id: null as string | null, name: 'Current' }, ...paintings]).map((painting) => {
              const wornSkinId = paintSkinIdOf(piece.pieceId);
              const worn = wornSkinId === painting.id
                || (wornSkinId === null && painting.id !== null && painting.id === basePaintingId);
              const tip = painting.id === null
                ? `the model's current Studio look — not saved as a painting${worn ? ' · worn now' : ''}`
                : `dress this ${label} in ${painting.name}${worn ? ' · worn now' : ''}`;
              // Picking the painting the base look IS lands the canonical base id,
              // so an instance never wears a #p alias of the identical look.
              const pick = painting.id === basePaintingId ? null : painting.id;
              return (
                <Pressable key={painting.id ?? 'current'} tooltip={tip} onPress={() => { if (!worn) onSetPainting(piece.id, pick); }}>
                  <Box style={{ paddingLeft: 8, paddingRight: 8, height: 20, borderRadius: 4, alignItems: 'center', justifyContent: 'center', borderWidth: worn ? 2 : 1, borderColor: worn ? accentFor('primary') : '#2a3442', backgroundColor: QUICK_EMPTY_SLOT_BG }}>
                    <C.HW_KeyText style={{ color: worn ? accentFor('primary') : undefined }}>{painting.name}</C.HW_KeyText>
                  </Box>
                </Pressable>
              );
            })}
          </Box>
        </>
      ) : null}

      {roles.length ? (
        <>
          {/* FACES — the piece's real slots, each wearing its actual look (empty =
              default). Click to target one; click again to go back to all-faces. */}
          <SectionHead>{targetRole ? `FACES · ${roleLabel(targetRole)}` : 'FACES · all'}</SectionHead>
          <Box style={{ flexDirection: 'row', gap: 6, paddingLeft: 10, paddingRight: 10, paddingBottom: 4, flexWrap: 'wrap' }}>
            {roleEntries.map((role) => {
              const ref = piece.slots?.[role.id];
              const active = targetRole === role.id;
              const wornAsset = ref && 'assetId' in ref ? materials.find((m) => m.id === ref.assetId) : undefined;
              const bound = ref ? resolveMaterial(ref) : null;
              const tip = `${role.label} · now: ${bound ? bound.label : 'default'} · click to skin just this face`;
              return (
                <Pressable key={role.id} tooltip={tip} onPress={() => setTargetRole((cur) => (cur === role.id ? null : role.id))}>
                  <Box style={{ width: QUICK_TILE_W, gap: 2 }}>
                    <Box style={{ width: QUICK_TILE_W, height: QUICK_TILE_H, borderRadius: 4, borderWidth: active ? 2 : 1, borderColor: active ? accentFor('primary') : '#2a3442', backgroundColor: bound && !wornAsset ? bound.color : QUICK_EMPTY_SLOT_BG, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                      {wornAsset ? <AssetPreview asset={wornAsset} live /> : !bound ? <C.HW_KeyText>default</C.HW_KeyText> : null}
                    </Box>
                    <C.HW_KeyText style={{ color: active ? accentFor('primary') : undefined }}>{role.label}</C.HW_KeyText>
                  </Box>
                </Pressable>
              );
            })}
          </Box>

          <MaterialPickGrid
            materials={materials}
            recentIds={recentIds}
            activeIds={activeIds}
            defaultTip={targetRole ? `reset ${targetRole} to the kind default` : 'reset every face to the kind default'}
            onPick={(assetId) => onAssignSlot(piece.id, targetRole, assetId)}
            onDefault={() => onClearSlot(piece.id, targetRole)}
          />
        </>
      ) : null}
    </C.HW_StageContextMenu>
  );
}
