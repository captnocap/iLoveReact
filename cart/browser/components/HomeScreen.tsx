import { Box, Pressable, Row, ScrollView, Text } from '@reactjit/runtime/primitives';
import { COLORS, HOME_LINKS } from '../constants';
import { BookmarkEntry, BrowserTab } from '../types';
import { subtitleFromAddress } from '../utils';
import ShellButton from './ShellButton';

function SurfaceCard({
  title,
  subtitle,
  accent,
  onPress,
}: {
  title: string;
  subtitle: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexGrow: 1,
        flexBasis: 0,
        minHeight: 118,
        borderRadius: 20,
        padding: 16,
        gap: 8,
        backgroundColor: accent,
        borderWidth: 1,
        borderColor: '#d4c7ae',
      }}
    >
      <Text style={{ color: COLORS.viewportInk, fontSize: 13, fontWeight: 'bold' }}>{title}</Text>
      <Text style={{ color: COLORS.viewportMuted, fontSize: 11 }}>{subtitle}</Text>
    </Pressable>
  );
}

function SmallLink({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: 16,
        padding: 12,
        backgroundColor: COLORS.viewportPanel,
        borderWidth: 1,
        borderColor: '#d9cfbc',
        gap: 4,
      }}
    >
      <Text style={{ color: COLORS.viewportInk, fontSize: 11, fontWeight: 'bold' }}>{title}</Text>
      <Text style={{ color: COLORS.viewportMuted, fontSize: 10 }}>{subtitle}</Text>
    </Pressable>
  );
}

export default function HomeScreen({
  bookmarks,
  recentTabs,
  onOpenAddress,
  onOpenSettings,
  onOpenNewTab,
}: {
  bookmarks: BookmarkEntry[];
  recentTabs: BrowserTab[];
  onOpenAddress: (address: string) => void;
  onOpenSettings: () => void;
  onOpenNewTab: () => void;
}) {
  return (
    <ScrollView
      style={{
        flexGrow: 1,
        backgroundColor: COLORS.viewport,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: '#d6ccb9',
        padding: 18,
        gap: 18,
      }}
    >
      <Box
        style={{
          backgroundColor: COLORS.homeHero,
          borderRadius: 22,
          padding: 22,
          gap: 12,
          borderWidth: 1,
          borderColor: '#d3c6ab',
        }}
      >
        <Text style={{ color: COLORS.viewportInk, fontSize: 24, fontWeight: 'bold' }}>
          Browser Shell
        </Text>
        <Text style={{ color: COLORS.viewportMuted, fontSize: 12 }}>
          Chrome, tabs, bookmarks, address flow, and a dedicated application viewport are now separated from page rendering. The next pass can drop a real document renderer into this surface without rewriting the shell.
        </Text>
        <Row style={{ gap: 10, flexWrap: 'wrap' }}>
          <ShellButton label="+ Open Tab" onPress={onOpenNewTab} tone="accent" />
          <ShellButton label="Settings Panel" onPress={onOpenSettings} />
        </Row>
      </Box>

      <Box style={{ gap: 10 }}>
        <Text style={{ color: COLORS.viewportInk, fontSize: 12, fontWeight: 'bold' }}>Jump Back In</Text>
        <Row style={{ gap: 12 }}>
          {HOME_LINKS.map((link) => (
            <SurfaceCard
              key={link.id}
              title={link.title}
              subtitle={link.subtitle}
              accent={link.accent}
              onPress={() => onOpenAddress(link.address)}
            />
          ))}
        </Row>
      </Box>

      <Row style={{ gap: 16, alignItems: 'stretch' }}>
        <Box style={{ flexGrow: 1, flexBasis: 0, gap: 10 }}>
          <Text style={{ color: COLORS.viewportInk, fontSize: 12, fontWeight: 'bold' }}>Saved Sites</Text>
          <Box style={{ gap: 8 }}>
            {bookmarks.slice(0, 6).map((bookmark) => (
              <SmallLink
                key={bookmark.id}
                title={bookmark.title}
                subtitle={bookmark.address}
                onPress={() => onOpenAddress(bookmark.address)}
              />
            ))}
            {bookmarks.length === 0 && (
              <Box
                style={{
                  borderRadius: 16,
                  padding: 14,
                  borderWidth: 1,
                  borderColor: '#d9cfbc',
                  backgroundColor: COLORS.viewportPanel,
                }}
              >
                <Text style={{ color: COLORS.viewportMuted, fontSize: 10 }}>
                  Use the Save button in the toolbar to pin a page here.
                </Text>
              </Box>
            )}
          </Box>
        </Box>

        <Box style={{ flexGrow: 1, flexBasis: 0, gap: 10 }}>
          <Text style={{ color: COLORS.viewportInk, fontSize: 12, fontWeight: 'bold' }}>Recent Tabs</Text>
          <Box style={{ gap: 8 }}>
            {recentTabs.map((tab) => (
              <SmallLink
                key={tab.id}
                title={tab.title}
                subtitle={subtitleFromAddress(tab.address)}
                onPress={() => onOpenAddress(tab.address)}
              />
            ))}
          </Box>
        </Box>
      </Row>
    </ScrollView>
  );
}
