// editor/shell/ExportCharacterDialog.tsx — the character-export role choice.
//
// File → Export → Player / NPC Model opens this BEFORE anything writes: a
// character export must declare its ROLE (req_2771) — the game's ONE played
// model, or an NPC population model — and the two must never blur, so the
// dialog is the gate. The confirmed role lands in manifest.placeable
// ({ as: 'character', role }) — disk truth, req_2718. Exporting as Player
// REPLACES the current player model (the previous one demotes to NPC so the
// game never sees two played models); the Player card says so out loud when
// a current player model exists.
import { Box, Col, Row, Text, Pressable } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import type { CharacterRole } from '../data/types';

const PANEL = '#17181b', BORDER = '#2a2c31', TEXT = '#e8e8ea', DIM = '#9a9ea6', ACCENT = '#6ea8fe', BTN_BG = '#1f2126';

function RoleCard({ icon, title, blurb, note, onPress }: {
  icon: string; title: string; blurb: string; note?: string | null; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flexGrow: 1, flexBasis: 0, backgroundColor: BTN_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 14, gap: 8 }}
    >
      <Col style={{ gap: 8 }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Icon name={icon} size={18} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 13, fontWeight: '700' }}>{title}</Text>
        </Row>
        <Text style={{ color: DIM, fontSize: 11, lineHeight: 16 }}>{blurb}</Text>
        {note ? <Text style={{ color: ACCENT, fontSize: 10, fontFamily: 'ui-monospace' }}>{note}</Text> : null}
      </Col>
    </Pressable>
  );
}

export default function ExportCharacterDialog({ modelName, currentPlayerName, onCancel, onExport }: {
  modelName: string;
  /** The package currently declared as the played model, if any. */
  currentPlayerName: string | null;
  onCancel: () => void;
  onExport: (role: CharacterRole) => void;
}) {
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,5,7,0.6)', alignItems: 'center', justifyContent: 'center' }}>
      <Col style={{ width: 520, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 18, gap: 12 }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Icon name="PersonStanding" size={16} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 15, fontWeight: '600' }}>Export "{modelName}" as a character</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={onCancel}><Text style={{ color: DIM, fontSize: 12 }}>cancel</Text></Pressable>
        </Row>
        <Text style={{ color: DIM, fontSize: 11 }}>The role is written into the model's own package manifest — the compile bake reads it from there.</Text>

        <Row style={{ gap: 10, alignItems: 'stretch' }}>
          <RoleCard
            icon="PersonStanding"
            title="Player Model"
            blurb="THE played model — the figure you control in the game. Exactly one model holds this role."
            note={currentPlayerName ? `replaces "${currentPlayerName}" (it becomes an NPC model)` : 'no player model declared yet'}
            onPress={() => onExport('player')}
          />
          <RoleCard
            icon="Users"
            title="NPC Model"
            blurb="Joins the NPC population — a body the world's people can wear. Any number of models hold this role."
            onPress={() => onExport('npc')}
          />
        </Row>

        <Row style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Pressable onPress={onCancel} style={{ paddingLeft: 14, paddingRight: 14, paddingTop: 7, paddingBottom: 7, borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
            <Text style={{ color: DIM, fontSize: 12 }}>Cancel</Text>
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}
