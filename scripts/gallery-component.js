// scripts/gallery-component.js — v8cli version of scripts/gallery-component.
//
// Generates a gallery component/data pair and registers the story in:
//   cart/app/gallery/stories/index.ts
//
// Usage:
//   scripts/gallery-component <Name> [component-or-data-file] [--format component|data|theme] [--kind atom|top-level] [--group "Group Name"] [--tags "header,button"] [--composed-of "pathA,pathB"] [--storage "sqlite-document,json-file"] [--template assistant-event|worker-quest|...]

function normalizeArgv(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    if (raw.length === 0) return [];
    return [raw];
  }
  if (!raw) return [];
  return [String(raw)];
}

const __hostArgv = normalizeArgv(typeof __argv === 'function' ? __argv() : __argv);

function usage() {
  __writeStderr(
    'Usage: scripts/gallery-component <Name> [component-or-data-file] [--format component|data|theme] [--kind atom|top-level] [--group "Group Name"] [--tags "header,button"] [--composed-of "pathA,pathB"] [--storage "sqlite-document,json-file"] [--template assistant-event|worker-quest|...] [--data-shape <existing-data-shape-slug>]\n'
  );
  __exit(1);
}

function die(msg) {
  __writeStderr('[gallery-component] ' + msg + '\n');
  __exit(1);
}

function fail(message) {
  __writeStderr('[gallery-component] ' + message + '\n');
  __exit(1);
}

function normalizePath(value) {
  if (!value) return '.';
  const absolute = value.startsWith('/');
  const parts = [];
  const segments = value.split('/');
  for (const part of segments) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (absolute) return '/' + parts.join('/');
  return parts.join('/');
}

function joinPath(...parts) {
  const flat = [];
  for (const p of parts) {
    if (!p) continue;
    flat.push(p);
  }
  return normalizePath(flat.join('/'));
}

function splitPath(value) {
  const normalized = normalizePath(value);
  if (normalized === '.') return { absolute: false, parts: [] };
  if (normalized === '/') return { absolute: true, parts: [] };
  return {
    absolute: normalized.startsWith('/'),
    parts: normalized.startsWith('/') ? normalized.slice(1).split('/') : normalized.split('/'),
  };
}

function dirname(value) {
  const normalized = normalizePath(value);
  if (normalized === '/') return '/';
  const parts = normalized.split('/');
  if (parts.length === 1) return '.';
  parts.pop();
  if (parts.length === 1 && parts[0] === '') return '/';
  return parts.join('/');
}

function resolve(base, value) {
  if (!value) return normalizePath(base);
  if (value.startsWith('/')) return normalizePath(value);
  return normalizePath(joinPath(base, value));
}

function relativePath(from, to) {
  const fromNorm = normalizePath(dirname(from));
  const toNorm = normalizePath(to);
  const fromParts = splitPath(fromNorm).parts;
  const toParts = splitPath(toNorm).parts;
  const a = splitPath(fromNorm).absolute;
  const b = splitPath(toNorm).absolute;
  if (a !== b) return toNorm;
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i += 1;
  const up = new Array(fromParts.length - i).fill('..');
  const down = toParts.slice(i);
  const out = up.concat(down).join('/');
  return out || '.';
}

const scriptPath = __hostArgv[0] || '';
const scriptDir = dirname(normalizePath(scriptPath ? resolve(__cwd(), scriptPath) : joinPath(__cwd(), 'scripts')));
const repoRoot = dirname(scriptDir);
const galleryDir = joinPath(repoRoot, 'cart', 'app', 'gallery');
const storiesDir = joinPath(galleryDir, 'stories');
const storyIndexPath = joinPath(storiesDir, 'index.ts');
const themeSystemsDir = joinPath(galleryDir, 'themes');
const themeIndexPath = joinPath(themeSystemsDir, 'index.ts');
const sharedThemeDir = joinPath(themeSystemsDir, 'shared');
const sharedGlobalThemeTokensPath = joinPath(sharedThemeDir, 'global-theme-tokens.ts');
const VALID_STORAGE = new Set([
  'localstore',
  'sqlite-document',
  'sqlite-table',
  'json-file',
  'atomic-file-to-db',
]);

// ── Shape templates ─────────────────────────────────────────────────────
//
// Normalized data contracts lifted from cart/cockpit/ (the claude-code /
// codex / kimi / local-model reducers share these shapes). When --format
// data is passed and the story name — or --template <name> — matches a
// key below (slug-insensitive, and with a few aliases), the scaffold
// stamps the real schema + mock instead of the {id} placeholder.
//
// Keep in sync with cart/cockpit/index.tsx (reduce*Event, WorkerState,
// WorkerQuest, VariantConfig).

