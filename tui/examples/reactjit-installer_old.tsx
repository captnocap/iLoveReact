// reactjit-installer — the npm bootstrap TUI.
//
// `npx reactjit` runs this. The npm package carries only this cart +
// tui/host + reconciler, ~200KB. Everything else (Zig, source tree,
// libraries, the actual build) is fetched on demand and built locally.
//
// Screens: menu → about|install → scanning → confirm → building → done.
// Registry is embedded at bundle time so the bootstrap is frozen unless
// the toolchain itself changes.

import * as React from 'react';
import { Box, Row, Col, Text, Pressable, ScrollView } from '../../runtime/primitives';
import { subscribeKey } from '../host';
import registry from '../../sdk/dependency-registry.json';

declare const __spawnSync: (bin: string, argsJson: string, stdin: string) => string;
declare const __spawn: (bin: string, argsJson: string) => number;
declare const __childReadLine: (id: number, timeoutMs: number) => string | null;
declare const __readFile: (path: string) => string;
declare const __writeFile: (path: string, content: string) => void;
declare const __stat: (path: string) => string | null;
declare const __env: (name: string) => string | null;

const palette = {
  page:   '#0b1020',
  panel:  '#111827',
  rail:   '#0f172a',
  border: '#334155',
  accent: '#fbbf24',
  ink:    '#e5e7eb',
  dim:    '#94a3b8',
  good:   '#34d399',
  bad:    '#f87171',
  brand:  '#60a5fa',
};

// ── Release config ─────────────────────────────────────────────────
//
// Set-and-forget constants. We pull a snapshot of the `distribute`
// branch — GitHub auto-generates a tarball for any branch head. To cut
// a new release: fast-forward the distribute branch to the commit you
// want shipped, push it, done. No tags, no asset uploads, no npm bump.
//
// The tarball extracts as `<repo>-distribute/`; tar --strip-components=1
// peels that off. .gitattributes export-ignore keeps frozen dirs out.
const REPO_SLUG    = __env('REACTJIT_REPO') || 'captnocap/reactjit';
const RELEASE_REF  = __env('REACTJIT_REF')  || 'distribute';
const TARBALL_URL  = `https://github.com/${REPO_SLUG}/archive/refs/heads/${RELEASE_REF}.tar.gz`;
const SHIP_TARGET  = __env('REACTJIT_CART') || 'install';
const VERSION      = `${RELEASE_REF}@HEAD`;

const HOME = __env('HOME') || '~';
const INSTALL_ROOT = `${HOME}/.reactjit`;

// ── Registry projection ────────────────────────────────────────────

type Probe = { kind: 'which' | 'pkg-config' | 'ldconfig'; arg: string };
type Dep = {
  id: string;
  label: string;
  required: boolean;
  version?: string;
  hint: { apt?: string; brew?: string; pacman?: string; note?: string };
  probes: Probe[];
};

function buildDeps(): Dep[] {
  const out: Dep[] = [];
  const tools = (registry as any).cliPayload.tools;
  if (tools.zig) {
    out.push({
      id: 'zig',
      label: `zig ${tools.zig.version}`,
      required: true,
      version: tools.zig.version,
      hint: { note: 'Auto-fetched if missing — single tarball, no root.' },
      probes: [{ kind: 'which', arg: 'zig' }],
    });
  }

  // Build toolchain (V8 + native deps need a C/C++ compiler + make).
  out.push({
    id: 'cc',  label: 'cc (C compiler)',  required: true,
    hint: { apt: 'build-essential', brew: 'xcode-select --install', pacman: 'base-devel' },
    probes: [{ kind: 'which', arg: 'cc' }, { kind: 'which', arg: 'gcc' }, { kind: 'which', arg: 'clang' }],
  });
  out.push({
    id: 'make', label: 'make',             required: true,
    hint: { apt: 'build-essential', brew: 'xcode-select --install', pacman: 'base-devel' },
    probes: [{ kind: 'which', arg: 'make' }],
  });

  const libs = (registry as any).nativeLibraries;
  for (const [key, raw] of Object.entries(libs) as Array<[string, any]>) {
    if (raw.bundlePolicy === 'never') continue;
    if (raw.bundlePolicy === 'vendored-source') continue;
    if (raw.linkPolicy === 'feature-gated') continue;
    if (raw.linkPolicy === 'engine-v8') continue;
    const sysName = (raw.systemNames && raw.systemNames[0]) || key;
    const probes: Probe[] = [{ kind: 'pkg-config', arg: sysName }, { kind: 'ldconfig', arg: sysName }];
    out.push({
      id: key, label: key, required: true,
      hint: aptBrewPacFor(key),
      probes,
    });
  }
  return out;
}

