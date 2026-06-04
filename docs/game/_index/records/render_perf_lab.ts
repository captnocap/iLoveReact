import type { DocIndex } from '../types';

export const render_perf_lab: DocIndex = {
  name: 'render_perf_lab',
  file: 'render_perf_lab.md',
  cart: 'cart/render_perf_lab.tsx',
  purpose: ['rendering', 'telemetry', 'debug', 'host_bridge'],
  loc: 331,
  summary:
    'A single-file performance stress cart that creates a grid of live external app captures (usually kitty terminals) via Render surfaces and shows how fps, paint/tick/layout time, GPU counters, node count, and memory change as more captures are added.',
  interfaces: [
    {
      name: 'Render',
      purpose: ['rendering', 'host_bridge'],
      kind: 'component',
      sourceFile: 'runtime/primitives.tsx',
      codeRef: 'runtime/primitives.tsx:876-878',
      description:
        'ReactJIT primitive for external display/app capture surfaces; emits a host node carrying renderSrc. Exported as a direct host element: h(\'Render\', props, props.children).',
      emits: ['render_src node'],
      consumers: ['cart/render_perf_lab.tsx'],
      status: 'live',
    },
    {
      name: 'renderSrc',
      purpose: ['rendering', 'host_bridge'],
      kind: 'data_model',
      sourceFile: 'runtime/host_props.ts',
      codeRef: 'runtime/host_props.ts:84-89',
      description:
        'Host prop string declared in host_props.ts that identifies the source to capture. app:<command> sources are parsed as virtual displays; feeds are matched by exact renderSrc string.',
      status: 'live',
    },
    {
      name: 'useTelemetry',
      purpose: ['telemetry', 'host_bridge'],
      kind: 'hook',
      sourceFile: 'runtime/hooks/useTelemetry.ts',
      codeRef: 'runtime/hooks/useTelemetry.ts:94-115',
      description:
        'Polling hook for host telemetry counters; maps scalar kinds to host fns (lines 94-100) and JSON kinds to host fns (lines 102-115) via callHost. Reads once on mount unless pollMs supplied.',
      consumes: ['getFps', 'getPaintUs', 'getTickUs', 'getLayoutUs', '__tel_node_count', '__tel_gpu'],
      consumers: ['cart/render_perf_lab.tsx'],
      status: 'live',
    },
    {
      name: 'readFile',
      purpose: ['persistence', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'runtime/hooks/fs.ts',
      description:
        'Filesystem read helper that calls host fn __fs_read; returns null if the file does not exist. Used here to read /proc/meminfo.',
      consumes: ['__fs_read'],
      consumers: ['cart/render_perf_lab.tsx'],
      status: 'live',
    },
    {
      name: '__fs_read',
      purpose: ['persistence', 'host_bridge'],
      kind: 'host_fn',
      description: 'Host file-read binding backing readFile in runtime/hooks/fs.ts.',
      consumers: ['runtime/hooks/fs.ts'],
      status: 'live',
    },
    {
      name: '__tel_node_count',
      purpose: ['telemetry', 'host_bridge'],
      kind: 'host_fn',
      description: 'Host telemetry binding returning node count, polled at 1000 ms.',
      consumers: ['runtime/hooks/useTelemetry.ts'],
      status: 'live',
    },
    {
      name: '__tel_gpu',
      purpose: ['telemetry', 'host_bridge'],
      kind: 'host_fn',
      description:
        'Host telemetry binding returning GPU JSON (rect_count, glyph_count, gpu_surface_w, gpu_surface_h), polled at 1000 ms.',
      consumers: ['runtime/hooks/useTelemetry.ts'],
      status: 'live',
    },
    {
      name: 'srcFor',
      purpose: ['rendering', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'cart/render_perf_lab.tsx',
      codeRef: 'cart/render_perf_lab.tsx:43-48',
      description:
        'Returns the exact renderSrc string for each tile: app:kitty with per-tile title (id) plus nonce so tiles do not collapse into one shared feed and refresh respawns all feeds. Appends -e claude in claude mode.',
      status: 'lab',
    },
    {
      name: 'fpsColor',
      purpose: ['telemetry', 'color', 'ui'],
      kind: 'utility',
      sourceFile: 'cart/render_perf_lab.tsx',
      codeRef: 'cart/render_perf_lab.tsx:50-54',
      description:
        'Maps fps to theme tokens: >=55 success, >=30 warning, else error. Colors the toolbar fps, hero fps number, and sparkline bars.',
      status: 'lab',
    },
    {
      name: 'parseMeminfo',
      purpose: ['telemetry', 'format'],
      kind: 'utility',
      sourceFile: 'cart/render_perf_lab.tsx',
      codeRef: 'cart/render_perf_lab.tsx:298-309',
      description: 'Extracts MemTotal and MemAvailable from /proc/meminfo text and converts kB to rounded MB.',
      status: 'lab',
    },
    {
      name: 'Tile',
      purpose: ['rendering', 'ui'],
      kind: 'component',
      sourceFile: 'cart/render_perf_lab.tsx',
      codeRef: 'cart/render_perf_lab.tsx:232-244',
      description:
        'Renders one capture tile: bordered frame, header row with accent dot and tile number, black body, and a Render primitive with renderSrc={srcFor(id, cmd, nonce)}.',
      dependsOn: ['Render', 'srcFor'],
      status: 'lab',
    },
    {
      name: 'Stat',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/render_perf_lab.tsx',
      codeRef: 'cart/render_perf_lab.tsx:247-254',
      description: 'Renders a label/value row in the perf panel.',
      status: 'lab',
    },
    {
      name: 'Sparkline',
      purpose: ['telemetry', 'ui'],
      kind: 'component',
      sourceFile: 'cart/render_perf_lab.tsx',
      codeRef: 'cart/render_perf_lab.tsx:256-278',
      description:
        'Small bar chart over the last 90 history samples; empty state says collecting...; bar height clamped 4-100% from fps/60; each bar uses fpsColor.',
      dependsOn: ['fpsColor'],
      status: 'lab',
    },
    {
      name: 'MemBar',
      purpose: ['telemetry', 'ui'],
      kind: 'component',
      sourceFile: 'cart/render_perf_lab.tsx',
      codeRef: 'cart/render_perf_lab.tsx:282-295',
      description:
        'Renders RAM usage: width usedMb/totalMb, color error if used beyond reserve floor else success, plus a warning marker at ((totalMb - reserveMb)/totalMb)*100.',
      status: 'lab',
    },
    {
      name: 'Btn',
      purpose: ['ui'],
      kind: 'component',
      sourceFile: 'cart/render_perf_lab.tsx',
      codeRef: 'cart/render_perf_lab.tsx:319-331',
      description: 'Styled Pressable; disabled buttons use a no-op handler and opacity 0.4.',
      status: 'lab',
    },
    {
      name: 'render_surfaces (paintSurface)',
      purpose: ['rendering', 'host_bridge'],
      kind: 'module',
      sourceFile: 'framework/render/render_surfaces.zig',
      codeRef: 'framework/render/render_surfaces.zig:1594-1670',
      description:
        'Host implementation owning feed lifecycle: source parsing, Xvfb/app spawn, XShm capture, GPU texture upload, memory guard, and painting. paintSurface creates/activates a feed and queues a textured quad via images.queueQuad; engine.zig calls it for nodes with render_src (engine.zig:2605-2608).',
      consumes: ['/proc/meminfo', 'RENDER_MEM_RESERVE_MB', 'RENDER_MEM_PER_FEED_MB'],
      status: 'live',
    },
    {
      name: 'parseSource',
      purpose: ['rendering', 'host_bridge', 'format'],
      kind: 'utility',
      sourceFile: 'framework/render/render_surfaces.zig',
      codeRef: 'framework/render/render_surfaces.zig:212-263',
      description:
        'Host source-string parser mapping strings to source types; app:<command> (lines 221-224) becomes source type .display with command=source[4..].',
      status: 'live',
    },
    {
      name: 'startVirtualDisplay',
      purpose: ['rendering', 'host_bridge'],
      kind: 'utility',
      sourceFile: 'framework/render/render_surfaces.zig',
      codeRef: 'framework/render/render_surfaces.zig:1060-1087',
      description:
        'Spawns Xvfb (via spawnXvfb, preferably under setpriv --pdeathsig KILL), stores display number and app command, allocates pixel buffer, sets backend .display_xshm, waits for startup, marks feed interactive.',
      dependsOn: ['spawnXvfb'],
      status: 'live',
    },
  ],
  patterns: [
    {
      name: 'Stable render-source identity as feed handle',
      purpose: ['rendering', 'host_bridge'],
      description:
        'Host feeds are matched by exact renderSrc string. Per-tile id keeps tiles from collapsing into one feed; a nonce embedded in the source lets a refresh button retire all old feeds and respawn fresh ones at current cell size. Source identity is a deliberate refresh/re-rack mechanism.',
      examples: ['render_perf_lab'],
      status: 'recurring',
    },
    {
      name: 'app: render source as external-process bridge',
      purpose: ['rendering', 'host_bridge'],
      description:
        'A renderSrc beginning with app: launches a command inside a virtual display (Xvfb), captured via XShm and uploaded to a wgpu texture quad — a bridge from ReactJIT UI into arbitrary external processes.',
      examples: ['render_perf_lab'],
      status: 'recurring',
    },
    {
      name: 'Birth-resolution feed sizing',
      purpose: ['rendering', 'telemetry'],
      description:
        'A .display feed picks its Xvfb pixel size at creation (max(320,node_w) by max(240,node_h)); later layout changes do not resize it, so per-terminal cost trends with birth area, not the visible cell. Refresh (new nonce) respawns at current size.',
      examples: ['render_perf_lab'],
      status: 'recurring',
    },
    {
      name: 'Cart-side soft guard mirroring host backstop',
      purpose: ['telemetry', 'host_bridge'],
      description:
        'UI disables the add button when available RAM is below reserve plus one feed budget, mirroring the host OOM guard; the host remains the hard backstop. The two numeric policies (MEM_RESERVE_MB/MEM_PER_FEED_MB and CAP vs MAX_FEEDS) should stay aligned.',
      examples: ['render_perf_lab'],
      status: 'recurring',
    },
    {
      name: 'Telemetry panel idiom',
      purpose: ['telemetry', 'ui', 'debug'],
      description:
        'useTelemetry scalars polled at one cadence (here 500 ms) and JSON snapshots at another, with sampled history feeding a sparkline and a sample log, and fps color thresholds (green >=55, amber >=30, red below).',
      examples: ['render_perf_lab', 'hmsc_massive_map_lab'],
      status: 'recurring',
    },
  ],
  hazards: [
    {
      name: 'Birth resolution decouples cost from visible size',
      purpose: ['rendering', 'telemetry'],
      description:
        'A display feed is sized when created and never resized by later layout. After the grid shrinks, early tiles keep larger birth resolutions and downscale into the smaller cell, so per-terminal cost trends with birth area not the current cell.',
      evidence: [
        'framework/render/render_surfaces.zig:1386-1391 uses max(320,node_w) by max(240,node_h)',
        'render_perf_lab.md birth-size behavior section',
      ],
      fix: 'Press refresh (bumps nonce) to retire old feeds and respawn at current cell sizes.',
      severity: 'medium',
    },
    {
      name: 'Cart memory guard is soft only',
      purpose: ['telemetry', 'host_bridge'],
      description:
        'guardActive/canAdd in the cart are UI-level button disablement; there is no hard memory enforcement in JavaScript. The host independently refuses .display/.vm feeds when headroom fails.',
      evidence: [
        'render_perf_lab.tsx:167-168',
        'framework/render/render_surfaces.zig:1254-1263',
        'createFeed render_surfaces.zig:1274-1280',
      ],
      fix: 'Keep cart constants (MEM_RESERVE_MB/MEM_PER_FEED_MB/CAP) numerically aligned with host env defaults and MAX_FEEDS.',
      severity: 'medium',
    },
    {
      name: 'Idle feeds still cost capture and upload work',
      purpose: ['rendering', 'telemetry'],
      description:
        'The render-surface backend polls and uploads live feeds every frame when dirty, so even idle shells incur capture and GPU-upload cost. This is intentional worst-case load for the lab.',
      evidence: ['render_perf_lab.md high-level purpose section'],
      severity: 'low',
    },
    {
      name: 'Non-unique render source collapses tiles into one feed',
      purpose: ['rendering', 'host_bridge'],
      description:
        'findFeed matches existing feeds by exact source string, so srcFor must make each tile source unique (per-tile id in the title); otherwise multiple tiles share one host feed.',
      evidence: ['framework/render/render_surfaces.zig:1184-1190', 'render_perf_lab.tsx:43-48'],
      severity: 'medium',
    },
  ],
};
