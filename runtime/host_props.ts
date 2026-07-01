/**
 * Host node props — the full set of node-level (non-style) props that the
 * V8 host decoder accepts. These pass through any primitive verbatim
 * (Box, Text, Pressable, Canvas, etc.) and land directly on the Zig
 * `Node` struct via `v8_app.zig`.
 *
 * Style fields (background, padding, border, etc.) live in `Style` and are
 * carried under the `style` prop. This file documents *non-style* props.
 *
 * Primitives accept `props: any`, so this interface is advisory — import it
 * for autocomplete and type-checking when you want it.
 */

export type HostNodeProps = Partial<{
  // ── Identity / debug ────────────────────────────────────
  /** Human-readable label for the node — surfaces in DevTools, telemetry, query.findByName(). */
  debugName: string;
  /** Stable identifier for screenshot/conformance tests. query.findByTestId(). */
  testID: string;

  // ── Hover / interaction ─────────────────────────────────
  /** Tooltip text shown on hover. Auto-positioned by `framework/tooltip.zig`. */
  tooltip: string;
  /** Marks this node as participating in hover hit-testing without a Pressable. */
  hoverable: boolean;
  /** Consume pointer hit-testing without installing a no-op handler. Use for modal scrims and overlay blockers. */
  blocksPointerEvents: boolean;
  /** Hyperlink — currently surfaces in `node.href`; opens via the host. */
  href: string;

  // ── Text shaping ────────────────────────────────────────
  /** Truncate text to N lines (0 = unlimited). */
  numberOfLines: number;
  /** Disable wrapping; text overflows horizontally instead. */
  noWrap: boolean;
  /**
   * Inline SVG glyphs threaded into a `<Text>`. Each `\x01` byte (see
   * `GLYPH_SLOT`) reserves a fontSize×fontSize slot and the i-th glyph
   * paints into it. Useful for icons inline with monospace text.
   */
  inlineGlyphs: Array<{
    d: string;
    fill?: string;
    fillEffect?: string;
    stroke?: string;
    strokeWidth?: number;
    scale?: number;
  }>;
  /**
   * Per-row color override for `<TextInput>` / `<TextEditor>`.
   * Each entry colors a single character range — used for syntax highlighting
   * inside an editable input (was the v4 highlighted-input path).
   */
  colorRows: Array<{ row: number; col: number; len: number; color: string }>;

  // ── Effects (cart authors with WGSL) ────────────────────
  /**
   * Name (or inline source) of a WGSL `<Effect>` to mask glyph fills.
   * Glyph rasterizer samples the effect's pixel buffer for color.
   * The "WGSL crushes the other approach" v4 text-effect path. Live again.
   */
  textEffect: string;
  /** Render an `<Effect>` *behind* this node's content rather than as a sibling. */
  effectBackground: boolean;

  // ── Window chrome (borderless host) ─────────────────────
  /** Drag the host window from this node. Used for custom titlebars. */
  windowDrag: boolean;
  /** Resize the host window from this node. Use on edge/corner regions. */
  windowResize: boolean;

  // ── Native context menu ─────────────────────────────────
  /**
   * Right-click menu items rendered by the Zig-side context menu (themed,
   * fast, no React tree). Capped at 16 items. When an item is clicked,
   * the host dispatches `onContextMenu(itemIndex)` back to this node.
   */
  contextMenuItems: Array<{ label: string }>;
  /** Listener invoked with the clicked item index. */
  onContextMenu: (itemIndex: number) => void;

  // ── Devtools / inspector ────────────────────────────────
  /** Inspector overlay mode painted by the engine when devtools are enabled. */
  devtoolsViz: 'none' | 'sparkline' | 'wireframe' | 'node_tree' | 'inspector_overlay';

  // ── Media sources ───────────────────────────────────────
  /** Image source (also the Image primitive's main prop). */
  src: string;
  /** Render-target source — render-to-texture id. */
  renderSrc: string;
  /** Cache this subtree into a GPU texture while preserving child hit testing. */
  staticSurface: boolean;
  /** Stable cache key for a static surface; change it to invalidate the texture. */
  staticSurfaceKey: string;
  /** Backing texture scale for high-DPI static surface captures. */
  staticSurfaceScale: number;
  /** Live frames to paint before the static surface captures into its GPU texture. */
  staticSurfaceWarmupFrames: number;
  /** GPU-only intro frames for a cached static surface texture. */
  staticSurfaceIntroFrames: number;
  /** Paint this dynamic descendant above a cached StaticSurface instead of baking it into the texture. */
  staticSurfaceOverlay: boolean;
  /** Video file/URL — engine routes through framework/videos.zig. Or use `<Video src=…>`. */
  videoSrc: string;

  // ── Canvas / Graph ──────────────────────────────────────
  /** SVG path fill alpha multiplier for `<Canvas.Path>` / `<Graph.Path>`. */
  fillOpacity: number;
  /** SVG path stroke alpha multiplier for `<Canvas.Path>` / `<Graph.Path>`. */
  strokeOpacity: number;
  /** WGSL effect name used to fill a `<Canvas.Path>` instead of a solid/gradient. */
  fillEffect: string;
  /** Animated stroke flow on `<Canvas.Path>` (px/sec; negative reverses). */
  flowSpeed: number;
  /** Ambient horizontal drift on `<Canvas>` (px/sec; runs while no user drag). */
  driftX: number;
  /** Ambient vertical drift on `<Canvas>` (px/sec). */
  driftY: number;
  /** Toggle the drift animation. */
  driftActive: boolean;
  /**
   * Engine-side Canvas.Node click-to-select + hover/selected highlight on
   * `<Canvas>` (default true). Set false when the cart owns its own selection
   * model — an engine-selected node silently freezes drift (the WASD pan), so
   * a background click over any node would gridlock panning until re-clicked.
   */
  selectNodes: boolean;

  // ── Terminal (cell-grid <Terminal> primitive) ─────────────
  /**
   * Shell binary the PTY should exec when this Terminal first mounts.
   * Engine default = "bash". Read once at spawn; subsequent updates to
   * this prop are ignored for the lifetime of that session.
   */
  shell: string;
  /**
   * Session name. Each unique name maps to its own pipe (vterm + PTY +
   * scrollback + classifier + semantic graph). Two `<Terminal session="X">`
   * elements with the same name share one pipe — change the name on the
   * same node to switch which session is visible (the previous one keeps
   * running in the background until you call `closeTerminalSession`).
   * Unset → implicit "default" session, which is fine for single-Terminal
   * carts.
   */
  session: string;
  /** Take keyboard focus on first paint without requiring a click. */
  autoFocus: boolean;
  /** Monospace cell font size in pixels (GPU host only). */
  terminalFontSize: number;

  // ── Physics (Box2D, see <Physics> primitive for ergonomic API) ──
  physicsWorld: boolean;
  physicsWorldId: number;
  physicsBody: boolean;
  physicsCollider: boolean;
  physicsBodyType: 'static' | 'kinematic' | 'dynamic' | number;
  physicsShape: 'box' | 'circle' | number;
  physicsX: number; physicsY: number; physicsAngle: number;
  physicsGravityX: number; physicsGravityY: number; physicsGravityScale: number;
  physicsDensity: number; physicsFriction: number; physicsRestitution: number;
  physicsRadius: number;
  physicsFixedRotation: boolean; physicsBullet: boolean;
}>;

/**
 * Effect primitive props — `<Effect>` accepts these in addition to base node props.
 * Mode is mutually exclusive: `background` paints behind the parent's content;
 * `mask` uses the effect's alpha as the parent's clip mask (mask-image equivalent,
 * currently CPU path); neither = effect renders inline as its own surface.
 */
export type HostEffectProps = Partial<{
  /** Named effect; resolved against the registered effect catalog. */
  name: string;
  /** WGSL fragment-shader source (auto-wrapped with uniforms + math lib). */
  shader: string;
  /** Render the effect *behind* the parent's content. */
  background: boolean;
  /** Use the effect's alpha as the parent's clip mask (CPU-only for now). */
  mask: boolean;
}>;
