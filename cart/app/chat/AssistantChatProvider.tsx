// AssistantChatProvider — invisible coordinator that mounts the
// chat-generation hook and publishes its `ask` to the module-level
// askAssistant() in cart/app/chat/store.ts.
//
// Why a separate component instead of mounting the hook inside
// <AssistantChat>? The chat panel re-mounts when the GOLDEN morph
// swaps slots (rail vs activity area). If the generation hook lived
// there, every morph would tear down and re-spawn the Claude
// subprocess. Mounting one level up — inside ShellBody, alongside
// <NavigationBus> — keeps the session alive across the morph.
//
// The provider also wraps the hook's bare `ask(text, onPart)` with the
// transcript-orchestration: append a user turn, append an empty asst
// turn, mutate the asst turn body as parts stream in, finalize on
// resolve / reject. Call sites (e.g. InputStrip.submit()) only have to
// call `askAssistant(text)` from the store.

import { useEffect, useRef } from 'react';
import { useRoute } from '@reactjit/runtime/router';
import { parseIntent, type Node } from '@reactjit/runtime/intent/parser';
import { useAssistantChat } from './useAssistantChat';
import { appendTurn, nextTurnId, setAsker, setChatStatus, setTurnPending, updateTurnBody, updateTurnSurface } from './store';
import {
  grantPermission,
  invokeTool,
  parseGrantReply,
  parseToolReply,
  registerBuiltinTools,
  setRouteRef,
  type ToolCall,
} from '../tools';

// Run the cart's tool registration exactly once per process. Importing
// this module is the trigger; the registry no-ops on subsequent calls.
registerBuiltinTools();

// Loom system prompt — teaches the model the tag DSL the persistent
// chat parses with `parseIntent`. Always-on for v1; promoted to a
// settings toggle once we've confirmed it works across both Claude
// and local-runtime backends. Mirrors the prompt the chat-loom probe
// cart used (cart/testing_carts/chat-loom.tsx) but lives here because
// the persistent chat is now the only place loom rendering ships.
const LOOM_SYSTEM_PROMPT = `You respond to the user with an interactive chat surface, not prose.

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

Tools:
- You can drive app actions (navigate, read/write the user's data) by emitting a Btn whose reply uses the @tool/ protocol:
    <Btn reply="@tool/navigate?json={"path":"/settings"}">Open settings</Btn>
- The reply format is @tool/NAME?json=<URL-encoded JSON args>. Discover available tools by emitting <Btn reply='@tool/list-tools?json={}'>list tools</Btn> on the very first turn (or whenever you need fresh capability info).
- Permission gates: every tool call goes through the user's grant store. If the user hasn't granted the required (tool, scope) pair, the dispatcher returns a permission_required result and you should respond with a grant card:
    <Btn reply="@grant/TOOL/SCOPE">Grant TOOL on SCOPE</Btn>
- Once granted, re-issue the original tool call. Do not loop on a denied call without first asking the user.
- Tool results land back in the next user turn, framed as: [tool-result] ok=BOOL ...details. Read it and respond accordingly.`;

function hasIntentTags(nodes: Node[]): boolean {
  return nodes.some((n) => n.kind !== 'text');
}

