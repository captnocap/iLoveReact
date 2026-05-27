// reactjit-installer — npm bootstrap TUI.
//
// Sidebar-nav control panel (Welcome · Scan · Install · Done). Hue-
// gradient accents, block-ramp progress bars, status pills using filled
// bg, sectioned content. Built on the gallery's layout idioms so it
// fills any terminal cleanly without fixed widths.

import * as React from 'react';
import { Box, Row, Col, Text, Pressable, ScrollView } from '../../runtime/primitives';
import { Router, Route, Link, useRoute } from '../../runtime/router';
import { subscribeKey } from '../host';
import registry from '../../sdk/dependency-registry.json';

declare const __spawnSync: (bin: string, argsJson: string, stdin: string) => string;
declare const __spawn: (bin: string, argsJson: string) => number;
declare const __childReadLine: (id: number, timeoutMs: number) => string | null;
declare const __fs_read: (path: string) => string;
declare const __fs_write: (path: string, content: string) => void;
declare const __env: (name: string) => string | null;

const palette = {
  bg:      '#0b1020',
  panel:   '#111827',
  card:    '#1e293b',
  rail:    '#0f172a',
  border:  '#334155',
  ink:     '#e5e7eb',
  dim:     '#94a3b8',
  faint:   '#64748b',
  accent:  '#fbbf24',
  good:    '#34d399',
  bad:     '#f87171',
  blue:    '#60a5fa',
  purple:  '#a78bfa',
  pink:    '#f472b6',
};

// ── Release config ─────────────────────────────────────────────────
const REPO_SLUG    = __env('REACTJIT_REPO') || 'captnocap/reactjit';
const RELEASE_REF  = __env('REACTJIT_REF')  || 'distribute';
const TARBALL_URL  = `https://github.com/${REPO_SLUG}/archive/refs/heads/${RELEASE_REF}.tar.gz`;
const SHIP_TARGET  = __env('REACTJIT_CART') || 'install';
const HOME = __env('HOME') || '~';
const INSTALL_ROOT = `${HOME}/.reactjit`;

// ── Registry projection ────────────────────────────────────────────

type Probe = { kind: 'which' | 'pkg-config' | 'ldconfig' | 'env-override' | 'common-paths'; arg: string };
type Dep = {
  id: string;
  label: string;
  hint: { apt?: string; brew?: string; pacman?: string; note?: string };
  probes: Probe[];
};
type DepResult = { dep: Dep; ok: boolean; found: string | null };

function buildDeps(): Dep[] {
  const out: Dep[] = [];
  const tools = (registry as any).cliPayload.tools;
  if (tools.zig) out.push({
    id: 'zig', label: `zig ${tools.zig.version}`,
    hint: { note: 'auto-fetched if missing' },
    probes: [{ kind: 'which', arg: 'zig' }],
  });
  out.push({
    id: 'cc', label: 'cc',
    hint: { apt: 'build-essential', brew: 'xcode-select --install', pacman: 'base-devel' },
    probes: [{ kind: 'which', arg: 'cc' }, { kind: 'which', arg: 'gcc' }, { kind: 'which', arg: 'clang' }],
  });
  out.push({
    id: 'make', label: 'make',
    hint: { apt: 'build-essential', brew: 'xcode-select --install', pacman: 'base-devel' },
    probes: [{ kind: 'which', arg: 'make' }],
  });
  const libs = (registry as any).nativeLibraries;
  for (const [key, raw] of Object.entries(libs) as Array<[string, any]>) {
    if (raw.bundlePolicy === 'never' || raw.bundlePolicy === 'vendored-source') continue;
    if (raw.linkPolicy === 'feature-gated' || raw.linkPolicy === 'engine-v8') continue;
    // Skip vendored Zig packages — they ship in the source tarball at
    // raw.payloadPath, no host probe needed.
    if (raw.kind === 'zig-package' || raw.payloadPath) continue;
    const sysName = (raw.systemNames && raw.systemNames[0]) || key;
    out.push({
      id: key, label: key,
      hint: aptBrewFor(key),
      probes: [
        { kind: 'env-override', arg: key },
        { kind: 'pkg-config', arg: sysName },
        { kind: 'ldconfig', arg: sysName },
        { kind: 'common-paths', arg: sysName },
      ],
    });
  }
  return out;
}
function aptBrewFor(key: string): Dep['hint'] {
  const m: Record<string, Dep['hint']> = {
    sdl3:     { apt: 'libsdl3-dev', brew: 'sdl3', pacman: 'sdl3' },
    freetype: { apt: 'libfreetype-dev', brew: 'freetype', pacman: 'freetype2' },
    luajit:   { apt: 'libluajit-5.1-dev', brew: 'luajit', pacman: 'luajit' },
  };
  return m[key] || { note: `system pkg ${key}` };
}

