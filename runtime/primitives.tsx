/**
 * Primitives — the base components the reconciler hands to the Zig host.
 *
 * Each thin wrapper creates a React element with a specific `type` string.
 * The hostConfig (renderer/hostConfig.ts) relays the type through to Zig
 * via CREATE commands. Unknown types pass through unchanged — that's what
 * makes <Native type="Audio" />, <Canvas.Node>, <Graph.Path> etc. work.
 *
 * Every React call is LAZY — a fresh `require('react')` at render time,
 * not a top-level capture. The esbuild inject of `init_ambient_primitives`
 * into react/index.js's own body causes this module to init recursively
 * during require_react's first call, at which point mod.exports is still
 * the partial `{}`. Capturing React.createElement / React.memo at init
 * time would store undefined forever. Deferring the lookup to render time
 * (after require_react's body finishes) resolves to the real React.
 */

const THEME_PREFIX = 'theme:';

function isThemeTokenValue(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(THEME_PREFIX);
}

function hasThemeTokenValue(v: any): boolean {
  if (isThemeTokenValue(v)) return true;
  if (!v || typeof v !== 'object' || v instanceof Function) return false;
  if ((v as any).$$typeof) return false;
  if (Array.isArray(v)) return v.some(hasThemeTokenValue);
  for (const key of Object.keys(v)) {
    if (key === 'children' || key === 'key' || key === 'ref') continue;
    if (hasThemeTokenValue(v[key])) return true;
  }
  return false;
}

function resolveThemeValue(v: any, colors: any, styles: any, resolveToken: any): any {
  if (isThemeTokenValue(v)) return resolveToken(v, colors, styles);
  if (!v || typeof v !== 'object' || v instanceof Function) return v;
  if ((v as any).$$typeof) return v;
  if (Array.isArray(v)) return v.map((item) => resolveThemeValue(item, colors, styles, resolveToken));

  const out: Record<string, any> = {};
  for (const key of Object.keys(v)) {
    out[key] = key === 'children'
      ? v[key]
      : resolveThemeValue(v[key], colors, styles, resolveToken);
  }
  return out;
}

function useResolvedPrimitiveProps(props: any): any {
  // Theme is required lazily for the same reason React is: primitives can be
  // initialized while React's own module body is still bootstrapping.
  const theme = require('./classifier');
  const snap = theme.__useClassifierSnapshot();
  if (!props || !hasThemeTokenValue(props)) return props;
  return resolveThemeValue(props, snap.colors, snap.styles, theme.resolveToken);
}

function h(type: any, props: any, ...children: any[]): any {
  return require('react').createElement(type, useResolvedPrimitiveProps(props), ...children);
}

// ── Core building blocks ────────────────────────────────────

export const Box: any = (props: any) => h('View', props, props.children);

/** Row — Box with flexDirection: 'row' pre-applied. */
export const Row: any = (props: any) => {
  const style = { flexDirection: 'row', ...(props.style ?? {}) };
  return h('View', { ...props, style }, props.children);
};

/** Col — Box with flexDirection: 'column' pre-applied (same as Box default, for symmetry with Row). */
export const Col: any = (props: any) => {
  const style = { flexDirection: 'column', ...(props.style ?? {}) };
  return h('View', { ...props, style }, props.children);
};

// Flatten children into a single text run.
//
// Two jobs:
//   1. Coalesce adjacent string/number children, so `<Text>{n} item{n===1?'':'s'}</Text>`
//      doesn't wrap mid-word as three siblings.
//   2. Splice nested Text-like elements (the Text primitive, and any classifier
//      whose def.type === 'Text') inline. Without this, `<Body>foo <Body>bar</Body> baz</Body>`
//      becomes three blocks-in-row in the layout — the author wrote one string,
//      the user sees three. React-DOM solves this with text-flow inline boxes;
//      RN solves it by collapsing nested <Text>. We follow RN.
//
// Phase-1 tradeoff: a nested Text-like contributes its text content but loses
// its own per-element style. For the common case (same-style nesting like
// <Body>...<Body>x</Body>...</Body>) this is exactly right. For genuine
// styled inline emphasis (bold/colored span inside paragraph), Phase-2 would
// emit a host-level `segments` prop and a segmented draw path in text.zig.
// No cart needs that today; if one ever does, that's the upgrade path.
//
// Non-text element children (e.g. <Pressable>, <Image>) pass through
// untouched — they remain block siblings, same as today.
function isInlineTextLike(el: any): boolean {
  if (!el || typeof el !== 'object') return false;
  const t = (el as any).type;
  if (t == null) return false;
  if (t === Text) return true;
  // Text-classifier: classifier({ Body: { type: 'Text', ... } }) tags its
  // component with __isClassifier and stashes the original def on __def.
  if (typeof t === 'function' && (t as any).__isClassifier && (t as any).__def?.type === 'Text') return true;
  return false;
}

function flattenTextChildren(children: any): any {
  if (children == null) return children;
  const list = Array.isArray(children) ? children : [children];
  const out: any[] = [];
  let buf = '';
  let bufHas = false;
  const flush = (): void => {
    if (bufHas) { out.push(buf); buf = ''; bufHas = false; }
  };
  const visit = (c: any): void => {
    if (c == null || c === false || c === true) return;
    const t = typeof c;
    if (t === 'string' || t === 'number') {
      buf += String(c);
      bufHas = true;
      return;
    }
    if (Array.isArray(c)) {
      for (const ci of c) visit(ci);
      return;
    }
    if (isInlineTextLike(c)) {
      const inner = (c as any).props?.children;
      if (inner != null) visit(inner);
      return;
    }
    flush();
    out.push(c);
  };
  for (const c of list) visit(c);
  flush();
  if (out.length === 0) return undefined;
  if (out.length === 1) return out[0];
  return out;
}

export const Text: any = (props: any) => {
  const { size, bold, style, children, ...rest } = props;
  const flat = flattenTextChildren(children);
  if (size == null && !bold) return h('Text', { ...rest, style }, flat);
  const shorthand: Record<string, any> = {};
  if (size != null) shorthand.fontSize = size;
  if (bold) shorthand.fontWeight = 'bold';
  return h('Text', { ...rest, style: { ...shorthand, ...(style ?? {}) } }, flat);
};

/**
 * Sentinel byte (SOH, 0x01) — embed inside `<Text>` content to reserve a
 * fontSize×fontSize slot that an `inlineGlyphs` entry paints into.
 *   <Text inlineGlyphs={[{ d: 'M0 0…', fill: '#fff' }]}>
 *     status: {GLYPH_SLOT} ok
 *   </Text>
 */
export const GLYPH_SLOT = '\x01';
// Image accepts EITHER `src` or `source` — the Zig host only reads `source`
// (see v8_app.zig:1822), but `src` is the universal name (HTML, React, JSX
// docs), so callers shouldn't have to remember which one. Caller wins if
// both are passed.
export const Image: any = ({ src, source, ...rest }: any) =>
  h('Image', { ...rest, source: source ?? src }, rest.children);
// One-liner wrapper for the host's icon renderer. Equivalent to
// <Native type="Icon" .../> but cheaper to write/read everywhere.
export const Icon: any = (props: any) => h('Icon', props);

// Carts may opt into a consistent hover cue for ordinary press targets.  This
// remains opt-in because canvases and click-away scrims intentionally have no
// visible hover state.
let defaultPressableHoverStyle: any = undefined;

export function setDefaultPressableHoverStyle(style: any): void {
  defaultPressableHoverStyle = style;
}