const SHAPE_TEMPLATES = {
  'system-event': {
    pascal: 'SystemEvent',
    schema: `{
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'SystemEvent',
  type: 'object',
  additionalProperties: true,
  required: ['type'],
  properties: {
    type: { const: 'system' },
    model: { type: 'string' },
    session_id: { type: 'string' },
  },
}`,
    mock: `{
  type: 'system',
  model: 'claude-opus-4-7',
  session_id: 'sess_demo_01',
}`,
  },

  'assistant-event': {
    pascal: 'AssistantEvent',
    schema: `{
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'AssistantEvent',
  type: 'object',
  additionalProperties: true,
  required: ['type', 'content'],
  properties: {
    type: { const: 'assistant' },
    text: { type: 'string' },
    content: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'text'],
            properties: {
              type: { const: 'text' },
              text: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'thinking'],
            properties: {
              type: { const: 'thinking' },
              thinking: { type: 'string' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'name'],
            properties: {
              type: { const: 'tool_use' },
              name: { type: 'string' },
              input_json: { type: 'string' },
            },
          },
        ],
      },
    },
  },
}`,
    mock: `{
  type: 'assistant',
  content: [
    { type: 'thinking', thinking: 'Considering the request.' },
    { type: 'text', text: 'Here is what I found.' },
    { type: 'tool_use', name: 'Read', input_json: '{"file_path":"/tmp/x"}' },
  ],
}`,
  },

  'assistant-part-event': {
    pascal: 'AssistantPartEvent',
    schema: `{
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'AssistantPartEvent',
  type: 'object',
  additionalProperties: true,
  required: ['type', 'part_type'],
  properties: {
    type: { const: 'assistant_part' },
    part_type: { type: 'string', enum: ['text', 'thinking'] },
    text: { type: 'string' },
  },
}`,
    mock: `{
  type: 'assistant_part',
  part_type: 'text',
  text: 'streaming token chunk',
}`,
  },

  'turn-begin-event': {
    pascal: 'TurnBeginEvent',
    schema: `{
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'TurnBeginEvent',
  type: 'object',
  additionalProperties: true,
  required: ['type'],
  properties: {
    type: { const: 'turn_begin' },
  },
}`,
    mock: `{
  type: 'turn_begin',
}`,
  },

  'tool-call-event': {
    pascal: 'ToolCallEvent',
    schema: `{
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ToolCallEvent',
  type: 'object',
  additionalProperties: true,
  required: ['type', 'name'],
  properties: {
    type: { const: 'tool_call' },
    name: { type: 'string' },
    input_json: { type: 'string' },
  },
}`,
    mock: `{
  type: 'tool_call',
  name: 'Bash',
  input_json: '{"command":"ls"}',
}`,
  },

  'tool-result-event': {
    pascal: 'ToolResultEvent',
    schema: `{
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ToolResultEvent',
  type: 'object',
  additionalProperties: true,
  required: ['type'],
  properties: {
    type: { const: 'tool_result' },
    text: { type: 'string' },
    is_error: { type: 'boolean' },
  },
}`,
    mock: `{
  type: 'tool_result',
  text: 'ok',
  is_error: false,
}`,
  },

  'status-event': {
    pascal: 'StatusEvent',
    schema: `{
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'StatusEvent',
  type: 'object',
  additionalProperties: true,
  required: ['type'],
  properties: {
    type: { const: 'status' },
    text: { type: 'string' },
    is_error: { type: 'boolean' },
  },
}`,
    mock: `{
  type: 'status',
  text: 'connected',
  is_error: false,
}`,
  },

  'result-event': {
    pascal: 'ResultEvent',
    schema: `{
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ResultEvent',
  type: 'object',
  additionalProperties: true,
  required: ['type'],
  properties: {
    type: { const: 'result' },
    result: { type: 'string' },
    is_error: { type: 'boolean' },
    total_cost_usd: { type: 'number' },
    session_id: { type: 'string' },
  },
}`,
    mock: `{
  type: 'result',
  result: 'done',
  is_error: false,
  total_cost_usd: 0.0123,
  session_id: 'sess_demo_01',
}`,
  },

  'worker-event': {
    pascal: 'WorkerEvent',
    schema: `{
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'WorkerEvent',
  oneOf: [
    { type: 'object', required: ['type'], properties: { type: { const: 'system' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'assistant' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'assistant_part' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'turn_begin' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'tool_call' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'tool_result' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'status' } } },
    { type: 'object', required: ['type'], properties: { type: { const: 'result' } } },
  ],
}`,
    mock: `{
  type: 'assistant_part',
  part_type: 'text',
  text: 'hello from the cockpit',
}`,
  },

  'worker-quest-step': {
    pascal: 'WorkerQuestStep',
    schema: `{
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'WorkerQuestStep',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'text', 'status'],
  properties: {
    id: { type: 'string' },
    text: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'active', 'completed', 'rejected'] },
  },
}`,
    mock: `{
  id: 'inspect',
  text: 'Inspect current files and runtime behavior',
  status: 'active',
}`,
  },

  'worker-quest': {
    pascal: 'WorkerQuest',
    schema: `{
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'WorkerQuest',
  type: 'object',
  additionalProperties: false,
  required: ['title', 'steps'],
  properties: {
    title: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'status'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'active', 'completed', 'rejected'] },
        },
      },
    },
  },
}`,
    mock: `{
  title: 'Resolve worker task',
  steps: [
    { id: 'scope', text: 'Capture request and lock task scope', status: 'completed' },
    { id: 'inspect', text: 'Inspect current files and runtime behavior', status: 'active' },
    { id: 'implement', text: 'Apply the worker-side patch', status: 'pending' },
    { id: 'verify', text: 'Verify result and edge cases', status: 'pending' },
    { id: 'resolve', text: 'Mark the task as resolved', status: 'pending' },
  ],
}`,
  },

  'variant-config': {
    pascal: 'VariantConfig',
    schema: `{
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'VariantConfig',
  type: 'object',
  additionalProperties: false,
  required: ['backend', 'model'],
  properties: {
    backend: { type: 'string', enum: ['claude', 'kimi', 'local'] },
    model: { type: 'string' },
  },
}`,
    mock: `{
  backend: 'claude',
  model: 'claude-opus-4-7',
}`,
  },

  'worker-state': {
    pascal: 'WorkerState',
    schema: `{
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'WorkerState',
  type: 'object',
  additionalProperties: true,
  required: ['id', 'label', 'selectedBackend', 'selectedModel'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    gx: { type: 'number' },
    gy: { type: 'number' },
    gw: { type: 'number' },
    gh: { type: 'number' },
    initState: { type: 'number' },
    selectedBackend: { type: 'string', enum: ['claude', 'kimi', 'local'] },
    selectedModel: { type: 'string' },
    activeBackend: { type: 'string' },
    activeModel: { type: 'string' },
    sessionId: { type: 'string' },
    claudeSessionId: { type: 'string' },
    claudeSessionModel: { type: 'string' },
    kimiSessionId: { type: 'string' },
    kimiSessionModel: { type: 'string' },
    localSessionId: { type: 'string' },
    localSessionModel: { type: 'string' },
    turnCount: { type: 'number' },
    turnText: { type: 'string' },
    totalCost: { type: 'number' },
    costText: { type: 'string' },
    isStreaming: { type: 'number' },
    isConnecting: { type: 'boolean' },
    spawnMenuOpen: { type: 'boolean' },
    selectedVariant: { type: 'string' },
    selectedEffort: { type: 'string' },
    selectedContext: { type: 'string' },
    msgCount: { type: 'number' },
    kinds: { type: 'array', items: { type: 'string' } },
    texts: { type: 'array', items: { type: 'string' } },
    activeContentKind: { type: 'string' },
    turnHasAssistantText: { type: 'boolean' },
    quest: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          required: ['title', 'steps'],
          properties: {
            title: { type: 'string' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'text', 'status'],
                properties: {
                  id: { type: 'string' },
                  text: { type: 'string' },
                  status: { type: 'string', enum: ['pending', 'active', 'completed', 'rejected'] },
                },
              },
            },
          },
        },
      ],
    },
  },
}`,
    mock: `{
  id: 'w1',
  label: 'Worker 1',
  gx: 24, gy: 24, gw: 500, gh: 460,
  initState: 0,
  selectedBackend: 'claude',
  selectedModel: 'claude-opus-4-7',
  activeBackend: 'claude',
  activeModel: 'claude-opus-4-7',
  sessionId: '',
  claudeSessionId: '',
  claudeSessionModel: '',
  kimiSessionId: '',
  kimiSessionModel: '',
  localSessionId: '',
  localSessionModel: '',
  turnCount: 0,
  turnText: '',
  totalCost: 0,
  costText: '',
  isStreaming: 0,
  isConnecting: false,
  spawnMenuOpen: false,
  selectedVariant: 'opus-4-7',
  selectedEffort: '',
  selectedContext: '',
  msgCount: 0,
  kinds: [],
  texts: [],
  activeContentKind: '',
  turnHasAssistantText: false,
  quest: null,
}`,
  },
};