function spawnSync(bin: string, args: string[]): { code: number; stdout: string; stderr: string } {
  try { return JSON.parse(__spawnSync(bin, JSON.stringify(args), '')); }
  catch { return { code: -1, stdout: '', stderr: '' }; }
}
function probeOne(p: Probe): string | null {
  if (p.kind === 'env-override') {
    // RJIT_PATH_<DEP_ID_UPPER> — user sets this in their shell, we trust
    // it. Replace dashes with underscores for env-var-friendliness:
    // wgpu-native → RJIT_PATH_WGPU_NATIVE.
    const v = __env('RJIT_PATH_' + p.arg.toUpperCase().replace(/-/g, '_'));
    return v ? `override → ${v}` : null;
  }
  if (p.kind === 'which') {
    const r = spawnSync('/usr/bin/env', ['which', p.arg]);
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  }
  if (p.kind === 'pkg-config') {
    const r = spawnSync('/usr/bin/env', ['pkg-config', '--modversion', p.arg]);
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  }
  if (p.kind === 'ldconfig') {
    const r = spawnSync('/usr/bin/env', ['sh', '-c', `ldconfig -p 2>/dev/null | grep -m1 lib${p.arg}`]);
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim().split('=>').pop()!.trim();
    return null;
  }
  if (p.kind === 'common-paths') {
    // Walk standard install roots + LD_LIBRARY_PATH for lib<arg>.{so,a,dylib,so.*}.
    // Catches pkgs installed outside the linker cache (manual builds in
    // /opt, /usr/local, ~/.local, custom prefixes).
    const ld = (__env('LD_LIBRARY_PATH') || '').split(':').filter(Boolean);
    const lib = (__env('LIBRARY_PATH') || '').split(':').filter(Boolean);
    const roots = [
      ...ld,
      ...lib,
      '/usr/local/lib',
      '/usr/lib',
      '/usr/lib/x86_64-linux-gnu',
      '/opt/local/lib',
      `${HOME}/.local/lib`,
      '/opt/homebrew/lib',
    ];
    const exts = ['.so', '.dylib', '.a', '.so.0', '.so.1', '.so.2', '.so.3'];
    const r = spawnSync('/usr/bin/env', ['sh', '-c',
      `for d in ${roots.map(r => `'${r}'`).join(' ')}; do ` +
      `  for ext in ${exts.join(' ')}; do ` +
      `    f="$d/lib${p.arg}$ext"; [ -e "$f" ] && echo "$f" && exit 0; ` +
      `  done; ` +
      `done; exit 1`,
    ]);
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
    return null;
  }
  return null;
}
function probe(dep: Dep): DepResult {
  for (const p of dep.probes) { const f = probeOne(p); if (f) return { dep, ok: true, found: f }; }
  return { dep, ok: false, found: null };
}

function detectShellRc(): string {
  const shell = __env('SHELL') || '';
  if (shell.endsWith('/fish')) return `${HOME}/.config/fish/config.fish`;
  if (shell.endsWith('/zsh'))  return `${HOME}/.zshrc`;
  return `${HOME}/.bashrc`;
}
function pathLine(): string { return `export PATH="${INSTALL_ROOT}/bin:$PATH"  # reactjit`; }
function appendPath(): { ok: boolean; rc: string; msg: string } {
  const rc = detectShellRc();
  let body = '';
  try { body = __fs_read(rc); } catch { body = ''; }
  if (body.includes('# reactjit')) return { ok: true, rc, msg: 'already on PATH' };
  const next = (body.endsWith('\n') ? body : body + '\n') + pathLine() + '\n';
  try { __fs_write(rc, next); return { ok: true, rc, msg: `appended → ${rc}` }; }
  catch (e: any) { return { ok: false, rc, msg: 'write failed: ' + (e?.message || String(e)) }; }
}

