import type { GalleryDataReference, JsonObject } from '../../types';

export type GitLaneTone =
  | 'main'
  | 'worker1'
  | 'worker2'
  | 'worker3'
  | 'worker4'
  | 'worker5'
  | 'accent'
  | 'ok'
  | 'warn'
  | 'flag'
  | 'blue'
  | 'lilac'
  | 'neutral';

export type GitActivityMode = 'lanes-detail' | 'compact-list' | 'graph-list';

export type GitLaneSegment = {
  id: string;
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
  tone: GitLaneTone;
  dashed?: boolean;
};

export type GitLanePoint = {
  id: string;
  lane: number;
  row: number;
  tone: GitLaneTone;
  kind: 'commit' | 'merge' | 'branch' | 'focus';
};

export type GitCommitEntry = {
  id: string;
  time: string;
  sha: string;
  message: string;
  worker: string;
  workerTone: GitLaneTone;
  age: string;
  files: number;
  additions: number;
  deletions: number;
  lane: number;
  tone: GitLaneTone;
  displayMessage?: string;
  selected?: boolean;
  alert?: boolean;
  branchLabel?: string;
};

export type GitDiffFile = {
  path: string;
  additions: number;
  deletions: number;
  status: 'modified' | 'added' | 'deleted';
};

export type GitDiffLine = {
  id: string;
  kind: 'hunk' | 'remove' | 'add' | 'context';
  text: string;
  line?: string;
};

export type GitFooterAction = {
  key: string;
  label: string;
};

export type GitActivity = {
  id: string;
  mode: GitActivityMode;
  title: string;
  branch: string;
  workerCount: number;
  focusSha: string;
  focusAge: string;
  live: boolean;
  searchLabel: string;
  resultCount: number;
  totalCount: number;
  refreshEta: string;
  selectedCommitId: string;
  commits: GitCommitEntry[];
  laneSegments: GitLaneSegment[];
  lanePoints: GitLanePoint[];
  diffFiles: GitDiffFile[];
  diffLines: GitDiffLine[];
  footerActions: GitFooterAction[];
};

export const gitActivitySchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'GitActivity',
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'mode',
    'title',
    'branch',
    'workerCount',
    'focusSha',
    'focusAge',
    'live',
    'searchLabel',
    'resultCount',
    'totalCount',
    'refreshEta',
    'selectedCommitId',
    'commits',
    'laneSegments',
    'lanePoints',
    'diffFiles',
    'diffLines',
    'footerActions',
  ],
  properties: {
    id: { type: 'string' },
    mode: { type: 'string', enum: ['lanes-detail', 'compact-list', 'graph-list'] },
    title: { type: 'string' },
    branch: { type: 'string' },
    workerCount: { type: 'number' },
    focusSha: { type: 'string' },
    focusAge: { type: 'string' },
    live: { type: 'boolean' },
    searchLabel: { type: 'string' },
    resultCount: { type: 'number' },
    totalCount: { type: 'number' },
    refreshEta: { type: 'string' },
    selectedCommitId: { type: 'string' },
    commits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'time', 'sha', 'message', 'worker', 'workerTone', 'age', 'files', 'additions', 'deletions', 'lane', 'tone'],
        properties: {
          id: { type: 'string' },
          time: { type: 'string' },
          sha: { type: 'string' },
          message: { type: 'string' },
          worker: { type: 'string' },
          workerTone: { type: 'string' },
          age: { type: 'string' },
          files: { type: 'number' },
          additions: { type: 'number' },
          deletions: { type: 'number' },
          lane: { type: 'number' },
          tone: { type: 'string' },
          displayMessage: { type: 'string' },
          selected: { type: 'boolean' },
          alert: { type: 'boolean' },
          branchLabel: { type: 'string' },
        },
      },
    },
    laneSegments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'fromLane', 'fromRow', 'toLane', 'toRow', 'tone'],
        properties: {
          id: { type: 'string' },
          fromLane: { type: 'number' },
          fromRow: { type: 'number' },
          toLane: { type: 'number' },
          toRow: { type: 'number' },
          tone: { type: 'string' },
          dashed: { type: 'boolean' },
        },
      },
    },
    lanePoints: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'lane', 'row', 'tone', 'kind'],
        properties: {
          id: { type: 'string' },
          lane: { type: 'number' },
          row: { type: 'number' },
          tone: { type: 'string' },
          kind: { type: 'string', enum: ['commit', 'merge', 'branch', 'focus'] },
        },
      },
    },
    diffFiles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'additions', 'deletions', 'status'],
        properties: {
          path: { type: 'string' },
          additions: { type: 'number' },
          deletions: { type: 'number' },
          status: { type: 'string', enum: ['modified', 'added', 'deleted'] },
        },
      },
    },
    diffLines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'kind', 'text'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['hunk', 'remove', 'add', 'context'] },
          text: { type: 'string' },
          line: { type: 'string' },
        },
      },
    },
    footerActions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'label'],
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
        },
      },
    },
  },
};

