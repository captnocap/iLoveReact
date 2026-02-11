import React from 'react';
import { Box, Text, Spacer } from '@ilovereact/core';

export function SpacerStory() {
  return (
    <Box style={{ gap: 16, padding: 16 }}>
      <Box style={{ backgroundColor: '#1e293b', padding: 8, borderRadius: 4, gap: 4 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>Fixed spacer (size=20)</Text>
        <Box style={{ backgroundColor: '#0f172a', padding: 8, borderRadius: 4 }}>
          <Text style={{ color: '#cbd5e1', fontSize: 12 }}>Above</Text>
          <Spacer size={20} />
          <Text style={{ color: '#cbd5e1', fontSize: 12 }}>Below (20px gap)</Text>
        </Box>
      </Box>

      <Box style={{ backgroundColor: '#1e293b', padding: 8, borderRadius: 4, gap: 4 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>Flexible spacer (pushes apart)</Text>
        <Box style={{
          flexDirection: 'row',
          backgroundColor: '#0f172a',
          padding: 8,
          borderRadius: 4,
          height: 40,
          alignItems: 'center',
        }}>
          <Text style={{ color: '#cbd5e1', fontSize: 12 }}>Left</Text>
          <Spacer />
          <Text style={{ color: '#cbd5e1', fontSize: 12 }}>Right</Text>
        </Box>
      </Box>
    </Box>
  );
}
