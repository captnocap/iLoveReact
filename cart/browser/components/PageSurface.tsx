import { Box, ScrollView, Text } from '@reactjit/runtime/primitives';
import { COLORS } from '../constants';
import { BrowserTab } from '../types';
import HtmlDocument from './HtmlDocument';

function BlankSurface() {
  return (
    <Box
      style={{
        minHeight: 460,
        backgroundColor: '#fffdf7',
        padding: 32,
        gap: 12,
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: COLORS.viewportInk, fontSize: 18, fontWeight: 'bold' }}>
        Blank Tab
      </Text>
      <Text style={{ color: COLORS.viewportMuted, fontSize: 12 }}>
        This surface is ready for a new address. Type a URL or a search into the address bar above.
      </Text>
    </Box>
  );
}

export default function PageSurface({
  tab,
  onOpenAddress,
}: {
  tab: BrowserTab;
  onOpenAddress: (address: string) => void;
}) {
  const displayAddress = tab.finalAddress || tab.address;
  const content = tab.pageText || (tab.isLoading ? 'Loading page content…' : 'No page content returned.');
  const shouldRenderHtml = !tab.pageError && tab.documentKind === 'html' && !!tab.pageSource;

  return (
    <ScrollView
      style={{
        flexGrow: 1,
        height: '100%',
        backgroundColor: '#fffdf7',
        paddingLeft: 24,
        paddingRight: 24,
        paddingTop: 22,
        paddingBottom: 32,
      }}
    >
      {tab.kind === 'blank' ? (
        <BlankSurface />
      ) : tab.pageError ? (
        <Box
          style={{
            minHeight: 460,
            paddingTop: 8,
            gap: 14,
          }}
        >
          <Text style={{ color: COLORS.danger, fontSize: 22, fontWeight: 'bold' }}>
            {tab.title}
          </Text>
          <Text style={{ color: COLORS.viewportMuted, fontSize: 12 }}>
            {displayAddress}
          </Text>
          <Text style={{ color: COLORS.danger, fontSize: 13, lineHeight: 20 }}>
            {content}
          </Text>
        </Box>
      ) : tab.isLoading && !tab.pageSource ? (
        <Box
          style={{
            minHeight: 460,
            justifyContent: 'center',
            gap: 12,
          }}
        >
          <Text style={{ color: COLORS.viewportInk, fontSize: 24, fontWeight: 'bold' }}>
            Loading…
          </Text>
          <Text style={{ color: COLORS.viewportMuted, fontSize: 12 }}>
            {displayAddress}
          </Text>
        </Box>
      ) : (
        <Box
          style={{
            minHeight: 460,
            backgroundColor: '#fffdf7',
            paddingTop: 6,
            gap: 12,
          }}
        >
          {tab.wasTruncated && (
            <Text style={{ color: COLORS.accentWarm, fontSize: 11 }}>
              Response truncated to keep the shell responsive.
            </Text>
          )}
          {shouldRenderHtml ? (
            <HtmlDocument
              html={tab.pageSource}
              cssText={tab.pageStyles}
              baseAddress={displayAddress}
              onOpenAddress={onOpenAddress}
            />
          ) : (
            <Text
              style={{
                color: COLORS.viewportInk,
                fontSize: 12,
                lineHeight: 18,
              }}
            >
              {content}
            </Text>
          )}
        </Box>
      )}
    </ScrollView>
  );
}
