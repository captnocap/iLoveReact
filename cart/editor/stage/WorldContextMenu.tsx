// stage/WorldContextMenu.tsx — the world surface's right-click quick menu (req_2733).
//
// "Keep an edit within 200px of mouse movement": right-clicking a placed build
// piece in the viewport opens this at the cursor — in ANY tool mode — with the
// piece's quick verbs (Copy / Rotate / Delete, the same registry commands the
// keymap fires) and its TEXTURE SLOTS as inline quick-selects: each slot row
// expands to a swatch grid of the material catalog, one click binds. Rendered at
// the app ROOT via useContextMenu (window origin), exactly like ModelContextMenu.
import { useState } from 'react';
import { Box, Pressable } from '@reactjit/primitives';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import { commandById } from '../data/commands';
import { pieceSlotRoles } from '../world/pieceSlots';
import { pieceLook, type MaterialRef, type PlacedPiece } from '../world/pieces';
import type { Asset } from '../data/types';

// The quick verbs, in reach order. Labels are the quick-menu voice ("Copy", not
// "Duplicate Selection"); ids are the SAME registry commands the menus/keymap run,
// so this menu never grows a second dispatch path. Key hints show only keys that
// actually fire on the world surface (D was ceded to WASD, req_2558 — no dead hints).
const QUICK_VERBS: { id: string; label: string; keyHint: string; closes: boolean }[] = [
  { id: 'duplicate-selection', label: 'Copy', keyHint: '', closes: true },
  // Rotate keeps the menu open (like the model menu's light switches) so 180°/270°
  // is two more clicks without re-picking; the header's yaw readout tracks live.
  { id: 'rotate-selection', label: 'Rotate 90°', keyHint: 'R', closes: false },
  { id: 'delete-selection', label: 'Delete', keyHint: 'Del', closes: true },
];

// Swatch-grid cap per slot flyout — a quick select, not the content browser.
// Truncation is LOUD: the overflow row says how many more live in the browser.
const QUICK_MATERIAL_CAP = 40;

export default function WorldContextMenu({ piece, materials, resolveMaterial, onAssignSlot, onClearSlot, onCommand, onClose }: {
  /** the LIVE selected piece from EditorState (yaw/slots update while the menu is open) */
  piece: PlacedPiece;
  /** the material catalog the slot flyouts quick-select from (Skins tab, overrides applied) */
  materials: Asset[];
  resolveMaterial: (ref: MaterialRef) => { label: string; color: string };
  onAssignSlot: (id: string, role: string, assetId: string) => void;
  onClearSlot: (id: string, role: string) => void;
  onCommand: (id: string, source: string) => void;
  onClose: () => void;
}) {
  // One slot flyout open at a time — the menu stays a quick strip, not a wall.
  const [openRole, setOpenRole] = useState<string | null>(null);
  const roles = pieceSlotRoles(piece.pieceId);
  const label = pieceLook(piece.pieceId)?.label ?? piece.pieceId;
  const shown = materials.slice(0, QUICK_MATERIAL_CAP);
  return (
    <C.HW_StageContextMenu>
      {/* What the verbs apply to + live yaw readout. */}
      <Box style={{ height: 24, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 8 }}>
        <Icon name="Box" size={12} color={accentFor('textDim')} />
        <C.HW_ContextText style={{ color: accentFor('textDim') }}>{label}</C.HW_ContextText>
        <C.HW_Spacer />
        <C.HW_KeyText>{piece.yawDegrees}°</C.HW_KeyText>
      </Box>
      {QUICK_VERBS.map((verb) => (
        <C.HW_ContextRow key={verb.id} onPress={() => { onCommand(verb.id, 'context'); if (verb.closes) onClose(); }}>
          <Icon name={commandById(verb.id).icon} size={12} color={accentFor('primary')} />
          <C.HW_ContextText>{verb.label}</C.HW_ContextText>
          <C.HW_Spacer />
          <C.HW_KeyText>{verb.keyHint}</C.HW_KeyText>
        </C.HW_ContextRow>
      ))}
      {/* TEXTURE SLOTS — one row per slot role; expand for the swatch quick-select.
          Assigning keeps the menu open (the chip + tint show the bind landing);
          authored pieces expose no catalog slots yet, so no rows render there. */}
      {roles.map((role) => {
        const ref = piece.slots?.[role];
        const bound = ref ? resolveMaterial(ref) : null;
        const open = openRole === role;
        return (
          <Box key={role}>
            <C.HW_ContextRow onPress={() => setOpenRole(open ? null : role)}>
              <C.HW_BuildPieceChip style={{ width: 12, height: 12, backgroundColor: bound ? bound.color : '#0a1118' }} />
              <C.HW_ContextText>{role}</C.HW_ContextText>
              <C.HW_Spacer />
              <C.HW_KeyText>{bound ? bound.label : 'default'}</C.HW_KeyText>
              <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={12} color={accentFor('textDim')} />
            </C.HW_ContextRow>
            {open ? (
              <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingLeft: 26, paddingRight: 10, paddingTop: 2, paddingBottom: 6 }}>
                {ref ? (
                  <Pressable
                    tooltip="clear — back to the kind default"
                    onPress={() => onClearSlot(piece.id, role)}
                    style={{ width: 14, height: 14, borderRadius: 3, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: accentFor('textDim') }}
                  >
                    <Icon name="X" size={9} color={accentFor('textDim')} />
                  </Pressable>
                ) : null}
                {shown.map((m) => (
                  <Pressable
                    key={m.id}
                    tooltip={m.name}
                    onPress={() => onAssignSlot(piece.id, role, m.id)}
                    style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: m.color, borderWidth: 1, borderColor: ref && 'assetId' in ref && ref.assetId === m.id ? accentFor('primary') : '#00000055' }}
                  />
                ))}
                {materials.length > shown.length ? (
                  <C.HW_KeyText>+{materials.length - shown.length} more in the content browser</C.HW_KeyText>
                ) : null}
              </Box>
            ) : null}
          </Box>
        );
      })}
    </C.HW_StageContextMenu>
  );
}
