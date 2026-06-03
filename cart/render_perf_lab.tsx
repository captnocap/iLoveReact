/**
 * render perf lab — pile on live kitty terminals via <Render> capture surfaces
 * and watch the frame budget die.
 *
 * Each tile is its own `app:kitty` source → its own Xvfb + kitty process +
 * XShm grab + GPU texture upload EVERY frame (captureXShm/uploadPixels run
 * unconditionally per feed in render_surfaces.zig — idle shells are an honest
 * worst-case load). Feeds are matched by exact renderSrc string, so every
 * tile carries a unique `--title rlab-N` to avoid collapsing into one kitty.
 *
 * Mechanic worth knowing while reading the numbers: the Xvfb is sized to the
 * tile's pixel rect AT BIRTH (max(320,w) x max(240,h)), once. As the grid
 * fills and cells shrink, early tiles keep their larger birth resolution;
 * once a cell shrinks below 320x240 the birth-floored texture just downscales
 * into the smaller quad (the pure thumbnail path). So per-terminal cost is
 * roughly "birth area uploaded per frame", and total cost trends with N.
 *
 * Two host-side limits cap the wall:
 *   - MAX_FEEDS (64) in render_surfaces.zig — array ceiling.
 *   - OOM guard (memoryHeadroomOk) — refuses a new display/app feed when free
 *     RAM would drop below RENDER_MEM_RESERVE_MB (default 2GB) plus a per-feed
 *     reservation. This cart mirrors that floor to soft-disable the + buttons
 *     so you can't pile on past what the machine can hold.
 */
import { useState, useEffect, useRef } from 'react';
import { Box, Row, Col, Text, Pressable, Render } from '@reactjit/primitives';
import { useTelemetry } from '@reactjit/hooks/useTelemetry';
import { readFile } from '@reactjit/hooks/fs';

const CAP = 64; // mirrors MAX_FEEDS
const SAMPLE_MS = 500;
const HIST = 120; // ~1 min of samples at 2/s
const MEM_RESERVE_MB = 2048; // mirrors RENDER_MEM_RESERVE_MB host default
const MEM_PER_FEED_MB = 600; // mirrors RENDER_MEM_PER_FEED_MB host default

type Cmd = 'shell' | 'claude';

// Feeds are matched by EXACT renderSrc, so the title carries both the tile id
// (uniqueness) and a refresh nonce. Bumping the nonce changes every source →
// the host retires the old feeds and re-spawns each Xvfb at the tile's CURRENT
// cell size, so all terminals re-lay-out uniformly instead of keeping their
// birth resolution (the "0 is tiny, 23 is huge" cascade).
function srcFor(id: number, cmd: Cmd, nonce: number): string {
  const base =
    `app:kitty --title rlab-${id}-${nonce}` +
    ` -o remember_window_size=no -o initial_window_width=640 -o initial_window_height=400`;
  return cmd === 'claude' ? `${base} -e claude` : base;
}

function fpsColor(fps: number): string {
  if (fps >= 55) return 'theme:success';
  if (fps >= 30) return 'theme:warning';
  return 'theme:error';
}

