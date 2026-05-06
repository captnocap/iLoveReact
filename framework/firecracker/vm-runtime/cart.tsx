// Worker shell cart — mounts inside a Firecracker VM at boot.
//
// Role: be the in-VM reactjit instance that does three things.
//
//   1. Open vsock to the host. Mirror selected bus channels so the
//      host's rule engine can see in (every event:append, rule:fired,
//      verb:lifecycle, etc.) and the host can kick the VM
//      (supervisor:halt-run, supervisor:invoke-verb, …).
//
//   2. Spawn the agent CLI subprocess (claude-code, codex, kimi-cli)
//      per the assignment rendered into /worker/assignment.json by the
//      host at VM-spawn time. Pipe its stdout/stderr onto the bus.
//
//   3. React to host-issued supervisor events. 'supervisor:halt-run'
//      → SIGTERM the agent. 'supervisor:invoke-verb' → run the named
//      verb script with args from the payload.
//
// What this cart deliberately does NOT do:
//   - Bind Rule rows. There's no DB inside the VM. The host owns the
//     rule engine; the VM is just an event source + action sink.
//   - Tool-call detection / pathology checks. Those run on the host
//     side as IFTTT subscribers on the mirrored events.
//   - Manage retention. The host's branch/diff capture handles it.
//
// The cart is render-able for debug surfaces (TUI / framebuffer), but
// the load-bearing logic lives in useEffect; it stays correct headless.

import { useEffect, useRef, useState } from 'react';
import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
import { emit, subscribe } from '@reactjit/runtime/ffi';
import {
  openVsock,
  mirrorChannels,
  DEFAULT_GUEST_OUTGOING,
  DEFAULT_GUEST_INCOMING,
  type VsockTransport,
} from '@reactjit/runtime/hooks/vsock';
import * as fs from '@reactjit/runtime/hooks/fs';
import * as proc from '@reactjit/runtime/hooks/process';

// ── Assignment shape ──────────────────────────────────────────────
//
// Rendered by the host into /worker/assignment.json before the VM
// boots. The agent block is what we spawn; the rest is metadata the
// host needs back in events for correlation.

export interface WorkerAssignment {
  vmid: string;
  runId?: string;
  workerId?: string;
  agent?: {
    cmd: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
}

const ASSIGNMENT_PATH = '/worker/assignment.json';

function loadAssignment(): WorkerAssignment {
  const raw = fs.readFile(ASSIGNMENT_PATH);
  if (!raw) return { vmid: 'unknown' };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as WorkerAssignment;
  } catch (e: any) {
    console.warn(`[worker] could not parse ${ASSIGNMENT_PATH}:`, e?.message || e);
  }
  return { vmid: 'unknown' };
}

// ── Event helpers ────────────────────────────────────────────────
//
// All events emitted here ride the bus through the mirrored channels
// and arrive on the host as `vm:<vmid>:<channel>:<...>`.

function emitEvent(kind: string, payload: Record<string, unknown> = {}, meta?: { runId?: string; workerId?: string }): void {
  const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  emit('event:append', {
    id,
    kind,
    occurredAt: new Date().toISOString(),
    payload,
    runId: meta?.runId,
    workerId: meta?.workerId,
  });
}

// ── Agent process supervision ────────────────────────────────────

