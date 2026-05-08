import { Box, Pressable, Row, ScrollView, Text } from '@reactjit/runtime/primitives';
import { COLORS } from '../constants';
import { BrowserTab } from '../types';
import { subtitleFromAddress } from '../utils';
import ShellButton from './ShellButton';

export default function TabStrip({
  tabs,
  activeTabId,
  compact,
  onSelect,
  onClose,
  onAdd,
}: {
  tabs: BrowserTab[];
  activeTabId: string;
  compact: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onAdd: () => void;
}) {
  const railWidth = compact ? 184 : 220;
  const titleSize = compact ? 10 : 11;
  const subtitleSize = compact ? 8 : 9;

  return (
    <Box
      style={{
        width: railWidth,
        height: '100%',
        backgroundColor: COLORS.rail,
        borderRightWidth: 1,
        borderColor: COLORS.border,
        padding: 12,
        gap: 10,
      }}
    >
      <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Box style={{ gap: 2 }}>
          <Text style={{ color: COLORS.textFaint, fontSize: 10, fontWeight: 'bold' }}>TABS</Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>{`${tabs.length} open`}</Text>
        </Box>
        <ShellButton label="+" onPress={onAdd} tone="accent" minWidth={30} height={30} fontSize={14} paddingX={0} />
      </Row>

      <ScrollView style={{ flexGrow: 1 }}>
        <Box style={{ gap: 8 }}>
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <Row
                key={tab.id}
                style={{
                  backgroundColor: active ? COLORS.railActive : COLORS.chromeInset,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: active ? COLORS.borderStrong : COLORS.border,
                  paddingLeft: 6,
                  paddingRight: 6,
                  paddingTop: compact ? 4 : 6,
                  paddingBottom: compact ? 4 : 6,
                  alignItems: 'stretch',
                  gap: 4,
                }}
              >
                <Box
                  style={{
                    width: 3,
                    borderRadius: 999,
                    backgroundColor: active ? COLORS.accent : 'transparent',
                    marginTop: 4,
                    marginBottom: 4,
                  }}
                />

                <Pressable
                  onPress={() => onSelect(tab.id)}
                  style={{
                    flexGrow: 1,
                    flexBasis: 0,
                    paddingLeft: 8,
                    paddingRight: 6,
                    justifyContent: 'center',
                  }}
                >
                  <Box style={{ gap: 2 }}>
                    <Text
                      style={{
                        color: active ? COLORS.text : COLORS.textMuted,
                        fontSize: titleSize,
                        fontWeight: 'bold',
                      }}
                    >
                      {tab.title}
                    </Text>
                    <Text
                      style={{
                        color: COLORS.textFaint,
                        fontSize: subtitleSize,
                      }}
                    >
                      {subtitleFromAddress(tab.address)}
                    </Text>
                  </Box>
                </Pressable>

                <Pressable
                  onPress={() => onClose(tab.id)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 9,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: active ? COLORS.chrome : COLORS.rail,
                    marginTop: 4,
                  }}
                >
                  <Text style={{ color: COLORS.textFaint, fontSize: 11, fontWeight: 'bold' }}>x</Text>
                </Pressable>
              </Row>
            );
          })}
        </Box>
      </ScrollView>
    </Box>
  );
}
