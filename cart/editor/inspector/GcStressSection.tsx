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
//   ALL   — all three at once.
//
// Verdict channel: feel (does driving/walking hitch?) + the console — v8_app's
// [apptick-split] line prints whenever a tick exceeds 40ms and names the GC ms
// inside it. Everything here is component-local; unmount stops all torture.
import { useEffect, useRef, useState } from 'react';
import { Box } from '@reactjit/runtime/primitives';
import { C, accentFor } from '../workspace.cls';

type StressMode = 'idle' | 'alloc' | 'react' | 'heap' | 'all';

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
  runSeconds: 30,
  runSecondsAll: 60,
} as const;

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