const baseCommits: GitCommitEntry[] = [
  {
    id: 'b4e2-11',
    time: '14:14',
    sha: 'b4e2-11',
    message: 'hotfix: null-check lease read',
    displayMessage: 'hotfix: null-check lease...',
    worker: 'W·04',
    workerTone: 'ok',
    age: '42S',
    files: 3,
    additions: 4,
    deletions: 1,
    lane: 1,
    tone: 'ok',
  },
  {
    id: 'a39f-d2',
    time: '14:11',
    sha: 'a39f-d2',
    message: 'refactor resolveSession to use lease cache',
    displayMessage: 'refactor resolveSession ·...',
    worker: 'W·04',
    workerTone: 'ok',
    age: '4M',
    files: 3,
    additions: 31,
    deletions: 18,
    lane: 1,
    tone: 'accent',
    selected: true,
  },
  {
    id: 'e1a0-3c',
    time: '14:07',
    sha: 'e1a0-3c',
    message: 'add lease TTL · RAT-3',
    worker: 'W·02',
    workerTone: 'flag',
    age: '8M',
    files: 5,
    additions: 22,
    deletions: 9,
    lane: 2,
    tone: 'flag',
    alert: true,
  },
  {
    id: '7b88-aa',
    time: '14:02',
    sha: '7b88-aa',
    message: 'tidy imports · LEASE_MS',
    displayMessage: 'tidy imports · LEASE_MS ...',
    worker: 'W·02',
    workerTone: 'flag',
    age: '13M',
    files: 2,
    additions: 6,
    deletions: 0,
    lane: 2,
    tone: 'flag',
  },
  {
    id: '8d21-4f',
    time: '13:55',
    sha: '8d21-4f',
    message: 'add metrics hooks to cache path',
    displayMessage: 'add metrics hooks to cac...',
    worker: 'W·04',
    workerTone: 'ok',
    age: '19M',
    files: 2,
    additions: 11,
    deletions: 2,
    lane: 1,
    tone: 'ok',
  },
  {
    id: 'f019-cc',
    time: '14:04',
    sha: 'f019-cc',
    message: 'branch off W·02 fallback cache',
    worker: 'W·05',
    workerTone: 'warn',
    age: '11M',
    files: 1,
    additions: 0,
    deletions: 0,
    lane: 3,
    tone: 'warn',
    branchLabel: 'branch',
  },
  {
    id: 'c202-71',
    time: '13:58',
    sha: 'c202-71',
    message: 'merge W·04 into main',
    worker: 'MAIN',
    workerTone: 'accent',
    age: '16M',
    files: 4,
    additions: 48,
    deletions: 22,
    lane: 0,
    tone: 'accent',
    branchLabel: 'merge',
  },
  {
    id: '2a17-88',
    time: '13:50',
    sha: '2a17-88',
    message: 'fix race in shutdown ordering',
    worker: 'W·03',
    workerTone: 'lilac',
    age: '23M',
    files: 1,
    additions: 8,
    deletions: 4,
    lane: 4,
    tone: 'lilac',
  },
];

const baseSegments: GitLaneSegment[] = [
  { id: 'main-rail', fromLane: 0, fromRow: 0, toLane: 0, toRow: 7, tone: 'accent' },
  { id: 'w04-rail', fromLane: 1, fromRow: 0, toLane: 1, toRow: 7, tone: 'ok' },
  { id: 'w02-rail', fromLane: 2, fromRow: 2, toLane: 2, toRow: 5, tone: 'flag' },
  { id: 'w05-rail', fromLane: 3, fromRow: 3, toLane: 3, toRow: 7, tone: 'warn', dashed: true },
  { id: 'w03-rail', fromLane: 4, fromRow: 5, toLane: 4, toRow: 7, tone: 'lilac' },
  { id: 'merge-link', fromLane: 1, fromRow: 6, toLane: 0, toRow: 6, tone: 'accent' },
  { id: 'branch-link', fromLane: 2, fromRow: 3, toLane: 3, toRow: 4, tone: 'warn' },
];

const basePoints: GitLanePoint[] = [
  { id: 'p-b4e2-11', lane: 1, row: 0, tone: 'ok', kind: 'commit' },
  { id: 'p-a39f-d2', lane: 1, row: 1, tone: 'accent', kind: 'focus' },
  { id: 'p-e1a0-3c', lane: 2, row: 2, tone: 'flag', kind: 'commit' },
  { id: 'p-7b88-aa', lane: 2, row: 3, tone: 'flag', kind: 'commit' },
  { id: 'p-f019-cc', lane: 3, row: 4, tone: 'warn', kind: 'branch' },
  { id: 'p-c202-71', lane: 0, row: 6, tone: 'accent', kind: 'merge' },
  { id: 'p-8d21-4f', lane: 1, row: 6, tone: 'ok', kind: 'commit' },
  { id: 'p-2a17-88', lane: 4, row: 7, tone: 'lilac', kind: 'commit' },
];

