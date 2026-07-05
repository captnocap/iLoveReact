// editors/workbench/requests/SecretaryBar.tsx — the SECRETARY's UI strip
// (REQSEC-0607): a one-chip async run over the framework's EXISTING
// useAssistant wiring (claude_code subprocess — "can do it for free
// effectively"). Armed by a CLICK (the ChatTab lazy-arm precedent: opening
// the requests tab never spawns a model process), one run then BATCHES
// THROUGH THE WHOLE UNTAGGED QUEUE — bounded turns of SECRETARY_BATCH,
// looping until nextBatch() comes back empty (USER FINDING: "225 untagged
// and then running it says 10/12" — one click must chew the queue, not one
// batch). Entries the model stays unsure about are marked attempted for the
// run so they never re-queue in a loop; they stay untouched (nada) and a
// later run may retry them. Confident tags persist via store.applyTags —
// the same tagRequest door the CLI uses. Failed / absent model → the run
// stands down with its tally; the board works untagged forever.

import { useEffect, useRef, useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/primitives';
import { useAssistant } from '@reactjit/hooks/useAssistant';
import { callHost, hasHost } from '@reactjit/ffi';
import { accentFor } from '../../../shell/workbench.cls';
import { buildSecretaryPrompt, parseSecretaryReply, nextBatch, untaggedEntries } from './secretary';
import type { RequestsStore } from './store';

const MONO = 'monospace';
// categorization is a small-model job — haiku keeps the secretary cheap
const SECRETARY_MODEL = 'claude-haiku-4-5';

function repoCwd(): string {
  if (hasHost('__cwd')) {
    try {
      const v = callHost<string>('__cwd', '');
      if (typeof v === 'string' && v.length > 0) return v;
    } catch { /* ignore */ }
  }
  return '/home/siah/creative/reactjit';
}

export function SecretaryBar(props: { store: RequestsStore }) {
  const { store } = props;
  const [armed, setArmed] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  // the run tally drives the live chip label, so it's state, not refs
  const [tally, setTally] = useState({ tagged: 0, unsure: 0 });
  const assistant = useAssistant({
    backend: armed ? 'claude_code' : undefined,
    cwd: armed ? repoCwd() : undefined,
    model: SECRETARY_MODEL,
    pollMs: 250,
    persistAcrossUnmount: false,
  });
  const batchRef = useRef<string[]>([]);
  const attemptedRef = useRef<Set<string>>(new Set());
  const askedRef = useRef(false);
  const seenRef = useRef(0);
  const replyRef = useRef('');

  const allRecords = () => store.rowsFor('all').concat(store.rowsFor('dispatches'), store.rowsFor('one-offs'));
  const untagged = untaggedEntries(allRecords(), Infinity).length;

  const standDown = (finalReport: string) => {
    setReport(finalReport);
    askedRef.current = false;
    setArmed(false);
    assistant.close();
  };

  // armed + worker idle → send the NEXT batch; the run only ends when the
  // queue (minus this run's attempts) is drained
  useEffect(() => {
    if (!armed || askedRef.current || !assistant.ready()) return;
    const batch = nextBatch(allRecords(), attemptedRef.current);
    if (batch.length === 0) {
      standDown(tally.tagged + tally.unsure === 0
        ? 'nothing untagged'
        : `done — ${tally.tagged} tagged · ${tally.unsure} unsure (untouched)`);
      return;
    }
    batchRef.current = batch.map((record) => record.id);
    askedRef.current = true;
    if (!assistant.ask(buildSecretaryPrompt(batch))) {
      standDown('secretary unavailable — board works untagged');
    }
  }, [assistant.phase, armed, tally]);

  // fold the reply; on completion, persist confident tags and roll into the
  // next batch (the phase flip back to idle re-fires the sender above)
  useEffect(() => {
    for (let i = seenRef.current; i < assistant.events.length; i += 1) {
      const event = assistant.events[i];
      if (event.kind === 'assistant_message' && event.text) replyRef.current += event.text;
      if (event.kind === 'completion') {
        const tagsById = parseSecretaryReply(replyRef.current, batchRef.current);
        let tagged = 0;
        for (const [id, tags] of Object.entries(tagsById)) {
          try { store.applyTags(id, tags); tagged += 1; } catch { /* unsure → nada */ }
        }
        for (const id of batchRef.current) attemptedRef.current.add(id); // unsure never re-queues this run
        setTally((prev) => ({ tagged: prev.tagged + tagged, unsure: prev.unsure + (batchRef.current.length - tagged) }));
        replyRef.current = '';
        askedRef.current = false; // the sender effect picks up the next batch
      }
      if (event.kind === 'error_') {
        standDown(`secretary failed mid-run — ${tally.tagged} tagged so far; board works untagged`);
      }
    }
    seenRef.current = assistant.events.length;
  }, [assistant.events]);

  const busy = armed && (assistant.phase === 'starting' || assistant.phase === 'streaming' || assistant.phase === 'idle');
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: accentFor('controlBorder'), backgroundColor: accentFor('surface') }}>
      <Pressable
        onPress={() => {
          if (busy) return;
          attemptedRef.current = new Set();
          setTally({ tagged: 0, unsure: 0 });
          setReport(null);
          setArmed(true);
        }}
        style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderRadius: 4, borderWidth: 1, borderColor: accentFor('controlBorder'), backgroundColor: accentFor('bgElevated') }}
      >
        <Text fontSize={10} color={accentFor(busy ? 'textFaint' : 'info')} style={{ fontFamily: MONO, fontWeight: 800 }}>
          {busy ? `🏷 secretary working… ${tally.tagged} tagged · ${untagged} left` : '🏷 run secretary'}
        </Text>
      </Pressable>
      <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: MONO }}>
        {`${untagged} untagged`}
      </Text>
      {report ? (
        <Text fontSize={10} color={accentFor('textFaint')} style={{ fontFamily: MONO }}>{report}</Text>
      ) : null}
      {assistant.error && armed ? (
        <Text fontSize={10} color={accentFor('warning')} style={{ fontFamily: MONO }}>{`model unavailable — untagged is fine (${assistant.error.slice(0, 60)})`}</Text>
      ) : null}
    </Box>
  );
}
