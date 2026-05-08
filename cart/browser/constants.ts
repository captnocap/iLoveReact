import { BookmarkEntry, BrowserSettings, HomeLink } from './types';

export const HOME_URL = 'reactjit://home';
export const BLANK_URL = 'about:blank';
export const SEARCH_BASE = 'https://duckduckgo.com/?q=';

export const STORAGE_KEYS = {
  settings: 'browser.shell.settings.v1',
  bookmarks: 'browser.shell.bookmarks.v1',
  session: 'browser.shell.session.v1',
};

export const COLORS = {
  appBg: '#15181d',
  chrome: '#1c2026',
  chromeAlt: '#171b21',
  chromeRaised: '#252a33',
  chromeInset: '#111419',
  fieldBg: '#0f1217',
  fieldBorder: '#434d5d',
  rail: '#171b21',
  railActive: '#2b3340',
  border: '#343c49',
  borderStrong: '#4a5568',
  text: '#edf1f7',
  textMuted: '#96a1b2',
  textFaint: '#697487',
  accent: '#72a5ff',
  accentWarm: '#d7a74c',
  success: '#5db687',
  danger: '#d86c6c',
  viewport: '#f3eee3',
  viewportPanel: '#fff9ef',
  viewportInk: '#24272d',
  viewportMuted: '#6e7079',
  homeHero: '#e8decc',
  homeTileA: '#dfe8f7',
  homeTileB: '#f0dfcf',
  homeTileC: '#dbe8db',
  homeTileD: '#ece0f0',
};

export const DEFAULT_SETTINGS: BrowserSettings = {
  startupMode: 'home',
  newTabMode: 'home',
  showBookmarksBar: true,
  compactTabs: false,
  showStatusBar: true,
};

export const DEFAULT_BOOKMARKS: BookmarkEntry[] = [
  {
    id: 'bookmark-react',
    title: 'React Docs',
    address: 'https://react.dev/learn',
    createdAt: 1,
  },
  {
    id: 'bookmark-mdn',
    title: 'MDN HTML',
    address: 'https://developer.mozilla.org/en-US/docs/Web/HTML',
    createdAt: 2,
  },
  {
    id: 'bookmark-zig',
    title: 'Zig 0.15.2',
    address: 'https://ziglang.org/documentation/0.15.2/',
    createdAt: 3,
  },
  {
    id: 'bookmark-hn',
    title: 'Hacker News',
    address: 'https://news.ycombinator.com',
    createdAt: 4,
  },
];

export const HOME_LINKS: HomeLink[] = [
  {
    id: 'link-react',
    title: 'React Patterns',
    subtitle: 'Reference material for the renderer pass',
    address: 'https://react.dev/reference/react',
    accent: COLORS.homeTileA,
  },
  {
    id: 'link-zig',
    title: 'Zig Runtime',
    subtitle: 'Keep host-side API details nearby',
    address: 'https://ziglang.org/documentation/0.15.2/',
    accent: COLORS.homeTileB,
  },
  {
    id: 'link-mdn',
    title: 'HTML Surface',
    subtitle: 'Useful when we wire real page rendering next',
    address: 'https://developer.mozilla.org/en-US/docs/Web/HTML',
    accent: COLORS.homeTileC,
  },
  {
    id: 'link-search',
    title: 'Search The Web',
    subtitle: 'Shell is live; the content renderer comes next',
    address: 'https://duckduckgo.com/?q=reactjit+browser+shell',
    accent: COLORS.homeTileD,
  },
];
