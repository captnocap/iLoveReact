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
import { busEmit } from '@reactjit/runtime/hooks/useIFTTT';

// Parse a `@stage/accept|retry|cancel` Btn reply. The chat card the
// assistant emits after canvas mutations carries one of those three
// reply strings. Returns the verb or null if not a stage reply.
type StageVerb = 'accept' | 'retry' | 'cancel';
function parseStageReply(text: string): StageVerb | null {
  if (text === '@stage/accept') return 'accept';
  if (text === '@stage/retry')  return 'retry';
  if (text === '@stage/cancel') return 'cancel';
  return null;
}
import { useAssistantChat } from './useAssistantChat';
import { appendTurn, getTurns, nextTurnId, pushAsker, setChatStatus, setTurnPending, updateTurnBody, updateTurnSurface } from './store';
import type { AssistantTurn } from './types';
import {
  grantPermission,
  invokeTool,
  parseGrantReply,
  parseToolReply,
  registerBuiltinTools,
  registerBrowseTools,
  setRouteRef,
  type ToolCall,
} from '../tools';
import { registerCanvasTools, readCanvasState } from '../sweatshop/canvas/tools';

// Run the cart's tool registration exactly once per process. Importing
// this module is the trigger; the registry no-ops on subsequent calls.
registerBuiltinTools();
// Stealth-Firefox research surface. The cart must still own the browse
// session lifecycle (typical: useProcess to spawn `python -m
// browse.session --port 7332`, useBrowse({port:7332}) to point the
// bridge). Registering the tools eagerly lets list-tools advertise them
// even before the session is up; calls will fail clearly if no session
// is listening.
registerBrowseTools();
// /canvas-route tools (move-panel, bind-slot, highlight, …). Eager
// registration so the assistant knows they exist even when the user
// hasn't visited /canvas yet — list-tools includes them on first ask.
registerCanvasTools();

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
- Tool results land back in the next user turn, framed as: [tool-result] ok=BOOL ...details. Read it and respond accordingly.

Canvas staging:
- Tools prefixed canvas-* (canvas-move-panel, canvas-bind-slot, canvas-toggle-panel, canvas-resize-panel, canvas-set-bag-cols, canvas-swap-slots, canvas-reset-layout) mutate canvas state through a STAGE proposal — they don't apply directly. The user sees a dashed accent halo on every affected element and the canvas locks until they resolve.
- canvas-highlight and canvas-describe and canvas-list-atoms and canvas-invoke-atom are NOT staged — they're cosmetic / read / immediate. No card needed.
- After ANY message that calls one or more canvas-* mutation tools, end your message with the three-button stage card so the user can resolve the proposal:
    <Btn reply="@stage/accept">Accept</Btn>
    <Btn reply="@stage/retry">I don't like that</Btn>
    <Btn reply="@stage/cancel">Nevermind</Btn>
