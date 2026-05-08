import { BLANK_URL, HOME_URL, HOME_LINKS, SEARCH_BASE } from './constants';
import {
  BookmarkEntry,
  BrowserDocumentKind,
  BrowserSuggestion,
  BrowserTab,
  BrowserViewKind,
  HomeLink,
} from './types';

export function makeId(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 1679616).toString(36);
  return `${prefix}-${stamp}-${rand}`;
}

export function isHomeAddress(address: string): boolean {
  return address === HOME_URL;
}

export function isBlankAddress(address: string): boolean {
  return address === BLANK_URL;
}

export function canBookmarkAddress(address: string): boolean {
  return !isHomeAddress(address) && !isBlankAddress(address);
}

export function normalizeAddress(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed.toLowerCase() === 'home') return HOME_URL;
  if (trimmed === HOME_URL || trimmed === BLANK_URL) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('about:') || trimmed.startsWith('reactjit://')) return trimmed;
  if (trimmed.includes(' ')) return `${SEARCH_BASE}${encodeURIComponent(trimmed)}`;
  if (trimmed.includes('.')) return `https://${trimmed}`;
  return `${SEARCH_BASE}${encodeURIComponent(trimmed)}`;
}

export function classifyAddress(address: string): BrowserViewKind {
  if (isHomeAddress(address)) return 'home';
  if (isBlankAddress(address)) return 'blank';
  return 'page';
}

