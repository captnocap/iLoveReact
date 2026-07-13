import { Box, Col, Pressable, Row, Text } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';

const PANEL = '#10151d';
const BORDER = '#283446';
const TEXT = '#dbe5f3';
const DIM = '#8190a3';
const ACCENT = '#31d6e7';

export default function HotUpdateDialog({ onApply, onLater }: { onApply: () => void; onLater: () => void }) {
  return (
    <Box blocksPointerEvents style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 31, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.48)' }}>
      <Col style={{ width: 420, gap: 13, padding: 16, borderWidth: 1, borderColor: BORDER, borderRadius: 10, backgroundColor: PANEL }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Icon name="RefreshCw" size={15} color={ACCENT} />
          <Text fontSize={13} color={TEXT} style={{ fontWeight: 800 }}>Code update ready</Text>
        </Row>
        <Row style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Pressable onPress={onLater} style={{ height: 29, paddingLeft: 12, paddingRight: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER, borderRadius: 5 }}>
            <Text fontSize={11} color={DIM}>Keep working</Text>
          </Pressable>
          <Pressable onPress={onApply} style={{ height: 29, paddingLeft: 12, paddingRight: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 5, backgroundColor: ACCENT }}>
            <Text fontSize={11} color="#081014" style={{ fontWeight: 800 }}>Apply update</Text>
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}
