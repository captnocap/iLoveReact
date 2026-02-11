import React from 'react';
import { Box, Text, Card, Badge, Divider } from '@ilovereact/core';

export function CardStory() {
  return (
    <Box style={{ gap: 16, padding: 16 }}>
      {/* Basic card */}
      <Card title="Basic Card">
        <Text style={{ color: '#cbd5e1', fontSize: 13 }}>
          A simple card with a title and body content.
        </Text>
      </Card>

      {/* Card with subtitle */}
      <Card title="User Profile" subtitle="Account settings and preferences">
        <Box style={{ gap: 8 }}>
          <Text style={{ color: '#cbd5e1', fontSize: 13 }}>Name: Alex Johnson</Text>
          <Text style={{ color: '#cbd5e1', fontSize: 13 }}>Role: Developer</Text>
        </Box>
      </Card>

      {/* Card without header */}
      <Card>
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Badge label="TIP" variant="info" />
          <Text style={{ color: '#cbd5e1', fontSize: 13 }}>
            Cards work without a title too.
          </Text>
        </Box>
      </Card>

      {/* Card with custom styling */}
      <Card
        title="Status"
        style={{ borderColor: '#166534' }}
        headerStyle={{ backgroundColor: '#14532d' }}
      >
        <Box style={{ gap: 8 }}>
          <Box style={{ flexDirection: 'row', gap: 6 }}>
            <Badge label="ONLINE" variant="success" />
            <Badge label="v2.1.0" variant="default" />
          </Box>
          <Divider />
          <Text style={{ color: '#94a3b8', fontSize: 11 }}>Last updated 2 min ago</Text>
        </Box>
      </Card>
    </Box>
  );
}