export function extractHost(address: string): string {
  if (isHomeAddress(address)) return 'home';
  if (isBlankAddress(address)) return 'blank';
  const schemeMatch = address.match(/^[a-z]+:\/\/([^/?#]+)/i);
  if (schemeMatch && schemeMatch[1]) return schemeMatch[1];
  const plainMatch = address.match(/^([^/?#]+)/);
  return plainMatch?.[1] || address;
}

function decodeSearch(address: string): string {
  const qIdx = address.indexOf('?q=');
  if (qIdx < 0) return '';
  const raw = address.slice(qIdx + 3).split('&')[0];
  try {
    return decodeURIComponent(raw).replace(/\+/g, ' ');
  } catch {
    return raw;
  }
}

export function titleFromAddress(address: string): string {
  if (isHomeAddress(address)) return 'Home';
  if (isBlankAddress(address)) return 'New Tab';
  if (address.startsWith(SEARCH_BASE)) {
    const query = decodeSearch(address);
    return query ? `Search: ${query}` : 'Search';
  }
  const host = extractHost(address);
  const parts = host.split('.');
  const label = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  if (!label) return 'Page';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function subtitleFromAddress(address: string): string {
  if (isHomeAddress(address)) return 'Start page';
  if (isBlankAddress(address)) return 'Empty workspace';
  return extractHost(address);
}

export function createTab(address: string, id?: string): BrowserTab {
  const normalized = normalizeAddress(address);
  return {
    id: id || makeId('tab'),
    title: titleFromAddress(normalized),
    address: normalized,
    kind: classifyAddress(normalized),
    history: [normalized],
    historyIndex: 0,
    isLoading: false,
    lastLoadedAt: Date.now(),
    loadVersion: 0,
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

function clearPageState(tab: BrowserTab): BrowserTab {
  return {
    ...tab,
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

export function startTabLoad(tab: BrowserTab): BrowserTab {
  return {
    ...clearPageState(tab),
    isLoading: tab.kind === 'page',
    loadVersion: tab.loadVersion + 1,
  };
}

export function applyNavigation(tab: BrowserTab, nextAddress: string, replace = false): BrowserTab {
  const normalized = normalizeAddress(nextAddress);
  const existing = tab.history[tab.historyIndex];
  const baseHistory = tab.history.slice(0, tab.historyIndex + 1);
  const history = baseHistory.slice();

  if (replace && history.length > 0) {
    history[history.length - 1] = normalized;
  } else if (existing !== normalized) {
    history.push(normalized);
  }

  return startTabLoad({
    ...tab,
    title: titleFromAddress(normalized),
    address: normalized,
    kind: classifyAddress(normalized),
    history,
    historyIndex: history.length - 1,
  });
}

export function stepHistory(tab: BrowserTab, delta: -1 | 1): BrowserTab {
  const nextIndex = tab.historyIndex + delta;
  if (nextIndex < 0 || nextIndex >= tab.history.length) return tab;
  const address = tab.history[nextIndex];
  return startTabLoad({
    ...tab,
    title: titleFromAddress(address),
    address,
    kind: classifyAddress(address),
    historyIndex: nextIndex,
  });
}

export function updateLoadedTab(
  tab: BrowserTab,
  patch: {
    address: string;
    title: string;
    statusCode: number;
    contentType: string;
    documentKind: BrowserDocumentKind;
    pageSource: string;
    pageStyles: string;
    pageText: string;
    pageError: string | null;
    truncated: boolean;
  }
): BrowserTab {
  const history = tab.history.slice();
  history[tab.historyIndex] = patch.address;
  return {
    ...tab,
    title: patch.title,
    address: patch.address,
    kind: classifyAddress(patch.address),
    history,
    isLoading: false,
    lastLoadedAt: Date.now(),
    finalAddress: patch.address,
    statusCode: patch.statusCode,
    contentType: patch.contentType || null,
    documentKind: patch.documentKind,
    pageSource: patch.pageSource,
    pageStyles: patch.pageStyles,
    pageText: patch.pageText,
    pageError: patch.pageError,
    wasTruncated: patch.truncated,
  };
}

export function failLoadedTab(tab: BrowserTab, error: string): BrowserTab {
  return {
    ...tab,
    isLoading: false,
    lastLoadedAt: Date.now(),
    pageSource: '',
    pageStyles: '',
    pageError: error,
    pageText: error,
    wasTruncated: false,
  };
}

export function bookmarkMatches(bookmarks: BookmarkEntry[], address: string): BookmarkEntry | null {
  for (const bookmark of bookmarks) {
    if (bookmark.address === address) return bookmark;
  }
  return null;
}

export function formatLoadedAt(ms: number): string {
  const delta = Date.now() - ms;
  if (delta < 5000) return 'just now';
  if (delta < 60000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3600000) return `${Math.floor(delta / 60000)}m ago`;
  return `${Math.floor(delta / 3600000)}h ago`;
}

function pushSuggestion(
  out: BrowserSuggestion[],
  seen: Record<string, boolean>,
  entry: BrowserSuggestion
): void {
  const key = entry.address;
  if (seen[key]) return;
  seen[key] = true;
  out.push(entry);
}

export function buildSuggestions(
  query: string,
  bookmarks: BookmarkEntry[],
  tabs: BrowserTab[],
  links: HomeLink[] = HOME_LINKS
): BrowserSuggestion[] {
  const needle = (query || '').trim().toLowerCase();
  if (needle.length === 0) return [];

  const out: BrowserSuggestion[] = [];
  const seen: Record<string, boolean> = {};

  for (const bookmark of bookmarks) {
    if (
      bookmark.title.toLowerCase().includes(needle) ||
      bookmark.address.toLowerCase().includes(needle)
    ) {
      pushSuggestion(out, seen, {
        id: `bookmark-${bookmark.id}`,
        title: bookmark.title,
        address: bookmark.address,
        meta: 'bookmark',
        source: 'bookmark',
      });
    }
  }

  for (const tab of tabs) {
    if (
      tab.title.toLowerCase().includes(needle) ||
      tab.address.toLowerCase().includes(needle)
    ) {
      pushSuggestion(out, seen, {
        id: `tab-${tab.id}`,
        title: tab.title,
        address: tab.address,
        meta: 'open tab',
        source: 'tab',
      });
    }
  }

  for (const link of links) {
    if (
      link.title.toLowerCase().includes(needle) ||
      link.subtitle.toLowerCase().includes(needle) ||
      link.address.toLowerCase().includes(needle)
    ) {
      pushSuggestion(out, seen, {
        id: `home-${link.id}`,
        title: link.title,
        address: link.address,
        meta: 'start page',
        source: 'home',
      });
    }
  }

  if (out.length === 0) {
    out.push({
      id: 'typed-address',
      title: `Open ${normalizeAddress(query)}`,
      address: normalizeAddress(query),
      meta: 'typed address',
      source: 'home',
    });
  }

  return out.slice(0, 6);
}
