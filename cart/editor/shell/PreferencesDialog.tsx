import { Box, Pressable, Row, Text } from '../../../runtime/primitives';
import { PreferencesPane } from '../../../runtime/settings';
import { Icon } from '../../../runtime/icons/Icon';
import { editorSettings } from '../data/editorSettings';

const PANEL = '#10151d';
const BORDER = '#283446';
const TEXT = '#dbe5f3';
const DIM = '#8190a3';

export default function PreferencesDialog({ onClose }: { onClose: () => void }) {
  return (
    <Box blocksPointerEvents style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <Box style={{ width: 720, height: 520, flexDirection: 'column', borderWidth: 1, borderColor: BORDER, borderRadius: 10, backgroundColor: PANEL, overflow: 'hidden' }}>
        <Row style={{ height: 42, alignItems: 'center', gap: 9, paddingLeft: 13, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: BORDER }}>
          <Icon name="Settings" size={15} color="#31d6e7" />
          <Text fontSize={13} color={TEXT} style={{ fontWeight: 800 }}>Preferences</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={onClose} tooltip="Close Preferences" style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="X" size={14} color={DIM} />
          </Pressable>
        </Row>
        <Box style={{ flexGrow: 1, minHeight: 0, padding: 12 }}>
          <PreferencesPane store={editorSettings} />
        </Box>
      </Box>
    </Box>
  );
}
