// scripts/init.js - scaffold a ReactJIT cart.
//
// Runs via:
//   tools/v8cli scripts/init.js <directory>
//   tools/v8cli scripts/init.js <directory> <template>
//
// No flags by design. The one-argument form creates the basic starter.

const ROOT = __cwd();

const TEMPLATE_NAMES = ['basic', 'routes', 'dashboard', 'taskboard', 'canvas', 'stdlib'];

function die(message, code) {
  __writeStderr('[init] ' + message + '\n');
  __exit(code || 1);
}

function usage() {
  __writeStdout([
    'usage:',
    '  tools/v8cli scripts/init.js <directory>',
    '  tools/v8cli scripts/init.js <directory> <template>',
    '  tools/v8cli scripts/init.js <template> <directory>',
    '',
    'templates:',
    '  ' + TEMPLATE_NAMES.join(', '),
    '',
    'The one-argument form uses the basic template.',
  ].join('\n') + '\n');
}

function normalizePath(path) {
  const absolute = path.startsWith('/');
  const parts = [];
  const input = path.replace(/\\/g, '/').split('/');
  for (let i = 0; i < input.length; i++) {
    const part = input[i];
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') {
        parts.pop();
      } else if (!absolute) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }
  return (absolute ? '/' : '') + parts.join('/');
}

function joinPath(a, b) {
  if (!a) return normalizePath(b);
  if (!b) return normalizePath(a);
  return normalizePath(a.replace(/\/+$/, '') + '/' + b.replace(/^\/+/, ''));
}

function dirname(path) {
  const normalized = normalizePath(path);
  const i = normalized.lastIndexOf('/');
  if (i <= 0) return normalized.startsWith('/') ? '/' : '.';
  return normalized.slice(0, i);
}

function basename(path) {
  const normalized = normalizePath(path);
  const i = normalized.lastIndexOf('/');
  return i === -1 ? normalized : normalized.slice(i + 1);
}

function hasPathSeparator(value) {
  return value.indexOf('/') !== -1 || value.indexOf('\\') !== -1 || value === '.' || value === '..';
}

function resolveTarget(input) {
  if (!input || input.startsWith('-')) die('directory must be a positional argument, not a flag', 2);
  if (!hasPathSeparator(input) && !input.startsWith('/')) {
    return normalizePath(joinPath(ROOT, 'cart/' + input));
  }
  if (input.startsWith('/')) return normalizePath(input);
  return normalizePath(joinPath(ROOT, input));
}

function relativeDir(fromDir, toDir) {
  const from = normalizePath(fromDir).split('/').filter(Boolean);
  const to = normalizePath(toDir).split('/').filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const up = [];
  for (let j = i; j < from.length; j++) up.push('..');
  const down = to.slice(i);
  const rel = up.concat(down).join('/');
  return rel || '.';
}

function importPath(targetDir, runtimeModule) {
  return relativeDir(targetDir, joinPath(ROOT, 'runtime')) + '/' + runtimeModule;
}

function displayPath(path) {
  return path.startsWith(ROOT + '/') ? path.slice(ROOT.length + 1) : path;
}

function cartNameFor(targetDir) {
  return basename(targetDir).replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

function parseArgs(argv) {
  if (argv.length === 0) {
    usage();
    __exit(2);
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) die('flags are not supported by init', 2);
  }
  if (argv.length === 1) return { directory: argv[0], template: 'basic' };
  if (argv.length === 2) {
    const a = argv[0];
    const b = argv[1];
    const aIsTemplate = TEMPLATE_NAMES.indexOf(a) !== -1;
    const bIsTemplate = TEMPLATE_NAMES.indexOf(b) !== -1;
    if (aIsTemplate && !bIsTemplate) return { directory: b, template: a };
    if (bIsTemplate && !aIsTemplate) return { directory: a, template: b };
    if (bIsTemplate) return { directory: a, template: b };
    die('unknown template: ' + b, 2);
  }
  die('too many positional arguments', 2);
}

