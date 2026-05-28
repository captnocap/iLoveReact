// cli/commands/init.ts - scaffold a ReactJIT cart.

import { fsExists, fsMkdir, fsWrite } from '../host/fs.ts';
import { err, out } from '../host/log.ts';

const TEMPLATE_NAMES = ['basic', 'routes', 'dashboard', 'taskboard', 'canvas', 'stdlib'] as const;
type TemplateName = typeof TEMPLATE_NAMES[number];

interface ParsedInitArgs {
  directory: string;
  template: TemplateName;
}

interface InitContext {
  targetDir: string;
  name: string;
  title: string;
  inCart: boolean;
  themeImport: string;
  classifierImport: string;
  primitivesImport: string;
  routerImport: string;
  iconImport: string;
  iconPackImport: string;
}

interface Template {
  description: string;
  width: number;
  height: number;
  files: (ctx: InitContext) => Record<string, string>;
}

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (typeof parsed === 'number') return parsed;

  const root = __cwd();
  const template = TEMPLATES[parsed.template];
  const targetDir = resolveTarget(root, parsed.directory);
  if (fsExists(targetDir)) return fail(`target already exists: ${displayPath(root, targetDir)}`, 1);

  const name = cartNameFor(targetDir);
  const title = titleForName(name);
  const inCart = dirname(targetDir) === joinPath(root, 'cart');
  const ctx: InitContext = {
    targetDir,
    name,
    title,
    inCart,
    themeImport: importPath(root, targetDir, 'theme'),
    classifierImport: importPath(root, targetDir, 'classifier'),
    primitivesImport: importPath(root, targetDir, 'primitives'),
    routerImport: importPath(root, targetDir, 'router'),
    iconImport: importPath(root, targetDir, 'icons/Icon'),
    iconPackImport: importPath(root, targetDir, 'icons/icons'),
  };

  try {
    fsMkdir(targetDir);
    const files = template.files(ctx);
    files['cart.json'] = manifest(title, template.description, template.width, template.height);
    files['README.md'] = readme(root, ctx, parsed.template);

    for (const [fileName, content] of Object.entries(files)) {
      const path = joinPath(targetDir, fileName);
      const parent = dirname(path);
      if (!fsExists(parent)) fsMkdir(parent);
      fsWrite(path, content);
    }
  } catch (error) {
    return fail((error as Error).message, 1);
  }

  out(`[init] created ${displayPath(root, targetDir)}`);
  out(`[init] template ${parsed.template}`);
  if (inCart) out(`[init] run ./scripts/dev ${name}`);
  else out('[init] run ./scripts/dev <cart-name> after moving it under cart/');
  return 0;
}

function parseArgs(argv: string[]): ParsedInitArgs | number {
  if (argv.length === 0) {
    usage();
    return 2;
  }
  for (const arg of argv) {
    if (arg.startsWith('-')) return fail('flags are not supported by init', 2);
  }
  if (argv.length === 1) return { directory: argv[0]!, template: 'basic' };
  if (argv.length === 2) {
    const a = argv[0]!;
    const b = argv[1]!;
    const aIsTemplate = isTemplate(a);
    const bIsTemplate = isTemplate(b);
    if (aIsTemplate && !bIsTemplate) return { directory: b, template: a };
    if (bIsTemplate && !aIsTemplate) return { directory: a, template: b };
    if (bIsTemplate) return { directory: a, template: b };
    return fail(`unknown template: ${b}`, 2);
  }
  return fail('too many positional arguments', 2);
}

function usage(): void {
  out([
    'usage:',
    '  tools/v8cli scripts/init.js <directory>',
    '  tools/v8cli scripts/init.js <directory> <template>',
    '  tools/v8cli scripts/init.js <template> <directory>',
    '',
    'templates:',
    `  ${TEMPLATE_NAMES.join(', ')}`,
    '',
    'The one-argument form uses the basic template.',
  ].join('\n'));
}

function fail(message: string, code: number): number {
  err(`[init] ${message}`);
  return code || 1;
}

function normalizePath(path: string): string {
  const absolute = path.startsWith('/');
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
      else if (!absolute) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  return (absolute ? '/' : '') + parts.join('/');
}

