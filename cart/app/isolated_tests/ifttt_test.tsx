import { useState } from 'react';
import { Box, Col, Pressable, Row, ScrollView, Text } from '@reactjit/runtime/primitives';
import { busEmit, getSharedState, setSharedState, useIFTTT, dispatchClaudeEvent } from '@reactjit/runtime/hooks/useIFTTT';
import { useHost } from '@reactjit/runtime/hooks/useHost';

// Standalone test cart for useIFTTT. Each row exercises one trigger or action
// kind and shows fire count + last payload so you can visually confirm it works.

const ROW_BG = '#101824';
const PAGE_BG = '#090d13';
const ACCENT = '#5db4ff';
const OK = '#7ed957';
const TEXT = '#eef2f8';
const DIM = '#7d8a9a';
const BORDER = '#18202b';

function fmtTs(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function StatRow({ name, hint, fired, lastAt, payload }: { name: string; hint: string; fired: number; lastAt: number; payload?: any }) {
  const payloadStr = payload === undefined || payload === null ? '' : typeof payload === 'object' ? JSON.stringify(payload).slice(0, 60) : String(payload);
  return (
    <Row
      style={{
        paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8, gap: 12,
        backgroundColor: ROW_BG, borderRadius: 6, borderWidth: 1, borderColor: BORDER,
        alignItems: 'center',
      }}
    >
      <Box style={{ width: 240, gap: 2 }}>
        <Text fontSize={11} color={TEXT} style={{ fontWeight: 'bold' }}>{name}</Text>
        <Text fontSize={9} color={DIM}>{hint}</Text>
      </Box>
      <Box style={{ width: 90 }}>
        <Text fontSize={11} color={fired > 0 ? OK : DIM}>fired: {fired}</Text>
      </Box>
      <Box style={{ width: 130 }}>
        <Text fontSize={10} color={DIM}>at: {fmtTs(lastAt)}</Text>
      </Box>
      <Box style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        <Text fontSize={10} color={DIM} numberOfLines={1}>{payloadStr ? `payload: ${payloadStr}` : ''}</Text>
      </Box>
    </Row>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <Col style={{ gap: 6 }}>
      <Text fontSize={12} color={ACCENT} style={{ fontWeight: 'bold' }}>{title}</Text>
      <Col style={{ gap: 4 }}>{children}</Col>
    </Col>
  );
}

function Btn({ onPress, children, color }: any) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6,
        borderRadius: 6, backgroundColor: color ?? ACCENT,
      }}
    >
      <Text fontSize={11} color="#06121f" style={{ fontWeight: 'bold' }}>{children}</Text>
    </Pressable>
  );
}