function nowHHMMSS(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function friendlyToolLabel(call: ToolCall): string {
  const a = call.args ?? {};
  if (call.name === 'navigate' && typeof a.path === 'string') return `→ navigate ${a.path}`;
  if (call.name === 'getRoute') return `→ getRoute`;
  if (call.name.endsWith('-entity') && typeof a.name === 'string') {
    const id = typeof a.id === 'string' ? `/${a.id}` : '';
    return `→ ${call.name} ${a.name}${id}`;
  }
  if (call.name === 'list-tools' || call.name === 'list-entities') return `→ ${call.name}`;
  return `→ ${call.name}`;
}

export function AssistantChatProvider() {
  const chat = useAssistantChat();
  const route = useRoute();

  // Live route ref so the asker closure (mounted via setAsker once)
  // can read the *current* path at submit time, not the path that was
  // captured the first time setAsker ran.
  const routeRef = useRef<string>(route.path);
  routeRef.current = route.path;

  // Publish the route ref to the tools module so the `getRoute` tool
  // resolves to the live path. setRouteRef stores the ref by reference,
  // not by value, so subsequent updates to routeRef.current flow
  // through without further calls.
  useEffect(() => { setRouteRef(routeRef); }, []);

  // Last route the assistant was told about. Compare on each ask:
  //   - first ask of the session → prepend "User is on route X"
  //   - route differs from last sent → prepend "User has moved to route X"
  //   - same route as last sent → no prefix
  // The transcript shows the user's typed text only; the prefix is
  // sent to Claude as a [system-style] note so it stays oriented
  // without polluting the chat surface.
  const lastSentRouteRef = useRef<string | null>(null);

  // First-ever send of this provider's lifetime — used to prepend the
  // loom system prompt exactly once. The active backends behind
  // useAssistant don't expose a system-prompt knob (claude_code rides
  // the CLI's own behavior; local_ai / kimi_cli_wire do not pass one
  // through), so the prompt rides on the first user message.
  const loomPromptSentRef = useRef(false);

  // Publish hook state to the chat-status store so AssistantChat's
  // header can render live phase/status/error. Without this, every
  // failure path (no bindings, spawn fail, model not yet loaded)
  // looks identical to the user — empty asst turn, no signal.
  useEffect(() => {
    setChatStatus({
      phase: chat.phase,
      lastStatus: chat.lastStatus || '',
      error: chat.error || null,
    });
  }, [chat.phase, chat.lastStatus, chat.error]);

  useEffect(() => {
    // Stream a synthesized prompt into a freshly-appended assistant
    // turn. Used by both the normal user-text path and the
    // tool/grant-protocol paths. The asst turn is expected to have been
    // appended with `pending: true`; we clear that here once the final
    // reply (body or surface) has landed so the render layer can play
    // its reveal animation.
    const driveAssistantTurn = async (asstId: string, prompt: string): Promise<string> => {
      const stripLeading = (s: string) => s.replace(/^[ \t]+/, '');
      try {
        const final = await chat.ask(prompt, {
          onPart: (partial) => updateTurnBody(asstId, stripLeading(partial)),
        });
        const finalText = final && final.length > 0 ? stripLeading(final) : '';
        if (finalText) updateTurnBody(asstId, finalText);
        if (finalText) {
          try {
            const nodes = parseIntent(finalText);
            if (hasIntentTags(nodes)) {
              updateTurnSurface(asstId, { kind: 'intent', nodes });
              updateTurnBody(asstId, '');
            }
          } catch { /* parse failure → leave prose body in place */ }
        }
        setTurnPending(asstId, false);
        return final;
      } catch (err: any) {
        const msg = err && err.message ? err.message : String(err);
        updateTurnBody(asstId, `[error] ${msg}`);
        setTurnPending(asstId, false);
        throw err;
      }
    };

    const orchestratedAsk = async (text: string): Promise<string> => {
      const ts = nowHHMMSS();

      // ── Tool-protocol interception ────────────────────────────────
      //
      // A Btn click that emits @tool/NAME?json=... is a request to run
      // a registered tool — not text the user typed. Intercept before
      // the normal chat flow: render a friendly user turn, dispatch
      // through the permission-gated invokeTool, then drive the asst
      // turn with a `[tool-result]` synth-prompt so the model can
      // react.
      const toolCall = parseToolReply(text);
      if (toolCall) {
        const userId = nextTurnId('u');
        const asstId = nextTurnId('a');
        appendTurn({ id: userId, author: 'user', timestamp: ts, body: friendlyToolLabel(toolCall) });
        appendTurn({ id: asstId, author: 'asst', timestamp: ts, body: '', pending: true });
        const result = await invokeTool(toolCall);
        const resultJson = JSON.stringify(result);
        return driveAssistantTurn(asstId, `[tool-result] tool=${toolCall.name} ${resultJson}`);
      }

      // ── Grant-protocol interception ───────────────────────────────
      //
      // @grant/TOOL/SCOPE writes a permission row through to pg, then
      // signals the model so it can re-issue the original tool call.
      const grant = parseGrantReply(text);
      if (grant) {
        const userId = nextTurnId('u');
        const asstId = nextTurnId('a');
        appendTurn({
          id: userId, author: 'user', timestamp: ts,
          body: `→ grant ${grant.tool} on ${grant.scope}`,
        });
        appendTurn({ id: asstId, author: 'asst', timestamp: ts, body: '', pending: true });
        try {
          await grantPermission({ tool: grant.tool, scope: grant.scope });
        } catch (e: any) {
          updateTurnBody(asstId, `[error] grant failed: ${e?.message ?? String(e)}`);
          throw e;
        }
        return driveAssistantTurn(
          asstId,
          `[grant] tool=${grant.tool} scope=${grant.scope} now in effect. Re-issue the previous tool call now.`,
        );
      }

      // ── Normal user-text path ─────────────────────────────────────
      const userId = nextTurnId('u');
      const asstId = nextTurnId('a');

      appendTurn({ id: userId, author: 'user', timestamp: ts, body: text });
      appendTurn({ id: asstId, author: 'asst', timestamp: ts, body: '' });

      // Build the actual prompt sent to Claude — prepend a route note
      // when this is the first send or the route has changed since the
      // last send. The transcript turn (above) renders only `text` so
      // the user sees what they typed; Claude sees the route context.
      const currentRoute = routeRef.current;
      let routeNote = '';
      if (lastSentRouteRef.current === null) {
        routeNote = `[Context: User is on route ${currentRoute}.]\n\n`;
      } else if (lastSentRouteRef.current !== currentRoute) {
        routeNote = `[Context: User has moved from ${lastSentRouteRef.current} to ${currentRoute}.]\n\n`;
      }
      lastSentRouteRef.current = currentRoute;

      // Prepend the loom system prompt on the very first send. Backend
      // hooks have no system-prompt parameter; this is the only seam.
      let loomPrelude = '';
      if (!loomPromptSentRef.current) {
        loomPrelude = `${LOOM_SYSTEM_PROMPT}\n\n`;
        loomPromptSentRef.current = true;
      }

      const promptForClaude = loomPrelude + routeNote + text;
      return driveAssistantTurn(asstId, promptForClaude);
    };

    setAsker(orchestratedAsk);
    return () => { setAsker(null); };
  }, [chat.ask]);

  return null;
}
