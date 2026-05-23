# cart/tui_app — Handoff

Where this cart is, what's next, and the load-bearing gotchas to honor while moving it forward.

---

## What this cart is

`tui_app` is the TUI face of cart/app's chat substrate. It mounts the **same** `AssistantChatProvider` and `useCRUD`/`useChatTurns`/`useChatSessions` the GUI uses, against the **same** embedded postgres cluster. There is no parallel client — every byte read or written here goes through the existing `cart/app/db` + `cart/app/chat/store` modules. The shell layout is TUI-native (top nav row, route body, status footer); it deliberately does **not** mirror the GUI's GOLDEN bottom-bar + side-rail morph. The user's direction on this was explicit:

> "the tui doesnt need to resemble the shape of the gui it just needs to connect to all of the datashapes for starters and then from there we can make a chat interface and some routes but they clearly wont be the same."

Ship:

```
./scripts/ship-tui cart/tui_app/index.tsx     # → zig-out/bin/tui_app
./zig-out/bin/tui_app
```

The unified `v8_app` target builds this via `zig build app -Dhas-gpu=false ...` — same binary kernel as the GUI, just with the SDL/wgpu link surface gated out and a runHeadless() main body instead of `engine.run`. See **Build substrate** below.

---

## Where the work is right now

**Done:**

- C1–C3 host refactor: one `INGREDIENTS` catalog (`framework/v8_ingredients.zig`), one entry point (`v8_app.zig` with a `HAS_GPU` build-options gate). `v8_tui_app.zig` and the dedicated `tui-app` build target are deleted.
- `scripts/ship-tui` routes through `zig build app -Dhas-gpu=false`. Directory carts (`cart/<name>/index.tsx`) supported.
- Three-way pg-role lockstep (`pg.zig:default_user` ↔ `scripts/dev:initdb -U` ↔ `cart/app/db/connections.ts:PG_USER`) all agree on `postgres`.
- `host_tree.init(alloc)` runs in `runHeadless()` so React mutation batches in `.sync` mode have somewhere to land. (Pre-existing bug in the old v8_tui_app that only surfaced under stateful carts.)
- Cart scaffolding: 6 files, 3 routes:
  - `/chat` — live transcript + TextInput → `askAssistant`
  - `/sessions` — past `ChatSession` rows, pick/delete
  - `/status` — bindings probe + bound provider/model + live chat phase

**Smoke verified:**

- `cart/tui_db_smoke.tsx` reads `User.user_local` + `Settings.settings_default` + `useChatSessions()` from the same buckets the GUI writes. Cyan = bound.
- `tui_app` boots clean, renders chrome, nav pills are clickable, footer reflects `useChatStatus()`.

**Not done — and this is the first focal point:**

Configuration is **read-only** in the TUI today (`/status` displays the bound provider/model). The user can't author connections, models, or action defaults from the TUI; for that they have to flip to the GUI cart's `/settings`. That asymmetry is what the next round of work closes.

---

## First focal point: settings parity

**Goal (verbatim):** *"get a reflection of the settings capabilities so that configuration can live in both areas."*

Translation: the user should be able to wire a Claude/OpenAI/etc. provider, add a model, and bind it as the assistant default — **from inside `tui_app`** — and have those changes show up in the GUI cart the next time it boots (and vice versa). Because both substrates already share the same pg buckets via `useCRUD`, this is purely a UI build — no schema, no migrations, no plumbing.

### The authoritative reference

**`cart/app/settings/page.tsx`** (and its child modules under `cart/app/settings/routes/`) is the source of truth for what "settings capabilities" means in this project. Read it before designing anything; do **not** invent a new shape. The GUI has:

| Section | Entity | What it does |
|---|---|---|
| User | `user` namespace=app, id=`user_local` | name, goal, traits, configPath |
| Providers | `connection` rows in `app` | kind (`claude-code-cli` / `anthropic-api-key` / `openai-api-key` / `openai-api-like` / `kimi-api-key` / `codex-cli` / `local-runtime`) + endpoint + credentialRef |
| Models | `model` rows in `app` | label, remoteId (e.g. `claude-3-5-sonnet-20241022`), connectionId |
| Actions | `settings` row id=`settings_default`, field `actionDefaults` | maps action name (today: `assistant`) → model id |
| Customize | localstore key `component-gallery-theme-token-overrides` | GUI-only; **skip in TUI** — terminals don't have themes |
| Data | export/import | low priority for TUI |
| Privacy | `privacy` row id=`privacy_default` | scalar toggles |
| About | static | informational |

### Suggested order

Each phase = one new route file + one nav entry. Build incrementally so each commit is testable.

**Phase A — read parity (small, ~1 hr)**

Expand `routes/status.tsx` so all the read-only data the GUI shows is visible in the TUI. Adds: user name/goal, full connection list (not just the bound one), full model list, privacy toggles. Reuses the existing `useCRUD` pattern. No writes yet. Lands the user's mental model: "ok, the TUI sees the same things the GUI does."

