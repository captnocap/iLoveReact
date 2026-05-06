import { useEffect, useRef, useState } from 'react';
import { Box, Col, Row, Text, Pressable, TextInput, ScrollView } from '@reactjit/runtime/primitives';
import { useAssistant } from '@reactjit/runtime/hooks/useAssistant';
import { parseIntent, Node } from '@reactjit/runtime/intent/parser';
import { RenderIntent } from '@reactjit/runtime/intent/render';
import { saveIntentCart } from '@reactjit/runtime/intent/save';

const BASE_URL = 'http://127.0.0.1:1234/v1';
const MODEL = 'gemma-4-e2b-uncensored-hauhaucs-aggressive';

const SYSTEM_PROMPT = `You respond to the user with an interactive chat surface, not prose.

Wrap your entire response in [ ... ]. Inside, compose a small tree from these tags ONLY:

  <Title>large heading text</Title>
  <Text>body paragraph text</Text>
  <Card>group related content in a padded surface</Card>
  <Row>arrange children horizontally</Row>
  <Col>arrange children vertically</Col>
  <List>one item per line</List>
  <Btn reply="what to send back when clicked">label shown to user</Btn>

Display tags (use freely to make the surface read like a real UI):

  <Badge tone=success>label</Badge>     // tones: neutral, success, warning, error, info — bare word, no quotes
  <Code lang=ts>...code text...</Code>  // formatted code block; lang is bare
  <Divider />                           // horizontal separator inside a Col
  <Kbd>Cmd+S</Kbd>                      // inline keyboard chip
  <Spacer size=md />                    // vertical/horizontal gap; size: sm, md, lg

Forms (use when collecting structured input):

  <Form>
    <Field name="fieldKey" label="Label shown above" placeholder="hint text" />
    <Field name="another" label="..." />
    <Submit reply="message template with {fieldKey} interpolation">Submit label</Submit>
  </Form>

Rules:
- Always wrap output in [ ... ].
- Use <Btn> for single-choice picks. Use <Form> when you need multiple values.
- A <Submit>'s reply attribute is a template — every {fieldKey} is replaced with that field's current value. Always use this so you control the format.
- The user will reply with the interpolated string. When you receive a form submission, respond with a confirmation card showing what was received.
- Plain text outside any tag is allowed for short prose.
- No other tags. No HTML. No markdown.

Form example, "ask about the user":
[<Col>
  <Title>Tell me about yourself</Title>
  <Form>
    <Field name="name" label="Your name" placeholder="Alice" />
    <Field name="role" label="What you do" placeholder="builder / designer / etc" />
    <Field name="goal" label="One thing you want to ship this week" />
    <Submit reply="FORM_SUBMITTED name={name} role={role} goal={goal}">Send</Submit>
  </Form>
</Col>]

When you then receive "FORM_SUBMITTED name=... role=... goal=...", reply with a confirmation:
[<Card>
  <Title>Got it ✓</Title>
  <Text>Recorded for {name} ({role}). Goal noted: {goal}.</Text>
  <Btn reply="start over">Reset</Btn>
</Card>]
(Substitute the actual values into your reply text — that confirmation IS how the user knows the round-trip worked.)
`;

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  parsed?: Node[];
}