export const Pressable: any = (props: any) => {
  const hoverStyle = props.hoverStyle === undefined && props.onPress
    ? defaultPressableHoverStyle
    : props.hoverStyle;
  // `hoverStyle` is declarative metadata today; the native painter draws its
  // hover affordance only for nodes explicitly marked hoverable.  Derive that
  // opt-in for every visible Pressable treatment.  An empty hoverStyle remains
  // the escape hatch for click-away scrims and invisible input surfaces.
  const hoverable = props.hoverable ?? Boolean(
    props.onPress && hoverStyle && Object.keys(hoverStyle).length > 0,
  );
  const resolved = hoverStyle === undefined && !hoverable
    ? props
    : { ...props, hoverStyle, hoverable };
  return h('Pressable', resolved, props.children);
};
// ScrollView auto-persists its scroll position across dev-mode hot reloads.
//
// scroll_y lives on the Zig Node, so a fresh tree after a reload starts at
// 0 even though every useState atom survives via useHotState. This wrapper
// keys scroll on (currentRoutePath + React.useId()), seeds the primitive
// with initialScrollY on render from __hot_get, and writes every onScroll
// tick back through __hot_set. v8_app applies initialScrollY once on CREATE
// (UPDATE paths skip it), so re-reading the hot value per-render is safe —
// it only affects the very first CREATE command after a reload.
//
// useId alone is keyed off fiber position, which collides across route
// navigations: the first ScrollView on a fresh page lands in the same slot
// the previous page's first ScrollView occupied, inheriting its saved
// scrollY and mounting "already-scrolled" against shorter content. Scoping
// the key by route path keeps dev hot-reload restoration intact (same path
// = same key) while isolating per-route ScrollViews from each other.
//
// We deliberately DON'T use React.useState for the read: the auto-patched
// useState caches its first value under its own useId, so it would freeze
// on 0 from the first-ever mount and never observe later __hot_set writes.
export const ScrollView: any = (props: any) => {
  const React = require('react');
  const hotId: string = React.useId();
  const host: any = globalThis as any;
  const routePath: string =
    typeof host.__routerCurrentPath === 'function' ? (host.__routerCurrentPath() ?? '') : '';
  const hotKey = 'scroll:' + routePath + ':' + hotId;

  let initialY = 0;
  if (typeof host.__hot_get === 'function') {
    try {
      const raw = host.__hot_get(hotKey);
      if (raw != null) {
        const n = parseFloat(raw);
        if (Number.isFinite(n)) initialY = n;
      }
    } catch {}
  }

  const userOnScroll = props.onScroll;
  const onScroll = (payload: any): void => {
    try {
      if (typeof host.__hot_set === 'function' && Number.isFinite(payload?.scrollY)) {
        host.__hot_set(hotKey, String(payload.scrollY));
      }
    } catch {}
    if (typeof userOnScroll === 'function') userOnScroll(payload);
  };

  const forwardedProps = {
    ...props,
    onScroll,
    initialScrollY: props.initialScrollY ?? initialY,
  };
  return h('ScrollView', forwardedProps, props.children);
};
// One input primitive. `type` picks the shape — there is no separate
// single-line vs multi-line component (that's the HTML <input>/<textarea>
// mistake; RN already collapsed it to one). Under the hood the Zig host is
// a single input with one `multiline` flag (framework/primitive/input.zig);
// these just select it:
//   type="text"       → single line, scrolls horizontally   (host: TextInput)
//   type="multiline"  → wraps, grows vertically             (host: TextArea)
//   type="code"       → code editor                          (host: TextEditor)
// Controlled only: pass `text` (state-owned) + `onChange`. The element never
// owns the value — React state is the source of truth. `value` is accepted
// as an alias of `text` for back-compat.
export const Input: any = (props: any) => {
  const { type, text, value, children, ...rest } = props;
  const hostType =
    type === 'multiline' ? 'TextArea' :
    type === 'code' ? 'TextEditor' :
    'TextInput';
  return h(hostType, { ...rest, value: text ?? value }, children);
};
// Back-compat aliases — single implementation, no duplicated logic. Prefer
// <Input type="…"> in new code.
export const TextInput: any = (props: any) => Input({ ...props, type: 'text' });
export const TextArea: any = (props: any) => Input({ ...props, type: 'multiline' });
export const TextEditor: any = (props: any) => Input({ ...props, type: 'code' });
export const Terminal: any = (props: any) => h('Terminal', props, props.children);
export const terminal: any = Terminal;
// Window + Notification live in their own file so the esbuild metafile
// can detect when a cart actually uses them. ship-tui keys the
// -Dhas-window=true gate off that signal (carts without <Window> skip
// the SDL3 + window-engine link).
export { Window, window, Notification, notification } from './primitives/window';

// ── Video — Image-shaped host node, but routed through framework/videos.zig ──
// Pass `src` (or `videoSrc` for clarity); engine.zig:1232 promotes any node
// with video_src to the Video paint path. The optional `paused` / `loop` /
// `volume` / `muted` props feed framework/videos.zig via the __video_*
// bindings as soon as the source reaches `ready`. The Zig side defaults
// every newly-loaded clip to paused — so without `paused={false}` the
// frame paints but never advances.
export const Video: any = ({ src, videoSrc, paused, loop, volume, muted, ...rest }: any) => {
  const React = require('react');
  const resolvedSrc = videoSrc ?? src;
  React.useEffect(() => {
    if (!resolvedSrc) return undefined;
    const { videoControl } = require('./hooks/useVideo');
    const ctl = videoControl(resolvedSrc);
    const apply = () => {
      if (ctl.getStatus() !== 'ready') return false;
      if (paused !== undefined) (paused ? ctl.pause() : ctl.play());
      if (loop !== undefined) ctl.setLoop(!!loop);
      if (volume !== undefined) ctl.setVolume(volume);
      if (muted !== undefined) ctl.setMuted(!!muted);
      return true;
    };
    if (apply()) return undefined;
    // Poll until videos.zig finishes loading (mpv reports video-params/w
    // before any frame has rendered — typically <500ms for local files,
    // longer for remote URLs).
    const id = setInterval(() => { if (apply()) clearInterval(id); }, 100);
    return () => clearInterval(id);
  }, [resolvedSrc, paused, loop, volume, muted]);
  return h('Image', { ...rest, videoSrc: resolvedSrc }, rest.children);
};

// ── Cartridge — embed a guest cart bundle inline. `src` is a path to a
// `.cart.js` file built with `cart-bundle.js --cartridge`. The loader reads
// it off disk, evals it in this V8 context, and the bundle's entry stashes
// its root component into a slot we then render. Sharing the host's React,
// reconciler, and renderer means the guest's hooks and event handlers wire
// into the same dispatcher and registry as the host's tree — no new
// isolate, no extra runtime weight, no binary embedding. Unmount removes
// the guest subtree like any normal React unmount; the cached module bytes
// stay in V8 until evictCartridge() is called.
export const Cartridge: any = ({ src, ...rest }: any) => {
  if ((globalThis as any).__TRACE_CARTRIDGE) {
    try { console.log('[Cartridge] render', src); } catch {}
  }
  if (!src) return null;
  const { loadCartridge } = require('./cartridge_loader');
  const Comp = loadCartridge(src);
  if ((globalThis as any).__TRACE_CARTRIDGE) {
    try { console.log('[Cartridge] loadCartridge returned', src, Comp ? 'OK' : 'NULL'); } catch {}
  }
  if (!Comp) {
    return h('Text', { color: 'red' }, `[cartridge load failed: ${src}]`);
  }
  return h(Comp, rest);
};

// ── RenderTarget — render-to-texture surface. Hot-loadable .so render hook
// keyed by the `src` id (matches a registered render pass).
export const RenderTarget: any = ({ src, renderSrc, ...rest }: any) =>
  h('View', { ...rest, renderSrc: renderSrc ?? src }, rest.children);

// ── StaticSurface — GPU-cached subtree. Children remain present for layout
// and hit testing, while paint collapses into a render-to-texture quad.
export const StaticSurface: any = ({
  staticKey,
  staticSurfaceKey,
  scale,
  staticSurfaceScale,
  warmupFrames,
  staticSurfaceWarmupFrames,
  introFrames,
  staticSurfaceIntroFrames,
  ...rest
}: any) => {
  const React = require('react');
  const id = React.useId();
  return h('View', {
    ...rest,
    staticSurface: true,
    staticSurfaceKey: staticSurfaceKey ?? staticKey ?? id,
    staticSurfaceScale: staticSurfaceScale ?? scale ?? 1,
    staticSurfaceWarmupFrames: staticSurfaceWarmupFrames ?? warmupFrames ?? 0,
    staticSurfaceIntroFrames: staticSurfaceIntroFrames ?? introFrames ?? 0,
  }, rest.children);
};

