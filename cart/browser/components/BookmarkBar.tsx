import { Pressable, Row, Text } from '@reactjit/runtime/primitives';
import { COLORS } from '../constants';
import { BookmarkEntry, BrowserSuggestion } from '../types';

export default function BookmarkBar({
  bookmarks,
  activeAddress,
  activeLoading,
  activeHost,
  loadedLabel,
  showBookmarks,
  showStatus,
  suggestions,
  showSuggestions,
  onOpen,
  onRemove,
  onSelectSuggestion,
}: {
  bookmarks: BookmarkEntry[];
  activeAddress: string;
  activeLoading: boolean;
  activeHost: string;
  loadedLabel: string;
  showBookmarks: boolean;
  showStatus: boolean;
  suggestions: BrowserSuggestion[];
  showSuggestions: boolean;
  onOpen: (address: string) => void;
  onRemove: (bookmarkId: string) => void;
  onSelectSuggestion: (address: string) => void;
}) {
  const showMeta = activeHost && activeHost !== 'Start page' && activeHost !== 'Empty workspace';

  return (
    <Row
      style={{
        width: '100%',
        minWidth: 0,
        backgroundColor: COLORS.chromeAlt,
        borderBottomWidth: 1,
        borderColor: COLORS.border,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 6,
        paddingBottom: 6,
        gap: 8,
        alignItems: 'center',
      }}
    >
      <Row style={{ gap: 8, alignItems: 'center', flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, flexWrap: 'wrap' }}>
        <Text style={{ color: COLORS.textFaint, fontSize: 10, fontWeight: 'bold' }}>
          {showSuggestions ? 'SUGGESTIONS' : 'BOOKMARKS'}
        </Text>

        {showSuggestions && suggestions.map((suggestion) => (
          <Pressable
            key={suggestion.id}
            onPress={() => onSelectSuggestion(suggestion.address)}
            style={{
              borderRadius: 10,
              borderWidth: 1,
              borderColor: COLORS.border,
              backgroundColor: COLORS.chromeRaised,
              paddingLeft: 10,
              paddingRight: 10,
              paddingTop: 6,
              paddingBottom: 6,
            }}
          >
            <Text style={{ color: COLORS.text, fontSize: 10, fontWeight: 'bold' }} numberOfLines={1}>{suggestion.title}</Text>
          </Pressable>
        ))}

        {!showSuggestions && showBookmarks && bookmarks.map((bookmark) => {
          const active = bookmark.address === activeAddress;
          return (
            <Row
              key={bookmark.id}
              style={{
                borderRadius: 10,
                borderWidth: 1,
                borderColor: active ? COLORS.accent : COLORS.border,
                backgroundColor: active ? COLORS.chromeRaised : COLORS.chromeInset,
                alignItems: 'center',
                gap: 4,
                paddingLeft: 4,
                paddingRight: 4,
              }}
            >
              <Pressable
                onPress={() => onOpen(bookmark.address)}
                style={{
                  paddingLeft: 10,
                  paddingRight: 8,
                  paddingTop: 6,
                  paddingBottom: 6,
                }}
              >
                <Text style={{ color: active ? COLORS.text : COLORS.textMuted, fontSize: 10, fontWeight: 'bold' }} numberOfLines={1}>
                  {bookmark.title}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onRemove(bookmark.id)}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 8,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: COLORS.textFaint, fontSize: 10 }}>x</Text>
              </Pressable>
            </Row>
          );
        })}

        {!showSuggestions && showBookmarks && bookmarks.length === 0 && (
          <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>Save a page to pin it here.</Text>
        )}

        {!showSuggestions && !showBookmarks && (
          <Text style={{ color: COLORS.textMuted, fontSize: 10 }}>Bookmarks bar hidden in settings.</Text>
        )}
      </Row>

      {showStatus && (
        <Row style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {showMeta && (
            <Text style={{ color: COLORS.textMuted, fontSize: 10 }} numberOfLines={1}>
              {activeHost}
            </Text>
          )}
          <Text style={{ color: activeLoading ? COLORS.accentWarm : COLORS.textFaint, fontSize: 10 }} numberOfLines={1}>
            {activeLoading ? 'Loading…' : loadedLabel}
          </Text>
        </Row>
      )}
    </Row>
  );
}