// ── Visual helpers ─────────────────────────────────────────────────

function hsv(h: number, s: number, v: number): string {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return '#' + hex(r) + hex(g) + hex(b);
}

function HueBar({ cells = 64, sat = 0.85, val = 0.95, hueStart = 0, hueEnd = 360 }: { cells?: number; sat?: number; val?: number; hueStart?: number; hueEnd?: number }) {
  return (
    <Row style={{ flexWrap: 'wrap' }}>
      {Array.from({ length: cells }).map((_, i) => (
        <Box key={i} style={{ backgroundColor: hsv(hueStart + (i / cells) * (hueEnd - hueStart), sat, val), width: 1, height: 1 }} />
      ))}
    </Row>
  );
}

// Block-ramp progress bar — 8 fractional steps per cell using the
// horizontal eighths range (▏▎▍▌▋▊▉█). 0..1 t.
function ProgressBar({ t, width = 32, color = palette.accent }: { t: number; width?: number; color?: string }) {
  const RAMP = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
  const cells = Math.max(0, Math.min(width, t * width));
  const full = Math.floor(cells);
  const frac = Math.round((cells - full) * 8);
  let bar = '';
  for (let i = 0; i < full; i++) bar += '█';
  if (full < width && frac > 0) bar += RAMP[frac];
  while (bar.length < width) bar += ' ';
  return (
    <Row>
      <Box style={{ backgroundColor: palette.rail, paddingLeft: 1, paddingRight: 1 }}>
        <Text style={{ color }}>{bar}</Text>
      </Box>
      <Box style={{ paddingLeft: 1 }}>
        <Text style={{ color: palette.dim }}>{Math.round(t * 100)}%</Text>
      </Box>
    </Row>
  );
}

function Pill({ children, bg, fg = '#ffffff', bold = true }: { children: any; bg: string; fg?: string; bold?: boolean }) {
  return (
    <Box style={{ backgroundColor: bg, paddingLeft: 1, paddingRight: 1 }}>
      <Text style={{ color: fg, fontWeight: bold ? 'bold' : undefined }}>{children}</Text>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <Col style={{ gap: 0, flexShrink: 1 }}>
      <Row style={{ gap: 1 }}>
        <Text style={{ color: palette.purple, fontWeight: 'bold' }}>▌</Text>
        <Text style={{ color: palette.purple, fontWeight: 'bold' }}>{title}</Text>
      </Row>
      <Box style={{ paddingLeft: 2 }}>
        <Col style={{ gap: 0, flexShrink: 1 }}>{children}</Col>
      </Box>
      <Text> </Text>
    </Col>
  );
}

// ── Pages share top-level state (scan + build) ─────────────────────

type AppState = {
  results: DepResult[] | null;
  scanning: boolean;
  scan: () => void;
  buildPhase: 'idle' | 'fetch' | 'build' | 'done' | 'fail';
  buildLines: string[];
  buildProgress: number;
  startBuild: () => void;
  pathState: { ok: boolean; rc: string; msg: string } | null;
  doAppendPath: () => void;
};

const Ctx = React.createContext<AppState | null>(null);

const HINTS = [
  'reactjit ships React itself — your TSX is real React, no shim.',
  '<Native type="X"/> is the universal escape hatch into the Zig host.',
  'Tailwind classNames work via runtime/tw.ts — full utility coverage.',
  'Canvas + Graph are pan-zoomable. Use gx/gy/gw/gh in graph space.',
  'Layout is real flexbox: flexGrow, gap, alignItems, the lot.',
  'V8 is ~6MB. The "JS engine baggage" myth was Chromium, not V8.',
  '`scripts/ship <cart>` produces a self-extracting binary. One file out.',
];

// ── Root ───────────────────────────────────────────────────────────

const NAV = [
  { path: '/welcome', label: 'welcome', icon: '◆' },
  { path: '/scan',    label: 'scan',    icon: '◇' },
  { path: '/install', label: 'install', icon: '↓' },
  { path: '/done',    label: 'done',    icon: '✓' },
] as const;