// ── Filter — post-process shader filter on a subtree. Children render
// into an offscreen texture every frame and are composited via the named
// fragment shader (deepfry, crt, vhs, chromatic, posterize, scanlines,
// invert, grayscale, pixelate, dither). Hit-test, layout, and animations
// inside the subtree are unaffected — the filter is purely presentation.
//
//   <Filter shader="deepfry" intensity={1}>
//     <App />
//   </Filter>
export const Filter: any = ({ shader, intensity, ...rest }: any) =>
  h('View', {
    ...rest,
    filterName: shader,
    filterIntensity: intensity ?? 1,
  }, rest.children);

// ── Physics — Box2D 2D physics. Three sub-components:
//   <Physics.World gravityX gravityY>          container that owns the simulation
//     <Physics.Body type="dynamic" x y bullet> rigid body, props alias to physicsX/Y/etc.
//       <Physics.Collider shape="box" radius friction restitution density />
//
// Each just spreads typed physics props onto a host node — the engine reads
// physics_world/body/collider flags to decide how to thread it into Box2D.
const PhysicsBase: any = ({ gravityX, gravityY, ...rest }: any) =>
  h('View', {
    ...rest,
    physicsWorld: true,
    physicsGravityX: gravityX ?? 0,
    physicsGravityY: gravityY ?? 980,
  }, rest.children);
PhysicsBase.World = PhysicsBase;
PhysicsBase.Body = ({ type, x, y, angle, fixedRotation, bullet, gravityScale, ...rest }: any) =>
  h('View', {
    ...rest,
    physicsBody: true,
    physicsBodyType: type ?? 'dynamic',
    physicsX: x ?? 0,
    physicsY: y ?? 0,
    physicsAngle: angle ?? 0,
    physicsFixedRotation: fixedRotation ?? false,
    physicsBullet: bullet ?? false,
    physicsGravityScale: gravityScale ?? 1.0,
  }, rest.children);
PhysicsBase.Collider = ({ shape, radius, density, friction, restitution, ...rest }: any) =>
  h('View', {
    ...rest,
    physicsCollider: true,
    physicsShape: shape ?? 'box',
    physicsRadius: radius ?? 0,
    physicsDensity: density ?? 1.0,
    physicsFriction: friction ?? 0.3,
    physicsRestitution: restitution ?? 0.1,
  }, rest.children);
export const Physics: any = PhysicsBase;

// ── Scene3D — declarative wrapper around framework/gpu/3d.zig ──────────────
//
// Mirrors Physics: a base <Scene3D> root plus typed sub-components. Each
// helper just spreads typed `scene3d*` props onto a <View> — gpu/3d.zig
// reads `node.scene3d_mesh / scene3d_camera / scene3d_light / scene3d_*`
// off the layout tree and runs them through the wgpu render-to-texture
// pipeline (composited back via images.queueQuad).
//
//   <Scene3D style={{ width: 320, height: 240 }} backgroundColor="#0a0e18">
//     <Scene3D.Camera position={[3, 2, 4]} target={[0, 0, 0]} fov={60} />
//     <Scene3D.AmbientLight color="#ffffff" intensity={0.3} />
//     <Scene3D.DirectionalLight direction={[0.5, 1, -0.3]} color="#ffffff" intensity={0.7} />
//     <Scene3D.PointLight position={[0, 3, 0]} color="#ffc48a" intensity={1.0} />
//     <Scene3D.Mesh geometry="sphere" material="#4aa3ff" position={[0, 0, 0]} radius={1} />
//   </Scene3D>
//
// Note: the previous JS-side scene-graph + CPU painter at runtime/scene3d/
// is dead (moved to runtime/scene3d_dead/). The host already had a real
// wgpu-backed pipeline in framework/gpu/3d.zig keyed off layout-node flags;
// this surface emits straight to that.
function _hexToRgb(hex: string | undefined, fallback: [number, number, number] = [0.8, 0.8, 0.8]): [number, number, number] {
  if (!hex || typeof hex !== 'string') return fallback;
  const s = hex.startsWith('#') ? hex.slice(1) : hex;
  const expanded = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (expanded.length !== 6) return fallback;
  const n = parseInt(expanded, 16);
  if (Number.isNaN(n)) return fallback;
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}
function _vec3(v: any, dx = 0, dy = 0, dz = 0): [number, number, number] {
  if (Array.isArray(v) && v.length === 3) return [v[0] ?? dx, v[1] ?? dy, v[2] ?? dz];
  return [dx, dy, dz];
}
function _scaleVec3(v: any): [number, number, number] {
  if (typeof v === 'number') return [v, v, v];
  if (Array.isArray(v) && v.length === 3) return [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1];
  return [1, 1, 1];
}
const _AUTO_FOG_COLOR = [-1, -1, -1];
const Scene3DBase: any = ({ wireframe, ...rest }: any) =>
  h('View', {
    ...rest,
    scene3d: true,
    // `wireframe` draws a screen-constant-width line along every triangle edge of
    // every mesh in this scene (host-side, barycentric — pixel-locked to the surface
    // at any zoom). A viewport-wide toggle, ideal for a mesh editor.
    scene3dWireframe: !!wireframe,
  }, rest.children);
// `far` = draw radius in world units: the hard clip plane AND the per-mesh cull
// distance (meshes whose nearest point is past `far` are skipped entirely). `near`
// = the near clip plane. Both are OPTIONAL — pass 0 / omit to let the host
// auto-derive them from the scene extent (the historical behaviour). When `far`
// is set, the distance fog (see Scene3D.Fog) auto-anchors to it unless a <Fog>
// overrides, so cresting a hill shows a hazed horizon instead of the whole map.
Scene3DBase.Camera = {
  $$typeof: Symbol.for('react.forward_ref'),
  render({ position, target, fov, far, near, nativeCamera, scene3dCameraNative, orbit, ...rest }: any, ref: any) {
    const [px, py, pz] = _vec3(position, 3, 2, 4);
    const [lx, ly, lz] = _vec3(target, 0, 0, 0);
    return h('View', {
      ...rest,
      ref,
      scene3dCamera: true,
      scene3dCameraNative: !!(nativeCamera ?? scene3dCameraNative),
      // `orbit` hands the view to the host's drop-to-view orbit camera (gpu/3d.zig):
      // position/look come from host orbit state seeded by __mesh_load_file and driven
      // by __model_orbit_drag/zoom, so moving the camera never re-renders the cart.
      // Distinct from nativeCamera, which binds the game FPS camera.
      scene3dCameraOrbit: !!orbit,
      scene3dPosX: px, scene3dPosY: py, scene3dPosZ: pz,
      scene3dLookX: lx, scene3dLookY: ly, scene3dLookZ: lz,
      scene3dFov: fov ?? 60,
      scene3dFar: Number.isFinite(far) && far > 0 ? far : 0,
      scene3dNear: Number.isFinite(near) && near > 0 ? near : 0,
    });
  },
};
// Skybox — an analytic procedural sky drawn behind every mesh (gradient + sun
// + haze + clouds + stars). A child of <Scene3D> like Camera/Light. Every prop
// is a live uniform on the host, so animating them per render gives a day cycle
// (sunDir + colors), weather (cloud/haze), or a per-zone mood — one sky, params
// lerped. There is no image/cubemap here; for that and the other limits see
// cart/skybox_demo.tsx.
//
//   <Scene3D.Skybox
//     zenith="#1a3a78" horizon="#a9c4e8" ground="#0c0d10"
//     sunDir={[0.4, 0.5, 0.3]} sunColor="#ffe7b0"
//     sunSize={0.02} sunGlow={0.3} haze={0.35} cloud={0.2} night={0} />
Scene3DBase.Skybox = ({ zenith, horizon, ground, sunDir, sunColor, sunSize, sunGlow, haze, cloud, night, ...rest }: any) =>
  h('View', {
    ...rest,
    scene3dSkybox: true,
    scene3dSkyZenith: _hexToRgb(zenith, [0.16, 0.33, 0.62]),
    scene3dSkyHorizon: _hexToRgb(horizon, [0.62, 0.72, 0.86]),
    scene3dSkyGround: _hexToRgb(ground, [0.10, 0.11, 0.13]),
    scene3dSkySunDir: _vec3(sunDir, 0.4, 0.6, 0.3),
    scene3dSkySunColor: _hexToRgb(sunColor, [1.0, 0.93, 0.78]),
    scene3dSkySunSize: sunSize ?? 0.012,
    scene3dSkySunGlow: sunGlow ?? 0.25,
    scene3dSkyHaze: haze ?? 0.3,
    scene3dSkyCloud: cloud ?? 0.0,
    scene3dSkyNight: night ?? 0.0,
  });