- One card per turn covers ALL the mutations in that turn — bind 5 slots in one turn = one card with one Accept that commits all 5. Don't fragment into multiple cards.
- accept = commit. cancel = drop. retry = drop AND you'll get a fresh turn telling you the user wanted a different approach; read canvas-describe and propose something else.
- Before proposing canvas changes, check the current state. While the user is on /sweatshop/canvas, the snapshot is injected at the top of every turn as [Canvas: {...JSON...}] — read it instead of calling canvas-describe. Use canvas-describe only when you need a refresh between tool calls.
- Undo/redo: canvas-undo and canvas-redo step the user back/forward through history (last 100 commits). canvas-history lists recent entries. Use these when the user asks to revert or revisit a prior layout.`;

function hasIntentTags(nodes: Node[]): boolean {
  return nodes.some((n) => n.kind !== 'text');
}

function nowHHMMSS(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Render a chat-store transcript snapshot as a single text block to
// hand a freshly-spawned worker. Each turn becomes one `User:` /
// `Assistant:` line so the model sees clear turn boundaries even
// though we're shipping it as one large user message. We skip empty
// asst turns (in-flight or canceled) and surface-only turns; the
// `parallel` shape (multi-candidate) is flattened to its selected
// candidate's body, falling back to the first.
function renderTranscriptForBootstrap(turns: AssistantTurn[]): string {
  const lines: string[] = [];
  for (const t of turns) {
    if (t.author === 'user') {
      const body = (t.body || '').trim();
      if (body) lines.push(`User: ${body}`);
    } else if (t.author === 'asst') {
      const body = (t.body || '').trim();
      if (body) lines.push(`Assistant: ${body}`);
    } else if (t.author === 'parallel') {
      const userBody = (t.userBody || '').trim();
      if (userBody) lines.push(`User: ${userBody}`);
      const sel = t.candidates.find((c) => c.selected) || t.candidates[0];
      const cand = (sel?.body || '').trim();
      if (cand) lines.push(`Assistant: ${cand}`);
    }
  }
  return lines.join('\n');
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

  // Worker id we last primed with the LOOM prompt + transcript
  // bootstrap. When this differs from the live worker id, the worker
  // has just (re)spawned — settings model swap, backend swap, key
  // rotation — and the next send must re-prime it with the cart-owned
  // transcript. The worker is a stateless conduit; the cart's chat
  // store is the only memory.
  const lastBootstrappedWorkerIdRef = useRef<string | null>(null);

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

  // Live mirror of chat.workerId so the closure inside our useEffect
  // (mounted once, with chat.ask in deps) reads the *current* worker
  // id at submit time — not whichever id was bound when the effect
  // last ran.
  const workerIdRef = useRef<string | null>(null);
  workerIdRef.current = chat.workerId;

  useEffect(() => {
    // Stream a synthesized prompt into a freshly-appended assistant
    // turn. Used by both the normal user-text path and the
    // tool/grant-protocol paths. The asst turn is expected to have been
    // appended with `pending: true`; we clear that here once the final
    // reply (body or surface) has landed so the render layer can play
    // its reveal animation.
    //
    // `latestUserText` is the synthetic content that triggered this
    // turn — real typed text for the normal path, `[tool-result] …`
    // for tool returns, `[grant] …` for permission grants, etc.
    // `priorTurns` is the chat-store snapshot taken BEFORE the user/
    // asst turns for this round were appended. Used as the transcript
    // when the worker has just (re)spawned and needs priming.
    const driveAssistantTurn = async (
      asstId: string,
      latestUserText: string,
      priorTurns: AssistantTurn[],
    ): Promise<string> => {
      const stripLeading = (s: string) => s.replace(/^[ \t]+/, '');
      // Inject the live canvas snapshot when the user is on /canvas.
      // Saves a round trip versus making the model call canvas-describe
      // before reasoning about layout. Tiny payload (a few hundred
      // bytes); no harm including it on every canvas-route turn.
      let canvasNote = '';
      if (routeRef.current.startsWith('/sweatshop/canvas')) {
        const snap = readCanvasState();
        if (snap) canvasNote = `[Canvas: ${JSON.stringify(snap)}]\n\n`;
      }

      // Bootstrap detection: if the live worker id differs from the
      // one we last primed, the worker has respawned (model swap,
      // backend swap, key rotation). Re-prime it with LOOM + route +
      // transcript snapshot so it picks up the conversation cleanly,
      // regardless of which model is now serving.
      const liveWorkerId = workerIdRef.current;
      const respawned = liveWorkerId !== null && liveWorkerId !== lastBootstrappedWorkerIdRef.current;
      const currentRoute = routeRef.current;

      let prompt: string;
      if (respawned) {
        const transcript = renderTranscriptForBootstrap(priorTurns);
        const routeLine = `[Context: User is on route ${currentRoute}.]`;
        const sections = [LOOM_SYSTEM_PROMPT, '', routeLine];
        if (transcript) {
          sections.push('', '--- prior conversation ---', transcript, '--- end prior conversation ---');
        }
        sections.push('', latestUserText);
        prompt = sections.join('\n');
        lastBootstrappedWorkerIdRef.current = liveWorkerId;
        lastSentRouteRef.current = currentRoute;
      } else {
        // Same-worker continuation. The worker (or its backend's CLI
        // session) already has the prior turns; we only need to send
        // the new user text plus a route note when the route changed.
        let routeNote = '';
        if (lastSentRouteRef.current !== null && lastSentRouteRef.current !== currentRoute) {
          routeNote = `[Context: User has moved from ${lastSentRouteRef.current} to ${currentRoute}.]\n\n`;
        }
        lastSentRouteRef.current = currentRoute;
        prompt = routeNote + latestUserText;
      }

      try {
        const final = await chat.ask(canvasNote + prompt, {
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
        const priorTurns = getTurns();
        const userId = nextTurnId('u');
        const asstId = nextTurnId('a');
        appendTurn({ id: userId, author: 'user', timestamp: ts, body: friendlyToolLabel(toolCall) });
        appendTurn({ id: asstId, author: 'asst', timestamp: ts, body: '', pending: true });
        const result = await invokeTool(toolCall);
        const resultJson = JSON.stringify(result);
        return driveAssistantTurn(asstId, `[tool-result] tool=${toolCall.name} ${resultJson}`, priorTurns);
      }

      // ── Stage-protocol interception ───────────────────────────────
      //
      // @stage/{accept|retry|cancel} resolves a canvas stage proposal.
      //   accept → emit canvas:stage:accept; canvas commits the ops.
      //   cancel → emit canvas:stage:cancel; canvas drops the ops.
      //   retry  → cancel + a fresh asst turn that nudges the model
      //            to revise. The user's text isn't used as feedback
      //            here; future iterations could add a free-text
      //            reason field.
      const stage = parseStageReply(text);
      if (stage) {
        const priorTurns = getTurns();
        const userId = nextTurnId('u');
        appendTurn({
          id: userId, author: 'user', timestamp: ts,
          body: stage === 'accept' ? '✓ accepted' : stage === 'cancel' ? '✕ dismissed' : '↻ try again',
        });
        if (stage === 'accept') {
          busEmit('canvas:stage:accept', {});
          return; // no asst turn — accept is silent unless the model wants to celebrate
        }
        if (stage === 'cancel') {
          busEmit('canvas:stage:cancel', {});
          return;
        }
        // retry: drop the stage and ask the model to try a different
        // approach. The synth-prompt tells it the prior proposal was
        // rejected so it doesn't re-issue the exact same calls.
        busEmit('canvas:stage:cancel', {});
        const asstId = nextTurnId('a');
        appendTurn({ id: asstId, author: 'asst', timestamp: ts, body: '', pending: true });
        return driveAssistantTurn(
          asstId,
          `[stage-rejected] The user dismissed your last canvas proposal and asked you to try again. Read the current canvas state with canvas-describe and propose a different approach.`,
          priorTurns,
        );
      }

      // ── Grant-protocol interception ───────────────────────────────
      //
      // @grant/TOOL/SCOPE writes a permission row through to pg, then
      // signals the model so it can re-issue the original tool call.
      const grant = parseGrantReply(text);
      if (grant) {
        const priorTurns = getTurns();
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
          priorTurns,
        );
      }

      // ── Normal user-text path ─────────────────────────────────────
      const priorTurns = getTurns();
      const userId = nextTurnId('u');
      const asstId = nextTurnId('a');

      appendTurn({ id: userId, author: 'user', timestamp: ts, body: text });
      appendTurn({ id: asstId, author: 'asst', timestamp: ts, body: '' });

      // driveAssistantTurn decides bootstrap vs continuation based on
      // whether the worker has just (re)spawned. LOOM, route context,
      // and the prior transcript are baked in there for first-prime
      // sends; same-worker sends just carry the new user text plus a
      // route delta when relevant.
      return driveAssistantTurn(asstId, text, priorTurns);
    };

    return pushAsker(orchestratedAsk);
  }, [chat.ask]);

  return null;
}