function manifest(name, description, width, height) {
  return JSON.stringify({
    name,
    description,
    customChrome: true,
    width,
    height,
  }, null, 2) + '\n';
}

function readme(ctx, templateName) {
  const editList = templateName === 'basic'
    ? [
      '- `index.tsx` is the cart entry point.',
      '- `cart.json` controls the host window metadata.',
    ]
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
  const runLine = ctx.inCart
    ? './scripts/dev ' + ctx.name
    : './scripts/dev <cart-name>';
  const shipLine = ctx.inCart
    ? './scripts/ship ' + ctx.name
    : './scripts/ship <cart-name>';
  return [
    '# ' + ctx.title,
    '',
    'This cart was generated by `scripts/init.js`.',
    '',
    'ReactJIT stdlib imports live under `runtime/`. The basic template shows the lowercase JSX intrinsics; richer templates import from the stdlib modules directly and use the classifier/theme system.',
    '',
    'Edit files here:',
    editList.join('\n'),
    '',
    'Run it:',
    '```sh',
    runLine,
    '```',
    '',
    'Ship it:',
    '```sh',
    shipLine,
    '```',
    '',
  ].join('\n');
}

function basicIndex(ctx) {
  return `export default function App() {
  return (
    <router initialPath="/">
      <box style={{ width: '100%', height: '100%', padding: 24, gap: 16, backgroundColor: '#101624' }}>
        <text style={{ fontSize: 24, fontWeight: 'bold', color: '#f8fafc' }}>
          ${ctx.title}
        </text>
        <text style={{ fontSize: 13, color: '#a7b0c0' }}>
          Edit ${displayPath(ctx.targetDir)}/index.tsx to start building. The ReactJIT stdlib lives in runtime/.
        </text>

        <route path="/">
          <box style={{ padding: 16, gap: 8, borderRadius: 10, backgroundColor: '#182235', borderWidth: 1, borderColor: '#2d3a52' }}>
            <text style={{ fontSize: 16, fontWeight: 'bold', color: '#ffffff' }}>Home route</text>
            <text style={{ fontSize: 13, color: '#cbd5e1' }}>
              This starter intentionally uses lowercase &lt;router&gt;, &lt;route&gt;, &lt;box&gt;, and &lt;text&gt;.
            </text>
          </box>
        </route>

        <route fallback>
          <box style={{ padding: 16, borderRadius: 10, backgroundColor: '#1f2937' }}>
            <text style={{ color: '#f8fafc' }}>Route not found.</text>
          </box>
        </route>
      </box>
    </router>
  );
}
`;
}

