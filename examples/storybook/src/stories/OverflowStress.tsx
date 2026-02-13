import React from 'react';
import { Box, Text, ScrollView } from '@ilovereact/core';

const colors = {
  bg: [0.08, 0.08, 0.11, 1] as const,
  panel: [0.12, 0.12, 0.16, 1] as const,
  card: [0.16, 0.16, 0.21, 1] as const,
  cardAlt: [0.14, 0.14, 0.19, 1] as const,
  accent: [0.35, 0.55, 0.95, 1] as const,
  green: [0.2, 0.75, 0.4, 1] as const,
  orange: [0.95, 0.65, 0.15, 1] as const,
  red: [0.9, 0.3, 0.3, 1] as const,
  purple: [0.6, 0.4, 0.9, 1] as const,
  text: [0.88, 0.88, 0.92, 1] as const,
  dim: [0.5, 0.5, 0.58, 1] as const,
  border: [0.22, 0.22, 0.28, 1] as const,
};

// Generate a bunch of items
function makeItems(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);
}

// A simple card with padding and nested text
function MiniCard({ title, subtitle, color }: { title: string; subtitle: string; color: readonly [number, number, number, number] }) {
  return (
    <Box style={{ backgroundColor: colors.card, borderRadius: 6, padding: 10, marginBottom: 6 }}>
      <Box style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Box style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
        <Text style={{ fontSize: 13, color: colors.text, fontWeight: 'bold' }}>{title}</Text>
      </Box>
      <Text style={{ fontSize: 11, color: colors.dim, marginTop: 4 }}>{subtitle}</Text>
    </Box>
  );
}

// Tall list that overflows its scroll container
function TallList({ items, color }: { items: string[]; color: readonly [number, number, number, number] }) {
  return (
    <>
      {items.map((item, i) => (
        <Box key={i} style={{
          backgroundColor: i % 2 === 0 ? colors.card : colors.cardAlt,
          paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6,
          borderRadius: 4, marginBottom: 2,
        }}>
          <Box style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
            <Text style={{ fontSize: 12, color: colors.text }}>{item}</Text>
          </Box>
        </Box>
      ))}
    </>
  );
}

