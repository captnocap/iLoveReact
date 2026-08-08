//! v8_ingredients — shared V8 binding catalog.
//!
//! Every V8 host-fn binding registered by a cart goes through this module.
//! v8_app.zig (GPU shell) and v8_tui_app.zig (TUI shell) both consume the
//! same INGREDIENTS table via `registerAll()` and `tickDrain()`. There is
//! ONE source of truth for the binding surface; substrate-specific stuff
//! (SDL3 window, ANSI rasterizer) lives in its own shell, not here.
//!
//! The contract (lifted from v8_app.zig — see that file's pre-extraction
//! INGREDIENTS comment block for the full historical context):
//!
//!   A cart's bundle is the order ticket. The kitchen (this file +
//!   scripts/ship + build.zig) only puts an ingredient in the burrito if
//!   the ticket asks for it. Carts that don't order an ingredient never
//!   see its host-fn surface on globalThis.
//!
//! ⚠️ Every new V8 binding that registers host fns goes HERE. Three pieces,
//! all required — forgetting any one is how allergens get into burritos:
//!
//!   1. One row in INGREDIENTS below (grep_prefix / reg_fn / mod)
//!   2. A `has-<name>` option in build.zig — referenced by build_options.has_X
//!   3. A `grep -qE '<grep_prefix>'` in scripts/ship that flips -Dhas-X=true
//!
//! The kitchen story: scripts/ship reads the cart's bundle, looks for the
//! grep_prefix (e.g. "__proc_"), and if found passes `-Dhas-process=true`
//! to zig build. build.zig exposes that as `build_options.has_process`.
//! The import below resolves to the real module when the option is true,
//! or to a stub with matching public API when false. `registerAll()` and
//! `tickDrain()` iterate INGREDIENTS uniformly — register the real impl
//! or the no-op stub.
//!
//! What happens if you skip any step:
//!   - Skip step 1 → binding never gets registered. Cart's hook silently
//!     no-ops on the cart that imports it. Visible failure for that cart's
//!     author. Other carts unaffected.
//!   - Skip step 2 → comptime fails. Build won't compile. Self-correcting.
//!   - Skip step 3 → binding never gets registered (option defaults false).
//!     Same visible failure as skip step 1.
//!
//! What previously happened when this contract DIDN'T exist (2026-04-25):
//! worker 571f added httpsrv/wssrv/process bindings and called register()
//! for all three unconditionally in appInit. Every cart in the repo paid
//! the cost of registering host-fn surface they never asked for. The extra
//! V8 Function-table load corrupted Function::Call such that callGlobalInt
//! from C++ threw RangeError on every cart — even carts that never
//! imported useHost. Three hours of debugging burritos that had
//! ingredients nobody ordered. Don't re-litigate. Add the row.

const std = @import("std");
const build_options = @import("build_options");
const HostContext = @import("host_context.zig");

// `enabledFor("X")` returns `build_options.has_X` when the decl exists,
// else false. `@import` requires a string literal in Zig 0.16, so the
// path can't move into the helper — but the gate-check ladder can.
// `@hasDecl` short-circuits to false so binaries whose build_options
// omits a flag still compile (the binding falls through to the stub).
pub inline fn enabledFor(comptime opt_name: []const u8) bool {
    return @hasDecl(build_options, "has_" ++ opt_name) and @field(build_options, "has_" ++ opt_name);
}

pub const Ingredient = struct {
    name: []const u8,
    /// `true` = framework-essential, registered on every cart. `grep_prefix` ignored.
    /// `false` = opt-in; only registered when scripts/ship sees `grep_prefix` in the bundle.
    required: bool,
    /// Bundle-grep token — must match the host-fn prefix that the
    /// corresponding hook calls via callHost(). Empty when required=true.
    grep_prefix: []const u8,
    /// Public name of the register function inside `mod`.
    reg_fn: []const u8,
    /// Module to register from — already gated to a stub if
    /// `required=false` and the cart didn't ask for it (see comptime
    /// imports below).
    mod: type,
};

