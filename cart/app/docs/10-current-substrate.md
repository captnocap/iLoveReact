# Current Substrate — What Works Today

This is a concrete inventory of what is **working in tree right
now** vs. what is **still needed for the sweatshop cartridge to
land**. Every "works today" claim cites the file that validates it.
Verified by the user's two eyes; documented here so future retrieval
can ground claims to actual code.

The sweatshop cartridge is being built **on top of** what's listed
under "Working today" — not from scratch. When a section of this
corpus says *"the runtime is React; the framework reconciler runs
both substrates"* (`02-canvas-and-substrates.md`), this file is
where that claim cashes out in file paths.

---

## Working today

### Agent SDKs (Zig, exposed as React hooks via V8 bindings)

- **Claude Code SDK** — non-blocking subprocess driver for the
  `claude` CLI in stream-json mode.
  - `framework/claude_sdk/mod.zig` — public surface (`Session`,
    `SessionOptions`, `Message`, `ContentBlock`, `OwnedMessage`,
    `PermissionMode`).
  - `framework/claude_sdk/session.zig` — `init()` / `send()` /
    `interrupt()` / `poll()` / `close()` / `deinit()`.
  - `framework/claude_sdk/options.zig` — typed config (`cwd`,
    `model`, `system_prompt`, `allowed_tools`, `disallowed_tools`,
    `permission_mode`, `max_turns`, `resume_session`, `add_dirs`).
  - `framework/claude_sdk/argv.zig` — emits CLI flags. No
    `--mcp-config`.
  - `framework/claude_sdk/types.zig` — Message union (system /
    assistant / user / result), ContentBlock variants, Usage,
    ResultMsg with cost/duration.
  - `framework/claude_sdk/parser.zig` + `buffer.zig` — stream-json
    parsing.
  - `framework/v8_bindings_sdk.zig` — JS bridge: registers the unified
    `__worker_*` host fns through `worker_bindings.register()`. The old
    `__claude_*` / `__kimi_*` / `__localai_*` fns were retired in favor
    of the single contract.
- **Codex agent SDK** — `framework/codex_sdk.zig`.
- **Kimi wire SDK** — `framework/kimi_wire_sdk.zig`.
- **OpenAI-compat HTTP SDK** — `framework/openai_compat_sdk.zig` (covers
  OpenAI proper, OpenRouter, LMStudio, Ollama, NanoGPT — anything
  speaking `/v1/chat/completions` with SSE).
- **Unified worker contract** — `framework/worker_contract.zig`
  (Backend enum + WorkerStore + ingest fns) and
  `framework/worker_bindings.zig` (per-session worker threads, five
  `__worker_*` host fns).

The carts at `cart/cockpit/index.tsx` and `cart/sweatshop/index.tsx`
exist as existing carts that drive these SDKs as a working pattern
to copy from.

### HTTP streaming + async

- `runtime/hooks/http.ts` — HTTP hook with streaming support.
- `framework/exec_async.zig` — async exec primitive.
- `runtime/hooks/websocket.ts`, `framework/v8_bindings_websocket.zig`,
  `framework/v8_bindings_wsserver.zig` — WebSocket client + server.
- `framework/v8_bindings_httpserver.zig` — HTTP server.
- `framework/v8_bindings_net.zig` — generic networking.
- `framework/v8_bindings_tor.zig` — Tor transport.
- `runtime/hooks/useHost.ts` — HTTP listener as a React hook.
- `runtime/hooks/useConnection.ts` — connection abstraction (per
  the networking trichotomy: useHost / fetch / useConnection split
  by direction).

### Local model inference

- `framework/llama_exports.zig` — llama.cpp embedded directly
  (compiled in, not Ollama HTTP). Used for local model inference
  and ready for embeddings work.
- HTTP path to local LLM endpoints is also wired (LM Studio at
  `localhost:1234` in production for `auto-commit.sh`, etc.).

### Agentic tools (for non-Claude-Code-SDK users)

- `framework/tool_framework.zig` + `framework/tools_builtin.zig` —
  tool execution tracking and the built-in tool set (Read, Edit,
  Write, Bash, Grep) for agents that don't ride the claude CLI.
- `framework/api_types/tools.d.ts` + `agent.d.ts` — typed surface.