// Aliases — name the shape without the `-event` / `-config` suffix.
const SHAPE_TEMPLATE_ALIASES = {
  'system': 'system-event',
  'assistant': 'assistant-event',
  'assistant-part': 'assistant-part-event',
  'turn-begin': 'turn-begin-event',
  'tool-call': 'tool-call-event',
  'tool-result': 'tool-result-event',
  'status': 'status-event',
  'result': 'result-event',
  'variant': 'variant-config',
  'quest': 'worker-quest',
  'quest-step': 'worker-quest-step',
};

function resolveShapeTemplate(slug) {
  if (!slug) return null;
  const direct = SHAPE_TEMPLATES[slug];
  if (direct) return direct;
  const aliased = SHAPE_TEMPLATE_ALIASES[slug];
  if (aliased && SHAPE_TEMPLATES[aliased]) return SHAPE_TEMPLATES[aliased];
  return null;
}

function toWords(value) {
  return String(value)
    .replace(/\.([^.]+)$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function toPascal(value) {
  const words = toWords(value);
  if (words.length === 0) return '';
  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join('');
}

function toTitle(value) {
  return toWords(value).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ');
}

function toSlug(value) {
  const words = toWords(value);
  if (words.length === 0) return '';
  return words.map((word) => word.toLowerCase()).join('-');
}

function lowerFirst(value) {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

const CANONICAL_GROUPS = [
  { id: 'compositions', title: 'Compositions' },
  { id: 'themes', title: 'Theme Systems' },
  { id: 'motion', title: 'Motion & Effects' },
  { id: 'controls', title: 'Controls & Cards' },
  { id: 'charts', title: 'Charts & Graphs' },
  { id: 'data-shapes', title: 'Data Shapes' },
  { id: 'systems', title: 'Systems & Catalogs' },
];

const CANONICAL_GROUP_BY_KEY = {};
for (const group of CANONICAL_GROUPS) {
  CANONICAL_GROUP_BY_KEY[group.id] = group;
  CANONICAL_GROUP_BY_KEY[toSlug(group.title)] = group;
}

const GROUP_ALIASES = {
  theme: 'themes',
  'theme-system': 'themes',
  'theme-systems': 'themes',
  effect: 'motion',
  effects: 'motion',
  'effect-system': 'motion',
  'effect-systems': 'motion',
  indicators: 'motion',
  'indicators-motion': 'motion',
  controls: 'controls',
  cards: 'controls',
  'cards-tiles': 'controls',
  components: 'controls',
  charts: 'charts',
  graphs: 'charts',
  'charts-data': 'charts',
  data: 'data-shapes',
  systems: 'systems',
  catalogs: 'systems',
};

const CANONICAL_TAGS = [
  'header',
  'footer',
  'button',
  'input',
  'selector',
  'slider',
  'badge',
  'card',
  'panel',
  'chart',
  'graph',
  'table',
  'data',
  'theme',
  'motion',
];

const CANONICAL_TAG_SET = new Set(CANONICAL_TAGS);
const TAG_ORDER = {};
for (let index = 0; index < CANONICAL_TAGS.length; index += 1) {
  TAG_ORDER[CANONICAL_TAGS[index]] = index;
}

const TAG_ALIASES = {
  headers: ['header'],
  buttons: ['button'],
  field: ['input'],
  prompt: ['input'],
  search: ['input'],
  selection: ['selector'],
  segmented: ['selector'],
  choice: ['selector'],
  radio: ['selector'],
  keycap: ['selector'],
  diode: ['selector'],
  pipe: ['selector'],
  stack: ['selector'],
  fader: ['slider'],
  range: ['slider'],
  badges: ['badge'],
  cards: ['card'],
  tile: ['card'],
  tiles: ['card'],
  shell: ['panel'],
  surface: ['panel'],
  telemetry: ['panel'],
  transcript: ['panel'],
  console: ['panel'],
  chat: ['panel'],
  charts: ['chart'],
  heatmap: ['chart'],
  boxplot: ['chart'],
  radar: ['chart'],
  waterfall: ['chart'],
  candlestick: ['chart'],
  pyramid: ['chart'],
  timeline: ['chart'],
  tracking: ['chart'],
  venn: ['chart'],
  polar: ['chart'],
  spline: ['chart'],
  progress: ['chart'],
  fraction: ['chart'],
  network: ['graph'],
  tree: ['graph'],
  spatial: ['graph'],
  diagram: ['graph'],
  'flow-map': ['graph'],
  row: ['table'],
  column: ['table'],
  cell: ['table'],
  hierarchy: ['table'],
  readout: ['table'],
  contract: ['data'],
  'data-shape': ['data'],
  'demo-data': ['data'],
  'raw-event': ['data'],
  adapter: ['data'],
  catalog: ['data'],
  worker: ['data'],
  classifier: ['theme'],
  'theme-system': ['theme'],
  palette: ['theme'],
  token: ['theme'],
  tokens: ['theme'],
  animation: ['motion'],
  hooks: ['motion'],
  effect: ['motion'],
  spinner: ['motion'],
  matrix: ['motion'],
  braille: ['motion'],
  projection: ['motion'],
  simulation: ['motion'],
  easing: ['motion'],
};

function sortCanonicalTags(tags) {
  return [...tags].sort((left, right) => {
    const byOrder = (TAG_ORDER[left] ?? 999) - (TAG_ORDER[right] ?? 999);
    return byOrder !== 0 ? byOrder : left.localeCompare(right);
  });
}

function mapTagAlias(slug) {
  if (!slug) return null;
  if (CANONICAL_TAG_SET.has(slug)) return [slug];
  return TAG_ALIASES[slug] || null;
}

function resolveDefaultGroup(format, kind) {
  if (format === 'data') return CANONICAL_GROUP_BY_KEY['data-shapes'];
  if (format === 'theme') return CANONICAL_GROUP_BY_KEY.themes;
  if (kind === 'top-level') return CANONICAL_GROUP_BY_KEY.compositions;
  return CANONICAL_GROUP_BY_KEY.controls;
}

function resolveCanonicalGroup(raw, format, kind) {
  const fallback = resolveDefaultGroup(format, kind);
  if (!raw) return fallback;

  const slug = toSlug(raw);
  const key = GROUP_ALIASES[slug] || slug;
  const group = CANONICAL_GROUP_BY_KEY[key];
  if (!group) {
    fail(`group must be one of ${CANONICAL_GROUPS.map((entry) => entry.title).join(', ')}, received "${raw}"`);
  }

  return group;
}

function inferCanonicalTags(rawName, group, format) {
  const tags = new Set();
  const hint = toSlug(`${rawName} ${group.title}`);
  const candidates = new Set(toWords(`${rawName} ${group.title}`).map((word) => toSlug(word)));

  for (const token of [
    'header',
    'footer',
    'button',
    'input',
    'prompt',
    'search',
    'selector',
    'segmented',
    'choice',
    'slider',
    'fader',
    'badge',
    'card',
    'tile',
    'panel',
    'surface',
    'shell',
    'chat',
    'console',
    'chart',
    'heatmap',
    'boxplot',
    'radar',
    'waterfall',
    'candlestick',
    'pyramid',
    'timeline',
    'tracking',
    'venn',
    'polar',
    'spline',
    'progress',
    'fraction',
    'graph',
    'network',
    'tree',
    'diagram',
    'flow-map',
    'table',
    'row',
    'column',
    'cell',
    'readout',
    'data',
    'contract',
    'catalog',
    'theme',
    'classifier',
    'token',
    'motion',
    'animation',
    'effect',
    'spinner',
    'matrix',
    'braille',
    'projection',
    'simulation',
    'easing',
  ]) {
    if (hint.includes(token)) candidates.add(token);
  }

  if (format === 'data') tags.add('data');
  if (format === 'theme') tags.add('theme');
  if (group.id === 'motion') tags.add('motion');
  if (group.id === 'charts') tags.add('chart');
  if (group.id === 'data-shapes') tags.add('data');
  if (group.id === 'themes') tags.add('theme');

  for (const candidate of candidates) {
    const mapped = mapTagAlias(candidate);
    if (!mapped) continue;
    for (const tag of mapped) tags.add(tag);
  }

  return sortCanonicalTags(tags);
}

function relativeImport(fromFile, toFile) {
  let rel = relativePath(fromFile, toFile);
  if (rel.endsWith('.tsx')) rel = rel.slice(0, -4);
  else if (rel.endsWith('.ts')) rel = rel.slice(0, -3);
  if (rel.startsWith('.')) return rel;
  return './' + rel;
}

function resolveWritePath(rawPath, fallback, defaultExt) {
  if (!rawPath) return fallback;

  let out = resolve(repoRoot, rawPath);
  if (!/\.(tsx|ts)$/.test(out)) out += defaultExt;
  if (!out.startsWith(repoRoot + '/')) {
    fail('target file must stay inside this repository');
  }
  return out;
}

function resolveComponentPath(componentName, rawPath, slug) {
  return resolveWritePath(rawPath, joinPath(galleryDir, 'components', slug, componentName + '.tsx'), '.tsx');
}

function resolveDataPath(rawPath, slug) {
  return resolveWritePath(rawPath, joinPath(galleryDir, 'data', slug + '.ts'), '.ts');
}

function resolveThemeSystemPath(rawPath, slug, pascalName) {
  return resolveWritePath(rawPath, joinPath(themeSystemsDir, slug, `${pascalName}ThemeSystem.ts`), '.ts');
}

function existsPath(path) {
  return __fs_exists(path) === true;
}

function resolveExistingRepoFile(rawPath) {
  const resolved = resolve(repoRoot, rawPath);
  if (!resolved.startsWith(repoRoot + '/')) {
    fail(`atom path must stay inside this repository: ${rawPath}`);
  }

  const candidates = [resolved];
  if (!/\.(tsx|ts)$/.test(resolved)) {
    candidates.push(`${resolved}.tsx`, `${resolved}.ts`);
  }

  const match = candidates.find((candidate) => existsPath(candidate));
  if (!match) {
    fail(`atom path does not exist: ${rawPath}`);
  }

  const stripped = toRepoRelative(match);
  return stripped;
}

function toRepoRelative(pathValue) {
  const rel = pathValue.startsWith(repoRoot + '/') ? pathValue.slice(repoRoot.length + 1) : pathValue;
  return rel;
}

function jsString(value) {
  return JSON.stringify(String(value));
}

function parseTags(raw) {
  const tags = new Set();
  if (!raw) return [];

  for (const part of raw.split(',')) {
    const slug = toSlug(part);
    if (!slug) continue;
    const mapped = mapTagAlias(slug);
    if (!mapped) {
      fail(`tag must be one of ${CANONICAL_TAGS.join(', ')}, received "${part.trim()}"`);
    }
    for (const tag of mapped) tags.add(tag);
  }

  return sortCanonicalTags(tags);
}

function parseStorage(raw) {
  const entries = raw
    ? [...new Set(raw.split(',').map((part) => part.trim()).filter(Boolean).map(toSlug).filter(Boolean))]
    : [];

  for (const entry of entries) {
    if (!VALID_STORAGE.has(entry)) {
      fail(`storage must be one of ${[...VALID_STORAGE].join(', ')}, received "${entry}"`);
    }
  }

  return entries;
}

// ── Data-shape introspection ────────────────────────────────────────
//
// When scaffolding a component, callers must bind it to an existing
// data shape via --data-shape. We read that shape file, strip
// comments, locate the canonical row type (or fall back to the first
// `export type X = { ... }`), and walk its top-level fields with a
// depth-aware parser so nested object/union/array types do not break
// the field list.
//
// The extracted info is injected into the scaffolded component's
// header as a documentation block — type name, field names + types,
// mock-data export — so the agent populating the component cannot
// hallucinate fields that the underlying shape does not define.

function stripTsComments(source) {
  let out = '';
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let inString = null; // "'", '"', or '`' when inside a string
  while (i < source.length) {
    const c = source[i];
    const c2 = source.substring(i, i + 2);
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += '\n';
      }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (c2 === '*/') {
        inBlock = false;
        i += 2;
      } else {
        if (c === '\n') out += '\n';
        i += 1;
      }
      continue;
    }
    if (inString) {
      if (c === '\\' && i + 1 < source.length) {
        out += c + source[i + 1];
        i += 2;
        continue;
      }
      if (c === inString) inString = null;
      out += c;
      i += 1;
      continue;
    }
    if (c2 === '//') {
      inLine = true;
      i += 2;
      continue;
    }
    if (c2 === '/*') {
      inBlock = true;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      out += c;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function extractTypeBody(source, typeName) {
  const re = new RegExp('export\\s+type\\s+' + typeName + '\\s*=\\s*\\{', 'm');
  const match = source.match(re);
  if (!match || match.index == null) return null;
  let i = match.index + match[0].length - 1; // points at the opening '{'
  let depth = 1;
  const start = i + 1;
  let j = start;
  while (j < source.length && depth > 0) {
    const c = source[j];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    if (depth === 0) break;
    j += 1;
  }
  if (depth !== 0) return null;
  return source.substring(start, j);
}

function findFirstExportedTypeName(source) {
  const m = source.match(/export\s+type\s+([A-Z][A-Za-z0-9_]*)\s*=\s*\{/);
  return m ? m[1] : null;
}

function extractTopLevelFields(body) {
  const fields = [];
  let depth = 0;
  let segStart = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    else if ((c === ';' || c === ',') && depth === 0) {
      const segment = body.substring(segStart, i).trim();
      if (segment) {
        const m = segment.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\?)?\s*:\s*([\s\S]+)$/);
        if (m) {
          fields.push({
            name: m[1],
            optional: !!m[2],
            type: m[3].replace(/\s+/g, ' ').trim(),
          });
        }
      }
      segStart = i + 1;
    }
  }
  const trailing = body.substring(segStart).trim();
  if (trailing) {
    const m = trailing.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(\?)?\s*:\s*([\s\S]+)$/);
    if (m) {
      fields.push({
        name: m[1],
        optional: !!m[2],
        type: m[3].replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return fields;
}

function inspectDataShape(rawShape) {
  const shapeSlug = toSlug(rawShape);
  if (!shapeSlug) {
    fail('--data-shape requires a slug (e.g. --data-shape goal)');
  }
  const shapePath = joinPath(galleryDir, 'data', shapeSlug + '.ts');
  if (!existsPath(shapePath)) {
    fail(
      `data shape not found: ${toRepoRelative(shapePath)} — pass --data-shape <slug> for an existing file in cart/app/gallery/data/`
    );
  }
  const source = __fs_read(shapePath);
  if (typeof source !== 'string') {
    fail(`failed to read ${toRepoRelative(shapePath)}`);
  }
  const stripped = stripTsComments(source);
  const shapePascal = toPascal(shapeSlug);
  const shapeCamel = lowerFirst(shapePascal);
  let typeName = shapePascal;
  let typeBody = extractTypeBody(stripped, shapePascal);
  if (!typeBody) {
    const fallback = findFirstExportedTypeName(stripped);
    if (fallback) {
      typeName = fallback;
      typeBody = extractTypeBody(stripped, fallback);
    }
  }
  const fields = typeBody ? extractTopLevelFields(typeBody) : [];
  const hasMock = stripped.indexOf('export const ' + shapeCamel + 'MockData') !== -1;
  const hasSchema = stripped.indexOf('export const ' + shapeCamel + 'Schema') !== -1;
  const hasReferences = stripped.indexOf('export const ' + shapeCamel + 'References') !== -1;
  return {
    slug: shapeSlug,
    pascal: shapePascal,
    camel: shapeCamel,
    typeName,
    shapePath,
    shapeRelative: toRepoRelative(shapePath),
    mockExport: hasMock ? shapeCamel + 'MockData' : null,
    schemaExport: hasSchema ? shapeCamel + 'Schema' : null,
    referencesExport: hasReferences ? shapeCamel + 'References' : null,
    fields,
    bodyParsed: !!typeBody,
  };
}

function parseArgs(argv) {
  let rawName = '';
  let pathArg = '';
  let groupTitle = '';
  let kind = 'atom';
  let format = 'component';
  let tagsArg = '';
  let composedOfArg = '';
  let storageArg = '';
  let templateArg = '';
  let dataShapeArg = '';

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--group' || arg === '-g') {
      groupTitle = argv[index + 1] || '';
      if (!groupTitle) usage();
      index += 1;
      continue;
    }
    if (arg === '--kind' || arg === '-k') {
      kind = argv[index + 1] || '';
      if (!kind) usage();
      index += 1;
      continue;
    }
    if (arg === '--format' || arg === '--shape') {
      format = argv[index + 1] || '';
      if (!format) usage();
      index += 1;
      continue;
    }
    if (arg === '--tags' || arg === '--tag') {
      tagsArg = argv[index + 1] || '';
      if (!tagsArg) usage();
      index += 1;
      continue;
    }
    if (arg === '--composed-of' || arg === '--atoms') {
      composedOfArg = argv[index + 1] || '';
      if (!composedOfArg) usage();
      index += 1;
      continue;
    }
    if (arg === '--storage') {
      storageArg = argv[index + 1] || '';
      if (!storageArg) usage();
      index += 1;
      continue;
    }
    if (arg === '--template' || arg === '--shape-template') {
      templateArg = argv[index + 1] || '';
      if (!templateArg) usage();
      index += 1;
      continue;
    }
    if (arg === '--data-shape' || arg === '--bind-shape') {
      dataShapeArg = argv[index + 1] || '';
      if (!dataShapeArg) usage();
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      usage();
    }
    if (arg.startsWith('--')) usage();
    if (!rawName) {
      rawName = arg;
      continue;
    }
    if (!pathArg) {
      pathArg = arg;
      continue;
    }
    usage();
  }

  if (!rawName) usage();
  if (format !== 'component' && format !== 'data' && format !== 'theme') {
    fail(`format must be "component", "data", or "theme", received "${format}"`);
  }
  if (kind !== 'atom' && kind !== 'top-level') {
    fail(`kind must be "atom" or "top-level", received "${kind}"`);
  }
  if (format === 'data' && kind !== 'atom') {
    fail('data shapes must use --kind atom');
  }
  if (format === 'theme' && kind !== 'atom') {
    fail('theme systems must use --kind atom');
  }

  const composedOf = composedOfArg
    ? composedOfArg
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map(resolveExistingRepoFile)
    : [];

  if (format === 'component' && kind === 'top-level' && composedOf.length < 2) {
    fail('top-level components require --composed-of with at least two atom file paths');
  }
  if ((format !== 'component' || kind === 'atom') && composedOf.length > 0) {
    fail('only top-level component stories can declare --composed-of');
  }

  const storage = parseStorage(storageArg);
  if (format === 'data' && storage.length === 0) {
    fail('data shapes require --storage so the gallery can show the intended persistence target');
  }
  if ((format === 'component' || format === 'theme') && storage.length > 0) {
    fail(`${format} stories do not accept --storage; use --format data`);
  }

  const effectiveKind = format === 'data' || format === 'theme' ? 'atom' : kind;
  const group = resolveCanonicalGroup(groupTitle, format, effectiveKind);
  const parsedTags = parseTags(tagsArg);
  const inferredTags = inferCanonicalTags(rawName, group, format);
  const tags = sortCanonicalTags(new Set([...parsedTags, ...inferredTags]));

  let template = null;
  if (templateArg) {
    if (format !== 'data') fail('--template only applies to --format data');
    template = resolveShapeTemplate(toSlug(templateArg));
    if (!template) {
      fail(`unknown shape template "${templateArg}" — known: ${Object.keys(SHAPE_TEMPLATES).join(', ')}`);
    }
  }

  let dataShape = null;
  if (format === 'component') {
    if (!dataShapeArg) {
      fail(
        '--data-shape <slug> is required for --format component. Pass an existing data-shape slug from cart/app/gallery/data/ (e.g. --data-shape goal). Components must bind to a real shape — they do not get to invent fields.'
      );
    }
    dataShape = inspectDataShape(dataShapeArg);
  } else if (dataShapeArg) {
    fail(`--data-shape only applies to --format component, received format=${format}`);
  }

  return {
    rawName,
    pathArg,
    format,
    kind: effectiveKind,
    groupId: group.id,
    groupTitle: group.title,
    tags,
    composedOf,
    storage,
    template,
    dataShape,
  };
}

const parsed = parseArgs(__hostArgv);
const rawName = parsed.rawName;
const pathArg = parsed.pathArg;
const format = parsed.format;
const kind = parsed.kind;
const groupId = parsed.groupId;
const groupTitle = parsed.groupTitle;
const tags = parsed.tags;
const composedOf = parsed.composedOf;
const storage = parsed.storage;
const dataShape = parsed.dataShape;
const shapeTemplate = parsed.template || (format === 'data' ? resolveShapeTemplate(toSlug(parsed.rawName)) : null);

const pascalName = toPascal(rawName);
const title = toTitle(rawName);
const slug = toSlug(rawName);
if (!pascalName || !slug || !groupId) usage();

const exportName = lowerFirst(pascalName) + 'Section';
const schemaExportName = lowerFirst(pascalName) + 'Schema';
const mockExportName = lowerFirst(pascalName) + 'MockData';
const referencesExportName = lowerFirst(pascalName) + 'References';
const storyPath = joinPath(storiesDir, `${slug}.story.tsx`);
const themeSystemExportName = lowerFirst(pascalName) + 'ThemeSystem';
const themeVariantExportName = lowerFirst(pascalName) + 'DefaultTheme';
const themeClassifierExportName = lowerFirst(pascalName) + 'ThemeClassifier';
const styleClassifierExportName = lowerFirst(pascalName) + 'StyleClassifier';
const variantClassifierExportName = lowerFirst(pascalName) + 'VariantClassifier';
const breakpointClassifierExportName = lowerFirst(pascalName) + 'BreakpointClassifier';

const targetPath =
  format === 'data'
    ? resolveDataPath(pathArg, slug)
    : format === 'theme'
      ? resolveThemeSystemPath(pathArg, slug, pascalName)
      : resolveComponentPath(pascalName, pathArg, slug);
const targetDisplay = toRepoRelative(targetPath);

const themeDir = dirname(targetPath);
const themeClassifierPath = joinPath(themeDir, 'theme-classifier.ts');
const styleClassifierPath = joinPath(themeDir, 'style-classifier.ts');
const variantClassifierPath = joinPath(themeDir, 'variant-classifier.ts');
const breakpointClassifierPath = joinPath(themeDir, 'breakpoint-classifier.ts');
const themeClassifierDisplay = toRepoRelative(themeClassifierPath);
const styleClassifierDisplay = toRepoRelative(styleClassifierPath);
const variantClassifierDisplay = toRepoRelative(variantClassifierPath);
const breakpointClassifierDisplay = toRepoRelative(breakpointClassifierPath);

if (format === 'component' && kind === 'top-level' && composedOf.includes(targetDisplay)) {
  fail('top-level components cannot list their own source file in --composed-of');
}

if (!__fs_mkdir(storiesDir)) {
  fail(`failed to create ${toRepoRelative(storiesDir)}`);
}
if (!__fs_mkdir(dirname(targetPath))) {
  fail(`failed to create ${toRepoRelative(dirname(targetPath))}`);
}
if (format === 'theme' && !__fs_mkdir(sharedThemeDir)) {
  fail(`failed to create ${toRepoRelative(sharedThemeDir)}`);
}

if (existsPath(storyPath)) {
  fail(`exists: ${toRepoRelative(storyPath)}`);
}

if (existsPath(targetPath)) {
  fail(`exists: ${toRepoRelative(targetPath)}`);
}
if (format === 'theme') {
  for (const path of [themeClassifierPath, styleClassifierPath, variantClassifierPath, breakpointClassifierPath]) {
    if (existsPath(path)) {
      fail(`exists: ${toRepoRelative(path)}`);
    }
  }
}

const tagsBlock = tags.length > 0 ? `      tags: [${tags.map((tag) => jsString(tag)).join(', ')}],\n` : '';

let targetContent = '';
let storyContent = '';
const extraFiles = [];

function pushExtraFile(path, content) {
  extraFiles.push({ path, content });
}

if (format === 'data') {
  const dataImport = relativeImport(storyPath, targetPath);
  const typesImport = relativeImport(targetPath, joinPath(galleryDir, 'types.ts'));
  const storageBlock = storage.map((entry) => jsString(entry)).join(', ');

  const schemaLiteral = shapeTemplate
    ? shapeTemplate.schema
    : `{\n  $schema: 'https://json-schema.org/draft/2020-12/schema',\n  title: ${jsString(pascalName)},\n  type: 'object',\n  additionalProperties: false,\n  required: ['id'],\n  properties: {\n    id: { type: 'string' },\n  },\n}`;
  const mockLiteral = shapeTemplate
    ? shapeTemplate.mock
    : `{\n  id: ${jsString(`${slug}-001`)},\n}`;
  targetContent = `import type { GalleryDataReference, JsonObject } from '${typesImport}';\n\nexport const ${schemaExportName}: JsonObject = ${schemaLiteral};\n\nexport const ${mockExportName} = ${mockLiteral};\n\nexport const ${referencesExportName}: GalleryDataReference[] = [];\n`;

  storyContent = `import { defineGalleryDataStory, defineGallerySection } from '../types';\nimport { ${mockExportName}, ${referencesExportName}, ${schemaExportName} } from '${dataImport}';\n\nexport const ${exportName} = defineGallerySection({\n  id: ${jsString(slug)},\n  title: ${jsString(title)},\n  group: {\n    id: ${jsString(groupId)},\n    title: ${jsString(groupTitle)},\n  },\n  kind: 'atom',\n  stories: [\n    defineGalleryDataStory({\n      id: ${jsString(`${slug}/catalog`)},\n      title: ${jsString(title)},\n      source: ${jsString(targetDisplay)},\n      format: 'data',\n      status: 'draft',\n${tagsBlock}      storage: [${storageBlock}],\n      references: ${referencesExportName},\n      schema: ${schemaExportName},\n      mockData: ${mockExportName},\n    }),\n  ],\n});\n`;
} else if (format === 'theme') {
  const storyThemeImport = relativeImport(storyPath, targetPath);
  const themeSystemImport = relativeImport(targetPath, joinPath(galleryDir, 'theme-system.ts'));
  const sharedGlobalImport = relativeImport(targetPath, sharedGlobalThemeTokensPath);
  const themeClassifierImport = relativeImport(targetPath, themeClassifierPath);
  const styleClassifierImport = relativeImport(targetPath, styleClassifierPath);
  const variantClassifierImport = relativeImport(targetPath, variantClassifierPath);
  const breakpointClassifierImport = relativeImport(targetPath, breakpointClassifierPath);

  if (!existsPath(sharedGlobalThemeTokensPath)) {
    const sharedThemeSystemImport = relativeImport(sharedGlobalThemeTokensPath, joinPath(galleryDir, 'theme-system.ts'));
    pushExtraFile(
      sharedGlobalThemeTokensPath,
      `import { defineThemeTokenCategory } from '${sharedThemeSystemImport}';\n\nexport const sharedGlobalThemeTokens = [\n  defineThemeTokenCategory({\n    id: 'surfaces',\n    title: 'Global Surfaces',\n    tokens: {\n      bg: '#f7f8fb',\n      surface: '#ffffff',\n      panel: '#edf2f7',\n      border: '#c7d0dd',\n    },\n  }),\n  defineThemeTokenCategory({\n    id: 'text',\n    title: 'Global Text',\n    tokens: {\n      text: '#18202f',\n      textMuted: '#657185',\n      textSubtle: '#8d97a6',\n    },\n  }),\n  defineThemeTokenCategory({\n    id: 'accent',\n    title: 'Global Accents',\n    tokens: {\n      accent: '#4f7cff',\n      success: '#4b9b72',\n      warning: '#c48a2c',\n      danger: '#c04f4f',\n    },\n  }),\n  defineThemeTokenCategory({\n    id: 'layout',\n    title: 'Global Layout',\n    tokens: {\n      radiusSm: 4,\n      radiusMd: 8,\n      radiusLg: 12,\n      spaceSm: 8,\n      spaceMd: 12,\n      spaceLg: 20,\n    },\n  }),\n];\n`
    );
  }

  pushExtraFile(
    themeClassifierPath,
    `import { defineThemeClassifierFile, defineThemeTokenCategory, defineThemeVariant } from '${themeSystemImport}';\n\nexport const ${themeClassifierExportName} = defineThemeClassifierFile({\n  kind: 'theme',\n  label: ${jsString(`${title} Theme Classifier`)},\n  source: ${jsString(themeClassifierDisplay)},\n});\n\nexport const ${themeVariantExportName} = defineThemeVariant({\n  id: 'default',\n  title: 'Default',\n  summary: ${jsString(`Local theme overrides for ${title}.`)},\n  tokens: [\n    defineThemeTokenCategory({\n      id: 'surfaces',\n      title: 'Local Surfaces',\n      tokens: {\n        panel: '#111827',\n        panelAlt: '#1f2937',\n        panelActive: '#0f172a',\n      },\n    }),\n    defineThemeTokenCategory({\n      id: 'text',\n      title: 'Local Text',\n      tokens: {\n        text: '#f8fafc',\n        textMuted: '#94a3b8',\n      },\n    }),\n    defineThemeTokenCategory({\n      id: 'component',\n      title: 'Component Tokens',\n      tokens: {\n        focusRing: '#38bdf8',\n        chromeShadow: 'rgba(15, 23, 42, 0.24)',\n      },\n    }),\n  ],\n});\n`
  );

  pushExtraFile(
    styleClassifierPath,
    `import { defineThemeClassifierFile } from '${themeSystemImport}';\n\nexport const ${styleClassifierExportName} = defineThemeClassifierFile({\n  kind: 'style',\n  label: ${jsString(`${title} Style Classifier`)},\n  source: ${jsString(styleClassifierDisplay)},\n});\n`
  );

  pushExtraFile(
    variantClassifierPath,
    `import { defineThemeClassifierFile } from '${themeSystemImport}';\n\nexport const ${variantClassifierExportName} = defineThemeClassifierFile({\n  kind: 'variant',\n  label: ${jsString(`${title} Variant Classifier`)},\n  source: ${jsString(variantClassifierDisplay)},\n});\n`
  );

  pushExtraFile(
    breakpointClassifierPath,
    `import { defineThemeClassifierFile } from '${themeSystemImport}';\n\nexport const ${breakpointClassifierExportName} = defineThemeClassifierFile({\n  kind: 'breakpoint',\n  label: ${jsString(`${title} Breakpoint Classifier`)},\n  source: ${jsString(breakpointClassifierDisplay)},\n});\n`
  );

  targetContent = `import { defineThemeSystem } from '${themeSystemImport}';\nimport { sharedGlobalThemeTokens } from '${sharedGlobalImport}';\nimport { ${themeClassifierExportName}, ${themeVariantExportName} } from '${themeClassifierImport}';\nimport { ${styleClassifierExportName} } from '${styleClassifierImport}';\nimport { ${variantClassifierExportName} } from '${variantClassifierImport}';\nimport { ${breakpointClassifierExportName} } from '${breakpointClassifierImport}';\n\nexport const ${themeSystemExportName} = defineThemeSystem({\n  classifiers: [\n    ${themeClassifierExportName},\n    ${styleClassifierExportName},\n    ${variantClassifierExportName},\n    ${breakpointClassifierExportName},\n  ],\n  globalTokens: sharedGlobalThemeTokens,\n  themes: [${themeVariantExportName}],\n});\n`;

  storyContent = `import { defineGallerySection, defineGalleryThemeStory } from '../types';\nimport { ${themeSystemExportName} } from '${storyThemeImport}';\n\nexport const ${exportName} = defineGallerySection({\n  id: ${jsString(slug)},\n  title: ${jsString(title)},\n  group: {\n    id: ${jsString(groupId)},\n    title: ${jsString(groupTitle)},\n  },\n  kind: 'atom',\n  stories: [\n    defineGalleryThemeStory({\n      id: ${jsString(`${slug}/theme-system`)},\n      title: ${jsString(title)},\n      source: ${jsString(targetDisplay)},\n      format: 'theme',\n      status: 'draft',\n${tagsBlock}      classifiers: ${themeSystemExportName}.classifiers,\n      globalTokens: ${themeSystemExportName}.globalTokens,\n      themes: ${themeSystemExportName}.themes,\n    }),\n  ],\n});\n`;
} else {
  if (!dataShape) {
    fail('internal: component scaffolds require a resolved data-shape');
  }
  const componentImport = relativeImport(storyPath, targetPath);
  const primitiveImport = relativeImport(targetPath, joinPath(repoRoot, 'runtime', 'primitives.tsx'));
  const componentShapeImport = relativeImport(targetPath, dataShape.shapePath);
  const storyShapeImport = relativeImport(storyPath, dataShape.shapePath);
  const composedOfBlock =
    kind === 'top-level'
      ? `  composedOf: [\n${composedOf.map((entry) => `    ${jsString(entry)},`).join('\n')}\n  ],\n`
      : '';

  const fieldLines = dataShape.fields.length > 0
    ? dataShape.fields.map((f) => `//   ${f.name}${f.optional ? '?' : ''}: ${f.type}`).join('\n')
    : '//   (could not parse — open the shape file for the row-type fields)';
  const exportLines = [];
  if (dataShape.mockExport) exportLines.push(`//   ${dataShape.mockExport}: ${dataShape.typeName}[]    — seeded mock rows for stories`);
  if (dataShape.schemaExport) exportLines.push(`//   ${dataShape.schemaExport}: JsonObject    — JSON schema`);
  if (dataShape.referencesExport) exportLines.push(`//   ${dataShape.referencesExport}: GalleryDataReference[]    — cross-shape links`);
  if (exportLines.length === 0) exportLines.push('//   (open the shape file for available exports)');

  const shapeHeader = `// ${pascalName} — gallery component bound to the \`${dataShape.typeName}\` data shape.
//
// Source of truth: ${dataShape.shapeRelative}
//
// Top-level fields on \`${dataShape.typeName}\`:
${fieldLines}
//
// Available exports from the shape file:
${exportLines.join('\n')}
//
// Rules for filling out this component:
//   - DO NOT invent fields. Only consume \`${dataShape.typeName}\` keys
//     listed above. If a field you want is missing, extend the shape
//     file first — never fake it locally.
//   - The story imports \`${dataShape.mockExport || dataShape.camel + 'MockData'}\`
//     and renders against real seeded rows. Do not hand-roll mock
//     props inside the story.
//   - If this component renders a *list* of rows, change the \`row\`
//     prop to \`rows: ${dataShape.typeName}[]\` and update the variant
//     accordingly.

`;

  const mockRef = dataShape.mockExport || `${dataShape.camel}MockData`;
  const sampleAccess = `${mockRef}[0]`;

  targetContent = `${shapeHeader}import { Col, Text } from '${primitiveImport}';
import type { ${dataShape.typeName} } from '${componentShapeImport}';

export type ${pascalName}Props = {
  row: ${dataShape.typeName};
};

export function ${pascalName}({ row }: ${pascalName}Props) {
  return (
    <Col style={{ alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#18202f' }}>${title}</Text>
      <Text style={{ fontSize: 12, color: '#657185' }}>${dataShape.typeName}: {String((row as { id?: unknown }).id ?? '—')}</Text>
    </Col>
  );
}
`;

  storyContent = `import { defineGallerySection, defineGalleryStory } from '../types';
import { ${pascalName} } from '${componentImport}';
import { ${mockRef} } from '${storyShapeImport}';

export const ${exportName} = defineGallerySection({
  id: ${jsString(slug)},
  title: ${jsString(title)},
  group: {
    id: ${jsString(groupId)},
    title: ${jsString(groupTitle)},
  },
  kind: ${jsString(kind)},
${composedOfBlock}  stories: [
    defineGalleryStory({
      id: ${jsString(`${slug}/default`)},
      title: ${jsString(title)},
      source: ${jsString(targetDisplay)},
      status: 'draft',
${tagsBlock}      variants: [
        {
          id: 'default',
          name: 'Default',
          render: () => <${pascalName} row={${sampleAccess}} />,
        },
      ],
    }),
  ],
});
`;
}

if (!__fs_write(targetPath, targetContent)) {
  fail(`failed to write ${targetDisplay}`);
}
for (const file of extraFiles) {
  if (!__fs_write(file.path, file.content)) {
    fail(`failed to write ${toRepoRelative(file.path)}`);
  }
}
if (!__fs_write(storyPath, storyContent)) {
  fail(`failed to write ${toRepoRelative(storyPath)}`);
}

if (!existsPath(storyIndexPath)) {
  if (!__fs_write(
    storyIndexPath,
    `import type { GallerySection } from '../types';\n\n// component-gallery:imports\n\nexport const storySections: GallerySection[] = [\n  // component-gallery:sections\n];\n`
  )) {
    fail(`failed to write ${toRepoRelative(storyIndexPath)}`);
  }
}

const readIndex = __fs_read(storyIndexPath);
if (readIndex === null) {
  fail(`failed to read ${toRepoRelative(storyIndexPath)}`);
}
let indexSource = readIndex;
const importLine = `import { ${exportName} } from '${relativeImport(storyIndexPath, storyPath)}';`;
const sectionLine = `  ${exportName},`;

if (!indexSource.includes(importLine)) {
  indexSource = indexSource.replace('// component-gallery:imports', `${importLine}\n// component-gallery:imports`);
}
if (!indexSource.includes(sectionLine)) {
  indexSource = indexSource.replace('  // component-gallery:sections', `${sectionLine}\n  // component-gallery:sections`);
}

if (!indexSource.includes(importLine) || !indexSource.includes(sectionLine)) {
  fail('missing registry markers in cart/app/gallery/stories/index.ts');
}

if (!__fs_write(storyIndexPath, indexSource)) {
  fail(`failed to write ${toRepoRelative(storyIndexPath)}`);
}

if (format === 'theme') {
  if (!existsPath(themeIndexPath)) {
    if (
      !__fs_write(
        themeIndexPath,
        `import type { ThemeSystemDefinition } from '../theme-system';\n\nexport type RegisteredGalleryThemeSystem = {\n  id: string;\n  title: string;\n  source: string;\n  system: ThemeSystemDefinition;\n};\n\n// component-gallery:theme-imports\n\nexport const galleryThemeSystems: RegisteredGalleryThemeSystem[] = [\n  // component-gallery:theme-systems\n];\n`
      )
    ) {
      fail(`failed to write ${toRepoRelative(themeIndexPath)}`);
    }
  }

  const readThemeIndex = __fs_read(themeIndexPath);
  if (readThemeIndex === null) {
    fail(`failed to read ${toRepoRelative(themeIndexPath)}`);
  }

  let themeIndexSource = readThemeIndex;
  const themeImportLine = `import { ${themeSystemExportName} } from '${relativeImport(themeIndexPath, targetPath)}';`;
  const themeEntryLine = `  { id: ${jsString(slug)}, title: ${jsString(title)}, source: ${jsString(targetDisplay)}, system: ${themeSystemExportName} },`;

  if (!themeIndexSource.includes(themeImportLine)) {
    themeIndexSource = themeIndexSource.replace(
      '// component-gallery:theme-imports',
      `${themeImportLine}\n// component-gallery:theme-imports`
    );
  }
  if (!themeIndexSource.includes(themeEntryLine)) {
    themeIndexSource = themeIndexSource.replace(
      '  // component-gallery:theme-systems',
      `${themeEntryLine}\n  // component-gallery:theme-systems`
    );
  }

  if (!themeIndexSource.includes(themeImportLine) || !themeIndexSource.includes(themeEntryLine)) {
    fail('missing registry markers in cart/app/gallery/themes/index.ts');
  }

  if (!__fs_write(themeIndexPath, themeIndexSource)) {
    fail(`failed to write ${toRepoRelative(themeIndexPath)}`);
  }
}

__writeStdout(`[gallery-component] created ${toRepoRelative(targetPath)}\n`);
for (const file of extraFiles) {
  __writeStdout(`[gallery-component] created ${toRepoRelative(file.path)}\n`);
}
__writeStdout(`[gallery-component] created ${toRepoRelative(storyPath)}\n`);
__writeStdout(`[gallery-component] registered ${exportName}\n`);
if (format === 'theme') {
  __writeStdout(`[gallery-component] registered theme ${themeSystemExportName}\n`);
}
__writeStdout(`[gallery-component] format ${format}\n`);
__writeStdout(`[gallery-component] kind ${kind}\n`);
__writeStdout(`[gallery-component] group ${groupTitle} (${groupId})\n`);
if (tags.length > 0) {
  __writeStdout(`[gallery-component] tags ${tags.join(', ')}\n`);
}
if (storage.length > 0) {
  __writeStdout(`[gallery-component] storage ${storage.join(', ')}\n`);
}
if (format === 'data' && shapeTemplate) {
  __writeStdout(`[gallery-component] shape ${shapeTemplate.pascal}\n`);
}
if (format === 'component' && dataShape) {
  __writeStdout(
    `[gallery-component] data-shape ${dataShape.slug} (type ${dataShape.typeName}, ${dataShape.fields.length} fields${dataShape.bodyParsed ? '' : ', body unparsed — header lists exports only'})\n`
  );
}
if (kind === 'top-level') {
  __writeStdout(`[gallery-component] composed-of ${composedOf.join(', ')}\n`);
}