export default function App() {
  const [results, setResults] = React.useState<DepResult[] | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [buildPhase, setBuildPhase] = React.useState<AppState['buildPhase']>('idle');
  const [buildLines, setBuildLines] = React.useState<string[]>([]);
  const [buildProgress, setBuildProgress] = React.useState(0);
  const [pathState, setPathState] = React.useState<AppState['pathState']>(null);
  const childRef = React.useRef<number>(-1);

  const deps = React.useMemo(buildDeps, []);

  const scan = (): void => {
    setScanning(true);
    setTimeout(() => { setResults(deps.map(probe)); setScanning(false); }, 0);
  };

  const startBuild = (): void => {
    if (buildPhase === 'fetch' || buildPhase === 'build') return;
    setBuildPhase('fetch');
    setBuildProgress(0.05);
    setBuildLines([`[fetch] ${TARBALL_URL}`]);
    const script = [
      'set -e',
      `mkdir -p "${INSTALL_ROOT}/src" "${INSTALL_ROOT}/bin"`,
      `TGZ="$(mktemp -t rjit-src.XXXXXX.tgz)"`,
      `echo "[fetch] downloading"`,
      `curl --fail --location --progress-bar "${TARBALL_URL}" -o "$TGZ"`,
      `echo "__RJIT_TICK__:0.20"`,
      `echo "[fetch] extracting → ${INSTALL_ROOT}/src"`,
      `tar -xzf "$TGZ" -C "${INSTALL_ROOT}/src" --strip-components=1`,
      `rm -f "$TGZ"`,
      `echo "__RJIT_PHASE__:build"`,
      `echo "__RJIT_TICK__:0.30"`,
      `cd "${INSTALL_ROOT}/src"`,
      `echo "[build] scripts/ship ${SHIP_TARGET}"`,
      `./scripts/ship "${SHIP_TARGET}" 2>&1`,
      `echo "__RJIT_TICK__:0.92"`,
      `echo "[install] copying binary → ${INSTALL_ROOT}/bin/reactjit"`,
      `cp "zig-out/bin/${SHIP_TARGET}" "${INSTALL_ROOT}/bin/reactjit"`,
      `chmod +x "${INSTALL_ROOT}/bin/reactjit"`,
      `echo "__RJIT_OK__"`,
    ].join('\n');
    const id = __spawn('/bin/sh', JSON.stringify(['-c', `( ${script} ) || echo "__RJIT_FAIL__:$?"`]));
    childRef.current = id;
    if (id < 0) { setBuildLines(prev => prev.concat('[spawn] failed')); setBuildPhase('fail'); return; }
    const poll = setInterval(() => {
      while (true) {
        const line = __childReadLine(id, 0);
        if (line === null) return;
        if (line === '') { clearInterval(poll); return; }
        if (line === '__RJIT_OK__') { setBuildLines(p => p.concat('[ok] reactjit installed')); setBuildPhase('done'); setBuildProgress(1); continue; }
        if (line.startsWith('__RJIT_FAIL__:')) { setBuildLines(p => p.concat(`[fail] exit ${line.slice(14)}`)); setBuildPhase('fail'); continue; }
        if (line.startsWith('__RJIT_PHASE__:')) { const next = line.slice(15) as any; if (next === 'build' || next === 'fetch') setBuildPhase(next); continue; }
        if (line.startsWith('__RJIT_TICK__:')) { const v = parseFloat(line.slice(14)); if (!isNaN(v)) setBuildProgress(v); continue; }
        setBuildLines(p => p.concat(line));
      }
    }, 80);
  };

  const doAppendPath = (): void => setPathState(appendPath());

  React.useEffect(() => subscribeKey(k => {
    if (k === 'q' || k === '\x03') process.exit(0);
  }), []);

  const ctx: AppState = {
    results, scanning, scan,
    buildPhase, buildLines, buildProgress, startBuild,
    pathState, doAppendPath,
  };

  return (
    <Ctx.Provider value={ctx}>
      <Router initialPath="/welcome">
        <Box style={{ width: '100%', height: '100%', backgroundColor: palette.bg, color: palette.ink, flexDirection: 'column' }}>
          <Header />
          <Row style={{ flexGrow: 1, flexShrink: 1 }}>
            <Sidebar />
            <ScrollView style={{ flexGrow: 1, flexShrink: 1, paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1 }}>
              <Route path="/welcome">{() => <Welcome />}</Route>
              <Route path="/scan">{() => <ScanPage deps={deps} />}</Route>
              <Route path="/install">{() => <InstallPage />}</Route>
              <Route path="/done">{() => <DonePage />}</Route>
              <Route fallback>{() => <Welcome />}</Route>
            </ScrollView>
          </Row>
          <Footer />
        </Box>
      </Router>
    </Ctx.Provider>
  );
}

