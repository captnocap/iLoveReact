// rule-engine-smoke — exercises the supervisor IFTTT loop without
// touching the DB. Confirms:
//
//   1. ifttt-supervisor's source / action registrations are present.
//   2. Emitting on 'event:append' (the bus channel notifyRowChange
//      would emit on every Event row insert) fires a useIFTTT
//      subscription with spec 'event:<kind>'.
//   3. Wildcard specs ('event:goal.*') match correctly.
//   4. Action runners route to 'supervisor:*' bus channels.
//
// Run via `./scripts/ship rule-engine-smoke` or under the dev host.
// Click the buttons; watch fire counts increment.

import { useEffect, useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '@reactjit/runtime/primitives';
import { busEmit, useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';
import { subscribe } from '@reactjit/runtime/ffi';
import { listIfttSources, listIfttActions } from '@reactjit/runtime/hooks/ifttt-registry';
import '@reactjit/runtime/hooks/ifttt-supervisor';

const ROW_BG = '#101824';
const PAGE_BG = '#090d13';
const ACCENT = '#5db4ff';
const OK = '#7ed957';
const TEXT = '#eef2f8';
const DIM = '#7d8a9a';
const BORDER = '#18202b';

function Card({ title, children }: { title: string; children: any }) {
  return (
    <Col
      style={{
        backgroundColor: ROW_BG, borderRadius: 8, borderWidth: 1,
        borderColor: BORDER, padding: 12, gap: 8, minWidth: 0,
      }}
    >
      <Text fontSize={12} color={TEXT} style={{ fontWeight: 'bold' }}>{title}</Text>
      {children}
    </Col>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <Row style={{ gap: 8, alignItems: 'center' }}>
      <Box style={{ width: 200 }}>
        <Text fontSize={11} color={DIM}>{label}</Text>
      </Box>
      <Text fontSize={11} color={accent ? OK : TEXT}>{String(value)}</Text>
    </Row>
  );
}

function Button({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Pressable
      onPress={onClick}
      style={{
        paddingLeft: 12, paddingRight: 12, paddingTop: 6, paddingBottom: 6,
        backgroundColor: ACCENT, borderRadius: 4,
      }}
    >
      <Text fontSize={11} color="#021124" style={{ fontWeight: 'bold' }}>{label}</Text>
    </Pressable>
  );
}

export default function RuleEngineSmokeCart() {
  // Subscriptions under test
  const exact = useIFTTT('event:goal.reframed', (e: any) => {
    console.log('[smoke] exact fired', e);
  });
  const wildcard = useIFTTT('event:task.*', (e: any) => {
    console.log('[smoke] wildcard fired', e);
  });
  const ruleFiring = useIFTTT('rule:smoke_rule.fired', (e: any) => {
    console.log('[smoke] rule fired', e);
  });
  const queueJob = useIFTTT('event:trigger.queue', 'queue-job:job_smoke');
  const flagPath = useIFTTT('event:trigger.flagpath', 'flag-pathology:pat_session_kill_pattern');

  // Capture the supervisor:* fan-out so we can assert action runners ran
  const [supervisorFires, setSupervisorFires] = useState<Record<string, number>>({});

  useEffect(() => {
    const channels = [
      'supervisor:queue-job',
      'supervisor:halt-run',
      'supervisor:flag-pathology',
      'supervisor:notify-user',
      'supervisor:fire-rule',
      'supervisor:invoke-verb',
    ];
    const subs = channels.map(ch =>
      subscribe(ch, (payload: any) => {
        setSupervisorFires(s => ({ ...s, [ch]: (s[ch] ?? 0) + 1 }));
        console.log(`[smoke] ${ch}`, payload);
      }),
    );
    return () => { subs.forEach(u => u()); };
  }, []);

  const sources = listIfttSources();
  const actions = listIfttActions();

  return (
    <Col style={{ flexGrow: 1, backgroundColor: PAGE_BG, padding: 16, gap: 12, color: TEXT }}>
      <Text fontSize={16} color={TEXT} style={{ fontWeight: 'bold' }}>
        Rule engine smoke
      </Text>
      <Text fontSize={11} color={DIM}>
        Click any button. Each emits a bus event the registered subscribers should
        catch. Fire counters bump on success. Console shows payloads.
      </Text>

      <Row style={{ gap: 12, flexWrap: 'wrap' }}>
        <Card title="Trigger: 'event:goal.reframed' (exact)">
          <Stat label="useIFTTT fired" value={exact.fired} accent={exact.fired > 0} />
          <Button
            label="Emit event:append { kind: 'goal.reframed' }"
            onClick={() => busEmit('event:append', { id: `evt_${Date.now()}`, kind: 'goal.reframed', payload: { goalId: 'goal_smoke' } })}
          />
        </Card>

        <Card title="Trigger: 'event:task.*' (wildcard)">
          <Stat label="useIFTTT fired" value={wildcard.fired} accent={wildcard.fired > 0} />
          <Button
            label="Emit event:append { kind: 'task.completed' }"
            onClick={() => busEmit('event:append', { id: `evt_${Date.now()}`, kind: 'task.completed', payload: { taskId: 'task_smoke' } })}
          />
          <Button
            label="Emit event:append { kind: 'task.failed' }"
            onClick={() => busEmit('event:append', { id: `evt_${Date.now()}`, kind: 'task.failed', payload: { taskId: 'task_smoke' } })}
          />
        </Card>

        <Card title="Trigger: 'rule:smoke_rule.fired'">
          <Stat label="useIFTTT fired" value={ruleFiring.fired} accent={ruleFiring.fired > 0} />
          <Button
            label="Emit rule:fired { ruleId: 'smoke_rule' }"
            onClick={() => busEmit('rule:fired', { id: `rfir_${Date.now()}`, ruleId: 'smoke_rule', triggeringEventId: 'evt_x' })}
          />
        </Card>

        <Card title="Action: 'queue-job:job_smoke'">
          <Stat label="useIFTTT fired" value={queueJob.fired} accent={queueJob.fired > 0} />
          <Stat label="supervisor:queue-job" value={supervisorFires['supervisor:queue-job'] ?? 0} accent={(supervisorFires['supervisor:queue-job'] ?? 0) > 0} />
          <Button
            label="Trigger via event:trigger.queue"
            onClick={() => busEmit('event:append', { id: `evt_${Date.now()}`, kind: 'trigger.queue' })}
          />
        </Card>

        <Card title="Action: 'flag-pathology:pat_session_kill_pattern'">
          <Stat label="useIFTTT fired" value={flagPath.fired} accent={flagPath.fired > 0} />
          <Stat label="supervisor:flag-pathology" value={supervisorFires['supervisor:flag-pathology'] ?? 0} accent={(supervisorFires['supervisor:flag-pathology'] ?? 0) > 0} />
          <Button
            label="Trigger via event:trigger.flagpath"
            onClick={() => busEmit('event:append', { id: `evt_${Date.now()}`, kind: 'trigger.flagpath' })}
          />
        </Card>
      </Row>

      <Card title={`Registered sources (${sources.length})`}>
        <Text fontSize={10} color={DIM}>{sources.join(', ')}</Text>
      </Card>
      <Card title={`Registered actions (${actions.length})`}>
        <Text fontSize={10} color={DIM}>{actions.join(', ')}</Text>
      </Card>
    </Col>
  );
}
