// T3 Code - Command Palette
//
// ReactJIT port of the web command palette. This file intentionally keeps the
// original command model in one place: root actions, recursive submenu views,
// filesystem browse, local add-project, and remote clone flows.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Box,
  Col,
  Row,
  Text,
  Pressable,
  ScrollView,
  TextInput,
} from '@reactjit/runtime/primitives';
import {
  type Project,
  type Settings,
  type Thread,
  type ThreadId,
} from '../types.ts';
import { useT3Store } from '../store.ts';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  threads: Thread[];
  projects: Project[];
  activeThreadId: ThreadId | null;
  settings: Settings;
  onSelectThread: (id: ThreadId) => void;
  onNewThread: (projectId: string) => void;
  onOpenSettings: () => void;
}

type CommandPaletteMode =
  | 'root'
  | 'root-browse'
  | 'submenu'
  | 'submenu-browse';

type AddProjectRemoteProviderKind =
  | 'github'
  | 'gitlab'
  | 'bitbucket'
  | 'azure-devops';

type AddProjectRemoteSource =
  | AddProjectRemoteProviderKind
  | 'url';

type AddProjectCloneFlow =
  | {
      readonly step: 'repository';
      readonly source: AddProjectRemoteSource;
    }
  | {
      readonly step: 'confirm';
      readonly source: AddProjectRemoteSource;
      readonly repositoryInput: string;
      readonly repository: SourceControlRepositoryInfo | null;
      readonly remoteUrl: string;
    };

type AddProjectRemoteSourceReadiness = Record<
  AddProjectRemoteSource,
  {
    readonly ready: boolean;
    readonly hint: string | null;
  }
>;

interface SourceControlRepositoryInfo {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
  readonly defaultBranch?: string;
}

interface FilesystemBrowseEntry {
  readonly name: string;
  readonly fullPath: string;
  readonly kind: 'directory';
}

interface FilesystemBrowseResult {
  readonly parentPath: string;
  readonly entries: FilesystemBrowseEntry[];
}

interface CommandPaletteItemBase {
  readonly kind: 'action' | 'submenu';
  readonly value: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly title: ReactNode;
  readonly textTitle: string;
  readonly description?: string;
  readonly timestamp?: string;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  readonly titleLeadingContent?: ReactNode;
  readonly titleTrailingContent?: ReactNode;
  readonly shortcutLabel?: string;
}

interface CommandPaletteActionItem extends CommandPaletteItemBase {
  readonly kind: 'action';
  readonly keepOpen?: boolean;
  readonly run: () => void | Promise<void>;
}

interface CommandPaletteSubmenuItem extends CommandPaletteItemBase {
  readonly kind: 'submenu';
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

interface CommandPaletteGroup {
  readonly value: string;
  readonly label: string;
  readonly items: ReadonlyArray<
    CommandPaletteActionItem | CommandPaletteSubmenuItem
  >;
}

interface CommandPaletteView {
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

const RECENT_THREAD_LIMIT = 12;
const BROWSE_STALE_TIME_MS = 30_000;

const REMOTE_PROJECT_PROVIDER_SOURCES: ReadonlyArray<
  AddProjectRemoteProviderKind
> = [
  'github',
  'gitlab',
  'bitbucket',
  'azure-devops',
];

const REMOTE_PROJECT_SOURCES: ReadonlyArray<AddProjectRemoteSource> = [
  'url',
  'github',
  'gitlab',
  'bitbucket',
  'azure-devops',
];

const SDL_UP = 1073741906;
const SDL_DOWN = 1073741905;
const SDL_LEFT = 1073741904;
const SDL_RIGHT = 1073741903;
const KMOD_CTRL = 0x00c0;
const KMOD_GUI = 0x0c00;

const C = {
  overlay: 'rgba(0,0,0,0.70)',
  panel: '#0f1015',
  panel2: '#14151c',
  panel3: '#191b23',
  row: 'transparent',
  rowHover: '#1d202b',
  rowActive: '#263044',
  rowActiveBorder: '#3b82f6',
  border: '#2a2d38',
  borderStrong: '#394052',
  text: '#e7eaf0',
  muted: '#8b92a6',
  faint: '#60687a',
  dim: '#4a5060',
  accent: '#60a5fa',
  accentText: '#dbeafe',
  warning: '#f59e0b',
  danger: '#f87171',
  success: '#34d399',
  shadow: 'rgba(0,0,0,0.45)',
};

const S = {
  mono: 'monospace',
  overlay: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 74,
    backgroundColor: C.overlay,
  },
  panel: {
    width: 720,
    maxWidth: '92%',
    maxHeight: '82%',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.borderStrong,
    backgroundColor: C.panel,
    shadowColor: C.shadow,
    shadowOpacity: 1,
    shadowRadius: 24,
  },
  inputShell: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 12,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderColor: C.border,
    backgroundColor: C.panel2,
  },
  input: {
    flex: 1,
    color: C.text,
    fontFamily: 'monospace',
    fontSize: 14,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 8,
  },
  scroll: {
    maxHeight: 448,
    backgroundColor: C.panel,
  },
  group: {
    paddingLeft: 6,
    paddingRight: 6,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 2,
  },
  groupLabel: {
    color: C.faint,
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 4,
    paddingBottom: 5,
  },
  row: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'transparent',
    paddingLeft: 9,
    paddingRight: 8,
    paddingTop: 7,
    paddingBottom: 7,
  },
  iconCell: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.panel3,
  },
  title: {
    color: C.text,
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '600',
  },
  description: {
    color: C.muted,
    fontFamily: 'monospace',
    fontSize: 10,
  },
  muted: {
    color: C.muted,
    fontFamily: 'monospace',
    fontSize: 10,
  },
  footer: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 12,
    borderTopWidth: 1,
    borderColor: C.border,
    backgroundColor: C.panel2,
  },
  kbd: {
    minWidth: 18,
    height: 18,
    paddingLeft: 5,
    paddingRight: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.borderStrong,
    backgroundColor: '#101219',
  },
  kbdText: {
    color: C.text,
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
  },
  pill: {
    paddingLeft: 6,
    paddingRight: 6,
    paddingTop: 2,
    paddingBottom: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: C.borderStrong,
    backgroundColor: C.panel3,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 8,
    paddingTop: 5,
    paddingBottom: 5,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: C.borderStrong,
    backgroundColor: '#182033',
  },
  empty: {
    paddingTop: 42,
    paddingBottom: 42,
    paddingLeft: 16,
    paddingRight: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
} as const;

function host(): any {
  return globalThis as any;
}

function hasHostFunction(name: string): boolean {
  return typeof host()[name] === 'function';
}

