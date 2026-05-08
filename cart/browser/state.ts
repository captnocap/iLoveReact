import { useEffect, useRef, useState } from 'react';
import { browserPage, localstore } from '@reactjit/runtime/hooks';
import { extractDocumentStyleRefs, interpretPageResponse } from './content';
import {
  BLANK_URL,
  DEFAULT_BOOKMARKS,
  DEFAULT_SETTINGS,
  HOME_LINKS,
  HOME_URL,
  STORAGE_KEYS,
} from './constants';
import {
  BookmarkEntry,
  BrowserSession,
  BrowserSettings,
  BrowserTab,
} from './types';
import {
  applyNavigation,
  bookmarkMatches,
  buildSuggestions,
  canBookmarkAddress,
  createTab,
  failLoadedTab,
  formatLoadedAt,
  makeId,
  normalizeAddress,
  startTabLoad,
  stepHistory,
  subtitleFromAddress,
  updateLoadedTab,
} from './utils';

function readSettings(): BrowserSettings {
  return localstore.getJson<BrowserSettings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
}

function readBookmarks(): BookmarkEntry[] {
  return localstore.getJson<BookmarkEntry[]>(STORAGE_KEYS.bookmarks, DEFAULT_BOOKMARKS);
}

function normalizeSavedTab(raw: any): BrowserTab {
  const fallback = createTab(HOME_URL);
  if (!raw || typeof raw !== 'object') return fallback;
  const history = Array.isArray(raw.history) && raw.history.length > 0
    ? raw.history.map((item: any) => normalizeAddress(String(item)))
    : [normalizeAddress(String(raw.address || HOME_URL))];
  const historyIndex = Math.max(0, Math.min(history.length - 1, Number(raw.historyIndex || history.length - 1)));
  const address = history[historyIndex];
  const tab = createTab(address, typeof raw.id === 'string' ? raw.id : undefined);
  return {
    ...tab,
    history,
    historyIndex,
    isLoading: false,
    loadVersion: typeof raw.loadVersion === 'number' ? raw.loadVersion : 0,
    lastLoadedAt: typeof raw.lastLoadedAt === 'number' ? raw.lastLoadedAt : Date.now(),
    finalAddress: null,
    statusCode: null,
    contentType: null,
    documentKind: null,
    pageSource: '',
    pageStyles: '',
    pageText: '',
    pageError: null,
    wasTruncated: false,
  };
}

function makeStartupSession(settings: BrowserSettings): BrowserSession {
  const startupAddress = settings.startupMode === 'blank' ? BLANK_URL : HOME_URL;
  const firstTab = createTab(startupAddress);
  return {
    tabs: [firstTab],
    activeTabId: firstTab.id,
  };
}

function readSession(settings: BrowserSettings): BrowserSession {
  const saved = localstore.getJson<BrowserSession | null>(STORAGE_KEYS.session, null);
  if (settings.startupMode !== 'restore' || !saved || !Array.isArray(saved.tabs) || saved.tabs.length === 0) {
    return makeStartupSession(settings);
  }

  const tabs = saved.tabs.map(normalizeSavedTab);
  const active = tabs.find((tab) => tab.id === saved.activeTabId) || tabs[0];
  return {
    tabs,
    activeTabId: active.id,
  };
}

function sessionSnapshot(tabs: BrowserTab[], activeTabId: string): BrowserSession {
  return {
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      address: tab.address,
      kind: tab.kind,
      history: tab.history,
      historyIndex: tab.historyIndex,
      isLoading: false,
      lastLoadedAt: tab.lastLoadedAt,
      loadVersion: tab.loadVersion,
      finalAddress: null,
      statusCode: null,
      contentType: null,
      documentKind: null,
      pageSource: '',
      pageStyles: '',
      pageText: '',
      pageError: null,
      wasTruncated: false,
    })),
    activeTabId,
  };
}

