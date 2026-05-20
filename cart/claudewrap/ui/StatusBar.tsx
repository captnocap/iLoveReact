import * as React from 'react';
import { Box, Row, Text } from '../../../runtime/primitives';
import { palette } from './palette';
import type { TabId } from '../types';

export function StatusBar({ tab }: { tab: TabId }) {
  return (
    <Row style={{
      height: 1,
      backgroundColor: palette.bar,
      paddingLeft: 1,
      paddingRight: 1,
    }}>
      <Text style={{ color: palette.dim }}>tab: </Text>
      <Text style={{ color: palette.accent }}>{tab}</Text>
      <Box style={{ flexGrow: 1 }} />
      <Text style={{ color: palette.dim }}>
        Ctrl+] unfocus terminal · 5 settings · q quit
      </Text>
    </Row>
  );
}