// Distance fog — fades geometry into a colour as it recedes. A child of
// <Scene3D> like Camera/Skybox. By default fog auto-anchors to the camera's
// `far` (draw radius): the fade finishes right at the cull edge so nothing pops
// when you crest a hill. Set `near`/`far` here to decouple the fade from the
// draw radius (e.g. a soft haze that starts close while the world still draws
// far). `color` defaults to the skybox horizon colour; pass a hex to override.
//
// Distance fog is auto-on for EVERY <Scene3D>, fading geometry toward the
// background colour as it recedes. That's wrong for a studio / object viewer —
// with no skybox it just reads as the model going dark at the far edge. Pass
// `enabled={false}` to opt out: it pushes the fade so far past any geometry that
// nothing ever fades. The only way to turn fog off.
//
//   <Scene3D.Camera position={...} target={...} far={140} />
//   <Scene3D.Fog near={40} far={130} color="#b9c6d8" />
//   <Scene3D.Fog enabled={false} />          // flat, fully-lit — no distance fade
Scene3DBase.Fog = ({ near, far, color, enabled = true, ...rest }: any) =>
  h('View', {
    ...rest,
    scene3dFog: true,
    scene3dFogColor: typeof color === 'string' ? _hexToRgb(color, _AUTO_FOG_COLOR as any) : _AUTO_FOG_COLOR,
    scene3dFogNear: enabled === false ? 1e7 : (Number.isFinite(near) && near > 0 ? near : 0),
    scene3dFogFar: enabled === false ? 2e7 : (Number.isFinite(far) && far > 0 ? far : 0),
  });

// Identity-stable shipping caches for the dynamic-geometry paths below. The
// reconciler diffs non-style props by IDENTITY (hostConfig diffCleanProps), so the
// shipped array must keep its identity while the source data is unchanged —
// otherwise every re-render of a heightfield/dyn mesh ships the whole grid (or
// vert buffer) across the bridge again and the host re-bakes the mesh for nothing.
// That turns any ancestor re-render into per-chunk re-uploads (the editor's
// "heightfields choke whenever anything renders" symptom).
//
// hf: keyed by the SOURCE heights array — the contract is a NEW array per height
// edit (see render3d/Landform), so a WeakMap entry lives exactly as long as its
// version of the terrain and drops with it.
const _hfShipCache = new WeakMap<object, { arr: number[]; maxAbsY: number }>();
// Parallel cache for the optional water DEPTH grid (same identity contract as
// heights): a new depths array per edit ⇒ a fresh shipment, else stable identity
// so the prop diff sees "unchanged" and nothing re-crosses the bridge.
const _hfDepthShipCache = new WeakMap<object, number[]>();
// dyn verts CONTENT cache: keyed by the full dynamicKey string, which by contract
// encodes a version that changes when the verts change — so equal key ⇒ equal verts.
// This caches the generated VERTS (regen is the expensive part); it does NOT decide
// whether to ship them. Bounded FIFO because keys are strings (old versions would
// otherwise accumulate).
const _dynGeomCache = new Map<string, { verts: number[] | Float32Array; count: number; radius: number }>();
const _DYN_GEOM_CACHE_MAX = 64;
// dyn SLOT shipment ledger: the last full dyn key we shipped VERTS to each host slot
// (the slotId = everything before the final '~'). The host reuses ONE slot per slotId
// and only retains the LAST version uploaded to it — so the "skip verts, the host
// still has them" optimization is only safe when the slot currently holds THIS exact
// version. Keying the skip decision by the full per-key (the old `shipped` flag)
// desynced from the host whenever a DIFFERENT version reused the same slot in between
// (e.g. Studio's render-index slot `studio.s1` shared across models): switching A→B→A
// let JS skip verts while the host slot held the other model's mesh, so the host fell
// back to drawing its stale contents — the "ghost trunk from another model" bug. Keyed
// by slotId, this mirrors the host's single-slot truth exactly. Resets on hot reload
// (module re-eval) — harmless: the next render re-ships, matching the persisted slot.
const _dynSlotShipped = new Map<string, string>();
function _verticesJsonArray(verts: number[] | Float32Array): number[] {
  return Array.isArray(verts) ? verts : Array.from(verts);
}
function _uploadScene3DVertices(verts: number[] | Float32Array): number {
  const host: any = globalThis as any;
  if (typeof host.__hostUploadFloatBuffer !== 'function') return 0;
  const view = verts instanceof Float32Array ? verts : new Float32Array(verts);
  const handle = host.__hostUploadFloatBuffer(view);
  return Number.isFinite(handle) && handle > 0 ? handle | 0 : 0;
}
function _scene3dVertexProps(key: string, verts: number[] | Float32Array, count: number, bounds: number): Record<string, any> {
  const handle = _uploadScene3DVertices(verts);
  return handle > 0
    ? { scene3dGeomKey: key, scene3dVerticesHandle: handle, scene3dVertCount: count, scene3dBoundsRadius: bounds }
    : { scene3dGeomKey: key, scene3dVertices: _verticesJsonArray(verts), scene3dVertCount: count, scene3dBoundsRadius: bounds };
}