export default function App() {
  const [count, setCount] = useState(0);
  const [cmd, setCmd] = useState<Cmd>('shell');
  const [nonce, setNonce] = useState(0); // bump → re-rack all feeds at current size
  const [mem, setMem] = useState({ totalMb: 0, availMb: 0 });

  // ── live telemetry (polled) ─────────────────────────────────────
  const { value: fps } = useTelemetry({ kind: 'fps', pollMs: SAMPLE_MS });
  const { value: paintUs } = useTelemetry({ kind: 'paintUs', pollMs: SAMPLE_MS });
  const { value: tickUs } = useTelemetry({ kind: 'tickUs', pollMs: SAMPLE_MS });
  const { value: layoutUs } = useTelemetry({ kind: 'layoutUs', pollMs: SAMPLE_MS });
  const { value: nodes } = useTelemetry({ kind: 'nodeCount', pollMs: 1000 });
  const { data: gpu } = useTelemetry<any>({ kind: 'gpu', pollMs: 1000 });

  // ── sampled history (drives sparkline + log) ────────────────────
  // Mirror the freshest polled values into a ref each render, then sample on a
  // fixed cadence — robust against fps not changing between polls (ref read,
  // no stale closure; same discipline as the Pressable-ref pattern).
  const liveRef = useRef({ fps: 0, paintUs: 0, tickUs: 0, n: 0 });
  liveRef.current = { fps, paintUs, tickUs, n: count };
  const [hist, setHist] = useState<Array<{ t: number; fps: number; paintUs: number; n: number }>>([]);
  useEffect(() => {
    const h = setInterval(() => {
      const s = liveRef.current;
      setHist((prev) => [...prev.slice(-(HIST - 1)), { t: Date.now(), fps: s.fps, paintUs: s.paintUs, n: s.n }]);
    }, SAMPLE_MS);
    return () => clearInterval(h);
  }, []);

  // ── memory: read /proc/meminfo, derive per-terminal cost + OOM soft-guard ──
  useEffect(() => {
    const read = () => { const t = readFile('/proc/meminfo'); if (t) setMem(parseMeminfo(t)); };
    read();
    const h = setInterval(read, 1000);
    return () => clearInterval(h);
  }, []);
  const usedMb = mem.totalMb > 0 ? mem.totalMb - mem.availMb : 0;
  // baseline = used RAM with zero terminals; re-captured whenever we return to 0.
  const baseUsedRef = useRef<number | null>(null);
  if (count === 0 && mem.totalMb > 0) baseUsedRef.current = usedMb;
  const memPerTerm = count > 0 && baseUsedRef.current != null ? Math.max(0, (usedMb - baseUsedRef.current) / count) : 0;
  // Mirror the host OOM guard: refuse new feeds when free RAM would dip below
  // reserve + one feed. The host (render_surfaces.zig memoryHeadroomOk) is the
  // hard backstop; this just disables the buttons so the refusal isn't silent.
  const guardActive = mem.availMb > 0 && mem.availMb < MEM_RESERVE_MB + MEM_PER_FEED_MB;
  const canAdd = !guardActive && count < CAP;

  const add = () => { if (canAdd) setCount((c) => Math.min(CAP, c + 1)); };
  const add5 = () => { if (!guardActive) setCount((c) => Math.min(CAP, c + 5)); };
  const remove = () => setCount((c) => Math.max(0, c - 1));
  const reset = () => setCount(0);
  const refresh = () => setNonce((n) => n + 1);

  // ── grid arrangement (auto-shrink to fit, all visible) ──────────
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const rowList: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx < count) row.push(idx);
    }
    rowList.push(row);
  }

  const msFrame = fps > 0 ? 1000 / fps : 0;
  const perTerm = count > 0 ? paintUs / count : 0;

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: 'theme:bg' }}>
      {/* ── top bar ── */}
      <Row style={{ alignItems: 'center', gap: 10, paddingTop: 8, paddingBottom: 8, paddingLeft: 12, paddingRight: 12, backgroundColor: 'theme:bgElevated', borderBottomWidth: 1, borderColor: 'theme:border' }}>
        <Text style={{ color: 'theme:text', fontSize: 14, fontWeight: 700 }}>render perf lab</Text>
        <Text style={{ color: 'theme:textDim', fontSize: 11 }}>kitty capture surfaces</Text>

        <Box style={{ flexGrow: 1 }} />

        <Btn label="+ kitty" kind="primary" onPress={add} disabled={!canAdd} />
        <Btn label="+5" kind="primary" onPress={add5} disabled={guardActive} />
        <Btn label="−" onPress={remove} />
        <Btn label="refresh" onPress={refresh} />
        <Btn label="reset" onPress={reset} />

        <Box style={{ width: 1, height: 22, backgroundColor: 'theme:border', marginLeft: 4, marginRight: 4 }} />

        <Btn label="shell" kind={cmd === 'shell' ? 'active' : 'ghost'} onPress={() => setCmd('shell')} />
        <Btn label="claude" kind={cmd === 'claude' ? 'active' : 'ghost'} onPress={() => setCmd('claude')} />

        <Box style={{ width: 1, height: 22, backgroundColor: 'theme:border', marginLeft: 4, marginRight: 4 }} />

        {guardActive ? (
          <Box style={{ paddingTop: 3, paddingBottom: 3, paddingLeft: 8, paddingRight: 8, borderRadius: 4, backgroundColor: 'theme:warning' }}>
            <Text style={{ color: 'theme:bg', fontSize: 11, fontWeight: 700 }}>⚠ mem guard — can't add</Text>
          </Box>
        ) : null}
        <Text style={{ color: 'theme:textDim', fontSize: 12 }}>{`${count} / ${CAP}`}</Text>
        <Text style={{ color: fpsColor(fps), fontSize: 13, fontWeight: 700 }}>{`${fps.toFixed(0)} fps`}</Text>
      </Row>

      {/* ── body: matrix + perf panel ── */}
      <Row style={{ flexGrow: 1 }}>
        {/* matrix */}
        <Col style={{ flexGrow: 1, padding: 4 }}>
          {count === 0 ? (
            <Box style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: 'theme:textDim', fontSize: 13 }}>press “+ kitty” and keep going til the sun don't shine</Text>
            </Box>
          ) : (
            rowList.map((row, r) => (
              <Row key={`row-${r}`} style={{ flexGrow: 1, flexBasis: 0 }}>
                {row.map((idx) => (
                  <Tile key={`tile-${idx}`} id={idx} cmd={cmd} nonce={nonce} />
                ))}
                {/* pad the last row so cells stay uniform width */}
                {Array.from({ length: cols - row.length }).map((_, i) => (
                  <Box key={`pad-${r}-${i}`} style={{ flexGrow: 1, flexBasis: 0 }} />
                ))}
              </Row>
            ))
          )}
        </Col>

        {/* perf panel */}
        <Col style={{ width: 300, backgroundColor: 'theme:bgAlt', borderLeftWidth: 1, borderColor: 'theme:border', padding: 12, gap: 10 }}>
          <Text style={{ color: 'theme:textDim', fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>PERF LOG</Text>

          {/* hero fps */}
          <Row style={{ alignItems: 'flex-end', gap: 8 }}>
            <Text style={{ color: fpsColor(fps), fontSize: 38, fontWeight: 800 }}>{fps.toFixed(0)}</Text>
            <Text style={{ color: 'theme:textDim', fontSize: 12, marginBottom: 8 }}>{`fps · ${msFrame.toFixed(1)} ms`}</Text>
          </Row>

          {/* fps sparkline */}
          <Sparkline hist={hist} />

          {/* stat grid */}
          <Col style={{ gap: 4 }}>
            <Stat label="terminals" value={`${count} / ${CAP}`} />
            <Stat label="paint" value={`${Math.round(paintUs)} µs`} />
            <Stat label="paint / term" value={count > 0 ? `${Math.round(perTerm)} µs` : '—'} />
            <Stat label="tick" value={`${Math.round(tickUs)} µs`} />
            <Stat label="layout" value={`${Math.round(layoutUs)} µs`} />
            <Stat label="nodes" value={`${nodes}`} />
            {gpu ? <Stat label="gpu rects" value={`${gpu.rect_count ?? 0}`} /> : null}
            {gpu ? <Stat label="gpu glyphs" value={`${gpu.glyph_count ?? 0}`} /> : null}
            {gpu ? <Stat label="surface" value={`${gpu.gpu_surface_w ?? 0}×${gpu.gpu_surface_h ?? 0}`} /> : null}
          </Col>

          {/* memory — what the wall actually costs */}
          <Text style={{ color: 'theme:textDim', fontSize: 10, fontWeight: 700, letterSpacing: 1, marginTop: 4 }}>MEMORY</Text>
          <MemBar usedMb={usedMb} totalMb={mem.totalMb} reserveMb={MEM_RESERVE_MB} />
          <Col style={{ gap: 4 }}>
            <Stat label="ram used" value={mem.totalMb > 0 ? `${(usedMb / 1024).toFixed(1)} / ${(mem.totalMb / 1024).toFixed(0)} GB` : '—'} />
            <Stat label="free" value={mem.availMb > 0 ? `${(mem.availMb / 1024).toFixed(1)} GB` : '—'} />
            <Stat label="≈ mem / terminal" value={count > 0 && memPerTerm > 0 ? `${Math.round(memPerTerm)} MB` : '—'} />
            <Stat label="≈ paint / terminal" value={count > 0 ? `${Math.round(perTerm)} µs` : '—'} />
            <Stat label="mem reserve" value={`${(MEM_RESERVE_MB / 1024).toFixed(0)} GB floor`} />
          </Col>

          {/* scrolling sample log */}
          <Text style={{ color: 'theme:textDim', fontSize: 10, fontWeight: 700, letterSpacing: 1, marginTop: 4 }}>SAMPLES</Text>
          <Col style={{ gap: 1 }}>
            {hist.slice(-22).reverse().map((s, i) => (
              <Text key={`log-${s.t}-${i}`} style={{ color: i === 0 ? 'theme:text' : 'theme:textDim', fontSize: 10 }}>
                {`${hms(s.t)}  n=${pad2(s.n)}  ${s.fps.toFixed(0).padStart(2)}fps  ${Math.round(s.paintUs)}µs`}
              </Text>
            ))}
          </Col>
        </Col>
      </Row>
    </Col>
  );
}

