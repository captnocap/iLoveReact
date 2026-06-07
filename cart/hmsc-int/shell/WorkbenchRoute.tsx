// shell/WorkbenchRoute.tsx — the /workbench route surface (WORKBENCH.md §6
// step 3). The build-out room: the frame mounts here ALONGSIDE every existing
// route, sources land one at a time, and nothing pre-existing is touched
// until a source reaches parity and its old route flips off. Sources cross
// into shell as plain values (the LabsRoute rule — shell/ imports nothing
// game-specific; editors/workbench/ builds the list).

import { useEffect } from 'react';
import { Box } from '@reactjit/primitives';
import { Workbench, type WorkbenchSource } from './Workbench';
import { accentFor } from './workbench.cls';
import { readRouteTwigState } from '../editors/twigs';
import { GAME_TELEMETRY } from '../game/telemetry';

const gClothslowProbe: any = globalThis;

function now(): number {
  const perf = (globalThis as any).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

function armClothslowProbe(): boolean {
  const enabled = readRouteTwigState('/workbench', 'clothslowProbe', false) === true;
  if (!enabled) return false;
  if (gClothslowProbe.__hmsc_clothslow_probe_armed) return true;
  gClothslowProbe.__hmsc_clothslow_probe_armed = true;
  gClothslowProbe.__hmsc_workbench_route_start = now();
  GAME_TELEMETRY.clearDiagnostics();
  for (const channel of ['churn', 'figure', 'draw', 'hostFlush', 'capture'] as const) {
    GAME_TELEMETRY.setDiagnosticChannel(channel, true);
  }
  GAME_TELEMETRY.recordDiagnostic('churn', 'clothslow.probe.armed', { route: '/workbench' });
  return true;
}

export function WorkbenchRoute(props: { sources: Array<WorkbenchSource<any>>; onExit: () => void }) {
  const probe = armClothslowProbe();
  useEffect(() => {
    if (!probe) return;
    const timer = setTimeout(() => {
      GAME_TELEMETRY.diagnosticDump('clothslow-route-mount');
      for (const channel of ['churn', 'figure', 'draw', 'hostFlush', 'capture'] as const) {
        GAME_TELEMETRY.setDiagnosticChannel(channel, false);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [probe]);
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', flexDirection: 'column', backgroundColor: accentFor('bg') }}>
      <Workbench
        sources={props.sources}
        onExit={props.onExit}
        perf={{
          now,
          mark: (label, fields) => GAME_TELEMETRY.recordDiagnostic('churn', label, fields),
        }}
      />
    </Box>
  );
}
