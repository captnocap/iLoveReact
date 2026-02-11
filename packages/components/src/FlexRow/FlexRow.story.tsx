import React from 'react';
import { Box, Text, FlexRow } from '@ilovereact/core';

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <Box style={{
      width: 50, height: 50,
      backgroundColor: color,
      borderRadius: 4,
      justifyContent: 'center',
      alignItems: 'center',
    }}>
      <Text style={{ color: '#fff', fontSize: 10 }}>{label}</Text>
    </Box>
  );
}

export function FlexRowStory() {
  return (
    <Box style={{ gap: 16, padding: 16 }}>
      <Box style={{ backgroundColor: '#1e293b', padding: 8, borderRadius: 4, gap: 4 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>justify: start (default)</Text>
        <FlexRow gap={6}>
          <Chip label="A" color="#ef4444" />
          <Chip label="B" color="#f97316" />
          <Chip label="C" color="#eab308" />
        </FlexRow>
      </Box>

      <Box style={{ backgroundColor: '#1e293b', padding: 8, borderRadius: 4, gap: 4 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>justify: center</Text>
        <FlexRow gap={6} justify="center">
          <Chip label="A" color="#22c55e" />
          <Chip label="B" color="#14b8a6" />
          <Chip label="C" color="#06b6d4" />
        </FlexRow>
      </Box>

      <Box style={{ backgroundColor: '#1e293b', padding: 8, borderRadius: 4, gap: 4 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>justify: space-between</Text>
        <FlexRow justify="space-between">
          <Chip label="A" color="#ec4899" />
          <Chip label="B" color="#f43f5e" />
          <Chip label="C" color="#e11d48" />
        </FlexRow>
      </Box>

      <Box style={{ backgroundColor: '#1e293b', padding: 8, borderRadius: 4, gap: 4 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>align: center</Text>
        <FlexRow gap={6} align="center">
          <Chip label="S" color="#3b82f6" />
          <Box style={{
            width: 50, height: 80,
            backgroundColor: '#6366f1',
            borderRadius: 4,
            justifyContent: 'center',
            alignItems: 'center',
          }}>
            <Text style={{ color: '#fff', fontSize: 10 }}>Tall</Text>
          </Box>
          <Chip label="S" color="#8b5cf6" />
        </FlexRow>
      </Box>
    </Box>
  );
}