// ── one capture tile ──────────────────────────────────────────────
function Tile({ id, cmd, nonce }: { id: number; cmd: Cmd; nonce: number }) {
  return (
    <Box style={{ flexGrow: 1, flexBasis: 0, margin: 2, borderWidth: 1, borderColor: 'theme:border', borderRadius: 4, overflow: 'hidden', backgroundColor: 'theme:surface', flexDirection: 'column' }}>
      <Row style={{ alignItems: 'center', gap: 6, paddingTop: 2, paddingBottom: 2, paddingLeft: 6, paddingRight: 6, backgroundColor: 'theme:bgElevated' }}>
        <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: 'theme:accent' }} />
        <Text style={{ color: 'theme:textSecondary', fontSize: 10, fontWeight: 700 }}>{`#${id}`}</Text>
      </Row>
      <Box style={{ flexGrow: 1, width: '100%', backgroundColor: '#000' }}>
        <Render renderSrc={srcFor(id, cmd, nonce)} style={{ flexGrow: 1, width: '100%' }} />
      </Box>
    </Box>
  );
}

// ── perf panel bits ───────────────────────────────────────────────
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ color: 'theme:textDim', fontSize: 11 }}>{label}</Text>
      <Text style={{ color: 'theme:text', fontSize: 11, fontWeight: 700 }}>{value}</Text>
    </Row>
  );
}