### useIFTTT — full Claude Code hooks integration + system signals + clipboard

`runtime/hooks/useIFTTT.ts` is the reactive substrate
(`02-canvas-and-substrates.md`). Wired today:

- **Triggers**: `'mount'`, `'click'`, `'key:<key>'`, `'key:up:<key>'`,
  `'key:ctrl+<key>'`, `'timer:every:<ms>'`, `'timer:once:<ms>'`,
  `'state:<key>:<value>'`, plus arbitrary bus events.
- **Actions**: `'state:set:<key>:<val>'`, `'state:toggle:<key>'`,
  `'send:<event>'`, `'log:<msg>'`, `'clipboard:<text>'`, plus
  function callbacks.
- **Function triggers**: `() => boolean` with edge-detection on
  false → true.
- **Claude Code hook event dispatch** —
  `dispatchClaudeEvent(input)` exported. The cart hosts an HTTP
  listener (e.g. via `useHost`) and pipes Claude Code hook POST
  bodies through this dispatch, which emits `'system:claude'`,
  `'system:claude:<tool>'`, and `'system:claude:<phase>'` bus
  events the cart subscribes to.
- **System signals** wired via globalThis hooks installed
  idempotently:
  - `__ifttt_onKeyDown` / `__ifttt_onKeyUp` — SDL key events with
    full mod-mask decoding (ctrl / shift / alt / meta).
  - `__ifttt_onClipboardChange` — fires `'system:clipboard'` with
    live text via `clipboard.get()`.
  - `__ifttt_onSystemFocus` — fires `'system:focus'` /
    `'system:blur'`.
  - `__ifttt_onSystemDrop` — fires `'system:fileDropped'` with
    path.
  - `__ifttt_onSystemCursor` — fires `'system:cursor:move'`.
  - `__ifttt_onSystemSlowFrame` — fires `'system:slowFrame'` with
    ms duration.
  - `__ifttt_onSystemHang` — fires `'system:hang'`.
  - `__ifttt_onSystemRam` — fires `'system:ram'` with used/total/%.
  - `__ifttt_onSystemVram` — fires `'system:vram'`.
- Module-singleton bus + state map as the substrate.

`runtime/hooks/clipboard.ts` is the underlying primitive.

### `<RenderTarget>` and `<Cartridge>` primitives — windows, Linux, Android, VMs

- `runtime/primitives.tsx:156` — `<Cartridge src=…>`. Embeds another
  cart's binary as a nested host instance.
- `runtime/primitives.tsx:161` — `<RenderTarget src=…>`. Render-to-
  texture surface; hot-loadable `.so` render hook keyed by `src`.
- `runtime/primitives.tsx:166` — `<StaticSurface>`. GPU-cached
  subtree, render-to-texture quad with children present for layout
  + hit testing.
- `framework/render_surfaces.zig` + `framework/render_surfaces_vm.zig`
  — the surfaces backend. VNC RFB client, QEMU VM management
  (spawn, VNC connect), input forwarding (mouse + keyboard →
  VNC/XTest/xdotool). Capable of rendering Windows, Linux, Android
  guests; capable of embedding any application's window into a
  React component; capable of freezing processes when not in use
  and restoring instantly. Used today; ready for cross-system build
  confirmation (Windows VM, Linux VM, possibly macOS VM for
  ReactJIT itself).
- `framework/cartpack.zig` — bundles multiple `.so` cartridges into
  a single file.
- `framework/cartridge.zig` — the cartridge manager. Crash
  isolation, hot reload, state preservation, inter-cart state
  access. See `01-console-cartridges.md`.

### PTY, terminal, semantic terminal, classifiers

- `framework/vterm.zig` + `framework/vterm_real.zig` +
  `framework/vterm_stub.zig` — terminal emulation.
- `framework/ffi/pty_client.h` + the PTY client/remote shim — PTY
  I/O. Naturally supports N sessions and crash-safe UI per the
  client/remote split.
- `framework/classifier.zig` — semantic row classification
  framework.
- `framework/semantic.zig` — semantic tree / graph building.
- `framework/recorder.zig` — session recording.
- `runtime/hooks/useTerminalRecorder.ts` — React hook surface for
  the recorder.
