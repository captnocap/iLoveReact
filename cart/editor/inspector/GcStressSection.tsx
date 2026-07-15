// inspector/GcStressSection.tsx — the GC STRESS rig, shown under the physics
// globals on the playtest tab.
//
// Purpose: answer "does UI-side JS/GC pressure stutter the playable world?"
// empirically. Each button runs a timed torture mode while the user plays:
//
//   ALLOC — pure allocation churn: ~3MB of short-lived objects every 10ms
//           (~300MB/s) with no React involvement. Scavenger pressure only.
//   REACT — 60Hz setState re-rendering a chip grid with fresh strings/objects
//           every frame: vdom churn + host-tree mutation batches + text
//           re-layout. The "extensive ui work" case.
//   HEAP  — retained-heap climber: grows a live object graph ~120MB over a
//           few seconds, drops it, climbs again. Provokes repeated major
//           (mark-sweep) collections, the expensive GC class.
//   MARKET— the real framework/sim shitcoin hot path via __zig_call('sim',…):
//           tick at 60Hz (4x game speed), drain the trade tape every tick,
//           snapshot 256 token prices at ~10Hz, render a live ticker. The
//           "market sim + world + UI at once" case that was never tried.
//   ALL   — everything at once.
//
// Verdict channel: feel (does driving/walking hitch?) + the console — v8_app's
// [apptick-split] line prints whenever a tick exceeds 40ms and names the GC ms
// inside it. Everything here is component-local; unmount stops all torture.
import { useEffect, useRef, useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { subscribe } from '../../../runtime/ffi';
import { C, accentFor } from '../workspace.cls';

type StressMode = 'idle' | 'alloc' | 'react' | 'heap' | 'market' | 'all';

const STRESS_TUNING = {
  allocTickMs: 10,          // cadence of the short-lived garbage bursts
  allocObjectsPerTick: 20_000,
  allocMbPerTickEstimate: 3,
  reactTickMs: 16,          // ~60Hz re-render clock
  reactChipCount: 120,      // chips re-rendered with fresh text every frame
  heapTickMs: 10,           // cadence of retained-graph growth
  heapObjectsPerTick: 40_000,
  heapReleaseAtObjects: 1_500_000, // ~120MB live, then drop and climb again
  statusTickMs: 100,        // status-row refresh (itself mild churn, on purpose)
  marketTickMs: 16,         // sim tick cadence (60Hz)
  marketDtMs: 64,           // dt per tick → 4x game speed
  marketSnapshotEvery: 6,   // price-snapshot cadence in ticks (~10Hz, 256 rows each)
  marketTickerRows: 10,     // live ticker rows rendered while running
  runSeconds: 30,
  runSecondsAll: 60,
} as const;

const PATTERN_NAMES = ['crab', 'pump', 'dump', 'up', 'down', 'vol', 'rug'] as const;

// framework/sim via the zigcall module table (v8_bindings_zigcall.zig row "sim").
function simCall(fn: string, ...args: unknown[]): any {
  const call = (globalThis as any).__zig_call;
  return call ? call('sim', fn, ...args) : null;
}

export default function GcStressSection() {
  const [mode, setMode] = useState<StressMode>('idle');
  const [statusTick, setStatusTick] = useState(0);
  const [reactFrame, setReactFrame] = useState(0);

  const intervals = useRef<number[]>([]);
  const startedAt = useRef(0);
  const endAt = useRef(0);
  const garbageMb = useRef(0);
  const retained = useRef<Array<{ a: number; b: string }>>([]);
  const heapCycles = useRef(0);
  const reactFrames = useRef(0);
  const tapeDrained = useRef(0);
  const simTicks = useRef(0);
  const tokenSyms = useRef<Record<number, string>>({});
  const tickerRows = useRef<Array<{ id: number; price: number; pat: number; rug: number; vol: number }>>([]);

  // Symbol names arrive once via the sim's `sim:tokens` init emit.
  useEffect(() => subscribe('sim:tokens', (payload) => {
    try {
      const rows = typeof payload === 'string' ? JSON.parse(payload) : payload;
      for (const r of rows as Array<{ id: number; sym: string }>) tokenSyms.current[r.id] = r.sym;
    } catch { /* stress rig — symbol names are cosmetic */ }
  }), []);

  const stop = () => {
    for (const id of intervals.current) clearInterval(id);
    intervals.current = [];
    retained.current = [];
    setMode('idle');
  };
  useEffect(() => stop, []);

  const start = (next: Exclude<StressMode, 'idle'>) => {
    stop();
    const seconds = next === 'all' ? STRESS_TUNING.runSecondsAll : STRESS_TUNING.runSeconds;
    startedAt.current = Date.now();
    endAt.current = startedAt.current + seconds * 1000;
    garbageMb.current = 0;
    heapCycles.current = 0;
    reactFrames.current = 0;
    setMode(next);

    const arm = (id: number) => intervals.current.push(id);

    if (next === 'alloc' || next === 'all') {
      arm(setInterval(() => {
        const junk: Array<{ x: number; y: string; z: number[] }> = [];
        for (let i = 0; i < STRESS_TUNING.allocObjectsPerTick; i++) {
          junk.push({ x: i * 0.5, y: 'g' + i + ':' + ((i * 7) % 997), z: [i, i + 1, i + 2] });
        }
        if (junk.length > 0) garbageMb.current += STRESS_TUNING.allocMbPerTickEstimate;
      }, STRESS_TUNING.allocTickMs) as unknown as number);
    }

    if (next === 'react' || next === 'all') {
      arm(setInterval(() => {
        reactFrames.current += 1;
        setReactFrame((f) => f + 1);
      }, STRESS_TUNING.reactTickMs) as unknown as number);
    }

    if (next === 'market' || next === 'all') {
      tapeDrained.current = 0;
      simTicks.current = 0;
      arm(setInterval(() => {
        simCall('tick', STRESS_TUNING.marketDtMs);
        const drained = simCall('drain_tape', 128);
        if (Array.isArray(drained)) tapeDrained.current += drained.length;
        simTicks.current += 1;
        if (simTicks.current % STRESS_TUNING.marketSnapshotEvery === 0) {
          const prices = simCall('snapshot_prices');
          if (Array.isArray(prices)) {
            tickerRows.current = (prices as Array<{ id: number; price: number; pat: number; rug: number; volume_usd: number }>)
              .map((p) => ({ id: p.id, price: p.price, pat: p.pat, rug: p.rug, vol: p.volume_usd }))
              .sort((a, b) => b.vol - a.vol)
              .slice(0, STRESS_TUNING.marketTickerRows);
          }
        }
      }, STRESS_TUNING.marketTickMs) as unknown as number);
    }

    if (next === 'heap' || next === 'all') {
      arm(setInterval(() => {
        const bucket = retained.current;
        for (let i = 0; i < STRESS_TUNING.heapObjectsPerTick; i++) {
          bucket.push({ a: bucket.length, b: 'r' + bucket.length });
        }
        if (bucket.length >= STRESS_TUNING.heapReleaseAtObjects) {
          retained.current = []; // drop the live graph → next allocs provoke mark-sweep
          heapCycles.current += 1;
        }
      }, STRESS_TUNING.heapTickMs) as unknown as number);
    }

    arm(setInterval(() => {
      if (Date.now() >= endAt.current) { stop(); return; }
      setStatusTick((t) => t + 1);
    }, STRESS_TUNING.statusTickMs) as unknown as number);
  };

  void statusTick;
  const running = mode !== 'idle';
  const elapsedS = running ? Math.floor((Date.now() - startedAt.current) / 1000) : 0;
  const totalS = mode === 'all' ? STRESS_TUNING.runSecondsAll : STRESS_TUNING.runSeconds;
  const retainedMb = Math.round((retained.current.length * 80) / 1_000_000);

  const modeButton = (target: Exclude<StressMode, 'idle'>, label: string) => {
    const Btn = mode === target ? C.HW_PillOn : C.HW_SmallButton;
    const Txt = mode === target ? C.HW_PillTextOn : C.HW_PillText;
    return (
      <Btn onPress={() => start(target)}>
        <Txt>{label}</Txt>
      </Btn>
    );
  };

  return (
    <C.HW_Section>
      <C.HW_SectionHead>
        <C.HW_AccentBar style={{ backgroundColor: accentFor('error') }} />
        <C.HW_SectionTitle style={{ color: accentFor('error') }}>GC STRESS</C.HW_SectionTitle>
      </C.HW_SectionHead>
      <C.HW_ButtonRow>
        {modeButton('alloc', 'ALLOC')}
        {modeButton('react', 'REACT')}
        {modeButton('heap', 'HEAP')}
      </C.HW_ButtonRow>
      <C.HW_ButtonRow>
        {modeButton('market', 'MARKET')}
        {modeButton('all', `ALL ${STRESS_TUNING.runSecondsAll}S`)}
        <C.HW_SmallButton onPress={stop}>
          <C.HW_PillText>STOP</C.HW_PillText>
        </C.HW_SmallButton>
      </C.HW_ButtonRow>
      <C.HW_ReadRow>
        <C.HW_FormLabel>mode</C.HW_FormLabel>
        <C.HW_ReadValue style={{ color: running ? accentFor('error') : accentFor('textDim') }}>
          {running ? `${mode} · ${elapsedS}/${totalS}s` : 'idle'}
        </C.HW_ReadValue>
      </C.HW_ReadRow>
      <C.HW_ReadRow>
        <C.HW_FormLabel>garbage</C.HW_FormLabel>
        <C.HW_ReadValue>{`≈${garbageMb.current}MB short-lived`}</C.HW_ReadValue>
      </C.HW_ReadRow>
      <C.HW_ReadRow>
        <C.HW_FormLabel>retained</C.HW_FormLabel>
        <C.HW_ReadValue>{`≈${retainedMb}MB live · ${heapCycles.current} drops`}</C.HW_ReadValue>
      </C.HW_ReadRow>
      <C.HW_ReadRow>
        <C.HW_FormLabel>react</C.HW_FormLabel>
        <C.HW_ReadValue>{`${reactFrames.current} churn frames`}</C.HW_ReadValue>
      </C.HW_ReadRow>
      <C.HW_ReadRow>
        <C.HW_FormLabel>market</C.HW_FormLabel>
        <C.HW_ReadValue>
          {`${tapeDrained.current} trades · ${elapsedS > 0 ? Math.round(tapeDrained.current / elapsedS) : 0}/s`}
        </C.HW_ReadValue>
      </C.HW_ReadRow>
      {(mode === 'market' || mode === 'all') && tickerRows.current.map((row, i) => (
        <C.HW_ReadRow key={`ticker-${i}`}>
          <C.HW_FormLabel>{tokenSyms.current[row.id] ?? `T${row.id}`}</C.HW_FormLabel>
          <C.HW_ReadValue style={{ color: row.rug ? accentFor('error') : accentFor('textSecondary') }}>
            {`${row.price >= 1 ? row.price.toFixed(2) : row.price.toPrecision(3)} · ${PATTERN_NAMES[row.pat] ?? '?'} · $${Math.round(row.vol / 1000)}k`}
          </C.HW_ReadValue>
        </C.HW_ReadRow>
      ))}
      {(mode === 'react' || mode === 'all') && (
        <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, paddingLeft: 12, paddingRight: 12, paddingTop: 6 }}>
          {Array.from({ length: STRESS_TUNING.reactChipCount }, (_, i) => (
            <C.HW_TraceChip key={`${reactFrame}-${i}`}>
              <C.HW_PillText>{((reactFrame * 31 + i * 7) % 46656).toString(36)}</C.HW_PillText>
            </C.HW_TraceChip>
          ))}
        </Box>
      )}
    </C.HW_Section>
  );
}