function startAgent(assignment: WorkerAssignment): { pid: proc.Pid; teardown: () => void } | null {
  if (!assignment.agent) return null;
  const { cmd, args = [], cwd, env } = assignment.agent;
  const pid = proc.spawn({ cmd, args, cwd, env, stdin: 'pipe' });
  if (!pid) {
    emitEvent('agent.spawn-failed', { cmd, args }, { runId: assignment.runId, workerId: assignment.workerId });
    return null;
  }
  emitEvent('agent.spawned', { pid, cmd, args }, { runId: assignment.runId, workerId: assignment.workerId });

  const meta = { runId: assignment.runId, workerId: assignment.workerId };

  const offStdout = proc.onStdout(pid, (line) => {
    emitEvent('agent.stdout', { pid, line }, meta);
  });
  const offStderr = proc.onStderr(pid, (line) => {
    emitEvent('agent.stderr', { pid, line }, meta);
  });
  const offExit = proc.onExit(pid, ({ code, signal }) => {
    emitEvent('agent.exited', { pid, code, signal }, meta);
  });

  return {
    pid,
    teardown: () => {
      offStdout(); offStderr(); offExit();
      try { proc.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
    },
  };
}

// ── Host-issued supervisor consequences ──────────────────────────

function wireSupervisorActions(getPid: () => proc.Pid | null): () => void {
  // 'supervisor:halt-run' on the local bus arrives via the mirrored
  // DEFAULT_GUEST_INCOMING set, sent from the host.
  const offHalt = subscribe('supervisor:halt-run', (payload: any) => {
    const pid = getPid();
    if (pid) {
      emitEvent('agent.halted-by-supervisor', { pid, reason: payload?.reason });
      try { proc.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
    }
  });
  const offInvokeVerb = subscribe('supervisor:invoke-verb', (payload: any) => {
    const verbId = payload?.verbId;
    if (!verbId) return;
    // V0: emit a request event the recipe-side verb runner picks up.
    // Future: dispatch directly to the verb script in /usr/local/lib/verbs/<verbId>.
    emitEvent('verb.invoke-requested', { verbId, args: payload?.args });
  });
  const offInject = subscribe('supervisor:inject-message', (payload: any) => {
    const pid = getPid();
    const text = String(payload?.text ?? '');
    if (pid && text) {
      try { proc.stdinWrite(pid, text + '\n'); }
      catch (e: any) { emitEvent('agent.inject-failed', { pid, error: e?.message }); }
    }
  });
  return () => { offHalt(); offInvokeVerb(); offInject(); };
}

// ── The cart ─────────────────────────────────────────────────────

export default function WorkerShellCart() {
  const [assignment, setAssignment] = useState<WorkerAssignment | null>(null);
  const [vsockLive, setVsockLive] = useState(false);
  const [agentPid, setAgentPid] = useState<proc.Pid | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [eventCount, setEventCount] = useState(0);

  // Refs so subscribe handlers see live state without re-binding.
  const pidRef = useRef<proc.Pid | null>(null);
  pidRef.current = agentPid;

  useEffect(() => {
    let teardownAgent: (() => void) | null = null;
    let teardownSupervisor: (() => void) | null = null;
    let teardownMirrors: (() => void) | null = null;
    let transport: VsockTransport | null = null;
    let countSub: (() => void) | null = null;

    (async () => {
      const a = loadAssignment();
      setAssignment(a);

      transport = openVsock({ kind: 'guest' });
      setVsockLive(transport.live);

      // Mirror outgoing channels (guest → host) and incoming
      // supervisor channels (host → guest).
      const all = [...DEFAULT_GUEST_OUTGOING, ...DEFAULT_GUEST_INCOMING];
      teardownMirrors = mirrorChannels(transport, all);

      teardownSupervisor = wireSupervisorActions(() => pidRef.current);

      countSub = subscribe('event:append', () => {
        setEventCount((n) => n + 1);
      });

      const exitSub = subscribe('agent.exited', (payload: any) => {
        if (typeof payload?.code === 'number') setExitCode(payload.code);
      });

      emitEvent('worker.started', { vmid: a.vmid }, { runId: a.runId, workerId: a.workerId });

      const started = startAgent(a);
      if (started) {
        setAgentPid(started.pid);
        teardownAgent = () => { started.teardown(); exitSub(); };
      } else {
        teardownAgent = exitSub;
      }
    })();

    return () => {
      try { teardownAgent?.(); } catch { /* ignore */ }
      try { teardownSupervisor?.(); } catch { /* ignore */ }
      try { teardownMirrors?.(); } catch { /* ignore */ }
      try { countSub?.(); } catch { /* ignore */ }
      try { transport?.close(); } catch { /* ignore */ }
    };
  }, []);

  // Headless-friendly status surface — primitives no-op when there's
  // no compositor; useful when the cart runs in a TUI or framebuffer.
  return (
    <Col style={{ padding: 12, gap: 8, backgroundColor: '#0c0e14' }}>
      <Text fontSize={14} color="#eef2f8" style={{ fontWeight: 'bold' }}>
        worker shell · {assignment?.vmid ?? '…'}
      </Text>
      <Row style={{ gap: 12, flexWrap: 'wrap' }}>
        <Stat label="vsock" value={vsockLive ? 'live' : 'stub'} ok={vsockLive} />
        <Stat label="agent pid" value={agentPid ? String(agentPid) : '—'} ok={agentPid !== null} />
        <Stat label="exit" value={exitCode == null ? 'running' : String(exitCode)} ok={exitCode === 0 || exitCode == null} />
        <Stat label="events" value={String(eventCount)} ok={true} />
        <Stat label="run" value={assignment?.runId ?? '—'} ok={!!assignment?.runId} />
      </Row>
      {assignment?.agent ? (
        <Box style={{ paddingTop: 4 }}>
          <Text fontSize={10} color="#7d8a9a">
            agent: {assignment.agent.cmd}{assignment.agent.args?.length ? ` ${assignment.agent.args.join(' ')}` : ''}
          </Text>
        </Box>
      ) : (
        <Text fontSize={10} color="#7d8a9a">no agent in assignment — passive mode</Text>
      )}
    </Col>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <Box style={{
      paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
      borderRadius: 4, borderWidth: 1, borderColor: '#18202b',
      backgroundColor: '#101824',
    }}>
      <Text fontSize={9} color="#7d8a9a">{label}</Text>
      <Text fontSize={11} color={ok ? '#7ed957' : '#ffb84a'}>{value}</Text>
    </Box>
  );
}