- `runtime/classifier.tsx` — JSX-side classifier integration.
- The `cart/sweatshop/` (formerly `cursor-ide`) and existing
  `cart/cockpit/` carts already drive these.

### Node-graph wiring on canvas

- `cart/flow_editor.tsx` — working node-graph cart: pan/zoom
  Canvas, port-click wiring with side-aware completion, bezier
  paths with arrowheads and tangent-aware spread, alt-drag tile
  moves, generic placeholder nodes today. To be promoted into the
  sweatshop cartridge — see `02-canvas-and-substrates.md`.

### SQLite

- `framework/sqlite.zig` + `framework/sqlite_real.zig` +
  `framework/sqlite_stub.zig` — bindings.
- `framework/query.zig` — query layer.
- `runtime/hooks/sqlite.ts` — React hook surface.

### useCRUD

- `runtime/hooks/useCRUD.ts` — CRUD hook over `localstore`.
- `runtime/hooks/localstore.ts` + `runtime/hooks/useLocalStore.ts` —
  localstore primitive + hook.
  Already used in `cart/app/onboarding/state.jsx` (currently
  in-memory with a documented lock-in plan to restore `useCRUD`
  persistence).

### Inline agent DSL — for rendering primitives

`runtime/intent/` is a tiny Intent-subset DSL that lets a model
emit a structured chat-response surface that the cart parses and
renders through real components. Lifts to a self-contained TSX cart
when the user wants to keep it.

- `runtime/intent/parser.ts` — string → AST. Allowlist tags: `Row`,
  `Col`, `Card`, `Title`, `Text`, `List`, `Btn`, `Form`, `Field`,
  `Submit`, `Badge`, `Code`, `Divider`, `Kbd`, `Spacer`.
- `runtime/intent/render.tsx` — AST → React tree.
- `runtime/intent/printer.ts` — AST → standalone TSX cart file.
- `runtime/intent/save.ts` — saves the lifted cart to disk.
- `cart/component-gallery/components/intent-surface/` — the actual
  components the parser routes through.

### Session-awareness hooks

The hook stack at `reactjit/.claude/hooks/` is wired into every
Claude Code session in the repo today. Production-running:

- `reactjit/.claude/hooks/supervisor-log.sh` — PreToolUse /
  PostToolUse / SessionStart / Stop. Appends to
  `/run/user/$UID/claude-sessions/supervisor.db`.
- `reactjit/.claude/hooks/auto-commit.sh` — PostToolUse (Edit /
  Write). Every edit commits to a separate `edit-trail` git branch
  with an LLM-authored message. **Restore points already exist** as
  standard git history.
- `reactjit/.claude/hooks/guard-build.sh` — PreToolUse with 5ms
  timeout. Returns `{"decision":"block","reason":"…"}` for forbidden
  commands. **T4 enforcement working in production.**
- `reactjit/.claude/hooks/edit-log.sh` — PostToolUse edit feed.
- `reactjit/.claude/hooks/session-ping.sh` — cross-session
  awareness, collision detection, file-lock window. The big one.
- `reactjit/tsz/scripts/check-file-length.sh` — PostToolUse
  returning `{"hookSpecificOutput":{"additionalContext":"…"}}`.
  **T1 auto-injection working in production.**
- `reactjit/tsz/scripts/preflight-hook.sh` — PostToolUse preflight
  validation.
- `reactjit/.claude/hooks/ralph.sh` — supervisor → worker message
  relay (the send-correction primitive).

The cart reads from this same DB and these same hook outputs; the
sweatshop cartridge does not recreate any of this infrastructure.
See `07-supervision-vocabulary.md`.

### Components and atoms

- `cart/component-gallery/` — ~70 typed shapes plus dozens of
  components (animated text, charts, AST quilt, area / bar /
  bubble / candlestick / circular / etc., code blocks, intent
  surface, browser components, layout primitives). The gallery is
  this app's storybook AND will ship as its own cartridge — see
  `01-console-cartridges.md`.
- `runtime/primitives.tsx` — full primitive surface: Box, Row, Col,
  Text, Image, Pressable, ScrollView, TextInput, TextArea,
  TextEditor, Canvas + Canvas.Node + Canvas.Path + Canvas.Clamp,
  Graph + Graph.Path + Graph.Node, Native, Video, RenderTarget,
  StaticSurface, Cartridge, Terminal, Window, Notification, Audio.
