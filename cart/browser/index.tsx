import { installBrowserShims } from '@reactjit/runtime/hooks';
import { Box, Col, Row } from '@reactjit/runtime/primitives';
import { COLORS } from './constants';
import { useBrowserShellState } from './state';
import BookmarkBar from './components/BookmarkBar';
import BrowserSurface from './components/BrowserSurface';
import SettingsPanel from './components/SettingsPanel';
import TabStrip from './components/TabStrip';
import Toolbar from './components/Toolbar';

installBrowserShims();

export default function BrowserApp() {
  const browser = useBrowserShellState();

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: COLORS.appBg }}>
      <Col style={{ width: '100%', height: '100%' }}>
        <Toolbar
          activeTab={browser.activeTab}
          addressDraft={browser.addressDraft}
          isBookmarked={!!browser.activeBookmark}
          canBookmark={browser.canBookmark}
          settingsOpen={browser.settingsOpen}
          onAddressDraftChange={browser.setAddressDraft}
          onAddressSubmit={() => browser.navigateCurrent()}
          onBack={browser.goBack}
          onForward={browser.goForward}
          onHome={browser.goHome}
          onReload={browser.reloadActiveTab}
          onToggleBookmark={browser.toggleBookmark}
          onToggleSettings={() => browser.setSettingsOpen(!browser.settingsOpen)}
          onAddressFocus={browser.focusAddress}
          onAddressBlur={browser.blurAddress}
          canGoBack={browser.canGoBack}
          canGoForward={browser.canGoForward}
        />

        {browser.activeTab && (
          <BookmarkBar
            bookmarks={browser.bookmarks}
            activeAddress={browser.activeTab.address}
            activeLoading={!!browser.activeTab.isLoading}
            activeHost={browser.activeHost}
            loadedLabel={browser.activeLoadedLabel}
            showBookmarks={browser.settings.showBookmarksBar}
            showStatus={browser.settings.showStatusBar}
            suggestions={browser.addressSuggestions}
            showSuggestions={browser.addressFocused && browser.addressSuggestions.length > 0}
            onOpen={browser.openBookmark}
            onRemove={browser.removeBookmark}
            onSelectSuggestion={browser.selectSuggestion}
          />
        )}

        <Row style={{ flexGrow: 1, backgroundColor: COLORS.appBg }}>
          <TabStrip
            tabs={browser.tabs}
            activeTabId={browser.activeTabId}
            compact={browser.settings.compactTabs}
            onSelect={browser.selectTab}
            onClose={browser.closeTab}
            onAdd={() => browser.openTab()}
          />

          <Box
            style={{
              flexGrow: 1,
              height: '100%',
              padding: browser.activeTab && browser.activeTab.kind !== 'home' ? 0 : 12,
            }}
          >
            <BrowserSurface
              tab={browser.activeTab}
              bookmarks={browser.bookmarks}
              recentTabs={browser.recentTabs}
              onOpenAddress={(address) => browser.navigateCurrent(address)}
              onOpenSettings={() => browser.setSettingsOpen(true)}
              onOpenNewTab={() => browser.openTab()}
            />
          </Box>

          {browser.settingsOpen && (
            <SettingsPanel
              settings={browser.settings}
              tabCount={browser.tabs.length}
              bookmarkCount={browser.bookmarks.length}
              onChange={browser.updateSettings}
              onClose={() => browser.setSettingsOpen(false)}
            />
          )}
        </Row>
      </Col>
    </Box>
  );
}
