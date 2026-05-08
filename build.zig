//! Root build.zig — builds v8_app.zig against framework/ into zig-out/bin/<name>.
//!
//! Usage:
//!   zig build app                                       # default: v8_app.zig → zig-out/bin/app
//!   zig build app -Dapp-name=hello                      # → zig-out/bin/hello
//!   zig build app -Dapp-name=hello -Dapp-source=foo.zig # different root source
//!
//! Everything Smith-era lives in the frozen tsz/ directory and is not built here.
//! The QJS / .tsz era runtime files were evicted to archive/qjs-stack/ on 2026-05-08
//! (see archive/qjs-stack/README.md).

const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const app_name = b.option([]const u8, "app-name", "Output binary name") orelse "app";
    // QJS path archived (archive/qjs-stack/) — the use-v8 option survives only
    // as a build-options signal that other modules may read; the default root
    // source is now v8_app.zig regardless.
    const use_v8 = b.option(bool, "use-v8", "(legacy: V8 is the only engine now)") orelse true;
    const app_source = b.option([]const u8, "app-source", "Root Zig source file") orelse "v8_app.zig";
    const sysroot = b.option([]const u8, "sysroot", "Optional sysroot for cross-builds");
    const dev_mode = b.option(bool, "dev-mode", "Read bundle.js from disk and hot-reload on change") orelse false;
    const custom_chrome = b.option(bool, "custom-chrome", "Cart draws its own window chrome (borderless)") orelse false;
    const prebuilt_v8_path = b.option(
        []const u8,
        "prebuilt_v8_path",
        "Absolute path to prebuilt libc_v8.a",
    ) orelse b.pathFromRoot("deps/v8-prebuilt/libc_v8.a");

    // ── wgpu-native ────────────────────────────────────────────
    const wgpu_dep = b.dependency("wgpu_native_zig", .{
        .target = target,
        .optimize = optimize,
    });
    const wgpu_mod = wgpu_dep.module("wgpu");

    // ── tls.zig (browser page fetch path) ───────────────────────
    const tls_dep = b.dependency("tls_zig", .{
        .target = target,
        .optimize = optimize,
    });
    const tls_mod = b.createModule(.{
        .root_source_file = tls_dep.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });

    // ── zluajit (LuaJIT worker compute) ────────────────────────
    // .system=false → zluajit compiles LuaJIT from the source it bundles
    // (cached at tools/zig/cache/p/zluajit-...). With .system=true, zluajit
    // calls linkSystemLibrary("luajit") which expects a generic libluajit.so
    // — distros only ship libluajit-5.1.so, so the link fails everywhere.
    const zluajit_dep = b.dependency("zluajit", .{
        .target = target,
        .optimize = optimize,
        .system = false,
    });

    // ── Build options ──────────────────────────────────────────
    // ── Native-library feature gates ───────────────────────────
    // These mirror sdk/dependency-registry.json. The resolver
    // (scripts/sdk-dependency-resolve.js) inspects each cart's metafile
    // and emits -Dhas-X=true only for features the cart's source actually
    // triggers. Every gate here defaults to false; scripts/dev uses the
    // resolver's --dev-zig-flags mode to force them all on for the fat
    // dev host. Each gate must guard both the library link/include and
    // any framework code site that references the library's symbols.
    const has_physics = b.option(bool, "has-physics", "Link box2d + physics2d module") orelse false;
    const has_sqlite = b.option(bool, "has-sqlite", "Link sqlite3 + real sqlite.zig (otherwise stub)") orelse false;
    const has_terminal = b.option(bool, "has-terminal", "Link libvterm + real vterm.zig (otherwise stub)") orelse false;
    const has_audio = b.option(bool, "has-audio", "Compile audio_real.zig (SDL3 audio + LuaJIT DSP) — implies has-lua-worker") orelse false;
    // Audio's DSP engine imports zluajit, so has-audio forces
    // has-lua-worker on. Carts that want only the lua compute worker
    // (without audio) flip has-lua-worker explicitly.
    const has_lua_worker_explicit = b.option(bool, "has-lua-worker", "Link luajit-5.1 + real luajit_worker.zig (otherwise stub)") orelse false;
    const has_lua_worker = has_lua_worker_explicit or has_audio;
    const has_midi = b.option(bool, "has-midi", "Link libasound + real midi.zig (ALSA snd_seq_* MIDI input) — otherwise stub") orelse false;

    // Bundle path override. When unset, v8_app.zig falls back to embedding
    // bundle-<app-name>.js relative to its own source directory (the
    // in-repo case). When set (e.g. by rjit-driven builds where the user's
    // cart lives outside the SDK install), this absolute path is used by
    // @embedFile so the bundle can sit in CART_ROOT while build.zig and
    // v8_app.zig live in RJIT_HOME.
    const bundle_path = b.option([]const u8, "bundle-path", "Absolute path to the cart bundle (overrides default bundle-<app-name>.js lookup)") orelse "";

    const options = b.addOptions();
    options.addOption(bool, "is_lib", false);
    options.addOption([]const u8, "app_name", app_name);
    options.addOption(bool, "dev_mode", dev_mode);
    options.addOption(bool, "custom_chrome", custom_chrome);
    options.addOption(bool, "has_physics", has_physics);
    options.addOption(bool, "has_sqlite", has_sqlite);
    options.addOption(bool, "has_terminal", has_terminal);
    options.addOption(bool, "has_audio", has_audio);
    options.addOption(bool, "has_lua_worker", has_lua_worker);
    options.addOption(bool, "has_midi", has_midi);
    options.addOption([]const u8, "bundle_path", bundle_path);
    options.addOption(bool, "has_video", true);
    options.addOption(bool, "has_render_surfaces", true);
    options.addOption(bool, "has_effects", true);
    options.addOption(bool, "has_canvas", true);
    options.addOption(bool, "has_3d", true);
    options.addOption(bool, "has_transitions", true);
    options.addOption(bool, "has_networking", true);
    options.addOption(bool, "has_crypto", true);
    options.addOption(bool, "has_blend2d", false);
    options.addOption(bool, "has_debug_server", true);
    options.addOption(bool, "use_v8", use_v8);

    const root_mod = b.createModule(.{
        .root_source_file = b.path(app_source),
        .target = target,
        .optimize = optimize,
    });
    root_mod.addOptions("build_options", options);
    root_mod.addImport("wgpu", wgpu_mod);
    root_mod.addImport("tls", tls_mod);
    if (has_lua_worker) root_mod.addImport("zluajit", zluajit_dep.module("zluajit"));

    // ── pg.zig (Postgres client) ────────────────────────────────
    // Used by framework/pg.zig (and via that, framework/embed.zig). Always
    // imported so the comptime-stub paths in v8_app.zig still resolve when
    // -Dhas-pg=false; the dep itself doesn't link any C and is cheap to compile.
    const pg_dep = b.dependency("pg", .{
        .target = target,
        .optimize = optimize,
    });
    root_mod.addImport("pg", pg_dep.module("pg"));

    const v8_dep_opt = if (use_v8) b.dependency("v8", .{
        .target = target,
        .optimize = optimize,
        .prebuilt_v8_path = @as([]const u8, prebuilt_v8_path),
    }) else null;
    if (v8_dep_opt) |v8_dep| {
        root_mod.addImport("v8", v8_dep.module("v8"));
        // libc_v8.a is prebuilt and missing the SetStackLimit binding. We
        // need it to grow V8's per-isolate stack budget past the ~700KB
        // default (see framework/ffi/v8_stack_shim.cpp for the full why).
        // The shim calls V8's mangled symbol directly so it doesn't need V8
        // headers — those aren't checked into deps/zig-v8.
        root_mod.addCSourceFile(.{
            .file = b.path("framework/ffi/v8_stack_shim.cpp"),
            .flags = &.{ "-O2", "-std=c++17" },
        });
    }

    const exe = b.addExecutable(.{
        .name = app_name,
        .root_module = root_mod,
    });
    // 64MB stack. Debug frames are massive (SDL_Event union + engine.run locals
    // alone burn through the old 16MB), and recursive hitTest/paint walks on
    // deep trees compound fast. VA-only; no RSS cost until used.
    exe.stack_size = 64 * 1024 * 1024;

    // ── Always linked ──────────────────────────────────────────
    exe.linkLibC();
    exe.linkSystemLibrary("SDL3");
    exe.linkSystemLibrary("freetype");
    if (has_lua_worker) exe.linkSystemLibrary("luajit-5.1");

    const os_tag = target.result.os.tag;
    if (os_tag == .linux) {
        // X11/m/pthread/dl are universal on every desktop Linux — system-assumed,
        // never bundled. SDL3/freetype/luajit headers + sos come from the
        // sysroot when -Dsysroot is set; otherwise we fall back to the host's
        // /usr/include/* layout (Debian-shaped paths).
        exe.linkSystemLibrary("X11");
        exe.linkSystemLibrary("m");
        exe.linkSystemLibrary("pthread");
        exe.linkSystemLibrary("dl");
        // libasound is required by framework/midi_real.zig, which calls
        // ALSA's snd_seq_* API for MIDI sequencer input on Linux. SDL3's
        // audio backends are dlopen'd at runtime (so SDL3 doesn't pull
        // libasound into DT_NEEDED via the audio path), but midi_real.zig
        // declares the snd_seq_* symbols via @extern, and those need
        // libasound at link time. The dispatcher in framework/midi.zig
        // selects midi_real.zig only when has_midi is on; the stub
        // doesn't reference any ALSA symbols, so non-MIDI carts skip
        // both the link and the ~600KB DT_NEEDED entry.
        if (has_midi) exe.linkSystemLibrary("asound");
        if (sysroot) |sr| {
            root_mod.addIncludePath(.{ .cwd_relative = b.fmt("{s}/usr/include/luajit-2.1", .{sr}) });
            root_mod.addIncludePath(.{ .cwd_relative = b.fmt("{s}/usr/include/freetype2", .{sr}) });
            root_mod.addIncludePath(.{ .cwd_relative = b.fmt("{s}/usr/include", .{sr}) });
            root_mod.addLibraryPath(.{ .cwd_relative = b.fmt("{s}/usr/lib", .{sr}) });
        } else {
            root_mod.addIncludePath(.{ .cwd_relative = "/usr/include/luajit-2.1" });
            root_mod.addIncludePath(.{ .cwd_relative = "/usr/include/freetype2" });
            root_mod.addIncludePath(.{ .cwd_relative = "/usr/include/x86_64-linux-gnu" });
        }
    } else if (os_tag == .macos) {
        root_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include/luajit-2.1" });
        root_mod.addLibraryPath(.{ .cwd_relative = "/opt/homebrew/lib" });
        root_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include" });
        root_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include/freetype2" });
        root_mod.addLibraryPath(.{ .cwd_relative = "/opt/homebrew/opt/libarchive/lib" });
        root_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/opt/libarchive/include" });
        exe.linkFramework("Foundation");
        exe.linkFramework("QuartzCore");
        exe.linkFramework("Metal");
        exe.linkFramework("Cocoa");
        exe.linkFramework("IOKit");
        exe.linkFramework("CoreVideo");
        root_mod.addCSourceFile(.{ .file = b.path("framework/ffi/applescript_shim.m"), .flags = &.{"-O2"} });
    }

    // ── Include paths ──────────────────────────────────────────
    root_mod.addIncludePath(b.path("."));
    root_mod.addIncludePath(b.path("framework/ffi"));
    // llama.h + ggml*.h for framework/local_ai_runtime.zig's @cImport.
    // We dlopen lmstudio's libllama.so at runtime; these headers only
    // give the Zig compiler authoritative struct layouts (no link-time
    // dep on llama.cpp). Source: github.com/ggerganov/llama.cpp HEAD,
    // synced into the repo so builds don't depend on deps/llama.cpp.zig.
    root_mod.addIncludePath(b.path("framework/ffi/llama_headers"));

    // QuickJS C sources no longer compiled — qjs_runtime archived
    // (archive/qjs-stack/). The C files in love2d/quickjs/ stay where
    // they are (love2d/ tree is frozen reference) but no longer feed
    // into any cart binary.

    // ── stb image read + write ────────────────────────────────
    // stbi_load_from_memory powers image_cache.zig (the <Image> primitive).
    // stbi_write_png powers capture/witness screenshotting.
    root_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_impl.c"), .flags = &.{"-O2"} });
    root_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_write_impl.c"), .flags = &.{"-O2"} });

    // ── libfvad (WebRTC VAD) ─────────────────────────────────
    // Tiny (~1500 LOC), BSD-licensed, no deps. Always linked because
    // framework/voice.zig (mic capture + utterance state machine) is wired
    // unconditionally into engine.run, mirroring clipboard_watch.zig. Cost:
    // a few dozen KB of binary and zero runtime cost when no cart calls
    // __voice_start. The has-voice gate only controls v8_bindings_voice
    // host-fn registration, not whether the C is compiled.
    root_mod.addIncludePath(b.path("deps/libfvad/include"));
    root_mod.addCSourceFiles(.{
        .root = b.path("deps/libfvad/src"),
        .files = &.{
            "fvad.c",
            "signal_processing/division_operations.c",
            "signal_processing/energy.c",
            "signal_processing/get_scaling_square.c",
            "signal_processing/resample_48khz.c",
            "signal_processing/resample_by_2_internal.c",
            "signal_processing/resample_fractional.c",
            "signal_processing/spl_inl.c",
            "vad/vad_core.c",
            "vad/vad_filterbank.c",
            "vad/vad_gmm.c",
            "vad/vad_sp.c",
        },
        .flags = &.{ "-O2", "-fPIC", "-std=c11" },
    });

    // ── whisper.cpp + ggml (CPU) ─────────────────────────────
    // Gated by has-whisper because it's heavy (~5MB source, ~10MB binary).
    // Carts that don't transcribe don't pay the build-time or binary cost.
    // Enabled by scripts/ship when the bundle imports useVoiceInput AND a
    // transcribe call site is present (see ship-metafile-gate.js / registry).
    //
    // The option is hoisted up here (rather than declared with the other
    // has-X gates further down) because the compile block needs it. Keep
    // the options.addOption / manifest writes alongside the others below.
    const has_whisper = b.option(bool, "has-whisper", "Compile whisper.cpp + ggml (CPU) + register __whisper_* bindings") orelse false;
    if (has_whisper) {
        // Build whisper + ggml-cpu as a SHARED library, not statically
        // compiled into the cart binary. The cart's link unit pulls in
        // libc_v8.a (V8 prebuilt) which ships its own statically-linked
        // libstdc++ symbols (std::runtime_error et al). Compiling
        // whisper's C++ directly produces duplicate-symbol errors at
        // ld.lld time. As a separate .so, libwhisper resolves its own
        // libstdc++ at load time, isolated from the main binary's
        // copies. Cart links against the .so via -lwhisper + rpath.
        const whisper_root = b.path("deps/whisper.cpp");

        const cpu_flags = [_][]const u8{
            "-O3",            "-fPIC",                       "-D_GNU_SOURCE",             "-DNDEBUG",
            "-DGGML_USE_CPU", "-DGGML_VERSION=\"vendored\"", "-DGGML_COMMIT=\"unknown\"", "-DWHISPER_VERSION=\"vendored\"",
            "-mavx",          "-mavx2",                      "-mfma",                     "-mf16c",
            "-msse3",         "-mssse3",                     "-pthread",
        };
        const c_flags_whisper = cpu_flags ++ .{"-std=c11"};
        const cpp_flags_whisper = cpu_flags ++ .{"-std=c++17"};

        const wmod = b.createModule(.{
            .target = target,
            .optimize = optimize,
            .link_libc = true,
            .link_libcpp = true,
        });
        wmod.addIncludePath(whisper_root.path(b, "include"));
        wmod.addIncludePath(whisper_root.path(b, "ggml/include"));
        wmod.addIncludePath(whisper_root.path(b, "ggml/src"));
        wmod.addIncludePath(whisper_root.path(b, "ggml/src/ggml-cpu"));

        wmod.addCSourceFiles(.{
            .root = whisper_root.path(b, "ggml/src"),
            .files = &.{ "ggml.c", "ggml-alloc.c", "ggml-quants.c" },
            .flags = &c_flags_whisper,
        });
        wmod.addCSourceFiles(.{
            .root = whisper_root.path(b, "ggml/src"),
            .files = &.{
                "ggml.cpp",
                "ggml-backend.cpp",
                "ggml-backend-reg.cpp",
                "ggml-backend-dl.cpp",
                "ggml-threading.cpp",
                "ggml-opt.cpp",
                "gguf.cpp",
            },
            .flags = &cpp_flags_whisper,
        });
        wmod.addCSourceFiles(.{
            .root = whisper_root.path(b, "ggml/src/ggml-cpu"),
            .files = &.{ "ggml-cpu.c", "quants.c", "arch/x86/quants.c" },
            .flags = &c_flags_whisper,
        });
        wmod.addCSourceFiles(.{
            .root = whisper_root.path(b, "ggml/src/ggml-cpu"),
            .files = &.{
                "ggml-cpu.cpp",
                "ops.cpp",
                "binary-ops.cpp",
                "unary-ops.cpp",
                "vec.cpp",
                "traits.cpp",
                "repack.cpp",
                "hbm.cpp",
                "arch/x86/repack.cpp",
                "arch/x86/cpu-feats.cpp",
            },
            .flags = &cpp_flags_whisper,
        });
        wmod.addCSourceFiles(.{
            .root = whisper_root.path(b, "src"),
            .files = &.{"whisper.cpp"},
            .flags = &cpp_flags_whisper,
        });

        const whisper_lib = b.addLibrary(.{
            .name = "whisper",
            .root_module = wmod,
            .linkage = .dynamic,
        });
        b.installArtifact(whisper_lib);

        // Cart binary: include whisper.h + dynamic-link to the .so. rpath
        // $ORIGIN so the binary finds libwhisper.so next to itself when
        // packaged by scripts/ship (which already bundles all .so deps).
        root_mod.addIncludePath(whisper_root.path(b, "include"));
        root_mod.addIncludePath(whisper_root.path(b, "ggml/include"));
        exe.linkLibrary(whisper_lib);
        exe.addRPath(.{ .cwd_relative = "$ORIGIN" });
    }

    // ── llama.cpp via libllama_ffi.so (has_embed) ──────────────
    // Wraps the embedding + reranker work that experiments/embed-bench
    // validated. Pre-built .so lives at tsz/zig-out/lib/libllama_ffi.so
    // (same path the bench used). $ORIGIN rpath so scripts/ship can
    // bundle the .so next to the cart binary.
    const has_pg = b.option(bool, "has-pg", "Register __pg_* bindings (pg.zig client + embedded postgres)") orelse false;
    const has_embed = b.option(bool, "has-embed", "Register __embed_* bindings (llama.cpp + pgvector store; implies has-pg)") orelse false;
    if (has_embed) {
        // Prefer root zig-out/lib (a recent libllama_ffi.so dropped here wins
        // over the frozen tsz copy — needed for newer arches like gemma4).
        // Falls through to tsz/zig-out/lib if root has no .so.
        const root_lib = std.fs.cwd().access("zig-out/lib/libllama_ffi.so", .{}) catch null;
        if (root_lib != null) {
            root_mod.addLibraryPath(b.path("zig-out/lib"));
        } else {
            root_mod.addLibraryPath(b.path("tsz/zig-out/lib"));
        }
        exe.linkSystemLibrary("llama_ffi");
        exe.addRPath(.{ .cwd_relative = "$ORIGIN" });
        exe.addRPath(.{ .cwd_relative = "$ORIGIN/../lib" });
    }

    // ── Framework FFI shims ────────────────────────────────────
    root_mod.addCSourceFile(.{ .file = b.path("framework/ffi/compute_shim.c"), .flags = &.{"-O2"} });
    if (has_physics) {
        root_mod.addCSourceFile(.{ .file = b.path("framework/ffi/physics_shim.cpp"), .flags = &.{"-O2"} });
    }

    // ── System libraries ──────────────────────────────────────
    if (has_physics) exe.linkSystemLibrary("box2d");
    if (has_sqlite) exe.linkSystemLibrary("sqlite3");
    if (has_terminal) exe.linkSystemLibrary("vterm");

    // ── Privacy / libsodium (opt-in per cart) ─────────────────
    // Source-driven: cart bundle that imports usePrivacy gets libsodium
    // linked + bundled. Cart that doesn't, doesn't pay for it. scripts/ship
    // greps the bundle and passes -Dhas-privacy.
    const has_privacy = b.option(bool, "has-privacy", "Link libsodium + privacy bindings") orelse false;
    options.addOption(bool, "has_privacy", has_privacy);
    if (has_privacy) {
        exe.linkSystemLibrary("sodium");
        if (os_tag == .linux) {
            const brew_sodium = "/home/linuxbrew/.linuxbrew/Cellar/libsodium/1.0.20/include";
            if (std.fs.cwd().access(brew_sodium, .{})) |_| {
                root_mod.addIncludePath(.{ .cwd_relative = brew_sodium });
                root_mod.addLibraryPath(.{ .cwd_relative = "/home/linuxbrew/.linuxbrew/Cellar/libsodium/1.0.20/lib" });
            } else |_| {}
        }
    }

    // ── useHost domain bindings (opt-in per cart) ─────────────
    // Source-driven: cart only pays for the V8 bindings it actually uses.
    // scripts/ship greps the bundle for `__proc_`, `__httpsrv_`, `__wssrv_`
    // and passes the matching flags. Without these gates, every cart eats
    // ~hundreds of host-fn registrations on startup whether it uses them
    // or not — and that load corrupted V8's Function::Call path on
    // 2026-04-25 (see "Function.call broken on every cart" debugging log).
    const has_process = b.option(bool, "has-process", "Register __proc_*/__env_* bindings") orelse false;
    const has_httpsrv = b.option(bool, "has-httpsrv", "Register __httpsrv_* bindings") orelse false;
    const has_wssrv = b.option(bool, "has-wssrv", "Register __wssrv_* bindings") orelse false;
    const has_net = b.option(bool, "has-net", "Register __tcp_*/__udp_*/__socks5_* bindings") orelse false;
    const has_tor = b.option(bool, "has-tor", "Register __tor_* bindings") orelse false;
    const has_fs = b.option(bool, "has-fs", "Register __fs_*/__window_* bindings") orelse false;
    const has_websocket = b.option(bool, "has-websocket", "Register __ws_* (client) bindings") orelse false;
    const has_telemetry = b.option(bool, "has-telemetry", "Register __tel_*/getFps/... bindings") orelse false;
    const has_zigcall = b.option(bool, "has-zigcall", "Register __zig_call/__zig_call_list bindings") orelse false;
    const has_sdk = b.option(bool, "has-sdk", "Register __http_request_*/__fetch/__claude_*/__kimi_*/__localai_*/__browser_*/__ipc_*/__play_*/__rec_* bindings") orelse false;
    const has_voice = b.option(bool, "has-voice", "Register __voice_* bindings (mic + WebRTC VAD)") orelse false;
    // has_whisper, has_pg, has_embed hoisted earlier (next to their compile/link blocks).
    options.addOption(bool, "has_process", has_process);
    options.addOption(bool, "has_httpsrv", has_httpsrv);
    options.addOption(bool, "has_wssrv", has_wssrv);
    options.addOption(bool, "has_net", has_net);
    options.addOption(bool, "has_tor", has_tor);
    options.addOption(bool, "has_fs", has_fs);
    options.addOption(bool, "has_websocket", has_websocket);
    options.addOption(bool, "has_telemetry", has_telemetry);
    options.addOption(bool, "has_zigcall", has_zigcall);
    options.addOption(bool, "has_sdk", has_sdk);
    options.addOption(bool, "has_voice", has_voice);
    options.addOption(bool, "has_pg", has_pg or has_embed);
    options.addOption(bool, "has_embed", has_embed);
    options.addOption(bool, "has_whisper", has_whisper);

    // ── Allergen label: V8 binding manifest ───────────────────────────
    // Writes one file per opt-in domain to zig-out/manifest/<name>.flag
    // with content "1" or "0" depending on whether that ingredient was
    // compiled into the binary. scripts/ship reads these post-build and
    // diffs against the cart's pre-build declaration. Any mismatch and
    // the binary is deleted before it can ship — the kitchen cannot
    // contradict the label on the package.
    const manifest_wf = b.addWriteFiles();
    _ = manifest_wf.add("v8-ingredients/privacy.flag", if (has_privacy) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/process.flag", if (has_process) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/httpsrv.flag", if (has_httpsrv) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/wssrv.flag", if (has_wssrv) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/net.flag", if (has_net) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/tor.flag", if (has_tor) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/fs.flag", if (has_fs) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/websocket.flag", if (has_websocket) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/telemetry.flag", if (has_telemetry) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/zigcall.flag", if (has_zigcall) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/sdk.flag", if (has_sdk) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/voice.flag", if (has_voice) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/pg.flag", if (has_pg or has_embed) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/embed.flag", if (has_embed) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/whisper.flag", if (has_whisper) "1\n" else "0\n");
    const install_manifest = b.addInstallDirectory(.{
        .source_dir = manifest_wf.getDirectory(),
        .install_dir = .prefix,
        .install_subdir = "manifest",
    });
    b.getInstallStep().dependOn(&install_manifest.step);

    // ── C++ runtime ────────────────────────────────────────────
    // physics_shim.cpp still requires the C++ runtime even with Blend2D gone.
    exe.linkLibCpp();

    if (os_tag == .linux) {
        if (sysroot) |sr| {
            root_mod.addIncludePath(.{ .cwd_relative = b.fmt("{s}/usr/include", .{sr}) });
        } else {
            root_mod.addIncludePath(.{ .cwd_relative = "/usr/include/x86_64-linux-gnu" });
        }
    } else if (os_tag == .macos) {
        root_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include" });
    }

    b.installArtifact(exe);

    const app_step = b.step("app", "Build the v8_app binary");
    app_step.dependOn(&b.addInstallArtifact(exe, .{}).step);
    app_step.dependOn(&install_manifest.step);

    // ── v8-hello: smoke test for framework/v8_runtime.zig ──────
    const v8_hello_dep = b.dependency("v8", .{
        .target = target,
        .optimize = optimize,
        .prebuilt_v8_path = @as([]const u8, prebuilt_v8_path),
    });
    const v8_mod = v8_hello_dep.module("v8");

    const v8_hello_mod = b.createModule(.{
        .root_source_file = b.path("v8_hello.zig"),
        .target = target,
        .optimize = optimize,
    });
    v8_hello_mod.addImport("v8", v8_mod);

    const v8_hello_exe = b.addExecutable(.{
        .name = "v8-hello",
        .root_module = v8_hello_mod,
    });
    v8_hello_exe.linkLibC();
    v8_hello_exe.linkLibCpp();

    const v8_hello_step = b.step("v8-hello", "Build v8_hello smoke test");
    v8_hello_step.dependOn(&b.addInstallArtifact(v8_hello_exe, .{}).step);

    // ── v8-cli: standalone V8 host that runs a JS file ─────────
    // No SDL / framework / UI. Used to replace `node scripts/X.mjs` calls so
    // the repo has zero npm/node dependencies. Reuses v8_runtime.zig and the
    // CLI-only bindings in framework/v8_bindings_cli.zig.
    // v8cli always builds ReleaseFast. Host tool — it's not part of any
    // cart's debug loop, and the global -Doptimize=Debug default triggers
    // a Zig 0.15 / lld bug where `.init_array` slots get CREL relocations
    // (.crel.init_array / .crel.init_array.100 sections) that the loader
    // never applies → NULL function pointers → glibc call_init crashes
    // at PC 0 the moment v8cli launches. ReleaseFast emits regular RELA
    // relocations that get applied normally. Pinning here makes v8cli
    // immune to the user's -Doptimize choice.
    const v8_cli_mod = b.createModule(.{
        .root_source_file = b.path("v8_cli.zig"),
        .target = target,
        .optimize = .ReleaseFast,
    });
    v8_cli_mod.addImport("v8", v8_mod);
    // Same stack-shim requirement as the main app: v8_runtime.zig calls
    // setStackLimit, which the prebuilt libc_v8.a doesn't ship.
    v8_cli_mod.addCSourceFile(.{
        .file = b.path("framework/ffi/v8_stack_shim.cpp"),
        .flags = &.{ "-O2", "-std=c++17" },
    });

    const v8_cli_exe = b.addExecutable(.{
        .name = "v8cli",
        .root_module = v8_cli_mod,
    });
    // Match the main app's 64MB stack — v8_runtime.zig hands V8 a 16MB
    // stack budget via SetStackLimit, so the OS stack must comfortably
    // exceed that with native frame headroom on top.
    v8_cli_exe.stack_size = 64 * 1024 * 1024;
    v8_cli_exe.linkLibC();
    v8_cli_exe.linkLibCpp();

    const v8_cli_step = b.step("v8-cli", "Build standalone V8 script host (zig-out/bin/v8cli)");
    v8_cli_step.dependOn(&b.addInstallArtifact(v8_cli_exe, .{}).step);

    // ── tui-app: self-contained TUI cart binary ─────────────────
    // Same shape as v8-cli but with @embedFile baking the cart bundle into
    // the binary at build time. -Dapp-name renames the output, -Dbundle-path
    // points at the prebuilt esbuild bundle. scripts/ship-tui drives both.
    //
    // No SDL, no GPU host, no .so wrangling — v8cli's only dynamic deps are
    // libm + libc + ld-linux, which are universal on every desktop Linux.
    // The result is a single-file executable with no install needed.
    {
        const tui_options = b.addOptions();
        tui_options.addOption([]const u8, "app_name", app_name);
        tui_options.addOption([]const u8, "bundle_path", bundle_path);
        // Mirrors the GPU app's gate: when -Dhas-terminal=true is passed,
        // libvterm is linked and framework/vterm.zig dispatches to the
        // real impl (otherwise the stub). The TUI host's <Terminal>
        // renderer needs the real impl to spawn shells + read cell
        // grids.
        tui_options.addOption(bool, "has_terminal", has_terminal);

        const tui_mod = b.createModule(.{
            .root_source_file = b.path("v8_tui_app.zig"),
            .target = target,
            .optimize = optimize,
        });
        tui_mod.addImport("v8", v8_mod);
        tui_mod.addImport("tls", tls_mod);
        tui_mod.addOptions("build_options", tui_options);
        tui_mod.addCSourceFile(.{
            .file = b.path("framework/ffi/v8_stack_shim.cpp"),
            .flags = &.{ "-O2", "-std=c++17" },
        });
        // worker_bindings.zig + transitive SDKs need:
        //   - std.http.Client (replaced libcurl in net/http.zig)
        //   - llama_headers (local_ai_runtime @cImport; libllama itself
        //     is dlopen'd at runtime, no link cost)
        //   - framework/ffi for compute_shim / common shims
        tui_mod.addIncludePath(b.path("framework/ffi/llama_headers"));
        tui_mod.addIncludePath(b.path("framework/ffi"));

        const tui_exe = b.addExecutable(.{
            .name = app_name,
            .root_module = tui_mod,
        });
        tui_exe.stack_size = 64 * 1024 * 1024;
        tui_exe.linkLibC();
        tui_exe.linkLibCpp();
        if (has_terminal) tui_exe.linkSystemLibrary("vterm");

        const tui_step = b.step("tui-app", "Build a self-contained TUI cart binary (zig-out/bin/<app-name>)");
        tui_step.dependOn(&b.addInstallArtifact(tui_exe, .{}).step);
    }

    // ── luajit_runtime bridge library for the Zig integration test ───
    const bridge_mod = b.createModule(.{
        .root_source_file = b.path("framework/luajit_runtime_bridge.zig"),
        .target = target,
        .optimize = optimize,
    });
    bridge_mod.addOptions("build_options", options);
    bridge_mod.addImport("wgpu", wgpu_mod);
    bridge_mod.addImport("tls", tls_mod);
    bridge_mod.addImport("zluajit", zluajit_dep.module("zluajit"));

    bridge_mod.addIncludePath(b.path("."));
    bridge_mod.addIncludePath(b.path("framework/ffi"));

    // QuickJS C sources no longer compiled into bridge_mod — same reason
    // as the main exe (qjs_runtime archived to archive/qjs-stack/).
    bridge_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_write_impl.c"), .flags = &.{"-O2"} });
    bridge_mod.addCSourceFile(.{ .file = b.path("framework/ffi/compute_shim.c"), .flags = &.{"-O2"} });
    if (has_physics) {
        bridge_mod.addCSourceFile(.{ .file = b.path("framework/ffi/physics_shim.cpp"), .flags = &.{"-O2"} });
    }

    if (os_tag == .linux) {
        if (sysroot) |sr| {
            bridge_mod.addIncludePath(.{ .cwd_relative = b.fmt("{s}/usr/include/luajit-2.1", .{sr}) });
            bridge_mod.addIncludePath(.{ .cwd_relative = b.fmt("{s}/usr/include/freetype2", .{sr}) });
            bridge_mod.addIncludePath(.{ .cwd_relative = b.fmt("{s}/usr/include", .{sr}) });
            bridge_mod.addLibraryPath(.{ .cwd_relative = b.fmt("{s}/usr/lib", .{sr}) });
        } else {
            bridge_mod.addIncludePath(.{ .cwd_relative = "/usr/include/luajit-2.1" });
            bridge_mod.addIncludePath(.{ .cwd_relative = "/usr/include/freetype2" });
            bridge_mod.addIncludePath(.{ .cwd_relative = "/usr/include/x86_64-linux-gnu" });
        }
    } else if (os_tag == .macos) {
        bridge_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include/luajit-2.1" });
        bridge_mod.addLibraryPath(.{ .cwd_relative = "/opt/homebrew/lib" });
        bridge_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include" });
        bridge_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include/freetype2" });
        bridge_mod.addLibraryPath(.{ .cwd_relative = "/opt/homebrew/opt/libarchive/lib" });
        bridge_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/opt/libarchive/include" });
        bridge_mod.addCSourceFile(.{ .file = b.path("framework/ffi/applescript_shim.m"), .flags = &.{"-O2"} });
    }

    if (os_tag == .linux) {
        if (sysroot) |sr| {
            bridge_mod.addIncludePath(.{ .cwd_relative = b.fmt("{s}/usr/include", .{sr}) });
        } else {
            bridge_mod.addIncludePath(.{ .cwd_relative = "/usr/include/x86_64-linux-gnu" });
        }
    } else if (os_tag == .macos) {
        bridge_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include" });
    }

    const luajit_runtime_bridge = b.addLibrary(.{
        .name = "luajit-runtime-bridge",
        .linkage = .static,
        .root_module = bridge_mod,
    });

    // ── Zig-side integration test ───────────────────────────────
    const test_mod = b.createModule(.{
        .root_source_file = b.path("framework/luajit_runtime_test.zig"),
        .target = target,
        .optimize = optimize,
    });
    const luajit_runtime_test = b.addTest(.{
        .name = "luajit-runtime-test",
        .root_module = test_mod,
    });
    luajit_runtime_test.linkLibrary(luajit_runtime_bridge);
    luajit_runtime_test.linkLibC();
    luajit_runtime_test.linkSystemLibrary("SDL3");
    luajit_runtime_test.linkSystemLibrary("freetype");
    luajit_runtime_test.linkSystemLibrary("luajit-5.1");
    if (os_tag == .linux) {
        luajit_runtime_test.linkSystemLibrary("X11");
        luajit_runtime_test.linkSystemLibrary("m");
        luajit_runtime_test.linkSystemLibrary("pthread");
        luajit_runtime_test.linkSystemLibrary("dl");
    } else if (os_tag == .macos) {
        luajit_runtime_test.linkFramework("Foundation");
        luajit_runtime_test.linkFramework("QuartzCore");
        luajit_runtime_test.linkFramework("Metal");
        luajit_runtime_test.linkFramework("Cocoa");
        luajit_runtime_test.linkFramework("IOKit");
        luajit_runtime_test.linkFramework("CoreVideo");
    }
    if (has_physics) luajit_runtime_test.linkSystemLibrary("box2d");
    if (has_sqlite) luajit_runtime_test.linkSystemLibrary("sqlite3");
    if (has_terminal) luajit_runtime_test.linkSystemLibrary("vterm");
    luajit_runtime_test.linkLibCpp();

    const run_luajit_runtime_test = b.addRunArtifact(luajit_runtime_test);
    const luajit_runtime_test_step = b.step("test-luajit-runtime", "Run the LuaJIT runtime integration test");
    luajit_runtime_test_step.dependOn(&run_luajit_runtime_test.step);
}