function joinPath(a: string, b: string): string {
  if (!a) return normalizePath(b);
  if (!b) return normalizePath(a);
  return normalizePath(a.replace(/\/+$/, '') + '/' + b.replace(/^\/+/, ''));
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return normalized.startsWith('/') ? '/' : '.';
  return normalized.slice(0, index);
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function hasPathSeparator(value: string): boolean {
  return value.includes('/') || value.includes('\\') || value === '.' || value === '..';
}

function resolveTarget(root: string, input: string): string {
  if (!input || input.startsWith('-')) throw new Error('directory must be a positional argument, not a flag');
  if (!hasPathSeparator(input) && !input.startsWith('/')) return normalizePath(joinPath(root, `cart/${input}`));
  if (input.startsWith('/')) return normalizePath(input);
  return normalizePath(joinPath(root, input));
}

function relativeDir(fromDir: string, toDir: string): string {
  const from = normalizePath(fromDir).split('/').filter(Boolean);
  const to = normalizePath(toDir).split('/').filter(Boolean);
  let index = 0;
  while (index < from.length && index < to.length && from[index] === to[index]) index++;
  const up = from.slice(index).map(() => '..');
  const rel = up.concat(to.slice(index)).join('/');
  return rel || '.';
}

function importPath(root: string, targetDir: string, runtimeModule: string): string {
  return `${relativeDir(targetDir, joinPath(root, 'runtime'))}/${runtimeModule}`;
}

function displayPath(root: string, path: string): string {
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

function cartNameFor(targetDir: string): string {
  return basename(targetDir).replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function titleForName(name: string): string {
  return name.split(/[-_]+/).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(' ') || name;
}

function isTemplate(value: string): value is TemplateName {
  return (TEMPLATE_NAMES as readonly string[]).includes(value);
}

function manifest(name: string, description: string, width: number, height: number): string {
  return JSON.stringify({ name, description, customChrome: true, width, height }, null, 2) + '\n';
}

function readme(root: string, ctx: InitContext, templateName: TemplateName): string {
  const editList = templateName === 'basic'
    ? ['- `index.tsx` is the cart entry point.', '- `cart.json` controls the host window metadata.']
    : templateName === 'stdlib'
      ? [
        '- `index.tsx` is the cart entry point and stdlib primitive example.',
        '- `style.cls.ts` registers classifier components with `theme:` tokens.',
        '- `theme.ts` defines the local color and style palette.',
        '- `media/sample.mp4` is the video path used by the generated `<video>` example.',
        '- `cart.json` controls the host window metadata.',
      ]
      : [
        '- `index.tsx` is the cart entry point and app behavior.',
        '- `style.cls.ts` registers classifier components with `theme:` tokens.',
        '- `theme.ts` defines the local color and style palette.',
        '- `cart.json` controls the host window metadata.',
      ];
  return [
    `# ${ctx.title}`,
    '',
    'This cart was generated by `rjit init`.',
    '',
    'ReactJIT stdlib imports live under `runtime/`. The basic template shows the lowercase JSX intrinsics; richer templates import from the stdlib modules directly and use the classifier/theme system.',
    '',
    'Edit files here:',
    editList.join('\n'),
    '',
    'Run it:',
    '```sh',
    ctx.inCart ? `./scripts/dev ${ctx.name}` : './scripts/dev <cart-name>',
    '```',
    '',
    'Ship it:',
    '```sh',
    ctx.inCart ? `./scripts/ship ${ctx.name}` : './scripts/ship <cart-name>',
    '```',
    '',
  ].join('\n');
}

function themeSource(themeImport: string): string {
  return `import type { StylePalette, ThemeColors } from '${themeImport}';

export const APP_COLORS: Partial<ThemeColors> = {
  bg: '#0b1117',
  bgAlt: '#111a24',
  bgElevated: '#162231',
  surface: '#182432',
  surfaceHover: '#213247',
  border: '#2e4159',
  borderFocus: '#4ea1ff',
  text: '#eef5ff',
  textSecondary: '#b6c4d7',
  textDim: '#74849a',
  primary: '#4ea1ff',
  accent: '#ffd166',
  success: '#72d391',
  warning: '#ffb86b',
  error: '#ff6b7a',
  info: '#77d7ff',
};

export const APP_STYLES: Partial<StylePalette> = {
  radiusSm: 4,
  radiusMd: 8,
  radiusLg: 12,
  spacingSm: 8,
  spacingMd: 14,
  spacingLg: 22,
  borderThin: 1,
  borderMedium: 2,
  fontSm: 12,
  fontMd: 14,
  fontLg: 20,
};
`;
}

function styleClsSource(classifierImport: string): string {
  return `import { classifier, classifiers as C } from '${classifierImport}';

classifier({
  AppRoot: { type: 'Box', style: { width: '100%', height: '100%', backgroundColor: 'theme:bg' } },
  AppShell: { type: 'Box', style: { width: '100%', height: '100%', padding: 'theme:spacingLg', gap: 'theme:spacingMd', backgroundColor: 'theme:bg' } },
  AppHeader: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 'theme:spacingMd' } },
  AppTitleBlock: { type: 'Box', style: { flexDirection: 'column', gap: 3, flexGrow: 1, flexBasis: 0 } },
  AppKicker: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:accent' },
  AppTitle: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:text', fontWeight: 'bold' },
  AppSubtle: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textSecondary' },
  AppDim: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textDim' },
  AppNav: { type: 'Box', style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingSm' } },
  AppNavItem: { type: 'Pressable', style: { paddingLeft: 12, paddingRight: 12, paddingTop: 7, paddingBottom: 7, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:surface', borderWidth: 'theme:borderThin', borderColor: 'theme:border' }, hoverStyle: { backgroundColor: 'theme:surfaceHover', borderColor: 'theme:borderFocus' } },
  AppNavText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:text' },
  AppBody: { type: 'Box', style: { flexGrow: 1, flexBasis: 0, gap: 'theme:spacingMd' } },
  AppRow: { type: 'Box', style: { flexDirection: 'row', gap: 'theme:spacingMd' } },
  AppPanel: { type: 'Box', style: { flexGrow: 1, flexBasis: 0, padding: 'theme:spacingMd', gap: 'theme:spacingSm', borderRadius: 'theme:radiusLg', backgroundColor: 'theme:surface', borderWidth: 'theme:borderThin', borderColor: 'theme:border' } },
  AppPanelTitle: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:text', fontWeight: 'bold' },
  AppMetric: { type: 'Text', fontSize: 28, color: 'theme:text', fontWeight: 'bold' },
  AppBadge: { type: 'Box', style: { alignSelf: 'flex-start', paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 'theme:radiusSm', backgroundColor: 'theme:bgElevated' } },
  AppBadgeText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:accent' },
  AppTextInput: { type: 'TextInput', style: { height: 36, paddingLeft: 10, paddingRight: 10, borderRadius: 'theme:radiusMd', backgroundColor: 'theme:bgAlt', borderWidth: 'theme:borderThin', borderColor: 'theme:border', color: 'theme:text' } },
  AppCanvasFrame: { type: 'Box', style: { flexGrow: 1, flexBasis: 0, overflow: 'hidden', borderRadius: 'theme:radiusLg', backgroundColor: 'theme:bgAlt', borderWidth: 'theme:borderThin', borderColor: 'theme:border' } },
});

export { C };
`;
}

function basicIndex(ctx: InitContext): string {
  return `export default function App() {
  return (
    <router initialPath="/">
      <box style={{ width: '100%', height: '100%', padding: 24, gap: 16, backgroundColor: '#101624' }}>
        <text style={{ fontSize: 24, fontWeight: 'bold', color: '#f8fafc' }}>${ctx.title}</text>
        <text style={{ fontSize: 13, color: '#a7b0c0' }}>Edit index.tsx to start building. The ReactJIT stdlib lives in runtime/.</text>
        <route path="/">
          <box style={{ padding: 16, gap: 8, borderRadius: 10, backgroundColor: '#182235', borderWidth: 1, borderColor: '#2d3a52' }}>
            <text style={{ fontSize: 16, fontWeight: 'bold', color: '#ffffff' }}>Home route</text>
            <text style={{ fontSize: 13, color: '#cbd5e1' }}>This starter intentionally uses lowercase router, route, box, and text intrinsics.</text>
          </box>
        </route>
        <route fallback><box style={{ padding: 16, borderRadius: 10, backgroundColor: '#1f2937' }}><text style={{ color: '#f8fafc' }}>Route not found.</text></box></route>
      </box>
    </router>
  );
}
`;
}

function routedIndex(ctx: InitContext, kind: string): string {
  return `import { Route, Router, useNavigate } from '${ctx.routerImport}';
import { ThemeProvider } from '${ctx.themeImport}';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';

function Home() {
  return <C.AppPanel><C.AppPanelTitle>${kind}</C.AppPanelTitle><C.AppSubtle>Edit index.tsx, theme.ts, and style.cls.ts.</C.AppSubtle></C.AppPanel>;
}

function Shell() {
  const nav = useNavigate();
  return (
    <C.AppRoot><C.AppShell>
      <C.AppHeader>
        <C.AppTitleBlock><C.AppKicker>${kind.toUpperCase()}</C.AppKicker><C.AppTitle>${ctx.title}</C.AppTitle><C.AppSubtle>Generated ReactJIT ${kind} starter.</C.AppSubtle></C.AppTitleBlock>
        <C.AppNav><C.AppNavItem onPress={() => nav.push('/')}><C.AppNavText>Home</C.AppNavText></C.AppNavItem></C.AppNav>
      </C.AppHeader>
      <Route path="/"><Home /></Route>
      <Route fallback><C.AppPanel><C.AppPanelTitle>Not found</C.AppPanelTitle></C.AppPanel></Route>
    </C.AppShell></C.AppRoot>
  );
}

export default function App() {
  return <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}><Router initialPath="/"><Shell /></Router></ThemeProvider>;
}
`;
}

function taskboardIndex(ctx: InitContext): string {
  return `import React from 'react';
import { ThemeProvider } from '${ctx.themeImport}';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';

export default function App() {
  const [tasks, setTasks] = React.useState(['Wire up host data', 'Tune classifier tokens', 'Ship the cart']);
  const [draft, setDraft] = React.useState('');
  const addTask = () => { const text = draft.trim(); if (!text) return; setTasks((items) => items.concat(text)); setDraft(''); };
  return <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}><C.AppRoot><C.AppShell><C.AppHeader><C.AppTitleBlock><C.AppKicker>TASKBOARD</C.AppKicker><C.AppTitle>${ctx.title}</C.AppTitle></C.AppTitleBlock></C.AppHeader><C.AppRow><C.AppPanel><C.AppPanelTitle>Add task</C.AppPanelTitle><C.AppTextInput value={draft} onChange={setDraft} placeholder="New task" /><C.AppNavItem onPress={addTask}><C.AppNavText>Add</C.AppNavText></C.AppNavItem></C.AppPanel><C.AppPanel>{tasks.map((task, index) => <C.AppBadge key={task + index}><C.AppBadgeText>{index + 1}. {task}</C.AppBadgeText></C.AppBadge>)}</C.AppPanel></C.AppRow></C.AppShell></C.AppRoot></ThemeProvider>;
}
`;
}

function canvasIndex(ctx: InitContext): string {
  return `import { Canvas } from '${ctx.primitivesImport}';
import { ThemeProvider } from '${ctx.themeImport}';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';

export default function App() {
  return <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}><C.AppRoot><C.AppShell><C.AppHeader><C.AppTitleBlock><C.AppKicker>CANVAS</C.AppKicker><C.AppTitle>${ctx.title}</C.AppTitle></C.AppTitleBlock></C.AppHeader><C.AppCanvasFrame><Canvas style={{ width: '100%', height: '100%' }} viewX={0} viewY={0} viewZoom={1}><Canvas.Path d="M 40 120 C 140 20 260 220 360 70" stroke="#4ea1ff" strokeWidth={3} fill="none" /><Canvas.Node gx={52} gy={48} gw={120} gh={72}><C.AppBadge><C.AppBadgeText>Canvas.Node</C.AppBadgeText></C.AppBadge></Canvas.Node></Canvas></C.AppCanvasFrame></C.AppShell></C.AppRoot></ThemeProvider>;
}
`;
}

function stdlibIndex(ctx: InitContext): string {
  return `import { Canvas, Graph } from '${ctx.primitivesImport}';
import { Icon } from '${ctx.iconImport}';
import { Activity, Boxes, ChartLine, Film, Waypoints } from '${ctx.iconPackImport}';
import { ThemeProvider } from '${ctx.themeImport}';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';

const icons = [Activity, Boxes, ChartLine, Film, Waypoints];

export default function App() {
  return <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}><C.AppRoot><C.AppShell><C.AppHeader><C.AppTitleBlock><C.AppKicker>REACTJIT STDLIB</C.AppKicker><C.AppTitle>${ctx.title}</C.AppTitle></C.AppTitleBlock></C.AppHeader><C.AppRow>{icons.map((icon, index) => <C.AppBadge key={index}><Icon icon={icon} size={18} color="#ffd166" /></C.AppBadge>)}</C.AppRow><C.AppRow style={{ flexGrow: 1, flexBasis: 0 }}><C.AppCanvasFrame><Canvas style={{ width: '100%', height: '100%' }} viewX={0} viewY={0} viewZoom={1}><Canvas.Path d="M 40 120 C 140 20 260 220 360 70" stroke="#4ea1ff" strokeWidth={3} fill="none" /></Canvas></C.AppCanvasFrame><C.AppCanvasFrame><Graph style={{ width: '100%', height: '100%' }} viewX={0} viewY={0} viewZoom={1}><Graph.Path d="M -150 60 L -90 -20 L -30 20 L 30 -80 L 90 -10 L 150 -50" stroke="#72d391" strokeWidth={3} fill="none" /></Graph></C.AppCanvasFrame></C.AppRow></C.AppShell></C.AppRoot></ThemeProvider>;
}
`;
}

function mediaReadme(): string {
  return '# Media\n\nPut a video file at `sample.mp4` or update the `<video src>` in `index.tsx`.\n';
}

const TEMPLATES: Record<TemplateName, Template> = {
  basic: { description: 'Basic ReactJIT starter', width: 900, height: 640, files: (ctx) => ({ 'index.tsx': basicIndex(ctx) }) },
  routes: { description: 'Routed ReactJIT starter with classifier theme styles', width: 980, height: 680, files: (ctx) => ({ 'index.tsx': routedIndex(ctx, 'routed cart'), 'theme.ts': themeSource(ctx.themeImport), 'style.cls.ts': styleClsSource(ctx.classifierImport) }) },
  dashboard: { description: 'Dashboard ReactJIT starter with classifier theme styles', width: 1100, height: 760, files: (ctx) => ({ 'index.tsx': routedIndex(ctx, 'dashboard'), 'theme.ts': themeSource(ctx.themeImport), 'style.cls.ts': styleClsSource(ctx.classifierImport) }) },
  taskboard: { description: 'Taskboard ReactJIT starter with classifier theme styles', width: 980, height: 700, files: (ctx) => ({ 'index.tsx': taskboardIndex(ctx), 'theme.ts': themeSource(ctx.themeImport), 'style.cls.ts': styleClsSource(ctx.classifierImport) }) },
  canvas: { description: 'Canvas ReactJIT starter with classifier theme styles', width: 1120, height: 760, files: (ctx) => ({ 'index.tsx': canvasIndex(ctx), 'theme.ts': themeSource(ctx.themeImport), 'style.cls.ts': styleClsSource(ctx.classifierImport) }) },
  stdlib: { description: 'ReactJIT stdlib starter with base icons and media primitives', width: 1180, height: 820, files: (ctx) => ({ 'index.tsx': stdlibIndex(ctx), 'theme.ts': themeSource(ctx.themeImport), 'style.cls.ts': styleClsSource(ctx.classifierImport), 'media/README.md': mediaReadme() }) },
};