function callHost(name: string, ...args: any[]): any {
  return host()[name]?.(...args);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function execString(command: string): string {
  if (!hasHostFunction('__exec')) {
    return '';
  }
  try {
    const out = callHost('__exec', command);
    return typeof out === 'string' ? out : String(out ?? '');
  } catch {
    return '';
  }
}

function readHomeDirectory(): string {
  const fromEnv = execString('printf "%s" "$HOME"').trim();
  if (fromEnv.length > 0) {
    return fromEnv;
  }
  const fromPwd = execString('pwd').trim();
  if (fromPwd.length > 0) {
    return fromPwd;
  }
  return '/tmp';
}

function nowMs(): number {
  return Date.now();
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function stringifyTitle(title: ReactNode): string {
  if (typeof title === 'string') {
    return title;
  }
  if (typeof title === 'number') {
    return String(title);
  }
  return '';
}

function getProjectTitle(project: Project): string {
  return project.name || inferProjectTitleFromPath(project.cwd);
}

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function rankSearchFieldMatch(field: string, normalizedQuery: string): number {
  const normalizedField = normalizeSearchText(field);
  if (
    normalizedField.length === 0 ||
    !normalizedField.includes(normalizedQuery)
  ) {
    return Number.NEGATIVE_INFINITY;
  }
  if (normalizedField === normalizedQuery) {
    return 3;
  }
  if (normalizedField.startsWith(normalizedQuery)) {
    return 2;
  }
  return 1;
}

function rankCommandPaletteItemMatch(
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem,
  normalizedQuery: string,
): number {
  const terms = item.searchTerms.filter((term) => term.length > 0);
  if (terms.length === 0) {
    return 0;
  }

  for (let index = 0; index < terms.length; index += 1) {
    const fieldRank = rankSearchFieldMatch(terms[index] ?? '', normalizedQuery);
    if (fieldRank !== Number.NEGATIVE_INFINITY) {
      return 1_000 - index * 100 + fieldRank;
    }
  }

  return 0;
}

function filterCommandPaletteGroups(input: {
  activeGroups: ReadonlyArray<CommandPaletteGroup>;
  query: string;
  isInSubmenu: boolean;
  projectSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  threadSearchItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const isActionsFilter = input.query.startsWith('>');
  const searchQuery = isActionsFilter ? input.query.slice(1) : input.query;
  const normalizedQuery = normalizeSearchText(searchQuery);

  if (normalizedQuery.length === 0) {
    if (isActionsFilter) {
      return input.activeGroups.filter((group) => group.value === 'actions');
    }
    return [...input.activeGroups];
  }

  let baseGroups = [...input.activeGroups];
  if (isActionsFilter) {
    baseGroups = baseGroups.filter((group) => group.value === 'actions');
  } else if (!input.isInSubmenu) {
    baseGroups = baseGroups.filter((group) => group.value !== 'recent-threads');
  }

  const searchableGroups = [...baseGroups];

  if (!input.isInSubmenu && !isActionsFilter) {
    if (input.projectSearchItems.length > 0) {
      searchableGroups.push({
        value: 'projects-search',
        label: 'Projects',
        items: input.projectSearchItems,
      });
    }

    if (input.threadSearchItems.length > 0) {
      searchableGroups.push({
        value: 'threads-search',
        label: 'Threads',
        items: input.threadSearchItems,
      });
    }
  }

  return searchableGroups.flatMap((group) => {
    const rankedItems = group.items
      .map((item, index) => {
        const haystack = normalizeSearchText(item.searchTerms.join(' '));
        if (!haystack.includes(normalizedQuery)) {
          return null;
        }
        return {
          item,
          index,
          rank: rankCommandPaletteItemMatch(item, normalizedQuery),
        };
      })
      .filter(
        (
          entry,
        ): entry is {
          item: (typeof group.items)[number];
          index: number;
          rank: number;
        } => entry !== null,
      )
      .sort((left, right) => {
        if (right.rank !== left.rank) {
          return right.rank - left.rank;
        }
        return left.index - right.index;
      })
      .map((entry) => entry.item);

    if (rankedItems.length === 0) {
      return [];
    }

    return [
      {
        value: group.value,
        label: group.label,
        items: rankedItems,
      },
    ];
  });
}

function buildRootGroups(input: {
  actionItems: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
  recentThreadItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const groups: CommandPaletteGroup[] = [];

  if (input.actionItems.length > 0) {
    groups.push({
      value: 'actions',
      label: 'Actions',
      items: input.actionItems,
    });
  }

  if (input.recentThreadItems.length > 0) {
    groups.push({
      value: 'recent-threads',
      label: 'Recent Threads',
      items: input.recentThreadItems,
    });
  }

  return groups;
}

function getCommandPaletteMode(input: {
  currentView: CommandPaletteView | null;
  isBrowsing: boolean;
}): CommandPaletteMode {
  if (input.currentView) {
    return input.isBrowsing ? 'submenu-browse' : 'submenu';
  }
  return input.isBrowsing ? 'root-browse' : 'root';
}

function getCommandPaletteInputPlaceholder(mode: CommandPaletteMode): string {
  switch (mode) {
    case 'root':
      return 'Search commands, projects, and threads...';
    case 'root-browse':
      return 'Enter project path (e.g. ~/projects/my-app)';
    case 'submenu':
      return 'Search...';
    case 'submenu-browse':
      return 'Enter path (e.g. ~/projects/my-app)';
  }
}

function formatRelativeTimeLabel(timestamp: number | string | null | undefined): string {
  if (timestamp === null || timestamp === undefined) {
    return '';
  }

  const time =
    typeof timestamp === 'number'
      ? timestamp
      : new Date(timestamp).getTime();

  if (!Number.isFinite(time)) {
    return '';
  }

  const diffMs = Math.max(0, nowMs() - time);
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  const week = day * 7;

  if (diffMs < minute) {
    return 'now';
  }
  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)}m`;
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h`;
  }
  if (diffMs < week) {
    return `${Math.floor(diffMs / day)}d`;
  }

  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(date.getDate()).padStart(2, '0');
  return `${month}/${dayOfMonth}`;
}

function sortThreads(
  threads: ReadonlyArray<Thread>,
  sortOrder: Settings['sidebarThreadSortOrder'],
): Thread[] {
  const sorted = threads.filter((thread) => !thread.archived);
  sorted.sort((left, right) => {
    const leftValue =
      sortOrder === 'created_at' ? left.createdAt : left.updatedAt;
    const rightValue =
      sortOrder === 'created_at' ? right.createdAt : right.updatedAt;
    return rightValue - leftValue;
  });
  return sorted;
}

function sortProjects(
  projects: ReadonlyArray<Project>,
  sortOrder: Settings['sidebarProjectSortOrder'],
): Project[] {
  const sorted = [...projects];
  if (sortOrder === 'manual') {
    return sorted;
  }
  sorted.sort((left, right) => {
    const leftValue =
      sortOrder === 'created_at'
        ? left.createdAt ?? 0
        : left.updatedAt ?? left.createdAt ?? 0;
    const rightValue =
      sortOrder === 'created_at'
        ? right.createdAt ?? 0
        : right.updatedAt ?? right.createdAt ?? 0;
    return rightValue - leftValue;
  });
  return sorted;
}

function getLatestThreadForProject(input: {
  threads: ReadonlyArray<Thread>;
  projectId: string;
  sortOrder: Settings['sidebarThreadSortOrder'];
}): Thread | null {
  return (
    sortThreads(
      input.threads.filter((thread) => thread.projectId === input.projectId),
      input.sortOrder,
    )[0] ?? null
  );
}

function buildProjectActionItems(input: {
  projects: ReadonlyArray<Project>;
  valuePrefix: string;
  icon: (project: Project) => ReactNode;
  runProject: (project: Project) => void | Promise<void>;
}): CommandPaletteActionItem[] {
  return input.projects.map((project) => ({
    kind: 'action',
    value: `${input.valuePrefix}:${project.environmentId}:${project.id}`,
    searchTerms: [
      getProjectTitle(project),
      project.cwd,
      project.environmentId,
    ],
    title: getProjectTitle(project),
    textTitle: getProjectTitle(project),
    description: project.cwd,
    icon: input.icon(project),
    run: async () => {
      await input.runProject(project);
    },
  }));
}

function buildThreadActionItems(input: {
  threads: ReadonlyArray<Thread>;
  activeThreadId?: ThreadId | null;
  projectTitleById: ReadonlyMap<string, string>;
  sortOrder: Settings['sidebarThreadSortOrder'];
  icon: ReactNode;
  renderLeadingContent?: (thread: Thread) => ReactNode;
  renderTrailingContent?: (thread: Thread) => ReactNode;
  runThread: (thread: Thread) => void | Promise<void>;
  limit?: number;
}): CommandPaletteActionItem[] {
  const sortedThreads = sortThreads(input.threads, input.sortOrder);
  const visibleThreads =
    input.limit === undefined
      ? sortedThreads
      : sortedThreads.slice(0, input.limit);

  return visibleThreads.map((thread) => {
    const projectTitle = input.projectTitleById.get(thread.projectId);
    const descriptionParts: string[] = [];

    if (projectTitle) {
      descriptionParts.push(projectTitle);
    }
    if (thread.id === input.activeThreadId) {
      descriptionParts.push('Current thread');
    }

    const leadingContent = input.renderLeadingContent?.(thread);
    const trailingContent = input.renderTrailingContent?.(thread);

    return {
      kind: 'action',
      value: `thread:${thread.id}`,
      searchTerms: [
        thread.title,
        projectTitle ?? '',
        thread.projectId,
        thread.environmentId,
      ],
      title: thread.title,
      textTitle: thread.title,
      description: descriptionParts.join(' · '),
      timestamp: formatRelativeTimeLabel(thread.updatedAt ?? thread.createdAt),
      icon: input.icon,
      ...(leadingContent ? { titleLeadingContent: leadingContent } : {}),
      ...(trailingContent ? { titleTrailingContent: trailingContent } : {}),
      run: async () => {
        await input.runThread(thread);
      },
    };
  });
}

function isFilesystemBrowseQuery(query: string): boolean {
  const trimmed = query.trim();
  return (
    trimmed === '~' ||
    trimmed.startsWith('~/') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  );
}

function isExplicitRelativeProjectPath(path: string): boolean {
  return path.startsWith('./') || path.startsWith('../');
}

function isUnsupportedWindowsProjectPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path);
}

function hasTrailingPathSeparator(path: string): boolean {
  return path.endsWith('/') || path.endsWith('\\');
}

function ensureBrowseDirectoryPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    return '~/';
  }
  if (hasTrailingPathSeparator(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/`;
}

function expandTilde(path: string): string {
  if (path === '~') {
    return readHomeDirectory();
  }
  if (path.startsWith('~/')) {
    return `${readHomeDirectory()}${path.slice(1)}`;
  }
  return path;
}

function collapseHome(path: string): string {
  const home = readHomeDirectory();
  if (path === home) {
    return '~';
  }
  if (path.startsWith(`${home}/`)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

function normalizeAbsolutePath(path: string): string {
  const expanded = expandTilde(path.trim());
  if (expanded.length === 0) {
    return expanded;
  }
  const normalized = execString(
    `node -e "const path=require('path'); process.stdout.write(path.resolve(process.argv[1]));" ${shellQuote(expanded)}`,
  ).trim();
  return normalized.length > 0 ? normalized : expanded;
}

function joinPath(base: string, segment: string): string {
  if (base === '/' || base === '') {
    return `/${segment}`;
  }
  return `${base.replace(/\/+$/, '')}/${segment}`;
}

function dirname(path: string): string {
  const expanded = expandTilde(path.trim());
  const result = execString(
    `node -e "const path=require('path'); process.stdout.write(path.dirname(process.argv[1]));" ${shellQuote(expanded)}`,
  ).trim();
  if (result.length > 0) {
    return collapseHome(result);
  }
  const withoutTrailing = expanded.replace(/\/+$/, '');
  const index = withoutTrailing.lastIndexOf('/');
  if (index <= 0) {
    return '/';
  }
  return collapseHome(withoutTrailing.slice(0, index));
}

function basename(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '/') {
    return trimmed;
  }
  const index = trimmed.lastIndexOf('/');
  return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}

function getBrowseDirectoryPath(query: string): string {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return '';
  }
  if (trimmed === '~') {
    return '~/';
  }
  if (hasTrailingPathSeparator(trimmed)) {
    return trimmed;
  }
  return ensureBrowseDirectoryPath(dirname(trimmed));
}

function getBrowseLeafPathSegment(query: string): string {
  if (hasTrailingPathSeparator(query)) {
    return '';
  }
  return basename(query);
}

function appendBrowsePathSegment(query: string, name: string): string {
  const directory = hasTrailingPathSeparator(query)
    ? query.trim()
    : getBrowseDirectoryPath(query);
  return ensureBrowseDirectoryPath(`${directory.replace(/\/+$/, '')}/${name}`);
}

function getBrowseParentPath(query: string): string | null {
  const directory = getBrowseDirectoryPath(query);
  if (directory.length === 0) {
    return null;
  }
  const expanded = expandTilde(directory);
  const normalized = normalizeAbsolutePath(expanded);
  if (normalized === '/' || normalized.length === 0) {
    return null;
  }
  return ensureBrowseDirectoryPath(dirname(collapseHome(normalized)));
}

function canNavigateUp(queryOrDirectory: string): boolean {
  return getBrowseParentPath(queryOrDirectory) !== null;
}

function resolveProjectPathForDispatch(
  rawPath: string,
  currentProjectCwd: string | null,
): string {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) {
    return '';
  }
  if (isExplicitRelativeProjectPath(trimmed)) {
    if (!currentProjectCwd) {
      return '';
    }
    return normalizeAbsolutePath(joinPath(currentProjectCwd, trimmed));
  }
  return normalizeAbsolutePath(trimmed);
}

function inferProjectTitleFromPath(rawPath: string): string {
  const path = rawPath.trim().replace(/\/+$/, '');
  const name = basename(path);
  return name.length > 0 && name !== '~' ? name : 'untitled';
}

function findProjectByPath(
  projects: ReadonlyArray<Project>,
  cwd: string,
): Project | null {
  const normalizedTarget = normalizeAbsolutePath(cwd);
  return (
    projects.find(
      (project) => normalizeAbsolutePath(project.cwd) === normalizedTarget,
    ) ?? null
  );
}

function parseFilesystemEntry(raw: any, parentPath: string): FilesystemBrowseEntry | null {
  const name =
    typeof raw?.name === 'string'
      ? raw.name
      : typeof raw?.path === 'string'
        ? basename(raw.path)
        : null;

  if (!name || name === '.' || name === '..') {
    return null;
  }

  const kind = String(raw?.kind ?? raw?.type ?? '').toLowerCase();
  const isDirectory =
    raw?.isDirectory === true ||
    raw?.directory === true ||
    kind === 'directory' ||
    kind === 'dir';

  if (!isDirectory) {
    return null;
  }

  const fullPath =
    typeof raw?.fullPath === 'string'
      ? raw.fullPath
      : typeof raw?.path === 'string' && raw.path.startsWith('/')
        ? raw.path
        : joinPath(expandTilde(parentPath), name);

  return {
    name,
    fullPath,
    kind: 'directory',
  };
}

function browseFilesystem(partialPath: string): FilesystemBrowseResult {
  const directory = getBrowseDirectoryPath(partialPath);
  const expandedDirectory = expandTilde(directory);
  const parentPath = normalizeAbsolutePath(expandedDirectory);

  if (hasHostFunction('__fs_list_json')) {
    try {
      const raw = callHost('__fs_list_json', parentPath);
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const entries = asArray(parsed)
        .map((entry) => parseFilesystemEntry(entry, parentPath))
        .filter((entry): entry is FilesystemBrowseEntry => entry !== null)
        .sort((left, right) => left.name.localeCompare(right.name));
      return {
        parentPath,
        entries,
      };
    } catch {
      // Fall through to shell browse.
    }
  }

  const out = execString(
    [
      'node',
      '-e',
      shellQuote(
        [
          'const fs=require("fs");',
          'const path=require("path");',
          'const dir=process.argv[1];',
          'let names=[];',
          'try{names=fs.readdirSync(dir,{withFileTypes:true})',
          '.filter(d=>d.isDirectory())',
          '.map(d=>({name:d.name,fullPath:path.join(dir,d.name),kind:"directory"}));}',
          'catch{}',
          'process.stdout.write(JSON.stringify(names));',
        ].join(''),
      ),
      shellQuote(parentPath),
    ].join(' '),
  );

  try {
    const entries = asArray(JSON.parse(out))
      .map((entry) => parseFilesystemEntry(entry, parentPath))
      .filter((entry): entry is FilesystemBrowseEntry => entry !== null)
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      parentPath,
      entries,
    };
  } catch {
    return {
      parentPath,
      entries: [],
    };
  }
}

function filterBrowseEntries(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  browseFilterQuery: string;
  highlightedItemValue: string | null;
}): {
  filteredEntries: FilesystemBrowseEntry[];
  highlightedEntry: FilesystemBrowseEntry | null;
  exactEntry: FilesystemBrowseEntry | null;
} {
  const lowerFilter = input.browseFilterQuery.toLowerCase();
  const showHidden = input.browseFilterQuery.startsWith('.');

  const filteredEntries = input.browseEntries.filter(
    (entry) =>
      entry.name.toLowerCase().startsWith(lowerFilter) &&
      (showHidden || !entry.name.startsWith('.')),
  );

  let highlightedEntry: FilesystemBrowseEntry | null = null;
  if (input.highlightedItemValue?.startsWith('browse:')) {
    const highlightedPath = input.highlightedItemValue.slice('browse:'.length);
    highlightedEntry =
      filteredEntries.find((entry) => entry.fullPath === highlightedPath) ??
      null;
  }

  const exactEntry =
    input.browseFilterQuery.length > 0
      ? filteredEntries.find((entry) => entry.name === input.browseFilterQuery) ??
        null
      : null;

  return {
    filteredEntries,
    highlightedEntry,
    exactEntry,
  };
}

function buildBrowseGroups(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  browseQuery: string;
  canBrowseUp: boolean;
  upIcon: ReactNode;
  directoryIcon: ReactNode;
  browseUp: () => void;
  browseTo: (name: string) => void;
}): CommandPaletteGroup[] {
  const items: CommandPaletteActionItem[] = [];

  if (input.canBrowseUp) {
    items.push({
      kind: 'action',
      value: 'browse:up',
      searchTerms: [
        input.browseQuery,
        '..',
        'parent',
        'up',
      ],
      title: '..',
      textTitle: '..',
      icon: input.upIcon,
      keepOpen: true,
      run: async () => {
        input.browseUp();
      },
    });
  }

  for (const entry of input.browseEntries) {
    items.push({
      kind: 'action',
      value: `browse:${entry.fullPath}`,
      searchTerms: [
        input.browseQuery,
        entry.fullPath,
        entry.name,
        'directory',
        'folder',
      ],
      title: entry.name,
      textTitle: entry.name,
      description: collapseHome(entry.fullPath),
      icon: input.directoryIcon,
      keepOpen: true,
      run: async () => {
        input.browseTo(entry.name);
      },
    });
  }

  return [
    {
      value: 'directories',
      label: 'Directories',
      items,
    },
  ];
}

function remoteProjectSourceLabel(source: AddProjectRemoteSource): string {
  switch (source) {
    case 'github':
      return 'GitHub';
    case 'gitlab':
      return 'GitLab';
    case 'bitbucket':
      return 'Bitbucket';
    case 'azure-devops':
      return 'Azure DevOps';
    case 'url':
      return 'Git URL';
  }
}

function remoteProjectSourcePathHint(source: AddProjectRemoteSource): string {
  switch (source) {
    case 'github':
      return 'owner/repo';
    case 'gitlab':
      return 'group/project';
    case 'bitbucket':
      return 'workspace/repository';
    case 'azure-devops':
      return 'project/repository';
    case 'url':
      return 'URL';
  }
}

function remoteProjectInputPlaceholder(flow: AddProjectCloneFlow | null): string | null {
  if (!flow) {
    return null;
  }
  if (flow.step === 'confirm') {
    return null;
  }
  if (flow.source === 'url') {
    return 'Enter Git clone URL';
  }
  return `Enter ${remoteProjectSourceLabel(flow.source)} repository (${remoteProjectSourcePathHint(flow.source)})`;
}

function remoteProjectDefaultUrl(
  source: AddProjectRemoteSource,
  repository: string,
): string {
  const trimmed = repository.trim();
  if (source === 'url') {
    return trimmed;
  }
  if (trimmed.includes('://') || trimmed.startsWith('git@')) {
    return trimmed;
  }
  switch (source) {
    case 'github':
      return `git@github.com:${trimmed}.git`;
    case 'gitlab':
      return `git@gitlab.com:${trimmed}.git`;
    case 'bitbucket':
      return `git@bitbucket.org:${trimmed}.git`;
    case 'azure-devops':
      return `https://dev.azure.com/${trimmed}.git`;
    case 'url':
      return trimmed;
  }
}