export default function IftttTestCart() {
  // Force re-render so we see updated fire counts.
  const [, tick] = useState(0);
  const bump = () => tick((n) => (n + 1) & 0xffff);

  // Host the Claude Code hook bus listener — every POST from .claude/hooks/ifttt-bus.sh
  // (configured in .claude/ifttt-transports.json) lands here and gets dispatched
  // onto the system:claude:* bus.
  useHost({
    kind: 'http',
    port: 7421,
    onRequest: (req, res) => {
      try {
        if (req.body) dispatchClaudeEvent(req.body);
      } catch { /* swallow */ }
      res.send(204, 'text/plain', '');
    },
  });

  // ── Trigger row hooks (each rule sees its own fired/lastEvent) ──────

  const mount = useIFTTT('mount', (e) => { bump(); console.log('[ifttt-test] mount fired', e); });

  const space = useIFTTT('key:space', (e) => { bump(); console.log('[ifttt-test] key:space', e?.key); });
  const spaceUp = useIFTTT('key:up:space', (e) => { bump(); console.log('[ifttt-test] key:up:space'); });
  const ctrlS = useIFTTT('key:ctrl+s', (e) => { bump(); console.log('[ifttt-test] ctrl+s'); });

  const timerEvery = useIFTTT('timer:every:2000', () => { bump(); });
  const timerOnce = useIFTTT('timer:once:5000', () => { bump(); console.log('[ifttt-test] one-shot fired'); });

  // state:* trigger — fires when shared state 'flag' equals true.
  const stateMatch = useIFTTT('state:flag:true', (v) => { bump(); console.log('[ifttt-test] state:flag:true', v); });

  // Custom bus event 'demo' — chain target.
  const busListener = useIFTTT('demo', (payload) => { bump(); console.log('[ifttt-test] bus demo', payload); });

  // System clipboard — fires when system clipboard changes (any app).
  const sysClipboard = useIFTTT('system:clipboard', (text) => { bump(); console.log('[ifttt-test] clipboard ←', String(text).slice(0, 80)); });

  // System signals — OS-level pushes from Zig (focus, drop, cursor, frame timing, mem).
  const sysFocus = useIFTTT('system:focus', () => { bump(); });
  const sysBlur = useIFTTT('system:blur', () => { bump(); });
  const sysDrop = useIFTTT('system:fileDropped', (path) => { bump(); console.log('[ifttt-test] dropped:', path); });
  const sysCursor = useIFTTT('system:cursor:move', () => { bump(); });
  const sysSlow = useIFTTT('system:slowFrame', (e) => { bump(); console.log('[ifttt-test] slowFrame', e); });
  const sysHang = useIFTTT('system:hang', (e) => { bump(); console.log('[ifttt-test] hang', e); });
  const sysRam = useIFTTT('system:ram', () => { bump(); });
  const sysVram = useIFTTT('system:vram', () => { bump(); });
  const sysError = useIFTTT('system:error', (e) => { bump(); console.log('[ifttt-test] error caught', e?.message); });

  // Claude Code hooks — wired via .claude/hooks/ifttt-bus.sh + framework/claude_watch.zig
  const claudeAny = useIFTTT('system:claude', (e) => { bump(); console.log('[ifttt-test] claude', e?.phase, e?.tool, e?.cmd ?? e?.file ?? ''); });
  const claudeBash = useIFTTT('system:claude:bash', () => { bump(); });
  const claudeEdit = useIFTTT('system:claude:edit', () => { bump(); });
  const claudeWrite = useIFTTT('system:claude:write', () => { bump(); });
  const claudeRead = useIFTTT('system:claude:read', () => { bump(); });
  const claudePre = useIFTTT('system:claude:pretooluse', () => { bump(); });
  const claudePost = useIFTTT('system:claude:posttooluse', () => { bump(); });
  const claudeStop = useIFTTT('system:claude:stop', () => { bump(); });
  const claudeStopFail = useIFTTT('system:claude:stopfailure', () => { bump(); });
  const claudePostFail = useIFTTT('system:claude:posttoolusefailure', () => { bump(); });
  const claudePrompt = useIFTTT('system:claude:userpromptsubmit', () => { bump(); });
  const claudeTaskCreated = useIFTTT('system:claude:taskcreated', () => { bump(); });
  const claudeTaskCompleted = useIFTTT('system:claude:taskcompleted', () => { bump(); });
  const claudeSubStart = useIFTTT('system:claude:subagentstart', () => { bump(); });
  const claudeSubStop = useIFTTT('system:claude:subagentstop', () => { bump(); });
  const claudePreCompact = useIFTTT('system:claude:precompact', () => { bump(); });
  const claudeSession = useIFTTT('system:claude:sessionstart', () => { bump(); });
  const claudePermDenied = useIFTTT('system:claude:permissiondenied', () => { bump(); });

  // Function trigger — fires when shared 'counter' > 3 (false→true edge).
  const counter = (getSharedState('counter') as number | undefined) ?? 0;
  const fnTrigger = useIFTTT(() => counter > 3, () => { bump(); console.log('[ifttt-test] fn-trigger fired counter>', 3); });

  // String-action samples (fired by user via Btn below)
  const sendAction = useIFTTT('__manual_send', 'send:demo');
  const stateSetAction = useIFTTT('__manual_state', 'state:set:flag:true');
  const stateToggleAction = useIFTTT('__manual_toggle', 'state:toggle:darkmode');
  const logAction = useIFTTT('__manual_log', 'log:hello from log action');
  const clipAction = useIFTTT('__manual_clip', 'clipboard:copied via ifttt');

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: PAGE_BG, padding: 16, gap: 16 }}>
      <Col style={{ gap: 4 }}>
        <Text fontSize={14} color={TEXT} style={{ fontWeight: 'bold' }}>useIFTTT — manual test surface</Text>
        <Text fontSize={10} color={DIM}>Each row is one rule. "fired" should bump when the trigger fires. Console logs go to dev host stdout.</Text>
      </Col>

      <ScrollView style={{ flexGrow: 1, flexBasis: 0 }} contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
      <Section title="String triggers">
        <StatRow name="'mount'" hint="should be 1 after first render" fired={mount.fired} lastAt={mount.lastFiredAt} />
        <StatRow name="'key:space'" hint="press Space anywhere" fired={space.fired} lastAt={space.lastFiredAt} payload={space.lastEvent?.key} />
        <StatRow name="'key:up:space'" hint="release Space" fired={spaceUp.fired} lastAt={spaceUp.lastFiredAt} payload={spaceUp.lastEvent?.key} />
        <StatRow name="'key:ctrl+s'" hint="Ctrl+S combo" fired={ctrlS.fired} lastAt={ctrlS.lastFiredAt} payload={ctrlS.lastEvent?.key} />
        <StatRow name="'timer:every:2000'" hint="auto-fires every 2s" fired={timerEvery.fired} lastAt={timerEvery.lastFiredAt} />
        <StatRow name="'timer:once:5000'" hint="fires exactly once after 5s" fired={timerOnce.fired} lastAt={timerOnce.lastFiredAt} />
        <StatRow name="'state:flag:true'" hint="press [set flag=true] below" fired={stateMatch.fired} lastAt={stateMatch.lastFiredAt} payload={stateMatch.lastEvent} />
        <StatRow name="'demo' (raw bus event)" hint="press [send demo] below" fired={busListener.fired} lastAt={busListener.lastFiredAt} payload={busListener.lastEvent} />
        <StatRow name="'system:clipboard'" hint="copy text in ANY app — should fire" fired={sysClipboard.fired} lastAt={sysClipboard.lastFiredAt} payload={String(sysClipboard.lastEvent ?? '').slice(0, 60)} />
      </Section>

      <Section title="System signals (OS push from Zig)">
        <StatRow name="'system:focus'" hint="click into this window after another" fired={sysFocus.fired} lastAt={sysFocus.lastFiredAt} payload={sysFocus.lastEvent} />
        <StatRow name="'system:blur'" hint="click out of this window" fired={sysBlur.fired} lastAt={sysBlur.lastFiredAt} payload={sysBlur.lastEvent} />
        <StatRow name="'system:fileDropped'" hint="drag a file from a file manager onto window" fired={sysDrop.fired} lastAt={sysDrop.lastFiredAt} payload={sysDrop.lastEvent} />
        <StatRow name="'system:cursor:move'" hint="move mouse anywhere on screen (~60Hz max)" fired={sysCursor.fired} lastAt={sysCursor.lastFiredAt} payload={sysCursor.lastEvent} />
        <StatRow name="'system:slowFrame'" hint="any frame > 32ms (resize / heavy paint)" fired={sysSlow.fired} lastAt={sysSlow.lastFiredAt} payload={sysSlow.lastEvent} />
        <StatRow name="'system:hang'" hint="3+ consecutive slow frames; recovery=count:0" fired={sysHang.fired} lastAt={sysHang.lastFiredAt} payload={sysHang.lastEvent} />
        <StatRow name="'system:ram'" hint="updates ~1Hz when /proc/meminfo changes" fired={sysRam.fired} lastAt={sysRam.lastFiredAt} payload={sysRam.lastEvent} />
        <StatRow name="'system:vram'" hint="updates ~1Hz from /sys/class/drm/cardN" fired={sysVram.fired} lastAt={sysVram.lastFiredAt} payload={sysVram.lastEvent} />
        <StatRow name="'system:error'" hint="taps console.error — fires on any runtime error" fired={sysError.fired} lastAt={sysError.lastFiredAt} payload={sysError.lastEvent?.message} />
      </Section>

      <Section title="Claude Code hooks (cross-session bus)">
        <StatRow name="'system:claude'" hint="every Pre/PostToolUse from any Claude in this repo" fired={claudeAny.fired} lastAt={claudeAny.lastFiredAt} payload={claudeAny.lastEvent ? `${claudeAny.lastEvent.phase}/${claudeAny.lastEvent.tool} ${claudeAny.lastEvent.cmd ?? claudeAny.lastEvent.file ?? ''}` : ''} />
        <StatRow name="'system:claude:bash'" hint="any Claude ran a Bash command" fired={claudeBash.fired} lastAt={claudeBash.lastFiredAt} payload={claudeBash.lastEvent?.cmd} />
        <StatRow name="'system:claude:edit'" hint="any Claude edited a file" fired={claudeEdit.fired} lastAt={claudeEdit.lastFiredAt} payload={claudeEdit.lastEvent?.file} />
        <StatRow name="'system:claude:write'" hint="any Claude wrote a file" fired={claudeWrite.fired} lastAt={claudeWrite.lastFiredAt} payload={claudeWrite.lastEvent?.file} />
        <StatRow name="'system:claude:read'" hint="any Claude read a file" fired={claudeRead.fired} lastAt={claudeRead.lastFiredAt} payload={claudeRead.lastEvent?.file} />
        <StatRow name="'system:claude:pretooluse'" hint="every PreToolUse" fired={claudePre.fired} lastAt={claudePre.lastFiredAt} payload={claudePre.lastEvent?.tool} />
        <StatRow name="'system:claude:posttooluse'" hint="every PostToolUse (has exit_code)" fired={claudePost.fired} lastAt={claudePost.lastFiredAt} payload={claudePost.lastEvent?.tool} />
        <StatRow name="'system:claude:posttoolusefailure'" hint="tool call failed" fired={claudePostFail.fired} lastAt={claudePostFail.lastFiredAt} payload={claudePostFail.lastEvent?.tool} />
        <StatRow name="'system:claude:stop'" hint="any session finished a turn" fired={claudeStop.fired} lastAt={claudeStop.lastFiredAt} payload={claudeStop.lastEvent?.session} />
        <StatRow name="'system:claude:stopfailure'" hint="🚨 turn ended in failure — wake Ralph" fired={claudeStopFail.fired} lastAt={claudeStopFail.lastFiredAt} payload={claudeStopFail.lastEvent?.session} />
        <StatRow name="'system:claude:userpromptsubmit'" hint="user just sent a message in any session" fired={claudePrompt.fired} lastAt={claudePrompt.lastFiredAt} payload={claudePrompt.lastEvent?.session} />
        <StatRow name="'system:claude:taskcreated'" hint="any session created a TodoWrite/Task" fired={claudeTaskCreated.fired} lastAt={claudeTaskCreated.lastFiredAt} payload={claudeTaskCreated.lastEvent?.session} />
        <StatRow name="'system:claude:taskcompleted'" hint="any session marked a task complete" fired={claudeTaskCompleted.fired} lastAt={claudeTaskCompleted.lastFiredAt} payload={claudeTaskCompleted.lastEvent?.session} />
        <StatRow name="'system:claude:subagentstart'" hint="any session spawned a subagent" fired={claudeSubStart.fired} lastAt={claudeSubStart.lastFiredAt} payload={claudeSubStart.lastEvent?.session} />
        <StatRow name="'system:claude:subagentstop'" hint="subagent returned" fired={claudeSubStop.fired} lastAt={claudeSubStop.lastFiredAt} payload={claudeSubStop.lastEvent?.session} />
        <StatRow name="'system:claude:precompact'" hint="any session about to compact context" fired={claudePreCompact.fired} lastAt={claudePreCompact.lastFiredAt} payload={claudePreCompact.lastEvent?.session} />
        <StatRow name="'system:claude:sessionstart'" hint="new Claude session opened" fired={claudeSession.fired} lastAt={claudeSession.lastFiredAt} payload={claudeSession.lastEvent?.session} />
        <StatRow name="'system:claude:permissiondenied'" hint="user denied a permission prompt" fired={claudePermDenied.fired} lastAt={claudePermDenied.lastFiredAt} payload={claudePermDenied.lastEvent?.tool} />
      </Section>

      <Section title="Function trigger">
        <StatRow name="() => counter > 3" hint="press [+counter] until > 3 — fires once on edge" fired={fnTrigger.fired} lastAt={fnTrigger.lastFiredAt} payload={`counter=${counter}`} />
      </Section>

      <Section title="String actions (fire via buttons)">
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          <Btn onPress={() => { sendAction.fire(); bump(); }}>send:demo</Btn>
          <Btn onPress={() => { stateSetAction.fire(); bump(); }} color="#f5c95b">state:set:flag:true</Btn>
          <Btn onPress={() => { stateToggleAction.fire(); bump(); }} color="#f5c95b">state:toggle:darkmode</Btn>
          <Btn onPress={() => { logAction.fire(); bump(); }} color="#aaa">log:hello</Btn>
          <Btn onPress={() => { clipAction.fire(); bump(); }} color="#aaa">clipboard:copied</Btn>
        </Row>
        <Text fontSize={10} color={DIM}>shared state: flag={String(getSharedState('flag'))}, darkmode={String(getSharedState('darkmode'))}, counter={counter}</Text>
      </Section>

      <Section title="Direct mutators (no IFTTT — plumbing helpers)">
        <Row style={{ gap: 8, flexWrap: 'wrap' }}>
          <Btn onPress={() => { setSharedState('counter', counter + 1); bump(); }}>+counter</Btn>
          <Btn onPress={() => { setSharedState('counter', 0); setSharedState('flag', false); bump(); }} color="#aaa">reset state</Btn>
          <Btn onPress={() => { busEmit('demo', { from: 'direct busEmit', t: Date.now() }); }} color={ACCENT}>busEmit('demo')</Btn>
        </Row>
      </Section>
      </ScrollView>
    </Col>
  );
}