function themeSource(stdlibTheme) {
  return `import type { StylePalette, ThemeColors } from '${stdlibTheme}';

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
  primaryHover: '#6fb4ff',
  primaryPressed: '#2f83df',
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

function styleClsSource(stdlibClassifier) {
  return `import { classifier, classifiers as C } from '${stdlibClassifier}';

classifier({
  AppRoot: {
    type: 'Box',
    style: { width: '100%', height: '100%', backgroundColor: 'theme:bg' },
  },
  AppShell: {
    type: 'Box',
    style: {
      width: '100%',
      height: '100%',
      padding: 'theme:spacingLg',
      gap: 'theme:spacingMd',
      backgroundColor: 'theme:bg',
    },
  },
  AppHeader: {
    type: 'Box',
    style: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 'theme:spacingMd',
    },
  },
  AppTitleBlock: {
    type: 'Box',
    style: { flexDirection: 'column', gap: 3, flexGrow: 1, flexBasis: 0 },
  },
  AppKicker: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:accent' },
  AppTitle: { type: 'Text', fontSize: 'theme:fontLg', color: 'theme:text', fontWeight: 'bold' },
  AppSubtle: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textSecondary' },
  AppDim: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:textDim' },
  AppNav: {
    type: 'Box',
    style: { flexDirection: 'row', alignItems: 'center', gap: 'theme:spacingSm' },
  },
  AppNavItem: {
    type: 'Pressable',
    style: {
      paddingLeft: 12,
      paddingRight: 12,
      paddingTop: 7,
      paddingBottom: 7,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    hoverStyle: { backgroundColor: 'theme:surfaceHover', borderColor: 'theme:borderFocus' },
  },
  AppNavText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:text' },
  AppBody: {
    type: 'Box',
    style: { flexGrow: 1, flexBasis: 0, gap: 'theme:spacingMd' },
  },
  AppRow: {
    type: 'Box',
    style: { flexDirection: 'row', gap: 'theme:spacingMd' },
  },
  AppPanel: {
    type: 'Box',
    style: {
      flexGrow: 1,
      flexBasis: 0,
      padding: 'theme:spacingMd',
      gap: 'theme:spacingSm',
      borderRadius: 'theme:radiusLg',
      backgroundColor: 'theme:surface',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
    bp: {
      sm: { style: { flexBasis: 'auto' } },
    },
  },
  AppPanelTitle: { type: 'Text', fontSize: 'theme:fontMd', color: 'theme:text', fontWeight: 'bold' },
  AppMetric: { type: 'Text', fontSize: 28, color: 'theme:text', fontWeight: 'bold' },
  AppBadge: {
    type: 'Box',
    style: {
      alignSelf: 'flex-start',
      paddingLeft: 8,
      paddingRight: 8,
      paddingTop: 4,
      paddingBottom: 4,
      borderRadius: 'theme:radiusSm',
      backgroundColor: 'theme:bgElevated',
    },
  },
  AppBadgeText: { type: 'Text', fontSize: 'theme:fontSm', color: 'theme:accent' },
  AppTextInput: {
    type: 'TextInput',
    style: {
      height: 36,
      paddingLeft: 10,
      paddingRight: 10,
      borderRadius: 'theme:radiusMd',
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
      color: 'theme:text',
    },
  },
  AppCanvasFrame: {
    type: 'Box',
    style: {
      flexGrow: 1,
      flexBasis: 0,
      overflow: 'hidden',
      borderRadius: 'theme:radiusLg',
      backgroundColor: 'theme:bgAlt',
      borderWidth: 'theme:borderThin',
      borderColor: 'theme:border',
    },
  },
});

export { C };
`;
}

function routesIndex(ctx) {
  return `import { Route, Router, useNavigate } from '${ctx.routerImport}';
import { ThemeProvider } from '${ctx.themeImport}';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';

function Home() {
  return (
    <C.AppBody>
      <C.AppPanel>
        <C.AppPanelTitle>Home</C.AppPanelTitle>
        <C.AppSubtle>This template is a small routed shell using the ReactJIT stdlib router.</C.AppSubtle>
      </C.AppPanel>
    </C.AppBody>
  );
}

function Settings() {
  return (
    <C.AppBody>
      <C.AppPanel>
        <C.AppPanelTitle>Settings</C.AppPanelTitle>
        <C.AppSubtle>Put app-level configuration, persistence, or host hooks here.</C.AppSubtle>
      </C.AppPanel>
    </C.AppBody>
  );
}

function Shell() {
  const nav = useNavigate();
  return (
    <C.AppRoot>
      <C.AppShell>
        <C.AppHeader>
          <C.AppTitleBlock>
            <C.AppKicker>ROUTED CART</C.AppKicker>
            <C.AppTitle>${ctx.title}</C.AppTitle>
            <C.AppSubtle>Edit ${displayPath(ctx.targetDir)}/index.tsx and style.cls.ts.</C.AppSubtle>
          </C.AppTitleBlock>
          <C.AppNav>
            <C.AppNavItem onPress={() => nav.push('/')}><C.AppNavText>Home</C.AppNavText></C.AppNavItem>
            <C.AppNavItem onPress={() => nav.push('/settings')}><C.AppNavText>Settings</C.AppNavText></C.AppNavItem>
          </C.AppNav>
        </C.AppHeader>
        <Route path="/"><Home /></Route>
        <Route path="/settings"><Settings /></Route>
        <Route fallback>
          <C.AppPanel><C.AppPanelTitle>Not found</C.AppPanelTitle></C.AppPanel>
        </Route>
      </C.AppShell>
    </C.AppRoot>
  );
}

export default function App() {
  return (
    <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}>
      <Router initialPath="/">
        <Shell />
      </Router>
    </ThemeProvider>
  );
}
`;
}

function dashboardIndex(ctx) {
  return `import { Route, Router, useNavigate } from '${ctx.routerImport}';
import { ThemeProvider } from '${ctx.themeImport}';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';

const metrics = [
  ['Requests', '12.8k', '+18%'],
  ['Latency', '42ms', '-6%'],
  ['Workers', '9', 'stable'],
];

function Overview() {
  return (
    <C.AppBody>
      <C.AppRow>
        {metrics.map(([label, value, delta]) => (
          <C.AppPanel key={label}>
            <C.AppSubtle>{label}</C.AppSubtle>
            <C.AppMetric>{value}</C.AppMetric>
            <C.AppBadge><C.AppBadgeText>{delta}</C.AppBadgeText></C.AppBadge>
          </C.AppPanel>
        ))}
      </C.AppRow>
      <C.AppPanel>
        <C.AppPanelTitle>Where to edit</C.AppPanelTitle>
        <C.AppSubtle>Build app behavior in index.tsx. Put reusable theme-token styles in style.cls.ts.</C.AppSubtle>
      </C.AppPanel>
    </C.AppBody>
  );
}

function Activity() {
  return (
    <C.AppBody>
      {['Bundled cart', 'Registered theme classifiers', 'Ready for stdlib hooks'].map((item) => (
        <C.AppPanel key={item}>
          <C.AppPanelTitle>{item}</C.AppPanelTitle>
          <C.AppDim>Replace this row with live host data, storage, or route state.</C.AppDim>
        </C.AppPanel>
      ))}
    </C.AppBody>
  );
}

function Shell() {
  const nav = useNavigate();
  return (
    <C.AppRoot>
      <C.AppShell>
        <C.AppHeader>
          <C.AppTitleBlock>
            <C.AppKicker>DASHBOARD</C.AppKicker>
            <C.AppTitle>${ctx.title}</C.AppTitle>
            <C.AppSubtle>Classifier styles are theme-tokenized through the ReactJIT stdlib.</C.AppSubtle>
          </C.AppTitleBlock>
          <C.AppNav>
            <C.AppNavItem onPress={() => nav.push('/')}><C.AppNavText>Overview</C.AppNavText></C.AppNavItem>
            <C.AppNavItem onPress={() => nav.push('/activity')}><C.AppNavText>Activity</C.AppNavText></C.AppNavItem>
          </C.AppNav>
        </C.AppHeader>
        <Route path="/"><Overview /></Route>
        <Route path="/activity"><Activity /></Route>
      </C.AppShell>
    </C.AppRoot>
  );
}

export default function App() {
  return (
    <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}>
      <Router initialPath="/">
        <Shell />
      </Router>
    </ThemeProvider>
  );
}
`;
}

function taskboardIndex(ctx) {
  return `import React from 'react';