function remoteProjectRepositoryInfo(
  source: AddProjectRemoteSource,
  repository: string,
): SourceControlRepositoryInfo | null {
  if (source === 'url') {
    return null;
  }
  const input = repository.trim().replace(/\.git$/, '');
  const nameWithOwner = input.replace(/^https?:\/\/[^/]+\//, '');
  const label = remoteProjectSourceLabel(source);
  const url =
    source === 'github'
      ? `https://github.com/${nameWithOwner}`
      : source === 'gitlab'
        ? `https://gitlab.com/${nameWithOwner}`
        : source === 'bitbucket'
          ? `https://bitbucket.org/${nameWithOwner}`
          : `https://dev.azure.com/${nameWithOwner}`;

  return {
    nameWithOwner: `${label}:${nameWithOwner}`,
    url,
    sshUrl: remoteProjectDefaultUrl(source, repository),
  };
}

function sourceProviderKind(
  source: AddProjectRemoteSource,
): AddProjectRemoteProviderKind | null {
  return source === 'url' ? null : source;
}

function buildAddProjectRemoteSourceReadiness(): AddProjectRemoteSourceReadiness {
  const readiness: AddProjectRemoteSourceReadiness = {
    url: {
      ready: true,
      hint: null,
    },
    github: {
      ready: true,
      hint: null,
    },
    gitlab: {
      ready: true,
      hint: null,
    },
    bitbucket: {
      ready: true,
      hint: null,
    },
    'azure-devops': {
      ready: true,
      hint: null,
    },
  };

  return readiness;
}

function sortAddProjectProviderSources(
  readinessBySource: AddProjectRemoteSourceReadiness,
): ReadonlyArray<AddProjectRemoteProviderKind> {
  return [...REMOTE_PROJECT_PROVIDER_SOURCES].sort((left, right) => {
    const leftReady = readinessBySource[left].ready;
    const rightReady = readinessBySource[right].ready;
    if (leftReady !== rightReady) {
      return leftReady ? -1 : 1;
    }
    return remoteProjectSourceLabel(left).localeCompare(
      remoteProjectSourceLabel(right),
    );
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return 'An error occurred.';
}

function flatItems(
  groups: ReadonlyArray<CommandPaletteGroup>,
): Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> {
  return groups.flatMap((group) => group.items);
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, index));
}

function eventKey(payload: any): string | number {
  return payload?.key ?? payload?.keyCode ?? 0;
}

function isEnterKey(payload: any): boolean {
  const key = eventKey(payload);
  return key === 'Enter' || key === 13;
}

function isEscapeKey(payload: any): boolean {
  const key = eventKey(payload);
  return key === 'Escape' || key === 'Esc' || key === 27;
}

function isBackspaceKey(payload: any): boolean {
  const key = eventKey(payload);
  return key === 'Backspace' || key === 8;
}

function isArrowUpKey(payload: any): boolean {
  const key = eventKey(payload);
  return key === 'ArrowUp' || key === 38 || key === SDL_UP;
}

function isArrowDownKey(payload: any): boolean {
  const key = eventKey(payload);
  return key === 'ArrowDown' || key === 40 || key === SDL_DOWN;
}

function isArrowLeftKey(payload: any): boolean {
  const key = eventKey(payload);
  return key === 'ArrowLeft' || key === 37 || key === SDL_LEFT;
}

function isArrowRightKey(payload: any): boolean {
  const key = eventKey(payload);
  return key === 'ArrowRight' || key === 39 || key === SDL_RIGHT;
}

function hasPrimaryModifier(payload: any): boolean {
  const mods = Number(payload?.mods ?? 0);
  return (mods & KMOD_CTRL) !== 0 || (mods & KMOD_GUI) !== 0;
}

function IconText(props: {
  label: string;
  color?: string;
}): JSX.Element {
  return (
    <Text
      style={{
        color: props.color ?? C.muted,
        fontFamily: S.mono,
        fontSize: 12,
        fontWeight: '700',
      }}
    >
      {props.label}
    </Text>
  );
}

function ProjectFavicon(props: {
  project: Project;
}): JSX.Element {
  const first = getProjectTitle(props.project).trim().slice(0, 1).toUpperCase();
  return (
    <Box
      style={{
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 4,
        backgroundColor: '#1d2838',
        borderWidth: 1,
        borderColor: C.borderStrong,
      }}
    >
      <Text
        style={{
          color: C.accentText,
          fontFamily: S.mono,
          fontSize: 10,
          fontWeight: '700',
        }}
      >
        {first || 'P'}
      </Text>
    </Box>
  );
}

function ThreadRowLeadingStatus(props: {
  thread: Thread;
  activeThreadId: ThreadId | null;
}): JSX.Element | null {
  const isActive = props.thread.id === props.activeThreadId;
  const hasPlan = (props.thread.proposedPlans ?? []).some(
    (plan) => plan.status === 'pending',
  );

  if (!isActive && !hasPlan) {
    return null;
  }

  return (
    <Row
      style={{
        gap: 4,
        alignItems: 'center',
      }}
    >
      {isActive ? (
        <Box
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: C.success,
          }}
        />
      ) : null}
      {hasPlan ? (
        <Box
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: C.warning,
          }}
        />
      ) : null}
    </Row>
  );
}

function ThreadRowTrailingStatus(props: {
  thread: Thread;
}): JSX.Element | null {
  const pendingPlanCount = (props.thread.proposedPlans ?? []).filter(
    (plan) => plan.status === 'pending',
  ).length;
  if (pendingPlanCount === 0) {
    return null;
  }
  return (
    <Box style={S.pill}>
      <Text
        style={{
          color: C.warning,
          fontFamily: S.mono,
          fontSize: 9,
          fontWeight: '700',
        }}
      >
        plan
      </Text>
    </Box>
  );
}

function Kbd(props: {
  children: ReactNode;
}): JSX.Element {
  return (
    <Box style={S.kbd}>
      <Text style={S.kbdText}>{props.children}</Text>
    </Box>
  );
}

function ShortcutHint(props: {
  keys: ReactNode[];
  label: string;
}): JSX.Element {
  return (
    <Row
      style={{
        alignItems: 'center',
        gap: 5,
      }}
    >
      {props.keys.map((key, index) => (
        <Kbd key={`${String(key)}:${index}`}>{key}</Kbd>
      ))}
      <Text style={S.muted}>{props.label}</Text>
    </Row>
  );
}

function PaletteIcon(props: {
  children: ReactNode;
}): JSX.Element {
  return (
    <Box style={S.iconCell}>
      {typeof props.children === 'string' ? (
        <IconText label={props.children} />
      ) : (
        props.children
      )}
    </Box>
  );
}

function renderTitle(title: ReactNode): ReactNode {
  if (typeof title === 'string' || typeof title === 'number') {
    return (
      <Text
        style={S.title}
        numberOfLines={1}
      >
        {title}
      </Text>
    );
  }
  return title;
}

function DisabledCommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
}): JSX.Element {
  return (
    <Row
      style={{
        ...S.row,
        opacity: 0.52,
      }}
    >
      <PaletteIcon>{props.item.icon}</PaletteIcon>
      <Col
        style={{
          flex: 1,
          gap: 2,
          minWidth: 0,
        }}
      >
        <Row
          style={{
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
          }}
        >
          {props.item.titleLeadingContent}
          {renderTitle(props.item.title)}
          {props.item.titleTrailingContent}
        </Row>
        {props.item.description ? (
          <Text
            style={S.description}
            numberOfLines={1}
          >
            {props.item.description}
          </Text>
        ) : null}
      </Col>
    </Row>
  );
}

function CommandPaletteResultRow(props: {
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
  isActive: boolean;
  onHover: () => void;
  onExecuteItem: (
    item: CommandPaletteActionItem | CommandPaletteSubmenuItem,
  ) => void;
}): JSX.Element {
  return (
    <Pressable
      onHoverEnter={props.onHover}
      onPress={() => {
        props.onExecuteItem(props.item);
      }}
    >
      <Row
        style={{
          ...S.row,
          backgroundColor: props.isActive ? C.rowActive : C.row,
          borderColor: props.isActive ? C.rowActiveBorder : 'transparent',
        }}
      >
        <PaletteIcon>{props.item.icon}</PaletteIcon>
        <Col
          style={{
            flex: 1,
            gap: 2,
            minWidth: 0,
          }}
        >
          <Row
            style={{
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
            }}
          >
            {props.item.titleLeadingContent}
            {renderTitle(props.item.title)}
            {props.item.titleTrailingContent}
          </Row>
          {props.item.description ? (
            <Text
              style={S.description}
              numberOfLines={1}
            >
              {props.item.description}
            </Text>
          ) : null}
        </Col>
        {props.item.timestamp ? (
          <Text
            style={{
              color: C.faint,
              fontFamily: S.mono,
              fontSize: 9,
              minWidth: 34,
              textAlign: 'right',
            }}
          >
            {props.item.timestamp}
          </Text>
        ) : null}
        {props.item.shortcutLabel ? (
          <Box style={S.pill}>
            <Text
              style={{
                color: C.muted,
                fontFamily: S.mono,
                fontSize: 9,
                fontWeight: '700',
              }}
            >
              {props.item.shortcutLabel}
            </Text>
          </Box>
        ) : null}
        {props.item.kind === 'submenu' ? (
          <Text
            style={{
              color: C.faint,
              fontFamily: S.mono,
              fontSize: 14,
              fontWeight: '700',
            }}
          >
            {'>'}
          </Text>
        ) : null}
      </Row>
    </Pressable>
  );
}

