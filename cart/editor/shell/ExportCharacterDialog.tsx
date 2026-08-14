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
import type { CharacterRigReadinessCheck } from '../../../runtime/skeleton';
import { characterExportReadiness } from './characterExportReadiness';

const PANEL = '#17181b', BORDER = '#2a2c31', TEXT = '#e8e8ea', DIM = '#9a9ea6', ACCENT = '#6ea8fe', BTN_BG = '#1f2126', WARN = '#e8b04c';

function RoleCard({ icon, title, blurb, note, enabled, onPress }: {
  icon: string; title: string; blurb: string; note?: string | null; enabled: boolean; onPress: () => void;
}) {
  const content = (
    <Col style={{ gap: 8, opacity: enabled ? 1 : 0.42 }}>
      <Row style={{ alignItems: 'center', gap: 8 }}>
        <Icon name={icon} size={18} color={enabled ? ACCENT : DIM} />
        <Text style={{ color: TEXT, fontSize: 13, fontWeight: '700' }}>{title}</Text>
      </Row>
      <Text style={{ color: DIM, fontSize: 11, lineHeight: 16 }}>{blurb}</Text>
      {note ? <Text style={{ color: enabled ? ACCENT : WARN, fontSize: 10, fontFamily: 'ui-monospace' }}>{note}</Text> : null}
    </Col>
  );
  return enabled ? (
    <Pressable
      onPress={onPress}
      style={{ flexGrow: 1, flexBasis: 0, backgroundColor: BTN_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 14, gap: 8 }}
    >
      {content}
    </Pressable>
  ) : (
    <Box style={{ flexGrow: 1, flexBasis: 0, backgroundColor: BTN_BG, borderWidth: 1, borderColor: BORDER, borderRadius: 10, padding: 14, gap: 8 }}>
      {content}
    </Box>
  );
}

export default function ExportCharacterDialog({ modelName, currentPlayerName, readiness, onCancel, onExport }: {
  modelName: string;
  /** The package currently declared as the played model, if any. */
  currentPlayerName: string | null;
  readiness: CharacterRigReadinessCheck[];
  onCancel: () => void;
  onExport: (role: CharacterRole) => void;
}) {
  const { rows, ready } = characterExportReadiness(readiness);
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

        {/* The bind artifact is the rig. Names and outliner ordering are absent
            by design: neither participates in readiness or runtime loading. */}
        <Col style={{ gap: 3, backgroundColor: '#101114', borderWidth: 1, borderColor: BORDER, borderRadius: 8, padding: 10 }}>
          {rows.map((row) => (
            <Row key={row.id} style={{ alignItems: 'center', gap: 7 }}>
              <Icon name={row.ready ? 'Check' : 'X'} size={11} color={row.ready ? ACCENT : WARN} />
              <Text style={{ color: row.ready ? TEXT : WARN, fontSize: 10, fontFamily: 'ui-monospace' }}>
                {row.detail ?? row.id.replace(/_/g, ' ')}
              </Text>
            </Row>
          ))}
          {!ready ? <Text style={{ color: WARN, fontSize: 10, fontFamily: 'ui-monospace', marginTop: 4 }}>Play/export stays disabled until every bind check is ready.</Text> : null}
        </Col>

        <Row style={{ gap: 10, alignItems: 'stretch' }}>
          <RoleCard
            icon="PersonStanding"
            title="Player Model"
            blurb="THE played model — the figure you control in the game. Exactly one model holds this role."
            note={ready ? (currentPlayerName ? `replaces "${currentPlayerName}" (it becomes an NPC model)` : 'no player model declared yet') : 'complete Character · Rig readiness first'}
            enabled={ready}
            onPress={() => onExport('player')}
          />
          <RoleCard
            icon="Users"
            title="NPC Model"
            blurb="Joins the NPC population — a body the world's people can wear. Any number of models hold this role."
            note={ready ? null : 'complete Character · Rig readiness first'}
            enabled={ready}
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