function aptBrewPacFor(key: string): Dep['hint'] {
  const map: Record<string, Dep['hint']> = {
    sdl3:     { apt: 'libsdl3-dev', brew: 'sdl3', pacman: 'sdl3' },
    freetype: { apt: 'libfreetype-dev', brew: 'freetype', pacman: 'freetype2' },
    luajit:   { apt: 'libluajit-5.1-dev', brew: 'luajit', pacman: 'luajit' },
  };
  return map[key] || { note: `system package for ${key}` };
}

// ── Probes (sync, fast) ────────────────────────────────────────────

type DepResult = { dep: Dep; ok: boolean; found: string | null };

function spawnSync(bin: string, args: string[], stdin = ''): { code: number; stdout: string; stderr: string } {
  try { return JSON.parse(__spawnSync(bin, JSON.stringify(args), stdin)); }
  catch { return { code: -1, stdout: '', stderr: '' }; }
}

function probeOne(p: Probe): string | null {
  if (p.kind === 'which') {
    const r = spawnSync('/usr/bin/env', ['which', p.arg]);
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim();
    return null;
  }
  if (p.kind === 'pkg-config') {
    const r = spawnSync('/usr/bin/env', ['pkg-config', '--modversion', p.arg]);
    if (r.code === 0 && r.stdout.trim()) return `pkg-config: ${r.stdout.trim()}`;
    return null;
  }
  if (p.kind === 'ldconfig') {
    const r = spawnSync('/usr/bin/env', ['sh', '-c', `ldconfig -p 2>/dev/null | grep -m1 lib${p.arg}`]);
    if (r.code === 0 && r.stdout.trim()) return r.stdout.trim().split('=>').pop()!.trim();
    return null;
  }
  return null;
}

function probe(dep: Dep): DepResult {
  for (const p of dep.probes) {
    const found = probeOne(p);
    if (found) return { dep, ok: true, found };
  }
  return { dep, ok: false, found: null };
}

// ── PATH writer ────────────────────────────────────────────────────

function detectShellRc(): string | null {
  const shell = __env('SHELL') || '';
  if (shell.endsWith('/fish')) return `${HOME}/.config/fish/config.fish`;
  if (shell.endsWith('/zsh'))  return `${HOME}/.zshrc`;
  return `${HOME}/.bashrc`;
}

function pathLine(): string {
  return `export PATH="${INSTALL_ROOT}/bin:$PATH"  # reactjit`;
}

function appendPath(): { ok: boolean; rc: string; msg: string } {
  const rc = detectShellRc();
  if (!rc) return { ok: false, rc: '', msg: 'no shell rc detected' };
  let body = '';
  try { body = __readFile(rc); } catch { body = ''; }
  if (body.includes('# reactjit')) return { ok: true, rc, msg: 'already on PATH' };
  const next = (body.endsWith('\n') ? body : body + '\n') + pathLine() + '\n';
  try { __writeFile(rc, next); return { ok: true, rc, msg: `appended to ${rc}` }; }
  catch (e: any) { return { ok: false, rc, msg: 'write failed: ' + (e?.message || String(e)) }; }
}

// ── Main ───────────────────────────────────────────────────────────

type Screen = 'menu' | 'about' | 'install' | 'building' | 'done';