function CommandPaletteResults(props: {
  emptyStateMessage?: string;
  groups: ReadonlyArray<CommandPaletteGroup>;
  highlightedItemValue?: string | null;
  isActionsOnly: boolean;
  onHighlightedItemValue: (value: string) => void;
  onExecuteItem: (
    item: CommandPaletteActionItem | CommandPaletteSubmenuItem,
  ) => void;
}): JSX.Element {
  if (props.groups.length === 0 || flatItems(props.groups).length === 0) {
    return (
      <Box style={S.empty}>
        <Text
          style={{
            color: C.muted,
            fontFamily: S.mono,
            fontSize: 12,
            textAlign: 'center',
          }}
        >
          {props.emptyStateMessage ??
            (props.isActionsOnly
              ? 'No matching actions.'
              : 'No matching commands, projects, or threads.')}
        </Text>
      </Box>
    );
  }

  return (
    <Col
      style={{
        paddingBottom: 6,
      }}
    >
      {props.groups.map((group) => (
        <Col
          key={group.value}
          style={S.group}
        >
          <Text style={S.groupLabel}>{group.label}</Text>
          {group.items.map((item) =>
            item.disabled ? (
              <DisabledCommandPaletteResultRow
                key={item.value}
                item={item}
              />
            ) : (
              <CommandPaletteResultRow
                key={item.value}
                item={item}
                isActive={props.highlightedItemValue === item.value}
                onHover={() => {
                  props.onHighlightedItemValue(item.value);
                }}
                onExecuteItem={props.onExecuteItem}
              />
            ),
          )}
        </Col>
      ))}
    </Col>
  );
}

function RepositoryContextRow(props: {
  icon: ReactNode;
  title: string;
  description: string;
}): JSX.Element {
  return (
    <Col
      style={{
        paddingLeft: 6,
        paddingRight: 6,
        paddingTop: 8,
        paddingBottom: 0,
      }}
    >
      <Text style={S.groupLabel}>Repository</Text>
      <Row
        style={{
          ...S.row,
          borderColor: 'transparent',
        }}
      >
        <PaletteIcon>{props.icon}</PaletteIcon>
        <Col
          style={{
            flex: 1,
            minWidth: 0,
            gap: 2,
          }}
        >
          <Text
            style={S.title}
            numberOfLines={1}
          >
            {props.title}
          </Text>
          <Text
            style={S.description}
            numberOfLines={1}
          >
            {props.description}
          </Text>
        </Col>
      </Row>
    </Col>
  );
}

function InputActionButton(props: {
  disabled?: boolean;
  label: string;
  shortcut: string;
  onPress: () => void;
}): JSX.Element {
  return (
    <Pressable
      onPress={() => {
        if (!props.disabled) {
          props.onPress();
        }
      }}
    >
      <Row
        style={{
          ...S.button,
          opacity: props.disabled ? 0.48 : 1,
        }}
      >
        <Text
          style={{
            color: C.text,
            fontFamily: S.mono,
            fontSize: 10,
            fontWeight: '700',
          }}
        >
          {props.label}
        </Text>
        <Kbd>{props.shortcut}</Kbd>
      </Row>
    </Pressable>
  );
}

function BackButton(props: {
  onPress: () => void;
}): JSX.Element {
  return (
    <Pressable onPress={props.onPress}>
      <Box
        style={{
          width: 28,
          height: 28,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 5,
          borderWidth: 1,
          borderColor: C.borderStrong,
          backgroundColor: C.panel3,
        }}
      >
        <Text
          style={{
            color: C.text,
            fontFamily: S.mono,
            fontSize: 14,
            fontWeight: '700',
          }}
        >
          {'<'}
        </Text>
      </Box>
    </Pressable>
  );
}

function FooterFileManagerButton(props: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}): JSX.Element {
  return (
    <Pressable
      onPress={() => {
        if (!props.disabled) {
          props.onPress();
        }
      }}
    >
      <Box
        style={{
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 5,
          paddingBottom: 5,
          borderRadius: 5,
          backgroundColor: props.disabled ? 'transparent' : C.panel3,
          borderWidth: 1,
          borderColor: props.disabled ? 'transparent' : C.border,
        }}
      >
        <Text
          style={{
            color: props.disabled ? C.dim : C.muted,
            fontFamily: S.mono,
            fontSize: 10,
          }}
        >
          {props.label}
        </Text>
      </Box>
    </Pressable>
  );
}