import { ThemeProvider } from '${ctx.themeImport}';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';

const initialTasks = ['Wire up host data', 'Tune classifier tokens', 'Ship the cart'];

export default function App() {
  const [tasks, setTasks] = React.useState(initialTasks);
  const [draft, setDraft] = React.useState('');
  const addTask = () => {
    const text = draft.trim();
    if (!text) return;
    setTasks((items) => items.concat(text));
    setDraft('');
  };

  return (
    <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}>
      <C.AppRoot>
        <C.AppShell>
          <C.AppHeader>
            <C.AppTitleBlock>
              <C.AppKicker>TASKBOARD</C.AppKicker>
              <C.AppTitle>${ctx.title}</C.AppTitle>
              <C.AppSubtle>Edit index.tsx for behavior and style.cls.ts for theme-token components.</C.AppSubtle>
            </C.AppTitleBlock>
            <C.AppBadge><C.AppBadgeText>{tasks.length} tasks</C.AppBadgeText></C.AppBadge>
          </C.AppHeader>

          <C.AppRow>
            <C.AppPanel>
              <C.AppPanelTitle>Add task</C.AppPanelTitle>
              <C.AppTextInput value={draft} onChange={setDraft} placeholder="New task" />
              <C.AppNavItem onPress={addTask}><C.AppNavText>Add</C.AppNavText></C.AppNavItem>
            </C.AppPanel>
            <C.AppPanel>
              <C.AppPanelTitle>Queue</C.AppPanelTitle>
              {tasks.map((task, index) => (
                <C.AppBadge key={task + index}><C.AppBadgeText>{index + 1}. {task}</C.AppBadgeText></C.AppBadge>
              ))}
            </C.AppPanel>
          </C.AppRow>
        </C.AppShell>
      </C.AppRoot>
    </ThemeProvider>
  );
}
`;
}

function canvasIndex(ctx) {
  return `import { Canvas } from '${ctx.primitivesImport}';