// HOST-OWNED LIVE EDIT (req_1270): overwrite an ALREADY-MOUNTED dyn slot's verts
// in place this frame, with NO reconciler update. A <Scene3D.Mesh dynamicKey=
// "<slotId>~<version>"> must already have mounted the slot the normal way; this
// streams fresh verts straight to its GPU offset so a live drag (Studio face/
// vertex move) never round-trips through React — setState happens only on
// release. `slotId` is the dynamicKey's portion BEFORE its final '~' (the host's
// own slot-id parse), e.g. dynamicKey "studio.draft~part7.3" → slotId
// "studio.draft". `verts` is interleaved [px,py,pz, nx,ny,nz, u,v] (GeometryData
// .positions), `count` its vertex count. Returns true on a successful GPU write,
// false if the slot isn't mounted yet or the door is absent.
export function patchDynSlot(slotId: string, verts: number[] | Float32Array, count: number): boolean {
  const host: any = globalThis as any;
  if (typeof host.__scene3d_patch_dyn !== 'function') return false;
  const view = verts instanceof Float32Array ? verts : new Float32Array(verts);
  return host.__scene3d_patch_dyn(slotId, view, count | 0) === 1;
}
Scene3DBase.Mesh = ({
  geometry, params, material, color, position, rotation, scale, radius, tubeRadius, sizeX, sizeY, sizeZ,
  texture, textureKey, dynamicKey, heights, hfCols, hfRows, waveAmplitude, waveLength, waveSpeed,
  waveDirection, waveDirX, waveDirZ, wavePhase, groundFormula, groundData, hostKey, ...rest
}: any) => {
  // ── host-resident geometry reference (drop-to-view) ──────────────────
  // `hostKey` names a mesh the HOST already holds — parsed from a dropped GLB/OBJ by
  // __mesh_load_file and stashed in gpu/3d.zig under that key. No verts cross the
  // bridge: the node carries only the key, and the host's geo-cache resolves it on the
  // first draw and redraws it natively every frame. This is the leanest mesh path —
  // one string, zero geometry. Pair with <Scene3D.Camera orbit /> for the full viewer.
  if (typeof hostKey === 'string' && hostKey.length > 0) {
    const [hr, hg, hb] = _hexToRgb(typeof material === 'string' ? material : (material?.color ?? color), [0.8, 0.8, 0.82]);
    const [hpx, hpy, hpz] = _vec3(position, 0, 0, 0);
    const [hsx, hsy, hsz] = _scaleVec3(scale);
    return h('View', {
      ...rest,
      scene3dMesh: true,
      scene3dGeomKey: hostKey,
      scene3dColorR: hr, scene3dColorG: hg, scene3dColorB: hb,
      scene3dPosX: hpx, scene3dPosY: hpy, scene3dPosZ: hpz,
      scene3dScaleX: hsx, scene3dScaleY: hsy, scene3dScaleZ: hsz,
    });
  }

  // Data-shape ground: a WGSL surface formula + its per-cell ref stream make the
  // mesh synthesise its look per fragment (no baked texture). Only the host-side
  // heightfield path consumes them; a normal textured mesh ignores both.
  const groundProps = (typeof groundFormula === 'string' && groundFormula.length > 0 && Array.isArray(groundData))
    ? { scene3dGroundFormula: groundFormula, scene3dGroundData: groundData }
    : null;
  const matColor = typeof material === 'string' ? material : (material?.color ?? color);
  const [r, g, b] = _hexToRgb(matColor, [0.8, 0.8, 0.8]);
  // Opacity comes only from an object material (`{ color, opacity }`). <1 makes
  // the mesh glass: the host routes it through the back-to-front transparent pass.
  const matOpacity = (material && typeof material === 'object' && Number.isFinite(material.opacity))
    ? Math.max(0, Math.min(1, material.opacity))
    : 1;
  const [px, py, pz] = _vec3(position, 0, 0, 0);
  const [rx, ry, rz] = _vec3(rotation, 0, 0, 0);
  const [sx, sy, sz] = _scaleVec3(scale);
  // Texture: { width, height, hex } where hex is a continuous RRGGBBAA
  // string with 8 chars per pixel (length must equal 8*width*height).
  // The host parses the hex into a raw RGBA buffer and uploads once,
  // caching by content hash so identical textures across meshes/renders
  // share one GPU texture. Without `texture`, the mesh samples the global
  // 1×1 white default and the fragment shader collapses to plain color.
  const tex = texture && typeof texture === 'object' ? texture : null;
  const texW = tex && Number.isFinite(tex.width) ? Math.max(0, tex.width | 0) : 0;
  const texH = tex && Number.isFinite(tex.height) ? Math.max(0, tex.height | 0) : 0;
  const texHex = tex && typeof tex.hex === 'string' ? tex.hex : '';
  const texKey = typeof textureKey === 'string' && textureKey.length > 0 ? textureKey : '';
  const texData = texHex && texW > 0 && texH > 0 && texHex.length === texW * texH * 8 ? texHex : '';

  // ── @reactjit/geometries registry path ──────────────────────────────
  // geometry={Box} (a generator def, not a string) → run the TS generator ONCE
  // per unique params (interned in JS), ship the verts + the intern key. The
  // host retains the verts in a GPU buffer and redraws the slice every frame
  // with NO per-frame regeneration; the framework never learns a shape name.
  // This is the canonical path; the string branch below is legacy (migrating).
  const geomIntern = require('./geometries/intern');
  if (geomIntern.isGeometryDef(geometry)) {
    // Dynamic (live-edited) geometry path: a mesh whose verts change as the user
    // edits (a sculpted heightfield). The intern cache is for STATIC shapes — a
    // new content key per edit fills it and the mesh vanishes. Instead, generate
    // fresh verts (no JS cache) and ship them under a STABLE "~dyn~<id>~<ver>" key;
    // the host keeps one reused slot per id and overwrites it on version change.
    // dynamicKey must already encode a version that changes when the verts change.
    const dyn = typeof dynamicKey === 'string' && dynamicKey.length > 0 ? dynamicKey : '';
    if (dyn) {
      // The host's dynSlotLocate parses "<slotId>~<version>" at the LAST '~';
      // a key without one resolves to no slot and the mesh is SILENTLY skipped
      // (invisible geometry, no error). Fail loudly here instead.
      if (!dyn.includes('~')) {
        throw new Error(
          `<Scene3D.Mesh dynamicKey="${dyn}"> must be "<slotId>~<version>" — ` +
          `the '~' separator is required (e.g. "mycart.head~3"). Without it the ` +
          `host finds no dyn slot and silently drops the mesh.`,
        );
      }
      const merged = { ...(geometry.defaults || {}), ...(params || {}) };
      // Host-generated heightfield fast path: a live-sculpted regular grid has fixed
      // topology, only its heights move — so ship the cols×rows height grid (the host
      // bakes the verts via gpu/3d.zig hfGen) instead of ~86k baked verts/sculpt
      // across the bridge. Skip it for a travelling wave (amplitude>0), which needs
      // per-t regeneration — that stays on the verts path below.
      const wv = (merged as any).wave;
      const hasWave = wv && Math.abs(wv.amplitude) > 0.0001 && wv.length > 0.0001;
      if ((geometry as any).hostKind === 'heightfield' && (merged as any).heights && !hasWave) {
        const m: any = merged;
        // Identity-stable shipment: convert + scan ONCE per source heights array.
        // Re-renders with the SAME source array reuse the same shipped array, so the
        // prop diff (identity compare) sees "unchanged" and nothing crosses the
        // bridge — without this, every ancestor re-render re-shipped the whole grid
        // and re-baked the host mesh.
        let ship = _hfShipCache.get(m.heights as object);
        if (!ship) {
          const arr = Array.from(m.heights as ArrayLike<number>);
          // Conservative bounds radius without baking verts: corner extent + tallest
          // sample (skirt drops to base 0, so |y| is bounded by max|height|).
          let maxAbsY = 0;
          for (let n = 0; n < arr.length; n++) { const a = Math.abs(arr[n]); if (a > maxAbsY) maxAbsY = a; }
          ship = { arr, maxAbsY };
          _hfShipCache.set(m.heights as object, ship);
        }
        const halfW = (m.width ?? 1) / 2, halfD = (m.depth ?? 1) / 2;
        const boundsRadius = Math.sqrt(halfW * halfW + halfD * halfD + ship.maxAbsY * ship.maxAbsY);
        // Optional per-cell water depth grid (water meshes only): identity-stable
        // like heights, baked into UV.x by gpu/3d.zig hfGen for the water shader.
        let depthShip: number[] | undefined;
        if (Array.isArray(m.depths) && m.depths.length === ship.arr.length) {
          depthShip = _hfDepthShipCache.get(m.depths as object);
          if (!depthShip) { depthShip = Array.from(m.depths as ArrayLike<number>); _hfDepthShipCache.set(m.depths as object, depthShip); }
        }
        return h('View', {
          ...rest,
          scene3dMesh: true,
          scene3dGeomKey: '~hf~' + dyn,
          scene3dHeights: ship.arr,
          ...(depthShip ? { scene3dHfDepths: depthShip } : {}),
          scene3dHfCols: m.cols, scene3dHfRows: m.rows,
          scene3dHfWidth: m.width ?? 1, scene3dHfDepth: m.depth ?? 1, scene3dHfBase: m.base ?? 0,
          scene3dBoundsRadius: boundsRadius,
          scene3dPosX: px, scene3dPosY: py, scene3dPosZ: pz,
          scene3dRotX: rx, scene3dRotY: ry, scene3dRotZ: rz,
          scene3dScaleX: sx, scene3dScaleY: sy, scene3dScaleZ: sz,
          scene3dColorR: r, scene3dColorG: g, scene3dColorB: b, scene3dColorA: matOpacity,
          scene3dTexW: texW,
          scene3dTexH: texH,
          scene3dTexData: texData,
          ...(texKey ? { scene3dTexKey: texKey } : {}),
          ...(groundProps ?? {}),
        });
      }
      // Same identity-stability rule as the hf path: the dynamicKey by contract
      // encodes a version that changes when the verts change, so equal key ⇒ equal
      // verts — regenerate + reconvert ONLY when the key is new. Without this,
      // every re-render re-ran the full generator. Ship discipline mirrors the
      // static intern path below: the first mesh for a dynamic key carries the
      // heavy vertex buffer; siblings/remounts carry only the key and let the host
      // draw from the retained dynamic slot.
      let dynShip = _dynGeomCache.get(dyn);
      if (!dynShip) {
        const gd = geometry.generate(merged);
        dynShip = { verts: gd.positions, count: gd.count, radius: gd.bounds.radius };
        if (_dynGeomCache.size >= _DYN_GEOM_CACHE_MAX) {
          const oldest = _dynGeomCache.keys().next().value;
          if (oldest != null) _dynGeomCache.delete(oldest);
        }
        _dynGeomCache.set(dyn, dynShip);
      }
      // Ship verts only when the host slot for this slotId doesn't already hold THIS
      // exact version. The slotId is everything before the final '~' (matching the
      // host's dynSlotLocate). If a different version reused the slot since we last
      // shipped, re-ship — never trust the host to still hold a version we didn't
      // last give it (the cross-model ghost-mesh bug).
      const slotId = dyn.slice(0, dyn.lastIndexOf('~'));
      const dynGeomProps = _dynSlotShipped.get(slotId) === dyn
        ? { scene3dGeomKey: '~dyn~' + dyn, scene3dBoundsRadius: dynShip.radius }
        : _scene3dVertexProps('~dyn~' + dyn, dynShip.verts, dynShip.count, dynShip.radius);
      _dynSlotShipped.set(slotId, dyn);
      return h('View', {
        ...rest,
        scene3dMesh: true,
        ...dynGeomProps,
        scene3dPosX: px, scene3dPosY: py, scene3dPosZ: pz,
        scene3dRotX: rx, scene3dRotY: ry, scene3dRotZ: rz,
        scene3dScaleX: sx, scene3dScaleY: sy, scene3dScaleZ: sz,
        scene3dColorR: r, scene3dColorG: g, scene3dColorB: b, scene3dColorA: matOpacity,
        scene3dTexW: texW,
        scene3dTexH: texH,
        scene3dTexData: texData,
        ...(texKey ? { scene3dTexKey: texKey } : {}),
      });
    }
    const g3 = geomIntern.internGeometry(geometry, params);
    // Bridge-cost dedup: the first mesh per key ships {key + verts + count}
    // so the host caches the heavy VERTICES; every subsequent mesh ships only the
    // key and the host looks up the cached buffer. 500 coconuts → ONE vertex
    // payload across the bridge, not 500.
    // BUT bounds is a per-NODE prop (estimateMeshRadius reads node.scene3d_bounds_radius
    // for the draw-radius cull), so it must ride EVERY mesh — gating it behind
    // firstForKey leaves any node recreated after the key was first shipped (a
    // hot-reload, a world swap, an instance sibling) with bounds 0 → the cull falls
    // back to radius ~1 and pops a big mesh (e.g. a mountain) while it's still on
    // screen. Cheap float; always send it, like Scene3D.Instances already does.
    const firstForKey = !geomIntern.hasShipped(g3.key);
    if (firstForKey) geomIntern.markShipped(g3.key);
    const geomProps = firstForKey
      ? _scene3dVertexProps(g3.key, g3.vertices, g3.count, g3.bounds)
      : { scene3dGeomKey: g3.key, scene3dBoundsRadius: g3.bounds };
    return h('View', {
      ...rest,
      scene3dMesh: true,
      ...geomProps,
      scene3dPosX: px, scene3dPosY: py, scene3dPosZ: pz,
      scene3dRotX: rx, scene3dRotY: ry, scene3dRotZ: rz,
      scene3dScaleX: sx, scene3dScaleY: sy, scene3dScaleZ: sz,
      scene3dColorR: r, scene3dColorG: g, scene3dColorB: b, scene3dColorA: matOpacity,
      scene3dTexW: texW,
      scene3dTexH: texH,
      scene3dTexData: texData,
      ...(texKey ? { scene3dTexKey: texKey } : {}),
    });
  }

  // ── String geometry is GONE ──────────────────────────────────────────
  // geometry="box"|"sphere"|… and the {kind,radius,…} object form were removed
  // along with the framework's shape generators. There is exactly one way to
  // give a mesh geometry now: a @reactjit/geometries generator + params. This
  // throws on purpose so a cart still on the old path fails loudly with a fix.
  const got = typeof geometry === 'string' ? `"${geometry}"` : (geometry == null ? String(geometry) : 'a legacy object');
  throw new Error(
    `<Scene3D.Mesh geometry={...}> no longer accepts ${got}. Use a @reactjit/geometries ` +
    `generator + params, e.g.  import * as Geometry from '@reactjit/geometries';  ` +
    `<Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} />. ` +
    `(sizeX/Y/Z → params.width/height/depth; sphere radius → params.radius; cylinder radius+sizeY → params.radius+height.)`,
  );
};
Scene3DBase.Instances = ({
  geometry, params, data, count, stride, boundsRadius, center, textureKey, ...rest
}: any) => {
  const [cx, cy, cz] = _vec3(center, 0, 0, 0);
  const geomIntern = require('./geometries/intern');
  if (!geomIntern.isGeometryDef(geometry)) {
    throw new Error('<Scene3D.Instances geometry={...}> requires a @reactjit/geometries generator.');
  }
  const g3 = geomIntern.internGeometry(geometry, params);
  // ALWAYS ship verts for an instanced bucket — never gate them behind the global
  // shipped-set (req_0735). A bucket carries ONE geometry payload for ALL its
  // instances, so the bridge-cost dedup (which exists to collapse N payloads from
  // N repeated NON-instanced meshes) saves nothing here. Gating it only creates a
  // silent-drop hazard: if any OTHER mesh flips markShipped(key) but its verts
  // never reach the host intern cache (it was culled, painted into a capture, or
  // unmounted before paint), this bucket would ship key-only, miss lookupGeometry,
  // and vanish — even with the vertex buffer nearly empty. That is exactly the
  // iso-pane "buildings + grid gone" bug: census showed inst_seen=15
  // inst_collected=0 with retained=32k/3670k (0.9% full). The host dedups by key
  // on its side (lookupGeometry hits for the 2nd+ bucket sharing a key), so
  // always-shipping costs ONE intern, not one per bucket. We still markShipped so
  // non-instanced Scene3D.Mesh siblings cache-hit once the host actually has it.
  geomIntern.markShipped(g3.key);
  const geomProps = _scene3dVertexProps(g3.key, g3.vertices, g3.count, boundsRadius ?? g3.bounds);
  return h('View', {
    ...rest,
    scene3dMesh: true,
    ...geomProps,
    scene3dPosX: cx, scene3dPosY: cy, scene3dPosZ: cz,
    scene3dInstanceData: data,
    scene3dInstanceCount: count ?? 0,
    scene3dInstanceStride: stride ?? 9,
    ...(textureKey ? { scene3dTexKey: textureKey } : {}),
  });
};
Scene3DBase.AmbientLight = ({ color, intensity, ...rest }: any) => {
  const [r, g, b] = _hexToRgb(color, [1, 1, 1]);
  return h('View', {
    ...rest,
    scene3dLight: true,
    scene3dLightType: 'ambient',
    scene3dColorR: r, scene3dColorG: g, scene3dColorB: b,
    scene3dIntensity: intensity ?? 0.3,
  });
};
Scene3DBase.DirectionalLight = ({ direction, color, intensity, ...rest }: any) => {
  const [dx, dy, dz] = _vec3(direction, 0, -1, 0);
  const [r, g, b] = _hexToRgb(color, [1, 1, 1]);
  return h('View', {
    ...rest,
    scene3dLight: true,
    scene3dLightType: 'directional',
    scene3dDirX: dx, scene3dDirY: dy, scene3dDirZ: dz,
    scene3dColorR: r, scene3dColorG: g, scene3dColorB: b,
    scene3dIntensity: intensity ?? 1.0,
  });
};
// PointLight — an omni "bulb" (a sign-edge bulb, a lamp): a tip that throws
// light in every direction, falling off over `range`. The host treats it as the
// user's pyramid opened all the way (spread 0 → full sphere).
Scene3DBase.PointLight = ({ position, color, intensity, range, colorFromRegion, ...rest }: any) => {
  const [px, py, pz] = _vec3(position, 0, 0, 0);
  const [r, g, b] = _hexToRgb(color, [1, 1, 1]);
  return h('View', {
    ...rest,
    scene3dLight: true,
    scene3dLightType: 'point',
    scene3dPosX: px, scene3dPosY: py, scene3dPosZ: pz,
    scene3dColorR: r, scene3dColorG: g, scene3dColorB: b,
    scene3dIntensity: intensity ?? 1.0,
    scene3dRange: range ?? 0,
    // colorFrom: a live material region id — the host steps this light's color
    // from the region's palette slots each frame (the lavalamp's glow).
    scene3dLightRegion: colorFromRegion ?? -1,
  });
};
// SpotLight — the user's pyramid: a tip at `position`, aimed down `direction`,
// opening to a `cone` half-angle (degrees) and carrying `range`. Narrow cone =
// a spotlight; wide cone approaches the omni bulb. A spot CASTS A SHADOW by
// default (shadows are part of a light) — the first shadow-casting spot in a
// scene owns the shadow map today; pass castsShadow={false} to opt a spot out.
Scene3DBase.SpotLight = ({ position, direction, color, intensity, cone, range, castsShadow, colorFromRegion, ...rest }: any) => {
  const [px, py, pz] = _vec3(position, 0, 0, 0);
  const [dx, dy, dz] = _vec3(direction, 0, -1, 0);
  const [r, g, b] = _hexToRgb(color, [1, 1, 1]);
  return h('View', {
    ...rest,
    scene3dLight: true,
    scene3dLightType: 'spot',
    scene3dPosX: px, scene3dPosY: py, scene3dPosZ: pz,
    scene3dDirX: dx, scene3dDirY: dy, scene3dDirZ: dz,
    scene3dColorR: r, scene3dColorG: g, scene3dColorB: b,
    scene3dIntensity: intensity ?? 1.0,
    scene3dSpread: cone ?? 30,
    scene3dRange: range ?? 0,
    scene3dCastShadow: castsShadow ?? true,
    scene3dLightRegion: colorFromRegion ?? -1,
  });
};
// OrbitControls — host has no flag for this today (no scene3d_orbit on
// layout.zig). No-op until a hook-driven camera mutator lands or the host
// gets an orbit input handler. Render nothing rather than emit a misleading
// node.
Scene3DBase.OrbitControls = (_props: any) => null;
export const Scene3D: any = Scene3DBase;