export default function App() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const assistant = useAssistant({
    backend: 'openai_compat',
    baseUrl: BASE_URL,
    model: MODEL,
    systemPrompt: SYSTEM_PROMPT,
    persistAcrossUnmount: true,
  });

  // Cursor over the unified-contract event stream. Accumulate
  // assistant_message text per turn; on completion, fold into a Turn.
  const cursorRef = useRef(0);
  const accumRef = useRef('');

  useEffect(() => {
    if (assistant.events.length <= cursorRef.current) return;
    for (let i = cursorRef.current; i < assistant.events.length; i++) {
      const ev = assistant.events[i];
      if (ev.kind === 'assistant_message' && typeof ev.text === 'string') {
        accumRef.current += ev.text;
      } else if (ev.kind === 'completion') {
        const content = accumRef.current;
        accumRef.current = '';
        const parsed = parseIntent(content);
        setTurns((t) => [...t, { role: 'assistant', content, parsed }]);
      } else if (ev.kind === 'error_') {
        setError(ev.text || 'worker error');
        accumRef.current = '';
      }
    }
    cursorRef.current = assistant.events.length;
  }, [assistant.events]);

  const inputRef = useRef('');
  inputRef.current = input;

  const send = (text: string) => {
    const msg = text.trim();
    if (!msg) return;
    if (!assistant.ready()) return;
    setError(null);
    setTurns((t) => [...t, { role: 'user', content: msg }]);
    setInput('');
    inputRef.current = '';
    assistant.ask(msg);
  };

  const sendCurrent = () => send(inputRef.current);

  const busy = assistant.phase === 'streaming';

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', backgroundColor: '#0b1020' }}>
      <Box style={{ padding: 12, paddingLeft: 18, paddingRight: 18, borderBottomWidth: 1, borderColor: '#1e293b' }}>
        <Text style={{ fontSize: 13, color: '#94a3b8' }}>chat-loom · {MODEL} @ {BASE_URL}</Text>
      </Box>

      <ScrollView style={{ flexGrow: 1, padding: 18 }}>
        <Col style={{ gap: 18 }}>
          {turns.map((t, i) => (
            <Col key={i} style={{ gap: 4 }}>
              <Text style={{ fontSize: 10, color: '#64748b' }}>{t.role.toUpperCase()}</Text>
              {t.role === 'user' ? (
                <Text style={{ fontSize: 14, color: '#f1f5f9' }}>{t.content}</Text>
              ) : t.parsed && t.parsed.length > 0 ? (
                <Col style={{ gap: 8 }}>
                  <RenderIntent nodes={t.parsed} onAction={send} />
                  <LiftRow nodes={t.parsed} index={i} />
                </Col>
              ) : (
                <Col style={{ gap: 4 }}>
                  <Text style={{ fontSize: 12, color: '#fbbf24' }}>[unparseable]</Text>
                  <Text style={{ fontSize: 12, color: '#fbbf24' }}>{t.content}</Text>
                </Col>
              )}
            </Col>
          ))}
          {busy ? <Text style={{ fontSize: 13, color: '#64748b' }}>thinking…</Text> : null}
          {error ? <Text style={{ fontSize: 13, color: '#ef4444' }}>{error}</Text> : null}
        </Col>
      </ScrollView>

      <Row style={{ padding: 12, gap: 8, borderTopWidth: 1, borderColor: '#1e293b', alignItems: 'center' }}>
        <TextInput
          value={input}
          placeholder="ask anything…"
          onChangeText={(text: string) => { setInput(text); inputRef.current = text; }}
          onSubmit={sendCurrent}
          style={{
            flexGrow: 1,
            flexBasis: 0,
            padding: 10,
            paddingLeft: 14,
            paddingRight: 14,
            backgroundColor: '#1e293b',
            color: '#f1f5f9',
            borderWidth: 1,
            borderColor: '#334155',
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        <Pressable onPress={sendCurrent}>
          <Box style={{
            padding: 10,
            paddingLeft: 18,
            paddingRight: 18,
            backgroundColor: '#1d4ed8',
            borderRadius: 6,
          }}>
            <Text style={{ fontSize: 14, color: '#ffffff' }}>send</Text>
          </Box>
        </Pressable>
      </Row>
    </Box>
  );
}

function LiftRow({ nodes, index }: { nodes: Node[]; index: number }) {
  const defaultPath = `cart/lifted/turn-${index + 1}.tsx`;
  const [path, setPath] = useState(defaultPath);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err'; msg: string } | null>(null);
  const pathRef = useRef(defaultPath);
  pathRef.current = path;

  const onLift = () => {
    const result = saveIntentCart(nodes, pathRef.current.trim());
    if (result.ok) {
      setStatus({ tone: 'ok', msg: `✓ saved to ${result.path}` });
    } else {
      setStatus({ tone: 'err', msg: `✗ ${result.error ?? 'failed'}` });
    }
  };

  return (
    <Row style={{ gap: 8, alignItems: 'center', paddingTop: 4 }}>
      <Text style={{ fontSize: 10, color: '#475569' }}>lift to</Text>
      <TextInput
        value={path}
        onChangeText={(t: string) => { setPath(t); pathRef.current = t; }}
        style={{
          flexGrow: 1, flexBasis: 0,
          padding: 4, paddingLeft: 8, paddingRight: 8,
          backgroundColor: '#0f172a', color: '#cbd5e1',
          borderWidth: 1, borderColor: '#1e293b', borderRadius: 4, fontSize: 11,
        }}
      />
      <Pressable onPress={onLift}>
        <Box style={{
          padding: 4, paddingLeft: 10, paddingRight: 10,
          backgroundColor: '#334155', borderRadius: 4,
        }}>
          <Text style={{ fontSize: 11, color: '#e2e8f0' }}>lift</Text>
        </Box>
      </Pressable>
      {status ? (
        <Text style={{ fontSize: 10, color: status.tone === 'ok' ? '#16a34a' : '#ef4444' }}>{status.msg}</Text>
      ) : null}
    </Row>
  );
}