const HINTS = [
  'reactjit ships React itself — your TSX is real React, no shim.',
  '<Native type="X" /> is the universal escape hatch into the Zig host.',
  'Tailwind classNames work out of the box via runtime/tw.ts.',
  'Canvas + Graph are pan-zoomable. gx/gy/gw/gh are graph coordinates.',
  'Layout is real flexbox — flexGrow, gap, alignItems, the lot.',
  'V8 is ~6MB. The "JS engine baggage" myth is fake — that was Chromium.',
  'scripts/ship <cart> bundles into a self-extracting binary. One file out.',
  'TextEditor primitive uses the same code path as the GPU host.',
];

export default function Installer() {
  const [screen, setScreen] = React.useState<Screen>('menu');
  const deps = React.useMemo(buildDeps, []);

  React.useEffect(() => subscribeKey(k => {
    if (k === 'q' || k === '\x03') process.exit(0);
    if (k === '\x1b') { if (screen !== 'menu') setScreen('menu'); }
  }), [screen]);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: palette.page, padding: 1, flexDirection: 'column', gap: 1 }}>
      <Header />
      {screen === 'menu' && <Menu onPick={setScreen} />}
      {screen === 'about' && <About onBack={() => setScreen('menu')} />}
      {screen === 'install' && <Install deps={deps} onBack={() => setScreen('menu')} onBuild={() => setScreen('building')} />}
      {screen === 'building' && <Building onDone={() => setScreen('done')} onBack={() => setScreen('menu')} />}
      {screen === 'done' && <Done onExit={() => process.exit(0)} />}
      <Footer screen={screen} />
    </Box>
  );
}

function Header() {
  return (
    <Row style={{ gap: 2, alignItems: 'center' }}>
      <Box style={{ backgroundColor: '#1d4ed8', padding: 1, borderWidth: 1, borderColor: palette.brand }}>
        <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>▲ reactjit installer · v{VERSION}</Text>
      </Box>
      <Text style={{ color: palette.dim }}>a thin React over a Zig + V8 + wgpu host</Text>
    </Row>
  );
}

function Footer({ screen }: { screen: Screen }) {
  const hint = screen === 'menu'
    ? 'Tab cycle · Enter activate · Esc back · q quit'
    : 'Esc back · q quit';
  return <Text style={{ color: '#64748b' }}>{hint}</Text>;
}

function MenuItem({ label, blurb, onPress, accent }: { label: string; blurb: string; onPress: () => void; accent?: string }) {
  return (
    <Pressable onPress={onPress}>
      <Box style={{ backgroundColor: palette.panel, padding: 1, borderWidth: 1, borderColor: palette.border, width: 60 }}>
        <Row style={{ gap: 2, alignItems: 'center' }}>
          <Text style={{ color: accent || palette.accent, fontWeight: 'bold' }}>{label}</Text>
          <Text style={{ color: palette.dim }}>— {blurb}</Text>
        </Row>
      </Box>
    </Pressable>
  );
}

