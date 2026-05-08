export type StartupMode = 'home' | 'blank' | 'restore';
export type NewTabMode = 'home' | 'blank';
export type BrowserViewKind = 'home' | 'blank' | 'page';
export type BrowserDocumentKind = 'html' | 'text' | 'json' | 'unknown';

export type BrowserTab = {
  id: string;
  title: string;
  address: string;
  kind: BrowserViewKind;
  history: string[];
  historyIndex: number;
  isLoading: boolean;
  lastLoadedAt: number;
  loadVersion: number;
  finalAddress: string | null;
  statusCode: number | null;
  contentType: string | null;
  documentKind: BrowserDocumentKind | null;
  pageSource: string;
  pageStyles: string;
  pageText: string;
  pageError: string | null;
  wasTruncated: boolean;
};

export type BookmarkEntry = {
  id: string;
  title: string;
  address: string;
  createdAt: number;
};

export type BrowserSettings = {
  startupMode: StartupMode;
  newTabMode: NewTabMode;
  showBookmarksBar: boolean;
  compactTabs: boolean;
  showStatusBar: boolean;
};

export type HomeLink = {
  id: string;
  title: string;
  subtitle: string;
  address: string;
  accent: string;
};

export type BrowserSuggestion = {
  id: string;
  title: string;
  address: string;
  meta: string;
  source: 'bookmark' | 'tab' | 'home';
};

export type BrowserSession = {
  tabs: BrowserTab[];
  activeTabId: string;
};

export type BrowserPageDocument = {
  title: string;
  finalAddress: string;
  statusCode: number;
  contentType: string;
  documentKind: BrowserDocumentKind;
  source: string;
  styles: string;
  text: string;
  error: string | null;
  truncated: boolean;
};
