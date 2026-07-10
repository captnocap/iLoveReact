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
    const dev_build_id = b.option([]const u8, "dev-build-id", "Content fingerprint of native inputs embedded in dev-mode hosts") orelse "unknown";
    const dev_socket_path = b.option([]const u8, "dev-socket-path", "Unix socket path for dev-mode bundle pushes") orelse "/tmp/reactjit.sock";
    const dev_bundle_path = b.option([]const u8, "dev-bundle-path", "Bundle path polled by dev-mode hot reload") orelse "bundle.js";
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
    // macOS links wgpu dynamically. Zig 0.15.2's self-hosted MachO linker
    // panics ("unexpected pointer encoding") while parsing the 387 __eh_frame
    // sections in the Rust-built libwgpu_native.a; the prebuilt .dylib sidesteps
    // that entirely (a dylib's eh_frame isn't parsed into __unwind_info at link
    // time). Linux keeps the static archive (LLD/ELF handles it fine).
    const wgpu_link_mode: std.builtin.LinkMode =
        if (target.result.os.tag == .macos) .dynamic else .static;
    const wgpu_dep = b.dependency("wgpu_native_zig", .{
        .target = target,
        .optimize = optimize,
        .link_mode = wgpu_link_mode,
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
    // — Linux distros only ship libluajit-5.1.so, so the link fails there.
    //
    // macOS is the exception: Homebrew DOES provide /opt/homebrew/lib/
    // libluajit.dylib, and we MUST use it. The source build emits a static
    // liblua.a whose hand-written arm64 VM assembly carries __eh_frame pointer
    // encodings that Zig 0.15.2's self-hosted MachO linker can't parse (it
    // panics "unexpected pointer encoding"). Linking the system dylib skips the
    // static archive entirely. brew luajit headers live at the include path the
    // macOS branch below already adds.
    const zluajit_system = target.result.os.tag == .macos;
    const zluajit_dep = b.dependency("zluajit", .{
        .target = target,
        .optimize = optimize,
        .system = zluajit_system,
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
    options.addOption([]const u8, "dev_build_id", dev_build_id);
    options.addOption([]const u8, "dev_socket_path", dev_socket_path);
    options.addOption([]const u8, "dev_bundle_path", dev_bundle_path);
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

    // sqlite — the authoring eventbus spine (framework/events/editor_bus.zig)
    // imports "sqlite" as a NAMED module so it can be built in isolation for its
    // unit test (see editor_bus_mod_t below). The host build reaches editor_bus.zig
    // via relative import (v8_ingredients → v8_bindings_editor_bus → editor_bus),
    // so it compiles into root_mod — which means the "sqlite" name must be
    // registered here too, or the graph fails with "no module named 'sqlite'
    // available within module 'root'". sqlite.zig dlopens libsqlite3 (no link dep).
    const editor_sqlite_root_mod = b.createModule(.{
        .root_source_file = b.path("framework/storage/sqlite.zig"),
        .target = target,
        .optimize = optimize,
    });
    root_mod.addImport("sqlite", editor_sqlite_root_mod);

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
        // Real per-frame V8 GC wall-time via the isolate's prologue/epilogue
        // callbacks — feeds the spikewatch's definitive "what fired" attribution
        // (see framework/ffi/v8_gc_shim.cpp). Same mangled-symbol approach as the
        // stack shim; the prebuilt libc_v8.a doesn't expose the binding.
        root_mod.addCSourceFile(.{
            .file = b.path("framework/ffi/v8_gc_shim.cpp"),
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
            // wgpu is dynamic on macOS (see wgpu_link_mode): the dep doesn't
            // addObjectFile the .a in dynamic mode, it exposes the prebuilt
            // dylib through its named write-files "lib" (the real .dylib lives
            // in wgpu-native's nested binary-release package, not in this repo's
            // deps/wgpu_native_zig/lib). Link it from there, install it into
            // zig-out/lib next to the binary, and rpath @loader_path/../lib so
            // the @rpath/libwgpu_native.dylib install_name resolves at runtime.
            const wgpu_lib_dir = wgpu_dep.namedWriteFiles("lib").getDirectory();
            exe.addLibraryPath(wgpu_lib_dir);
            root_mod.linkSystemLibrary("wgpu_native", .{ .preferred_link_mode = .dynamic });
            const wgpu_dylib_install = b.addInstallLibFile(wgpu_lib_dir.path(b, "libwgpu_native.dylib"), "libwgpu_native.dylib");
            exe.step.dependOn(&wgpu_dylib_install.step);
            exe.addRPath(.{ .cwd_relative = "@loader_path/../lib" });
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
    // opts into <Window> may use <Image> inside it. ALSO linked for
    // has_imageops: the @reactjit/image door (codec.zig) is a headless
    // decode/resize/encode service that needs the same stb symbols.
    // Declaration hoisted here next to its link gate (addOption + manifest
    // live with the other ingredient flags below).
    const has_imageops = b.option(bool, "has-imageops", "Register __imageops_* bindings (@reactjit/image: Sharp-style decode/resize/encode PNG/JPEG/WebP via stb + dlopen'd libwebp)") orelse false;
    if (has_gpu_cli or has_window or has_imageops) {
        root_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_impl.c"), .flags = &.{"-O2"} });
        root_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_write_impl.c"), .flags = &.{"-O2"} });
    }
    // stb_image_resize2 — only the @reactjit/image door uses it; gate tight.
    if (has_imageops) {
        root_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_resize_impl.c"), .flags = &.{"-O2"} });
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
    // Linux-only: the only supported onnxruntime payload is the prebuilt
    // libonnxruntime.so (deps/onnxruntime/lib). No macOS prebuilt exists, so
    // the fat dev host gates it off on macOS rather than fail the link.
    const has_onnx = (b.option(bool, "has-onnx", "Link onnxruntime + register __onnx_* / __segment_* bindings") orelse false) and os_tag == .linux;
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
    // Linux-only: links the prebuilt libllama_ffi.so (zig-out/lib or tsz/zig-out/lib).
    // No macOS build of that .so exists, so the fat dev host gates it off on macOS.
    const has_embed = (b.option(bool, "has-embed", "Register __embed_* bindings (llama.cpp + pgvector store; implies has-pg)") orelse false) and os_tag == .linux;
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
    // Linux-only: the bundled libsodium payloads are Linux .so builds; no macOS
    // prebuilt is vendored, so the fat dev host gates privacy off on macOS.
    const has_privacy = (b.option(bool, "has-privacy", "Link libsodium + privacy bindings") orelse false) and os_tag == .linux;
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
                "dummy.c",       "am_map.c",   "doomdef.c",    "doomstat.c",
                "dstrings.c",    "d_event.c",  "d_items.c",    "d_iwad.c",
                "d_loop.c",      "d_main.c",   "d_mode.c",     "d_net.c",
                "f_finale.c",    "f_wipe.c",   "g_game.c",     "hu_lib.c",
                "hu_stuff.c",    "info.c",     "i_cdmus.c",    "i_endoom.c",
                "i_joystick.c",  "i_scale.c",  "i_sound.c",    "i_system.c",
                "i_timer.c",     "memio.c",    "m_argv.c",     "m_bbox.c",
                "m_cheat.c",     "m_config.c", "m_controls.c", "m_fixed.c",
                "m_menu.c",      "m_misc.c",   "m_random.c",   "p_ceilng.c",
                "p_doors.c",     "p_enemy.c",  "p_floor.c",    "p_inter.c",
                "p_lights.c",    "p_map.c",    "p_maputl.c",   "p_mobj.c",
                "p_plats.c",     "p_pspr.c",   "p_saveg.c",    "p_setup.c",
                "p_sight.c",     "p_spec.c",   "p_switch.c",   "p_telept.c",
                "p_tick.c",      "p_user.c",   "r_bsp.c",      "r_data.c",
                "r_draw.c",      "r_main.c",   "r_plane.c",    "r_segs.c",
                "r_sky.c",       "r_things.c", "sha1.c",       "sounds.c",
                "statdump.c",    "st_lib.c",   "st_stuff.c",   "s_sound.c",
                "tables.c",      "v_video.c",  "wi_stuff.c",   "w_checksum.c",
                "w_file.c",      "w_main.c",   "w_wad.c",      "z_zone.c",
                "w_file_stdc.c", "i_input.c",  "i_video.c",    "doomgeneric.c",
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
    const has_sqlite = b.option(bool, "has-sqlite", "Register __sql_* bindings (storage/sqlite.zig dlopens libsqlite3 — no link-time dep)") orelse false;
    const has_zigcall = b.option(bool, "has-zigcall", "Register __zig_call/__zig_call_list bindings") orelse false;
    const has_sdk = b.option(bool, "has-sdk", "Register __http_request_*/__fetch/__claude_*/__kimi_*/__localai_*/__browser_*/__ipc_*/__play_*/__rec_* bindings") orelse false;
    const has_voice = b.option(bool, "has-voice", "Register __voice_* bindings (mic + WebRTC VAD)") orelse false;
    const has_audio_input = b.option(bool, "has-audio-input", "Register __rawCapture_* bindings (raw mic capture for music sampling)") orelse false;
    const has_paintable = b.option(bool, "has-paintable", "Register __paintable_* bindings (persistent GPU mask textures)") orelse false;
    const has_physics_lab = b.option(bool, "has-physics-lab", "Register __physics_lab_* bindings (host-side demo physics)") orelse false;
    const has_game_physics = b.option(bool, "has-game-physics", "Register __hmsc_*/__game_physics_* bindings (framework/game: the game's host-side physics + movement)") orelse false;
    const has_game_pathing = b.option(bool, "has-game-pathing", "Register __path_*/__game_pathing_* bindings (framework/game: grid A* + lane discipline + motion plans)") orelse false;
    const has_game_camera = b.option(bool, "has-game-camera", "Register __game_camera_* bindings (framework/game: native per-frame camera controller)") orelse false;
    const has_game_build = b.option(bool, "has-game-build", "Register __game_build_* bindings (framework/game: host-owned build placement — raycast/validate/catalog)") orelse false;
    const has_game_map = b.option(bool, "has-game-map", "Register __map_* bindings (framework/game/map: the map painter's chunk grid + brush stamps + stroke engine)") orelse false;
    const has_compiled_world = b.option(bool, "has-compiled-world", "Register WorldLoader host primitive + __compiled_world_* status bindings") orelse false;
    const has_capture = b.option(bool, "has-capture", "Register __capture_frame binding (SELFSHOT-0606: the app screenshots its OWN rendered frame; desktop capture of the user's system is banned)") orelse false;
    // has_imageops hoisted earlier (next to its stb link block).
    // has_whisper, has_pg, has_embed, has_doom hoisted earlier (next to their compile/link blocks).
    options.addOption(bool, "has_process", has_process);
    options.addOption(bool, "has_httpsrv", has_httpsrv);
    options.addOption(bool, "has_wssrv", has_wssrv);
    options.addOption(bool, "has_net", has_net);
    options.addOption(bool, "has_tor", has_tor);
    options.addOption(bool, "has_fs", has_fs);
    options.addOption(bool, "has_websocket", has_websocket);
    options.addOption(bool, "has_telemetry", has_telemetry);
    options.addOption(bool, "has_sqlite", has_sqlite);
    options.addOption(bool, "has_zigcall", has_zigcall);
    options.addOption(bool, "has_sdk", has_sdk);
    options.addOption(bool, "has_voice", has_voice);
    options.addOption(bool, "has_audio_input", has_audio_input);
    options.addOption(bool, "has_paintable", has_paintable);
    options.addOption(bool, "has_physics_lab", has_physics_lab);
    options.addOption(bool, "has_game_physics", has_game_physics);
    options.addOption(bool, "has_game_pathing", has_game_pathing);
    options.addOption(bool, "has_game_camera", has_game_camera);
    options.addOption(bool, "has_game_build", has_game_build);
    options.addOption(bool, "has_game_map", has_game_map);
    options.addOption(bool, "has_compiled_world", has_compiled_world);
    options.addOption(bool, "has_capture", has_capture);
    options.addOption(bool, "has_imageops", has_imageops);
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
    _ = manifest_wf.add("v8-ingredients/sqlite.flag", if (has_sqlite) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/zigcall.flag", if (has_zigcall) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/sdk.flag", if (has_sdk) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/voice.flag", if (has_voice) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/audio_input.flag", if (has_audio_input) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/paintable.flag", if (has_paintable) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/physics_lab.flag", if (has_physics_lab) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/game_physics.flag", if (has_game_physics) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/game_pathing.flag", if (has_game_pathing) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/pathing.flag", if (has_game_pathing) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/game_camera.flag", if (has_game_camera) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/game_build.flag", if (has_game_build) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/game_map.flag", if (has_game_map) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/compiled_world.flag", if (has_compiled_world) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/capture.flag", if (has_capture) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/imageops.flag", if (has_imageops) "1\n" else "0\n");
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
        // Pin ReleaseFast like v8cli: a Debug-optimized V8 binary trips the Zig
        // 0.15 / lld CREL `.init_array` bug (NULL function pointers → crash at
        // PC 0 on launch, before main runs). See the v8cli block below for the
        // full story. This makes the smoke/GC-probe target runnable by default.
        .optimize = .ReleaseFast,
    });
    v8_hello_mod.addImport("v8", v8_mod);
    // v8_hello compiles v8_runtime.zig, which calls setStackLimit and the
    // GC-timing shim — link both so the smoke target resolves their symbols.
    v8_hello_mod.addCSourceFile(.{
        .file = b.path("framework/ffi/v8_stack_shim.cpp"),
        .flags = &.{ "-O2", "-std=c++17" },
    });
    v8_hello_mod.addCSourceFile(.{
        .file = b.path("framework/ffi/v8_gc_shim.cpp"),
        .flags = &.{ "-O2", "-std=c++17" },
    });

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
    // v8_cli compiles v8_runtime.zig too, which references the GC-timing shim
    // symbols — link the same shim here so v8cli resolves them.
    v8_cli_mod.addCSourceFile(.{
        .file = b.path("framework/ffi/v8_gc_shim.cpp"),
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

    // ── hmsc parity compiler (req_2125) ─────────────────────────
    // Pure Zig writer for the platform game-file parity benchmark. No V8, no
    // SDL, no app substrate: it reads a deterministic source spec and emits the
    // same RJMP/gamefile bytes as the TS workspace writer.
    const world_gamefile_writer_mod = b.createModule(.{
        .root_source_file = b.path("framework/world/gamefile_writer.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const hmsc_parity_mod = b.createModule(.{
        .root_source_file = b.path("framework/tools/hmsc_parity_compile.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    hmsc_parity_mod.addImport("world_gamefile_writer", world_gamefile_writer_mod);
    const hmsc_parity_exe = b.addExecutable(.{
        .name = "hmsc_parity_compile",
        .root_module = hmsc_parity_mod,
    });
    hmsc_parity_exe.linkLibC();
    const hmsc_parity_step = b.step("hmsc-parity-compiler", "Build the hmsc Zig game-file parity compiler");
    hmsc_parity_step.dependOn(&b.addInstallArtifact(hmsc_parity_exe, .{}).step);

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

    // ── slider math unit tests (SLIDER-0611 / MEDIASLIDER-0705) ─────
    const slider_math_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/slider_math.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    slider_math_test_mod.addImport("slider_math", b.createModule(.{
        .root_source_file = b.path("framework/primitive/slider_math.zig"),
        .target = target,
        .optimize = optimize,
    }));
    const slider_math_test = b.addTest(.{
        .name = "slider-math-test",
        .root_module = slider_math_test_mod,
    });
    const run_slider_math_test = b.addRunArtifact(slider_math_test);
    const slider_math_test_step = b.step("test-slider-math", "Run the slider math unit tests");
    slider_math_test_step.dependOn(&run_slider_math_test.step);

    // ── system memory telemetry unit tests ──────────────────────────
    const system_memory_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/system_memory.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    system_memory_test_mod.addImport("system_memory", b.createModule(.{
        .root_source_file = b.path("framework/diag/system_memory.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    }));
    const system_memory_test = b.addTest(.{
        .name = "system-memory-test",
        .root_module = system_memory_test_mod,
    });
    const run_system_memory_test = b.addRunArtifact(system_memory_test);
    const system_memory_test_step = b.step("test-system-memory", "Run the system memory telemetry unit tests");
    system_memory_test_step.dependOn(&run_system_memory_test.step);

    // ── pose worker mailbox tests (req_2845) ─────────────────────────
    // Pins the live-inference boundary: camera bytes are copied before the
    // render thread mutates them, only one frame may occupy the pipeline, and
    // shutdown/result backpressure never grows a latent frame queue.
    const pose_mailbox_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/ml/pose_mailbox.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const pose_mailbox_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/pose_mailbox.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    pose_mailbox_test_mod.addImport("pose_mailbox", pose_mailbox_mod_for_tests);
    const pose_mailbox_test = b.addTest(.{
        .name = "pose-mailbox-test",
        .root_module = pose_mailbox_test_mod,
    });
    const run_pose_mailbox_test = b.addRunArtifact(pose_mailbox_test);
    const pose_mailbox_test_step = b.step("test-pose-mailbox", "Run live pose worker mailbox tests");
    pose_mailbox_test_step.dependOn(&run_pose_mailbox_test.step);

    // V4L2 camera discovery (req_2846): querycap filtering must never expose
    // a camera's metadata companion as if it were a usable image source.
    if (os_tag == .linux) {
        const video_devices_mod_for_tests = b.createModule(.{
            .root_source_file = b.path("framework/render/video_devices.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        const video_devices_test_mod = b.createModule(.{
            .root_source_file = b.path("framework/testing/unit/video_devices.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        video_devices_test_mod.addImport("video_devices", video_devices_mod_for_tests);
        const video_devices_test = b.addTest(.{
            .name = "video-devices-test",
            .root_module = video_devices_test_mod,
        });
        const run_video_devices_test = b.addRunArtifact(video_devices_test);
        const video_devices_test_step = b.step("test-video-devices", "Run V4L2 camera discovery tests");
        video_devices_test_step.dependOn(&run_video_devices_test.step);
    }

    // ONNX-backed worker integration: explicit (not part of lean test steps),
    // because it links the vendored runtime and optionally loads the user's
    // MoveNet model. A missing model is a valid surfaced worker result.
    if (os_tag == .linux) {
        const pose_mod_for_tests = b.createModule(.{
            .root_source_file = b.path("framework/ml/pose.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        pose_mod_for_tests.addIncludePath(b.path("deps/onnxruntime/include"));
        pose_mod_for_tests.addIncludePath(b.path("."));
        const pose_async_test_mod = b.createModule(.{
            .root_source_file = b.path("framework/testing/unit/pose_async.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        pose_async_test_mod.addImport("pose", pose_mod_for_tests);
        const pose_async_test = b.addTest(.{
            .name = "pose-async-test",
            .root_module = pose_async_test_mod,
        });
        pose_async_test.addLibraryPath(b.path("deps/onnxruntime/lib"));
        pose_async_test.linkSystemLibrary("onnxruntime");
        pose_async_test.addRPath(b.path("deps/onnxruntime/lib"));
        const run_pose_async_test = b.addRunArtifact(pose_async_test);
        run_pose_async_test.setEnvironmentVariable("LD_LIBRARY_PATH", b.pathFromRoot("deps/onnxruntime/lib"));
        const pose_async_test_step = b.step("test-pose-async", "Run ONNX-backed live pose worker integration test");
        pose_async_test_step.dependOn(&run_pose_async_test.step);
    }

    // ── mesh import (GLB/OBJ) unit tests — headless, no GPU ────────────────────
    const mesh_import_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/world/mesh_import.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const mesh_import_test = b.addTest(.{
        .name = "mesh-import-test",
        .root_module = mesh_import_test_mod,
    });
    const run_mesh_import_test = b.addRunArtifact(mesh_import_test);
    const mesh_import_test_step = b.step("test-mesh-import", "Run the GLB/OBJ mesh import unit tests");
    mesh_import_test_step.dependOn(&run_mesh_import_test.step);

    // ── model paint (raycast + per-face atlas) unit tests — headless, no GPU ───
    const model_paint_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/model_paint.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const model_paint_test = b.addTest(.{
        .name = "model-paint-test",
        .root_module = model_paint_test_mod,
    });
    const run_model_paint_test = b.addRunArtifact(model_paint_test);
    const model_paint_test_step = b.step("test-model-paint", "Run the model-paint raycast/atlas unit tests");
    model_paint_test_step.dependOn(&run_model_paint_test.step);

    // ── model-stage scale cue unit tests — headless, no GPU ───────────────────
    // Pins the ruled metre contract consumed by the native modeling-stage overlay:
    // coarse tile, collider, visual head top, and ruler tick cadence.
    const stage_scale_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/stage_scale.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    stage_scale_test_mod.addImport("stage_scale", b.createModule(.{
        .root_source_file = b.path("framework/gpu/stage_scale.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    }));
    const stage_scale_test = b.addTest(.{
        .name = "stage-scale-test",
        .root_module = stage_scale_test_mod,
    });
    const run_stage_scale_test = b.addRunArtifact(stage_scale_test);
    const stage_scale_test_step = b.step("test-stage-scale", "Run the model-stage scale cue unit tests");
    stage_scale_test_step.dependOn(&run_stage_scale_test.step);

    // ── mesh edit (welded topology + vertex/edge/face selection) unit tests ───
    const mesh_edit_impl_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_edit.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const mesh_edit_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/mesh_edit.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_edit_test_mod.addImport("mesh_edit", mesh_edit_impl_test_mod);
    const mesh_edit_test = b.addTest(.{
        .name = "mesh-edit-test",
        .root_module = mesh_edit_test_mod,
    });
    const run_mesh_edit_test = b.addRunArtifact(mesh_edit_test);
    const mesh_edit_test_step = b.step("test-mesh-edit", "Run the mesh-edit welding/selection unit tests");
    mesh_edit_test_step.dependOn(&run_mesh_edit_test.step);

    // ── GPU attribution unit tests ──────────────────────────────
    // Exercises native text/capture attribution producers without going
    // through the TS bridge: atlas-miss rollover, text trace summaries,
    // and StaticSurface capture trace formatting.
    const gpu_attribution_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing_gpu_attribution.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    gpu_attribution_test_mod.addImport("wgpu", wgpu_mod);
    gpu_attribution_test_mod.addIncludePath(b.path("."));
    gpu_attribution_test_mod.addIncludePath(b.path("framework/ffi"));
    if (target.result.os.tag == .linux) {
        if (sysroot) |sr| {
            gpu_attribution_test_mod.addIncludePath(.{ .cwd_relative = b.fmt("{s}/usr/include/freetype2", .{sr}) });
            gpu_attribution_test_mod.addIncludePath(.{ .cwd_relative = b.fmt("{s}/usr/include", .{sr}) });
        } else {
            gpu_attribution_test_mod.addIncludePath(.{ .cwd_relative = "/usr/include/freetype2" });
            gpu_attribution_test_mod.addIncludePath(.{ .cwd_relative = "/usr/include/x86_64-linux-gnu" });
        }
    } else if (target.result.os.tag == .macos) {
        gpu_attribution_test_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include/freetype2" });
    }
    const gpu_attribution_test = b.addTest(.{
        .name = "gpu-attribution-test",
        .root_module = gpu_attribution_test_mod,
    });
    gpu_attribution_test.linkSystemLibrary("freetype");
    const run_gpu_attribution_test = b.addRunArtifact(gpu_attribution_test);
    const gpu_attribution_test_step = b.step("test-gpu-attribution", "Run GPU attribution unit tests");
    gpu_attribution_test_step.dependOn(&run_gpu_attribution_test.step);

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

    // ── Map painter engine tests (req_2473) ────────────────────────
    // Exercises framework/game/map/ (chunks + stamps + engine, tests inline
    // in the modules): seam-free cross-chunk strokes, brush/ramp/slope/smooth
    // stamps, water basins, cell channels, per-stroke dedup. Pure-math module —
    // no SDL/V8 link; the cart binary gets it only through the gated
    // v8_bindings_game_map.zig ingredient.
    const game_map_test_mod = b.createModule(.{
        // Keep the test module rooted at framework/: the map engine's flora
        // boundary deliberately imports the sibling world/ recipe vocabulary.
        .root_source_file = b.path("framework/testing_game_map.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const game_map_test = b.addTest(.{
        .name = "game-map-test",
        .root_module = game_map_test_mod,
    });
    const run_game_map_test = b.addRunArtifact(game_map_test);
    const game_map_test_step = b.step("test-game-map", "Run the map painter engine tests");
    game_map_test_step.dependOn(&run_game_map_test.step);

    // ── Painted flora recipe + shared wrapped geometry (req_2875/2877) ─────
    // Pins the append-only recipe ids, deterministic transforms, 360-degree
    // wrapped meshes, and shader UV bands at the Zig layer that owns them.
    const flora_geometry_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/world/flora_geometry.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const gpu_shaders_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/gpu/shaders.zig"),
        .target = target,
        .optimize = optimize,
    });
    const flora_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/flora.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    flora_test_mod.addImport("flora_geometry", flora_geometry_mod_t);
    flora_test_mod.addImport("gpu_shaders", gpu_shaders_mod_t);
    const flora_test = b.addTest(.{ .name = "world-flora-test", .root_module = flora_test_mod });
    const run_flora_test = b.addRunArtifact(flora_test);
    const flora_test_step = b.step("test-world-flora", "Run painted flora recipe and shared wrapped geometry tests");
    flora_test_step.dependOn(&run_flora_test.step);

    // ── Game camera behavior tests (V23, P4) ───────────────────────
    // Exercises framework/game/camera.zig: Orbit/Aim fidelity against
    // runtime/cameras reference vectors, retained host-side smoothing, and
    // walk<->aim interpolation. Pure-math module — no V8/SDL link; the cart
    // binary gets it only through the gated v8_bindings_game_camera.zig
    // ingredient.
    const game_camera_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/game/camera.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const game_camera_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/game_camera.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    game_camera_test_mod.addImport("game_camera", game_camera_mod_for_tests);
    const game_camera_test = b.addTest(.{
        .name = "game-camera-test",
        .root_module = game_camera_test_mod,
    });
    const run_game_camera_test = b.addRunArtifact(game_camera_test);
    const game_camera_test_step = b.step("test-game-camera", "Run the game camera behavior tests");
    game_camera_test_step.dependOn(&run_game_camera_test.step);

    // ── Platform mapfile behavior tests (PLATMOD slice 1, P4) ─────
    // Exercises framework/world/mapfile.zig: RJMP lump directory reads,
    // future-lump skip tolerance, and binary rle16 count/value decode.
    const world_mapfile_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/world/mapfile.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const world_mapfile_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/world_mapfile.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    world_mapfile_test_mod.addImport("world_mapfile", world_mapfile_mod_for_tests);
    const world_mapfile_test = b.addTest(.{
        .name = "world-mapfile-test",
        .root_module = world_mapfile_test_mod,
    });
    const run_world_mapfile_test = b.addRunArtifact(world_mapfile_test);
    // Pin cwd to the repo root so the cross-language round-trip test can read
    // framework/testing/fixtures/mapfile_roundtrip.b64 by relative path.
    run_world_mapfile_test.setCwd(b.path("."));
    const world_mapfile_test_step = b.step("test-world-mapfile", "Run the platform mapfile reader tests");
    world_mapfile_test_step.dependOn(&run_world_mapfile_test.step);

    // ── Editor-live cooked-door state tests (req_2895/req_2896) ─────
    // A resident Door Wall arrives as a live mesh reference before Compile. Its
    // runtime open/progress state must survive whole-ref generation rebuilds and
    // stay distinct across storeys/export meanings.
    const world_live_mesh_doors_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/world/live_mesh_doors.zig"),
        .target = target,
        .optimize = optimize,
    });
    const world_live_mesh_doors_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/world_live_mesh_doors.zig"),
        .target = target,
        .optimize = optimize,
    });
    world_live_mesh_doors_test_mod.addImport("world_live_mesh_doors", world_live_mesh_doors_mod_for_tests);
    const world_live_mesh_doors_test = b.addTest(.{
        .name = "world-live-mesh-doors-test",
        .root_module = world_live_mesh_doors_test_mod,
    });
    const run_world_live_mesh_doors_test = b.addRunArtifact(world_live_mesh_doors_test);
    const world_live_mesh_doors_test_step = b.step("test-world-live-mesh-doors", "Run editor-live cooked-door state tests");
    world_live_mesh_doors_test_step.dependOn(&run_world_live_mesh_doors_test.step);

    // ── Platform game-file behavior tests (PLATMOD spine step 2, P4) ──────
    // Exercises framework/world/gamefile.zig: the three-stream game-file reader,
    // sha256 content-store install (atomic temp->fsync->rename), and the
    // dependency gate (bad-hash + dangling-reference negative controls). The
    // TS writer (gamefile.ts) emits the fixture; this decodes the same tape.
    // gamefile.zig re-exports mapfile.zig (relative import), so the test reaches
    // the lump/RLE reader through gamefile.mapfile — one module graph, no
    // double-rooting of mapfile.zig.
    const world_gamefile_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/world/gamefile.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const world_gamefile_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/world_gamefile.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    world_gamefile_test_mod.addImport("world_gamefile", world_gamefile_mod_for_tests);
    const world_gamefile_test = b.addTest(.{
        .name = "world-gamefile-test",
        .root_module = world_gamefile_test_mod,
    });
    const run_world_gamefile_test = b.addRunArtifact(world_gamefile_test);
    // Pin cwd to the repo root so the round-trip test can read
    // framework/testing/fixtures/gamefile_roundtrip.b64 by relative path.
    run_world_gamefile_test.setCwd(b.path("."));
    const world_gamefile_test_step = b.step("test-world-gamefile", "Run the platform game-file reader + content store tests");
    world_gamefile_test_step.dependOn(&run_world_gamefile_test.step);

    // ── Platform game-file writer behavior tests (req_2125) ─────
    // Exercises the Zig writer added for TS/Zig compile parity. The writer emits
    // a real game-file and the existing reader ingests it, proving this is the
    // same platform wire format rather than a parallel test-only blob.
    const world_gamefile_writer_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/world_gamefile_writer.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    world_gamefile_writer_test_mod.addImport("world_gamefile_writer", world_gamefile_writer_mod);
    world_gamefile_writer_test_mod.addImport("world_gamefile", world_gamefile_mod_for_tests);
    const world_gamefile_writer_test = b.addTest(.{
        .name = "world-gamefile-writer-test",
        .root_module = world_gamefile_writer_test_mod,
    });
    const run_world_gamefile_writer_test = b.addRunArtifact(world_gamefile_writer_test);
    const world_gamefile_writer_test_step = b.step("test-world-gamefile-writer", "Run the platform game-file writer tests");
    world_gamefile_writer_test_step.dependOn(&run_world_gamefile_writer_test.step);

    // ── Editor foundation unit tests (req_2174/req_2190) ─────────────────
    // The dormant editor-foundation modules verified in isolation. Each builds its
    // own module graph; none are wired into a cart by these steps.
    const world_compile_cache_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/world/compile_cache.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const world_chunk_dirty_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/world/chunk_dirty.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    world_chunk_dirty_mod_t.addImport("world_compile_cache", world_compile_cache_mod_t);

    // diagnostics registry (workstream B)
    const diag_registry_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/diag/diag_registry.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const diag_registry_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/diag_registry.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    diag_registry_test_mod.addImport("diag_registry", diag_registry_mod_t);
    const diag_registry_test = b.addTest(.{ .name = "diag-registry-test", .root_module = diag_registry_test_mod });
    b.step("test-diag-registry", "Run the diagnostics registry unit tests")
        .dependOn(&b.addRunArtifact(diag_registry_test).step);

    // authoring eventbus spine (workstream A)
    const editor_sqlite_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/storage/sqlite.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const editor_bus_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/events/editor_bus.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    editor_bus_mod_t.addImport("sqlite", editor_sqlite_mod_t);
    const editor_bus_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/editor_bus.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    editor_bus_test_mod.addImport("editor_bus", editor_bus_mod_t);
    const editor_bus_test = b.addTest(.{ .name = "editor-bus-test", .root_module = editor_bus_test_mod });
    b.step("test-editor-bus", "Run the authoring eventbus unit tests")
        .dependOn(&b.addRunArtifact(editor_bus_test).step);

    // chunk compile cache scaffolding (workstream D)
    const compile_cache_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/compile_cache.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    compile_cache_test_mod.addImport("world_compile_cache", world_compile_cache_mod_t);
    compile_cache_test_mod.addImport("world_chunk_dirty", world_chunk_dirty_mod_t);
    const compile_cache_test = b.addTest(.{ .name = "compile-cache-test", .root_module = compile_cache_test_mod });
    b.step("test-world-compile-cache", "Run the chunk compile-cache scaffolding tests")
        .dependOn(&b.addRunArtifact(compile_cache_test).step);

    // hot authoring-state index (workstream E)
    const hot_index_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/editor/hot_index.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    hot_index_mod_t.addImport("world_chunk_dirty", world_chunk_dirty_mod_t);
    hot_index_mod_t.addImport("world_compile_cache", world_compile_cache_mod_t);
    const hot_index_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/hot_index.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    hot_index_test_mod.addImport("hot_index", hot_index_mod_t);
    hot_index_test_mod.addImport("world_chunk_dirty", world_chunk_dirty_mod_t);
    const hot_index_test = b.addTest(.{ .name = "hot-index-test", .root_module = hot_index_test_mod });
    b.step("test-hot-index", "Run the hot authoring-state index tests")
        .dependOn(&b.addRunArtifact(hot_index_test).step);

    // skeleton bones_loader validator (workstream H slice 1)
    const bones_loader_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/skeleton/bones_loader.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const bones_loader_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/bones_loader.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    bones_loader_test_mod.addImport("bones_loader", bones_loader_mod_t);
    const bones_loader_test = b.addTest(.{ .name = "bones-loader-test", .root_module = bones_loader_test_mod });
    b.step("test-bones-loader", "Run the skeleton validator unit tests")
        .dependOn(&b.addRunArtifact(bones_loader_test).step);

    // ── Key-packing behavior tests (GAME_INPUT hazard close, P4) ──────
    // Exercises framework/key_pack.zig — the one (mod << 32 | sym) key
    // packing engine.zig produces and ifttt.zig + useIFTTT.ts decode.
    // Pins arrows/extended keys distinct from printables (the old 16-bit
    // packing truncated LEFT into 'p'). Pure-math module — no SDL/V8 link.
    const key_pack_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/key_pack.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const key_pack_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/key_pack.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    key_pack_test_mod.addImport("key_pack", key_pack_mod_for_tests);
    const key_pack_test = b.addTest(.{
        .name = "key-pack-test",
        .root_module = key_pack_test_mod,
    });
    const run_key_pack_test = b.addRunArtifact(key_pack_test);
    const key_pack_test_step = b.step("test-key-pack", "Run the key packing behavior tests");
    key_pack_test_step.dependOn(&run_key_pack_test.step);

    // ── Localstore behavior tests (PAINTLOSS req_0695, P4) ──────
    // Exercises framework/storage/localstore.zig: large-value persistence
    // across a deinit/init "restart" (the old 8KB MAX_VALUE silently ate the
    // editor's custom-textures + game-state writes) and the loud oversized-
    // write error. Roots at framework/testing_localstore.zig so localstore's
    // relative imports (../fs/fs.zig, sqlite.zig — dlopen, no link dep)
    // stay inside the module path. Needs libc for the heap + dlopen.
    const localstore_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing_localstore.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const localstore_test = b.addTest(.{
        .name = "localstore-test",
        .root_module = localstore_test_mod,
    });
    const run_localstore_test = b.addRunArtifact(localstore_test);
    const localstore_test_step = b.step("test-localstore", "Run the localstore persistence behavior tests");
    localstore_test_step.dependOn(&run_localstore_test.step);
}
