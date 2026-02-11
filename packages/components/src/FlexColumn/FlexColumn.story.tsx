import React from 'react';
import { Box, Text, FlexColumn } from '@ilovereact/core';

function Bar({ label, color, width }: { label: string; color: string; width: number }) {
  return (
    <Box style={{
      width,
      height: 28,
      backgroundColor: color,
      borderRadius: 4,
      justifyContent: 'center',
      paddingLeft: 8,
    }}>
      <Text style={{ color: '#fff', fontSize: 10 }}>{label}</Text>
    </Box>
  );
}

export function FlexColumnStory() {
  return (
    <Box style={{ gap: 16, padding: 16 }}>
      <Box style={{ backgroundColor: '#1e293b', padding: 8, borderRadius: 4, gap: 4 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>gap: 8</Text>
        <FlexColumn gap={8}>
          <Bar label="First" color="#ef4444" width={200} />
          <Bar label="Second" color="#f97316" width={160} />
          <Bar label="Third" color="#eab308" width={120} />
        </FlexColumn>
      </Box>

      <Box style={{ backgroundColor: '#1e293b', padding: 8, borderRadius: 4, gap: 4 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>align: center</Text>
        <FlexColumn gap={6} align="center">
          <Bar label="Wide" color="#22c55e" width={200} />
          <Bar label="Medium" color="#14b8a6" width={140} />
          <Bar label="Narrow" color="#06b6d4" width={80} />
        </FlexColumn>
      </Box>

      <Box style={{ backgroundColor: '#1e293b', padding: 8, borderRadius: 4, gap: 4 }}>
        <Text style={{ color: '#888', fontSize: 10 }}>align: flex-end</Text>
        <FlexColumn gap={6} align="flex-end">
          <Bar label="A" color="#a855f7" width={180} />
          <Bar label="B" color="#d946ef" width={130} />
          <Bar label="C" color="#f0abfc" width={80} />
        </FlexColumn>
      </Box>
    </Box>
  );
}
