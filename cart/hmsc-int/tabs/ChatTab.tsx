// ChatTab — a block-based assistant chat over useAssistant (claude_code backend).
//
// The worker is "armed" lazily on the first send so opening the tab doesn't spawn
// a claude process. Events are folded into role blocks; a first message sent
// before the worker is ready is queued and flushed when it reaches idle.

import { useEffect, useRef, useState } from 'react';
import { Box, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { useAssistant, type WorkerEvent } from '@reactjit/hooks/useAssistant';

type ChatMsg = { role: 'user' | 'assistant'; text: string; streaming?: boolean };

function foldAssistantEvents(prev: ChatMsg[], events: WorkerEvent[], from: number): ChatMsg[] {
  let out = prev;
  let copied = false;
  const ensure = () => { if (!copied) { out = prev.slice(); copied = true; } };
  for (let i = from; i < events.length; i++) {
    const ev = events[i];
    if (ev.kind === 'assistant_message' && ev.role === 'assistant' && ev.text) {
      ensure();
      const last = out[out.length - 1];
      if (last && last.role === 'assistant' && last.streaming) out[out.length - 1] = { ...last, text: last.text + ev.text };
      else out.push({ role: 'assistant', text: ev.text, streaming: true });
    } else if (ev.kind === 'completion') {
      const last = out[out.length - 1];
      if (last && last.role === 'assistant' && last.streaming) { ensure(); out[out.length - 1] = { ...out[out.length - 1], streaming: false }; }
    }
  }
  return out;
}

export function ChatTab() {
  const [armed, setArmed] = useState(false);
  const assistant = useAssistant({ backend: armed ? 'claude_code' : undefined, persistAcrossUnmount: true });
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const seenRef = useRef(0);
  const pendingRef = useRef<string[]>([]);

  // Fold new worker events into message blocks.
  useEffect(() => {
    if (seenRef.current >= assistant.events.length) return;
    setMsgs((prev) => foldAssistantEvents(prev, assistant.events, seenRef.current));
    seenRef.current = assistant.events.length;
  }, [assistant.events]);

  // Flush any queued message once the worker is ready.
  useEffect(() => {
    if (!pendingRef.current.length || !assistant.ready()) return;
    const queued = pendingRef.current;
    pendingRef.current = [];
    for (const t of queued) assistant.ask(t);
  }, [assistant.phase]);

  const send = () => {
    const t = draft.trim();
    if (!t) return;
    setMsgs((prev) => prev.concat({ role: 'user', text: t }));
    setDraft('');
    if (!armed) setArmed(true);
    if (!assistant.ask(t)) pendingRef.current.push(t);
  };

  const busy = assistant.phase === 'starting' || assistant.phase === 'streaming';

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', backgroundColor: '#0a111d' }}>
      <ScrollView style={{ flexGrow: 1, height: '100%' }} contentContainerStyle={{ padding: 10, gap: 8 }}>
        {msgs.length === 0 ? (
          <Text fontSize={10} color="#3a4a63" style={{ fontFamily: 'monospace' }}>ask the assistant anything about this world…</Text>
        ) : null}
        {msgs.map((m, i) => (
          <Box key={`m-${i}`} style={{ gap: 3, borderLeftWidth: 2, borderLeftColor: m.role === 'user' ? '#38bdf8' : '#475569', paddingLeft: 8 }}>
            <Text fontSize={8} color={m.role === 'user' ? '#38bdf8' : '#64748b'} style={{ fontWeight: 800, letterSpacing: 1 }}>{m.role === 'user' ? 'YOU' : 'ASSISTANT'}</Text>
            <Text fontSize={12} color="#cbd5e1">{m.text}</Text>
          </Box>
        ))}
        {busy ? <Text fontSize={10} color="#475569" style={{ fontFamily: 'monospace' }}>…thinking</Text> : null}
        {assistant.error ? <Text fontSize={10} color="#fca5a5" style={{ fontFamily: 'monospace' }}>{assistant.error}</Text> : null}
      </ScrollView>
      <Box style={{ flexDirection: 'row', gap: 6, padding: 8, borderTopWidth: 1, borderTopColor: '#16202f' }}>
        <TextInput
          text={draft}
          onChangeText={setDraft}
          onSubmitEditing={send}
          placeholder="message…"
          style={{ flexGrow: 1, backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: '#27364a', borderRadius: 4, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, color: '#e2e8f0', fontSize: 12 }}
        />
        <Pressable onPress={send} style={{ paddingLeft: 12, paddingRight: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 4, borderWidth: 1, borderColor: '#22c55e', backgroundColor: '#0f3d2e' }}>
          <Text fontSize={11} color="#86efac" style={{ fontWeight: 700 }}>Send</Text>
        </Pressable>
      </Box>
    </Box>
  );
}