// ── Required binding modules ─────────────────────────────────────────
//
// These bindings expose host fns the React renderer / runtime depend on
// unconditionally — __hostFlush, __zigCall, telemetry counters, etc.
// They're "in every burrito" because no cart can run without them on
// the GPU substrate.
//
// Two of them — `core` and `window` — are SDL-coupled: their .zig
// files reach into framework/engine.zig which @cImports SDL3.h /
// ft2build.h. The headless (TUI) shell can't link SDL, so those two
// resolve to stubs when `has_gpu=false`. The TUI host (tui/host.ts)
// re-implements anything the React reconciler actually needs at the
// JS layer (e.g. there is no mouse/viewport surface in an ANSI grid).
// C2 will collapse the headless/windowed distinction into a single
// runtime branch; until then, has_gpu is the seam.

const has_gpu_flag = enabledFor("gpu");

const v8_bindings_core = if (has_gpu_flag) @import("v8_bindings_core.zig") else struct {
    pub fn registerCore(_: anytype) void {}
};
const v8_bindings_eventbus = @import("v8_bindings_eventbus.zig");
const v8_bindings_editor_bus = @import("events/v8_bindings_editor_bus.zig");
const v8_bindings_editor_diag = @import("diag/v8_bindings_editor_diag.zig");
const v8_bindings_ifttt = @import("v8_bindings_ifttt.zig");
const v8_bindings_env = @import("v8_bindings_env.zig");
const v8_bindings_window = if (has_gpu_flag) @import("v8_bindings_window.zig") else struct {
    pub fn registerWindow(_: anytype) void {}
};
const v8_bindings_inspector = @import("v8_bindings_inspector.zig");

// ── Source-gated binding modules ─────────────────────────────────────
//
// `if (enabledFor("X")) @import(...) else struct { stub }` — the stub
// matches the real module's public API surface (register fn + tickDrain
// when applicable) so the INGREDIENTS iteration compiles either way.
//
// Critical: when has_X is false the binding file is NEVER parsed, so its
// string literals (host-fn names like "getFps", "__zig_call") don't bleed
// into .rodata/DWARF of the final binary. The naive
// `_real = @import(...); if cond _real else stub` shape compiles the
// file unconditionally and leaks the host-fn strings into the binary
// even when the gate is off; the `if cond @import(...) else struct{...}`
// shape below is the load-bearing trick.