**Phase B — User editor (smallest write surface, ~1 hr)**

New route `routes/user.tsx`. Two TextInputs (name + goal). On submit, `userStore.upsert({ id: 'user_local', name, goal })`. Open the GUI, refresh `/settings/user`, see the same values. Proves the write path round-trips through pg cleanly. Use this to shake out any TextInput-in-TUI quirks before tackling the bigger forms.

**Phase C — Provider editor (the big one, ~2–3 hrs)**

New route `routes/providers.tsx`. List existing `connection` rows newest-first (like `sessions.tsx` already does). Each row: pressable to edit, "×" to delete. Header "+ new connection" opens an editor sub-view.

The editor needs:
- `kind` picker (cycle through the 7 kinds via Pressable, or a `<TextInput>` accepting the literal string for v0)
- `endpoint` TextInput (only relevant for `openai-api-like`)
- `credentialRef.source` toggle: `'env'` vs `'literal'`
- `credentialRef.locator` TextInput (env var name OR literal API key OR path to ~/.claude for `claude-code-cli`)
- Save → `connectionStore.upsert({ id, kind, endpoint, credentialRef })`

Reference: how `cart/app/settings/routes/providers.tsx` (if it exists; otherwise `cart/app/settings/page.tsx`'s ProvidersRoute) constructs the row. Mirror the field set 1:1 so the GUI and TUI editors are interchangeable.

**Phase D — Model + Action defaults (~1 hr)**

New route `routes/models.tsx`. List `model` rows, each with a `connectionId` picker (cycle through known connection ids) and a `remoteId` TextInput. Per row: a "set as assistant default" button that writes `Settings.actionDefaults.assistant = model.id` to `settings_default`.

Once this lands, the cycle closes: a user can boot `tui_app` cold, walk through `providers → models → set default`, type a message in `/chat`, and get a real assistant response — all without ever touching the GUI.

**Phase E — polish (~1 hr, optional)**

- Privacy toggles (one row, simple bool list)
- "Test connection" action that fires a probe through the worker SDK and surfaces the result in the row
- Hotkey nav: `1`/`2`/`3`/`4`/`5` to switch routes (needs `subscribeKey` from `tui/host`; today it's not aliased to carts — see the deferred-work note below)

### File layout to extend

```
cart/tui_app/
  index.tsx                     # add new route imports + Shell entries
  Shell.tsx                     # add `path.startsWith('/...')` branches
  components/
    NavBar.tsx                  # add tabs as Phase A/B/C/D land
    Footer.tsx
    Field.tsx                   # NEW (Phase B+) — labelled TextInput, share across editors
    Picker.tsx                  # NEW (Phase C+) — cycling enum picker
  routes/
    chat.tsx
    sessions.tsx
    status.tsx                  # Phase A expands this
    user.tsx                    # NEW (Phase B)
    providers.tsx               # NEW (Phase C)
    models.tsx                  # NEW (Phase D)
    privacy.tsx                 # NEW (Phase E, optional)
```

Each new route is ~60–120 lines. Resist building a generic "form framework" — the project's instinct on this is to split into small explicit files; see `feedback_no_duplication` and `feedback_design_instinct` memories.

---

## Load-bearing gotchas (do not redebug these from scratch)

Each of these took real time the first time around. They're written down so future-you doesn't.

### Three-way pg-role lockstep

The role name `postgres` is hardcoded in **three** files. They must agree:

1. `framework/storage/pg.zig` → `const default_user`
2. `scripts/dev` → `initdb_bin ... -U <role>` (the dev-launcher pre-warm)
3. `cart/app/db/connections.ts` → `const PG_USER`

If any one drifts, every dev session prints `[err/pg] connect error: role "X" does not exist` until the user wipes the cluster — and even wiping doesn't help if the drift is in connections.ts. When debugging this kind of error, grep all three files for the role name in the error message. Memory: `[Dev script pg lockstep]`.

### host_tree.init() before reconciler.register()

`v8_app.zig:runHeadless` must call `host_tree.init(std.heap.c_allocator)` BEFORE `v8_bindings_reconciler.register()`. In `.sync` mode (TUI default) `__hostFlush` lands payloads directly in `host_tree.applyCommandBatch`, which walks `AutoHashMap`s that segfault if uninit. The old `v8_tui_app` missed this and got away with it because its only test cart (`tui_window_smoke`) never re-rendered enough to trigger a batch. Stateful carts surface the bug immediately.

### No unconditional imports in build.zig

Every `root_mod.addImport("X", ...)` must be gated by a `has-X` flag. The "burrito principle" — see `framework/v8_ingredients.zig`'s header comment block for the full kitchen analogy + the historical regression that motivated it. Memory: `[No unconditional imports]`.

### Cart can't reach into tui/host

`tui/host.ts` exports `subscribeKey`, `subscribeHotkey`, etc. They're not aliased to anything cart-reachable today. The devshell can reach them because it lives under `tui/devshell/` and uses `../host`. Carts can't. **Don't** add a `../../tui/host` import to escape — that breaks the cart's portability and ties it to the in-repo tui layout. The right fix (when someone gets to it) is to expose a small `@reactjit/tui` alias that re-exports the subset of `tui/host` carts need (subscribeKey, focus management). Until then, use `Pressable` for nav.

### `AssistantChatProvider` pulls in canvas tools

The provider eagerly calls `registerCanvasTools()` from `cart/app/sweatshop/canvas/tools.ts`. Those tools work fine in the TUI because they only register IFTTT handlers (no SDL), but they do bloat the bundle. If you ever need to slim the TUI binary further, factor the canvas-tools registration behind a runtime check in the provider (`if (hasHost('canvas')) registerCanvasTools()`); don't fork the provider.

---

## Build substrate (just enough to navigate)

- `v8_app.zig` is the one entry point. `-Dhas-gpu=true` (default) gives engine.run + SDL window; `-Dhas-gpu=false` gives the runHeadless() body that just registers bindings + evals the bundle. `scripts/ship-tui` always passes false.
- `framework/v8_ingredients.zig` is the binding catalog. New host fn? Add a row there, a `has-X` option in `build.zig`, and a metafile-gate trigger in `sdk/dependency-registry.json`. Same contract for both substrates.
- React mutations flow: cart JSX → react-reconciler → `runtime/hostConfig.ts` → `__hostFlush` → `v8_bindings_reconciler.applyCommandBatch` → `host_tree.applyCommandBatch` (in `.sync` mode). TUI then walks the React Instance tree via `tui/host.ts` and emits ANSI to stdout.
- `tui/host.ts` is the ANSI rasterizer. It's the equivalent of the GPU substrate's `framework/engine.zig`+`framework/gpu/*`. Carts don't touch it.

---

## Memory pointers (load before starting)

Recall these via the standard memory recall pipeline before sitting down. They contain the load-bearing context for project conventions:

- `[Dev script pg lockstep]` — three-way pg-role coordination
- `[PG role history]` — the embed → postgres flip history
- `[PG throwaway, buckets stay]` — pg data is throwaway; the 8-bucket split is load-bearing
- `[No unconditional imports]` — build.zig burrito principle
- `[Source-driven cart bundling]` — how the metafile gate decides what links
- `[No color drift]` + `[Theme-aware text]` — no hex literals in cart code. The TUI cart's current palette uses raw hex because there's no theme system at the TUI layer yet; if a TUI theme story develops, route all colors through it.
- `[No duplication]` — 2+ call sites = utility, not a re-write
- `[Design instinct]` — anchor on non-coder POV; "super sucks" = rework signal
- `[Pressable stale closure]` — `onPress` closures freeze at first commit; read live state through refs
- `[Feature request default]` — full vertical slice, public, not shallow
- `[Estimate in agent-time]` — halve gut estimates twice

---

## Quick test loop

Once you're editing files, the watcher pattern is:

```
# In one terminal — leave running:
./scripts/ship-tui cart/tui_app/index.tsx
./zig-out/bin/tui_app

# Edit a file under cart/tui_app/, then ctrl-C the binary, re-ship, re-run.
# (The auto-push dev watcher only handles the GUI cart's /scripts/dev path;
#  TUI carts re-ship manually for now.)
```

Smoke-verify across sessions: after any persistence-touching change, open the GUI cart (`./scripts/dev app`) and confirm the same rows appear in `/settings`. They should — both binaries hit the same pg cluster, same bucket DBs, same useCRUD path. If they diverge, that's the third-place-in-the-lockstep biting again.

---

## Hand-off owner expectations

The user is not a coder — they direct technical work through outcomes, not file-level instructions. When a phase lands, the verdict will be one of:
- *"works"* — ship the next phase.
- *"didn't change from my POV"* / *"looks the same"* / *"same to me"* — the change did not produce a visible/behavioral difference. Code diff is irrelevant; the next attempt must produce a different observable signal. Memory: `[POV verdict]`.
- *"super sucks"* — design-rework signal, not polish. Remove/consolidate before adding more. Memory: `[Design instinct]`.

Default to the full vertical slice (UI + data write + read-back) when the request is unqualified; don't ship a half-route that displays but can't save. Memory: `[Feature request default]`.

When in doubt, the user's words from earlier in this thread are the load-bearing context:

> "v8 apps are both tui and gui so things that are one dimentional dont need to be re-invented for every tui based function. ive stressed that a handful of times and to my understanding thats how it behaves atp."

The unification was the user pushing hard against split-brain. Honor it. If a "TUI-specific X" suggestion comes up, the first question is *"can this be done by reflecting the GUI's existing data shape through the same useCRUD path?"* — and the answer is almost always yes.
