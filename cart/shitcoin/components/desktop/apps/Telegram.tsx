// Telegram — channel list on the left, message stream on the right.
// SHAPE PASS stub: reads useTGChannels() + renders the list. Message
// stream + send/post wires in once channel content generators land.

import { useState } from 'react';
import { Box, Text } from '@reactjit/runtime/primitives';
import { useTGChannels } from '../../../sim';
import { Page } from '../../primitives/Page';
import { List, ListSlots } from '../../primitives/List';

export function Telegram() {
  const channels = useTGChannels();
  const [active, setActive] = useState<number | undefined>(undefined);
  const activeChannel = channels.find((c) => c.id === active);
  return (
    <Page heroTitle="Telegram" heroSubtitle="Channels + DMs">
      <Box style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <Box style={{ flexDirection: 'column', minWidth: 280, maxWidth: 320, gap: 4 }}>
          <List
            items={channels.map((c) => ({ ...c, key: c.id }))}
            selectedKey={active}
            onSelect={(c) => setActive(c.id)}
            renderRow={(c) => (
              <>
                <Box style={{ flexDirection: 'column', flexGrow: 1, gap: 2 }}>
                  <ListSlots.Label>{c.handle}</ListSlots.Label>
                  <ListSlots.SubLabel>
                    {c.title} · {c.memberCount.toLocaleString()} members
                  </ListSlots.SubLabel>
                </Box>
                <ListSlots.Trailing>
                  {c.kind === 'pump_group' ? '🚀' : c.kind === 'private' ? '🔒' : c.kind === 'otc' ? '💼' : ''}
                </ListSlots.Trailing>
              </>
            )}
          />
        </Box>
        <Box style={{ flexDirection: 'column', flexGrow: 1, gap: 6, padding: 12, borderRadius: 8, backgroundColor: 'theme:surface' as any, minHeight: 320 }}>
          {activeChannel ? (
            <>
              <Text style={{ fontSize: 'theme:fontLg' as any, color: 'theme:text' as any, fontWeight: 'bold' }}>
                {activeChannel.title}
              </Text>
              <Text style={{ fontSize: 11, color: 'theme:textDim' as any }}>
                Signal quality {(activeChannel.signalQuality * 100).toFixed(0)}% · admin #{activeChannel.adminWalletId}
              </Text>
              <Text style={{ fontSize: 12, color: 'theme:textSecondary' as any, marginTop: 12 }}>
                No messages yet — channel generators wire in next pass.
              </Text>
            </>
          ) : (
            <Text style={{ fontSize: 12, color: 'theme:textDim' as any }}>Pick a channel.</Text>
          )}
        </Box>
      </Box>
    </Page>
  );
}