import { ThemeProvider } from '${ctx.themeImport}';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';

const nodes = [
  { id: 'plan', x: 40, y: 40, label: 'Plan', color: '#4ea1ff' },
  { id: 'build', x: 280, y: 120, label: 'Build', color: '#72d391' },
  { id: 'ship', x: 520, y: 40, label: 'Ship', color: '#ffd166' },
];

export default function App() {
  return (
    <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}>
      <C.AppRoot>
        <C.AppShell>
          <C.AppHeader>
            <C.AppTitleBlock>
              <C.AppKicker>CANVAS</C.AppKicker>
              <C.AppTitle>${ctx.title}</C.AppTitle>
              <C.AppSubtle>Canvas is a ReactJIT stdlib primitive; panels and labels use classifier tokens.</C.AppSubtle>
            </C.AppTitleBlock>
          </C.AppHeader>

          <C.AppCanvasFrame>
            <Canvas style={{ width: '100%', height: '100%' }} viewX={0} viewY={0} viewZoom={1}>
              <Canvas.Path d="M 136 82 C 220 40 252 154 280 162" stroke="#4ea1ff" strokeWidth={2} fill="none" />
              <Canvas.Path d="M 376 162 C 450 184 500 74 520 82" stroke="#72d391" strokeWidth={2} fill="none" />
              {nodes.map((node) => (
                <Canvas.Node key={node.id} gx={node.x} gy={node.y} gw={96} gh={84}>
                  <C.AppPanel style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                    <C.AppBadge style={{ backgroundColor: node.color }}><C.AppBadgeText style={{ color: '#0b1117' }}>{node.label}</C.AppBadgeText></C.AppBadge>
                  </C.AppPanel>
                </Canvas.Node>
              ))}
            </Canvas>
          </C.AppCanvasFrame>
        </C.AppShell>
      </C.AppRoot>
    </ThemeProvider>
  );
}
`;
}

function stdlibIndex(ctx) {
  return `import { Canvas, Graph } from '${ctx.primitivesImport}';
import { Icon } from '${ctx.iconImport}';
import { Activity, Boxes, ChartLine, Film, Waypoints } from '${ctx.iconPackImport}';
import { ThemeProvider } from '${ctx.themeImport}';
import './style.cls';
import { C } from './style.cls';
import { APP_COLORS, APP_STYLES } from './theme';

const iconRows = [
  { label: 'Activity', icon: Activity },
  { label: 'Boxes', icon: Boxes },
  { label: 'Chart', icon: ChartLine },
  { label: 'Video', icon: Film },
  { label: 'Graph', icon: Waypoints },
];

