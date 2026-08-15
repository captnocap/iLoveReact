//! Root build.zig — builds framework/v8_app.zig into zig-out/bin/<name>.
//!
//! Usage:
//!   zig build app                                       # default: framework/v8_app.zig → zig-out/bin/app
//!   zig build app -Dapp-name=hello                      # → zig-out/bin/hello
//!   zig build app -Dapp-name=hello -Dapp-source=framework/foo.zig # different root source
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
    // source is now framework/v8_app.zig regardless. App roots live INSIDE
    // framework/ because a Zig module can't @import above its root source's
    // directory — an app root outside framework/ couldn't import framework files.
    const use_v8 = b.option(bool, "use-v8", "(legacy: V8 is the only engine now)") orelse true;
    const app_source = b.option([]const u8, "app-source", "Root Zig source file") orelse "framework/v8_app.zig";
    const sysroot = b.option([]const u8, "sysroot", "Optional sysroot for cross-builds");
    const dev_mode = b.option(bool, "dev-mode", "Read bundle.js from disk and hot-reload on change") orelse false;
    const dev_build_id = b.option([]const u8, "dev-build-id", "Content fingerprint of native inputs embedded in dev-mode hosts") orelse "unknown";
    const dev_socket_path = b.option([]const u8, "dev-socket-path", "Unix socket path for dev-mode bundle pushes") orelse "/tmp/reactjit.sock";
    const dev_bundle_path = b.option([]const u8, "dev-bundle-path", "Bundle path polled by dev-mode hot reload") orelse "bundle.js";
    const dev_native_modules = b.option(bool, "dev-native-modules", "Build the development host against replaceable Scene3D/Game libraries") orelse false;
    const dev_scene3d_module = b.option(bool, "dev-scene3d-module", "Compile the Scene3D implementation library instead of the cold host") orelse false;
    // Compile-probe the staged chaptered implementation through the exact
    // replaceable-module call surface without changing the default live import.
    const dev_game_module = b.option(bool, "dev-game-module", "Compile the Game implementation library instead of the cold host") orelse false;
    const dev_scene3d_path = b.option([]const u8, "dev-scene3d-path", "Initial Scene3D development library loaded by the modular host") orelse b.pathFromRoot("zig-out/dev-modules/scene3d/staging/librjit_scene3d-dev.so");
    const dev_scene3d_hash = b.option([]const u8, "dev-scene3d-hash", "Content hash of the initial Scene3D development library") orelse "staging";
    const dev_game_path = b.option([]const u8, "dev-game-path", "Initial Game development library loaded by the modular host") orelse b.pathFromRoot("zig-out/dev-modules/game/staging/librjit_game-dev.so");
    const dev_game_hash = b.option([]const u8, "dev-game-hash", "Content hash of the initial Game development library") orelse "staging";
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
    // macOS links wgpu dynamically. The self-hosted Mach-O linker
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
    // encodings that the self-hosted Mach-O linker can't parse (it
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
    const has_deej = b.option(bool, "has-deej", "Compile framework/deej.zig (serial fader-board input, plain POSIX — no native libs)") orelse false;
    // -Dhas-window: cart imports <Window> (or <Notification>) from
    // @reactjit/runtime/primitives. For the GPU app (this target), the
    // window-rendering deps (SDL3, freetype, layout, text, windows.zig)
    // are foundational on the GPU shell (engine.run already pulls them).
    // On the headless shell (-Dhas-gpu=false), this flag is what brings
    // SDL3 + freetype + wgpu + the framework include paths in so an
    // otherwise-ANSI binary can paint a <Window> subtree alongside the
    // ANSI grid. See the `has_gpu_cli or has_window` link gates below.
    const has_window = b.option(bool, "has-window", "Cart uses <Window>/<Notification> (foundational on GPU shell; gates SDL3 + window-engine link on headless shell)") orelse false;

    // Bundle path. When unset, defaults to bundle-<app-name>.js at the REPO
    // ROOT (where the bundler writes; two parallel ships don't race on a
    // shared bundle.js), resolved absolute here because v8_app.zig now lives
    // in framework/ and a source-relative fallback would point inside it.
    // rjit-driven builds where the user's cart lives outside the SDK install
    // pass their own absolute path so the bundle can sit in CART_ROOT while
    // build.zig and framework/v8_app.zig live in RJIT_HOME. Either way
    // @embedFile receives an absolute path.
    const bundle_path = b.option([]const u8, "bundle-path", "Absolute path to the cart bundle (overrides default bundle-<app-name>.js lookup)") orelse b.pathFromRoot(b.fmt("bundle-{s}.js", .{app_name}));

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
    options.addOption(bool, "dev_native_modules", dev_native_modules);
    options.addOption(bool, "dev_scene3d_module", dev_scene3d_module);
    options.addOption(bool, "dev_game_module", dev_game_module);
    options.addOption([]const u8, "dev_scene3d_path", dev_scene3d_path);
    options.addOption([]const u8, "dev_scene3d_hash", dev_scene3d_hash);
    options.addOption([]const u8, "dev_game_path", dev_game_path);
    options.addOption([]const u8, "dev_game_hash", dev_game_hash);
    options.addOption(bool, "custom_chrome", custom_chrome);
    options.addOption(bool, "has_physics", has_physics);
    options.addOption(bool, "has_terminal", has_terminal);
    options.addOption(bool, "has_audio", has_audio);
    options.addOption(bool, "has_midi", has_midi);
    options.addOption(bool, "has_deej", has_deej);
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

    const dev_module_abi_mod = b.createModule(.{
        .root_source_file = b.path("framework/dev_modules/abi.zig"),
        .target = target,
        .optimize = optimize,
    });
    const architecture_scale_mod = b.createModule(.{
        .root_source_file = b.path("framework/game/architecture_scale.zig"),
        .target = target,
        .optimize = optimize,
    });
    const wall_types_mod = b.createModule(.{
        .root_source_file = b.path("framework/game/wall_types.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    wall_types_mod.addImport("architecture_scale", architecture_scale_mod);
    const building_catalog_mod = b.createModule(.{
        .root_source_file = b.path("framework/game/building_catalog.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    building_catalog_mod.addImport("architecture_scale", architecture_scale_mod);
    building_catalog_mod.addImport("wall_types", wall_types_mod);
    const wall_topology_mod = b.createModule(.{
        .root_source_file = b.path("framework/game/wall_topology.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    wall_topology_mod.addImport("wall_types", wall_types_mod);
    const wall_mutation_mod = b.createModule(.{
        .root_source_file = b.path("framework/game/wall_mutation.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    wall_mutation_mod.addImport("wall_types", wall_types_mod);
    wall_mutation_mod.addImport("building_catalog", building_catalog_mod);
    wall_mutation_mod.addImport("wall_topology", wall_topology_mod);
    const wall_geometry_mod = b.createModule(.{
        .root_source_file = b.path("framework/game/wall_geometry.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    wall_geometry_mod.addImport("architecture_scale", architecture_scale_mod);
    wall_geometry_mod.addImport("wall_types", wall_types_mod);
    wall_geometry_mod.addImport("building_catalog", building_catalog_mod);
    wall_geometry_mod.addImport("wall_topology", wall_topology_mod);
    const wall_compile_mod = b.createModule(.{
        .root_source_file = b.path("framework/game/wall_compile.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    wall_compile_mod.addImport("wall_types", wall_types_mod);
    wall_compile_mod.addImport("building_catalog", building_catalog_mod);
    wall_compile_mod.addImport("wall_geometry", wall_geometry_mod);
    wall_compile_mod.addImport("wall_topology", wall_topology_mod);
    const building_architecture_mod = b.createModule(.{
        .root_source_file = b.path("framework/game/building_architecture.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    building_architecture_mod.addImport("architecture_scale", architecture_scale_mod);
    building_architecture_mod.addImport("wall_types", wall_types_mod);
    building_architecture_mod.addImport("building_catalog", building_catalog_mod);
    building_architecture_mod.addImport("wall_topology", wall_topology_mod);
    building_architecture_mod.addImport("wall_mutation", wall_mutation_mod);
    building_architecture_mod.addImport("wall_compile", wall_compile_mod);
    const architecture_wire_mod = b.createModule(.{
        .root_source_file = b.path("framework/game/architecture_wire.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    architecture_wire_mod.addImport("building_architecture", building_architecture_mod);

    const root_mod = b.createModule(.{
        .root_source_file = b.path(app_source),
        .target = target,
        .optimize = optimize,
    });
    root_mod.addOptions("build_options", options);
    root_mod.addImport("dev_module_abi", dev_module_abi_mod);
    root_mod.addImport("architecture_scale", architecture_scale_mod);
    root_mod.addImport("building_architecture", building_architecture_mod);
    root_mod.addImport("architecture_wire", architecture_wire_mod);
    // The cart bundle rides in as a named module: v8_app.zig lives in
    // framework/ and @embedFile can't reach a file outside the module root,
    // absolute path or not — a module name resolves like @import and has no
    // such fence. Lazy: app roots that never @embedFile("cart_bundle")
    // (world_loader, headless tools) never open the file, so a missing
    // default bundle can't fail their builds.
    root_mod.addAnonymousImport("cart_bundle", .{
        .root_source_file = .{ .cwd_relative = bundle_path },
    });
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
        if (dev_native_modules) root_mod.addAssemblyFile(b.path("framework/ffi/v8_dev_module_exports.S"));
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
    // Module callbacks resolve cold-host exports (V8 registration, host tree,
    // GPU ownership) from the executable at dlopen time.
    exe.rdynamic = dev_native_modules;
    // 64MB stack. Debug frames are massive (SDL_Event union + engine.run locals
    // alone burn through the old 16MB), and recursive hitTest/paint walks on
    // deep trees compound fast. VA-only; no RSS cost until used.
    exe.stack_size = 64 * 1024 * 1024;

    // ── Always linked ──────────────────────────────────────────
    exe.root_module.link_libc = true;
    // SDL3 + freetype carry the GPU substrate (windowing, GPU paint,
    // text rasterization). Linked when either:
    //   - has_gpu_cli: full GPU shell (engine.run + SDL event pump)
    //   - has_window: TUI cart imports <Window>/<Notification>, needs
    //     SDL3 to paint a real window subtree alongside the ANSI grid
    // Pure-headless builds (has_gpu=false AND has_window=false) skip
    // ~12MB of DT_NEEDED entries and don't need the SDL3/freetype
    // headers at compile time.
    if (has_gpu_cli or has_window) {
        exe.root_module.linkSystemLibrary("SDL3", .{});
        exe.root_module.linkSystemLibrary("freetype", .{});
    }

    const os_tag = target.result.os.tag;
    if (os_tag == .linux) {
        // X11/m are GPU-substrate concerns (window manager hints + math
        // for SDL/wgpu). pthread + dl are universal: V8 isolates need
        // pthread; dlopen lives on dl for libllama/libluajit/etc.
        // luajit + freetype headers ride alongside SDL when GPU or
        // <Window>-on-TUI is on.
        if (has_gpu_cli or has_window) {
            exe.root_module.linkSystemLibrary("X11", .{});
            exe.root_module.linkSystemLibrary("m", .{});
        }
        exe.root_module.linkSystemLibrary("pthread", .{});
        exe.root_module.linkSystemLibrary("dl", .{});
        // libasound is required by framework/audio/midi.zig, which calls
        // ALSA's snd_seq_* API for MIDI sequencer input on Linux. SDL3's
        // audio backends are dlopen'd at runtime (so SDL3 doesn't pull
        // libasound into DT_NEEDED via the audio path), but audio/midi.zig
        // declares the snd_seq_* symbols via @extern, and those need
        // libasound at link time. The dispatcher in framework/audio/midi.zig
        // selects audio/midi.zig only when has_midi is on; without midi
        // doesn't reference any ALSA symbols, so non-MIDI carts skip
        // both the link and the ~600KB DT_NEEDED entry.
        if (has_midi) exe.root_module.linkSystemLibrary("asound", .{});
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
            exe.root_module.linkFramework("Foundation", .{});
            exe.root_module.linkFramework("QuartzCore", .{});
            exe.root_module.linkFramework("Metal", .{});
            exe.root_module.linkFramework("Cocoa", .{});
            exe.root_module.linkFramework("IOKit", .{});
            exe.root_module.linkFramework("CoreVideo", .{});
            // wgpu is dynamic on macOS (see wgpu_link_mode): the dep doesn't
            // addObjectFile the .a in dynamic mode, it exposes the prebuilt
            // dylib through its named write-files "lib" (the real .dylib lives
            // in wgpu-native's nested binary-release package, not in this repo's
            // deps/wgpu_native_zig/lib). Link it from there, install it into
            // zig-out/lib next to the binary, and rpath @loader_path/../lib so
            // the @rpath/libwgpu_native.dylib install_name resolves at runtime.
            const wgpu_lib_dir = wgpu_dep.namedWriteFiles("lib").getDirectory();
            exe.root_module.addLibraryPath(wgpu_lib_dir);
            root_mod.linkSystemLibrary("wgpu_native", .{ .preferred_link_mode = .dynamic });
            const wgpu_dylib_install = b.addInstallLibFile(wgpu_lib_dir.path(b, "libwgpu_native.dylib"), "libwgpu_native.dylib");
            exe.step.dependOn(&wgpu_dylib_install.step);
            exe.root_module.addRPath(.{ .cwd_relative = "@loader_path/../lib" });
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
        exe.root_module.linkLibrary(whisper_lib);
        exe.root_module.addRPath(.{ .cwd_relative = "$ORIGIN" });
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
        exe.root_module.linkSystemLibrary("onnxruntime", .{});
        // $ORIGIN so the packaged binary finds libonnxruntime.so.1 sitting
        // next to it. scripts/ship's source-driven walker bundles the .so
        // when this feature is gated on via the dependency-registry.
        exe.root_module.addRPath(.{ .cwd_relative = "$ORIGIN" });
    }

    // ── Lore version control (has_lore) ────────────────────────
    // The C header is tracked; the release-pinned liblore.so is fetched by
    // scripts/fetch-lore.sh and remains out of Git. Lore is editor/GPU-only
    // because the panic snapshot reads the resident scene3d mesh document.
    const has_lore = (b.option(bool, "has-lore", "Link liblore + register __lore_* resident model snapshot bindings") orelse false) and
        has_gpu_cli and os_tag == .linux;
    if (has_lore) {
        root_mod.addIncludePath(b.path("deps/lore/include"));
        root_mod.addLibraryPath(b.path("deps/lore/lib"));
        exe.root_module.linkSystemLibrary("lore", .{});
        exe.root_module.addRPath(.{ .cwd_relative = "$ORIGIN" });
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
        const root_lib = std.Io.Dir.cwd().access(b.graph.io, "zig-out/lib/libllama_ffi.so", .{}) catch null;
        if (root_lib != null) {
            root_mod.addLibraryPath(b.path("zig-out/lib"));
        } else {
            root_mod.addLibraryPath(b.path("tsz/zig-out/lib"));
        }
        exe.root_module.linkSystemLibrary("llama_ffi", .{});
        exe.root_module.addRPath(.{ .cwd_relative = "$ORIGIN" });
        exe.root_module.addRPath(.{ .cwd_relative = "$ORIGIN/../lib" });
    }

    // ── Framework FFI shims ────────────────────────────────────
    if (has_physics) {
        root_mod.addCSourceFile(.{ .file = b.path("framework/ffi/physics_shim.cpp"), .flags = &.{"-O2"} });
    }

    // ── System libraries ──────────────────────────────────────
    if (has_physics) exe.root_module.linkSystemLibrary("box2d", .{});
    if (has_terminal) exe.root_module.linkSystemLibrary("vterm", .{});

    // ── Privacy / libsodium (opt-in per cart) ─────────────────
    // Source-driven: cart bundle that imports usePrivacy gets libsodium
    // linked + bundled. Cart that doesn't, doesn't pay for it. scripts/ship
    // greps the bundle and passes -Dhas-privacy.
    // Linux-only: the bundled libsodium payloads are Linux .so builds; no macOS
    // prebuilt is vendored, so the fat dev host gates privacy off on macOS.
    const has_privacy = (b.option(bool, "has-privacy", "Link libsodium + privacy bindings") orelse false) and os_tag == .linux;
    options.addOption(bool, "has_privacy", has_privacy);
    if (has_privacy) {
        exe.root_module.linkSystemLibrary("sodium", .{});
        if (os_tag == .linux) {
            const brew_sodium = "/home/linuxbrew/.linuxbrew/Cellar/libsodium/1.0.20/include";
            if (std.Io.Dir.cwd().access(b.graph.io, brew_sodium, .{})) |_| {
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
    options.addOption(bool, "has_lore", has_lore);

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
    _ = manifest_wf.add("v8-ingredients/lore.flag", if (has_lore) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/audio.flag", if (has_audio) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/midi.flag", if (has_midi) "1\n" else "0\n");
    _ = manifest_wf.add("v8-ingredients/deej.flag", if (has_deej) "1\n" else "0\n");
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
    exe.root_module.link_libcpp = true;

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
    if (has_lore) {
        const install_lore = b.addInstallBinFile(b.path("deps/lore/lib/liblore.so"), "liblore.so");
        b.getInstallStep().dependOn(&install_lore.step);
        app_step.dependOn(&install_lore.step);
    }

    // ── Replaceable Scene3D development library ───────────────
    // Built in a separate invocation with:
    //   -Ddev-native-modules=true -Ddev-scene3d-module=true
    // so the same build-options object selects module-side service facades
    // without changing the independently cached cold executable invocation.
    // Header-only views intentionally omit the non-PIC static V8/wgpu archives;
    // their C symbols are resolved from the `-rdynamic` cold executable.
    const v8_headers_options = b.addOptions();
    v8_headers_options.addOption(bool, "inspector_subtype", true);
    const v8_headers_mod = b.createModule(.{
        .root_source_file = b.path("deps/zig-v8/src/v8.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .link_libcpp = true,
    });
    v8_headers_mod.addIncludePath(b.path("deps/zig-v8/src"));
    v8_headers_mod.addImport("default_exports", v8_headers_options.createModule());
    inline for (.{
        "std__shared_ptr__v8__BackingStore__get",
        "std__shared_ptr__v8__BackingStore__reset",
        "v8__ArrayBufferView__Buffer",
        "v8__ArrayBufferView__ByteLength",
        "v8__ArrayBufferView__ByteOffset",
        "v8__ArrayBuffer__GetBackingStore",
        "v8__ArrayBuffer__New2",
        "v8__ArrayBuffer__NewBackingStore2",
        "v8__BackingStore__Data",
        "v8__BackingStore__TO_SHARED_PTR",
        "v8__Context__GetIsolate",
        "v8__FunctionCallbackInfo__GetIsolate",
        "v8__FunctionCallbackInfo__GetReturnValue",
        "v8__FunctionCallbackInfo__INDEX",
        "v8__FunctionCallbackInfo__Length",
        "v8__Isolate__GetCurrentContext",
        "v8__Null",
        "v8__Number__New",
        "v8__Object__New",
        "v8__Object__Set",
        "v8__ReturnValue__Set",
        "v8__String__NewFromUtf8",
        "v8__String__Utf8Length",
        "v8__String__WriteUtf8",
        "v8__Value__Int32Value",
        "v8__Value__BooleanValue",
        "v8__Value__IsArrayBufferView",
        "v8__Value__NumberValue",
        "v8__Value__ToString",
    }) |symbol| v8_headers_mod.addCMacro(symbol, b.fmt("rjit_{s}", .{symbol}));
    const wgpu_headers_mod = b.createModule(.{
        .root_source_file = b.path("deps/wgpu_native_zig/src/root.zig"),
        .target = target,
        .optimize = optimize,
    });
    const scene3d_module_mod = b.createModule(.{
        .root_source_file = b.path("framework/dev_scene3d_module_root.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .link_libcpp = true,
        .strip = true,
    });
    scene3d_module_mod.addOptions("build_options", options);
    scene3d_module_mod.addImport("dev_module_abi", dev_module_abi_mod);
    scene3d_module_mod.addImport("architecture_scale", architecture_scale_mod);
    scene3d_module_mod.addImport("wgpu", wgpu_headers_mod);
    scene3d_module_mod.addImport("tls", tls_mod);
    scene3d_module_mod.addImport("pg", pg_dep.module("pg"));
    scene3d_module_mod.addImport("v8", v8_headers_mod);
    scene3d_module_mod.addIncludePath(b.path("."));
    scene3d_module_mod.addIncludePath(b.path("framework/ffi"));
    scene3d_module_mod.addIncludePath(b.path("framework/ffi/llama_headers"));
    scene3d_module_mod.addIncludePath(b.path("deps/libfvad/include"));
    if (os_tag == .linux) {
        scene3d_module_mod.addIncludePath(.{ .cwd_relative = "/usr/include/luajit-2.1" });
        scene3d_module_mod.addIncludePath(.{ .cwd_relative = "/usr/include/freetype2" });
        scene3d_module_mod.addIncludePath(.{ .cwd_relative = "/usr/include/x86_64-linux-gnu" });
    } else if (os_tag == .macos) {
        scene3d_module_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include/luajit-2.1" });
        scene3d_module_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include/freetype2" });
        scene3d_module_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include" });
    }
    scene3d_module_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_impl.c"), .flags = &.{"-O2"} });
    scene3d_module_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_write_impl.c"), .flags = &.{"-O2"} });

    const scene3d_module_lib = b.addLibrary(.{
        .name = "rjit_scene3d-dev",
        .root_module = scene3d_module_mod,
        .linkage = .dynamic,
    });
    scene3d_module_lib.linker_allow_shlib_undefined = true;
    scene3d_module_lib.link_z_lazy = true;
    const install_scene3d_module = b.addInstallArtifact(scene3d_module_lib, .{
        .dest_dir = .{ .override = .prefix },
        .dest_sub_path = b.fmt("dev-modules/scene3d/staging/{s}", .{scene3d_module_lib.out_filename}),
        .dylib_symlinks = false,
    });
    b.step("dev-scene3d-module", "Build the replaceable Scene3D development library")
        .dependOn(&install_scene3d_module.step);

    // Headless resident-edit composition test. This compiles the real Scene3D
    // journal/cache/gizmo path but never initializes the GPU; its presentation
    // boundary is the pre-draw host mesh stash.
    const scene3d_mesh_drag_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/scene3d_mesh_drag_test_root.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .link_libcpp = true,
    });
    scene3d_mesh_drag_test_mod.addOptions("build_options", options);
    scene3d_mesh_drag_test_mod.addImport("dev_module_abi", dev_module_abi_mod);
    scene3d_mesh_drag_test_mod.addImport("architecture_scale", architecture_scale_mod);
    scene3d_mesh_drag_test_mod.addImport("wgpu", wgpu_mod);
    scene3d_mesh_drag_test_mod.addImport("tls", tls_mod);
    scene3d_mesh_drag_test_mod.addImport("pg", pg_dep.module("pg"));
    scene3d_mesh_drag_test_mod.addImport("v8", v8_headers_mod);
    scene3d_mesh_drag_test_mod.addIncludePath(b.path("."));
    scene3d_mesh_drag_test_mod.addIncludePath(b.path("framework/ffi"));
    scene3d_mesh_drag_test_mod.addIncludePath(b.path("framework/ffi/llama_headers"));
    scene3d_mesh_drag_test_mod.addIncludePath(b.path("deps/libfvad/include"));
    if (os_tag == .linux) {
        scene3d_mesh_drag_test_mod.addIncludePath(.{ .cwd_relative = "/usr/include/luajit-2.1" });
        scene3d_mesh_drag_test_mod.addIncludePath(.{ .cwd_relative = "/usr/include/freetype2" });
        scene3d_mesh_drag_test_mod.addIncludePath(.{ .cwd_relative = "/usr/include/x86_64-linux-gnu" });
    } else if (os_tag == .macos) {
        scene3d_mesh_drag_test_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include/luajit-2.1" });
        scene3d_mesh_drag_test_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include/freetype2" });
        scene3d_mesh_drag_test_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include" });
    }
    scene3d_mesh_drag_test_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_impl.c"), .flags = &.{"-O2"} });
    scene3d_mesh_drag_test_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_write_impl.c"), .flags = &.{"-O2"} });
    const scene3d_mesh_drag_test = b.addTest(.{
        .name = "scene3d-mesh-drag-test",
        .root_module = scene3d_mesh_drag_test_mod,
    });
    const run_scene3d_mesh_drag_test = b.addRunArtifact(scene3d_mesh_drag_test);
    b.step("test-scene3d-mesh-drag", "Run the headless retained-cache two-drag regression")
        .dependOn(&run_scene3d_mesh_drag_test.step);

    // Semantic gate for gpu/scene3d/ — the live split Scene3D tree (req_4375
    // verbatim split of the old gpu/3d.zig monolith): keeps every decl analyzed.
    const split3d_check_mod = b.createModule(.{
        .root_source_file = b.path("framework/split3d_check_root.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .link_libcpp = true,
    });
    split3d_check_mod.addOptions("build_options", options);
    split3d_check_mod.addImport("dev_module_abi", dev_module_abi_mod);
    split3d_check_mod.addImport("architecture_scale", architecture_scale_mod);
    split3d_check_mod.addImport("wgpu", wgpu_mod);
    split3d_check_mod.addImport("tls", tls_mod);
    split3d_check_mod.addImport("pg", pg_dep.module("pg"));
    split3d_check_mod.addImport("v8", v8_headers_mod);
    split3d_check_mod.addIncludePath(b.path("."));
    split3d_check_mod.addIncludePath(b.path("framework/ffi"));
    split3d_check_mod.addIncludePath(b.path("framework/ffi/llama_headers"));
    split3d_check_mod.addIncludePath(b.path("deps/libfvad/include"));
    if (os_tag == .linux) {
        split3d_check_mod.addIncludePath(.{ .cwd_relative = "/usr/include/luajit-2.1" });
        split3d_check_mod.addIncludePath(.{ .cwd_relative = "/usr/include/freetype2" });
        split3d_check_mod.addIncludePath(.{ .cwd_relative = "/usr/include/x86_64-linux-gnu" });
    } else if (os_tag == .macos) {
        split3d_check_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include/luajit-2.1" });
        split3d_check_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include/freetype2" });
        split3d_check_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include" });
    }
    split3d_check_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_impl.c"), .flags = &.{"-O2"} });
    split3d_check_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_write_impl.c"), .flags = &.{"-O2"} });
    // The recursive decl ref reaches the text-overlay paths, so link what they need.
    split3d_check_mod.linkSystemLibrary("freetype", .{});
    const split3d_check = b.addTest(.{
        .name = "split3d-check",
        .root_module = split3d_check_mod,
    });
    const run_split3d_check = b.addRunArtifact(split3d_check);
    b.step("check-3d-split", "Analyze the gpu/scene3d split tree (req_4375)")
        .dependOn(&run_split3d_check.step);

    const game_module_mod = b.createModule(.{
        .root_source_file = b.path("framework/dev_game_module_root.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .link_libcpp = true,
        .strip = true,
    });
    game_module_mod.addOptions("build_options", options);
    game_module_mod.addImport("dev_module_abi", dev_module_abi_mod);
    game_module_mod.addImport("architecture_scale", architecture_scale_mod);
    game_module_mod.addImport("building_architecture", building_architecture_mod);
    game_module_mod.addImport("architecture_wire", architecture_wire_mod);
    game_module_mod.addImport("wgpu", wgpu_headers_mod);
    game_module_mod.addImport("tls", tls_mod);
    game_module_mod.addImport("pg", pg_dep.module("pg"));
    game_module_mod.addImport("v8", v8_headers_mod);
    game_module_mod.addIncludePath(b.path("."));
    game_module_mod.addIncludePath(b.path("framework/ffi"));
    game_module_mod.addIncludePath(b.path("framework/ffi/llama_headers"));
    game_module_mod.addIncludePath(b.path("deps/libfvad/include"));
    if (os_tag == .linux) {
        game_module_mod.addIncludePath(.{ .cwd_relative = "/usr/include/luajit-2.1" });
        game_module_mod.addIncludePath(.{ .cwd_relative = "/usr/include/freetype2" });
        game_module_mod.addIncludePath(.{ .cwd_relative = "/usr/include/x86_64-linux-gnu" });
    } else if (os_tag == .macos) {
        game_module_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include/luajit-2.1" });
        game_module_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include/freetype2" });
        game_module_mod.addIncludePath(.{ .cwd_relative = "/opt/homebrew/include" });
    }
    const game_module_lib = b.addLibrary(.{
        .name = "rjit_game-dev",
        .root_module = game_module_mod,
        .linkage = .dynamic,
    });
    game_module_lib.linker_allow_shlib_undefined = true;
    game_module_lib.link_z_lazy = true;
    const install_game_module = b.addInstallArtifact(game_module_lib, .{
        .dest_dir = .{ .override = .prefix },
        .dest_sub_path = b.fmt("dev-modules/game/staging/{s}", .{game_module_lib.out_filename}),
        .dylib_symlinks = false,
    });
    b.step("dev-game-module", "Build the replaceable Game development library")
        .dependOn(&install_game_module.step);

    // ── v8-hello: smoke test for framework/v8_runtime.zig ──────
    const v8_hello_dep = b.dependency("v8", .{
        .target = target,
        .optimize = optimize,
        .prebuilt_v8_path = @as([]const u8, prebuilt_v8_path),
    });
    const v8_mod = v8_hello_dep.module("v8");

    const v8_hello_mod = b.createModule(.{
        .root_source_file = b.path("framework/v8_hello.zig"),
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
    v8_hello_exe.root_module.link_libc = true;
    v8_hello_exe.root_module.link_libcpp = true;

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
        .root_source_file = b.path("framework/v8_cli.zig"),
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
    v8_cli_exe.root_module.link_libc = true;
    v8_cli_exe.root_module.link_libcpp = true;

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
    hmsc_parity_exe.root_module.link_libc = true;
    const hmsc_parity_step = b.step("hmsc-parity-compiler", "Build the hmsc Zig game-file parity compiler");
    hmsc_parity_step.dependOn(&b.addInstallArtifact(hmsc_parity_exe, .{}).step);

    // ── flora dump (req_2993) ───────────────────────────────────
    // Pure Zig exporter: every flora mesh (instanced cards + wrapped species)
    // materialized as editor model packages for content-browser inspection.
    const flora_geometry_mod = b.createModule(.{
        .root_source_file = b.path("framework/world/flora_geometry.zig"),
        .target = target,
        .optimize = optimize,
    });
    const loader_geometry_mod = b.createModule(.{
        .root_source_file = b.path("framework/world_loader/geometry.zig"),
        .target = target,
        .optimize = optimize,
    });
    const flora_dump_mod = b.createModule(.{
        .root_source_file = b.path("framework/tools/flora_dump.zig"),
        .target = target,
        .optimize = optimize,
    });
    flora_dump_mod.addImport("flora_geometry", flora_geometry_mod);
    flora_dump_mod.addImport("loader_geometry", loader_geometry_mod);
    const flora_dump_exe = b.addExecutable(.{
        .name = "flora_dump",
        .root_module = flora_dump_mod,
    });
    const flora_dump_step = b.step("flora-dump", "Export every flora mesh as an editor model package");
    flora_dump_step.dependOn(&b.addInstallArtifact(flora_dump_exe, .{}).step);

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
    luajit_runtime_test.root_module.linkLibrary(luajit_runtime_bridge);
    luajit_runtime_test.root_module.link_libc = true;
    luajit_runtime_test.root_module.linkSystemLibrary("SDL3", .{});
    luajit_runtime_test.root_module.linkSystemLibrary("freetype", .{});
    luajit_runtime_test.root_module.linkSystemLibrary("luajit-5.1", .{});
    if (os_tag == .linux) {
        luajit_runtime_test.root_module.linkSystemLibrary("X11", .{});
        luajit_runtime_test.root_module.linkSystemLibrary("m", .{});
        luajit_runtime_test.root_module.linkSystemLibrary("pthread", .{});
        luajit_runtime_test.root_module.linkSystemLibrary("dl", .{});
    } else if (os_tag == .macos) {
        luajit_runtime_test.root_module.linkFramework("Foundation", .{});
        luajit_runtime_test.root_module.linkFramework("QuartzCore", .{});
        luajit_runtime_test.root_module.linkFramework("Metal", .{});
        luajit_runtime_test.root_module.linkFramework("Cocoa", .{});
        luajit_runtime_test.root_module.linkFramework("IOKit", .{});
        luajit_runtime_test.root_module.linkFramework("CoreVideo", .{});
    }
    if (has_physics) luajit_runtime_test.root_module.linkSystemLibrary("box2d", .{});
    if (has_terminal) luajit_runtime_test.root_module.linkSystemLibrary("vterm", .{});
    luajit_runtime_test.root_module.link_libcpp = true;

    const run_luajit_runtime_test = b.addRunArtifact(luajit_runtime_test);
    const luajit_runtime_test_step = b.step("test-luajit-runtime", "Run the LuaJIT runtime integration test");
    luajit_runtime_test_step.dependOn(&run_luajit_runtime_test.step);

    // ── Authoring draw-distance tests ──────────────────────────────
    // The editor camera's far plane + fog + streaming residency (req_4167): the
    // baked load-time plane is the game camera's, and driving the iso authoring
    // view off it clipped the world away at zoom-out. Its own file is the test
    // ROOT — inline tests in an imported module never run.
    const author_draw_distance_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/author_draw_distance_test_root.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const author_draw_distance_test = b.addTest(.{
        .name = "author-draw-distance-test",
        .root_module = author_draw_distance_test_mod,
    });
    const run_author_draw_distance_test = b.addRunArtifact(author_draw_distance_test);
    const author_draw_distance_test_step = b.step("test-author-draw-distance", "Run the editor authoring draw-distance tests");
    author_draw_distance_test_step.dependOn(&run_author_draw_distance_test.step);

    // ── Spring-arm vs placed-prop camera collision tests ───────────
    // req_4292: the /play spring-arm steps against the live physics set as a
    // SECOND input — the only carrier of mesh-prop coarse boxes — so the eye
    // stays inside a placed container instead of passing through its walls.
    // Its own file is the test ROOT — inline tests in an imported module never run.
    const spring_arm_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/world_loader_spring_arm_test_root.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const spring_arm_test = b.addTest(.{
        .name = "world-loader-spring-arm-test",
        .root_module = spring_arm_test_mod,
    });
    const run_spring_arm_test = b.addRunArtifact(spring_arm_test);
    const spring_arm_test_step = b.step("test-world-loader-spring-arm", "Run the spring-arm camera vs placed-prop collision tests");
    spring_arm_test_step.dependOn(&run_spring_arm_test.step);

    // ── Process-lifetime tests ─────────────────────────────────────
    // proc_lifetime.zig is what stops a dev host outliving its supervisor, and
    // its entry point takes `anytype` — nothing in the body is compiled until
    // something instantiates it. Its own file is the test ROOT, because inline
    // tests in an imported module never run (req_4109).
    const proc_lifetime_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/proc_lifetime.zig"),
        .target = target,
        .optimize = optimize,
    });
    const proc_lifetime_test = b.addTest(.{
        .name = "proc-lifetime-test",
        .root_module = proc_lifetime_test_mod,
    });
    const run_proc_lifetime_test = b.addRunArtifact(proc_lifetime_test);
    const proc_lifetime_test_step = b.step("test-proc-lifetime", "Run the parent-death-signal contract tests");
    proc_lifetime_test_step.dependOn(&run_proc_lifetime_test.step);

    // ── Zig 0.16 compiler-contract tests ───────────────────────────
    const zig016_idioms_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/zig016_idioms.zig"),
        .target = target,
        .optimize = optimize,
    });
    const zig016_idioms_test = b.addTest(.{
        .name = "zig016-idioms-test",
        .root_module = zig016_idioms_test_mod,
    });
    const run_zig016_idioms_test = b.addRunArtifact(zig016_idioms_test);
    const zig016_idioms_test_step = b.step("test-zig016-idioms", "Run Zig 0.16 language-idiom tests");
    zig016_idioms_test_step.dependOn(&run_zig016_idioms_test.step);

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

    // ── Pointer-event hit-test unit tests ──────────────────────────
    const events_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/events.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const events_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/events.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    events_test_mod.addImport("events", events_mod_for_tests);
    const events_test = b.addTest(.{
        .name = "events-test",
        .root_module = events_test_mod,
    });
    const run_events_test = b.addRunArtifact(events_test);
    const events_test_step = b.step("test-events", "Run pointer-event hit-test unit tests");
    events_test_step.dependOn(&run_events_test.step);

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

    // React mutation placement: keyed APPEND/INSERT_BEFORE operations must
    // move one native child reference rather than duplicate it.
    const host_tree_impl_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/host_tree.zig"),
        .target = target,
        .optimize = optimize,
    });
    const host_tree_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/host_tree.zig"),
        .target = target,
        .optimize = optimize,
    });
    host_tree_test_mod.addImport("host_tree", host_tree_impl_test_mod);
    const host_tree_test = b.addTest(.{
        .name = "host-tree-test",
        .root_module = host_tree_test_mod,
    });
    const run_host_tree_test = b.addRunArtifact(host_tree_test);
    const host_tree_test_step = b.step("test-host-tree", "Run native React child-placement tests");
    host_tree_test_step.dependOn(&run_host_tree_test.step);

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

    const compile_progress_test_mod = b.createModule(.{
        // Root at framework/ so compile_progress's sibling diag imports remain
        // inside the Zig 0.16 module boundary. The actual test stays under
        // framework/testing/unit/ per repository convention.
        .root_source_file = b.path("framework/compile_progress_test_root.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const compile_progress_test = b.addTest(.{
        .name = "compile-progress-test",
        .root_module = compile_progress_test_mod,
    });
    const run_compile_progress_test = b.addRunArtifact(compile_progress_test);
    const compile_progress_test_step = b.step("test-compile-progress", "Run shader compile memory telemetry tests");
    compile_progress_test_step.dependOn(&run_compile_progress_test.step);

    // ── pose worker mailbox tests (req_2845) ─────────────────────────
    // Pins the live-inference boundary: camera bytes are copied before the
    // render thread mutates them, only one frame may occupy the pipeline, and
    // shutdown/result backpressure never grows a latent frame queue.
    const inference_mailbox_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/ml/inference_mailbox.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const inference_mailbox_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/inference_mailbox.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    inference_mailbox_test_mod.addImport("inference_mailbox", inference_mailbox_mod_for_tests);
    const inference_mailbox_test = b.addTest(.{
        .name = "inference-mailbox-test",
        .root_module = inference_mailbox_test_mod,
    });
    const run_inference_mailbox_test = b.addRunArtifact(inference_mailbox_test);
    const inference_mailbox_test_step = b.step("test-inference-mailbox", "Run live inference worker mailbox tests");
    inference_mailbox_test_step.dependOn(&run_inference_mailbox_test.step);

    // V4L2 camera discovery (req_2846): querycap filtering must never expose
    // a camera's metadata companion as if it were a usable image source.
    if (os_tag == .linux) {
        // Whole-frame camera pipe pump (req_3532): multi-megabyte raw frames
        // must be assembled off the frame thread before the watchdog expires.
        const frame_pipe_mod_for_tests = b.createModule(.{
            .root_source_file = b.path("framework/render/frame_pipe.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        const frame_pipe_test_mod = b.createModule(.{
            .root_source_file = b.path("framework/testing/unit/frame_pipe.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        frame_pipe_test_mod.addImport("frame_pipe", frame_pipe_mod_for_tests);
        const frame_pipe_test = b.addTest(.{
            .name = "frame-pipe-test",
            .root_module = frame_pipe_test_mod,
        });
        const run_frame_pipe_test = b.addRunArtifact(frame_pipe_test);
        const frame_pipe_test_step = b.step("test-frame-pipe", "Run camera whole-frame pipe pump tests");
        frame_pipe_test_step.dependOn(&run_frame_pipe_test.step);

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

    // Freeze tripwire (req_3503): capture-child teardown must never park the
    // calling thread — not even for a SIGTERM-immune child blocked writing
    // into a full pipe (the exact live-ffmpeg state that froze the app).
    if (os_tag == .linux) {
        const child_teardown_mod_for_tests = b.createModule(.{
            .root_source_file = b.path("framework/render/child_teardown.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        const child_teardown_test_mod = b.createModule(.{
            .root_source_file = b.path("framework/testing/unit/child_teardown.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        child_teardown_test_mod.addImport("child_teardown", child_teardown_mod_for_tests);
        const child_teardown_test = b.addTest(.{
            .name = "child-teardown-test",
            .root_module = child_teardown_test_mod,
        });
        const run_child_teardown_test = b.addRunArtifact(child_teardown_test);
        const child_teardown_test_step = b.step("test-child-teardown", "Run capture child-teardown freeze-tripwire tests");
        child_teardown_test_step.dependOn(&run_child_teardown_test.step);
    }

    // ONNX-backed worker integration: explicit (not part of lean test steps),
    // because it links the vendored runtime and optionally loads the user's
    // vendored models. A missing model is a valid surfaced worker result.
    if (os_tag == .linux) {
        // BlazePose lane (req_4387): contract checks run model-free; the
        // lifecycle test additionally proves output-shape resolution when the
        // vendored models are installed. RJIT_BLAZEPOSE_IMAGE=/path.jpg is the
        // ground-truth probe.
        const blazepose_mod_for_tests = b.createModule(.{
            .root_source_file = b.path("framework/ml/blazepose.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        blazepose_mod_for_tests.addIncludePath(b.path("deps/onnxruntime/include"));
        blazepose_mod_for_tests.addIncludePath(b.path("."));
        const blazepose_test_mod = b.createModule(.{
            .root_source_file = b.path("framework/testing/unit/blazepose.zig"),
            .target = target,
            .optimize = optimize,
            .link_libc = true,
        });
        blazepose_test_mod.addImport("blazepose", blazepose_mod_for_tests);
        blazepose_test_mod.addCSourceFile(.{ .file = b.path("stb/stb_image_impl.c"), .flags = &.{"-O2"} });
        const blazepose_test = b.addTest(.{
            .name = "blazepose-test",
            .root_module = blazepose_test_mod,
        });
        blazepose_test.root_module.addLibraryPath(b.path("deps/onnxruntime/lib"));
        blazepose_test.root_module.linkSystemLibrary("onnxruntime", .{});
        blazepose_test.root_module.addRPath(b.path("deps/onnxruntime/lib"));
        const run_blazepose_test = b.addRunArtifact(blazepose_test);
        run_blazepose_test.setEnvironmentVariable("LD_LIBRARY_PATH", b.pathFromRoot("deps/onnxruntime/lib"));
        const blazepose_test_step = b.step("test-blazepose", "Run ONNX-backed BlazePose lane contract + integration tests");
        blazepose_test_step.dependOn(&run_blazepose_test.step);
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
    const model_paint_carry_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/model_paint.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    model_paint_carry_test_mod.addImport("model_paint", model_paint_test_mod);
    const model_paint_test = b.addTest(.{
        .name = "model-paint-test",
        .root_module = model_paint_test_mod,
    });
    const run_model_paint_test = b.addRunArtifact(model_paint_test);
    const model_paint_carry_test = b.addTest(.{
        .name = "model-paint-carry-test",
        .root_module = model_paint_carry_test_mod,
    });
    const run_model_paint_carry_test = b.addRunArtifact(model_paint_carry_test);
    const model_paint_test_step = b.step("test-model-paint", "Run the model-paint raycast/atlas unit tests");
    model_paint_test_step.dependOn(&run_model_paint_test.step);
    model_paint_test_step.dependOn(&run_model_paint_carry_test.step);

    // ── gizmo axis→screen mapping (the drag's px→world arithmetic) ──────────
    const gizmo_axis_map_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/gizmo_axis_map.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const gizmo_axis_map_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/gizmo_axis_map.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    gizmo_axis_map_test_mod.addImport("gizmo_axis_map", gizmo_axis_map_mod);
    const gizmo_axis_map_test = b.addTest(.{
        .name = "gizmo-axis-map-test",
        .root_module = gizmo_axis_map_test_mod,
    });
    const run_gizmo_axis_map_test = b.addRunArtifact(gizmo_axis_map_test);
    const gizmo_axis_map_test_step = b.step("test-gizmo-axis-map", "Run the gizmo axis→screen drag-mapping tests");
    gizmo_axis_map_test_step.dependOn(&run_gizmo_axis_map_test.step);

    // ── paint program journal (UV/texture transaction carry) ────────────────
    const paint_program_journal_impl_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing_paint_program_journal_root.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    paint_program_journal_impl_mod.addImport("wgpu", wgpu_mod);
    const paint_program_journal_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/paint_program_journal.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    paint_program_journal_test_mod.addImport("paint_program_root", paint_program_journal_impl_mod);
    const paint_program_journal_test = b.addTest(.{
        .name = "paint-program-journal-test",
        .root_module = paint_program_journal_test_mod,
    });
    const run_paint_program_journal_test = b.addRunArtifact(paint_program_journal_test);
    const paint_program_journal_test_step = b.step("test-paint-program-journal", "Run exact paint-program transaction state tests");
    paint_program_journal_test_step.dependOn(&run_paint_program_journal_test.step);

    // ── pen path → concave camera-facing plane — headless, no GPU ──────────
    const path_plane_impl_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/path_plane.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const path_plane_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/path_plane.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    path_plane_test_mod.addImport("path_plane", path_plane_impl_test_mod);
    const path_plane_test = b.addTest(.{
        .name = "path-plane-test",
        .root_module = path_plane_test_mod,
    });
    const run_path_plane_test = b.addRunArtifact(path_plane_test);
    const path_plane_test_step = b.step("test-path-plane", "Run pen-path triangulation/projection unit tests");
    path_plane_test_step.dependOn(&run_path_plane_test.step);

    // ── model-stage scale cue unit tests — headless, no GPU ───────────────────
    // Pins the ruled metre contract consumed by the native modeling-stage overlay:
    // coarse tile, collider, visual head top, and ruler tick cadence.
    const stage_scale_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/stage_scale.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const stage_scale_impl_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/stage_scale.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    stage_scale_impl_test_mod.addImport("architecture_scale", architecture_scale_mod);
    stage_scale_test_mod.addImport("stage_scale", stage_scale_impl_test_mod);
    const stage_scale_test = b.addTest(.{
        .name = "stage-scale-test",
        .root_module = stage_scale_test_mod,
    });
    const run_stage_scale_test = b.addRunArtifact(stage_scale_test);
    const stage_scale_test_step = b.step("test-stage-scale", "Run the model-stage scale cue unit tests");
    stage_scale_test_step.dependOn(&run_stage_scale_test.step);

    // ── stable mutable geometry-slot allocation — headless, no GPU ──────────
    const stable_geometry_slot_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/stable_geometry_slot.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const stable_geometry_slot_test = b.addTest(.{
        .name = "stable-geometry-slot-test",
        .root_module = stable_geometry_slot_test_mod,
    });
    const run_stable_geometry_slot_test = b.addRunArtifact(stable_geometry_slot_test);
    const stable_geometry_slot_test_step = b.step("test-stable-geometry-slot", "Run stable mutable geometry-slot allocation tests");
    stable_geometry_slot_test_step.dependOn(&run_stable_geometry_slot_test.step);

    // ── semantic face membership/debt invariants — headless, no GPU ─────────
    const mesh_semantics_impl_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_semantics.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const mesh_semantics_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/mesh_semantics.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_semantics_test_mod.addImport("mesh_semantics", mesh_semantics_impl_test_mod);
    const mesh_semantics_test = b.addTest(.{
        .name = "mesh-semantics-test",
        .root_module = mesh_semantics_test_mod,
    });
    const run_mesh_semantics_test = b.addRunArtifact(mesh_semantics_test);
    const mesh_semantic_restore_impl_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_semantic_restore.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const mesh_semantic_restore_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/mesh_semantic_restore.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_semantic_restore_test_mod.addImport("mesh_semantic_restore", mesh_semantic_restore_impl_test_mod);
    const mesh_semantic_restore_test = b.addTest(.{
        .name = "mesh-semantic-restore-test",
        .root_module = mesh_semantic_restore_test_mod,
    });
    const run_mesh_semantic_restore_test = b.addRunArtifact(mesh_semantic_restore_test);
    const mesh_semantics_test_step = b.step("test-mesh-semantics", "Run semantic face membership/debt tests");
    mesh_semantics_test_step.dependOn(&run_mesh_semantics_test.step);
    mesh_semantics_test_step.dependOn(&run_mesh_semantic_restore_test.step);

    // ── durable named-edge semantic paths — headless, no GPU ───────────────
    const mesh_edge_semantics_impl_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_edge_semantics.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const mesh_edge_semantics_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/mesh_edge_semantics.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_edge_semantics_test_mod.addImport("mesh_edge_semantics", mesh_edge_semantics_impl_test_mod);
    const mesh_edge_semantics_test = b.addTest(.{
        .name = "mesh-edge-semantics-test",
        .root_module = mesh_edge_semantics_test_mod,
    });
    const run_mesh_edge_semantics_test = b.addRunArtifact(mesh_edge_semantics_test);
    const mesh_edge_semantics_test_step = b.step("test-mesh-edge-semantics", "Run durable named-edge semantic path tests");
    mesh_edge_semantics_test_step.dependOn(&run_mesh_edge_semantics_test.step);

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
    const indexed_edit_mesh_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/indexed_edit_mesh.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_edit_test_mod.addImport("mesh_edit", mesh_edit_impl_test_mod);
    mesh_edit_test_mod.addImport("indexed_edit_mesh", indexed_edit_mesh_test_mod);
    const mesh_edit_test = b.addTest(.{
        .name = "mesh-edit-test",
        .root_module = mesh_edit_test_mod,
    });
    const run_mesh_edit_test = b.addRunArtifact(mesh_edit_test);
    // The impl module's own inline tests (mirror twins, follow, weld) only run when the
    // module is a test ROOT — tests never cross a module import boundary, so without
    // this target they silently ran nowhere (found via req_3795).
    const mesh_edit_impl_test = b.addTest(.{
        .name = "mesh-edit-impl-test",
        .root_module = mesh_edit_impl_test_mod,
    });
    const run_mesh_edit_impl_test = b.addRunArtifact(mesh_edit_impl_test);
    const indexed_edit_mesh_test = b.addTest(.{
        .name = "indexed-edit-mesh-test",
        .root_module = indexed_edit_mesh_test_mod,
    });
    const run_indexed_edit_mesh_test = b.addRunArtifact(indexed_edit_mesh_test);
    const multi_edge_bevel_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/multi_edge_bevel.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    multi_edge_bevel_test_mod.addImport("indexed_edit_mesh", indexed_edit_mesh_test_mod);
    const multi_edge_bevel_test = b.addTest(.{
        .name = "multi-edge-bevel-test",
        .root_module = multi_edge_bevel_test_mod,
    });
    const run_multi_edge_bevel_test = b.addRunArtifact(multi_edge_bevel_test);
    const multi_edge_split_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/multi_edge_split.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    multi_edge_split_test_mod.addImport("indexed_edit_mesh", indexed_edit_mesh_test_mod);
    const multi_edge_split_test = b.addTest(.{
        .name = "multi-edge-split-test",
        .root_module = multi_edge_split_test_mod,
    });
    const run_multi_edge_split_test = b.addRunArtifact(multi_edge_split_test);
    const character_topology_promotion_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/character_topology_promotion.zig"),
        .target = target,
        .optimize = optimize,
    });
    const character_topology_promotion_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/character_topology_promotion.zig"),
        .target = target,
        .optimize = optimize,
    });
    character_topology_promotion_test_mod.addImport("character_topology_promotion", character_topology_promotion_mod);
    const character_topology_promotion_test = b.addTest(.{
        .name = "character-topology-promotion-test",
        .root_module = character_topology_promotion_test_mod,
    });
    const run_character_topology_promotion_test = b.addRunArtifact(character_topology_promotion_test);
    const mesh_edit_test_step = b.step("test-mesh-edit", "Run the mesh-edit welding/selection unit tests");
    mesh_edit_test_step.dependOn(&run_mesh_edit_test.step);
    mesh_edit_test_step.dependOn(&run_mesh_edit_impl_test.step);
    mesh_edit_test_step.dependOn(&run_indexed_edit_mesh_test.step);
    mesh_edit_test_step.dependOn(&run_multi_edge_bevel_test.step);
    mesh_edit_test_step.dependOn(&run_multi_edge_split_test.step);
    mesh_edit_test_step.dependOn(&run_character_topology_promotion_test.step);

    // ── mesh journal log (history ownership diagnostics + JSON) unit tests ─
    const mesh_journal_log_impl_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_journal_log.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const mesh_journal_log_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/mesh_journal_log.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_journal_log_test_mod.addImport("mesh_journal_log", mesh_journal_log_impl_test_mod);
    const mesh_journal_log_test = b.addTest(.{
        .name = "mesh-journal-log-test",
        .root_module = mesh_journal_log_test_mod,
    });
    const run_mesh_journal_log_test = b.addRunArtifact(mesh_journal_log_test);
    const mesh_journal_log_test_step = b.step("test-mesh-journal-log", "Run the mesh journal ownership/log tests");
    mesh_journal_log_test_step.dependOn(&run_mesh_journal_log_test.step);

    // ── paint ops (stroke-program fill dedupe helpers) unit tests ─
    const paint_ops_impl_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/paint_ops.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const paint_ops_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/paint_ops.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    paint_ops_test_mod.addImport("paint_ops", paint_ops_impl_test_mod);
    const paint_ops_test = b.addTest(.{
        .name = "paint-ops-test",
        .root_module = paint_ops_test_mod,
    });
    const run_paint_ops_test = b.addRunArtifact(paint_ops_test);
    const paint_ops_test_step = b.step("test-paint-ops", "Run the paint op-stream dedupe helper tests");
    paint_ops_test_step.dependOn(&run_paint_ops_test.step);

    // ── path array (constant-radius turn + elevation profile) unit tests ─────
    const path_array_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/path_array.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    path_array_test_mod.addImport("path_array", b.createModule(.{
        .root_source_file = b.path("framework/gpu/path_array.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    }));
    const path_array_test = b.addTest(.{
        .name = "path-array-test",
        .root_module = path_array_test_mod,
    });
    const run_path_array_test = b.addRunArtifact(path_array_test);
    const path_array_test_step = b.step("test-path-array", "Run the model path-array geometry tests");
    path_array_test_step.dependOn(&run_path_array_test.step);

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
    gpu_attribution_test.root_module.linkSystemLibrary("freetype", .{});
    const run_gpu_attribution_test = b.addRunArtifact(gpu_attribution_test);
    const gpu_attribution_test_step = b.step("test-gpu-attribution", "Run GPU attribution unit tests");
    gpu_attribution_test_step.dependOn(&run_gpu_attribution_test.step);

    // Retained static-instance source/reservation policy. Keep this pure test
    // separate from WebGPU so populated-prefix uploads cannot regress behind a
    // platform/device-dependent render test.
    const static_instance_policy_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/gpu/static_instance_policy.zig"),
        .target = target,
        .optimize = optimize,
    });
    const render3d_static_instances_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/render3d_static_instances.zig"),
        .target = target,
        .optimize = optimize,
    });
    render3d_static_instances_test_mod.addImport("static_instance_policy", static_instance_policy_mod_for_tests);
    const render3d_static_instances_test = b.addTest(.{
        .name = "render3d-static-instances-test",
        .root_module = render3d_static_instances_test_mod,
    });
    const run_render3d_static_instances_test = b.addRunArtifact(render3d_static_instances_test);
    const render3d_static_instances_test_step = b.step("test-render3d-static-instances", "Run retained static-instance policy tests");
    render3d_static_instances_test_step.dependOn(&run_render3d_static_instances_test.step);

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

    // ── Semantic building architecture contract tests ──────────────
    // Pure allocator/math coverage follows the neighboring game-physics target:
    // no blocking capability is used, so no std.Io is manufactured or injected.
    const building_architecture_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/game/building_architecture.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const wall_types_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/game/wall_types.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    wall_types_mod_for_tests.addImport("architecture_scale", architecture_scale_mod);
    const building_catalog_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/game/building_catalog.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    building_catalog_mod_for_tests.addImport("architecture_scale", architecture_scale_mod);
    building_catalog_mod_for_tests.addImport("wall_types", wall_types_mod_for_tests);
    const building_architecture_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/building_architecture.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const wall_topology_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/game/wall_topology.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    wall_topology_mod_for_tests.addImport("wall_types", wall_types_mod_for_tests);
    const wall_mutation_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/game/wall_mutation.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    wall_mutation_mod_for_tests.addImport("wall_types", wall_types_mod_for_tests);
    wall_mutation_mod_for_tests.addImport("building_catalog", building_catalog_mod_for_tests);
    wall_mutation_mod_for_tests.addImport("wall_topology", wall_topology_mod_for_tests);
    const wall_geometry_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/game/wall_geometry.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    wall_geometry_mod_for_tests.addImport("wall_types", wall_types_mod_for_tests);
    wall_geometry_mod_for_tests.addImport("architecture_scale", architecture_scale_mod);
    wall_geometry_mod_for_tests.addImport("building_catalog", building_catalog_mod_for_tests);
    wall_geometry_mod_for_tests.addImport("wall_topology", wall_topology_mod_for_tests);
    const wall_compile_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/game/wall_compile.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    wall_compile_mod_for_tests.addImport("wall_types", wall_types_mod_for_tests);
    wall_compile_mod_for_tests.addImport("building_catalog", building_catalog_mod_for_tests);
    wall_compile_mod_for_tests.addImport("wall_geometry", wall_geometry_mod_for_tests);
    wall_compile_mod_for_tests.addImport("wall_topology", wall_topology_mod_for_tests);
    const architecture_wire_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/game/architecture_wire.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    building_architecture_mod_for_tests.addImport("architecture_scale", architecture_scale_mod);
    building_architecture_mod_for_tests.addImport("wall_types", wall_types_mod_for_tests);
    building_architecture_mod_for_tests.addImport("building_catalog", building_catalog_mod_for_tests);
    building_architecture_mod_for_tests.addImport("wall_topology", wall_topology_mod_for_tests);
    building_architecture_mod_for_tests.addImport("wall_mutation", wall_mutation_mod_for_tests);
    building_architecture_mod_for_tests.addImport("wall_compile", wall_compile_mod_for_tests);
    architecture_wire_mod_for_tests.addImport("building_architecture", building_architecture_mod_for_tests);
    building_architecture_test_mod.addImport("building_architecture", building_architecture_mod_for_tests);
    building_architecture_test_mod.addImport("wall_topology", wall_topology_mod_for_tests);
    building_architecture_test_mod.addImport("wall_mutation", wall_mutation_mod_for_tests);
    building_architecture_test_mod.addImport("wall_geometry", wall_geometry_mod_for_tests);
    building_architecture_test_mod.addImport("wall_compile", wall_compile_mod_for_tests);
    building_architecture_test_mod.addImport("architecture_wire", architecture_wire_mod_for_tests);
    const building_architecture_test = b.addTest(.{
        .name = "building-architecture-test",
        .root_module = building_architecture_test_mod,
    });
    const run_building_architecture_test = b.addRunArtifact(building_architecture_test);
    const building_architecture_test_step = b.step("test-building-architecture", "Run semantic building architecture contract tests");
    building_architecture_test_step.dependOn(&run_building_architecture_test.step);

    const game_mesh_collision_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/game_mesh_collision.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    game_mesh_collision_test_mod.addImport("game_physics", game_physics_mod_for_tests);
    const game_mesh_collision_test = b.addTest(.{
        .name = "game-mesh-collision-test",
        .root_module = game_mesh_collision_test_mod,
    });
    const run_game_mesh_collision_test = b.addRunArtifact(game_mesh_collision_test);
    const game_mesh_collision_test_step = b.step("test-game-mesh-collision", "Run exact resident-mesh collision tests");
    game_mesh_collision_test_step.dependOn(&run_game_mesh_collision_test.step);

    // ── Mesh audit facts (req_3749) ────────────────────────────────
    // framework/gpu/mesh_audit.zig counts penetrating and unreachable
    // triangles for the seat percept. Pure math over the resident vertex
    // buffer — no GPU, no SDL, no V8 — so it tests standalone.
    const mesh_audit_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_audit.zig"),
        .target = target,
        .optimize = optimize,
    });
    const mesh_audit_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/mesh_audit.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_audit_test_mod.addImport("mesh_audit", mesh_audit_mod_for_tests);
    const mesh_audit_test = b.addTest(.{
        .name = "mesh-audit-test",
        .root_module = mesh_audit_test_mod,
    });
    const run_mesh_audit_test = b.addRunArtifact(mesh_audit_test);
    const mesh_audit_test_step = b.step("test-mesh-audit", "Run penetrating/unreachable triangle fact tests");
    mesh_audit_test_step.dependOn(&run_mesh_audit_test.step);

    // ── Authored-face recovery table (resident/saved/preview facts) ──────
    const mesh_face_table_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_face_table.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const mesh_face_table_fixtures_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/fixtures/mesh_face_table_fixtures.zig"),
        .target = target,
        .optimize = optimize,
    });
    const mesh_face_table_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/mesh_face_table.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_face_table_test_mod.addImport("mesh_face_table", mesh_face_table_mod_for_tests);
    mesh_face_table_test_mod.addImport("mesh_face_table_fixtures", mesh_face_table_fixtures_mod);
    const mesh_face_table_test = b.addTest(.{
        .name = "mesh-face-table-test",
        .root_module = mesh_face_table_test_mod,
    });
    const run_mesh_face_table_test = b.addRunArtifact(mesh_face_table_test);
    const mesh_face_table_saved_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_face_table_saved.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const mesh_face_table_saved_fixtures_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/fixtures/mesh_face_table_saved_fixtures.zig"),
        .target = target,
        .optimize = optimize,
    });
    const mesh_face_table_package_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_face_table_package.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const mesh_face_table_saved_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/mesh_face_table_saved.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_face_table_saved_test_mod.addImport("mesh_face_table_saved", mesh_face_table_saved_mod_for_tests);
    mesh_face_table_saved_test_mod.addImport("mesh_face_table_saved_fixtures", mesh_face_table_saved_fixtures_mod);
    const mesh_face_table_saved_test = b.addTest(.{
        .name = "mesh-face-table-saved-test",
        .root_module = mesh_face_table_saved_test_mod,
    });
    const run_mesh_face_table_saved_test = b.addRunArtifact(mesh_face_table_saved_test);
    const mesh_face_field_candidate_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_face_field_candidate.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const mesh_face_field_candidate_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/mesh_face_field_candidate.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_face_field_candidate_test_mod.addImport("mesh_face_field_candidate", mesh_face_field_candidate_mod_for_tests);
    const mesh_face_field_candidate_test = b.addTest(.{
        .name = "mesh-face-field-candidate-test",
        .root_module = mesh_face_field_candidate_test_mod,
    });
    const run_mesh_face_field_candidate_test = b.addRunArtifact(mesh_face_field_candidate_test);
    const mesh_face_table_worker_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_face_table_worker.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const mesh_face_table_worker_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/mesh_face_table_worker.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_face_table_worker_test_mod.addImport("mesh_face_table_worker", mesh_face_table_worker_mod_for_tests);
    mesh_face_table_worker_test_mod.addImport("mesh_face_table_saved_fixtures", mesh_face_table_saved_fixtures_mod);
    const mesh_face_table_worker_test = b.addTest(.{
        .name = "mesh-face-table-worker-test",
        .root_module = mesh_face_table_worker_test_mod,
    });
    const run_mesh_face_table_worker_test = b.addRunArtifact(mesh_face_table_worker_test);
    const mesh_face_table_package_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/mesh_face_table_package.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_face_table_package_test_mod.addImport("mesh_face_table_package", mesh_face_table_package_mod_for_tests);
    mesh_face_table_package_test_mod.addImport("mesh_face_table_saved_fixtures", mesh_face_table_saved_fixtures_mod);
    const mesh_face_table_package_test = b.addTest(.{
        .name = "mesh-face-table-package-test",
        .root_module = mesh_face_table_package_test_mod,
    });
    const run_mesh_face_table_package_test = b.addRunArtifact(mesh_face_table_package_test);
    const mesh_face_diff_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_face_diff.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const mesh_face_diff_fixtures_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/fixtures/mesh_face_diff_fixtures.zig"),
        .target = target,
        .optimize = optimize,
    });
    mesh_face_diff_fixtures_mod.addImport("mesh_face_diff", mesh_face_diff_mod_for_tests);
    const mesh_face_diff_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/mesh_face_diff.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_face_diff_test_mod.addImport("mesh_face_diff", mesh_face_diff_mod_for_tests);
    mesh_face_diff_test_mod.addImport("mesh_face_diff_fixtures", mesh_face_diff_fixtures_mod);
    const mesh_face_diff_test = b.addTest(.{
        .name = "mesh-face-diff-test",
        .root_module = mesh_face_diff_test_mod,
    });
    const run_mesh_face_diff_test = b.addRunArtifact(mesh_face_diff_test);
    const mesh_face_restore_proof_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_face_restore_proof.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const mesh_face_restore_proof_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/mesh_face_restore_proof.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    mesh_face_restore_proof_test_mod.addImport("mesh_face_restore_proof", mesh_face_restore_proof_mod_for_tests);
    mesh_face_restore_proof_test_mod.addImport("mesh_face_table_saved_fixtures", mesh_face_table_saved_fixtures_mod);
    const mesh_face_restore_proof_test = b.addTest(.{
        .name = "mesh-face-restore-proof-test",
        .root_module = mesh_face_restore_proof_test_mod,
    });
    const run_mesh_face_restore_proof_test = b.addRunArtifact(mesh_face_restore_proof_test);
    const model_source_recovery_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/model_source.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const model_source_recovery_test = b.addTest(.{
        .name = "model-source-recovery-test",
        .root_module = model_source_recovery_test_mod,
    });
    const run_model_source_recovery_test = b.addRunArtifact(model_source_recovery_test);
    const model_source_session_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/model_source_session.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    model_source_session_test_mod.addImport("model_source", model_source_recovery_test_mod);
    const model_source_session_test = b.addTest(.{
        .name = "model-source-session-test",
        .root_module = model_source_session_test_mod,
    });
    const run_model_source_session_test = b.addRunArtifact(model_source_session_test);
    const model_source_session_test_step = b.step(
        "test-model-source-session",
        "Run parked model-source ownership tests",
    );
    model_source_session_test_step.dependOn(&run_model_source_session_test.step);
    const historical_preview_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/historical_preview.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const historical_preview_test = b.addTest(.{
        .name = "historical-preview-test",
        .root_module = historical_preview_test_mod,
    });
    const run_historical_preview_test = b.addRunArtifact(historical_preview_test);
    const historical_preview_test_step = b.step("test-historical-preview", "Run isolated historical preview lifecycle tests");
    historical_preview_test_step.dependOn(&run_historical_preview_test.step);
    const mesh_face_table_test_step = b.step("test-mesh-face-table", "Run authored-face recovery table tests");
    mesh_face_table_test_step.dependOn(&run_mesh_face_table_test.step);
    mesh_face_table_test_step.dependOn(&run_mesh_face_table_saved_test.step);
    mesh_face_table_test_step.dependOn(&run_mesh_face_field_candidate_test.step);
    mesh_face_table_test_step.dependOn(&run_mesh_face_table_worker_test.step);
    mesh_face_table_test_step.dependOn(&run_mesh_face_table_package_test.step);
    mesh_face_table_test_step.dependOn(&run_mesh_face_diff_test.step);
    mesh_face_table_test_step.dependOn(&run_mesh_face_restore_proof_test.step);
    mesh_face_table_test_step.dependOn(&run_model_source_recovery_test.step);
    mesh_face_table_test_step.dependOn(&run_model_source_session_test.step);
    mesh_face_table_test_step.dependOn(&run_historical_preview_test.step);

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
        // The self-hosted x86_64 Debug backend miscompiles the A*
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

    // ── Split world-loader procedural geometry parity ──────────────────
    // The replacement loader is assembled from framework/world_loader/*.zig.
    // Pin the pure mesh vocabulary at its owning Zig layer so a later move or
    // cleanup cannot silently change the retained geometry sent to gpu/3d.zig.
    const world_loader_geometry_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/world_loader/geometry.zig"),
        .target = target,
        .optimize = optimize,
    });
    const world_loader_geometry_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/world_loader_geometry.zig"),
        .target = target,
        .optimize = optimize,
    });
    world_loader_geometry_test_mod.addImport("world_loader_geometry", world_loader_geometry_mod_for_tests);
    const world_loader_geometry_test = b.addTest(.{
        .name = "world-loader-geometry-test",
        .root_module = world_loader_geometry_test_mod,
    });
    const run_world_loader_geometry_test = b.addRunArtifact(world_loader_geometry_test);
    const world_loader_paint_revision_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/world_loader/paint_revision.zig"),
        .target = target,
        .optimize = optimize,
    });
    const world_loader_paint_revision_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/world_loader_paint_revision.zig"),
        .target = target,
        .optimize = optimize,
    });
    world_loader_paint_revision_test_mod.addImport("world_loader_paint_revision", world_loader_paint_revision_mod_for_tests);
    const world_loader_paint_revision_test = b.addTest(.{
        .name = "world-loader-paint-revision-test",
        .root_module = world_loader_paint_revision_test_mod,
    });
    const run_world_loader_paint_revision_test = b.addRunArtifact(world_loader_paint_revision_test);
    const terrain_grid_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/gpu/terrain_grid.zig"),
        .target = target,
        .optimize = optimize,
    });
    const terrain_grid_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/terrain_grid.zig"),
        .target = target,
        .optimize = optimize,
    });
    terrain_grid_test_mod.addImport("terrain_grid", terrain_grid_mod_for_tests);
    const terrain_grid_test = b.addTest(.{
        .name = "terrain-grid-test",
        .root_module = terrain_grid_test_mod,
    });
    const run_terrain_grid_test = b.addRunArtifact(terrain_grid_test);
    const world_streaming_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/world/streaming.zig"),
        .target = target,
        .optimize = optimize,
    });
    const world_streaming_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/world_streaming.zig"),
        .target = target,
        .optimize = optimize,
    });
    world_streaming_test_mod.addImport("world_streaming", world_streaming_mod_for_tests);
    const world_streaming_test = b.addTest(.{
        .name = "world-streaming-test",
        .root_module = world_streaming_test_mod,
    });
    const run_world_streaming_test = b.addRunArtifact(world_streaming_test);
    const world_streaming_test_step = b.step("test-world-streaming", "Run world active-bubble streaming tests");
    world_streaming_test_step.dependOn(&run_world_streaming_test.step);
    const world_loader_character_specimens_mod = b.createModule(.{
        .root_source_file = b.path("framework/world_loader_character_specimens_module.zig"),
        .target = target,
        .optimize = optimize,
    });
    const world_loader_character_specimens_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/world_loader_character_specimens.zig"),
        .target = target,
        .optimize = optimize,
    });
    world_loader_character_specimens_test_mod.addImport(
        "world_loader_character_specimens",
        world_loader_character_specimens_mod,
    );
    const world_loader_character_specimens_test = b.addTest(.{
        .name = "world-loader-character-specimens-test",
        .root_module = world_loader_character_specimens_test_mod,
    });
    const run_world_loader_character_specimens_test = b.addRunArtifact(world_loader_character_specimens_test);
    const world_loader_geometry_test_step = b.step("test-world-loader", "Run split world-loader geometry and map-revision tests");
    world_loader_geometry_test_step.dependOn(&run_world_loader_geometry_test.step);
    world_loader_geometry_test_step.dependOn(&run_world_loader_paint_revision_test.step);
    world_loader_geometry_test_step.dependOn(&run_terrain_grid_test.step);
    world_loader_geometry_test_step.dependOn(&run_world_streaming_test.step);
    world_loader_geometry_test_step.dependOn(&run_world_loader_character_specimens_test.step);

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

    const world_mesh_prop_uv_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/world/mesh_prop_uv.zig"),
        .target = target,
        .optimize = optimize,
    });
    const world_mesh_prop_uv_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/world_mesh_prop_uv.zig"),
        .target = target,
        .optimize = optimize,
    });
    world_mesh_prop_uv_test_mod.addImport("world_mesh_prop_uv", world_mesh_prop_uv_mod_for_tests);
    const world_mesh_prop_uv_test = b.addTest(.{
        .name = "world-mesh-prop-uv-test",
        .root_module = world_mesh_prop_uv_test_mod,
    });
    const run_world_mesh_prop_uv_test = b.addRunArtifact(world_mesh_prop_uv_test);
    const world_mesh_prop_uv_test_step = b.step("test-world-mesh-prop-uv", "Run resident face-material UV tests");
    world_mesh_prop_uv_test_step.dependOn(&run_world_mesh_prop_uv_test.step);

    const world_mesh_prop_collision_wire_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/world/mesh_prop_collision_wire.zig"),
        .target = target,
        .optimize = optimize,
    });
    const world_mesh_prop_collision_wire_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/world_mesh_prop_collision_wire.zig"),
        .target = target,
        .optimize = optimize,
    });
    world_mesh_prop_collision_wire_test_mod.addImport("world_mesh_prop_collision_wire", world_mesh_prop_collision_wire_mod_for_tests);
    const world_mesh_prop_collision_wire_test = b.addTest(.{
        .name = "world-mesh-prop-collision-wire-test",
        .root_module = world_mesh_prop_collision_wire_test_mod,
    });
    const run_world_mesh_prop_collision_wire_test = b.addRunArtifact(world_mesh_prop_collision_wire_test);
    const world_mesh_prop_collision_wire_test_step = b.step("test-world-mesh-prop-collision-wire", "Run resident exact-collision wire tests");
    world_mesh_prop_collision_wire_test_step.dependOn(&run_world_mesh_prop_collision_wire_test.step);

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

    // Authoring eventbus behavior tests. Root this test at framework/ so the
    // bus and SQLite stay in one module when their production relative import
    // is compiled; a named SQLite test module would duplicate that source.
    const editor_bus_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing_editor_bus.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
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

    // Saved logical-vertex skin bindings remain inspectable at full f32
    // precision; GPU palette rows are derived only at the upload boundary.
    const skin_binding_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/skeleton/skin_binding.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const skin_binding_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/skin_binding.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    skin_binding_test_mod.addImport("skin_binding", skin_binding_mod_t);
    const skin_binding_test = b.addTest(.{
        .name = "skin-binding-test",
        .root_module = skin_binding_test_mod,
    });
    b.step("test-skin-binding", "Run saved logical-vertex skin binding tests")
        .dependOn(&b.addRunArtifact(skin_binding_test).step);

    // The offline catalog guard must use the same native reader/writer as the
    // editor host door. This target proves old valid envelopes re-encode through
    // that codec as truthful v5 without inventing logical topology.
    const model_blob_edge_semantics_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_edge_semantics.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const model_blob_meshdoc_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/meshdoc_format.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    model_blob_meshdoc_mod.addImport("mesh_edge_semantics.zig", model_blob_edge_semantics_mod);
    const model_blob_mesh_edit_mod = b.createModule(.{
        .root_source_file = b.path("framework/gpu/mesh_edit.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    // mesh_edit's model_source dependency names this relative import. Route it
    // to the exact module instance used by the RJMD guard so Zig never compiles
    // the production format owner twice in one executable.
    model_blob_mesh_edit_mod.addImport("meshdoc_format.zig", model_blob_meshdoc_mod);
    model_blob_mesh_edit_mod.addImport("mesh_edge_semantics.zig", model_blob_edge_semantics_mod);
    const model_blob_codec_mod = b.createModule(.{
        .root_source_file = b.path("framework/tools/model_blob_codec.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    model_blob_codec_mod.addImport("meshdoc", model_blob_meshdoc_mod);
    model_blob_codec_mod.addImport("mesh_edit", model_blob_mesh_edit_mod);
    model_blob_codec_mod.addImport("skin_binding", skin_binding_mod_t);
    const model_blob_codec_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/model_blob_codec.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    model_blob_codec_test_mod.addImport("model_blob_codec", model_blob_codec_mod);
    model_blob_codec_test_mod.addImport("meshdoc", model_blob_meshdoc_mod);
    model_blob_codec_test_mod.addImport("mesh_edit", model_blob_mesh_edit_mod);
    model_blob_codec_test_mod.addImport("skin_binding", skin_binding_mod_t);
    const model_blob_codec_test = b.addTest(.{
        .name = "model-blob-codec-test",
        .root_module = model_blob_codec_test_mod,
    });
    b.step("test-model-blob-codec", "Run native model catalog guard codec tests")
        .dependOn(&b.addRunArtifact(model_blob_codec_test).step);

    // Logical-topology body/deformable/rigid binding. This target pins the
    // 96-cell voxel solve, semantic cores, welded transitions, object-local
    // adjacency, and exact rigid rows without position-weld discovery.
    const autoweights_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/skeleton/autoweights.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const autoweights_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/autoweights.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    autoweights_test_mod.addImport("autoweights", autoweights_mod_t);
    const autoweights_test = b.addTest(.{
        .name = "autoweights-test",
        .root_module = autoweights_test_mod,
    });
    b.step("test-autoweights", "Run logical-topology automatic skin-weight tests")
        .dependOn(&b.addRunArtifact(autoweights_test).step);

    // Read-only logical-weight summaries and model-X mirror diagnostics remain
    // disjoint from the resident rig session and never repair authoring data.
    const rig_weight_diagnostics_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/skeleton/rig_weight_diagnostics.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const rig_weight_diagnostics_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/rig_weight_diagnostics.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    rig_weight_diagnostics_test_mod.addImport("rig_weight_diagnostics", rig_weight_diagnostics_mod_t);
    const rig_weight_diagnostics_test = b.addTest(.{
        .name = "rig-weight-diagnostics-test",
        .root_module = rig_weight_diagnostics_test_mod,
    });
    b.step("test-rig-weight-diagnostics", "Run logical skin-weight diagnostic tests")
        .dependOn(&b.addRunArtifact(rig_weight_diagnostics_test).step);

    // Read-only deformation quality facts consume the exact logical f32 rows
    // and already-evaluated LBS matrices, without owning the resident session.
    const rig_bend_diagnostics_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/rig_bend_diagnostics_module.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const rig_bend_diagnostics_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/rig_bend_diagnostics.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    rig_bend_diagnostics_test_mod.addImport("rig_bend_diagnostics", rig_bend_diagnostics_mod_t);
    const rig_bend_diagnostics_test = b.addTest(.{
        .name = "rig-bend-diagnostics-test",
        .root_module = rig_bend_diagnostics_test_mod,
    });
    b.step("test-rig-bend-diagnostics", "Run logical LBS bend diagnostic tests")
        .dependOn(&b.addRunArtifact(rig_bend_diagnostics_test).step);

    // Hierarchical local-quaternion FK, constraints, and inverse-bind output.
    const rig_pose_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/skeleton/rig_pose.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const rig_pose_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/rig_pose.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    rig_pose_test_mod.addImport("rig_pose", rig_pose_mod_t);
    const rig_pose_test = b.addTest(.{
        .name = "rig-pose-test",
        .root_module = rig_pose_test_mod,
    });
    b.step("test-rig-pose", "Run hierarchical character rig pose tests")
        .dependOn(&b.addRunArtifact(rig_pose_test).step);

    const humanoid_fit_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/skeleton/humanoid_fit.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const rig_fit_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/rig_fit.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    rig_fit_test_mod.addImport("humanoid_fit", humanoid_fit_mod_t);
    const rig_fit_test = b.addTest(.{
        .name = "rig-fit-test",
        .root_module = rig_fit_test_mod,
    });
    b.step("test-rig-fit", "Run semantic-boundary humanoid fitting tests")
        .dependOn(&b.addRunArtifact(rig_fit_test).step);

    // Strict body-connectivity stays topology-authored, while diagnostics expose
    // the exact detached lowered faces/groups for an explicit editor repair.
    const character_topology_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/character_topology_module.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const character_topology_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/character_topology.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    character_topology_test_mod.addImport("character_topology", character_topology_mod_t);
    const character_topology_test = b.addTest(.{
        .name = "character-topology-test",
        .root_module = character_topology_test_mod,
    });
    b.step("test-character-topology", "Run strict character topology diagnostic tests")
        .dependOn(&b.addRunArtifact(character_topology_test).step);

    // Runtime character construction is a strict saved-artifact boundary:
    // draft/stale rigs are rejected, range IDs come from RJMD, and no weight
    // solver is reachable from the loader.
    const character_assets_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/character_assets_module.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const character_assets_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/character_assets.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    character_assets_test_mod.addImport("character_assets", character_assets_mod_t);
    const character_assets_test = b.addTest(.{
        .name = "character-assets-test",
        .root_module = character_assets_test_mod,
    });
    const player_assets_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/player_assets_module.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const player_assets_test = b.addTest(.{
        .name = "player-assets-test",
        .root_module = player_assets_test_mod,
    });
    const character_assets_test_step = b.step("test-character-assets", "Run strict saved-character runtime loader tests");
    character_assets_test_step.dependOn(&b.addRunArtifact(character_assets_test).step);
    character_assets_test_step.dependOn(&b.addRunArtifact(player_assets_test).step);

    // Saved stride-16 LBS rows yield a separate static bind specimen without
    // carrying joints, weights, or a palette into the diagnostic render node.
    const character_specimen_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/character_specimen_module.zig"),
        .target = target,
        .optimize = optimize,
    });
    const character_specimen_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/character_specimen.zig"),
        .target = target,
        .optimize = optimize,
    });
    character_specimen_test_mod.addImport("character_specimen", character_specimen_mod_t);
    const character_specimen_test = b.addTest(.{
        .name = "character-specimen-test",
        .root_module = character_specimen_test_mod,
    });
    b.step("test-character-specimen", "Run static bind-character specimen extraction tests")
        .dependOn(&b.addRunArtifact(character_specimen_test).step);

    // Mounted NPC instances use the same strict saved CharacterAsset loader,
    // with explicit transforms, revision ownership, and independent FK state.
    const npc_character_session_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/npc_character_session_module.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const npc_character_session_test = b.addTest(.{
        .name = "npc-character-session-test",
        .root_module = npc_character_session_test_mod,
    });
    b.step("test-npc-character-session", "Run strict mounted NPC character session tests")
        .dependOn(&b.addRunArtifact(npc_character_session_test).step);

    // One revisioned editor character-rig door. The module root stays at
    // framework/ because the deep boundary consumes both resident GPU
    // snapshots and skeleton-side fitting/binding services.
    const character_rig_session_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/character_rig_session_module.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const character_rig_session_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/character_rig_session.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    character_rig_session_test_mod.addImport("character_rig_session", character_rig_session_mod_t);
    const character_rig_session_test = b.addTest(.{
        .name = "character-rig-session-test",
        .root_module = character_rig_session_test_mod,
    });
    b.step("test-character-rig-session", "Run revisioned character rig session tests")
        .dependOn(&b.addRunArtifact(character_rig_session_test).step);

    const pose_stream_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/skeleton/pose_stream.zig"),
        .target = target,
        .optimize = optimize,
    });
    const pose_stream_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/pose_stream.zig"),
        .target = target,
        .optimize = optimize,
    });
    pose_stream_test_mod.addImport("pose_stream", pose_stream_mod_t);
    const pose_stream_test = b.addTest(.{ .name = "pose-stream-test", .root_module = pose_stream_test_mod });
    b.step("test-pose-stream", "Run render-rate live-pose interpolation tests")
        .dependOn(&b.addRunArtifact(pose_stream_test).step);

    const humanoid_clips_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/skeleton/humanoid_clips.zig"),
        .target = target,
        .optimize = optimize,
    });
    const humanoid_clips_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/humanoid_clips.zig"),
        .target = target,
        .optimize = optimize,
    });
    humanoid_clips_test_mod.addImport("humanoid_clips", humanoid_clips_mod_t);
    const humanoid_clips_test = b.addTest(.{ .name = "humanoid-clips-test", .root_module = humanoid_clips_test_mod });
    b.step("test-humanoid-clips", "Run canonical local-quaternion character clip tests")
        .dependOn(&b.addRunArtifact(humanoid_clips_test).step);

    const motion_document_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/skeleton/motion_document.zig"),
        .target = target,
        .optimize = optimize,
    });
    const motion_document_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/motion_document.zig"),
        .target = target,
        .optimize = optimize,
    });
    motion_document_test_mod.addImport("motion_document", motion_document_mod_t);
    const motion_document_test = b.addTest(.{ .name = "motion-document-test", .root_module = motion_document_test_mod });
    b.step("test-motion-document", "Run RJAN role-addressed motion document tests")
        .dependOn(&b.addRunArtifact(motion_document_test).step);

    const motion_document_json_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/skeleton/motion_document_json.zig"),
        .target = target,
        .optimize = optimize,
    });
    const motion_document_json_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/motion_document_json.zig"),
        .target = target,
        .optimize = optimize,
    });
    motion_document_json_test_mod.addImport("motion_document_json", motion_document_json_mod_t);
    const motion_document_json_test = b.addTest(.{ .name = "motion-document-json-test", .root_module = motion_document_json_test_mod });
    b.step("test-motion-document-json", "Run motion document authoring JSON codec tests")
        .dependOn(&b.addRunArtifact(motion_document_json_test).step);

    const player_character_pose_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/player_character_pose_module.zig"),
        .target = target,
        .optimize = optimize,
    });
    const player_character_pose_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/player_character_pose.zig"),
        .target = target,
        .optimize = optimize,
    });
    player_character_pose_test_mod.addImport("player_character_pose", player_character_pose_mod_t);
    const player_character_pose_test = b.addTest(.{ .name = "player-character-pose-test", .root_module = player_character_pose_test_mod });
    b.step("test-player-character-pose", "Run mounted character pose ownership and clip fallback tests")
        .dependOn(&b.addRunArtifact(player_character_pose_test).step);

    const humanoid_retarget_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/skeleton/humanoid_retarget.zig"),
        .target = target,
        .optimize = optimize,
    });
    const retarget_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/retarget.zig"),
        .target = target,
        .optimize = optimize,
    });
    retarget_test_mod.addImport("humanoid_retarget", humanoid_retarget_mod_t);
    const retarget_test = b.addTest(.{
        .name = "retarget-test",
        .root_module = retarget_test_mod,
    });
    b.step("test-retarget", "Run calibrated source-to-target retarget tests")
        .dependOn(&b.addRunArtifact(retarget_test).step);

    // One revisioned capture door: immutable camera leases, strict command
    // revisions, calibration, same-frame promotion, and freeze/resume pinning.
    const capture_session_mod_t = b.createModule(.{
        .root_source_file = b.path("framework/skeleton/capture_session.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const capture_session_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/capture_session.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    capture_session_test_mod.addImport("capture_session", capture_session_mod_t);
    const capture_session_test = b.addTest(.{
        .name = "capture-session-test",
        .root_module = capture_session_test_mod,
    });
    b.step("test-capture-session", "Run native character capture session tests")
        .dependOn(&b.addRunArtifact(capture_session_test).step);

    // Replacement -> cutover -> severance: keep the deleted part-derived
    // character path, runtime solver switch, and old staging doors absent from
    // active editor/runtime/framework implementation sources.
    const character_severance_check = b.addSystemCommand(&.{
        "bash",
        "tools/check-character-severance",
    });
    b.step("test-character-severance", "Reject retired character files, symbols, and staging doors")
        .dependOn(&character_severance_check.step);

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

    // Expected-content comparison at the final atomic source-write boundary.
    // Keep the filesystem contract in a focused headless test target so bridge
    // coverage cannot hide a wrong absent/empty/exact-bytes distinction.
    const fs_core_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/fs/fs.zig"),
        .target = target,
        .optimize = optimize,
    });
    const fs_expected_content_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/fs_expected_content.zig"),
        .target = target,
        .optimize = optimize,
    });
    fs_expected_content_test_mod.addImport("fs_core", fs_core_mod_for_tests);
    const fs_expected_content_test = b.addTest(.{
        .name = "fs-expected-content-test",
        .root_module = fs_expected_content_test_mod,
    });
    const run_fs_expected_content_test = b.addRunArtifact(fs_expected_content_test);
    const fs_expected_content_test_step = b.step("test-fs-expected-content", "Run filesystem expected-content comparison tests");
    fs_expected_content_test_step.dependOn(&run_fs_expected_content_test.step);

    // Platform-native application configuration paths. The resolver is pure;
    // the V8 fs binding only creates the directory returned here.
    const app_config_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/fs/app_config.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const app_config_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/app_config.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    app_config_test_mod.addImport("app_config", app_config_mod_for_tests);
    const app_config_test = b.addTest(.{ .name = "app-config-test", .root_module = app_config_test_mod });
    const run_app_config_test = b.addRunArtifact(app_config_test);
    b.step("test-app-config", "Run application config path tests")
        .dependOn(&run_app_config_test.step);

    const dev_reload_policy_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/dev_reload_policy.zig"),
        .target = target,
        .optimize = optimize,
    });
    const dev_reload_policy_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/dev_reload_policy.zig"),
        .target = target,
        .optimize = optimize,
    });
    dev_reload_policy_test_mod.addImport("dev_reload_policy", dev_reload_policy_mod_for_tests);
    const dev_reload_policy_test = b.addTest(.{ .name = "dev-reload-policy-test", .root_module = dev_reload_policy_test_mod });
    b.step("test-dev-reload-policy", "Run development reload policy tests")
        .dependOn(&b.addRunArtifact(dev_reload_policy_test).step);

    const dev_ipc_queue_mod_for_tests = b.createModule(.{
        .root_source_file = b.path("framework/diag/dev_ipc_queue.zig"),
        .target = target,
        .optimize = optimize,
    });
    const dev_ipc_queue_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/dev_ipc_queue.zig"),
        .target = target,
        .optimize = optimize,
    });
    dev_ipc_queue_test_mod.addImport("dev_ipc_queue", dev_ipc_queue_mod_for_tests);
    const dev_ipc_queue_test = b.addTest(.{
        .name = "dev-ipc-queue-test",
        .root_module = dev_ipc_queue_test_mod,
    });
    b.step("test-dev-ipc-queue", "Run development IPC ownership-transfer tests")
        .dependOn(&b.addRunArtifact(dev_ipc_queue_test).step);

    const dev_module_abi_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/dev_module_abi.zig"),
        .target = target,
        .optimize = optimize,
    });
    const dev_module_loader_mod = b.createModule(.{
        .root_source_file = b.path("framework/dev_modules/loader.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    dev_module_loader_mod.addImport("dev_module_abi", dev_module_abi_mod);

    const valid_scene3d_fixture_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/fixtures/dev_modules/valid_scene3d.zig"),
        .target = target,
        .optimize = optimize,
    });
    valid_scene3d_fixture_mod.addImport("dev_module_abi", dev_module_abi_mod);
    const valid_scene3d_fixture = b.addLibrary(.{
        .name = "rjit-test-valid-scene3d",
        .root_module = valid_scene3d_fixture_mod,
        .linkage = .dynamic,
    });

    const wrong_abi_scene3d_fixture_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/fixtures/dev_modules/wrong_abi_scene3d.zig"),
        .target = target,
        .optimize = optimize,
    });
    wrong_abi_scene3d_fixture_mod.addImport("dev_module_abi", dev_module_abi_mod);
    const wrong_abi_scene3d_fixture = b.addLibrary(.{
        .name = "rjit-test-wrong-abi-scene3d",
        .root_module = wrong_abi_scene3d_fixture_mod,
        .linkage = .dynamic,
    });

    const missing_symbol_fixture_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/fixtures/dev_modules/missing_symbol.zig"),
        .target = target,
        .optimize = optimize,
    });
    const missing_symbol_fixture = b.addLibrary(.{
        .name = "rjit-test-missing-symbol",
        .root_module = missing_symbol_fixture_mod,
        .linkage = .dynamic,
    });

    const dev_module_fixture_paths = b.addOptions();
    dev_module_fixture_paths.addOptionPath("valid_scene3d", valid_scene3d_fixture.getEmittedBin());
    dev_module_fixture_paths.addOptionPath("wrong_abi_scene3d", wrong_abi_scene3d_fixture.getEmittedBin());
    dev_module_fixture_paths.addOptionPath("missing_symbol", missing_symbol_fixture.getEmittedBin());
    dev_module_abi_test_mod.addImport("dev_module_abi", dev_module_abi_mod);
    dev_module_abi_test_mod.addImport("dev_module_loader", dev_module_loader_mod);
    dev_module_abi_test_mod.addOptions("dev_module_fixture_paths", dev_module_fixture_paths);
    dev_module_abi_test_mod.link_libc = true;
    const dev_module_abi_test = b.addTest(.{
        .name = "dev-module-abi-test",
        .root_module = dev_module_abi_test_mod,
    });
    const scene3d_runtime_face_drain_options = b.addOptions();
    scene3d_runtime_face_drain_options.addOption(bool, "dev_native_modules", true);
    scene3d_runtime_face_drain_options.addOption(bool, "dev_scene3d_module", false);
    scene3d_runtime_face_drain_options.addOption(bool, "dev_game_module", false);
    const scene3d_runtime_face_drain_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing_scene3d_runtime_face_drain.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    scene3d_runtime_face_drain_test_mod.addImport("dev_module_abi", dev_module_abi_mod);
    scene3d_runtime_face_drain_test_mod.addImport("wgpu", wgpu_mod);
    scene3d_runtime_face_drain_test_mod.addOptions("build_options", scene3d_runtime_face_drain_options);
    const scene3d_runtime_face_drain_test = b.addTest(.{
        .name = "scene3d-runtime-face-drain-test",
        .root_module = scene3d_runtime_face_drain_test_mod,
    });
    const dev_module_abi_test_step = b.step("test-dev-module-abi", "Run native development module ABI and loader tests");
    dev_module_abi_test_step.dependOn(&b.addRunArtifact(dev_module_abi_test).step);
    dev_module_abi_test_step.dependOn(&b.addRunArtifact(scene3d_runtime_face_drain_test).step);

    // Assistant task ownership and cancellation. Root at framework/ so the
    // assistant modules' sibling imports remain in one module.
    const assistant_io_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing_assistant_io.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const assistant_io_test = b.addTest(.{
        .name = "assistant-io-test",
        .root_module = assistant_io_test_mod,
    });
    b.step("test-assistant-io", "Run assistant native-I/O ownership tests")
        .dependOn(&b.addRunArtifact(assistant_io_test).step);

    const pty_io_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/terminal/pty.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const pty_io_test = b.addTest(.{
        .name = "pty-io-test",
        .root_module = pty_io_test_mod,
    });
    b.step("test-pty-io", "Run PTY native-I/O ownership tests")
        .dependOn(&b.addRunArtifact(pty_io_test).step);

    // Resident model recovery must compile and execute against the exact
    // vendored Lore ABI used by the editor host doors. The test remains
    // read-only: the mutating cold-process round trip is an explicit gate.
    const lore_snapshot_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing_lore_snapshot.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const lore_snapshot_test = b.addTest(.{
        .name = "lore-snapshot-test",
        .root_module = lore_snapshot_test_mod,
    });
    lore_snapshot_test.root_module.addIncludePath(b.path("deps/lore/include"));
    lore_snapshot_test.root_module.addLibraryPath(b.path("deps/lore/lib"));
    lore_snapshot_test.root_module.linkSystemLibrary("lore", .{});
    lore_snapshot_test.root_module.addRPath(b.path("deps/lore/lib"));
    const run_lore_snapshot_test = b.addRunArtifact(lore_snapshot_test);
    run_lore_snapshot_test.setEnvironmentVariable("LD_LIBRARY_PATH", b.pathFromRoot("deps/lore/lib"));
    const lore_status_monitor_impl_mod = b.createModule(.{
        .root_source_file = b.path("framework/vcs/status_monitor.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const lore_status_monitor_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing/unit/status_monitor.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    lore_status_monitor_test_mod.addImport("status_monitor", lore_status_monitor_impl_mod);
    const lore_status_monitor_test = b.addTest(.{
        .name = "lore-status-monitor-test",
        .root_module = lore_status_monitor_test_mod,
    });
    const run_lore_status_monitor_test = b.addRunArtifact(lore_status_monitor_test);
    const lore_snapshot_test_step = b.step("test-lore-snapshot", "Run native resident Lore snapshot boundary tests");
    lore_snapshot_test_step.dependOn(&run_lore_snapshot_test.step);
    lore_snapshot_test_step.dependOn(&run_lore_status_monitor_test.step);
    const recovery_public_boundary_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing_recovery_public_boundary.zig"),
        .target = target,
        .optimize = optimize,
    });
    const recovery_public_boundary_test = b.addTest(.{
        .name = "recovery-public-boundary-test",
        .root_module = recovery_public_boundary_test_mod,
    });
    const run_recovery_public_boundary_test = b.addRunArtifact(recovery_public_boundary_test);
    b.step("test-recovery-public-boundary", "Run Recovery public-door and fallback structural tests")
        .dependOn(&run_recovery_public_boundary_test.step);
    lore_snapshot_test_step.dependOn(&run_recovery_public_boundary_test.step);

    // Guarded face-field edit and historical Restore coordinators compile in
    // the same modular-core shape used by a replaceable Scene3D owner. Tests
    // are contract-only: no live resident, package, or Lore mutation occurs.
    const model_recovery_test_options = b.addOptions();
    model_recovery_test_options.addOption(bool, "dev_native_modules", true);
    model_recovery_test_options.addOption(bool, "dev_scene3d_module", false);
    model_recovery_test_options.addOption(bool, "dev_game_module", false);

    const model_field_edit_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing_model_field_edit.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    model_field_edit_test_mod.addImport("dev_module_abi", dev_module_abi_mod);
    model_field_edit_test_mod.addImport("wgpu", wgpu_mod);
    model_field_edit_test_mod.addOptions("build_options", model_recovery_test_options);
    const model_field_edit_test = b.addTest(.{
        .name = "model-field-edit-test",
        .root_module = model_field_edit_test_mod,
    });
    model_field_edit_test.root_module.addIncludePath(b.path("deps/lore/include"));
    model_field_edit_test.root_module.addLibraryPath(b.path("deps/lore/lib"));
    model_field_edit_test.root_module.linkSystemLibrary("lore", .{});
    model_field_edit_test.root_module.addRPath(b.path("deps/lore/lib"));
    const run_model_field_edit_test = b.addRunArtifact(model_field_edit_test);
    run_model_field_edit_test.setEnvironmentVariable("LD_LIBRARY_PATH", b.pathFromRoot("deps/lore/lib"));
    const model_field_edit_test_step = b.step("test-model-field-edit", "Run guarded face-field coordinator contract tests");
    model_field_edit_test_step.dependOn(&run_model_field_edit_test.step);

    const model_restore_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing_model_restore.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    model_restore_test_mod.addImport("dev_module_abi", dev_module_abi_mod);
    model_restore_test_mod.addImport("wgpu", wgpu_mod);
    model_restore_test_mod.addOptions("build_options", model_recovery_test_options);
    const model_restore_test = b.addTest(.{
        .name = "model-restore-test",
        .root_module = model_restore_test_mod,
    });
    model_restore_test.root_module.addIncludePath(b.path("deps/lore/include"));
    model_restore_test.root_module.addLibraryPath(b.path("deps/lore/lib"));
    model_restore_test.root_module.linkSystemLibrary("lore", .{});
    model_restore_test.root_module.addRPath(b.path("deps/lore/lib"));
    const run_model_restore_test = b.addRunArtifact(model_restore_test);
    run_model_restore_test.setEnvironmentVariable("LD_LIBRARY_PATH", b.pathFromRoot("deps/lore/lib"));
    const model_restore_test_step = b.step("test-model-restore", "Run historical Restore coordinator contract tests");
    model_restore_test_step.dependOn(&run_model_restore_test.step);

    // The broad native recovery gate includes both mutation coordinators so a
    // passing Lore boundary build can never omit their ABI/import closure.
    lore_snapshot_test_step.dependOn(&run_model_field_edit_test.step);
    lore_snapshot_test_step.dependOn(&run_model_restore_test.step);

    const lore_snapshot_live_test_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing_lore_snapshot_live.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const lore_snapshot_live_test = b.addTest(.{
        .name = "lore-snapshot-live-test",
        .root_module = lore_snapshot_live_test_mod,
    });
    lore_snapshot_live_test.root_module.addIncludePath(b.path("deps/lore/include"));
    lore_snapshot_live_test.root_module.addLibraryPath(b.path("deps/lore/lib"));
    lore_snapshot_live_test.root_module.linkSystemLibrary("lore", .{});
    lore_snapshot_live_test.root_module.addRPath(b.path("deps/lore/lib"));
    const run_lore_snapshot_live_test = b.addRunArtifact(lore_snapshot_live_test);
    run_lore_snapshot_live_test.setEnvironmentVariable("LD_LIBRARY_PATH", b.pathFromRoot("deps/lore/lib"));
    b.step("test-lore-snapshot-live", "Run mutating live Lore snapshot durability integration proof")
        .dependOn(&run_lore_snapshot_live_test.step);

    const lore_snapshot_cold_mod = b.createModule(.{
        .root_source_file = b.path("framework/testing_lore_snapshot_cold.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
    });
    const lore_snapshot_cold = b.addExecutable(.{
        .name = "lore-snapshot-cold-proof",
        .root_module = lore_snapshot_cold_mod,
    });
    lore_snapshot_cold.root_module.addIncludePath(b.path("deps/lore/include"));
    lore_snapshot_cold.root_module.addLibraryPath(b.path("deps/lore/lib"));
    lore_snapshot_cold.root_module.linkSystemLibrary("lore", .{});
    lore_snapshot_cold.root_module.addRPath(b.path("deps/lore/lib"));
    const run_lore_snapshot_cold_capture = b.addRunArtifact(lore_snapshot_cold);
    run_lore_snapshot_cold_capture.addArg("capture");
    const cold_token = run_lore_snapshot_cold_capture.addOutputFileArg(b.fmt(
        "lore-cold-token-{x}.json",
        .{b.graph.random_seed},
    ));
    // Capture mutates Lore even though the exact revision token is also a build
    // output. Never let Zig's output cache skip the capture half of this proof.
    run_lore_snapshot_cold_capture.has_side_effects = true;
    run_lore_snapshot_cold_capture.setEnvironmentVariable("LD_LIBRARY_PATH", b.pathFromRoot("deps/lore/lib"));
    const run_lore_snapshot_cold_browse = b.addRunArtifact(lore_snapshot_cold);
    run_lore_snapshot_cold_browse.addArg("browse");
    run_lore_snapshot_cold_browse.addFileArg(cold_token);
    run_lore_snapshot_cold_browse.setEnvironmentVariable("LD_LIBRARY_PATH", b.pathFromRoot("deps/lore/lib"));
    run_lore_snapshot_cold_browse.step.dependOn(&run_lore_snapshot_cold_capture.step);
    b.step("test-lore-snapshot-cold", "Capture and browse a Lore revision in separate processes")
        .dependOn(&run_lore_snapshot_cold_browse.step);

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
