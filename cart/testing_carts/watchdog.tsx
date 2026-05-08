/**
 * cart/watchdog.tsx — process babysitter + demo testbed.
 *
 * Spawns a child process whose command can be swapped at runtime
 * (heartbeat / leaky / idle). Three failure policies expressed as
 * useIFTTT calls over the per-pid sampler from Phase D:
 *
 *   memory ceiling     → SIGTERM (cooldown to avoid loop-on-respawn)
 *   stdout/cpu silence → SIGTERM
 *   engine hang        → SIGKILL
 *
 * Demo flow:
 *   1. Pick a threshold preset (50MB / 100MB / 5% / 80%).
 *   2. Click "Leaky" — spawns a Python child that allocates 10MB/s and
 *      prints its progress on stdout.
 *   3. Watch RSS climb in the live readout. When it crosses the
 *      threshold, the kill log shows the trigger fire.
 *
 * Idle test: click "Heartbeat", then "Freeze child" (SIGSTOP). Stdout
 * stops, no cpu ticks, idle:30000 fires after 30s.
 */

import { useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '../runtime/primitives';
import { useProcess } from '../runtime/hooks/useProcess';
import { useIFTTT } from '../runtime/hooks/useIFTTT';
import * as proc from '../runtime/hooks/process';

const PAGE_BG = '#0a0e16';
const PANEL_BG = '#101824';
const ACCENT = '#5db4ff';
const OK = '#7ed957';
const WARN = '#f5a524';
const DANGER = '#ef4444';
const TEXT = '#eef2f8';
const DIM = '#7d8a9a';
const BORDER = '#18202b';

// ── Child modes ────────────────────────────────────────────────────

const HEARTBEAT_CMD = ['bash', '-c', 'while true; do echo "heartbeat $(date +%T)"; sleep 1; done'];

// 10 MB allocation per second. Each chunk gets `touched` (write a byte every
// 4 KB page) so the kernel actually commits the pages — otherwise overcommit
// would let RSS lag VSize and the threshold demo wouldn't trigger.
const LEAKY_PY = `
import sys, time
data = []
i = 0
while True:
    chunk = bytearray(10 * 1024 * 1024)
    for k in range(0, len(chunk), 4096):
        chunk[k] = 1  # touch each page so RSS reflects it
    data.append(chunk)
    i += 1
    sys.stdout.write(f"leaked {i*10} MB total\\n")
    sys.stdout.flush()
    time.sleep(1)
`.trim();

const IDLE_CMD = ['sleep', '3600'];

type Mode = 'heartbeat' | 'leaky' | 'idle';

const MODE_LABEL: Record<Mode, string> = {
  heartbeat: 'Heartbeat (chatty)',
  leaky:     'Leak 10 MB/s',
  idle:      'Idle (sleep 1h)',
};

function modeCmd(mode: Mode): { cmd: string; args: string[] } {
  switch (mode) {
    case 'leaky':     return { cmd: 'python3', args: ['-c', LEAKY_PY] };
    case 'idle':      return { cmd: IDLE_CMD[0], args: IDLE_CMD.slice(1) };
    case 'heartbeat':
    default:          return { cmd: HEARTBEAT_CMD[0], args: HEARTBEAT_CMD.slice(1) };
  }
}

// ── Threshold presets ──────────────────────────────────────────────

type ThresholdKey = '50MB' | '100MB' | '500MB' | '5%' | '80%';
const THRESHOLD_KEYS: ThresholdKey[] = ['50MB', '100MB', '500MB', '5%', '80%'];

// ── Helpers ────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(k)));
  return `${(n / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

function fmtTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function StatRow({ label, value, color = TEXT }: { label: string; value: string; color?: string }) {
  return (
    <Row style={{ gap: 12, alignItems: 'center', height: 22 }}>
      <Box style={{ width: 140, height: 22, justifyContent: 'center' }}>
        <Text fontSize={11} color={DIM}>{label}</Text>
      </Box>
      <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, height: 22, justifyContent: 'center' }}>
        <Text fontSize={12} color={color} style={{ fontWeight: 'bold' }}>{value}</Text>
      </Box>
    </Row>
  );
}

function Btn({ onPress, color, children, active }: any) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6,
        borderRadius: 6,
        backgroundColor: active ? color ?? ACCENT : '#1c2632',
        borderWidth: 1, borderColor: active ? color ?? ACCENT : BORDER,
      }}
    >
      <Text fontSize={11} color={active ? '#06121f' : TEXT} style={{ fontWeight: 'bold' }}>{children}</Text>
    </Pressable>
  );
}

const IDLE_MS = 30_000;
const KILL_COOLDOWN_MS = 60_000;

export default function WatchdogCart() {
  const [, tick] = useState(0);
  const bump = () => tick((n) => (n + 1) & 0xffff);

  const [mode, setMode] = useState<Mode>('heartbeat');
  const [threshold, setThreshold] = useState<ThresholdKey>('100MB');

  type KillEntry = { at: number; reason: string; signal: string; pid: number };
  const [killLog, setKillLog] = useState<KillEntry[]>([]);
  const [latestSample, setLatestSample] = useState<any>(null);
  const [lastChildLine, setLastChildLine] = useState('');

  const child = useProcess({
    ...modeCmd(mode),
    onStdout: (line) => { setLastChildLine(line.slice(0, 80)); bump(); },
    onExit: (_r) => { bump(); },
  });

  const recordKill = (reason: string, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') => {
    const entry: KillEntry = { at: Date.now(), reason, signal, pid: child.pid };
    setKillLog((log) => [entry, ...log].slice(0, 8));
    if (child.pid > 0) child.kill?.(signal);
  };

  // ── 1. Memory ceiling ───────────────────────────────────────────────
  useIFTTT(
    {
      trigger: {
        all: [
          `proc:ram:${child.pid}:>:${threshold}`,
          () => child.state === 'running' && child.pid > 0,
        ],
      },
      cooldown: KILL_COOLDOWN_MS,
    },
    (payload: any) => {
      setLatestSample(payload);
      const rss = fmtBytes(payload?.rss ?? 0);
      recordKill(`ram > ${threshold} (rss=${rss})`);
    },
  );

  // ── 2. Idle ceiling ─────────────────────────────────────────────────
  useIFTTT(
    `proc:idle:${child.pid}:${IDLE_MS}`,
    () => {
      if (child.state !== 'running') return;
      recordKill(`idle > ${IDLE_MS / 1000}s`);
    },
  );

  // ── 3. Engine hang escalation ───────────────────────────────────────
  useIFTTT(
    { on: 'system:hang', when: (e: any) => (e?.count ?? 0) > 3 },
    (e: any) => recordKill(`engine hang (${e?.count ?? '?'} frames)`, 'SIGKILL'),
  );

  // Live RAM stream for the readout — no threshold, every sample.
  useIFTTT(`proc:ram:${child.pid}`, (payload: any) => setLatestSample(payload));

  const stateColor =
    child.state === 'running' ? OK :
    child.state === 'error' ? DANGER :
    child.state === 'stopped' ? WARN : DIM;

  const ramBytes = latestSample?.rss ?? 0;
  const ramPct = latestSample?.percent ?? 0;

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: PAGE_BG, padding: 24, gap: 16 }}>
      <Col style={{ gap: 4 }}>
        <Text fontSize={22} color={TEXT} style={{ fontWeight: 'bold' }}>watchdog</Text>
        <Text fontSize={11} color={DIM}>cart-side replacement for framework/watchdog.zig — declarative IFTTT rules over per-pid sampling</Text>
      </Col>

      {/* Mode switcher */}
      <Col style={{ gap: 8, padding: 16, backgroundColor: PANEL_BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
        <Text fontSize={12} color={ACCENT} style={{ fontWeight: 'bold' }}>child process</Text>
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <Btn key={m} active={mode === m} onPress={() => setMode(m)}>
              {MODE_LABEL[m]}
            </Btn>
          ))}
        </Row>
        <Text fontSize={10} color={DIM}>
          Switching mode tears down the current child and respawns. RSS resets.
        </Text>
      </Col>

      {/* Threshold preset picker */}
      <Col style={{ gap: 8, padding: 16, backgroundColor: PANEL_BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
        <Text fontSize={12} color={ACCENT} style={{ fontWeight: 'bold' }}>memory threshold</Text>
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          {THRESHOLD_KEYS.map((k) => (
            <Btn key={k} active={threshold === k} onPress={() => setThreshold(k)}>
              {k}
            </Btn>
          ))}
        </Row>
        <Text fontSize={10} color={DIM}>
          DSL: <Text color={TEXT}>{`proc:ram:${child.pid || '<pid>'}:>:${threshold}`}</Text>
        </Text>
      </Col>

      {/* Live readout */}
      <Col style={{ gap: 8, padding: 16, backgroundColor: PANEL_BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
        <Text fontSize={12} color={ACCENT} style={{ fontWeight: 'bold' }}>child</Text>
        <StatRow label="pid" value={child.pid > 0 ? String(child.pid) : '(starting)'} />
        <StatRow label="state" value={child.state} color={stateColor} />
        <StatRow label="rss" value={latestSample ? `${fmtBytes(ramBytes)} (${(ramPct * 100).toFixed(2)}%)` : '—'} color={OK} />
        <StatRow label="vsize" value={latestSample ? fmtBytes(latestSample.vsize) : '—'} />
        <StatRow label="last stdout" value={lastChildLine || '—'} color={DIM} />
      </Col>

      {/* Kill log */}
      <Col style={{ gap: 8, padding: 16, backgroundColor: PANEL_BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Text fontSize={12} color={ACCENT} style={{ fontWeight: 'bold' }}>kill log</Text>
          <Text fontSize={11} color={DIM}>({killLog.length} {killLog.length === 1 ? 'entry' : 'entries'})</Text>
        </Row>
        {killLog.length === 0 ? (
          <Text fontSize={11} color={DIM}>no kills yet — pick a threshold and click "Leak 10 MB/s" to see one fire.</Text>
        ) : (
          <Col style={{ gap: 4 }}>
            {killLog.map((k, i) => (
              <Row key={k.at + ':' + i} style={{ gap: 12, alignItems: 'center', height: 22 }}>
                <Box style={{ width: 80, height: 22, justifyContent: 'center' }}>
                  <Text fontSize={11} color={DIM}>{fmtTime(k.at)}</Text>
                </Box>
                <Box style={{ width: 60, height: 22, justifyContent: 'center' }}>
                  <Text fontSize={11} color={k.signal === 'SIGKILL' ? DANGER : WARN} style={{ fontWeight: 'bold' }}>{k.signal}</Text>
                </Box>
                <Box style={{ width: 60, height: 22, justifyContent: 'center' }}>
                  <Text fontSize={10} color={DIM}>pid {k.pid}</Text>
                </Box>
                <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, height: 22, justifyContent: 'center' }}>
                  <Text fontSize={11} color={TEXT}>{k.reason}</Text>
                </Box>
              </Row>
            ))}
          </Col>
        )}
      </Col>

      {/* Manual signals */}
      <Row style={{ gap: 10, flexWrap: 'wrap' }}>
        <Btn color={WARN} onPress={() => { if (child.pid > 0) proc.kill(child.pid, 'SIGSTOP'); }}>
          Freeze (SIGSTOP)
        </Btn>
        <Btn color={OK} onPress={() => { if (child.pid > 0) proc.kill(child.pid, 'SIGCONT'); }}>
          Resume (SIGCONT)
        </Btn>
        <Btn color={DANGER} onPress={() => recordKill('manual', 'SIGTERM')}>
          Kill manually
        </Btn>
      </Row>

      <Text fontSize={10} color={DIM}>
        Demo: pick threshold = 100MB → click "Leak 10 MB/s" → ~10s later watch the kill fire. Switch back to Heartbeat → "Freeze" → wait 30s for idle trigger.
      </Text>
    </Col>
  );
}
