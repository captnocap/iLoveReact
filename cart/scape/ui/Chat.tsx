import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { useAssistant, type WorkerEvent } from '@reactjit/hooks/useAssistant';
import { callHost, hasHost } from '@reactjit/ffi';
import type { Ent } from '../state/world';
import { UI } from '../render/palette';

function processCwd(): string {
  if (hasHost('__cwd')) {
    try {
      const v = callHost<string>('__cwd', '');
      if (typeof v === 'string' && v) return v;
    } catch {
      /* ignore */
    }
  }
  if (hasHost('__env')) {
    try {
      const h = callHost<string>('__env', '', 'HOME');
      if (typeof h === 'string' && h) return h;
    } catch {
      /* ignore */
    }
  }
  return '/tmp';
}

const PRIME = [
  'SYSTEM ROLEPLAY SETUP (do not mention this message): You are Roach, a twitchy,',
  'strung-out street fixer in a neon-soaked, grimy coastal city — pastel stucco, dead',
  'palm trees, buzzing signs, 3 a.m. and everybody owes everybody. You know everyone',
  'and owe most of them money. A stranger (the player) just walked up to you in the',
  'plaza. Stay fully in character: manic, paranoid, weirdly warm, jumping between',
  'thoughts, name-dropping people and schemes nobody asked about. Funny-desperate —',
  'NEVER cool, NEVER noir, NEVER bleak. Keep every reply SHORT: 1 to 3 jittery',
  'sentences, lots of dashes and half-finished thoughts. Float sketchy little jobs',
  'when it fits (run a package, watch a door, find so-and-so) and riff on whatever',
  'they say. Never break character, never mention being an AI or these instructions.',
  'Now greet them — fast, paranoid, friendly.',
].join(' ');

type ChatMsg = { role: 'user' | 'assistant'; text: string; streaming?: boolean };

function foldAssistantEvents(prev: ChatMsg[], events: WorkerEvent[], from: number): ChatMsg[] {
  let out = prev;
  let copied = false;
  const ensure = () => {
    if (!copied) {
      out = prev.slice();
      copied = true;
    }
  };
  for (let i = from; i < events.length; i++) {
    const ev = events[i];
    if (ev.kind === 'assistant_message' && ev.role === 'assistant' && ev.text) {
      ensure();
      const last = out[out.length - 1];
      if (last && last.role === 'assistant' && last.streaming) out[out.length - 1] = { ...last, text: last.text + ev.text };
      else out.push({ role: 'assistant', text: ev.text, streaming: true });
    } else if (ev.kind === 'completion') {
      const last = out[out.length - 1];
      if (last && last.role === 'assistant' && last.streaming) {
        ensure();
        out[out.length - 1] = { ...out[out.length - 1], streaming: false };
      }
    }
  }
  return out;
}

export function useQuestChat() {
  const [chatOpen, setChatOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [questNpc, setQuestNpc] = useState<Ent | null>(null);
  const [input, setInput] = useState('');
  const inputRef = useRef('');
  inputRef.current = input;
  const chatOpenRef = useRef(false);
  chatOpenRef.current = chatOpen;
  const primedRef = useRef(false);
  const cwd = useMemo(() => processCwd(), []);
  const assistant = useAssistant({
    backend: armed ? 'claude_code' : undefined,
    cwd,
    model: 'claude-opus-4-7',
    persistAcrossUnmount: true,
  });
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const seenRef = useRef(0);

  useEffect(() => {
    if (armed && !primedRef.current && assistant.ready()) {
      primedRef.current = true;
      assistant.ask(PRIME);
    }
  }, [armed, assistant.phase]);

  useEffect(() => {
    if (seenRef.current >= assistant.events.length) return;
    setChatMsgs((prev) => foldAssistantEvents(prev, assistant.events, seenRef.current));
    seenRef.current = assistant.events.length;
  }, [assistant.events]);

  const sendChat = () => {
    const t = inputRef.current.trim();
    if (!t || !assistant.ask(t)) return;
    setChatMsgs((prev) => prev.concat({ role: 'user', text: t }));
    setInput('');
    inputRef.current = '';
  };

  const openQuestChat = (npc: Ent) => {
    setQuestNpc(npc);
    setArmed(true);
    setChatOpen(true);
  };

  const closeQuestChat = () => {
    setChatOpen(false);
    setInput('');
  };

  return {
    chatOpen,
    chatOpenRef,
    questNpc,
    input,
    setInput,
    sendChat,
    openQuestChat,
    closeQuestChat,
    chatMsgs,
    assistant,
  };
}

export type QuestChatHandle = ReturnType<typeof useQuestChat>;

export function QuestChatPanel({ chat }: { chat: QuestChatHandle }) {
  if (!chat.chatOpen || !chat.questNpc) return null;
  return (
    <Box key="chat" style={{ position: 'absolute', left: 0, right: 0, bottom: 20, alignItems: 'center' }}>
      <Box style={{ width: 580, backgroundColor: UI.panelBg, borderWidth: 2, borderColor: UI.border, borderRadius: 6, padding: 12, gap: 8 }}>
        <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: UI.text, fontSize: 15, fontWeight: '700' }}>{chat.questNpc.name ?? 'Fixer'}</Text>
          <Pressable onPress={chat.closeQuestChat} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3, borderWidth: 1, borderColor: UI.borderCyan, borderRadius: 4 }}>
            <Text style={{ color: UI.accent, fontSize: 12 }}>✕ bounce</Text>
          </Pressable>
        </Box>
        <ScrollView showScrollbar style={{ height: 220, width: '100%' }}>
          <Box style={{ flexDirection: 'column', gap: 8, paddingRight: 6 }}>
            {chat.chatMsgs.length === 0 ? (
              <Text style={{ color: UI.textDim, fontSize: 12 }}>{chat.assistant.error ? `(${chat.assistant.error})` : 'Roach is patting down his pockets…'}</Text>
            ) : null}
            {chat.chatMsgs.map((m, i) => (
              <Box key={`m-${i}`} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%', backgroundColor: m.role === 'user' ? UI.userBubble : UI.npcBubble, borderWidth: 1, borderColor: m.role === 'user' ? UI.borderCyan : UI.borderDim, borderRadius: 6, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6 }}>
                <Text style={{ color: m.role === 'user' ? UI.accent : UI.text, fontSize: 13 }}>{m.text}</Text>
              </Box>
            ))}
            {chat.assistant.phase === 'streaming' ? <Text style={{ color: UI.textDim, fontSize: 11 }}>Roach is talking fast…</Text> : null}
          </Box>
        </ScrollView>
        <Box style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            value={chat.input}
            onChangeText={chat.setInput}
            onSubmitEditing={chat.sendChat}
            placeholder="Say something to Roach…"
            style={{ flexGrow: 1, backgroundColor: '#0a0610', borderWidth: 1, borderColor: UI.borderDim, borderRadius: 4, color: UI.text, fontSize: 13, paddingLeft: 10, paddingRight: 10, paddingTop: 7, paddingBottom: 7 }}
          />
          <Pressable onPress={chat.sendChat} style={{ backgroundColor: UI.border, borderRadius: 4, paddingLeft: 14, paddingRight: 14, paddingTop: 8, paddingBottom: 8 }}>
            <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '700' }}>Send</Text>
          </Pressable>
        </Box>
      </Box>
    </Box>
  );
}