export default function App() {
  return (
    <ThemeProvider colors={APP_COLORS} styles={APP_STYLES}>
      <C.AppRoot>
        <C.AppShell>
          <C.AppHeader>
            <C.AppTitleBlock>
              <C.AppKicker>REACTJIT STDLIB</C.AppKicker>
              <C.AppTitle>${ctx.title}</C.AppTitle>
              <C.AppSubtle>Base icons, video, canvas, and graph all come from runtime/.</C.AppSubtle>
            </C.AppTitleBlock>
          </C.AppHeader>

          <C.AppRow>
            <C.AppPanel>
              <C.AppPanelTitle>Base icon pack</C.AppPanelTitle>
              <C.AppSubtle>Import only the icons you render so bundles stay small.</C.AppSubtle>
              <C.AppRow style={{ flexWrap: 'wrap' }}>
                {iconRows.map((item) => (
                  <C.AppBadge key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Icon icon={item.icon} size={18} color="#ffd166" />
                    <C.AppBadgeText>{item.label}</C.AppBadgeText>
                  </C.AppBadge>
                ))}
              </C.AppRow>
            </C.AppPanel>

            <C.AppPanel>
              <C.AppPanelTitle>Video primitive</C.AppPanelTitle>
              <C.AppSubtle>Put a file at ./media/sample.mp4 or replace the src.</C.AppSubtle>
              <video src="./media/sample.mp4" style={{ width: '100%', height: 150, backgroundColor: '#05080d', borderRadius: 8 }} />
            </C.AppPanel>
          </C.AppRow>

          <C.AppRow style={{ flexGrow: 1, flexBasis: 0 }}>
            <C.AppPanel>
              <C.AppPanelTitle>Canvas primitive</C.AppPanelTitle>
              <C.AppCanvasFrame>
                <canvas style={{ width: '100%', height: '100%' }} viewX={0} viewY={0} viewZoom={1}>
                  <Canvas.Path d="M 40 120 C 140 20 260 220 360 70" stroke="#4ea1ff" strokeWidth={3} fill="none" />
                  <Canvas.Node gx={52} gy={48} gw={120} gh={72}>
                    <C.AppBadge><C.AppBadgeText>Canvas.Node</C.AppBadgeText></C.AppBadge>
                  </Canvas.Node>
                  <Canvas.Node gx={292} gy={118} gw={120} gh={72}>
                    <C.AppBadge><C.AppBadgeText>Pan and zoom</C.AppBadgeText></C.AppBadge>
                  </Canvas.Node>
                </canvas>
              </C.AppCanvasFrame>
            </C.AppPanel>

            <C.AppPanel>
              <C.AppPanelTitle>Graph primitive</C.AppPanelTitle>
              <C.AppCanvasFrame>
                <graph style={{ width: '100%', height: '100%' }} viewX={0} viewY={0} viewZoom={1}>
                  <Graph.Path d="M -150 60 L -90 -20 L -30 20 L 30 -80 L 90 -10 L 150 -50" stroke="#72d391" strokeWidth={3} fill="none" />
                  <Graph.Path d="M -150 80 L 150 80" stroke="#2e4159" strokeWidth={1} fill="none" />
                  <Graph.Node gx={-90} gy={-20} gw={84} gh={44}>
                    <C.AppBadge><C.AppBadgeText>Graph.Node</C.AppBadgeText></C.AppBadge>
                  </Graph.Node>
                </graph>
              </C.AppCanvasFrame>
            </C.AppPanel>
          </C.AppRow>
        </C.AppShell>
      </C.AppRoot>
    </ThemeProvider>
  );
}
`;
}

function mediaReadme() {
  return [
    '# Media',
    '',
    'Put a video file at `sample.mp4` or update the `<video src>` in `index.tsx`.',
    '',
  ].join('\n');
}

const templates = {
  basic: {
    description: 'Basic ReactJIT starter',
    width: 900,
    height: 640,
    files: (ctx) => ({
      'index.tsx': basicIndex(ctx),
    }),
  },
  routes: {
    description: 'Routed ReactJIT starter with classifier theme styles',
    width: 980,
    height: 680,
    files: (ctx) => ({
      'index.tsx': routesIndex(ctx),
      'theme.ts': themeSource(ctx.themeImport),
      'style.cls.ts': styleClsSource(ctx.classifierImport),
    }),
  },
  dashboard: {
    description: 'Dashboard ReactJIT starter with classifier theme styles',
    width: 1100,
    height: 760,
    files: (ctx) => ({
      'index.tsx': dashboardIndex(ctx),
      'theme.ts': themeSource(ctx.themeImport),
      'style.cls.ts': styleClsSource(ctx.classifierImport),
    }),
  },
  taskboard: {
    description: 'Taskboard ReactJIT starter with classifier theme styles',
    width: 980,
    height: 700,
    files: (ctx) => ({
      'index.tsx': taskboardIndex(ctx),
      'theme.ts': themeSource(ctx.themeImport),
      'style.cls.ts': styleClsSource(ctx.classifierImport),
    }),
  },
  canvas: {
    description: 'Canvas ReactJIT starter with classifier theme styles',
    width: 1120,
    height: 760,
    files: (ctx) => ({
      'index.tsx': canvasIndex(ctx),
      'theme.ts': themeSource(ctx.themeImport),
      'style.cls.ts': styleClsSource(ctx.classifierImport),
    }),
  },
  stdlib: {
    description: 'ReactJIT stdlib starter with base icons and media primitives',
    width: 1180,
    height: 820,
    files: (ctx) => ({
      'index.tsx': stdlibIndex(ctx),
      'theme.ts': themeSource(ctx.themeImport),
      'style.cls.ts': styleClsSource(ctx.classifierImport),
      'media/README.md': mediaReadme(),
    }),
  },
};

const argv = process.argv.slice(1);
const parsed = parseArgs(argv);
const template = templates[parsed.template];
if (!template) die('unknown template: ' + parsed.template, 2);

const targetDir = resolveTarget(parsed.directory);
if (__fs_exists(targetDir)) die('target already exists: ' + displayPath(targetDir), 1);

const name = cartNameFor(targetDir);
const title = name.split(/[-_]+/).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(' ') || name;
const inCart = dirname(targetDir) === joinPath(ROOT, 'cart');
const ctx = {
  targetDir,
  name,
  title,
  inCart,
  themeImport: importPath(targetDir, 'theme'),
  classifierImport: importPath(targetDir, 'classifier'),
  primitivesImport: importPath(targetDir, 'primitives'),
  routerImport: importPath(targetDir, 'router'),
  iconImport: importPath(targetDir, 'icons/Icon'),
  iconPackImport: importPath(targetDir, 'icons/icons'),
};

if (!__fs_mkdir(targetDir)) die('failed to create ' + displayPath(targetDir), 1);

const files = template.files(ctx);
files['cart.json'] = manifest(title, template.description, template.width, template.height);
files['README.md'] = readme(ctx, parsed.template);

const fileNames = Object.keys(files);
for (let i = 0; i < fileNames.length; i++) {
  const fileName = fileNames[i];
  const path = joinPath(targetDir, fileName);
  const parent = dirname(path);
  if (!__fs_exists(parent) && !__fs_mkdir(parent)) die('failed to create ' + displayPath(parent), 1);
  if (!__fs_write(path, files[fileName])) die('failed to write ' + displayPath(path), 1);
}

__writeStdout('[init] created ' + displayPath(targetDir) + '\n');
__writeStdout('[init] template ' + parsed.template + '\n');
if (inCart) {
  __writeStdout('[init] run ./scripts/dev ' + name + '\n');
} else {
  __writeStdout('[init] run ./scripts/dev <cart-name> after moving it under cart/\n');
}