const v8_bindings_fs = if (enabledFor("fs")) @import("v8_bindings_fs.zig") else struct {
    pub fn registerFs(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_websocket = if (enabledFor("websocket")) @import("v8_bindings_websocket.zig") else struct {
    pub fn registerWebSocket(_: anytype) void {}
    pub fn tickDrain(_: *HostContext) void {}
};
const v8_bindings_telemetry = if (enabledFor("telemetry")) @import("v8_bindings_telemetry.zig") else struct {
    pub fn registerTelemetry(_: anytype) void {}
    pub fn tickDrain() void {}
};
// `__sql_*` — extracted from v8_bindings_telemetry.zig (STOREDB-0606) so
// sqlite consumers stop dragging the whole telemetry surface in via the
// old has-telemetry piggyback. storage/sqlite.zig dlopens libsqlite3 at
// runtime, so this ingredient adds no link-time dependency.
const v8_bindings_sqlite = if (enabledFor("sqlite")) @import("v8_bindings_sqlite.zig") else struct {
    pub fn registerSqlite(_: anytype) void {}
};
const v8_bindings_zigcall = if (enabledFor("zigcall")) @import("v8_bindings_zigcall.zig") else struct {
    pub fn registerZigCall(_: anytype) void {}
    pub fn registerZigCallList(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_httpserver = if (enabledFor("httpsrv")) @import("v8_bindings_httpserver.zig") else struct {
    pub fn registerHttpServer(_: anytype) void {}
    pub fn tickDrain(_: *HostContext) void {}
};
const v8_bindings_wsserver = if (enabledFor("wssrv")) @import("v8_bindings_wsserver.zig") else struct {
    pub fn registerWsServer(_: anytype) void {}
    pub fn tickDrain(_: *HostContext) void {}
};
const v8_bindings_process = if (enabledFor("process")) @import("v8_bindings_process.zig") else struct {
    pub fn registerProcess(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_net = if (enabledFor("net")) @import("v8_bindings_net.zig") else struct {
    pub fn registerNet(_: anytype) void {}
    pub fn tickDrain(_: *HostContext) void {}
};
// Source RCON + A2S Source Query — gated alongside has_net since they sit
// on top of net/tcp.zig and net/udp.zig and ride the useConnection
// trichotomy. Any cart shipping `useConnection({kind:'rcon'|'a2s'})`
// already trips has-net via the metafile gate, so no separate ingredient
// flag is needed.
const v8_bindings_gameserver = if (enabledFor("net")) @import("v8_bindings_gameserver.zig") else struct {
    pub fn registerGameServer(_: anytype) void {}
    pub fn tickDrain(_: *HostContext) void {}
};
const v8_bindings_tor = if (enabledFor("tor")) @import("v8_bindings_tor.zig") else struct {
    pub fn registerTor(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_privacy = if (enabledFor("privacy")) @import("v8_bindings_privacy.zig") else struct {
    pub fn registerPrivacy(_: anytype) void {}
};
const v8_bindings_sdk = if (enabledFor("sdk")) @import("v8_bindings_sdk.zig") else struct {
    pub fn registerSdk(_: anytype) void {}
};
const v8_bindings_voice = if (enabledFor("voice")) @import("v8_bindings_voice.zig") else struct {
    pub fn registerVoice(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_audio_input = if (enabledFor("audio_input")) @import("v8_bindings_audio_input.zig") else struct {
    pub fn registerAudioInput(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_whisper = if (enabledFor("whisper")) @import("v8_bindings_whisper.zig") else struct {
    pub fn registerWhisper(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_onnx = if (enabledFor("onnx")) @import("v8_bindings_onnx.zig") else struct {
    pub fn registerOnnx(_: anytype) void {}
};
const v8_bindings_pg = if (enabledFor("pg")) @import("v8_bindings_pg.zig") else struct {
    pub fn registerPg(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_embed = if (enabledFor("embed")) @import("v8_bindings_embed.zig") else struct {
    pub fn registerEmbed(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_video = if (enabledFor("video")) @import("v8_bindings_video.zig") else struct {
    pub fn registerVideo(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_audio = if (enabledFor("audio")) @import("v8_bindings_audio.zig") else struct {
    pub fn registerAudio(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_midi = if (enabledFor("midi")) @import("v8_bindings_midi.zig") else struct {
    pub fn registerMidi(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_deej = if (enabledFor("deej")) @import("v8_bindings_deej.zig") else struct {
    pub fn registerDeej(_: anytype) void {}
};
const v8_bindings_vterm = if (enabledFor("terminal")) @import("v8_bindings_vterm.zig") else struct {
    pub fn registerVterm(_: anytype) void {}
    pub fn tickDrain() void {}
};
const v8_bindings_doom = if (enabledFor("doom")) @import("v8_bindings_doom.zig") else struct {
    pub fn registerDoom(_: anytype) void {}
    pub fn tickDrain() void {}
};
// Paintable mask textures — opt-in via the `__paintable_` host fn prefix.
// Carts that import usePaintable() reference __paintable_circle etc., the
// metafile-gate sees the prefix, scripts/ship flips -Dhas-paintable=true.
const v8_bindings_paintable = if (enabledFor("paintable")) @import("v8_bindings_paintable.zig") else struct {
    pub fn registerPaintable(_: anytype) void {}
};
// LuaJIT off-thread worker — bindings are always registered. The worker
// itself dlopens libluajit-5.1 lazily, so carts that never call __lua_*
// pay only the host-fn registrations (no native lib link). engine.zig:91
// force-references the worker module, so the exported C symbols are
// always linkable from this file. Carts that actually USE lua must import
// runtime/hooks/useLuaWorker.ts so dep-registry triggers libluajit
// bundling (see sdk/dependency-registry.json `lua-worker`).
const v8_bindings_lua = @import("v8_bindings_lua.zig");
// Input-bench — pure-Zig WASD controller for cart/input_bench. Always-on
// because it has no native deps (SDL is foundational); inert until the
// cart calls __input_bench_set_enabled(true).
const v8_bindings_input_bench = @import("v8_bindings_input_bench.zig");
const v8_bindings_physics_lab = if (enabledFor("physics_lab")) @import("v8_bindings_physics_lab.zig") else struct {
    pub fn registerPhysicsLab(_: anytype) void {}
};
// The game's physics + movement (framework/game/, V18): __hmsc_*/__game_physics_*
// host fns. Gated INGREDIENT — when off, framework/game/ is never even parsed,
// so a 2D interface cart pays zero bytes and zero host fns for the game.
const v8_bindings_game_physics = if (enabledFor("game_physics")) @import("v8_bindings_game_physics.zig") else struct {
    pub fn registerGamePhysics(_: anytype) void {}
};
// The game's build placement (framework/game/build.zig, req_2349): host-owned
// raycast/placement/validate/queries — the iso world editor's placement brain,
// ported verbatim from game/build/*.ts so the editor stops importing the whole
// game cart to place a piece. __game_build_* host fns. Gated INGREDIENT — when
// off, framework/game/build.zig is never parsed.
const v8_bindings_game_build = if (enabledFor("game_build")) @import("v8_bindings_game_build.zig") else struct {
    pub fn registerGameBuild(_: anytype) void {}
};
// The map painter's authoring engine (framework/game/map/, req_2473): the 2D
// tile map painter's chunk grid + brush stamps + stroke engine, ported from
// cart/hmsc-int so painting terrain/tiles/water/flora/zones runs host-side.
// __map_* host fns. Gated INGREDIENT — when off, the module is never parsed.
const v8_bindings_game_map = if (enabledFor("game_map")) @import("v8_bindings_game_map.zig") else struct {
    pub fn registerGameMap(_: anytype) void {}
};
// The game's pathing (framework/game/pathing.zig, V5/V18): grid A* + lane
// discipline + deterministic motion plans, __path_*/__game_pathing_* host
// fns. Gated INGREDIENT — when off, the module is never even parsed.
const v8_bindings_game_pathing = if (enabledFor("game_pathing")) @import("v8_bindings_game_pathing.zig") else struct {
    pub fn registerGamePathing(_: anytype) void {}
};
// The game's camera controller (framework/game/camera.zig, V23): host-side
// per-frame solve/smoothing/interpolation, __game_camera_* host fns. Gated
// INGREDIENT — when off, the module is never parsed and Scene3D.Camera keeps
// its existing declarative JS-props path.
const v8_bindings_game_camera = if (enabledFor("game_camera")) @import("v8_bindings_game_camera.zig") else struct {
    pub fn registerGameCamera(_: anytype) void {}
};
// Compiled-world embedded primitive: React owns a Scene3D viewport node while
// Zig constructs + renders the baked game-file as a retained native scene.
const v8_bindings_compiled_world = if (enabledFor("compiled_world") and has_gpu_flag) @import("v8_bindings_compiled_world.zig") else struct {
    pub fn registerCompiledWorld(_: anytype) void {}
};
// Frame self-capture (SELFSHOT-0606): __capture_frame(path) writes the app's
// OWN rendered frame to a PNG — the replacement for the BANNED desktop/X11
// capture of the user's system. Rides the existing gpu/capture.zig readback.
// GPU-substrate only (capture.zig imports gpu.zig), so the gate composes
// with has_gpu like core/window do.
const v8_bindings_capture = if (enabledFor("capture") and has_gpu_flag) @import("v8_bindings_capture.zig") else struct {
    pub fn registerCapture(_: anytype) void {}
};

// Native Lore version history for resident editor models. This composes with
// the GPU gate because the panic snapshot reads scene3d's live mesh document;
// a cart that never imports the Lore runtime door does not parse this module or
// link the 34 MB liblore shared library.
const v8_bindings_lore = if (enabledFor("lore") and has_gpu_flag) @import("v8_bindings_lore.zig") else struct {
    pub fn registerLore(_: anytype) void {}
};

// Image transcode service (@reactjit/image): __imageops_* decode/resize/encode
// for PNG/JPEG/WebP. Pure headless — codec.zig only touches stb + a dlopen'd
// libwebp, never gpu.zig — so the gate does NOT compose with has_gpu (a TUI or
// pure-headless cart can resize images just fine).
const v8_bindings_image_ops = if (enabledFor("imageops")) @import("v8_bindings_image_ops.zig") else struct {
    pub fn registerImageOps(_: anytype) void {}
};

// ── INGREDIENTS ─────────────────────────────────────────────────────
//
// Required-true rows are always registered. Required-false rows are
// only "real" when the matching `has-<name>` build option is true —
// the corresponding `mod` resolves to a stub otherwise, so iterating
// the array uniformly does the right thing in either case.

pub const INGREDIENTS = [_]Ingredient{
    // Framework-essential (always-on). These bindings expose host fns
    // the React renderer / runtime depend on unconditionally —
    // __hostFlush, __fs_*, __zigCall, telemetry counters, etc. They're
    // "in every burrito" because no cart can run without them. New
    // required bindings still go here (do NOT bypass by hardcoding a
    // register call elsewhere in appInit).
    //
    // Core is the only truly framework-internal binding — its host fns
    // (__hostFlush/__setState/__markDirty/getMouse*/isKeyDown/...) are
    // called by runtime/index.tsx + runtime/primitives.tsx which every
    // cart bundles unconditionally as React reconciler scaffolding. So
    // gating it on a hook-file presence is degenerate; it's always
    // shipped because the framework boilerplate in the bundle always
    // references it.
    .{ .name = "core", .required = true, .grep_prefix = "", .reg_fn = "registerCore", .mod = v8_bindings_core },
    // Observability bus — always-on. The whole point is that every cart
    // gets free crash/overflow/perf diagnostics with no opt-in. Cost is
    // five host fns and a circular ring; nothing the cart has to import.
    .{ .name = "eventbus", .required = true, .grep_prefix = "", .reg_fn = "registerEventBus", .mod = v8_bindings_eventbus },
    // Authoring eventbus (framework/events/editor_bus.zig) — always-on like the other
    // buses. registerEditorBus() also calls editor_bus.init() and installs the __ffiEmit
    // broadcaster, so no boot line is needed elsewhere. The ordered stream belongs to the
    // current host process: V8 hot reload retains it and a cold app start begins empty.
    .{ .name = "editor_bus", .required = true, .grep_prefix = "", .reg_fn = "registerEditorBus", .mod = v8_bindings_editor_bus },
    // editor diagnostics registry — always-on observability (same rationale as the
    // eventbus above): registers __diag_emit/set_enabled/set_sample/recent/channels_state
    // and the in-app raw-console feed sink. The editor's first-class instrumentation.
    .{ .name = "editor_diag", .required = true, .grep_prefix = "", .reg_fn = "registerEditorDiag", .mod = v8_bindings_editor_diag },
    // useIFTTT registry + timer wheel — always-on. runtime/index.tsx
    // unconditionally requires useIFTTT.ts (it's the system-signal
    // sink), so every cart pulls the wire/timer host fns. Source-gating
    // this is degenerate for the same reason core is.
    .{ .name = "ifttt", .required = true, .grep_prefix = "", .reg_fn = "registerIFTTT", .mod = v8_bindings_ifttt },
    .{ .name = "env", .required = true, .grep_prefix = "", .reg_fn = "registerEnv", .mod = v8_bindings_env },
    .{ .name = "window", .required = true, .grep_prefix = "", .reg_fn = "registerWindow", .mod = v8_bindings_window },
    .{ .name = "inspector", .required = true, .grep_prefix = "", .reg_fn = "registerInspector", .mod = v8_bindings_inspector },
    // LuaJIT bindings — always-on. The worker module is force-imported by
    // engine.zig, so its C exports are universally linkable; libluajit
    // itself is dlopen'd inside the worker, so this binding stays cheap
    // (just host-fn registrations) for carts that never touch __lua_*.
    .{ .name = "lua", .required = true, .grep_prefix = "", .reg_fn = "registerLua", .mod = v8_bindings_lua },
    // Input-bench — pure-Zig WASD controller. Always-on but inert until
    // a cart calls __input_bench_set_enabled(true). No native deps.
    .{ .name = "input_bench", .required = true, .grep_prefix = "", .reg_fn = "registerInputBench", .mod = v8_bindings_input_bench },
    // Everything below is source-gated: scripts/ship reads the esbuild
    // metafile and only flips the matching -Dhas-X=true if a JS file
    // that calls into the binding is actually shipped.
    .{ .name = "fs", .required = false, .grep_prefix = "__fs_", .reg_fn = "registerFs", .mod = v8_bindings_fs },
    .{ .name = "websocket", .required = false, .grep_prefix = "__ws_", .reg_fn = "registerWebSocket", .mod = v8_bindings_websocket },
    .{ .name = "telemetry", .required = false, .grep_prefix = "__tel_", .reg_fn = "registerTelemetry", .mod = v8_bindings_telemetry },
    .{ .name = "sqlite", .required = false, .grep_prefix = "__sql_", .reg_fn = "registerSqlite", .mod = v8_bindings_sqlite },
    .{ .name = "zigcall", .required = false, .grep_prefix = "__zig_call", .reg_fn = "registerZigCall", .mod = v8_bindings_zigcall },
    .{ .name = "zigcall_list", .required = false, .grep_prefix = "__zig_call", .reg_fn = "registerZigCallList", .mod = v8_bindings_zigcall },
    // Opt-in per cart — scripts/ship grep flips -Dhas-X when the bundle
    // references the matching prefix. Carts that don't order them get
    // a comptime stub (no host-fn registration, no tickDrain).
    .{ .name = "process", .required = false, .grep_prefix = "__proc_", .reg_fn = "registerProcess", .mod = v8_bindings_process },
    .{ .name = "httpsrv", .required = false, .grep_prefix = "__httpsrv_", .reg_fn = "registerHttpServer", .mod = v8_bindings_httpserver },
    .{ .name = "wssrv", .required = false, .grep_prefix = "__wssrv_", .reg_fn = "registerWsServer", .mod = v8_bindings_wsserver },
    .{ .name = "net", .required = false, .grep_prefix = "__tcp_", .reg_fn = "registerNet", .mod = v8_bindings_net },
    .{ .name = "gameserver", .required = false, .grep_prefix = "__rcon_", .reg_fn = "registerGameServer", .mod = v8_bindings_gameserver },
    .{ .name = "tor", .required = false, .grep_prefix = "__tor_", .reg_fn = "registerTor", .mod = v8_bindings_tor },
    .{ .name = "privacy", .required = false, .grep_prefix = "__priv_", .reg_fn = "registerPrivacy", .mod = v8_bindings_privacy },
    .{ .name = "sdk", .required = false, .grep_prefix = "__http_request_", .reg_fn = "registerSdk", .mod = v8_bindings_sdk },
    .{ .name = "voice", .required = false, .grep_prefix = "__voice_", .reg_fn = "registerVoice", .mod = v8_bindings_voice },
    .{ .name = "audio_input", .required = false, .grep_prefix = "__rawCapture_", .reg_fn = "registerAudioInput", .mod = v8_bindings_audio_input },
    .{ .name = "whisper", .required = false, .grep_prefix = "__whisper_", .reg_fn = "registerWhisper", .mod = v8_bindings_whisper },
    .{ .name = "onnx", .required = false, .grep_prefix = "__onnx_", .reg_fn = "registerOnnx", .mod = v8_bindings_onnx },
    .{ .name = "pg", .required = false, .grep_prefix = "__pg_", .reg_fn = "registerPg", .mod = v8_bindings_pg },
    .{ .name = "embed", .required = false, .grep_prefix = "__embed_", .reg_fn = "registerEmbed", .mod = v8_bindings_embed },
    .{ .name = "video", .required = false, .grep_prefix = "__video_", .reg_fn = "registerVideo", .mod = v8_bindings_video },
    .{ .name = "audio", .required = false, .grep_prefix = "__audio_", .reg_fn = "registerAudio", .mod = v8_bindings_audio },
    .{ .name = "midi", .required = false, .grep_prefix = "__midi_", .reg_fn = "registerMidi", .mod = v8_bindings_midi },
    .{ .name = "deej", .required = false, .grep_prefix = "__deej_", .reg_fn = "registerDeej", .mod = v8_bindings_deej },
    .{ .name = "vterm", .required = false, .grep_prefix = "__vterm_", .reg_fn = "registerVterm", .mod = v8_bindings_vterm },
    .{ .name = "doom", .required = false, .grep_prefix = "__doom_", .reg_fn = "registerDoom", .mod = v8_bindings_doom },
    .{ .name = "paintable", .required = false, .grep_prefix = "__paintable_", .reg_fn = "registerPaintable", .mod = v8_bindings_paintable },
    .{ .name = "physics_lab", .required = false, .grep_prefix = "__physics_lab_", .reg_fn = "registerPhysicsLab", .mod = v8_bindings_physics_lab },
    .{ .name = "game_physics", .required = false, .grep_prefix = "__hmsc_", .reg_fn = "registerGamePhysics", .mod = v8_bindings_game_physics },
    .{ .name = "game_build", .required = false, .grep_prefix = "__game_build_", .reg_fn = "registerGameBuild", .mod = v8_bindings_game_build },
    .{ .name = "game_map", .required = false, .grep_prefix = "__map_", .reg_fn = "registerGameMap", .mod = v8_bindings_game_map },
    .{ .name = "game_pathing", .required = false, .grep_prefix = "__path_", .reg_fn = "registerGamePathing", .mod = v8_bindings_game_pathing },
    .{ .name = "game_camera", .required = false, .grep_prefix = "__game_camera_", .reg_fn = "registerGameCamera", .mod = v8_bindings_game_camera },
    .{ .name = "compiled_world", .required = false, .grep_prefix = "__compiled_world_", .reg_fn = "registerCompiledWorld", .mod = v8_bindings_compiled_world },
    .{ .name = "capture", .required = false, .grep_prefix = "__capture_", .reg_fn = "registerCapture", .mod = v8_bindings_capture },
    .{ .name = "lore", .required = false, .grep_prefix = "__lore_", .reg_fn = "registerLore", .mod = v8_bindings_lore },
    .{ .name = "imageops", .required = false, .grep_prefix = "__imageops_", .reg_fn = "registerImageOps", .mod = v8_bindings_image_ops },
};

/// Register every ingredient's host fns into the current V8 context.
/// Call once at shell init, after v8_runtime.initVM() and before the
/// cart bundle evaluates. Real binding for opted-in ingredients, no-op
/// stub for the rest.
pub fn registerAll(host: *HostContext) void {
    inline for (INGREDIENTS) |ing| @field(ing.mod, ing.reg_fn)(host);
}

/// Pump every ingredient's per-tick work — accept new HTTP connections,
/// deliver completed SDK requests, etc. The GPU shell calls this from
/// inside the render loop; the TUI shell calls it from JS via
/// __tickDrain. Stubs no-op.
///
/// Return value: true if any binding signaled that downstream consumers
/// should act on freshly-drained work. Today only vterm's tickDrain
/// returns bool (true = new PTY data; tui/v8-preamble.js fires
/// __onVtermUpdate so the ANSI walker repaints without polling latency).
/// The GPU shell discards the bool because engine.run owns its own
/// repaint cadence; the TUI shell forwards it to JS.
pub fn tickDrain(host: *HostContext) bool {
    var signaled: bool = false;
    inline for (INGREDIENTS) |ing| {
        if (@hasDecl(ing.mod, "tickDrain")) {
            const td = @field(ing.mod, "tickDrain");
            const fn_info = @typeInfo(@TypeOf(td)).@"fn";
            const RetT = fn_info.return_type orelse void;
            if (comptime fn_info.params.len == 0) {
                if (RetT == bool) {
                    if (td()) signaled = true;
                } else {
                    _ = td();
                }
            } else if (comptime fn_info.params.len == 1) {
                if (RetT == bool) {
                    if (td(host)) signaled = true;
                } else {
                    _ = td(host);
                }
            } else {
                @compileError("ingredient tickDrain must accept zero args or *HostContext");
            }
        }
    }
    return signaled;
}