export function useBrowserShellState() {
  const [boot] = useState(() => {
    const settings = readSettings();
    return {
      settings,
      bookmarks: readBookmarks(),
      session: readSession(settings),
    };
  });

  const [settings, setSettings] = useState<BrowserSettings>(boot.settings);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>(boot.bookmarks);
  const [tabs, setTabs] = useState<BrowserTab[]>(boot.session.tabs);
  const [activeTabId, setActiveTabId] = useState<string>(boot.session.activeTabId);
  const [addressDraft, setAddressDraft] = useState<string>(() => {
    const active = boot.session.tabs.find((tab) => tab.id === boot.session.activeTabId) || boot.session.tabs[0];
    return active?.address || HOME_URL;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addressFocused, setAddressFocused] = useState(false);
  const inflightLoads = useRef<Record<string, string>>({});

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0] || null;
  const activeBookmark = activeTab ? bookmarkMatches(bookmarks, activeTab.address) : null;
  const addressSuggestions = buildSuggestions(addressDraft, bookmarks, tabs, HOME_LINKS);
  const recentTabs = tabs
    .slice()
    .sort((a, b) => b.lastLoadedAt - a.lastLoadedAt)
    .slice(0, 5);

  useEffect(() => {
    if (!activeTab) return;
    setAddressDraft(activeTab.address);
  }, [activeTabId, activeTab?.address]);

  useEffect(() => {
    localstore.setJson(STORAGE_KEYS.settings, settings);
  }, [settings]);

  useEffect(() => {
    localstore.setJson(STORAGE_KEYS.bookmarks, bookmarks);
  }, [bookmarks]);

  useEffect(() => {
    localstore.setJson(STORAGE_KEYS.session, sessionSnapshot(tabs, activeTabId));
  }, [tabs, activeTabId]);

  useEffect(() => {
    (globalThis as any)._browserNavigate = (address: string) => {
      const target = normalizeAddress(address);
      if (!activeTab) return;
      setTabs((prev) => prev.map((tab) => (
        tab.id === activeTab.id ? applyNavigation(tab, target) : tab
      )));
      setAddressDraft(target);
    };
    return () => {
      delete (globalThis as any)._browserNavigate;
    };
  }, [activeTab?.id, activeTab?.address]);

  useEffect(() => {
    for (const tab of tabs) {
      if (tab.kind !== 'page' || !tab.isLoading) continue;

      const requestKey = `${tab.loadVersion}:${tab.address}`;
      if (inflightLoads.current[tab.id] === requestKey) continue;
      inflightLoads.current[tab.id] = requestKey;

      browserPage.fetchPageAsync(tab.address)
        .then(async (response) => {
          const document = interpretPageResponse(tab.address, response);
          const finalAddress = normalizeAddress(document.finalAddress || tab.address);
          let styles = document.styles;
          if (document.documentKind === 'html' && document.source) {
            const refs = extractDocumentStyleRefs(document.source, finalAddress);
            styles = refs.inline;
            for (const href of refs.links.slice(0, 3)) {
              try {
                const cssResponse = await browserPage.fetchPageAsync(href);
                if (!cssResponse.error && cssResponse.body) {
                  styles = styles ? `${styles}\n${cssResponse.body}` : cssResponse.body;
                }
              } catch {
                // Ignore stylesheet fetch failures; the document should still render.
              }
            }
          }
          setTabs((prev) => prev.map((current) => {
            if (current.id !== tab.id) return current;
            if (current.loadVersion !== tab.loadVersion) return current;
            return updateLoadedTab(current, {
              address: finalAddress,
              title: document.title,
              statusCode: document.statusCode,
              contentType: document.contentType,
              documentKind: document.documentKind,
              pageSource: document.source,
              pageStyles: styles,
              pageText: document.text,
              pageError: document.error,
              truncated: document.truncated,
            });
          }));
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          setTabs((prev) => prev.map((current) => {
            if (current.id !== tab.id) return current;
            if (current.loadVersion !== tab.loadVersion) return current;
            return failLoadedTab(current, message);
          }));
        })
        .finally(() => {
          if (inflightLoads.current[tab.id] === requestKey) {
            delete inflightLoads.current[tab.id];
          }
        });
    }
  }, [tabs]);

  function openTab(address?: string): void {
    const target = address || (settings.newTabMode === 'blank' ? BLANK_URL : HOME_URL);
    let tab = createTab(target);
    if (tab.kind === 'page') {
      tab = startTabLoad(tab);
    }
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setAddressDraft(tab.address);
  }

  function closeTab(tabId: string): void {
    delete inflightLoads.current[tabId];
    if (tabs.length <= 1) {
      const replacement = createTab(settings.newTabMode === 'blank' ? BLANK_URL : HOME_URL, tabId);
      setTabs([replacement]);
      setActiveTabId(replacement.id);
      return;
    }

    const index = tabs.findIndex((tab) => tab.id === tabId);
    const remaining = tabs.filter((tab) => tab.id !== tabId);
    const fallback = remaining[Math.max(0, Math.min(index, remaining.length - 1))];
    setTabs(remaining);
    if (activeTabId === tabId) {
      setActiveTabId(fallback.id);
    }
  }

  function selectTab(tabId: string): void {
    setActiveTabId(tabId);
    setAddressFocused(false);
  }

  function navigateCurrent(address?: string, replace = false): void {
    if (!activeTab) return;
    const target = normalizeAddress(address || addressDraft);
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeTab.id ? applyNavigation(tab, target, replace) : tab
    )));
    setAddressDraft(target);
    setAddressFocused(false);
  }

  function goBack(): void {
    if (!activeTab || activeTab.historyIndex <= 0) return;
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeTab.id ? stepHistory(tab, -1) : tab
    )));
  }

  function goForward(): void {
    if (!activeTab || activeTab.historyIndex >= activeTab.history.length - 1) return;
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeTab.id ? stepHistory(tab, 1) : tab
    )));
  }

  function goHome(): void {
    navigateCurrent(HOME_URL);
  }

  function reloadActiveTab(): void {
    if (!activeTab) return;
    setTabs((prev) => prev.map((tab) => (
      tab.id === activeTab.id ? startTabLoad(tab) : tab
    )));
  }

  function toggleBookmark(): void {
    if (!activeTab || !canBookmarkAddress(activeTab.address)) return;
    const existing = bookmarkMatches(bookmarks, activeTab.address);
    if (existing) {
      setBookmarks((prev) => prev.filter((bookmark) => bookmark.id !== existing.id));
      return;
    }

    const bookmark: BookmarkEntry = {
      id: makeId('bookmark'),
      title: activeTab.title,
      address: activeTab.address,
      createdAt: Date.now(),
    };
    setBookmarks((prev) => [bookmark, ...prev]);
  }

  function openBookmark(address: string): void {
    navigateCurrent(address);
  }

  function removeBookmark(bookmarkId: string): void {
    setBookmarks((prev) => prev.filter((bookmark) => bookmark.id !== bookmarkId));
  }

  function updateSettings(patch: Partial<BrowserSettings>): void {
    setSettings((prev) => ({ ...prev, ...patch }));
  }

  function focusAddress(): void {
    setAddressFocused(true);
  }

  function blurAddress(): void {
    setTimeout(() => setAddressFocused(false), 120);
  }

  function selectSuggestion(address: string): void {
    setAddressDraft(address);
    navigateCurrent(address);
  }

  return {
    settings,
    settingsOpen,
    setSettingsOpen,
    tabs,
    activeTab,
    activeTabId,
    recentTabs,
    bookmarks,
    addressDraft,
    setAddressDraft,
    addressFocused,
    addressSuggestions,
    activeBookmark,
    canGoBack: !!activeTab && activeTab.historyIndex > 0,
    canGoForward: !!activeTab && activeTab.historyIndex < activeTab.history.length - 1,
    canBookmark: !!activeTab && canBookmarkAddress(activeTab.address),
    activeHost: activeTab ? subtitleFromAddress(activeTab.address) : 'home',
    activeLoadedLabel: activeTab ? formatLoadedAt(activeTab.lastLoadedAt) : 'just now',
    openTab,
    closeTab,
    selectTab,
    navigateCurrent,
    goBack,
    goForward,
    goHome,
    reloadActiveTab,
    toggleBookmark,
    openBookmark,
    removeBookmark,
    updateSettings,
    focusAddress,
    blurAddress,
    selectSuggestion,
  };
}