export default function CommandPalette(props: CommandPaletteProps) {
  const {
    open,
    onClose,
    threads,
    projects,
    activeThreadId,
    settings,
    onSelectThread,
    onNewThread,
    onOpenSettings,
  } = props;

  const store = useT3Store();
  const [query, setQuery] = useState('');
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(
    null,
  );
  const [viewStack, setViewStack] = useState<CommandPaletteView[]>([]);
  const [browseGeneration, setBrowseGeneration] = useState(0);
  const [browseResult, setBrowseResult] = useState<FilesystemBrowseResult | null>(
    null,
  );
  const [browsePending, setBrowsePending] = useState(false);
  const [browseCache, setBrowseCache] = useState<
    Record<
      string,
      {
        result: FilesystemBrowseResult;
        fetchedAt: number;
      }
    >
  >({});
  const [isPickingProjectFolder, setIsPickingProjectFolder] = useState(false);
  const [addProjectCloneFlow, setAddProjectCloneFlow] =
    useState<AddProjectCloneFlow | null>(null);
  const [isRemoteProjectLookingUp, setIsRemoteProjectLookingUp] = useState(false);
  const [isRemoteProjectCloning, setIsRemoteProjectCloning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const currentView = viewStack[viewStack.length - 1] ?? null;
  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null;
  const activeProject =
    activeThread !== null
      ? projects.find((project) => project.id === activeThread.projectId) ?? null
      : null;
  const currentProjectCwdForBrowse = activeProject?.cwd ?? null;
  const isRemoteProjectRepositoryStep = addProjectCloneFlow?.step === 'repository';
  const isRemoteProjectCloneFlow = addProjectCloneFlow !== null;
  const isBrowsing =
    !isRemoteProjectRepositoryStep && isFilesystemBrowseQuery(query);
  const paletteMode = getCommandPaletteMode({
    currentView,
    isBrowsing,
  });
  const isSubmenu = paletteMode === 'submenu' || paletteMode === 'submenu-browse';
  const isActionsOnly = query.startsWith('>');

  const projectTitleById = useMemo(
    () =>
      new Map<string, string>(
        projects.map((project) => [
          project.id,
          getProjectTitle(project),
        ]),
      ),
    [projects],
  );

  const sortedProjects = useMemo(
    () => sortProjects(projects, settings.sidebarProjectSortOrder),
    [projects, settings.sidebarProjectSortOrder],
  );

  const browseDirectoryPath = isBrowsing ? getBrowseDirectoryPath(query) : '';
  const browseFilterQuery =
    isBrowsing && !hasTrailingPathSeparator(query)
      ? getBrowseLeafPathSegment(query)
      : '';
  const relativePathNeedsActiveProject =
    isExplicitRelativeProjectPath(query.trim()) &&
    currentProjectCwdForBrowse === null;

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlightedItemValue(null);
      setViewStack([]);
      setBrowseGeneration(0);
      setBrowseResult(null);
      setAddProjectCloneFlow(null);
      setIsPickingProjectFolder(false);
      setIsRemoteProjectLookingUp(false);
      setIsRemoteProjectCloning(false);
      setStatusMessage(null);
    }
  }, [open]);

  useEffect(() => {
    if (!isBrowsing || browseDirectoryPath.length === 0 || relativePathNeedsActiveProject) {
      setBrowseResult(null);
      setBrowsePending(false);
      return;
    }

    const cacheKey = `${browseDirectoryPath}:${currentProjectCwdForBrowse ?? ''}`;
    const cached = browseCache[cacheKey];
    if (cached && nowMs() - cached.fetchedAt < BROWSE_STALE_TIME_MS) {
      setBrowseResult(cached.result);
      setBrowsePending(false);
      return;
    }

    setBrowsePending(true);
    const result = browseFilesystem(browseDirectoryPath);
    setBrowseCache((previous) => ({
      ...previous,
      [cacheKey]: {
        result,
        fetchedAt: nowMs(),
      },
    }));
    setBrowseResult(result);
    setBrowsePending(false);
  }, [
    browseCache,
    browseDirectoryPath,
    browseGeneration,
    currentProjectCwdForBrowse,
    isBrowsing,
    relativePathNeedsActiveProject,
  ]);

  const browseEntries = browseResult?.entries ?? [];
  const {
    filteredEntries: filteredBrowseEntries,
    highlightedEntry: highlightedBrowseEntry,
    exactEntry: exactBrowseEntry,
  } = useMemo(
    () =>
      filterBrowseEntries({
        browseEntries,
        browseFilterQuery,
        highlightedItemValue,
      }),
    [
      browseEntries,
      browseFilterQuery,
      highlightedItemValue,
    ],
  );

  const openProjectFromSearch = useCallback(
    (project: Project) => {
      const latestThread = getLatestThreadForProject({
        threads: threads.filter(
          (thread) => thread.environmentId === project.environmentId,
        ),
        projectId: project.id,
        sortOrder: settings.sidebarThreadSortOrder,
      });

      if (latestThread) {
        onSelectThread(latestThread.id);
        return;
      }

      onNewThread(project.id);
    },
    [
      onNewThread,
      onSelectThread,
      settings.sidebarThreadSortOrder,
      threads,
    ],
  );

  const projectSearchItems = useMemo(
    () =>
      buildProjectActionItems({
        projects: sortedProjects,
        valuePrefix: 'project',
        icon: (project) => <ProjectFavicon project={project} />,
        runProject: openProjectFromSearch,
      }),
    [
      openProjectFromSearch,
      sortedProjects,
    ],
  );

  const projectThreadItems = useMemo(
    () =>
      buildProjectActionItems({
        projects: sortedProjects,
        valuePrefix: 'new-thread-in',
        icon: (project) => <ProjectFavicon project={project} />,
        runProject: async (project) => {
          onNewThread(project.id);
        },
      }),
    [
      onNewThread,
      sortedProjects,
    ],
  );

  const allThreadItems = useMemo(
    () =>
      buildThreadActionItems({
        threads,
        activeThreadId,
        projectTitleById,
        sortOrder: settings.sidebarThreadSortOrder,
        icon: <IconText label="T" />,
        renderLeadingContent: (thread) => (
          <ThreadRowLeadingStatus
            thread={thread}
            activeThreadId={activeThreadId}
          />
        ),
        renderTrailingContent: (thread) => (
          <ThreadRowTrailingStatus thread={thread} />
        ),
        runThread: async (thread) => {
          onSelectThread(thread.id);
        },
      }),
    [
      activeThreadId,
      onSelectThread,
      projectTitleById,
      settings.sidebarThreadSortOrder,
      threads,
    ],
  );

  const recentThreadItems = useMemo(
    () => allThreadItems.slice(0, RECENT_THREAD_LIMIT),
    [allThreadItems],
  );

  function pushPaletteView(view: CommandPaletteView): void {
    setViewStack((previousViews) => [
      ...previousViews,
      {
        addonIcon: view.addonIcon,
        groups: view.groups,
        ...(view.initialQuery ? { initialQuery: view.initialQuery } : {}),
      },
    ]);
    setHighlightedItemValue(null);
    setQuery(view.initialQuery ?? '');
  }

  function pushView(item: CommandPaletteSubmenuItem): void {
    pushPaletteView({
      addonIcon: item.addonIcon,
      groups: item.groups,
      ...(item.initialQuery ? { initialQuery: item.initialQuery } : {}),
    });
  }

  function popView(): void {
    setAddProjectCloneFlow(null);
    setViewStack((previousViews) => previousViews.slice(0, -1));
    setHighlightedItemValue(null);
    setQuery('');
    setStatusMessage(null);
  }

  function handleQueryChange(nextQuery: string): void {
    setHighlightedItemValue(null);
    setQuery(nextQuery);
    setStatusMessage(null);
    if (nextQuery === '' && currentView?.initialQuery) {
      popView();
    }
  }

  const startAddProjectBrowse = useCallback(() => {
    setAddProjectCloneFlow(null);
    pushPaletteView({
      addonIcon: <IconText label="+" />,
      groups: [],
      initialQuery: '~/',
    });
  }, []);

  const startAddProjectClone = useCallback(
    (source: AddProjectRemoteSource): void => {
      setAddProjectCloneFlow({
        step: 'repository',
        source,
      });
      pushPaletteView({
        addonIcon: <IconText label="G" />,
        groups: [],
        initialQuery: '',
      });
    },
    [],
  );

  const openSourceControlSettings = useCallback(() => {
    onOpenSettings();
    onClose();
  }, [
    onClose,
    onOpenSettings,
  ]);

  const buildAddProjectSourceGroups = useCallback(
    (
      readinessBySource: AddProjectRemoteSourceReadiness,
    ): CommandPaletteView['groups'] => {
      const sourceItems: Array<
        CommandPaletteActionItem | CommandPaletteSubmenuItem
      > = [
        {
          kind: 'action',
          value: 'action:add-project:local',
          searchTerms: [
            'local',
            'folder',
            'directory',
            'browse',
          ],
          title: 'Local folder',
          textTitle: 'Local folder',
          description: 'Browse a folder on disk',
          icon: <IconText label="+" />,
          keepOpen: true,
          run: async () => {
            startAddProjectBrowse();
          },
        },
      ];

      const orderedSources: ReadonlyArray<AddProjectRemoteSource> = [
        'url',
        ...sortAddProjectProviderSources(readinessBySource),
      ];

      for (const source of orderedSources) {
        const label = remoteProjectSourceLabel(source);
        const title = source === 'url' ? 'Git URL' : `${label} repository`;
        const description =
          source === 'url'
            ? 'Clone from a remote URL'
            : `Clone ${label} ${remoteProjectSourcePathHint(source)}`;
        const readiness = readinessBySource[source];
        const disabledHint = readiness.hint;

        if (!readiness.ready) {
          sourceItems.push({
            kind: 'action',
            value: `action:add-project:${source}:not-ready`,
            searchTerms: [
              'clone',
              'remote',
              'repository',
              'repo',
              'git',
              label,
              'setup required',
            ],
            title,
            textTitle: title,
            description: disabledHint ?? description,
            disabled: true,
            icon: <IconText label="!" color={C.warning} />,
            titleTrailingContent: (
              <Pressable onPress={openSourceControlSettings}>
                <Box style={S.pill}>
                  <Text
                    style={{
                      color: C.warning,
                      fontFamily: S.mono,
                      fontSize: 9,
                      fontWeight: '700',
                    }}
                  >
                    setup
                  </Text>
                </Box>
              </Pressable>
            ),
            run: async () => {},
          });
          continue;
        }

        sourceItems.push({
          kind: 'action',
          value: `action:add-project:${source}`,
          searchTerms: [
            'clone',
            'remote',
            'repository',
            'repo',
            'git',
            label,
            sourceProviderKind(source) ?? '',
          ],
          title,
          textTitle: title,
          description,
          icon: <IconText label={source === 'url' ? 'U' : 'G'} />,
          keepOpen: true,
          run: async () => {
            startAddProjectClone(source);
          },
        });
      }

      return [
        {
          value: 'sources',
          label: 'Sources',
          items: sourceItems,
        },
      ];
    },
    [
      openSourceControlSettings,
      startAddProjectBrowse,
      startAddProjectClone,
    ],
  );

  const startAddProjectSourceSelection = useCallback(() => {
    setAddProjectCloneFlow(null);
    pushPaletteView({
      addonIcon: <IconText label="+" />,
      groups: buildAddProjectSourceGroups(
        buildAddProjectRemoteSourceReadiness(),
      ),
    });
  }, [buildAddProjectSourceGroups]);

  const openAddProjectFlow = useCallback(() => {
    startAddProjectSourceSelection();
  }, [startAddProjectSourceSelection]);

  const actionItems = useMemo<
    Array<CommandPaletteActionItem | CommandPaletteSubmenuItem>
  >(() => {
    const items: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];
    const activeProjectTitle = activeProject
      ? getProjectTitle(activeProject)
      : null;

    if (projects.length > 0) {
      if (activeProjectTitle && activeProject) {
        items.push({
          kind: 'action',
          value: 'action:new-thread',
          searchTerms: [
            'new thread',
            'chat',
            'create',
            'draft',
            activeProjectTitle,
          ],
          title: `New thread in ${activeProjectTitle}`,
          textTitle: `New thread in ${activeProjectTitle}`,
          icon: <IconText label="N" />,
          shortcutLabel: 'Ctrl N',
          run: async () => {
            onNewThread(activeProject.id);
          },
        });
      }

      items.push({
        kind: 'submenu',
        value: 'action:new-thread-in',
        searchTerms: [
          'new thread',
          'project',
          'pick',
          'choose',
          'select',
        ],
        title: 'New thread in...',
        textTitle: 'New thread in...',
        icon: <IconText label="N" />,
        addonIcon: <IconText label="N" />,
        groups: [
          {
            value: 'projects',
            label: 'Projects',
            items: projectThreadItems,
          },
        ],
      });
    }

    items.push({
      kind: 'action',
      value: 'action:add-project',
      searchTerms: [
        'add project',
        'folder',
        'directory',
        'browse',
        'clone',
        'remote',
        'repository',
        'repo',
        'git',
        'github',
        'gitlab',
        'bitbucket',
        'azure',
        'devops',
        'url',
        'environment',
      ],
      title: 'Add project',
      textTitle: 'Add project',
      icon: <IconText label="+" />,
      keepOpen: true,
      run: async () => {
        openAddProjectFlow();
      },
    });

    items.push({
      kind: 'submenu',
      value: 'action:open-project',
      searchTerms: [
        'open project',
        'project',
        'workspace',
        'folder',
        'latest thread',
      ],
      title: 'Open project...',
      textTitle: 'Open project...',
      icon: <IconText label="P" />,
      addonIcon: <IconText label="P" />,
      groups: [
        {
          value: 'projects',
          label: 'Projects',
          items: projectSearchItems,
        },
      ],
    });

    items.push({
      kind: 'submenu',
      value: 'action:open-thread',
      searchTerms: [
        'open thread',
        'thread',
        'chat',
        'conversation',
        'history',
      ],
      title: 'Open thread...',
      textTitle: 'Open thread...',
      icon: <IconText label="T" />,
      addonIcon: <IconText label="T" />,
      groups: [
        {
          value: 'threads',
          label: 'Threads',
          items: allThreadItems,
        },
      ],
    });

    items.push({
      kind: 'action',
      value: 'action:settings',
      searchTerms: [
        'settings',
        'preferences',
        'configuration',
        'keybindings',
        'providers',
      ],
      title: 'Open settings',
      textTitle: 'Open settings',
      icon: <IconText label="S" />,
      shortcutLabel: 'Ctrl ,',
      run: async () => {
        onOpenSettings();
      },
    });

    items.push({
      kind: 'action',
      value: 'action:close',
      searchTerms: [
        'close',
        'dismiss',
        'escape',
        'command palette',
      ],
      title: 'Close palette',
      textTitle: 'Close palette',
      icon: <IconText label="X" />,
      shortcutLabel: 'Esc',
      run: async () => {
        onClose();
      },
    });

    return items;
  }, [
    activeProject,
    allThreadItems,
    onClose,
    onNewThread,
    onOpenSettings,
    openAddProjectFlow,
    projectSearchItems,
    projectThreadItems,
    projects.length,
  ]);

  const rootGroups = useMemo(
    () =>
      buildRootGroups({
        actionItems,
        recentThreadItems,
      }),
    [
      actionItems,
      recentThreadItems,
    ],
  );

  const activeGroups = currentView ? currentView.groups : rootGroups;

  const filteredGroups = useMemo(
    () =>
      filterCommandPaletteGroups({
        activeGroups,
        query,
        isInSubmenu: currentView !== null,
        projectSearchItems,
        threadSearchItems: allThreadItems,
      }),
    [
      activeGroups,
      allThreadItems,
      currentView,
      projectSearchItems,
      query,
    ],
  );

  const canBrowseUp =
    isBrowsing &&
    !relativePathNeedsActiveProject &&
    canNavigateUp(browseDirectoryPath);

  function browseTo(name: string): void {
    const nextQuery = appendBrowsePathSegment(query, name);
    setHighlightedItemValue(null);
    setQuery(nextQuery);
    setBrowseGeneration((generation) => generation + 1);
  }

  function browseUp(): void {
    const parentPath = getBrowseParentPath(query);
    if (parentPath === null) {
      return;
    }
    setHighlightedItemValue(null);
    setQuery(parentPath);
    setBrowseGeneration((generation) => generation + 1);
  }

  const browseGroups = useMemo(
    () =>
      buildBrowseGroups({
        browseEntries: filteredBrowseEntries,
        browseQuery: query,
        canBrowseUp,
        upIcon: <IconText label=".." />,
        directoryIcon: <IconText label="/" />,
        browseUp,
        browseTo,
      }),
    [
      canBrowseUp,
      filteredBrowseEntries,
      query,
    ],
  );

  const cloneDestinationBrowseGroups = useMemo(
    () =>
      browseGroups.map((group) =>
        group.value === 'directories'
          ? {
              ...group,
              label: 'Select where to clone',
            }
          : group,
      ),
    [browseGroups],
  );

  const resolvedAddProjectPath = hasTrailingPathSeparator(query)
    ? browseResult?.parentPath ?? query.trim()
    : exactBrowseEntry?.fullPath ?? query.trim();

  const hasHighlightedBrowseItem =
    highlightedItemValue?.startsWith('browse:') ?? false;
  const canSubmitBrowsePath =
    isBrowsing && !relativePathNeedsActiveProject;
  const willCreateProjectPath =
    canSubmitBrowsePath &&
    !browsePending &&
    query.trim().length > 0 &&
    !hasHighlightedBrowseItem &&
    (hasTrailingPathSeparator(query)
      ? !browseResult
      : exactBrowseEntry === null);
  const isCloneDestinationStep = addProjectCloneFlow?.step === 'confirm';
  const submitActionLabel = isCloneDestinationStep
    ? willCreateProjectPath
      ? 'Create & Clone'
      : 'Clone'
    : willCreateProjectPath
      ? 'Create & Add'
      : 'Add';
  const submitShortcutLabel = hasHighlightedBrowseItem ? 'Ctrl Enter' : 'Enter';
  const isRemoteProjectPending =
    isRemoteProjectLookingUp || isRemoteProjectCloning;
  const canSubmitRemoteProjectFlow =
    addProjectCloneFlow?.step === 'repository' &&
    query.trim().length > 0 &&
    !isRemoteProjectPending;
  const remoteProjectButtonLabel =
    addProjectCloneFlow?.step === 'repository'
      ? addProjectCloneFlow.source === 'url'
        ? 'Continue'
        : 'Lookup'
      : null;

  const remoteProjectContext = useMemo(() => {
    if (addProjectCloneFlow?.step !== 'confirm') {
      return null;
    }
    return {
      title:
        addProjectCloneFlow.repository?.nameWithOwner ??
        addProjectCloneFlow.repositoryInput,
      description:
        addProjectCloneFlow.repository?.url ??
        addProjectCloneFlow.remoteUrl,
      icon: <IconText label={addProjectCloneFlow.source === 'url' ? 'U' : 'G'} />,
    };
  }, [addProjectCloneFlow]);

  let displayedGroups: CommandPaletteView['groups'] = filteredGroups;
  if (addProjectCloneFlow?.step === 'repository') {
    displayedGroups = [];
  } else if (addProjectCloneFlow?.step === 'confirm') {
    displayedGroups = relativePathNeedsActiveProject
      ? []
      : cloneDestinationBrowseGroups;
  } else if (isBrowsing) {
    displayedGroups = relativePathNeedsActiveProject ? [] : browseGroups;
  }

  const displayedItems = flatItems(displayedGroups).filter(
    (item) => !item.disabled,
  );

  useEffect(() => {
    if (displayedItems.length === 0) {
      setHighlightedItemValue(null);
      return;
    }
    if (
      highlightedItemValue === null ||
      !displayedItems.some((item) => item.value === highlightedItemValue)
    ) {
      setHighlightedItemValue(displayedItems[0]?.value ?? null);
    }
  }, [
    displayedItems,
    highlightedItemValue,
  ]);

  function highlightedIndex(): number {
    if (!highlightedItemValue) {
      return 0;
    }
    const index = displayedItems.findIndex(
      (item) => item.value === highlightedItemValue,
    );
    return index >= 0 ? index : 0;
  }

  function setHighlightedByIndex(index: number): void {
    if (displayedItems.length === 0) {
      setHighlightedItemValue(null);
      return;
    }
    const nextIndex = clampIndex(index, displayedItems.length);
    setHighlightedItemValue(displayedItems[nextIndex]?.value ?? null);
  }

  function handleAddProject(rawCwd: string): void {
    if (isUnsupportedWindowsProjectPath(rawCwd.trim())) {
      setStatusMessage('Windows-style paths are only supported on Windows.');
      return;
    }

    if (
      isExplicitRelativeProjectPath(rawCwd.trim()) &&
      !currentProjectCwdForBrowse
    ) {
      setStatusMessage('Relative paths require an active project.');
      return;
    }

    const cwd = resolveProjectPathForDispatch(
      rawCwd,
      currentProjectCwdForBrowse,
    );
    if (cwd.length === 0) {
      return;
    }

    const existing = findProjectByPath(projects, cwd);
    if (existing) {
      openProjectFromSearch(existing);
      onClose();
      return;
    }

    try {
      const project = store.addProject(cwd, inferProjectTitleFromPath(cwd));
      if (!projects.some((existingProject) => existingProject.id === project.id)) {
        (projects as Project[]).push(project);
      }
      onNewThread(project.id);
      onClose();
    } catch (error) {
      setStatusMessage(`Failed to add project: ${errorMessage(error)}`);
    }
  }

  function getDefaultCloneParentPath(): string {
    return '~/';
  }

  function submitAddProjectCloneFlow(destinationPathInput?: string): void {
    if (!addProjectCloneFlow) {
      return;
    }

    if (addProjectCloneFlow.step === 'repository') {
      const rawRepository = query.trim();
      if (rawRepository.length === 0 || isRemoteProjectLookingUp) {
        return;
      }

      setIsRemoteProjectLookingUp(true);
      try {
        const repository = remoteProjectRepositoryInfo(
          addProjectCloneFlow.source,
          rawRepository,
        );
        const remoteUrl =
          repository?.sshUrl ??
          remoteProjectDefaultUrl(addProjectCloneFlow.source, rawRepository);

        setAddProjectCloneFlow({
          step: 'confirm',
          source: addProjectCloneFlow.source,
          repositoryInput: rawRepository,
          repository,
          remoteUrl,
        });
        setHighlightedItemValue(null);
        setQuery(getDefaultCloneParentPath());
        setBrowseGeneration((generation) => generation + 1);
      } catch (error) {
        setStatusMessage(`Repository lookup failed: ${errorMessage(error)}`);
      } finally {
        setIsRemoteProjectLookingUp(false);
      }
      return;
    }

    const rawDestination = (destinationPathInput ?? query).trim();
    if (rawDestination.length === 0 || isRemoteProjectCloning) {
      return;
    }

    if (isUnsupportedWindowsProjectPath(rawDestination)) {
      setStatusMessage('Windows-style paths are only supported on Windows.');
      return;
    }

    if (
      isExplicitRelativeProjectPath(rawDestination) &&
      !currentProjectCwdForBrowse
    ) {
      setStatusMessage('Relative paths require an active project.');
      return;
    }

    const destinationPath = resolveProjectPathForDispatch(
      rawDestination,
      currentProjectCwdForBrowse,
    );
    if (destinationPath.length === 0) {
      return;
    }

    setIsRemoteProjectCloning(true);
    try {
      const parent = dirname(destinationPath);
      execString(`mkdir -p ${shellQuote(expandTilde(parent))}`);
      const cloneOutput = execString(
        `git clone ${shellQuote(addProjectCloneFlow.remoteUrl)} ${shellQuote(destinationPath)} 2>&1`,
      );
      if (/fatal:|error:/i.test(cloneOutput)) {
        throw new Error(cloneOutput.trim() || 'git clone failed');
      }
      handleAddProject(destinationPath);
    } catch (error) {
      setStatusMessage(`Clone failed: ${errorMessage(error)}`);
    } finally {
      setIsRemoteProjectCloning(false);
    }
  }

  function executeItem(
    item: CommandPaletteActionItem | CommandPaletteSubmenuItem,
  ): void {
    if (item.disabled) {
      return;
    }

    if (item.kind === 'submenu') {
      pushView(item);
      return;
    }

    if (!item.keepOpen) {
      onClose();
    }

    try {
      void item.run();
    } catch (error) {
      setStatusMessage(`Unable to run command: ${errorMessage(error)}`);
    }
  }

  function submitHighlightedItem(): void {
    const item = displayedItems[highlightedIndex()];
    if (item) {
      executeItem(item);
    }
  }

  function handleOpenProjectFromFileManager(): void {
    setIsPickingProjectFolder(true);
    setStatusMessage(
      'Folder picker is unavailable in this runtime. Type a path and press Enter.',
    );
    setIsPickingProjectFolder(false);
  }

  function handleKeyDown(payload: any): void {
    if (isEscapeKey(payload)) {
      onClose();
      return;
    }

    if (isArrowUpKey(payload)) {
      setHighlightedByIndex(highlightedIndex() - 1);
      return;
    }

    if (isArrowDownKey(payload)) {
      setHighlightedByIndex(highlightedIndex() + 1);
      return;
    }

    if (isArrowLeftKey(payload) && isSubmenu && query.length === 0) {
      popView();
      return;
    }

    if (isArrowRightKey(payload)) {
      const item = displayedItems[highlightedIndex()];
      if (item?.kind === 'submenu') {
        pushView(item);
      }
      return;
    }

    if (addProjectCloneFlow?.step === 'repository' && isEnterKey(payload)) {
      submitAddProjectCloneFlow();
      return;
    }

    const shouldSubmitBrowsePath =
      canSubmitBrowsePath &&
      isEnterKey(payload) &&
      (!hasHighlightedBrowseItem || hasPrimaryModifier(payload));

    if (shouldSubmitBrowsePath) {
      if (isCloneDestinationStep) {
        submitAddProjectCloneFlow(resolvedAddProjectPath);
      } else {
        handleAddProject(resolvedAddProjectPath);
      }
      return;
    }

    if (isEnterKey(payload)) {
      submitHighlightedItem();
      return;
    }

    if (isBackspaceKey(payload) && query === '' && isSubmenu) {
      popView();
    }
  }

  const inputPlaceholder =
    remoteProjectInputPlaceholder(addProjectCloneFlow) ??
    getCommandPaletteInputPlaceholder(paletteMode);

  const browseButton =
    isBrowsing ? (
      <InputActionButton
        disabled={
          relativePathNeedsActiveProject ||
          (isCloneDestinationStep && isRemoteProjectPending)
        }
        label={
          isCloneDestinationStep && isRemoteProjectPending
            ? 'Cloning'
            : submitActionLabel
        }
        shortcut={submitShortcutLabel}
        onPress={() => {
          if (relativePathNeedsActiveProject) {
            return;
          }
          if (isCloneDestinationStep) {
            submitAddProjectCloneFlow(resolvedAddProjectPath);
          } else {
            handleAddProject(resolvedAddProjectPath);
          }
        }}
      />
    ) : null;

  const remoteButton =
    addProjectCloneFlow?.step === 'repository' ? (
      <InputActionButton
        disabled={!canSubmitRemoteProjectFlow}
        label={
          isRemoteProjectPending
            ? 'Working'
            : remoteProjectButtonLabel ?? 'Continue'
        }
        shortcut="Enter"
        onPress={() => {
          submitAddProjectCloneFlow();
        }}
      />
    ) : null;

  const emptyStateMessage =
    addProjectCloneFlow?.step === 'repository'
      ? addProjectCloneFlow.source === 'url'
        ? 'Enter a Git clone URL and press Enter to continue.'
        : 'Enter a repository path and press Enter to look it up.'
      : addProjectCloneFlow?.step === 'confirm'
        ? 'Choose a destination path and press Enter to clone.'
        : relativePathNeedsActiveProject
          ? 'Relative paths require an active project.'
          : willCreateProjectPath
            ? 'Press Enter to create this folder and add it as a project.'
            : undefined;

  if (!open) {
    return null;
  }

  return (
    <Box style={S.overlay}>
      <Pressable onPress={onClose}>
        <Box
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
          }}
        />
      </Pressable>

      <Box style={S.panel}>
        <Row style={S.inputShell}>
          {isSubmenu ? (
            <BackButton onPress={popView} />
          ) : isBrowsing ? (
            <PaletteIcon>
              <IconText label="+" />
            </PaletteIcon>
          ) : currentView?.addonIcon ? (
            <PaletteIcon>{currentView.addonIcon}</PaletteIcon>
          ) : null}

          <TextInput
            value={query}
            onChangeText={handleQueryChange}
            onKeyDown={handleKeyDown}
            placeholder={inputPlaceholder}
            style={S.input}
          />

          {remoteButton}
          {browseButton}
        </Row>

        <ScrollView
          style={S.scroll}
          showScrollbar
        >
          <Col>
            {remoteProjectContext ? (
              <RepositoryContextRow
                icon={remoteProjectContext.icon}
                title={remoteProjectContext.title}
                description={remoteProjectContext.description}
              />
            ) : null}

            {statusMessage ? (
              <Box
                style={{
                  marginLeft: 8,
                  marginRight: 8,
                  marginTop: 8,
                  padding: 8,
                  borderRadius: 5,
                  borderWidth: 1,
                  borderColor: C.danger,
                  backgroundColor: '#25161a',
                }}
              >
                <Text
                  style={{
                    color: C.danger,
                    fontFamily: S.mono,
                    fontSize: 11,
                  }}
                >
                  {statusMessage}
                </Text>
              </Box>
            ) : null}

            <CommandPaletteResults
              groups={displayedGroups}
              highlightedItemValue={highlightedItemValue}
              isActionsOnly={isActionsOnly}
              onHighlightedItemValue={setHighlightedItemValue}
              onExecuteItem={executeItem}
              emptyStateMessage={emptyStateMessage}
            />
          </Col>
        </ScrollView>

        <Row style={S.footer}>
          <Row
            style={{
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              flex: 1,
            }}
          >
            <ShortcutHint
              keys={['Up', 'Down']}
              label="Navigate"
            />
            {addProjectCloneFlow?.step === 'repository' ? (
              <ShortcutHint
                keys={['Enter']}
                label={remoteProjectButtonLabel ?? 'Continue'}
              />
            ) : !canSubmitBrowsePath || hasHighlightedBrowseItem ? (
              <ShortcutHint
                keys={['Enter']}
                label="Select"
              />
            ) : null}
            {isSubmenu ? (
              <ShortcutHint
                keys={['Backspace']}
                label="Back"
              />
            ) : null}
            <ShortcutHint
              keys={['Esc']}
              label="Close"
            />
          </Row>

          {isBrowsing ? (
            <FooterFileManagerButton
              label={isPickingProjectFolder ? 'Opening...' : 'Open in Files'}
              disabled={isPickingProjectFolder}
              onPress={handleOpenProjectFromFileManager}
            />
          ) : (
            <Text
              style={{
                color: C.dim,
                fontFamily: S.mono,
                fontSize: 10,
              }}
            >
              {displayedItems.length} items
            </Text>
          )}
        </Row>
      </Box>
    </Box>
  );
}
