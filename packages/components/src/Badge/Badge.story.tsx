import React from 'react';
import { Box, Text, Badge } from '@ilovereact/core';

export function BadgeStory() {
  return (
    <Box style={{ gap: 16, padding: 16 }}>
      {/* All variants */}
      <Box style={{ gap: 4 }}>
        <Text style={{ color: '#94a3b8', fontSize: 11 }}>Variants</Text>
        <Box style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Badge label="Default" variant="default" />
          <Badge label="Success" variant="success" />
          <Badge label="Warning" variant="warning" />
          <Badge label="Error" variant="error" />
          <Badge label="Info" variant="info" />
        </Box>
      </Box>

      {/* Usage in context */}
      <Box style={{ gap: 4 }}>
        <Text style={{ color: '#94a3b8', fontSize: 11 }}>In context</Text>
        <Box style={{
          backgroundColor: '#1e293b',
          borderRadius: 6,
          padding: 12,
          gap: 8,
        }}>
          <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: '#f1f5f9', fontSize: 13 }}>Build #142</Text>
            <Badge label="PASSED" variant="success" />
          </Box>
          <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: '#f1f5f9', fontSize: 13 }}>Build #141</Text>
            <Badge label="FAILED" variant="error" />
          </Box>
          <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: '#f1f5f9', fontSize: 13 }}>Build #140</Text>
            <Badge label="RUNNING" variant="warning" />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