// ── Audio — declarative wrapper around framework/audio.zig ─────────────────
//
// Mirrors Physics / Scene3D: a base <Audio> root plus typed sub-components.
// Lazy require() keeps audio.tsx out of the primitives init graph until a
// cart actually mounts an <Audio> tree.
//
//   <Audio gain={0.8}>
//     <Audio.Module id="voice1" type="instrument" tone={0.5} drive={0.3} />
//     <Audio.Module id="delay1" type="delay" feedback={0.4} time={0.25} />
//     <Audio.Connection from="voice1" to="delay1" />
//   </Audio>
//
//   const audio = useAudio();
//   audio.noteOn('voice1', 60);
const AudioBase: any = function Audio(props: any) {
  return require('./audio').Audio(props);
};
AudioBase.Module     = function Module(props: any)     { return require('./audio').Audio.Module(props); };
AudioBase.Connection = function Connection(props: any) { return require('./audio').Audio.Connection(props); };
export const Audio: any = AudioBase;

// ── AudioControls — visual audio control surfaces ───────────────────────────
//
// These are UI atoms backed by useAudio(): keybeds, pads, sliders, step grids,
// transport, scopes, generated module panels, and host-managed pattern tracks.
const AudioControlsBase: any = {};
AudioControlsBase.Keybed = function Keybed(props: any) { return require('./audio/controls').AudioControls.Keybed(props); };
AudioControlsBase.Pads = function Pads(props: any) { return require('./audio/controls').AudioControls.Pads(props); };
AudioControlsBase.Slider = function Slider(props: any) { return require('./audio/controls').AudioControls.Slider(props); };
AudioControlsBase.XYPad = function XYPad(props: any) { return require('./audio/controls').AudioControls.XYPad(props); };
AudioControlsBase.StepGrid = function StepGrid(props: any) { return require('./audio/controls').AudioControls.StepGrid(props); };
AudioControlsBase.StepPattern = function StepPattern(props: any) { return require('./audio/controls').AudioControls.StepPattern(props); };
AudioControlsBase.StepMeter = function StepMeter(props: any) { return require('./audio/controls').AudioControls.StepMeter(props); };
AudioControlsBase.LevelMeter = function LevelMeter(props: any) { return require('./audio/controls').AudioControls.LevelMeter(props); };
AudioControlsBase.Knob = function Knob(props: any) { return require('./audio/controls').AudioControls.Knob(props); };
AudioControlsBase.TrackSelector = function TrackSelector(props: any) { return require('./audio/controls').AudioControls.TrackSelector(props); };
AudioControlsBase.PatternTrack = function PatternTrack(props: any) { return require('./audio/controls').AudioControls.PatternTrack(props); };
AudioControlsBase.Transport = function Transport(props: any) { return require('./audio/controls').AudioControls.Transport(props); };
AudioControlsBase.Scope = function Scope(props: any) { return require('./audio/controls').AudioControls.Scope(props); };
AudioControlsBase.ModulePanel = function ModulePanel(props: any) { return require('./audio/controls').AudioControls.ModulePanel(props); };
export const AudioControls: any = AudioControlsBase;