export function OverflowStressStory() {
  const navItems = makeItems('Nav Link', 40);
  const logEntries = makeItems('Log entry', 60);
  const notifications = makeItems('Notification', 30);
  const fileList = makeItems('document_', 50).map((f, i) => `${f}.${['tsx', 'lua', 'json', 'md', 'ts'][i % 5]}`);
  const chatMessages = makeItems('User message', 45);
  const tags = makeItems('Tag #', 80);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: colors.bg, flexDirection: 'row' }}>

      {/* Left sidebar — scroll container with nav items */}
      <Box style={{ width: 160, height: '100%', backgroundColor: colors.panel, borderRightWidth: 1, borderRightColor: colors.border }}>
        <Box style={{ padding: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 13, color: colors.accent, fontWeight: 'bold' }}>Navigation</Text>
          <Text style={{ fontSize: 10, color: colors.dim }}>{`${navItems.length} items`}</Text>
        </Box>
        <ScrollView style={{ flexGrow: 1 }}>
          <Box style={{ padding: 4 }}>
            <TallList items={navItems} color={colors.accent} />
          </Box>
        </ScrollView>
      </Box>

      {/* Center content — three vertical scroll panels */}
      <Box style={{ flexGrow: 1, height: '100%', padding: 8, gap: 8 }}>

        {/* Top row: two scroll panels side by side */}
        <Box style={{ flexDirection: 'row', gap: 8, flexGrow: 1 }}>

          {/* Log panel */}
          <Box style={{ flexGrow: 1, backgroundColor: colors.panel, borderRadius: 8, overflow: 'hidden' }}>
            <Box style={{ padding: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 13, color: colors.green, fontWeight: 'bold' }}>System Logs</Text>
              <Text style={{ fontSize: 10, color: colors.dim }}>{`${logEntries.length} entries — scroll me`}</Text>
            </Box>
            <ScrollView style={{ flexGrow: 1 }}>
              <Box style={{ padding: 6 }}>
                {logEntries.map((entry, i) => (
                  <Box key={i} style={{
                    paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
                    marginBottom: 1,
                    backgroundColor: i % 2 === 0 ? colors.card : colors.cardAlt,
                    borderRadius: 3,
                  }}>
                    <Box style={{ flexDirection: 'row', gap: 6 }}>
                      <Text style={{ fontSize: 10, color: colors.dim }}>{`${String(i).padStart(3, '0')}`}</Text>
                      <Text style={{ fontSize: 11, color: i % 7 === 0 ? colors.orange : colors.text }}>{entry}</Text>
                    </Box>
                  </Box>
                ))}
              </Box>
            </ScrollView>
          </Box>

          {/* Chat panel */}
          <Box style={{ flexGrow: 1, backgroundColor: colors.panel, borderRadius: 8, overflow: 'hidden' }}>
            <Box style={{ padding: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 13, color: colors.purple, fontWeight: 'bold' }}>Chat</Text>
              <Text style={{ fontSize: 10, color: colors.dim }}>{`${chatMessages.length} messages`}</Text>
            </Box>
            <ScrollView style={{ flexGrow: 1 }}>
              <Box style={{ padding: 6 }}>
                {chatMessages.map((msg, i) => (
                  <MiniCard
                    key={i}
                    title={`User ${(i % 5) + 1}`}
                    subtitle={msg}
                    color={[colors.accent, colors.green, colors.orange, colors.purple, colors.red][i % 5]}
                  />
                ))}
              </Box>
            </ScrollView>
          </Box>
        </Box>

        {/* Bottom row: two more scroll panels */}
        <Box style={{ flexDirection: 'row', gap: 8, flexGrow: 1 }}>

          {/* File browser */}
          <Box style={{ flexGrow: 1, backgroundColor: colors.panel, borderRadius: 8, overflow: 'hidden' }}>
            <Box style={{ padding: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 13, color: colors.orange, fontWeight: 'bold' }}>Files</Text>
              <Text style={{ fontSize: 10, color: colors.dim }}>{`${fileList.length} files`}</Text>
            </Box>
            <ScrollView style={{ flexGrow: 1 }}>
              <Box style={{ padding: 6 }}>
                <TallList items={fileList} color={colors.orange} />
              </Box>
            </ScrollView>
          </Box>

          {/* Notifications */}
          <Box style={{ flexGrow: 1, backgroundColor: colors.panel, borderRadius: 8, overflow: 'hidden' }}>
            <Box style={{ padding: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 13, color: colors.red, fontWeight: 'bold' }}>Notifications</Text>
              <Text style={{ fontSize: 10, color: colors.dim }}>{`${notifications.length} alerts`}</Text>
            </Box>
            <ScrollView style={{ flexGrow: 1 }}>
              <Box style={{ padding: 6 }}>
                {notifications.map((n, i) => (
                  <MiniCard
                    key={i}
                    title={n}
                    subtitle={`Priority: ${['Low', 'Medium', 'High', 'Critical'][i % 4]} — ${new Date(2026, 1, 13, i % 24, (i * 7) % 60).toLocaleTimeString()}`}
                    color={[colors.dim, colors.orange, colors.red, colors.red][i % 4]}
                  />
                ))}
              </Box>
            </ScrollView>
          </Box>
        </Box>

        {/* Bottom tag bar — horizontal scroll */}
        <Box style={{ backgroundColor: colors.panel, borderRadius: 8, overflow: 'hidden', height: 50 }}>
          <Box style={{ padding: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 10, color: colors.dim }}>{`Tags (${tags.length}) — this row should overflow horizontally if it could`}</Text>
          </Box>
          <ScrollView style={{ flexGrow: 1 }} horizontal>
            <Box style={{ flexDirection: 'row', gap: 4, padding: 4 }}>
              {tags.map((tag, i) => (
                <Box key={i} style={{
                  backgroundColor: [colors.accent, colors.green, colors.orange, colors.purple, colors.red][i % 5],
                  borderRadius: 10,
                  paddingLeft: 8, paddingRight: 8, paddingTop: 2, paddingBottom: 2,
                }}>
                  <Text style={{ fontSize: 10, color: [1, 1, 1, 1] }}>{tag}</Text>
                </Box>
              ))}
            </Box>
          </ScrollView>
        </Box>
      </Box>

      {/* Right sidebar — another scroll container */}
      <Box style={{ width: 150, height: '100%', backgroundColor: colors.panel, borderLeftWidth: 1, borderLeftColor: colors.border }}>
        <Box style={{ padding: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Text style={{ fontSize: 13, color: colors.green, fontWeight: 'bold' }}>Details</Text>
        </Box>
        <ScrollView style={{ flexGrow: 1 }}>
          <Box style={{ padding: 6 }}>
            {Array.from({ length: 25 }, (_, i) => (
              <Box key={i} style={{ marginBottom: 8 }}>
                <Text style={{ fontSize: 11, color: colors.accent, fontWeight: 'bold' }}>{`Section ${i + 1}`}</Text>
                <Text style={{ fontSize: 10, color: colors.dim }}>Lorem ipsum dolor sit amet consectetur adipiscing elit</Text>
                <Box style={{ height: 3, backgroundColor: colors.border, borderRadius: 1, marginTop: 4 }}>
                  <Box style={{ height: 3, width: `${20 + (i * 13) % 80}%`, backgroundColor: colors.green, borderRadius: 1 }} />
                </Box>
              </Box>
            ))}
          </Box>
        </ScrollView>
      </Box>
    </Box>
  );
}