function Sparkline({ hist }: { hist: Array<{ fps: number }> }) {
  const bars = hist.slice(-90);
  return (
    <Row style={{ height: 44, alignItems: 'flex-end', gap: 1, backgroundColor: 'theme:bg', borderRadius: 3, paddingTop: 3, paddingBottom: 3, paddingLeft: 3, paddingRight: 3 }}>
      {bars.length === 0 ? (
        <Text style={{ color: 'theme:textDim', fontSize: 10 }}>collecting…</Text>
      ) : (
        bars.map((s, i) => (
          <Box
            key={`bar-${i}`}
            style={{
              flexGrow: 1,
              flexBasis: 0,
              height: `${Math.max(4, Math.min(100, (s.fps / 60) * 100))}%`,
              backgroundColor: fpsColor(s.fps),
              borderRadius: 1,
            }}
          />
        ))
      )}
    </Row>
  );
}

// Memory usage bar — used (amber→red as it climbs) over total, with a marker
// at the reserve floor where the OOM guard kicks in.
function MemBar({ usedMb, totalMb, reserveMb }: { usedMb: number; totalMb: number; reserveMb: number }) {
  if (totalMb <= 0) return <Box style={{ height: 10 }} />;
  const usedPct = Math.max(0, Math.min(100, (usedMb / totalMb) * 100));
  // guard trips when free < reserve, i.e. used > total - reserve
  const guardPct = Math.max(0, Math.min(100, ((totalMb - reserveMb) / totalMb) * 100));
  const overGuard = usedMb > totalMb - reserveMb;
  return (
    <Box style={{ height: 10, width: '100%', backgroundColor: 'theme:bg', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
      <Box style={{ height: '100%', width: `${usedPct}%`, backgroundColor: overGuard ? 'theme:error' : 'theme:success' }} />
      {/* reserve-floor marker */}
      <Box style={{ position: 'absolute', left: `${guardPct}%`, top: 0, width: 2, height: '100%', backgroundColor: 'theme:warning' }} />
    </Box>
  );
}

// ── tiny formatters ───────────────────────────────────────────────
function parseMeminfo(txt: string): { totalMb: number; availMb: number } {
  let total = 0;
  let avail = 0;
  for (const line of txt.split('\n')) {
    const m = line.match(/^(MemTotal|MemAvailable):\s+(\d+)\s*kB/);
    if (m) {
      const mb = Math.round(parseInt(m[2], 10) / 1024);
      if (m[1] === 'MemTotal') total = mb; else avail = mb;
    }
  }
  return { totalMb: total, availMb: avail };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function hms(t: number): string {
  const d = new Date(t);
  return `${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function Btn({ label, onPress, kind = 'default', disabled = false }: { label: string; onPress: () => void; kind?: 'default' | 'primary' | 'active' | 'ghost'; disabled?: boolean }) {
  const bg =
    kind === 'primary' ? 'theme:primary' :
    kind === 'active' ? 'theme:accent' :
    kind === 'ghost' ? 'theme:bg' :
    'theme:surface';
  const fg = kind === 'primary' || kind === 'active' ? 'theme:bg' : 'theme:text';
  return (
    <Pressable onPress={disabled ? () => {} : onPress} style={{ paddingTop: 4, paddingBottom: 4, paddingLeft: 10, paddingRight: 10, borderRadius: 4, backgroundColor: bg, borderWidth: 1, borderColor: 'theme:border', opacity: disabled ? 0.4 : 1 }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: 700 }}>{label}</Text>
    </Pressable>
  );
}