function Header() {
  const { buildPhase, scanning, results } = React.useContext(Ctx)!;
  const ok = results !== null && results.every(r => r.ok);
  const status =
    buildPhase === 'fetch' ? { bg: '#1d4ed8', fg: '#ffffff', label: 'fetching' } :
    buildPhase === 'build' ? { bg: '#7c3aed', fg: '#ffffff', label: 'building' } :
    buildPhase === 'done'  ? { bg: '#065f46', fg: '#ffffff', label: 'installed' } :
    buildPhase === 'fail'  ? { bg: '#7f1d1d', fg: '#ffffff', label: 'failed' } :
    scanning               ? { bg: '#1e293b', fg: palette.dim, label: 'scanning' } :
    ok                     ? { bg: '#065f46', fg: '#ffffff', label: 'ready'    } :
                             { bg: palette.panel, fg: palette.dim, label: 'idle' };
  return (
    <Col style={{ flexShrink: 1 }}>
      <Row style={{ backgroundColor: palette.panel, paddingLeft: 1, paddingRight: 1, gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Text style={{ color: palette.blue, fontWeight: 'bold' }}>▲ reactjit</Text>
        <Text style={{ color: palette.faint, italic: true }}>installer · {RELEASE_REF}@HEAD</Text>
        <Box style={{ flexGrow: 1 }}><Text> </Text></Box>
        <Pill bg={status.bg} fg={status.fg}>{status.label}</Pill>
      </Row>
      <HueBar cells={120} sat={0.85} val={0.85} />
    </Col>
  );
}

function Sidebar() {
  const route = useRoute();
  const { results, buildPhase } = React.useContext(Ctx)!;
  const badge = (path: string): string => {
    if (path === '/scan' && results) return results.every(r => r.ok) ? '✓' : '✗';
    if (path === '/install') {
      if (buildPhase === 'done') return '✓';
      if (buildPhase === 'fail') return '✗';
      if (buildPhase === 'fetch' || buildPhase === 'build') return '…';
    }
    return '';
  };
  return (
    <Col style={{ width: 14, borderWidth: 1, borderColor: palette.border, paddingTop: 0, paddingBottom: 0, paddingLeft: 1, paddingRight: 1 }}>
      {NAV.map(item => {
        const active = route.path === item.path;
        const b = badge(item.path);
        return (
          <Link key={item.path} to={item.path}>
            <Box style={{ backgroundColor: active ? palette.card : undefined }}>
              <Row style={{ gap: 1 }}>
                <Text style={{ color: active ? palette.accent : palette.dim, fontWeight: active ? 'bold' : undefined }}>
                  {active ? '›' : ' '}
                </Text>
                <Text style={{ color: active ? palette.accent : palette.dim, fontWeight: active ? 'bold' : undefined }}>
                  {item.icon} {item.label}
                </Text>
                <Box style={{ flexGrow: 1 }}><Text> </Text></Box>
                {b && <Text style={{ color: b === '✓' ? palette.good : b === '✗' ? palette.bad : palette.accent }}>{b}</Text>}
              </Row>
            </Box>
          </Link>
        );
      })}
      <Text> </Text>
      <Text style={{ color: palette.faint }}>──────────</Text>
      <Text style={{ color: palette.faint, italic: true }}>q quit</Text>
      <Text style={{ color: palette.faint, italic: true }}>⌃P pause</Text>
    </Col>
  );
}

function Footer() {
  const route = useRoute();
  return (
    <Row style={{ backgroundColor: palette.panel, paddingLeft: 1, paddingRight: 1, gap: 2, flexWrap: 'wrap' }}>
      <Text style={{ color: palette.faint }}>route</Text>
      <Text style={{ color: palette.accent }}>{route.path}</Text>
      <Text style={{ color: palette.faint }}>·</Text>
      <Text style={{ color: palette.faint, italic: true }}>click any sidebar item to navigate · drag to copy</Text>
    </Row>
  );
}

// ── Welcome ────────────────────────────────────────────────────────

function Welcome() {
  return (
    <Col style={{ gap: 0, flexShrink: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>react. jit. terminal.</Text>
      <Text style={{ color: palette.dim }}>a thin React reconciler over a Zig + V8 + wgpu host.</Text>
      <Text> </Text>
      <Section title="what this installer does">
        <Text style={{ color: palette.ink }}>1. <Text style={{ color: palette.dim }}>scan</Text>     check your host for the build toolchain</Text>
        <Text style={{ color: palette.ink }}>2. <Text style={{ color: palette.dim }}>fetch</Text>    download the pinned source tarball</Text>
        <Text style={{ color: palette.ink }}>3. <Text style={{ color: palette.dim }}>build</Text>    compile the reactjit binary locally</Text>
        <Text style={{ color: palette.ink }}>4. <Text style={{ color: palette.dim }}>install</Text>  drop it on your PATH and you're set</Text>
      </Section>
      <Section title="install layout">
        <Text style={{ color: palette.ink }}>{INSTALL_ROOT}/src       <Text style={{ color: palette.dim }}>pinned source</Text></Text>
        <Text style={{ color: palette.ink }}>{INSTALL_ROOT}/bin       <Text style={{ color: palette.dim }}>reactjit launcher</Text></Text>
      </Section>
      <Section title="next">
        <Row style={{ gap: 1 }}>
          <Link to="/scan">
            <Pill bg="#1d4ed8">› scan host</Pill>
          </Link>
          <Text style={{ color: palette.faint, italic: true }}>or pick any tab in the sidebar</Text>
        </Row>
      </Section>
    </Col>
  );
}

// ── Scan ───────────────────────────────────────────────────────────

function ScanPage({ deps }: { deps: Dep[] }) {
  const { results, scanning, scan } = React.useContext(Ctx)!;
  const missing = results ? results.filter(r => !r.ok) : [];
  const allOk = results !== null && missing.length === 0;
  return (
    <Col style={{ gap: 0, flexShrink: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>required toolchain</Text>
      <Text style={{ color: palette.dim }}>{deps.length} entries · derived from sdk/dependency-registry.json</Text>
      <Text> </Text>

      <Col style={{ gap: 0, flexShrink: 1 }}>
        {deps.map(d => {
          const r = results?.find(x => x.dep.id === d.id);
          const stat = !r ? { bg: palette.panel, fg: palette.dim, mark: '·', label: '—' } :
                        r.ok ? { bg: '#065f46', fg: '#ffffff', mark: '✓', label: 'ok' } :
                               { bg: '#7f1d1d', fg: '#ffffff', mark: '✗', label: 'missing' };
          return (
            <Row key={d.id} style={{ gap: 1, flexWrap: 'wrap' }}>
              <Pill bg={stat.bg} fg={stat.fg}> {stat.mark} </Pill>
              <Text style={{ color: palette.ink, fontWeight: 'bold' }}>{d.label}</Text>
              <Text style={{ color: palette.dim }}>·</Text>
              <Text style={{ color: r?.ok ? palette.good : palette.dim }}>
                {r?.found || (r ? hintLine(d) : 'not scanned')}
              </Text>
            </Row>
          );
        })}
      </Col>
      <Text> </Text>

      <Row style={{ gap: 1, flexWrap: 'wrap' }}>
        <Pressable onPress={scan}>
          <Pill bg={scanning ? palette.panel : '#1d4ed8'}>{scanning ? '⟳ scanning…' : '⟳ scan host'}</Pill>
        </Pressable>
        <Link to="/install">
          <Pill bg={allOk ? '#065f46' : '#7c3aed'}>{allOk ? '↓ continue → install' : '↓ install anyway'}</Pill>
        </Link>
      </Row>

      {missing.length > 0 && (
        <Col style={{ gap: 0, flexShrink: 1 }}>
          <Text> </Text>
          <Text style={{ color: palette.accent, fontWeight: 'bold' }}>some entries weren't auto-detected</Text>
          <Text style={{ color: palette.dim }}>install via your package manager OR point reactjit at an existing copy:</Text>
          <Text> </Text>
          <MissingHints missing={missing} />
          <Text> </Text>
          <Text style={{ color: palette.dim }}>override path per-dep (set in your shell, then re-scan):</Text>
          {missing.map(m => (
            <Text key={m.dep.id} style={{ color: palette.ink }}>
              <Text style={{ color: palette.accent }}>RJIT_PATH_{m.dep.id.toUpperCase().replace(/-/g, '_')}</Text>
              <Text style={{ color: palette.dim }}>=/path/to/lib{m.dep.id}.so</Text>
            </Text>
          ))}
          <Text> </Text>
          <Text style={{ color: palette.faint, italic: true }}>build will fail loudly if a real lib is genuinely missing — no harm in trying.</Text>
        </Col>
      )}
    </Col>
  );
}
function hintLine(d: Dep): string {
  if (d.hint.apt) return `apt: ${d.hint.apt}`;
  if (d.hint.brew) return `brew: ${d.hint.brew}`;
  if (d.hint.note) return d.hint.note;
  return 'not found';
}
function MissingHints({ missing }: { missing: DepResult[] }) {
  const apts  = missing.map(m => m.dep.hint.apt).filter(Boolean).join(' ');
  const brews = missing.map(m => m.dep.hint.brew).filter(Boolean).join(' ');
  return (
    <Col style={{ gap: 0 }}>
      {apts &&  <Text style={{ color: palette.dim }}>debian/ubuntu: <Text style={{ color: palette.ink }}>sudo apt install {apts}</Text></Text>}
      {brews && <Text style={{ color: palette.dim }}>macos:         <Text style={{ color: palette.ink }}>brew install {brews}</Text></Text>}
    </Col>
  );
}

// ── Install (build + log) ─────────────────────────────────────────

function InstallPage() {
  const { buildPhase, buildLines, buildProgress, startBuild, results } = React.useContext(Ctx)!;
  const [hint, setHint] = React.useState(0);
  React.useEffect(() => { const t = setInterval(() => setHint(h => (h + 1) % HINTS.length), 6000); return () => clearInterval(t); }, []);
  const allOk = results !== null && results.every(r => r.ok);
  const phaseInfo: Record<typeof buildPhase, { bg: string; label: string; bar: string }> = {
    idle:  { bg: palette.panel, label: 'not started',  bar: palette.dim },
    fetch: { bg: '#1d4ed8',     label: 'fetching',     bar: palette.blue },
    build: { bg: '#7c3aed',     label: 'building',     bar: palette.purple },
    done:  { bg: '#065f46',     label: 'installed',    bar: palette.good },
    fail:  { bg: '#7f1d1d',     label: 'failed',       bar: palette.bad },
  };
  const pi = phaseInfo[buildPhase];
  const tail = buildLines.slice(-200);
  return (
    <Col style={{ gap: 0, flexShrink: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>fetch · build · install</Text>
      <Text style={{ color: palette.dim }}>git tarball → tar -xz → scripts/ship {SHIP_TARGET} → ~/.reactjit/bin/reactjit</Text>
      <Text> </Text>

      <Row style={{ gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Pill bg={pi.bg}>{pi.label}</Pill>
        <ProgressBar t={buildProgress} width={42} color={pi.bar} />
      </Row>
      <Text> </Text>

      {buildPhase === 'idle' ? (
        <Col style={{ gap: 0, flexShrink: 1 }}>
          {results === null && (
            <Text style={{ color: palette.faint, italic: true }}>tip — run scan first to see what's missing, but install works either way.</Text>
          )}
          {results !== null && !allOk && (
            <Text style={{ color: palette.accent }}>scan flagged {results.filter(r => !r.ok).length} undetected — building anyway is fine if you have them at non-standard paths.</Text>
          )}
          <Text> </Text>
          <Row style={{ gap: 1, flexWrap: 'wrap' }}>
            <Pressable onPress={startBuild}>
              <Pill bg={allOk ? '#065f46' : '#7c3aed'}>↓ start install</Pill>
            </Pressable>
            <Link to="/scan"><Pill bg={palette.panel} fg={palette.dim}>⟳ back to scan</Pill></Link>
          </Row>
        </Col>
      ) : (
        <Col style={{ gap: 0, flexShrink: 1 }}>
          <Row style={{ gap: 1 }}>
            <Text style={{ color: palette.purple, fontWeight: 'bold' }}>▌</Text>
            <Text style={{ color: palette.purple, fontWeight: 'bold' }}>tip · {HINTS[hint]}</Text>
          </Row>
          <Text> </Text>
          <Row style={{ gap: 1 }}>
            <Text style={{ color: palette.purple, fontWeight: 'bold' }}>▌</Text>
            <Text style={{ color: palette.purple, fontWeight: 'bold' }}>build log</Text>
          </Row>
          <Box style={{ paddingLeft: 2 }}>
            <Col style={{ gap: 0, flexShrink: 1 }}>
              {tail.map((l, i) => <LogLine key={i} line={l} />)}
            </Col>
          </Box>
          {buildPhase === 'done' && <Row style={{ gap: 1 }}><Text> </Text><Link to="/done"><Pill bg="#065f46">✓ continue → done</Pill></Link></Row>}
        </Col>
      )}
    </Col>
  );
}
function LogLine({ line }: { line: string }) {
  const meta =
    line.startsWith('[ok')   ? { mark: '✓', color: palette.good } :
    line.startsWith('[fail') ? { mark: '✗', color: palette.bad } :
    line.startsWith('[err')  ? { mark: '✗', color: palette.bad } :
    line.startsWith('[fetch') ? { mark: '↓', color: palette.blue } :
    line.startsWith('[build') ? { mark: '⚙', color: palette.purple } :
    line.startsWith('[install') ? { mark: '→', color: palette.accent } :
                                  { mark: '·', color: palette.dim };
  return (
    <Row style={{ gap: 1 }}>
      <Text style={{ color: meta.color }}>{meta.mark}</Text>
      <Text style={{ color: palette.ink }}>{line}</Text>
    </Row>
  );
}

// ── Done ───────────────────────────────────────────────────────────

function DonePage() {
  const { buildPhase, pathState, doAppendPath } = React.useContext(Ctx)!;
  if (buildPhase !== 'done') {
    return (
      <Col style={{ gap: 0, flexShrink: 1 }}>
        <Text style={{ color: palette.dim }}>not yet — run install first.</Text>
        <Text> </Text>
        <Link to="/install"><Pill bg="#1d4ed8">› go to install</Pill></Link>
      </Col>
    );
  }
  return (
    <Col style={{ gap: 0, flexShrink: 1 }}>
      <HueBar cells={80} sat={0.7} val={0.95} />
      <Text> </Text>
      <Text style={{ color: palette.good, fontWeight: 'bold' }}>✓ reactjit installed</Text>
      <Text style={{ color: palette.dim }}>{INSTALL_ROOT}/bin/reactjit</Text>
      <Text> </Text>

      <Section title="add to PATH?">
        <Text style={{ color: palette.dim }}>line to append → <Text style={{ color: palette.ink }}>{pathLine()}</Text></Text>
        <Text> </Text>
        <Row style={{ gap: 1, flexWrap: 'wrap' }}>
          <Pressable onPress={doAppendPath}>
            <Pill bg="#065f46">yes — add to PATH</Pill>
          </Pressable>
          <Pressable onPress={() => process.exit(0)}>
            <Pill bg={palette.panel} fg={palette.dim}>skip</Pill>
          </Pressable>
        </Row>
        {pathState && (
          <Row style={{ gap: 1 }}>
            <Text> </Text>
            <Pill bg={pathState.ok ? '#065f46' : '#7f1d1d'}>{pathState.msg}</Pill>
          </Row>
        )}
      </Section>

      <Section title="next">
        <Text style={{ color: palette.ink }}>reactjit init my-app       <Text style={{ color: palette.dim }}>scaffold a new cart</Text></Text>
        <Text style={{ color: palette.ink }}>reactjit ship my-app       <Text style={{ color: palette.dim }}>build → self-extracting binary</Text></Text>
        <Text style={{ color: palette.ink }}>reactjit dev my-app        <Text style={{ color: palette.dim }}>hot-reload dev host</Text></Text>
      </Section>

      <Row style={{ gap: 1 }}>
        <Pressable onPress={() => process.exit(0)}>
          <Pill bg={palette.panel} fg={palette.accent}>exit</Pill>
        </Pressable>
      </Row>
    </Col>
  );
}