const detailSegments: GitLaneSegment[] = [
  { id: 'detail-main-rail', fromLane: 0, fromRow: 0, toLane: 0, toRow: 4, tone: 'accent' },
  { id: 'detail-w04-rail', fromLane: 1, fromRow: 0, toLane: 1, toRow: 4, tone: 'ok' },
  { id: 'detail-w02-rail', fromLane: 2, fromRow: 1, toLane: 2, toRow: 3, tone: 'flag' },
  { id: 'detail-w05-rail', fromLane: 3, fromRow: 2, toLane: 3, toRow: 4, tone: 'warn', dashed: true },
];

const detailPoints: GitLanePoint[] = [
  { id: 'detail-b4e2-11', lane: 1, row: 0, tone: 'ok', kind: 'commit' },
  { id: 'detail-a39f-d2', lane: 1, row: 1, tone: 'accent', kind: 'focus' },
  { id: 'detail-e1a0-3c', lane: 2, row: 2, tone: 'flag', kind: 'commit' },
  { id: 'detail-7b88-aa', lane: 2, row: 3, tone: 'flag', kind: 'commit' },
  { id: 'detail-8d21-4f', lane: 1, row: 4, tone: 'ok', kind: 'commit' },
  { id: 'detail-f019-cc', lane: 3, row: 2, tone: 'warn', kind: 'branch' },
];

const diffFiles: GitDiffFile[] = [
  { path: 'src/auth/session.ts', additions: 22, deletions: 14, status: 'modified' },
  { path: 'src/auth/cache.ts', additions: 7, deletions: 2, status: 'modified' },
  { path: 'src/auth/lease.ts', additions: 2, deletions: 2, status: 'modified' },
];

const diffLines: GitDiffLine[] = [
  { id: 'hunk-1', kind: 'hunk', line: '@@ session.ts · L118', text: '' },
  { id: 'rm-1', kind: 'remove', text: '- const cached = cache.get(token);' },
  { id: 'add-1', kind: 'add', text: '+ const cached = await cache.getWithLease(token);' },
  { id: 'add-2', kind: 'add', text: '+ if (cached?.exp > now + LEASE_MS) return cached;' },
  { id: 'ctx-1', kind: 'context', text: '  const fresh = await db.sessions.find(...);' },
];

const defaultFooter: GitFooterAction[] = [
  { key: '↵', label: 'OPEN DIFF' },
  { key: 'C', label: 'COPY SHA' },
  { key: 'E', label: 'EXPAND' },
];

export const gitActivityMockData: GitActivity[] = [
  {
    id: 'git-lanes-detail',
    mode: 'lanes-detail',
    title: 'GIT · LANES +',
    branch: 'MAIN',
    workerCount: 6,
    focusSha: 'A39F·D2',
    focusAge: '4M',
    live: true,
    searchLabel: 'session',
    resultCount: 7,
    totalCount: 48,
    refreshEta: '4M SINCE FOCUS',
    selectedCommitId: 'a39f-d2',
    commits: baseCommits.slice(0, 5),
    laneSegments: detailSegments,
    lanePoints: detailPoints,
    diffFiles,
    diffLines,
    footerActions: defaultFooter,
  },
  {
    id: 'git-compact-list',
    mode: 'compact-list',
    title: 'GIT · LIST',
    branch: 'MAIN',
    workerCount: 6,
    focusSha: '48 RECENT',
    focusAge: 'LIVE',
    live: true,
    searchLabel: 'filter...',
    resultCount: 48,
    totalCount: 128,
    refreshEta: 'SCROLL 48+',
    selectedCommitId: 'a39f-d2',
    commits: [
      baseCommits[0],
      baseCommits[1],
      baseCommits[2],
      baseCommits[3],
      baseCommits[4],
      baseCommits[5],
      baseCommits[6],
      baseCommits[7],
    ],
    laneSegments: baseSegments,
    lanePoints: basePoints,
    diffFiles,
    diffLines,
    footerActions: [
      { key: '/', label: 'FILTER' },
      { key: 'G', label: 'GRAPH VIEW' },
    ],
  },
  {
    id: 'git-graph-list',
    mode: 'graph-list',
    title: 'GIT · LANES',
    branch: 'MAIN',
    workerCount: 6,
    focusSha: '48 AHEAD',
    focusAge: 'WORKERS',
    live: true,
    searchLabel: 'search sha · message · worker · file...',
    resultCount: 48,
    totalCount: 128,
    refreshEta: 'NEXT REFRESH · 1.8S',
    selectedCommitId: 'a39f-d2',
    commits: baseCommits,
    laneSegments: baseSegments,
    lanePoints: basePoints,
    diffFiles,
    diffLines,
    footerActions: [
      { key: '/', label: 'SEARCH' },
      { key: 'J', label: '/' },
      { key: 'K', label: 'NAV' },
      { key: '↵', label: 'EXPAND' },
    ],
  },
];

export const gitActivityReferences: GalleryDataReference[] = [];
