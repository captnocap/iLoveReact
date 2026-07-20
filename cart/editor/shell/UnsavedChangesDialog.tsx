import { Box, Col, Pressable, Row, Text } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';

const PANEL = '#10151d';
const BORDER = '#283446';
const TEXT = '#dbe5f3';
const DIM = '#8190a3';
const ACCENT = '#31d6e7';

function Button({ label, primary = false, onPress }: { label: string; primary?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ height: 29, paddingLeft: 12, paddingRight: 12, alignItems: 'center', justifyContent: 'center', borderWidth: primary ? 0 : 1, borderColor: BORDER, borderRadius: 5, backgroundColor: primary ? ACCENT : PANEL }}>
      <Text fontSize={11} color={primary ? '#081014' : DIM} style={{ fontWeight: primary ? 800 : 500 }}>{label}</Text>
    </Pressable>
  );
}

export default function UnsavedChangesDialog({
  documentName,
  saveLabel = 'Save',
  discardLabel = 'Discard',
  cancelLabel = 'Cancel',
  onSave,
  onDiscard,
  onCancel,
}: {
  documentName: string;
  saveLabel?: string;
  discardLabel?: string;
  cancelLabel?: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <Box blocksPointerEvents style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <Col style={{ width: 440, gap: 14, padding: 16, borderWidth: 1, borderColor: BORDER, borderRadius: 10, backgroundColor: PANEL }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Icon name="FileWarning" size={16} color={ACCENT} />
          <Text fontSize={13} color={TEXT} style={{ fontWeight: 800 }}>Unsaved changes</Text>
        </Row>
        <Text fontSize={11} color={TEXT} numberOfLines={1} noWrap>{documentName}</Text>
        <Row style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Button label={cancelLabel} onPress={onCancel} />
          <Button label={discardLabel} onPress={onDiscard} />
          <Button label={saveLabel} primary onPress={onSave} />
        </Row>
      </Col>
    </Box>
  );
}
