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
    // -Dhas-gpu=false ships the app binary in headless (TUI) mode: no
    // SDL3/wgpu/freetype/X11 link, no engine.run call, framework/gpu/*
    // and framework/primitive/{windows,context_menu,input} resolve to
    // comptime stubs inside v8_app.zig. Default true preserves the GPU
    // shell behavior for every existing cart. Set false from
    // scripts/ship-tui (and eventually scripts/ship via metafile
    // detection) so one binary target covers both substrates.
    const has_gpu_cli = b.option(bool, "has-gpu", "Build v8_app with the GPU substrate (SDL3 + wgpu + engine.run). Set false for headless/TUI builds.") orelse true;
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
    const has_terminal = b.option(bool, "has-terminal", "Link libvterm + real vterm.zig (otherwise stub)") orelse false;
    const has_audio = b.option(bool, "has-audio", "Compile framework/audio.zig (SDL3 audio + LuaJIT DSP via zluajit module)") orelse false;
    const has_midi = b.option(bool, "has-midi", "Link libasound + real midi.zig (ALSA snd_seq_* MIDI input) — otherwise stub") orelse false;
    // -Dhas-window: cart imports <Window> (or <Notification>) from
    // @reactjit/runtime/primitives. For the GPU app (this target), the
    // window-rendering deps (SDL3, freetype, layout, text, windows.zig)
    // are foundational on the GPU shell (engine.run already pulls them).
    // On the headless shell (-Dhas-gpu=false), this flag is what brings
    // SDL3 + freetype + wgpu + the framework include paths in so an
    // otherwise-ANSI binary can paint a <Window> subtree alongside the
    // ANSI grid. See the `has_gpu_cli or has_window` link gates below.
    const has_window = b.option(bool, "has-window", "Cart uses <Window>/<Notification> (foundational on GPU shell; gates SDL3 + window-engine link on headless shell)") orelse false;

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
    // has_gpu — drives every comptime gate that distinguishes the GPU
    // shell from the headless shell. Default true preserves existing
    // cart behavior. When false: v8_ingredients stubs `core` + `window`
    // (the two SDL-coupled required bindings via engine.zig); v8_app's
    // main() takes the TUI eval body instead of engine.run; every
    // framework/gpu/* and framework/primitive/{windows,context_menu,
    // input} import in v8_app resolves to a stub so the SDL include
    // paths aren't reached at compile time; this exe block skips
    // linkSystemLibrary("SDL3"/wgpu/freetype/X11/asound). One binary
    // target covers both substrates.
    options.addOption(bool, "has_gpu", has_gpu_cli);
    options.addOption(bool, "dev_mode", dev_mode);
    options.addOption(bool, "custom_chrome", custom_chrome);
    options.addOption(bool, "has_physics", has_physics);
    options.addOption(bool, "has_terminal", has_terminal);
    options.addOption(bool, "has_audio", has_audio);
    options.addOption(bool, "has_midi", has_midi);
    options.addOption(bool, "has_window", has_window);
    options.addOption([]const u8, "bundle_path", bundle_path);
    // GPU-substrate features that were always-on for the GPU shell.
    // Headless builds must turn them off, otherwise the matching
    // framework/v8_bindings_X / framework/render/* modules get compiled
    // and pull in wgpu / SDL via @import("wgpu") or framework/c.zig.
    // Networking + crypto + debug_server are substrate-agnostic and
    // stay on either way.
    options.addOption(bool, "has_video", has_gpu_cli);
    options.addOption(bool, "has_render_surfaces", has_gpu_cli);
    options.addOption(bool, "has_effects", has_gpu_cli);
    options.addOption(bool, "has_canvas", has_gpu_cli);
    options.addOption(bool, "has_3d", has_gpu_cli);
    options.addOption(bool, "has_transitions", has_gpu_cli);
    options.addOption(bool, "has_networking", true);
    options.addOption(bool, "has_crypto", true);
    options.addOption(bool, "has_debug_server", true);
    options.addOption(bool, "use_v8", use_v8);

    const root_mod = b.createModule(.{
        .root_source_file = b.path(app_source),
        .target = target,
        .optimize = optimize,
    });
    root_mod.addOptions("build_options", options);
    // wgpu — GPU rasterization pipeline. Pulled in by every framework/gpu/*
    // and framework/render/* module. When has_gpu=false AND has_window=false,
    // v8_app.zig stubs all those imports and the named "wgpu" module is
    // unreachable; gating it here keeps the ~241MB static archive out
    // of the pure-headless binary's compile graph. has_window=true on a
    // headless build still needs wgpu because primitive/text.zig
    // (called from primitive/windows.zig for <Window> text metrics)
    // imports gpu/text.zig which @import("wgpu").
    if (has_gpu_cli or has_window) root_mod.addImport("wgpu", wgpu_mod);
    root_mod.addImport("tls", tls_mod);
    // zluajit is needed by framework/audio (DSP engine). framework/process/luajit_worker
    // dlopens libluajit-5.1 directly, so it doesn't need this import.
    if (has_audio) root_mod.addImport("zluajit", zluajit_dep.module("zluajit"));

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
    // SDL3 + freetype carry the GPU substrate (windowing, GPU paint,
    // text rasterization). Linked when either:
    //   - has_gpu_cli: full GPU shell (engine.run + SDL event pump)
    //   - has_window: TUI cart imports <Window>/<Notification>, needs
    //     SDL3 to paint a real window subtree alongside the ANSI grid
    // Pure-headless builds (has_gpu=false AND has_window=false) skip
    // ~12MB of DT_NEEDED entries and don't need the SDL3/freetype
    // headers at compile time.
    if (has_gpu_cli or has_window) {
        exe.linkSystemLibrary("SDL3");
        exe.linkSystemLibrary("freetype");
    }

    const os_tag = target.result.os.tag;
    if (os_tag == .linux) {
        // X11/m are GPU-substrate concerns (window manager hints + math
        // for SDL/wgpu). pthread + dl are universal: V8 isolates need
        // pthread; dlopen lives on dl for libllama/libluajit/etc.
        // luajit + freetype headers ride alongside SDL when GPU or
        // <Window>-on-TUI is on.
        if (has_gpu_cli or has_window) {
            exe.linkSystemLibrary("X11");
            exe.linkSystemLibrary("m");
        }
        exe.linkSystemLibrary("pthread");
        exe.linkSystemLibrary("dl");
        // libasound is required by framework/audio/midi.zig, which calls
        // ALSA's snd_seq_* API for MIDI sequencer input on Linux. SDL3's
        // audio backends are dlopen'd at runtime (so SDL3 doesn't pull
        // libasound into DT_NEEDED via the audio path), but audio/midi.zig
        // declares the snd_seq_* symbols via @extern, and those need
        // libasound at link time. The dispatcher in framework/audio/midi.zig
        // selects audio/midi.zig only when has_midi is on; without midi
        // doesn't reference any ALSA symbols, so non-MIDI carts skip
        // both the link and the ~600KB DT_NEEDED entry.
        if (has_midi) exe.linkSystemLibrary("asound");
        if (has_gpu_cli or has_window) {
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
        }
    } else if (os_tag == .macos) {
        // macOS GPU substrate — Cocoa + Metal + the homebrew include
        // tree. Headless builds without has_window skip the entire
        // Apple framework link surface; headless+has_window builds
        // still need it to paint <Window> subtrees via SDL3.
        if (has_gpu_cli or has_window) {
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
        }
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
    // stbi_write_png powers capture/witness screenshotting. Both are
    // GPU-substrate (no image decode/encode path in the ANSI walker),
    // so gate them on has_gpu_cli OR has_window — a headless cart that
    // opts into <Window> may use <Image> inside it.
    if (has_gpu_cli or has_window) {
        root_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_impl.c"), .flags = &.{"-O2"} });
        root_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_write_impl.c"), .flags = &.{"-O2"} });
    }

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

    // ── ONNX Runtime (has_onnx) ────────────────────────────────
    // Vendored prebuilt libonnxruntime.so + C API headers. Used by
    // framework/ml/ to run small inference models (currently MobileSAM
    // for image segmentation in cart/cutout). No build-from-source —
    // Microsoft's prebuilt is the supported path. See deps/onnxruntime/README.md.
    const has_onnx = b.option(bool, "has-onnx", "Link onnxruntime + register __onnx_* / __segment_* bindings") orelse false;
    if (has_onnx) {
        root_mod.addIncludePath(b.path("deps/onnxruntime/include"));
        root_mod.addLibraryPath(b.path("deps/onnxruntime/lib"));
        exe.linkSystemLibrary("onnxruntime");
        // $ORIGIN so the packaged binary finds libonnxruntime.so.1 sitting
        // next to it. scripts/ship's source-driven walker bundles the .so
        // when this feature is gated on via the dependency-registry.
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
    if (has_physics) {
        root_mod.addCSourceFile(.{ .file = b.path("framework/ffi/physics_shim.cpp"), .flags = &.{"-O2"} });
    }

    // ── System libraries ──────────────────────────────────────
    if (has_physics) exe.linkSystemLibrary("box2d");
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

    // ── doomgeneric (id Software Doom + ozkl porting shim) ────
    // Vendored at deps/doomgeneric/src (87 C files, ~30K LOC). Gated
    // behind -Dhas-doom because compiling 87 .c files isn't free — carts
    // that don't import useDoom shouldn't pay the build cost or carry the
    // engine in their binary. Our DG_* shim lives in framework/doom/doom.zig
    // (Zig exports overriding the otherwise-absent platform impls).
    //
    // The upstream Makefile compiles with -DNORMALUNIX -DLINUX -D_DEFAULT_SOURCE
    // and -w (silences the many "implicit declaration" warnings from the
    // 1990s codebase). Same flags here.
    const has_doom = b.option(bool, "has-doom", "Compile doomgeneric + register __doom_* bindings") orelse false;
    options.addOption(bool, "has_doom", has_doom);
    if (has_doom) {
        const doom_src = b.path("deps/doomgeneric/src");
        root_mod.addIncludePath(doom_src);
        root_mod.addCSourceFiles(.{
            .root = doom_src,
            .files = &.{
                "dummy.c",      "am_map.c",     "doomdef.c",    "doomstat.c",
                "dstrings.c",   "d_event.c",    "d_items.c",    "d_iwad.c",
                "d_loop.c",     "d_main.c",     "d_mode.c",     "d_net.c",
                "f_finale.c",   "f_wipe.c",     "g_game.c",     "hu_lib.c",
                "hu_stuff.c",   "info.c",       "i_cdmus.c",    "i_endoom.c",
                "i_joystick.c", "i_scale.c",    "i_sound.c",    "i_system.c",
                "i_timer.c",    "memio.c",      "m_argv.c",     "m_bbox.c",
                "m_cheat.c",    "m_config.c",   "m_controls.c", "m_fixed.c",
                "m_menu.c",     "m_misc.c",     "m_random.c",   "p_ceilng.c",
                "p_doors.c",    "p_enemy.c",    "p_floor.c",    "p_inter.c",
                "p_lights.c",   "p_map.c",      "p_maputl.c",   "p_mobj.c",
                "p_plats.c",    "p_pspr.c",     "p_saveg.c",    "p_setup.c",
                "p_sight.c",    "p_spec.c",     "p_switch.c",   "p_telept.c",
                "p_tick.c",     "p_user.c",     "r_bsp.c",      "r_data.c",
                "r_draw.c",     "r_main.c",     "r_plane.c",    "r_segs.c",
                "r_sky.c",      "r_things.c",   "sha1.c",       "sounds.c",
                "statdump.c",   "st_lib.c",     "st_stuff.c",   "s_sound.c",
                "tables.c",     "v_video.c",    "wi_stuff.c",   "w_checksum.c",
                "w_file.c",     "w_main.c",     "w_wad.c",      "z_zone.c",
                "w_file_stdc.c","i_input.c",    "i_video.c",    "doomgeneric.c",
            },
            .flags = &.{ "-O2", "-fPIC", "-w", "-DNORMALUNIX", "-DLINUX", "-D_DEFAULT_SOURCE" },
        });
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
    const has_fs = b.option(bool, "has-fs", "Register __fs_* bindings") orelse false;
    const has_websocket = b.option(bool, "has-websocket", "Register __ws_* (client) bindings") orelse false;
    const has_telemetry = b.option(bool, "has-telemetry", "Register __tel_*/getFps/... bindings") orelse false;
    const has_zigcall = b.option(bool, "has-zigcall", "Register __zig_call/__zig_call_list bindings") orelse false;
    const has_sdk = b.option(bool, "has-sdk", "Register __http_request_*/__fetch/__claude_*/__kimi_*/__localai_*/__browser_*/__ipc_*/__play_*/__rec_* bindings") orelse false;
    const has_voice = b.option(bool, "has-voice", "Register __voice_* bindings (mic + WebRTC VAD)") orelse false;
    const has_audio_input = b.option(bool, "has-audio-input", "Register __rawCapture_* bindings (raw mic capture for music sampling)") orelse false;
    const has_paintable = b.option(bool, "has-paintable", "Register __paintable_* bindings (persistent GPU mask textures)") orelse false;
    const has_physics_lab = b.option(bool, "has-physics-lab", "Register __physics_lab_* bindings (host-side demo physics)") orelse false;
    const has_game_physics = b.option(bool, "has-game-physics", "Register __hmsc_*/__game_physics_* bindings (framework/game: the game's host-side physics + movement)") orelse false;
    const has_pathing = b.option(bool, "has-pathing", "Register __path_* bindings (host-side tile-grid A* pathing)") orelse false;
    // has_whisper, has_pg, has_embed, has_doom hoisted earlier (next to their compile/link blocks).
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
    options.addOption(bool, "has_audio_input", has_audio_input);
    options.addOption(bool, "has_paintable", has_paintable);
    options.addOption(bool, "has_physics_lab", has_physics_lab);
    options.addOption(bool, "has_game_physics", has_game_physics);
    options.addOption(bool, "has_pathing", has_pathing);
    options.addOption(bool, "has_pg", has_pg or has_embed);
    options.addOption(bool, "has_embed", has_embed);
    options.addOption(bool, "has_whisper", has_whisper);
    options.addOption(bool, "has_onnx", has_onnx);

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
    _ = manifest_wf.add("v8-ingredients/audio_input.flag", if (has_audio_input) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/paintable.flag", if (has_paintable) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/physics_lab.flag", if (has_physics_lab) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/game_physics.flag", if (has_game_physics) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/pathing.flag", if (has_pathing) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/pg.flag", if (has_pg or has_embed) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/embed.flag", if (has_embed) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/whisper.flag", if (has_whisper) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/onnx.flag", if (has_onnx) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/audio.flag", if (has_audio) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/midi.flag", if (has_midi) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/vterm.flag", if (has_terminal) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/doom.flag", if (has_doom) "1\n" else "0\n");
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

    // ── tui-app: DELETED (C3) ────────────────────────────────────
    // The dedicated tui-app build target + v8_tui_app.zig entry point
    // were retired once v8_app.zig grew a runHeadless() branch behind
    // -Dhas-gpu=false (see C2). scripts/ship-tui now invokes
    //   zig build app -Dhas-gpu=false -Dapp-name=<n> ...
    // producing the same binary shape (~6MB pure-ANSI / ~176MB with
    // -Dhas-window=true for the embedded-<Window> case) the dedicated
    // target produced before. One entry point, two substrates, source-
    // driven gating via the INGREDIENTS catalog. See v8_app.zig's
    // HEADLESS const + runHeadless() fn for the actual dispatch.

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
    if (has_terminal) luajit_runtime_test.linkSystemLibrary("vterm");
    luajit_runtime_test.linkLibCpp();

    const run_luajit_runtime_test = b.addRunArtifact(luajit_runtime_test);
    const luajit_runtime_test_step = b.step("test-luajit-runtime", "Run the LuaJIT runtime integration test");
    luajit_runtime_test_step.dependOn(&run_luajit_runtime_test.step);

    // ── Layout unit tests ──────────────────────────────────────────
    // Exercises the flex resolver in framework/layout.zig with concrete
    // expected rects. Hook to verify behavior after layout refactors.
    // Test files import `@import("layout")` — module wired below.
    const layout_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/layout.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const layout_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/layout.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    layout_test_mod.addImport("layout", layout_mod_for_tests);
    const layout_test = b.addTest(.{
        .name = "layout-test",
        .root_module = layout_test_mod,
    });
    const run_layout_test = b.addRunArtifact(layout_test);
    const layout_test_step = b.step("test-layout", "Run the layout unit tests");
    layout_test_step.dependOn(&run_layout_test.step);

    const layout_wrap_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/layout_wrap.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    layout_wrap_test_mod.addImport("layout", layout_mod_for_tests);
    const layout_wrap_test = b.addTest(.{
        .name = "layout-wrap-test",
        .root_module = layout_wrap_test_mod,
    });
    const run_layout_wrap_test = b.addRunArtifact(layout_wrap_test);
    const layout_wrap_test_step = b.step("test-layout-wrap", "Run the layout wrap unit tests");
    layout_wrap_test_step.dependOn(&run_layout_wrap_test.step);

    // ── Game physics/movement behavior tests (WO-1, P4) ───────────
    // Exercises framework/game/physics.zig (+ movement.zig via its
    // re-export) with packed input buffers: jump arc, gravity, ground
    // collision, heightfield sampling, movement integration. Pure-math
    // module — no SDL/V8 link. This is a TEST artifact only; the cart
    // binary gets framework/game/ exclusively through the gated
    // v8_bindings_game_physics.zig ingredient (V18).
    const game_physics_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/game/physics.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const game_physics_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/game_physics.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    game_physics_test_mod.addImport("game_physics", game_physics_mod_for_tests);
    const game_physics_test = b.addTest(.{
        .name = "game-physics-test",
        .root_module = game_physics_test_mod,
    });
    const run_game_physics_test = b.addRunArtifact(game_physics_test);
    const game_physics_test_step = b.step("test-game-physics", "Run the game physics/movement behavior tests");
    game_physics_test_step.dependOn(&run_game_physics_test.step);

    // ── Game pathing behavior tests (V5 capture, P4) ───────────────
    // Exercises framework/game/pathing.zig: routes found/blocked/
    // deterministic, flow + lane discipline (trio snap, junction apexes),
    // closed-form motion plans. Pure-math module — no SDL/V8 link; the
    // cart binary gets framework/game/ only through the gated
    // v8_bindings_game_pathing.zig ingredient (V18).
    const game_pathing_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/game/pathing.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const game_pathing_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/game_pathing.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    game_pathing_test_mod.addImport("game_pathing", game_pathing_mod_for_tests);
    const game_pathing_test = b.addTest(.{
        .name = "game-pathing-test",
        .root_module = game_pathing_test_mod,
        // Zig 0.15.2's self-hosted x86_64 Debug backend miscompiles the A*
        // (emit MIR: no encoding for mov m32,m32). The app always builds
        // through LLVM (ReleaseFast); pin the test to LLVM too.
        .use_llvm = true,
    });
    const run_game_pathing_test = b.addRunArtifact(game_pathing_test);
    const game_pathing_test_step = b.step("test-game-pathing", "Run the game pathing behavior tests");
    game_pathing_test_step.dependOn(&run_game_pathing_test.step);
}