function Menu({ onPick }: { onPick: (s: Screen) => void }) {
  return (
    <Col style={{ gap: 1, padding: 1, flexGrow: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>menu</Text>
      <MenuItem label="install"  blurb="scan host, fetch source, build SDK"  onPress={() => onPick('install')} />
      <MenuItem label="about"    blurb="what reactjit is, what gets installed" onPress={() => onPick('about')} />
      <MenuItem label="exit"     blurb="leave without changes"                accent={palette.bad} onPress={() => process.exit(0)} />
    </Col>
  );
}

function About({ onBack }: { onBack: () => void }) {
  return (
    <Col style={{ gap: 1, borderWidth: 1, borderColor: palette.border, padding: 1, flexGrow: 1 }}>
      <Text style={{ color: palette.accent, fontWeight: 'bold' }}>about</Text>
      <Text style={{ color: palette.ink }}>reactjit is a React reconciler driving a native Zig host.</Text>
      <Text style={{ color: palette.dim }}>Write standard .tsx — the reconciler emits mutation commands</Text>
      <Text style={{ color: palette.dim }}>that the host's layout, paint, hit-test and event machinery</Text>
      <Text style={{ color: palette.dim }}>consume. GPU rendering via wgpu-native. Shipping is one file.</Text>
      <Text style={{ color: palette.ink, fontWeight: 'bold' }}>install layout</Text>
      <Text style={{ color: palette.dim }}>  {INSTALL_ROOT}/src/      — pinned source tree</Text>
      <Text style={{ color: palette.dim }}>  {INSTALL_ROOT}/tools/    — zig, esbuild, v8cli</Text>
      <Text style={{ color: palette.dim }}>  {INSTALL_ROOT}/bin/      — reactjit launcher (added to PATH)</Text>
      <Pressable onPress={onBack}>
        <Box style={{ backgroundColor: palette.panel, padding: 1, borderWidth: 1, borderColor: palette.border, width: 16 }}>
          <Text style={{ color: palette.accent }}>‹ back</Text>
        </Box>
      </Pressable>
    </Col>
  );
}

// ── Install screen ─────────────────────────────────────────────────

function Install({ deps, onBack, onBuild }: { deps: Dep[]; onBack: () => void; onBuild: () => void }) {
  const [results, setResults] = React.useState<DepResult[] | null>(null);
  const [scanning, setScanning] = React.useState(false);

  const scan = (): void => {
    setScanning(true);
    setTimeout(() => {
      const out = deps.map(probe);
      setResults(out);
      setScanning(false);
    }, 0);
  };

  const missing = results ? results.filter(r => !r.ok) : [];
  const allOk = results !== null && missing.length === 0;

  return (
    <Col style={{ gap: 1, borderWidth: 1, borderColor: palette.border, padding: 1, flexGrow: 1 }}>
      <Row style={{ gap: 2, alignItems: 'center' }}>
        <Text style={{ color: palette.accent, fontWeight: 'bold' }}>required tools & libraries</Text>
        <Text style={{ color: palette.dim }}>{deps.length} entries</Text>
      </Row>

      <ScrollView style={{ flexGrow: 1, height: 14, borderWidth: 1, borderColor: palette.border, padding: 1 }}>
        <Col style={{ gap: 0 }}>
          {deps.map(d => {
            const r = results?.find(x => x.dep.id === d.id);
            const status = !r ? '·' : r.ok ? '✓' : '✗';
            const color = !r ? palette.dim : r.ok ? palette.good : palette.bad;
            return (
              <Row key={d.id} style={{ gap: 1 }}>
                <Text style={{ color, fontWeight: 'bold' }}>{status}</Text>
                <Text style={{ color: palette.ink, width: 24 }}>{d.label}</Text>
                <Text style={{ color: palette.dim }}>{r?.found || (r ? hintLine(d) : 'not scanned')}</Text>
              </Row>
            );
          })}
        </Col>
      </ScrollView>

      <Row style={{ gap: 2 }}>
        <Pressable onPress={scan}>
          <Box style={{ backgroundColor: palette.panel, padding: 1, borderWidth: 1, borderColor: palette.brand }}>
            <Text style={{ color: palette.brand, fontWeight: 'bold' }}>{scanning ? 'scanning…' : '⟳ scan host'}</Text>
          </Box>
        </Pressable>
        <Pressable onPress={() => allOk && onBuild()}>
          <Box style={{ backgroundColor: allOk ? '#065f46' : palette.panel, padding: 1, borderWidth: 1, borderColor: allOk ? palette.good : palette.border }}>
            <Text style={{ color: allOk ? '#ffffff' : palette.dim, fontWeight: 'bold' }}>
              {allOk ? '↓ pull source & build' : missing.length > 0 ? `install ${missing.length} missing first` : 'scan first'}
            </Text>
          </Box>
        </Pressable>
        <Pressable onPress={onBack}>
          <Box style={{ backgroundColor: palette.panel, padding: 1, borderWidth: 1, borderColor: palette.border }}>
            <Text style={{ color: palette.accent }}>‹ back</Text>
          </Box>
        </Pressable>
      </Row>

      {missing.length > 0 && <MissingHints missing={missing} />}
    </Col>
  );
}

function hintLine(d: Dep): string {
  const h = d.hint;
  if (h.apt) return `missing — apt: ${h.apt}`;
  if (h.brew) return `missing — brew: ${h.brew}`;
  if (h.note) return `missing — ${h.note}`;
  return 'missing';
}

function MissingHints({ missing }: { missing: DepResult[] }) {
  const apts = missing.map(m => m.dep.hint.apt).filter(Boolean).join(' ');
  const brews = missing.map(m => m.dep.hint.brew).filter(Boolean).join(' ');
  return (
    <Col style={{ gap: 0, borderWidth: 1, borderColor: palette.bad, padding: 1 }}>
      <Text style={{ color: palette.bad, fontWeight: 'bold' }}>install these first</Text>
      {apts &&  <Text style={{ color: palette.dim }}>debian/ubuntu: sudo apt install {apts}</Text>}
      {brews && <Text style={{ color: palette.dim }}>macos:         brew install {brews}</Text>}
    </Col>
  );
}

// ── Building ───────────────────────────────────────────────────────

function Building({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [lines, setLines] = React.useState<string[]>(['[bootstrap] starting…']);
  const [hint, setHint] = React.useState(0);
  const [phase, setPhase] = React.useState<'fetch' | 'build' | 'done' | 'fail'>('fetch');
  const childRef = React.useRef<number>(-1);

  React.useEffect(() => {
    const t = setInterval(() => setHint(h => (h + 1) % HINTS.length), 6000);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => {
    push(setLines, `[fetch] ${TARBALL_URL}`);
    setPhase('fetch');

    const script = [
      'set -e',
      `mkdir -p "${INSTALL_ROOT}/src" "${INSTALL_ROOT}/bin"`,
      `TGZ="$(mktemp -t rjit-src.XXXXXX.tgz)"`,
      `echo "[fetch] downloading"`,
      `curl --fail --location --progress-bar "${TARBALL_URL}" -o "$TGZ"`,
      `echo "[fetch] extracting → ${INSTALL_ROOT}/src"`,
      `tar -xzf "$TGZ" -C "${INSTALL_ROOT}/src" --strip-components=1`,
      `rm -f "$TGZ"`,
      `echo "__RJIT_PHASE__:build"`,
      `cd "${INSTALL_ROOT}/src"`,
      `echo "[build] scripts/ship ${SHIP_TARGET}"`,
      `./scripts/ship "${SHIP_TARGET}" 2>&1`,
      `echo "[install] copying binary → ${INSTALL_ROOT}/bin/reactjit"`,
      `cp "zig-out/bin/${SHIP_TARGET}" "${INSTALL_ROOT}/bin/reactjit"`,
      `chmod +x "${INSTALL_ROOT}/bin/reactjit"`,
      `echo "__RJIT_OK__"`,
    ].join('\n');

    const id = __spawn('/bin/sh', JSON.stringify(['-c', `( ${script} ) || echo "__RJIT_FAIL__:$?"`]));
    childRef.current = id;
    if (id < 0) { push(setLines, '[spawn] failed to launch /bin/sh'); setPhase('fail'); return; }

    const poll = setInterval(() => {
      while (true) {
        const line = __childReadLine(id, 0);
        if (line === null) return;
        if (line === '') {
          clearInterval(poll);
          setPhase(prev => prev === 'fail' ? 'fail' : 'done');
          return;
        }
        if (line === '__RJIT_OK__') {
          push(setLines, '[ok] reactjit installed');
          setPhase('done');
          setTimeout(onDone, 600);
          continue;
        }
        if (line.startsWith('__RJIT_FAIL__:')) {
          push(setLines, `[fail] pipeline exited ${line.slice('__RJIT_FAIL__:'.length)}`);
          setPhase('fail');
          continue;
        }
        if (line.startsWith('__RJIT_PHASE__:')) {
          const next = line.slice('__RJIT_PHASE__:'.length) as any;
          if (next === 'build' || next === 'fetch') setPhase(next);
          continue;
        }
        push(setLines, line);
      }
    }, 80);
    return () => { clearInterval(poll); if (childRef.current >= 0) try { (globalThis as any).__childKill?.(childRef.current); } catch {} };
  }, []);

  const tail = lines.slice(-40);

  return (
    <Col style={{ gap: 1, flexGrow: 1 }}>
      <Row style={{ gap: 2 }}>
        <Box style={{ backgroundColor: phase === 'fail' ? '#7f1d1d' : '#1d4ed8', padding: 1, borderWidth: 1, borderColor: palette.brand }}>
          <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>
            {phase === 'fetch' ? '↓ fetching source' :
             phase === 'build' ? '⚙ building reactjit' :
             phase === 'done'  ? '✓ build complete' : '✗ build failed'}
          </Text>
        </Box>
        <Box style={{ backgroundColor: palette.panel, padding: 1, borderWidth: 1, borderColor: palette.border, flexGrow: 1 }}>
          <Text style={{ color: palette.accent }}>tip · {HINTS[hint]}</Text>
        </Box>
      </Row>

      <ScrollView style={{ flexGrow: 1, height: 18, borderWidth: 1, borderColor: palette.border, padding: 1, backgroundColor: palette.rail }}>
        <Col style={{ gap: 0 }}>
          {tail.map((l, i) => (
            <Text key={i} style={{ color: l.startsWith('[ok') ? palette.good : l.startsWith('[err') || l.startsWith('[fail') ? palette.bad : palette.ink }}>{l}</Text>
          ))}
        </Col>
      </ScrollView>

      {phase === 'fail' && (
        <Pressable onPress={onBack}>
          <Box style={{ backgroundColor: palette.panel, padding: 1, borderWidth: 1, borderColor: palette.bad, width: 20 }}>
            <Text style={{ color: palette.bad }}>‹ back to menu</Text>
          </Box>
        </Pressable>
      )}
    </Col>
  );
}

function push(setLines: (f: (prev: string[]) => string[]) => void, line: string): void {
  setLines(prev => prev.concat(line));
}

// ── Done ───────────────────────────────────────────────────────────

function Done({ onExit }: { onExit: () => void }) {
  const [pathState, setPathState] = React.useState<{ ok: boolean; msg: string; rc: string } | null>(null);

  return (
    <Col style={{ gap: 1, borderWidth: 1, borderColor: palette.good, padding: 1, flexGrow: 1 }}>
      <Text style={{ color: palette.good, fontWeight: 'bold' }}>✓ reactjit installed at {INSTALL_ROOT}</Text>
      <Text style={{ color: palette.ink }}>add reactjit to your shell PATH?</Text>
      <Text style={{ color: palette.dim }}>line to append → {pathLine()}</Text>
      <Row style={{ gap: 2 }}>
        <Pressable onPress={() => setPathState(appendPath())}>
          <Box style={{ backgroundColor: '#065f46', padding: 1, borderWidth: 1, borderColor: palette.good }}>
            <Text style={{ color: '#ffffff', fontWeight: 'bold' }}>yes — add to PATH</Text>
          </Box>
        </Pressable>
        <Pressable onPress={() => setPathState({ ok: true, rc: '', msg: 'skipped — run manually:  export PATH="' + INSTALL_ROOT + '/bin:$PATH"' })}>
          <Box style={{ backgroundColor: palette.panel, padding: 1, borderWidth: 1, borderColor: palette.border }}>
            <Text style={{ color: palette.dim }}>no — I'll do it later</Text>
          </Box>
        </Pressable>
      </Row>

      {pathState && (
        <Box style={{ borderWidth: 1, borderColor: pathState.ok ? palette.good : palette.bad, padding: 1 }}>
          <Text style={{ color: pathState.ok ? palette.good : palette.bad }}>{pathState.msg}</Text>
        </Box>
      )}

      <Box style={{ backgroundColor: palette.panel, padding: 1, borderWidth: 1, borderColor: palette.border }}>
        <Col style={{ gap: 0 }}>
          <Text style={{ color: palette.accent, fontWeight: 'bold' }}>you're set. try:</Text>
          <Text style={{ color: palette.ink }}>  reactjit init my-app</Text>
          <Text style={{ color: palette.ink }}>  cd my-app && reactjit ship</Text>
        </Col>
      </Box>

      <Pressable onPress={onExit}>
        <Box style={{ backgroundColor: palette.panel, padding: 1, borderWidth: 1, borderColor: palette.border, width: 16 }}>
          <Text style={{ color: palette.accent }}>exit</Text>
        </Box>
      </Pressable>
    </Col>
  );
}
