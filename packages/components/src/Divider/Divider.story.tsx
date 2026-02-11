import React from 'react';
import { Box, Text, Divider } from '@ilovereact/core';

export function DividerStory() {
  return (
    <Box style={{ gap: 16, padding: 16 }}>
      {/* Horizontal dividers */}
      <Box style={{ gap: 4 }}>
        <Text style={{ color: '#94a3b8', fontSize: 11 }}>Horizontal (default)</Text>
        <Box style={{ backgroundColor: '#1e293b', borderRadius: 6, padding: 12, gap: 8 }}>
          <Text style={{ color: '#cbd5e1', fontSize: 13 }}>Section A</Text>
          <Divider />
          <Text style={{ color: '#cbd5e1', fontSize: 13 }}>Section B</Text>
          <Divider color="#475569" thickness={2} />
          <Text style={{ color: '#cbd5e1', fontSize: 13 }}>Section C</Text>
        </Box>
      </Box>

      {/* Vertical dividers */}
      <Box style={{ gap: 4 }}>
        <Text style={{ color: '#94a3b8', fontSize: 11 }}>Vertical</Text>
        <Box style={{
          backgroundColor: '#1e293b',
          borderRadius: 6,
          padding: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          height: 40,
        }}>
          <Text style={{ color: '#cbd5e1', fontSize: 13 }}>Left</Text>
          <Divider direction="vertical" />
          <Text style={{ color: '#cbd5e1', fontSize: 13 }}>Center</Text>
          <Divider direction="vertical" color="#3b82f6" thickness={2} />
          <Text style={{ color: '#cbd5e1', fontSize: 13 }}>Right</Text>
        </Box>
      </Box>
    </Box>
  );
}