- `runtime/icons/` — icon set.
- `runtime/tw.ts` — Tailwind class parsing at CREATE time.
- `runtime/theme.tsx` + `runtime/theme_presets.ts` — theming.
- `runtime/router.tsx` — routing primitives.

### Other working substrate worth naming

- `framework/ifttt.zig` — Zig-side rule engine (when-X-then-Y
  automation). Mirrors `useIFTTT.ts` on the framework side.
- `framework/hotstate.zig` — hot-state primitive (state preserved
  across hot reload; used by `useHotState.ts`).
- `framework/fswatch.zig` — file watching backend for
  `useFileWatch.ts`.
- `framework/audio.zig` + `runtime/audio.tsx` — audio primitive.
- `framework/effects.zig` + `runtime/effectContext.ts` — effects
  pipeline.
- `framework/canvas.zig` — infinite canvas primitive (the surface
  the flow editor and cockpit canvas sit on).
- `framework/blend2d.zig` + `framework/vello.zig` — 2D rendering
  backends.
- `framework/gpu/` — GPU pipeline (3d, capsules, curves, images,
  polys, procgen, rects, shaders, text).
- `framework/system_signals.zig` — emits the system signals that
  `useIFTTT.ts` decodes (RAM, VRAM, slow-frame, hang, focus,
  cursor, drop).
- `framework/exec_async.zig` — async exec for tool calls.
- `framework/v8_bindings_*.zig` — V8 bridge surface (cli, core, fs,
  gameserver, httpserver, net, privacy, process, sdk, telemetry,
  tor, websocket, wsserver, zigcall).
- `framework/v8_runtime.zig` — V8 host runtime.

---

## Still needed

The list of infrastructure that needs to land before the sweatshop
cartridge can be assembled is short and concrete. This list lives
here so it's easy to update as items get crossed off.

### Embedding models

The single missing piece for the M3A memory architecture
(`07-supervision-vocabulary.md`). Needed for L3 Echo's vector sub-
layer, for resonance scoring across the three encodings, for the
retrieval queries that auto-inject 3-resonance bundles on T3
escalations, and for the wounds → laws gradient's cross-worker
pattern matching (`06-laws-and-promotion.md`).

What's already in place to receive embeddings:
- `framework/llama_exports.zig` — llama.cpp embedded; the runtime
  to host an embedding model is there.
- `framework/sqlite.zig` + FTS5 — the lexical encoding (L3.2) is
  ready.
- `framework/query.zig` — the query layer is ready.

What's needed:
- An embedding model wired through `llama_exports.zig` (or HTTP'd
  to a local endpoint) with a stable dimension and sane content-
  hash dedup behavior.
- The L3 Echo writer that encodes events three ways (vector,
  lexical FTS5, entity-graph) and computes the resonance score
  0–3.
- The retrieval API (`memory.queryAllLayers(event)` per
  `07-supervision-vocabulary.md`).

Once this lands, the wounds → laws gradient can run end to end:
classifier fires → L4 wound writes → cross-worker pattern detection
via L3+L5 → user-promoted law.

### Other infrastructure (open list)

This list is intentionally short and grows as items are identified:

- **Embedding models** (above).
- *(others to add as identified)*

### What this corpus does not block on

The architecture is committed (`99-open-questions.md`); the design
is concrete enough to start building. Items in `99-open-questions.md`
under "Genuinely open" are decisions to make *while* the cartridge
is built, not blockers preventing it from starting:

- The internal file structure of `cart/app/canvas/`.
- Per-cell render templates (one per cell-kind).
- The wound-promotion threshold `N`.
- Cross-recipe modifier conflict resolution.
- Run-to-run state inheritance per memory layer.
- The recipe migration path (manual vs. generated JSX).
- The cartridge selector UX.
- The inter-cartridge state access shape.

## Cross-references

- Architecture: `01-console-cartridges.md`.
- Substrates: `02-canvas-and-substrates.md`.
- Memory layers (where embeddings land): `07-supervision-vocabulary.md`.
- Wounds → laws (where embeddings unlock the gradient):
  `06-laws-and-promotion.md`.
- Open questions: `99-open-questions.md`.