// ── Canvas — pan/zoomable node surface ──────────────────────

const CanvasBase: any = (props: any) => h('Canvas', props, props.children);
CanvasBase.Node = (props: any) => h('Canvas.Node', props, props.children);
CanvasBase.Path = (props: any) => h('Canvas.Path', props, props.children);
CanvasBase.Clamp = (props: any) => h('Canvas.Clamp', props, props.children);
export const Canvas: any = CanvasBase;

// ── Graph — lightweight charting surface (no pan/zoom/drag) ──

const GraphBase: any = (props: any) => h('Graph', props, props.children);
GraphBase.Path = (props: any) => h('Graph.Path', props, props.children);
GraphBase.Node = (props: any) => h('Graph.Node', props, props.children);
// Graph.Polyline — straight-line analog of Graph.Path. `points` is a flat
// array {x0,y0,x1,y1,…}. Engine parses it ONCE at update time and emits a
// batched capsule SDF per segment every paint. No bezier flattening, no
// d-string parsing — bypasses the per-frame work that makes <Graph.Path>
// expensive at chart scale. Stroke color via `stroke`, width via
// `strokeWidth` — same names as Graph.Path so the parser dispatches them
// identically (color → text_color, width → canvas_stroke_width).
// `segments` (req_1275): treat `points` as a DISJOINT segment list (pairs
// p0p1, p2p3, …) instead of a connected strip — so ONE node draws N independent
// capsule lines (a mesh wireframe's edges) with no spurious connectors and no
// per-edge reconciler node. Without it, points are a connected polyline (charts).
GraphBase.Polyline = ({ segments, ...props }: any) =>
  h('Graph.Polyline', segments ? { ...props, polylineSegments: true } : props, props.children);
// Graph.Polygon — filled sibling of Graph.Polyline. Same flat point array
// shape; engine triangle-fans from vertex 0 into the batched polys pipeline
// (one triangle per pair of subsequent edges). Fan triangulation requires
// the shape be star-shaped from v0 — true for bars, fan-baseline area
// charts, donut wedges, radar polygons. Color via `fill` (matches Path).
GraphBase.Polygon = (props: any) => h('Graph.Polygon', props, props.children);
// Graph.GCurve — Loop-Blinn quadratic-bezier-triangle filler. `gcurves` is
// a flat array of 6-float groups: each group {p0x,p0y, p1x,p1y, p2x,p2y}
// defines ONE triangle whose three corners are the control points of a
// quadratic bezier; the engine's gcurve_fill pipeline does a per-pixel
// `u*u - v < 0` interior test for sub-pixel-perfect curve fills at any
// scale, no SDF texture, no tessellation. Compose multiple groups for
// shapes that need several curve segments (donut rim, area-chart top,
// radar curve sides, etc). Color via `fill` (canvas_fill_color).
GraphBase.GCurve = (props: any) => h('Graph.GCurve', props, props.children);
export const Graph: any = GraphBase;

// ── SdfIcon — pre-baked icon rendered as one textured quad ─────────────
//
// `name` matches a baked icon (see runtime/icons/baked-names.ts). The host
// reads `iconName` and paints via framework/gpu/sdf_icons.zig — one batched
// instanced draw for the whole frame, regardless of icon count. Cheap.
//
// For names NOT in the atlas, runtime/icons/Icon.tsx falls back to the
// legacy <Graph.Path> renderer; this primitive is the leaf, it doesn't
// know about the fallback.
export const SdfIcon: any = ({ name, color, size, ...rest }: any) =>
  h('View', {
    ...rest,
    iconName: name,
    style: {
      width: size ?? 16,
      height: size ?? 16,
      color: color ?? 'theme:ink',
      ...(rest.style ?? {}),
    },
  });

// ── Render — external display/app capture surface ─────────────

export const Render: any = (props: any) => h('Render', props, props.children);

// ── Effect — per-pixel generative surface ─────────────────────
// <Effect shader={wgsl} data={[...]}>
//   `data` (optional) — Float32Array-shaped values uploaded once per change
//   to the engine's GPU storage buffer at @group(0) @binding(1). Lets shader
//   source stay static while live data updates without recompiling the
//   pipeline. Aliased to engine prop `effectData`.
export const Effect: any = ({ data, ...rest }: any) =>
  h('Effect', { ...rest, ...(data != null ? { effectData: data } : {}) }, rest.children);

// ── Boxxx — a batch of rounded rects emitted DIRECTLY into the instanced-rect
// pipeline as ONE node. No per-box reconciler node, no layout solve, no
// MAX_CHILDREN cap, and no Effect/gather pass. `boxes` is a flat spec; colors
// are '#rrggbb'/'#rrggbbaa'. Box x/y are relative to the Boxxx box's top-left,
// so give it a size via style (e.g. width/height: '100%').
const __boxxxHexRGBA = (hex?: string): [number, number, number, number] => {
  if (!hex || hex[0] !== '#') return [0, 0, 0, 0];
  const s = hex.slice(1);
  const n = (a: number, b: number) => parseInt(s.slice(a, b), 16) / 255;
  return [n(0, 2), n(2, 4), n(4, 6), s.length >= 8 ? n(6, 8) : 1];
};
export type BoxxxRect = {
  x: number; y: number; w: number; h: number;
  radius?: number; borderW?: number; bg?: string; border?: string;
};
const __packBoxxx = (boxes: BoxxxRect[]): number[] => {
  const out = new Array<number>(1 + boxes.length * 14);
  out[0] = boxes.length;
  let o = 1;
  for (let j = 0; j < boxes.length; j++) {
    const b = boxes[j];
    const f = __boxxxHexRGBA(b.bg);
    const d = __boxxxHexRGBA(b.border);
    out[o++] = b.x; out[o++] = b.y; out[o++] = b.w; out[o++] = b.h;
    out[o++] = f[0]; out[o++] = f[1]; out[o++] = f[2]; out[o++] = f[3];
    out[o++] = b.radius ?? 0; out[o++] = b.borderW ?? 0;
    out[o++] = d[0]; out[o++] = d[1]; out[o++] = d[2]; out[o++] = d[3];
  }
  return out;
};
// Two modes:
//   <Boxxx boxes={[...]}>            flat-spec — boxes are pure DATA (no nodes,
//                                    no layout, no MAX_CHILDREN). Max speed.
//   <Boxxx><Box/><Box/></Boxxx>      children — normal JSX, laid out by flex as
//                                    real nodes, but PAINTED as one batched
//                                    emit (the host walks their computed boxes
//                                    instead of scatter-painting each). Box
//                                    children only for now; Text is the next
//                                    layer (glyph-atlas emit).
export const Boxxx: any = ({ boxes, children, ...rest }: any) =>
  boxes != null
    ? h('RectBatch', { ...rest, effectData: __packBoxxx(boxes) }, null)
    : h('RectBatch', rest, children);

// ── Slider — host-driven slider (SLIDER-0611, the V23 law for scrubbing) ─
// <Slider value min max step onChange onCommit style />
//   The ENGINE owns the thumb while the button is down: motion updates the
//   pool-side value and repaints with zero JS in the loop. `onChange(v)`
//   streams the live value (throttled ~60Hz, change-deduped) for mirrors
//   like a paired number entry; `onCommit(v)` fires ONCE on release and is
//   the authoritative settle — wire setState there, never per-move.
//   Mid-drag sliderValue echoes are ignored host-side, so a controlled
//   `value` never fights the thumb. Track tint = style.backgroundColor,
//   fill tint = style.color; knob is engine chrome.
//
// Media scrubber (MEDIASLIDER-0705):
// <Slider media={videoSrc} hoverLatch="key" hoverWidth={64} hoverStep={1}
//         onHoverValue={(sec) => ...} onCommit={...} />
//   `media` binds the slider to a playing <Video> by src — the engine then
//   owns value AND range end to end (follows mpv time-pos when idle,
//   streams keyframe seeks while dragging, exact seek + settle on release);
//   value/min/max props are ignored. `hoverLatch` names a latch the engine
//   writes the tooltip left-position to on every hover/drag motion — bind a
//   sibling Box's left to 'latch:<hoverLatch>' for a zero-React tooltip
//   (hoverWidth = tooltip width for the centering clamp). `onHoverValue`
//   fires only when the pointer crosses into a new `hoverStep`-sized bucket
//   (quantize-by-meaning), and once with -1 when the pointer leaves.
export const Slider: any = ({ value = 0, min = 0, max = 1, step = 0, media, hoverLatch, hoverWidth = 0, hoverStep = 1, onChange, onCommit, onHoverValue, style, ...rest }: any) =>
  h('Slider', {
    ...rest,
    // sliderMedia must precede sliderValue/Min/Max: v8_app's ownership
    // guard checks the binding while applying props in key order.
    ...(media
      ? { sliderMedia: media }
      : { sliderValue: value, sliderMin: min, sliderMax: max }),
    sliderStep: step,
    ...(media || hoverLatch || onHoverValue
      ? {
          sliderHover: true,
          sliderHoverStep: hoverStep,
          ...(hoverLatch ? { sliderHoverLatch: hoverLatch, sliderHoverWidth: hoverWidth } : {}),
        }
      : {}),
    onChange: onChange ? (e: any) => onChange(typeof e === 'number' ? e : e?.value ?? 0) : undefined,
    onCommit: onCommit ? (e: any) => onCommit(typeof e === 'number' ? e : e?.value ?? 0) : undefined,
    onHoverValue: onHoverValue ? (e: any) => onHoverValue(typeof e === 'number' ? e : e?.value ?? -1) : undefined,
    style: { height: 14, ...style },
  }, null);

// ── Paintable — persistent GPU mask texture, no visible rendering ─
// <Paintable id="my-mask" w={W} h={H} />
//   Allocates an R8Unorm GPU texture keyed by `id` at host_tree CREATE
//   (synchronously, before any consumer first renders). The texture
//   survives across React renders and is destroyed when the <Paintable>
//   unmounts. Renders nothing visible — its job is to own the handle so
//   other Effects can sample it via `textures={[id]}`. Paint into it
//   via the usePaintable hook's imperative ops (V8 binding calls; no
//   React state in the input path).
//   Pass `rgba` for an RGBA8Unorm colour texture (the Studio model painter,
//   N-colour flat paint) instead of the default single-channel R8 mask.
export const Paintable: any = ({ id, w: ptW, h: ptH, rgba }: { id: string; w: number; h: number; rgba?: boolean }) =>
  h('Paintable', { paintableId: id, paintableW: ptW, paintableH: ptH, paintableRGBA: !!rgba });

// ── Native — universal escape hatch for host-handled types ──

function nativePropsEqual(prev: any, next: any): boolean {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;
  for (const key of nextKeys) {
    if (key === 'children') continue;
    if (key.startsWith('on') && key.length > 2 && key[2] === key[2].toUpperCase()) {
      if ((key in prev) !== (key in next)) return false;
      continue;
    }
    if ((prev as any)[key] !== (next as any)[key]) return false;
  }
  return true;
}

// React.memo deferred to first render — calling require('react').memo at
// module init time captures undefined (see header comment). First render
// memoizes the inner component; subsequent renders reuse the cached memo
// component, so equality comparisons fire as usual.
let _NativeMemoized: any = null;
function getNativeMemoized(): any {
  if (_NativeMemoized) return _NativeMemoized;
  const R: any = require('react');
  _NativeMemoized = R.memo(function NativeInner({ type, ...props }: any) {
    return R.createElement(type, props);
  }, nativePropsEqual);
  return _NativeMemoized;
}

export const Native: any = function Native(props: any) {
  return h(getNativeMemoized(), props);
};
