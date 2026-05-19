// tui/host.ts — character-grid backend for renderer/hostConfig.
//
// We are NOT a reconciler. The reconciler is renderer/hostConfig.ts; we
// just consume the Instance tree it builds. Each paint walks
// getRootInstances() fresh, lays out on a character grid, and emits 24-bit
// ANSI with dirty-cell diffing.
//
// Why this shape: the GPU host (framework/*.zig) reads style.* off the
// same Instance tree. By consuming the same tree (and the same style prop
// names — flexDirection, gap, padding, flexGrow, backgroundColor, color,
// borderColor, borderWidth, fontWeight, overflow), any cart that uses
// runtime/primitives.tsx renders here without source changes for the
// subset of primitives we support (View/Text/Pressable/ScrollView).
//
// Other primitives (Image/Canvas/Video/etc.) render as placeholders in
// Phase 1 — see tui/entry.tsx for the supported set.

import type { Instance, TextInstance } from '../renderer/hostConfig';
import { getRootInstances, handlerRegistry } from '../renderer/hostConfig';
import { paintEffect, bindEffectScheduler } from './effects';

// ── Repaint scheduling ───────────────────────────────────────────────

let scheduled = false;
let entered = false;

// ── Selection state ────────────────────────────────────────────────
//
// Drag-painted selection that survives repaints. Native terminal
// selection breaks on any cell write to the row; we own this one in our
// paint pipeline so it stays put no matter how busy the cart is. On
// release the cells under the rect get sent to the system clipboard via
// OSC 52.
type Pt = { x: number; y: number };
let selAnchor: Pt | null = null; // mouse-down origin
let selFocus: Pt | null = null;  // current end (drag head or release pt)
let selDragging = false;          // true between press and release

export function requestPaint(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; if (!paused) safeRepaint(); });
}

// Throttled paint scheduler. Microtask-driven requestPaint runs as fast
// as the event loop allows — perfect for cart-state→repaint, but a tight
// self-feedback loop when used to "keep polling for inner PTY redraws".
// requestPaintSoon trampolines through setTimeout(16) so a stretch of
// repaints during a Terminal warm-pump window caps at ~60fps instead of
// burning a core.
let softScheduled = false;
export function requestPaintSoon(delayMs = 16): void {
  if (scheduled || softScheduled) return;
  softScheduled = true;
  setTimeout(() => { softScheduled = false; if (!paused) safeRepaint(); }, delayMs);
}

// repaint() guarded against exceptions. Without this, a throw in any
// cart component (e.g. a layout edge case at extreme window sizes) takes
// down the microtask trampoline and freezes the stdin pump, leaving
// the terminal stuck in alt-screen + MOUSE_ON with no input being
// drained — which presents as "UI gone, scroll prints raw mouse SGR".
// The catch keeps the process responsive and logs to stderr so the
// failing render is recoverable + diagnosable.
let lastPaintErrorTs = 0;
function safeRepaint(): void {
  try {
    repaint();
  } catch (e: any) {
    // Rate-limit to avoid drowning stderr if the cart's render is
    // permanently broken — one report per 2s is plenty.
    const now = Date.now();
    if (now - lastPaintErrorTs > 2000) {
      lastPaintErrorTs = now;
      try { (process.stderr as any).write?.(`[paint] ${e?.stack ?? e}\n`); } catch {}
    }
  }
}

// Terminal-resize warm pump. After ANY Terminal slot resize (inner box
// changed, OR outer window resize via pollResize) the inner program will
// emit its SIGWINCH-driven redraw over the next several frames — for
// nested-VM setups like claude-ss (PTY → vsock → outer PTY) that round
// trip can be 100-500ms. The drained-only gate in the Terminal paint
// block won't reschedule a paint until the bytes arrive, but nothing
// will trigger a paint until then either, so the bytes sit in the PTY
// buffer until a keypress or mouse event.
//
// Solution: any resize sets this timestamp, and the Terminal paint
// block treats "warm" the same as "drained" — schedules another paint,
// throttled to 60fps. Pump dies on its own after warmMs elapses with no
// new resize.
let termWarmUntil = 0;
export function markTermWarm(durationMs = 1500): void {
  const until = Date.now() + durationMs;
  if (until > termWarmUntil) termWarmUntil = until;
  requestPaint();
}

// tickDrain polls the PTY; when it drains new data it returns 1 and the
// preamble calls this. Immediate repaint — no polling latency.
(globalThis as any).__onVtermUpdate = () => requestPaint();

// One-shot wiring so <Effect> animation frames can request paints, and so
// shaders can read mouse coords for parallax. Both go through this seam to
// avoid pulling host internals into effects.ts.
bindEffectScheduler(requestPaint, getMouse);

// forcePaint — discard the prev-frame buffer so the next paint is a
// full repaint. Use after large structural tree changes (route swaps,
// tab switches) where cells the new tree doesn't cover would otherwise
// stay frozen at their old content. The cost is one full-screen emit
// (~1000 bytes/row vs ~30 bytes/cell), payable once per transition.
export function forcePaint(): void {
  prev = null;
  requestPaint();
}

// ── Pause ──────────────────────────────────────────────────────────
//
// While paused, repaint() is a no-op. The screen stays frozen at the
// last painted state — terminal selection / highlight on any row stays
// intact because nothing is overwriting cells. Use case: live log views
// where a column ticks every frame and you want to copy a row.
//
// Carts can bind any key to togglePaused(). The host also auto-binds
// Ctrl+P (\x10) as a default so users always have an escape hatch.

let paused = false;

export function isPaused(): boolean { return paused; }
export function setPaused(p: boolean): void {
  if (paused === p) return;
  paused = p;
  if (!paused) {
    // Resume: force a full repaint so the screen catches up with any
    // state changes that happened while frozen.
    prev = null;
    requestPaint();
  } else {
    // Paint the indicator immediately, then freeze.
    repaintPauseIndicator();
  }
}
export function togglePaused(): void { setPaused(!paused); }

// Indicator drawn at top-right corner so it's visible regardless of
// what the cart's painting. Bypasses the dirty-diff path because we
// want it to land NOW, not next requestPaint.
function repaintPauseIndicator(): void {
  if (!entered) return;
  const W = process.stdout.columns || 80;
  const label = ' ⏸ paused (Ctrl+P) ';
  const x = Math.max(0, W - label.length);
  // SGR: yellow bg, black fg, bold; then absolute cursor pos at row 1.
  process.stdout.write(`\x1b[1;${x + 1}H\x1b[48;2;251;191;36m\x1b[38;2;15;23;42m\x1b[1m${label}\x1b[0m`);
}

// ── Style accessors ─────────────────────────────────────────────────

type AnyProps = Record<string, any>;

function styleOf(node: Instance): AnyProps {
  return (node.props && (node.props as any).style) || {};
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// GPU carts use pixel sizes (padding: 24, width: 1280); the TUI grid is
// in character cells. RJIT_TUI_SCALE divides every numeric sizing value
// before layout. Set it (via env var) to ~8 for GPU carts; leave at 1
// for cell-native TUI carts (counter, devshell). Read once at module init.
const TUI_SCALE: number = (() => {
  try {
    const env: any = (globalThis as any).process?.env?.RJIT_TUI_SCALE;
    const n = env ? parseFloat(env) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch { return 1; }
})();

// Convert a numeric pixel-style value to cells. Scaled values clamp to >=0.
function cells(n: number): number {
  return Math.max(0, Math.round(n / TUI_SCALE));
}

function asCells(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return cells(v);
}

function padLeft(s: AnyProps): number {
  return asCells(s.paddingLeft) ?? asCells(s.paddingX) ?? asCells(s.padding) ?? 0;
}
function padRight(s: AnyProps): number {
  return asCells(s.paddingRight) ?? asCells(s.paddingX) ?? asCells(s.padding) ?? 0;
}
function padTop(s: AnyProps): number {
  return asCells(s.paddingTop) ?? asCells(s.paddingY) ?? asCells(s.padding) ?? 0;
}
function padBottom(s: AnyProps): number {
  return asCells(s.paddingBottom) ?? asCells(s.paddingY) ?? asCells(s.padding) ?? 0;
}

function borderW(s: AnyProps): number {
  // We only render 0/1 — terminal cells aren't fractional.
  const n = asNumber(s.borderWidth) ?? 0;
  return n > 0 ? 1 : 0;
}

function flexDir(s: AnyProps): 'row' | 'column' {
  return s.flexDirection === 'row' ? 'row' : 'column';
}

function isFill(v: unknown): boolean {
  return v === '100%' || v === 'fill';
}

// Resolve a width/height value against a parent inner extent. Numbers
// pass through; '100%'/'fill' resolves to parent extent; '50%' resolves
// proportionally; anything else returns null (use intrinsic).
function resolveExtent(v: unknown, parentInner: number): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return cells(v);
  if (typeof v !== 'string') return null;
  if (isFill(v)) return parentInner;
  if (v.endsWith('%')) {
    const pct = parseFloat(v.slice(0, -1));
    if (Number.isFinite(pct)) return Math.max(0, Math.floor(parentInner * pct / 100));
  }
  return null;
}

// ── Wide-char width (East Asian Wide / Fullwidth / Wide Emoji) ─────
//
// Code points in these ranges occupy 2 cells in monospace fonts. Without
// this, layout under-counts text width by 1 per wide char and right
// borders punch through the gap to the next sibling. BMP-only for now;
// surrogate pairs (most emoji) fall through as 1 cell — close enough
// until a cart hits it.

function charWidth(cp: number): number {
  if (
    (cp >= 0x1100 && cp <= 0x115F) ||  // Hangul Jamo
    (cp >= 0x2E80 && cp <= 0x303E) ||  // CJK radicals + symbols
    (cp >= 0x3041 && cp <= 0x33FF) ||  // Hiragana/Katakana/Bopomofo/Hangul/CJK letters
    (cp >= 0x3400 && cp <= 0x4DBF) ||  // CJK Ext A
    (cp >= 0x4E00 && cp <= 0x9FFF) ||  // CJK Unified
    (cp >= 0xA000 && cp <= 0xA4CF) ||  // Yi
    (cp >= 0xAC00 && cp <= 0xD7A3) ||  // Hangul Syllables
    (cp >= 0xF900 && cp <= 0xFAFF) ||  // CJK Compat
    (cp >= 0xFE30 && cp <= 0xFE4F) ||  // CJK Compat Forms
    (cp >= 0xFF01 && cp <= 0xFF60) ||  // Fullwidth Forms (＋ ＝ ⓪ etc.)
    (cp >= 0xFFE0 && cp <= 0xFFE6)     // Fullwidth signs (￠ ￡ etc.)
  ) return 2;
  return 1;
}

function strWidth(s: string): number {
  let w = 0;
  for (let i = 0; i < s.length; i++) w += charWidth(s.charCodeAt(i));
  return w;
}

// ── Text collection ─────────────────────────────────────────────────

function isInstance(n: Instance | TextInstance): n is Instance {
  return !!n && 'children' in n;
}

// Collect the text content of a Text instance. primitives.tsx flattens
// children at React-element time, so most Text nodes already have one or
// two TextInstances as direct children. We still recurse defensively in
// case a classifier or user wraps text in nested Text nodes.
function collectText(node: Instance): string {
  let out = '';
  for (const child of node.children) {
    if (!isInstance(child)) {
      out += child.text;
    } else if (child.type === 'Text' || child.type === 'CodeBlock') {
      out += collectText(child);
    }
    // Non-text inline children (Pressable, View) are ignored — they would
    // be block siblings on the GPU side too. We don't have a true inline
    // box model.
  }
  return out;
}

// ── Layout ──────────────────────────────────────────────────────────

type Clip = { x: number; y: number; w: number; h: number };
type LaidOut = { x: number; y: number; w: number; h: number; node: Instance; clip: Clip | null };

// ── ScrollView state ───────────────────────────────────────────────
//
// Per-instance vertical scroll offset, plus the current max scrollable
// distance computed during layout. Wheel events / arrow keys mutate
// scrollY; layout clamps. Map keyed by Instance.id so React's tree
// re-creates don't strand state (id is stable across re-renders).
const scrollY: Map<number, number> = new Map();
const scrollMaxY: Map<number, number> = new Map();
// Most recently interacted ScrollView (last wheel or click target).
// Arrow keys scroll this one when no other key handler claims them.
let activeScrollId: number | null = null;

// ── Terminal (vterm) slots ─────────────────────────────────────────
//
// Per-Instance vterm slot. The host calls __vterm_spawn(rows, cols)
// the first time a Terminal is painted, stores the slot, and reuses
// it across paints. activeTerminalId routes keystrokes to a focused
// terminal's PTY.
type TermEntry = { slot: number; rows: number; cols: number };
const termSlots: Map<number, TermEntry> = new Map();
let activeTerminalId: number | null = null;

function decodeTerminalRow(grid: Cell[][], x: number, y: number, maxW: number, rowStr: string): void {
  const W = grid[0]?.length ?? 0, H = grid.length;
  if (y < 0 || y >= H) return;
  if (!rowStr) return;
  const cells = rowStr.split('\x1e');
  const limit = Math.min(cells.length, maxW);
  for (let i = 0; i < limit; i++) {
    const xx = x + i;
    if (xx < 0 || xx >= W || !inClip(xx, y)) continue;
    const fields = cells[i].split('\x1f');
    if (fields.length < 4) continue;
    const ch = fields[0].length > 0 ? fields[0] : ' ';
    const fg = fields[1].length > 0 ? '#' + fields[1] : null;
    const bg = fields[2].length > 0 ? '#' + fields[2] : null;
    const attrs = parseInt(fields[3], 10) || 0;
    const c = grid[y][xx];
    c.ch = ch;
    c.fg = fg;
    c.bg = bg;
    c.bold      = (attrs & 0x01) !== 0;
    c.italic    = (attrs & 0x02) !== 0;
    c.underline = (attrs & 0x04) !== 0;
    c.strike    = (attrs & 0x08) !== 0;
    c.reverse   = (attrs & 0x10) !== 0;
    c.dim = false;
  }
}

function clipIntersect(a: Clip | null, b: Clip): Clip {
  if (!a) return b;
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

// Topmost ScrollView containing point — for routing wheel/scroll keys
// to the right viewport. Walks lastLayout in REVERSE (deepest first).
function hitTestScroll(x: number, y: number): Instance | null {
  for (let i = lastLayout.length - 1; i >= 0; i--) {
    const b = lastLayout[i];
    if (b.node.type !== 'ScrollView') continue;
    if (x < b.x || x >= b.x + b.w) continue;
    if (y < b.y || y >= b.y + b.h) continue;
    return b.node;
  }
  return null;
}

function hitTestTerminal(x: number, y: number): Instance | null {
  for (let i = lastLayout.length - 1; i >= 0; i--) {
    const b = lastLayout[i];
    if (b.node.type !== 'Terminal') continue;
    if (x < b.x || x >= b.x + b.w) continue;
    if (y < b.y || y >= b.y + b.h) continue;
    return b.node;
  }
  return null;
}

function hitTestTextInput(x: number, y: number): Instance | null {
  for (let i = lastLayout.length - 1; i >= 0; i--) {
    const b = lastLayout[i];
    const t = b.node.type;
    if (t !== 'TextInput' && t !== 'TextArea' && t !== 'TextEditor') continue;
    if (x < b.x || x >= b.x + b.w) continue;
    if (y < b.y || y >= b.y + b.h) continue;
    return b.node;
  }
  return null;
}

function findInstanceById(id: number): Instance | null {
  for (let i = lastLayout.length - 1; i >= 0; i--) {
    if (lastLayout[i].node.id === id) return lastLayout[i].node;
  }
  return null;
}

function scrollBy(id: number, delta: number): void {
  const max = scrollMaxY.get(id) ?? 0;
  const cur = scrollY.get(id) ?? 0;
  const next = Math.max(0, Math.min(max, cur + delta));
  if (next === cur) return;
  scrollY.set(id, next);
  requestPaint();
}

// Renderable visibility — these node types aren't part of the visual
// tree on the GPU side either. Skip in ANSI layout.
//
// Window / Notification: when -Dhas-window is set (cart imports
// runtime/primitives/window.tsx), the v8_tui_app binary links SDL3 +
// the window-rendering engine subset and registers __hostFlush so
// reconciler ops for the Window subtree route to a real GPU window
// from inside this same React tree. We still skip the subtree HERE in
// the ANSI walker either way — the Zig side owns paint for those
// nodes, not the terminal grid. The has-window link wiring is
// blocked on extracting v8_app.zig:applyCommandBatch + the Node-tree
// state it touches into a shared module; until that lands, <Window>
// is a no-op rather than a real GUI window.
function isRenderable(node: Instance): boolean {
  switch (node.type) {
    case 'Render':
    case 'Window':
    case 'Notification':
    case 'Audio':
    case 'Physics':
      return false;
  }
  return true;
}

function visibleChildren(node: Instance): Instance[] {
  const out: Instance[] = [];
  for (const c of node.children) {
    if (isInstance(c) && isRenderable(c)) out.push(c);
  }
  return out;
}

// Intrinsic size (width/height before flex distribution). Containers
// shrink-wrap children unless an explicit size pins them.
function intrinsic(node: Instance): { w: number; h: number } {
  if (node.type === 'Text') {
    const text = collectText(node);
    return { w: strWidth(text), h: text ? 1 : 0 };
  }
  if (node.type === 'Image') {
    const s = styleOf(node);
    const w = asCells(s.width) ?? 8;
    const h = asCells(s.height) ?? 4;
    return { w, h };
  }
  if (node.type === 'TextInput' || node.type === 'TextArea' || node.type === 'TextEditor') {
    const s = styleOf(node);
    const w = asCells(s.width) ?? 16;
    const h = asCells(s.height) ?? (node.type === 'TextInput' ? 1 : 3);
    return { w, h };
  }
  if (node.type === 'Canvas' || node.type === 'Graph' || node.type === 'Video' || node.type === 'Scene3D') {
    const s = styleOf(node);
    const w = asCells(s.width) ?? 12;
    const h = asCells(s.height) ?? 4;
    return { w, h };
  }
  if (node.type === 'Effect') {
    // Effect is a leaf rendered by paintEffect. Default to a small surface
    // when no size is pinned; carts almost always wrap it in a sized parent
    // or apply flexGrow, which overrides this anyway.
    const s = styleOf(node);
    const w = asCells(s.width) ?? 24;
    const h = asCells(s.height) ?? 8;
    return { w, h };
  }
  if (node.type === 'Terminal') {
    // Use explicit dimensions when set; otherwise a sensible shell-shaped
    // default. Carts that wrap a Terminal in a flexGrow:1 container will
    // get the full surface anyway via the parent's allocation.
    const s = styleOf(node);
    const w = asCells(s.width) ?? 40;
    const h = asCells(s.height) ?? 12;
    return { w, h };
  }
  if (node.type === 'ScrollView') {
    // Don't propagate children's intrinsic up — that would defeat
    // scrolling (parent would size the SV to fit all content). Use the
    // explicit width/height when set, otherwise 0; carts rely on
    // flexGrow:1 (or `height: 'fill'`) on the ScrollView's parent to
    // give it the available space.
    const s = styleOf(node);
    const w = asCells(s.width) ?? 0;
    const h = asCells(s.height) ?? 0;
    return { w, h };
  }

  const s = styleOf(node);
  const dir = flexDir(s);
  const gap = asCells(s.gap) ?? 0;
  const bw = borderW(s);
  const kids = visibleChildren(node).map(intrinsic);

  let cw = 0, ch = 0;
  if (dir === 'row') {
    cw = kids.reduce((a, k) => a + k.w, 0) + Math.max(0, kids.length - 1) * gap;
    ch = kids.reduce((m, k) => Math.max(m, k.h), 0);
  } else {
    cw = kids.reduce((m, k) => Math.max(m, k.w), 0);
    ch = kids.reduce((a, k) => a + k.h, 0) + Math.max(0, kids.length - 1) * gap;
  }
  const w = (asCells(s.width)) ?? cw + padLeft(s) + padRight(s) + bw * 2;
  const h = (asCells(s.height)) ?? ch + padTop(s) + padBottom(s) + bw * 2;
  return { w, h };
}

function layout(node: Instance, x: number, y: number, w: number, h: number, out: LaidOut[], clip: Clip | null = null): void {
  out.push({ x, y, w, h, node, clip });
  if (node.type === 'Text' || node.type === 'Image' || node.type === 'TextInput' ||
      node.type === 'TextArea' || node.type === 'TextEditor' || node.type === 'Canvas' ||
      node.type === 'Graph' || node.type === 'Video' || node.type === 'Scene3D' ||
      node.type === 'Terminal' || node.type === 'Effect') return;

  const s = styleOf(node);
  const dir = flexDir(s);
  const gap = asCells(s.gap) ?? 0;
  const bw = borderW(s);
  const ix = x + padLeft(s) + bw;
  const iy = y + padTop(s) + bw;
  const iw = Math.max(0, w - padLeft(s) - padRight(s) - bw * 2);
  const ih = Math.max(0, h - padTop(s) - padBottom(s) - bw * 2);

  const allKids = visibleChildren(node);
  if (allKids.length === 0) return;

  // Partition kids: position:'absolute' children are taken out of the
  // normal flow and laid out at the parent's inner rect (with optional
  // top/left/width/height overrides). They're appended to `out` AFTER
  // their flex siblings, so they paint on top — natural z-index.
  const kids: Instance[] = [];
  const absKids: Instance[] = [];
  for (const k of allKids) {
    if ((styleOf(k) as any).position === 'absolute') absKids.push(k);
    else kids.push(k);
  }

  // Tail call (run after the normal-flow layout below) that lays out
  // absolute children at the parent's inner rect.
  const layoutAbsKids = () => {
    for (const k of absKids) {
      const ks: any = styleOf(k);
      const kw = (typeof ks.width === 'number') ? cells(ks.width)
        : (typeof ks.width === 'string' && ks.width.endsWith('%')) ? (resolveExtent(ks.width, iw) ?? iw)
        : iw;
      const kh = (typeof ks.height === 'number') ? cells(ks.height)
        : (typeof ks.height === 'string' && ks.height.endsWith('%')) ? (resolveExtent(ks.height, ih) ?? ih)
        : ih;
      const left = asCells(ks.left) ?? 0;
      const top  = asCells(ks.top)  ?? 0;
      // right/bottom anchor: pin to the far edge instead of left/top.
      const right  = asCells(ks.right);
      const bottom = asCells(ks.bottom);
      const kx = (right  != null) ? ix + iw - kw - right  : ix + left;
      const ky = (bottom != null) ? iy + ih - kh - bottom : iy + top;
      layout(k, kx, ky, kw, kh, out, clip);
    }
  };

  if (kids.length === 0) { layoutAbsKids(); return; }

  // ScrollView — children stacked at intrinsic heights, vertically
  // offset by the saved scroll position. Inner rect becomes the clip
  // for descendants so anything outside the viewport just doesn't paint.
  if (node.type === 'ScrollView') {
    const id = node.id;
    let contentH = 0;
    const childIntrinsics = kids.map((k) => {
      const ip = intrinsic(k);
      contentH += ip.h;
      return ip;
    });
    contentH += Math.max(0, kids.length - 1) * gap;
    const maxY = Math.max(0, contentH - ih);
    scrollMaxY.set(id, maxY);
    const sY = Math.min(maxY, Math.max(0, scrollY.get(id) ?? 0));
    if ((scrollY.get(id) ?? 0) !== sY) scrollY.set(id, sY);

    const childClip = clipIntersect(clip, { x: ix, y: iy, w: iw, h: ih });
    let cy = iy - sY;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      const ks = styleOf(k);
      const explicitW = ks.width;
      const kw = isFill(explicitW) ? iw
        : (typeof explicitW === 'number') ? cells(explicitW)
        : (typeof explicitW === 'string' && explicitW.endsWith('%')) ? (resolveExtent(explicitW, iw) ?? iw)
        : iw;
      const kh = childIntrinsics[i].h;
      layout(k, ix, cy, kw, kh, out, childClip);
      cy += kh + gap;
    }
    layoutAbsKids();
    return;
  }

  // flexWrap on row/column. Greedy line-pack.
  if (s.flexWrap === 'wrap' && (dir === 'row' ? iw : ih) > 0) {
    layoutWrap(node, kids, ix, iy, iw, ih, gap, dir, out, clip);
    layoutAbsKids();
    return;
  }

  layoutFlex(node, kids, ix, iy, iw, ih, gap, dir, s, out, clip);
  layoutAbsKids();
}

function layoutWrap(
  parent: Instance, kids: Instance[],
  ix: number, iy: number, iw: number, ih: number,
  gap: number, dir: 'row' | 'column',
  out: LaidOut[],
  clip: Clip | null,
): void {
  const measured = kids.map(k => {
    const ip = intrinsic(k);
    const ks = styleOf(k);
    const m = dir === 'row'
      ? (asCells(ks.width)  ?? ip.w)
      : (asCells(ks.height) ?? ip.h);
    const c = dir === 'row'
      ? (asCells(ks.height) ?? ip.h)
      : (asCells(ks.width)  ?? ip.w);
    return { m, c };
  });
  const innerMain = dir === 'row' ? iw : ih;
  type Line = { idxs: number[]; main: number; cross: number };
  const lines: Line[] = [];
  let line: Line = { idxs: [], main: 0, cross: 0 };
  for (let i = 0; i < kids.length; i++) {
    const { m, c } = measured[i];
    const tentative = line.main + (line.idxs.length ? gap : 0) + m;
    if (line.idxs.length > 0 && tentative > innerMain) {
      lines.push(line);
      line = { idxs: [i], main: m, cross: c };
    } else {
      line.idxs.push(i);
      line.main = tentative;
      line.cross = Math.max(line.cross, c);
    }
  }
  if (line.idxs.length) lines.push(line);

  let crossCursor = 0;
  for (const ln of lines) {
    let mainCursor = 0;
    for (const i of ln.idxs) {
      const { m, c } = measured[i];
      const cx = dir === 'row' ? ix + mainCursor : ix + crossCursor;
      const cy = dir === 'row' ? iy + crossCursor : iy + mainCursor;
      const cw = dir === 'row' ? m : c;
      const chh = dir === 'row' ? c : m;
      layout(kids[i], cx, cy, cw, chh, out, clip);
      mainCursor += m + gap;
    }
    crossCursor += ln.cross + gap;
  }
}

function layoutFlex(
  parent: Instance, kids: Instance[],
  ix: number, iy: number, iw: number, ih: number,
  gap: number, dir: 'row' | 'column',
  ps: AnyProps,
  out: LaidOut[],
  clip: Clip | null,
): void {
  const innerMain = dir === 'row' ? iw : ih;
  const innerCross = dir === 'row' ? ih : iw;
  const main = (k: { w: number; h: number }) => dir === 'row' ? k.w : k.h;

  type Slot = { main: number; cross: number; grow: number; shrink: number; alignSelf: string | undefined };
  const slots: Slot[] = [];
  let fixed = 0, growSum = 0;

  for (const k of kids) {
    const ip = intrinsic(k);
    const ks = styleOf(k);
    const explicitMain = dir === 'row' ? ks.width : ks.height;
    const explicitCross = dir === 'row' ? ks.height : ks.width;
    let grow = asNumber(ks.flexGrow) ?? 0;
    // flexShrink defaults to 0 here (NOT CSS's 1) — terminal cells are
    // too coarse for implicit shrink, and the parent-border-on-top paint
    // pass already handles overflow visually. Carts set flexShrink>0
    // when they want a child to absorb deficit.
    const shrink = asNumber(ks.flexShrink) ?? 0;
    let mainSize: number;

    if (isFill(explicitMain)) { grow = Math.max(grow, 1); mainSize = 0; }
    else if (typeof explicitMain === 'number' && Number.isFinite(explicitMain)) mainSize = cells(explicitMain);
    else if (typeof explicitMain === 'string' && explicitMain.endsWith('%')) {
      mainSize = resolveExtent(explicitMain, innerMain) ?? main(ip);
    }
    else if (grow > 0) mainSize = 0;
    else mainSize = main(ip);

    const alignSelf = ks.alignSelf ?? ps.alignItems ?? 'stretch';
    let crossSize: number;
    if (isFill(explicitCross)) crossSize = innerCross;
    else if (typeof explicitCross === 'number' && Number.isFinite(explicitCross)) crossSize = cells(explicitCross);
    else if (typeof explicitCross === 'string' && explicitCross.endsWith('%')) {
      crossSize = resolveExtent(explicitCross, innerCross) ?? Math.min(innerCross, dir === 'row' ? ip.h : ip.w);
    }
    else if (alignSelf === 'flex-start' || alignSelf === 'center' || alignSelf === 'flex-end' || alignSelf === 'start' || alignSelf === 'end') {
      crossSize = Math.min(innerCross, dir === 'row' ? ip.h : ip.w);
    } else {
      crossSize = innerCross; // stretch (default)
    }

    fixed += mainSize;
    growSum += grow;
    slots.push({ main: mainSize, cross: crossSize, grow, shrink, alignSelf });
  }

  const totalGap = Math.max(0, kids.length - 1) * gap;
  const free = Math.max(0, innerMain - fixed - totalGap);
  if (growSum > 0) {
    for (const s of slots) if (s.grow > 0) s.main += Math.floor(free * s.grow / growSum);
  }

  // CSS flex-shrink: when fixed sizes overflow the inner extent and the
  // user explicitly opted children into shrinking via flexShrink>0, take
  // the deficit weighted by `shrink * mainSize`. Default flexShrink is 0
  // here (NOT the CSS default of 1) — terminal cells are too coarse for
  // implicit shrink to look right; it almost always eats the row that
  // contained text. Carts that want shrink set it explicitly.
  //
  // Whatever the shrink can't absorb stays as overflow; the two-pass
  // paint below ensures parent borders still draw cleanly over it, so
  // overflow doesn't punch through chrome.
  if (free === 0 && fixed + totalGap > innerMain) {
    const overflow = (fixed + totalGap) - innerMain;
    let weightTotal = 0;
    for (const s of slots) if (s.shrink > 0) weightTotal += s.shrink * s.main;
    if (weightTotal > 0) {
      let remaining = overflow;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s.shrink <= 0 || s.main <= 0) continue;
        const isLast = i === slots.length - 1;
        const share = isLast ? remaining : Math.floor(overflow * s.shrink * s.main / weightTotal);
        const taken = Math.min(s.main, share);
        s.main -= taken;
        remaining -= taken;
      }
    }
  }

  const consumed = slots.reduce((a, s) => a + s.main, 0) + totalGap;
  const slack = Math.max(0, innerMain - consumed);
  let cursor = 0;
  let extraGap = 0;
  if (growSum === 0) {
    const j = ps.justifyContent;
    if (j === 'center') cursor = Math.floor(slack / 2);
    else if (j === 'flex-end' || j === 'end') cursor = slack;
    else if ((j === 'space-between' || j === 'between') && kids.length > 1) extraGap = Math.floor(slack / (kids.length - 1));
  }

  for (let i = 0; i < kids.length; i++) {
    const slot = slots[i];
    let crossOffset = 0;
    const a = slot.alignSelf;
    if (a === 'center') crossOffset = Math.floor((innerCross - slot.cross) / 2);
    else if (a === 'flex-end' || a === 'end') crossOffset = innerCross - slot.cross;
    const cx = dir === 'row' ? ix + cursor : ix + crossOffset;
    const cy = dir === 'row' ? iy + crossOffset : iy + cursor;
    const cw = dir === 'row' ? slot.main : slot.cross;
    const chh = dir === 'row' ? slot.cross : slot.main;
    layout(kids[i], cx, cy, cw, chh, out, clip);
    cursor += slot.main + gap + extraGap;
  }
}

// ── Paint ───────────────────────────────────────────────────────────

// Cell carries the full SGR state we'll ever emit. Bools are easier to
// diff than a packed bitmask and the per-cell overhead is negligible
// against terminal grids (80×24 = 1920 cells max in practice).
type Cell = {
  ch: string;
  fg: string | null;
  bg: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  reverse: boolean;
  strike: boolean;
};
const blank = (): Cell => ({
  ch: ' ', fg: null, bg: null,
  bold: false, italic: false, underline: false, dim: false, reverse: false, strike: false,
});

function hex(c: string): [number, number, number] | null {
  if (typeof c !== 'string') return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(c);
  if (!m) {
    // rgb(r,g,b) and rgba(r,g,b,a) — accept since classifier sheets emit them.
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
    if (rgb) return [+rgb[1] & 255, +rgb[2] & 255, +rgb[3] & 255];
    return null;
  }
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function fgEsc(c: string | null): string {
  if (!c) return ''; const r = hex(c); return r ? `\x1b[38;2;${r[0]};${r[1]};${r[2]}m` : '';
}
function bgEsc(c: string | null): string {
  if (!c) return ''; const r = hex(c); return r ? `\x1b[48;2;${r[0]};${r[1]};${r[2]}m` : '';
}

// paintClip — module-level "active clip rect" set by the build-pass
// driver before each box's paint call. fillRect/drawBorder/writeText
// honor it so a ScrollView's children never bleed past its bounds.
let paintClip: Clip | null = null;

function inClip(x: number, y: number): boolean {
  if (!paintClip) return true;
  return x >= paintClip.x && y >= paintClip.y
    && x < paintClip.x + paintClip.w && y < paintClip.y + paintClip.h;
}

function fillRect(grid: Cell[][], x: number, y: number, w: number, h: number, bg: string | null, fg: string | null): void {
  const W = grid[0]?.length ?? 0, H = grid.length;
  for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) {
      if (!inClip(xx, yy)) continue;
      const c = grid[yy][xx];
      if (bg) c.bg = bg;
      if (fg) c.fg = fg;
      // Reset character + attrs so overlapping nodes (e.g. an absolute
      // overlay on top of a Terminal) actually mask whatever was painted
      // beneath them. Leaf paints (writeText, decodeTerminalRow) come
      // right after fillRect and set ch back to real content.
      c.ch = ' ';
      c.bold = c.italic = c.underline = c.dim = c.reverse = c.strike = false;
    }
  }
}
function drawBorder(grid: Cell[][], x: number, y: number, w: number, h: number, color: string | null): void {
  const W = grid[0]?.length ?? 0, H = grid.length;
  const put = (xx: number, yy: number, ch: string): void => {
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) return;
    if (!inClip(xx, yy)) return;
    const c = grid[yy][xx];
    c.ch = ch; if (color) c.fg = color;
  };
  if (w < 2 || h < 2) return;
  put(x, y, '┌'); put(x + w - 1, y, '┐'); put(x, y + h - 1, '└'); put(x + w - 1, y + h - 1, '┘');
  for (let xx = x + 1; xx < x + w - 1; xx++) { put(xx, y, '─'); put(xx, y + h - 1, '─'); }
  for (let yy = y + 1; yy < y + h - 1; yy++) { put(x, yy, '│'); put(x + w - 1, yy, '│'); }
}
// '\0' marks a wide-char continuation cell — the right half of a 2-cell
// glyph painted by the column to its left. The dirty-diff emit loop
// skips continuation cells and lets the wide char to the left paint
// both visual cells.
const WIDE_CONT = '\0';

type TextSGR = {
  fg: string | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  reverse: boolean;
  strike: boolean;
};

function writeText(
  grid: Cell[][], x: number, y: number, w: number, h: number,
  text: string, sgr: TextSGR,
): void {
  const W = grid[0]?.length ?? 0, H = grid.length;
  if (y < 0 || y >= H || h <= 0) return;
  let col = 0;
  for (let i = 0; i < text.length && col < w; i++) {
    const ch = text[i];
    const cw = charWidth(text.charCodeAt(i));
    const xx = x + col;
    if (cw === 2 && col + 2 > w) break;
    if (xx >= 0 && xx < W && inClip(xx, y)) {
      const c = grid[y][xx];
      c.ch = ch;
      if (sgr.fg) c.fg = sgr.fg;
      if (sgr.bold)      c.bold = true;
      if (sgr.italic)    c.italic = true;
      if (sgr.underline) c.underline = true;
      if (sgr.dim)       c.dim = true;
      if (sgr.reverse)   c.reverse = true;
      if (sgr.strike)    c.strike = true;
      if (cw === 2 && xx + 1 < W && inClip(xx + 1, y)) {
        const cc = grid[y][xx + 1];
        cc.ch = WIDE_CONT;
        cc.fg = sgr.fg;
        cc.bg = c.bg;
        cc.bold = !!sgr.bold;
        cc.italic = !!sgr.italic;
        cc.underline = !!sgr.underline;
        cc.dim = !!sgr.dim;
        cc.reverse = !!sgr.reverse;
        cc.strike = !!sgr.strike;
      }
    }
    col += cw;
  }
}

// SGR-from-style. Reads the React-Native-shaped style fields: fontWeight,
// fontStyle, textDecorationLine ('underline' | 'line-through' | 'underline line-through'),
// opacity (<1 → dim). Plus host-specific shortcuts: `italic`, `dim`,
// `reverse`, `strike` boolean style fields for direct opt-in.
function sgrFromStyle(s: AnyProps, color: string | null): TextSGR {
  const fw = s.fontWeight;
  const bold = fw === 'bold' || fw === 'bolder' || (typeof fw === 'number' && fw >= 700);
  const italic = s.fontStyle === 'italic' || !!s.italic;
  const decor = typeof s.textDecorationLine === 'string' ? s.textDecorationLine : '';
  const underline = decor.includes('underline') || !!s.underline;
  const strike = decor.includes('line-through') || !!s.strike || !!s.strikethrough;
  const dim = (typeof s.opacity === 'number' && s.opacity < 1) || !!s.dim;
  const reverse = !!s.reverse || !!s.invert;
  return { fg: color, bold, italic, underline, dim, reverse, strike };
}

// Focus highlight hook — set by tui/focus.ts. Returns the focused
// Instance id, or -1 if none. We keep the dependency one-way: focus.ts
// imports nothing from host other than requestPaint, so this hook is
// optional.
let focusedId: number = -1;
export function setFocusedId(id: number): void {
  if (focusedId === id) return;
  focusedId = id;
  requestPaint();
}
export function getFocusedId(): number { return focusedId; }

// Two-pass paint:
//   pass 1 — bg fills + leaf content (text, placeholders), in normal
//            depth order (root first). Children's bg overrides parent's
//            bg in their region; child text/placeholder content sits on
//            top.
//   pass 2 — container borders, in REVERSE depth order (root last).
//            Means a parent's border always wins over a descendant's
//            border at conflicting cells. Without this, an oversized
//            child's `│` punches through the parent's `─` and you get
//            visible gaps in the parent's chrome.
function paintBgAndContent(grid: Cell[][], box: LaidOut): void {
  const node = box.node;
  const s = styleOf(node);

  if (node.type === 'Text' || node.type === 'CodeBlock') {
    const text = collectText(node);
    const color = (typeof s.color === 'string') ? s.color : null;
    writeText(grid, box.x, box.y, box.w, box.h, text, sgrFromStyle(s, color));
    return;
  }

  if (node.type === 'Image') {
    fillRect(grid, box.x, box.y, box.w, box.h, '#1f2937', '#94a3b8');
    writeText(grid, box.x, box.y, box.w, 1, `[img ${box.w}×${box.h}]`, sgrFromStyle({}, '#94a3b8'));
    return;
  }

  if (node.type === 'Canvas' || node.type === 'Graph' || node.type === 'Video' || node.type === 'Scene3D') {
    fillRect(grid, box.x, box.y, box.w, box.h, '#0f172a', '#475569');
    writeText(grid, box.x, box.y, box.w, 1, `[${node.type.toLowerCase()}]`, sgrFromStyle({}, '#475569'));
    return;
  }

  if (node.type === 'Effect') {
    // Walk up to the nearest ancestor with an explicit backgroundColor —
    // shaders frequently return premultiplied colors with alpha<1, and we
    // need a sensible color underneath. Default to black.
    let bg: string | null = null;
    let p: any = (node as any).parent;
    while (p) {
      const ps = styleOf(p);
      if (typeof ps.backgroundColor === 'string') { bg = ps.backgroundColor; break; }
      p = p.parent;
    }
    paintEffect(grid as any, { x: box.x, y: box.y, w: box.w, h: box.h }, node as any, bg);
    return;
  }

  if (node.type === 'Terminal') {
    const g: any = globalThis;
    if (typeof g.__vterm_spawn !== 'function') {
      fillRect(grid, box.x, box.y, box.w, box.h, '#1f2937', '#94a3b8');
      writeText(grid, box.x, box.y, box.w, 1,
        '[vterm not available — build with -Dhas-terminal=true]',
        sgrFromStyle({}, '#f87171'));
      return;
    }
    const id = node.id;
    let entry = termSlots.get(id);
    if (!entry) {
      const shell = typeof (node.props as any).shell === 'string' ? (node.props as any).shell : '';
      const slot = g.__vterm_spawn(box.h, box.w, shell);
      if (slot < 0) {
        fillRect(grid, box.x, box.y, box.w, box.h, '#1f2937', '#94a3b8');
        writeText(grid, box.x, box.y, box.w, 1,
          '[no free vterm slot — max 4 terminals]',
          sgrFromStyle({}, '#f87171'));
        return;
      }
      entry = { slot, rows: box.h, cols: box.w };
      termSlots.set(id, entry);
      // autoFocus: route keystrokes to this Terminal immediately without
      // requiring a click. Lets nested-TUI setups (a TUI cart whose only
      // job is to host a single <Terminal>) work when mouse events can't
      // flow through the outer terminal — e.g. wrapt_tui being driven
      // through a parent GPU/TUI session.
      if ((node.props as any).autoFocus === true) {
        activeTerminalId = id;
      }
    } else if (entry.rows !== box.h || entry.cols !== box.w) {
      try { g.__vterm_resize?.(entry.slot, box.h, box.w); } catch {}
      entry.rows = box.h;
      entry.cols = box.w;
      // After SIGWINCH the inner program's redraw takes several frames to
      // arrive (especially through a vsock/VM boundary). Keep the paint
      // pump alive across that window so the bytes actually land.
      markTermWarm();
    }
    // Drain any pending PTY data into the vterm screen, then read each
    // row out and decode into our grid. __vterm_poll returns 1 if it
    // actually drained any bytes, 0 otherwise.
    const drained: number = (() => { try { return g.__vterm_poll?.(entry.slot) ?? 0; } catch { return 0; } })();
    fillRect(grid, box.x, box.y, box.w, box.h, '#000000', '#e5e7eb');
    for (let r = 0; r < box.h; r++) {
      const row: string = (() => { try { return g.__vterm_get_row(entry!.slot, r) || ''; } catch { return ''; } })();
      decodeTerminalRow(grid, box.x, box.y + r, box.w, row);
    }
    // Schedule another paint when new PTY data arrived this frame
    // (microtask — apply immediately) OR while a resize warm window is
    // still active (setTimeout 16ms — 60fps-capped pump so the inner
    // program's SIGWINCH redraw, which arrives over many frames, has
    // somewhere to land without spinning a core).
    //
    // Pre-warm version: a single unconditional requestPaint() here
    // produced a tight self-feedback loop that locked our own GPU
    // <Terminal> when wrapt_tui was nested inside wrapt. The current
    // shape preserves that fix while ensuring resize redraws always
    // settle.
    if (drained) {
      requestPaint();
    } else if (Date.now() < termWarmUntil) {
      requestPaintSoon(16);
    }
    return;
  }

  if (node.type === 'TextInput' || node.type === 'TextArea' || node.type === 'TextEditor') {
    const value = typeof (node.props as any).value === 'string' ? (node.props as any).value
                : typeof (node.props as any).defaultValue === 'string' ? (node.props as any).defaultValue
                : '';
    const placeholder = typeof (node.props as any).placeholder === 'string' ? (node.props as any).placeholder : '';
    const focused = node.id === focusedId;
    const bg = focused ? '#1e293b' : '#0f172a';
    fillRect(grid, box.x, box.y, box.w, box.h, bg, '#e5e7eb');
    const text = value.length > 0 ? value : placeholder;
    const color = value.length > 0 ? '#e5e7eb' : '#64748b';
    writeText(grid, box.x, box.y, box.w, 1, text, sgrFromStyle({}, color));
    if (focused) {
      const cursorX = Math.min(box.x + value.length, box.x + box.w - 1);
      writeText(grid, cursorX, box.y, 1, 1, '_', { fg: '#fbbf24', bold: true, italic: false, underline: false, dim: false, reverse: false, strike: false });
    }
    return;
  }

  // View / Pressable / ScrollView and friends — bg only here. Borders go
  // in pass 2 so they overlay any descendants.
  const bg = (typeof s.backgroundColor === 'string') ? s.backgroundColor : null;
  const fg = (typeof s.color === 'string') ? s.color : null;
  if (bg) fillRect(grid, box.x, box.y, box.w, box.h, bg, fg);
  else if (fg) fillRect(grid, box.x, box.y, box.w, box.h, null, fg);
}

function paintBorder(grid: Cell[][], box: LaidOut): void {
  const node = box.node;
  // Leaf types own their own chrome; nothing to draw here.
  switch (node.type) {
    case 'Text':
    case 'CodeBlock':
    case 'Image':
    case 'Canvas':
    case 'Graph':
    case 'Video':
    case 'Scene3D':
    case 'TextInput':
    case 'TextArea':
    case 'TextEditor':
      return;
  }
  const s = styleOf(node);
  const fg = (typeof s.color === 'string') ? s.color : null;
  if (borderW(s) > 0) {
    drawBorder(grid, box.x, box.y, box.w, box.h, (typeof s.borderColor === 'string') ? s.borderColor : fg);
  }
  // Focus ring on Pressables — accent-color border, drawn last so it
  // wins over any underlying chrome at the same cells.
  if (node.type === 'Pressable' && node.id === focusedId) {
    drawBorder(grid, box.x, box.y, box.w, box.h, '#fbbf24');
  }
}

// Previous-frame buffer — diff and emit only changed cells.
let prev: Cell[][] | null = null;
let prevW = 0, prevH = 0;

function cellEq(a: Cell, b: Cell): boolean {
  return a.ch === b.ch && a.fg === b.fg && a.bg === b.bg
    && a.bold === b.bold && a.italic === b.italic && a.underline === b.underline
    && a.dim === b.dim && a.reverse === b.reverse && a.strike === b.strike;
}
// Selection rect in normalized reading order (anchor → focus may flip).
function selectionBounds(): { sx: number; sy: number; ex: number; ey: number } | null {
  if (!selAnchor || !selFocus) return null;
  let { x: sx, y: sy } = selAnchor;
  let { x: ex, y: ey } = selFocus;
  // Reading-order normalize: top-to-bottom, then left-to-right within row.
  if (sy > ey || (sy === ey && sx > ex)) {
    [sx, sy, ex, ey] = [ex, ey, sx, sy];
  }
  return { sx, sy, ex, ey };
}

function inSelection(x: number, y: number): boolean {
  const b = selectionBounds();
  if (!b) return false;
  if (y < b.sy || y > b.ey) return false;
  if (b.sy === b.ey) return x >= b.sx && x <= b.ex;
  if (y === b.sy) return x >= b.sx;
  if (y === b.ey) return x <= b.ex;
  return true;
}

// Selection overlay: invert each selected cell so the highlight reads
// like a typical terminal selection regardless of the cell's underlying
// fg/bg. Runs after both paint passes so it lands on top of everything.
function paintSelection(grid: Cell[][]): void {
  if (!selAnchor || !selFocus) return;
  const H = grid.length;
  const W = grid[0]?.length ?? 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inSelection(x, y)) continue;
      const c = grid[y][x];
      // Invert fg/bg for a clear "selected" look. Defaults to a yellow
      // highlight on cells that had no explicit colors.
      const bg = c.fg ?? '#fbbf24';
      const fg = c.bg ?? '#0b1020';
      c.fg = fg;
      c.bg = bg;
    }
  }
}

function buildGrid(W: number, H: number, layoutOut: LaidOut[]): Cell[][] {
  const grid: Cell[][] = Array.from({ length: H }, () => Array.from({ length: W }, blank));
  // Pass 1: bg + leaf content (root → deepest).
  for (const b of layoutOut) {
    paintClip = b.clip;
    paintBgAndContent(grid, b);
  }
  // Pass 2: container borders (deepest → root). Last writer wins, so the
  // root's border draws on top of any descendant's border at conflict
  // cells. Prevents oversized children from punching through parent
  // chrome.
  for (let i = layoutOut.length - 1; i >= 0; i--) {
    paintClip = layoutOut[i].clip;
    paintBorder(grid, layoutOut[i]);
  }
  paintClip = null;
  // Pass 3: drag-selection overlay. Runs last so it visually wins over
  // everything else.
  paintSelection(grid);
  return grid;
}

// Extract the selected text from the current grid for clipboard. Joins
// per-row, trimming trailing whitespace on each row to avoid pasting
// lines of padding spaces.
function selectionText(grid: Cell[][]): string {
  const b = selectionBounds();
  if (!b) return '';
  const W = grid[0]?.length ?? 0;
  const lines: string[] = [];
  for (let y = b.sy; y <= b.ey; y++) {
    const startX = (y === b.sy) ? b.sx : 0;
    const endX = (y === b.ey) ? b.ex : W - 1;
    let line = '';
    for (let x = startX; x <= endX; x++) {
      const c = grid[y][x];
      if (c.ch === WIDE_CONT) continue;
      line += c.ch;
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

// Base64 — no Buffer in v8cli, so a hand-rolled encoder. ASCII-only is
// fine here; selection text is whatever's already on screen as printable
// chars and box-drawing glyphs.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64Encode(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const cp = s.charCodeAt(i);
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    out += B64[a >> 2];
    out += B64[((a & 0x03) << 4) | (b >> 4)];
    out += (i + 1 < bytes.length) ? B64[((b & 0x0f) << 2) | (c >> 6)] : '=';
    out += (i + 2 < bytes.length) ? B64[c & 0x3f] : '=';
  }
  return out;
}

function copySelectionToClipboard(grid: Cell[][]): number {
  const text = selectionText(grid);
  if (!text) return 0;
  process.stdout.write('\x1b]52;c;' + base64Encode(text) + '\x07');
  return text.length;
}

function collectLayout(W: number, H: number): LaidOut[] {
  const out: LaidOut[] = [];
  for (const root of getRootInstances()) {
    if (!isRenderable(root)) continue;
    layout(root, 0, 0, W, H, out);
  }
  return out;
}

// Debug: tint every emitted cell's bg to a color of your choosing. Lets
// you SEE the dirty rectangle the host emits on each frame. Set
// RJIT_TUI_DIRTY_TINT=1 (red), or to any #rrggbb hex literal. Cells that
// were tinted last frame get re-emitted this frame with their real bg
// (i.e. they "decay" off) so persistent dirty regions blink instead of
// staying lit forever.
const TINT_DIRTY: string | null = (() => {
  try {
    const v: any = (globalThis as any).process?.env?.RJIT_TUI_DIRTY_TINT;
    if (!v) return null;
    if (v === '1' || v === 'true') return '#ff0033';
    if (typeof v === 'string' && /^#?[0-9a-fA-F]{6}$/.test(v)) return v.startsWith('#') ? v : '#' + v;
    return null;
  } catch { return null; }
})();

let lastTinted: Set<number> = new Set();  // packed (y * W + x) keys

function repaint(): void {
  if (!entered) return;
  const W = process.stdout.columns || 80;
  const H = process.stdout.rows || 24;
  lastLayout = collectLayout(W, H);
  const grid = buildGrid(W, H, lastLayout);
  const fullRepaint = !prev || prevW !== W || prevH !== H;

  let out = '';
  let lastFg: string | null | '__init' = '__init';
  let lastBg: string | null | '__init' = '__init';
  let lastBold = false;
  let lastItalic = false;
  let lastUnderline = false;
  let lastDim = false;
  let lastReverse = false;
  let lastStrike = false;
  let cursorX = -1, cursorY = -1;
  const newTinted: Set<number> = TINT_DIRTY ? new Set() : lastTinted;

  const moveTo = (x: number, y: number): void => {
    if (cursorX === x && cursorY === y) return;
    out += `\x1b[${y + 1};${x + 1}H`;
    cursorX = x; cursorY = y;
  };

  // emitCell — does the actual byte emission for one cell, applying the
  // dirty-tint override if enabled. Pulled out so the "force-clear last
  // frame's tint" path can call it on otherwise-clean cells.
  // SGR codes used:
  //   1/22  bold on/off       (22 also clears dim)
  //   2/22  dim on/off        (paired with bold via the 22 reset)
  //   3/23  italic on/off
  //   4/24  underline on/off
  //   7/27  reverse on/off
  //   9/29  strikethrough on/off
  const emitCell = (cc: Cell, x: number, y: number, isDirty: boolean): number => {
    const useBg = (TINT_DIRTY && isDirty) ? TINT_DIRTY : cc.bg;
    if (cc.fg !== lastFg) { out += cc.fg ? fgEsc(cc.fg) : '\x1b[39m'; lastFg = cc.fg; }
    if (useBg !== lastBg) { out += useBg ? bgEsc(useBg) : '\x1b[49m'; lastBg = useBg; }
    if (cc.bold !== lastBold) {
      // 22 turns off both bold AND dim, so re-assert dim if it should
      // remain on after a bold->!bold transition. Cheap: lastDim tracks
      // the post-emit state.
      if (cc.bold) out += '\x1b[1m';
      else { out += '\x1b[22m'; lastDim = false; }
      lastBold = cc.bold;
    }
    if (cc.dim !== lastDim) {
      if (cc.dim) out += '\x1b[2m'; else out += '\x1b[22m';
      lastDim = cc.dim;
    }
    if (cc.italic !== lastItalic) {
      out += cc.italic ? '\x1b[3m' : '\x1b[23m';
      lastItalic = cc.italic;
    }
    if (cc.underline !== lastUnderline) {
      out += cc.underline ? '\x1b[4m' : '\x1b[24m';
      lastUnderline = cc.underline;
    }
    if (cc.reverse !== lastReverse) {
      out += cc.reverse ? '\x1b[7m' : '\x1b[27m';
      lastReverse = cc.reverse;
    }
    if (cc.strike !== lastStrike) {
      out += cc.strike ? '\x1b[9m' : '\x1b[29m';
      lastStrike = cc.strike;
    }
    out += cc.ch;
    const w = charWidth(cc.ch.charCodeAt(0));
    cursorX = x + w; cursorY = y;
    return w;
  };

  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const c = grid[y][x];
      const same = !fullRepaint && cellEq(prev![y][x], c);
      const wasTinted = TINT_DIRTY ? lastTinted.has(y * W + x) : false;
      // Continuation cells are painted by the wide char to their left.
      if (c.ch === WIDE_CONT) { x++; continue; }
      if (same && !wasTinted) { x++; continue; }
      moveTo(x, y);
      while (x < W) {
        const cc = grid[y][x];
        const isDirty = fullRepaint || !cellEq(prev![y][x], cc);
        const wasT = TINT_DIRTY ? lastTinted.has(y * W + x) : false;
        if (!isDirty && !wasT) break;
        if (cc.ch === WIDE_CONT) { x++; continue; }
        const w = emitCell(cc, x, y, isDirty);
        if (TINT_DIRTY && isDirty) newTinted.add(y * W + x);
        x += w;
      }
    }
  }

  if (out.length > 0) {
    out += '\x1b[0m';
    process.stdout.write(out);
  }
  if (TINT_DIRTY) lastTinted = newTinted;

  prev = grid;
  prevW = W; prevH = H;
}

// ── Lifecycle ───────────────────────────────────────────────────────

const ALT = '\x1b[?1049h';
const RESTORE = '\x1b[?1049l';
const HIDE = '\x1b[?25l';
const SHOW = '\x1b[?25h';
// Mouse: 1000 = press/release, 1003 = any-motion (hover-without-button +
// drag), 1006 = SGR extended (decimal coords past col 223). Any-motion
// reporting lets <Effect> shaders use U.mouse_x / U.mouse_y / U.mouse_inside
// for hover-driven parallax — same primitive carts use on the GPU host.
// The drag-selection logic still works: press/drag/release events come
// through identically in 1003 mode.
const MOUSE_ON  = '\x1b[?1000h\x1b[?1003h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1000l\x1b[?1003l\x1b[?1006l';

// Persistent mouse position, in cell coordinates. Updated on every mouse
// event so <Effect> shaders can read it via U.mouse_x / U.mouse_y. Stays
// at the last-known position when the cursor leaves the terminal (so the
// parallax doesn't snap to origin on every hover-out).
let mouseCellX = -1;
let mouseCellY = -1;
let mouseInside = 0;
export function getMouse(): { x: number; y: number; inside: number } {
  return { x: mouseCellX, y: mouseCellY, inside: mouseInside };
}

// Last laid-out tree from the most recent paint. Hit-testing walks this
// instead of re-running layout(), so a click on row 4 col 50 always
// targets the node that's visually there right now.
let lastLayout: LaidOut[] = [];

let lastW = 0, lastH = 0;
let resizePollTimer: any = null;
function pollResize(): void {
  const w = process.stdout.columns || 80;
  const h = process.stdout.rows || 24;
  if (w !== lastW || h !== lastH) {
    lastW = w; lastH = h;
    prev = null;
    // Force a dirty re-render all the way down the chain: nested
    // Terminals will refire __vterm_resize on the next paint (box.w/h
    // changed), and the warm pump keeps polling until their inner
    // SIGWINCH redraw finishes flowing through.
    markTermWarm();
  }
}

export function enter(): void {
  entered = true;
  prev = null;
  lastW = process.stdout.columns || 80;
  lastH = process.stdout.rows || 24;
  process.stdout.write(ALT + HIDE + MOUSE_ON + '\x1b[2J\x1b[H');
  requestPaint();
  if (resizePollTimer == null) resizePollTimer = setInterval(pollResize, 250);
}
export function leave(): void {
  if (!entered) return;
  entered = false;
  if (resizePollTimer != null) { clearInterval(resizePollTimer); resizePollTimer = null; }
  process.stdout.write('\x1b[0m' + MOUSE_OFF + SHOW + RESTORE);
}

// Re-emit MOUSE_ON + alt-screen guards. Cheap defensive call to run
// after window-state transitions (fullscreen/maximize) that some
// terminal emulators have been observed to drop modes during. Idempotent
// — costs ~30 bytes of ANSI when fired, invisible to the user.
function reAssertTerminalModes(): void {
  if (!entered) return;
  process.stdout.write(ALT + HIDE + MOUSE_ON);
}

// Headless snapshot — paints once into an explicit-size grid and returns
// plain text (no ANSI). Bypasses stdout entirely. Used by devshell `y`
// copy and by tests.
export function headlessSnapshot(width: number, height: number): string {
  const grid = buildGrid(width, height, collectLayout(width, height));
  // Drop WIDE_CONT continuation cells — the wide char to the left
  // already represents both visual columns. Output preserves logical
  // string width: each wide char counts as one source char.
  return grid.map(row => row.map(c => c.ch === WIDE_CONT ? '' : c.ch).join('')).join('\n');
}

process.stdout.on('resize', () => {
  // Defensive: re-assert alt-screen + mouse modes in case the host
  // terminal dropped them during a fullscreen/maximize transition.
  // Then invalidate the diff buffer + kick the inner-Terminal warm
  // pump so SIGWINCH-driven redraws have something to land in.
  //
  // The synchronous reassert covers most cases, but some terminals
  // (notably kitty on monitor-edge maximize) finish their mode-reset
  // dance AFTER our resize event fires. The two-stage delayed reassert
  // catches that window — cheap (~60 bytes), invisible to user.
  reAssertTerminalModes();
  prev = null;
  markTermWarm();
  setTimeout(reAssertTerminalModes, 100);
  setTimeout(reAssertTerminalModes, 400);
});
process.on('exit', leave);
process.on('SIGINT',  () => { leave(); process.exit(0); });
process.on('SIGTERM', () => { leave(); process.exit(0); });
process.on('SIGHUP',  () => { leave(); process.exit(0); });

// Crash safety net. Without this, an exception in repaint / a cart
// component / a host callback exits the process via V8's default
// handler — which doesn't run our exit hook, leaving the user's
// terminal in alt-screen + MOUSE_ON. The shell underneath then
// echoes mouse SGR sequences (e.g. `^[[<65;111;31M` on scroll)
// because kitty doesn't know our process is dead.
//
// We also log the exception to stderr; users running with
// `2>/tmp/cw.err` can read what blew up.
process.on('uncaughtException', (e: any) => {
  try { leave(); } catch {}
  try { (process.stderr as any).write?.(`[uncaughtException] ${e?.stack ?? e}\n`); } catch {}
  process.exit(1);
});
process.on('unhandledRejection', (e: any) => {
  try { leave(); } catch {}
  try { (process.stderr as any).write?.(`[unhandledRejection] ${e?.stack ?? e}\n`); } catch {}
  process.exit(1);
});

// ── Key bus ─────────────────────────────────────────────────────────

type KeyHandler = (key: string) => void;
const keyHandlers = new Set<KeyHandler>();
export function subscribeKey(fn: KeyHandler): () => void {
  keyHandlers.add(fn);
  return () => { keyHandlers.delete(fn); };
}

// Hotkeys that bypass Terminal focus — even while the inner program
// (e.g. claude-code in a vsock VM) is reading stdin, these match first
// and fire the cart's callback instead of being forwarded to the PTY.
// Use sparingly; the inner program will never see these bytes.
const hotkeyHandlers = new Map<string, () => void>();
export function subscribeHotkey(seq: string, fn: () => void): () => void {
  hotkeyHandlers.set(seq, fn);
  return () => { hotkeyHandlers.delete(seq); };
}

// Internal hook for the focus manager / entry.tsx so they can intercept
// keys before user subscribers (focus traversal, Pressable activation).
type KeyInterceptor = (key: string) => boolean; // return true → consumed
const interceptors = new Set<KeyInterceptor>();
export function addKeyInterceptor(fn: KeyInterceptor): () => void {
  interceptors.add(fn);
  return () => { interceptors.delete(fn); };
}

// ── Hit-testing ─────────────────────────────────────────────────────

// True if a node has any handler in handlerRegistry that we'd dispatch
// from a click. Pressable is the canonical case; any node with onPress
// or onClick (e.g. a View used as a button) also counts.
function isClickable(id: number): boolean {
  const h = handlerRegistry.get(id);
  if (!h) return false;
  return typeof h.onPress === 'function' || typeof h.onClick === 'function';
}

// Topmost clickable node containing (x, y). Walks lastLayout in REVERSE
// order — descendants pushed after parents, so reverse iteration hits
// the deepest match first.
export function hitTest(x: number, y: number): Instance | null {
  for (let i = lastLayout.length - 1; i >= 0; i--) {
    const b = lastLayout[i];
    if (x < b.x || x >= b.x + b.w) continue;
    if (y < b.y || y >= b.y + b.h) continue;
    if (b.node.type === 'Pressable' || isClickable(b.node.id)) return b.node;
  }
  return null;
}

// ── Mouse parsing ────────────────────────────────────────────────────
//
// SGR mouse mode (1006) emits CSI sequences:
//   \x1b[<{button};{col};{row}M   press / drag
//   \x1b[<{button};{col};{row}m   release
// Buttons: 0=left, 1=middle, 2=right, 64=wheel-up, 65=wheel-down. Drag
// adds 32 to the button code. col/row are 1-based.

const MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

function dispatchMouse(buf: string): void {
  let s = buf;
  while (true) {
    const m = MOUSE_RE.exec(s);
    if (!m) break;
    const rawButton = parseInt(m[1], 10);
    const col = parseInt(m[2], 10) - 1;
    const row = parseInt(m[3], 10) - 1;
    const action = m[4]; // 'M' = press OR drag (motion-with-button), 'm' = release
    s = s.slice(m.index + m[0].length);

    // Track persistent mouse position on every event (including motion-no-
    // button under 1003 reporting). Used by <Effect> shaders for parallax.
    mouseCellX = col;
    mouseCellY = row;
    mouseInside = 1;
    // No-button motion in 1003 reports button = 35 (3 + drag flag). It
    // contains useful position data but nothing else, so we tick a paint
    // (effects animate on it) and drop the event.
    if ((rawButton & ~32) === 3) {
      requestPaint();
      continue;
    }

    // Drag flag is bit 5 (32). Mask it off to learn the actual button.
    const dragging = (rawButton & 32) !== 0;
    const button = rawButton & ~32;

    // Wheel: bit 6 (64). 64 = wheel-up, 65 = wheel-down. Terminal under
    // cursor wins. Two cases:
    //   1. Inner program is tracking mouse (mouse_mode > 0, e.g. nested
    //      TUI like claude-inner) → forward the wheel as an SGR mouse
    //      sequence so the inner can scroll its own scrollback.
    //   2. Otherwise → scroll OUR vterm's scrollback locally.
    // Falls through to ScrollView routing when no Terminal is under
    // the cursor — and to nothing when neither matches.
    if ((rawButton & 64) !== 0 && action === 'M') {
      const tm = hitTestTerminal(col, row);
      if (tm) {
        const entry = termSlots.get(tm.id);
        const g: any = globalThis;
        if (entry) {
          const mouseMode = (typeof g.__vterm_get_mouse_mode === 'function')
            ? (g.__vterm_get_mouse_mode(entry.slot) ?? 0)
            : 0;
          if (mouseMode > 0 && typeof g.__vterm_write === 'function') {
            // Find the terminal's box to translate to inner-screen coords.
            let tbox: LaidOut | null = null;
            for (let i = lastLayout.length - 1; i >= 0; i--) {
              if (lastLayout[i].node.id === tm.id) { tbox = lastLayout[i]; break; }
            }
            if (tbox) {
              const buttonCode = (rawButton & 1) ? 65 : 64; // wheel-down : wheel-up
              const innerCol = col - tbox.x + 1;
              const innerRow = row - tbox.y + 1;
              const seq = `\x1b[<${buttonCode};${innerCol};${innerRow}M`;
              try { g.__vterm_write(entry.slot, seq); } catch {}
              markTermWarm(500);
              continue;
            }
          }
          if (typeof g.__vterm_scroll === 'function') {
            const delta = (rawButton & 1) ? 3 : -3; // wheel-down = +3 toward live
            try { g.__vterm_scroll(entry.slot, delta); } catch {}
            requestPaint();
            continue;
          }
        }
      }
      const sv = hitTestScroll(col, row);
      if (sv) {
        activeScrollId = sv.id;
        scrollBy(sv.id, (rawButton & 1) ? 3 : -3);
      }
      continue;
    }

    if (button !== 0) continue; // ignore middle/right for now

    if (action === 'M' && !dragging) {
      // Left-button PRESS. Begin a fresh drag-selection at this cell.
      // Don't fire onPress yet — we'll only treat this as a click if
      // release happens at the same cell with no drag in between.
      selAnchor = { x: col, y: row };
      selFocus = { x: col, y: row };
      selDragging = true;
      // Activate the deepest ScrollView under the cursor for keyboard
      // arrow scrolling.
      const sv = hitTestScroll(col, row);
      if (sv) activeScrollId = sv.id;
      // Terminal focus: clicking into a <Terminal> routes subsequent
      // keystrokes to its PTY; clicking outside drops focus.
      const tm = hitTestTerminal(col, row);
      activeTerminalId = tm ? tm.id : null;
      // TextInput focus on click — set focusedId so the typing path in
      // startInput dispatches onChangeText to the right node.
      const ti = hitTestTextInput(col, row);
      if (ti) setFocusedId(ti.id);
      requestPaint();
    } else if (action === 'M' && dragging) {
      // Mid-drag. Update focus end so the selection rect grows.
      if (selDragging) {
        selFocus = { x: col, y: row };
        requestPaint();
      }
    } else if (action === 'm' && selDragging) {
      // Left-button RELEASE. Two cases:
      //   - Anchor === current focus → it's a click → fire onPress and
      //     clear the selection.
      //   - Otherwise → user dragged → keep the visible highlight, copy
      //     the underlying cells via OSC 52.
      selDragging = false;
      const moved = !selAnchor || !selFocus
        || selAnchor.x !== selFocus.x || selAnchor.y !== selFocus.y;
      if (!moved) {
        // Plain click. Clear the (zero-area) selection and dispatch.
        selAnchor = null;
        selFocus = null;
        const target = hitTest(col, row);
        if (target) {
          setFocusedId(target.id);
          dispatchTo(target.id, ['onPress', 'onClick'], { x: col, y: row });
        }
        requestPaint();
      } else {
        // Real drag. Copy current cells under the rect to the system
        // clipboard via OSC 52. The highlight stays painted until the
        // next click clears it.
        const W = process.stdout.columns || 80;
        const H = process.stdout.rows || 24;
        const grid = buildGrid(W, H, lastLayout);
        copySelectionToClipboard(grid);
        requestPaint();
      }
    }
  }
}

export function startInput(): void {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data: string) => {
    // Ctrl+] (\x1d) leaves Terminal focus and returns input to the cart.
    if (data === '\x1d' && activeTerminalId !== null) {
      activeTerminalId = null;
      requestPaint();
      return;
    }
    // Strip mouse-CSI sequences out FIRST, before any branch that might
    // forward `data` wholesale (e.g. the PTY-forward path below). Mouse
    // bytes drive host hit-testing/selection — they must never reach the
    // embedded shell, or clicks appear in the PTY as literal "<35;…M".
    if (data.indexOf('\x1b[<') !== -1) {
      let rest = '';
      let cursor = 0;
      while (cursor < data.length) {
        const idx = data.indexOf('\x1b[<', cursor);
        if (idx === -1) { rest += data.slice(cursor); break; }
        rest += data.slice(cursor, idx);
        const m = MOUSE_RE.exec(data.slice(idx));
        if (!m) { rest += data.slice(idx); break; }
        dispatchMouse(data.slice(idx, idx + m[0].length));
        cursor = idx + m[0].length;
      }
      if (rest.length === 0) return;
      data = rest;
    }
    // Cart-registered hotkeys bypass Terminal focus. Checked BEFORE the
    // PTY forward so the embedded shell never sees these bytes.
    {
      const hot = hotkeyHandlers.get(data);
      if (hot) { try { hot(); } catch {} return; }
    }
    // While focused on a Terminal, route keystrokes (including Ctrl+C →
    // SIGINT to shell) to the vterm PTY. Ctrl+P still toggles host
    // pause; everything else flows through.
    if (activeTerminalId !== null && data !== '\x10') {
      const entry = termSlots.get(activeTerminalId);
      const g: any = globalThis;
      if (entry && typeof g.__vterm_write === 'function') {
        try { g.__vterm_write(entry.slot, data); } catch {}
        // PTY echo lands over the next few frames — keep the pump
        // alive so the typed bytes actually render. Without this, the
        // drained-only paint gate would leave keystrokes invisible
        // until some unrelated event triggered a paint.
        markTermWarm(500);
        return;
      }
    }
    if (data === '\x03') { leave(); process.exit(0); }
    // Ctrl+P toggles repaint-pause. Mouse mode also cycles off → on
    // around the pause so the terminal owns selection while frozen.
    if (data === '\x10') {
      const next = !paused;
      if (next) process.stdout.write(MOUSE_OFF);
      else      process.stdout.write(MOUSE_ON);
      togglePaused();
      return;
    }
    // While paused, drop all input. The user is mid-select; we don't
    // want stray keys advancing focus, firing handlers, or scrolling.
    if (paused) return;
    // Esc clears any visible selection so the highlight gets out of the
    // way without requiring the user to click somewhere specific.
    if (data === '\x1b' && (selAnchor || selFocus)) {
      selAnchor = null;
      selFocus = null;
      selDragging = false;
      requestPaint();
      return;
    }
    // Text input handler — runs before generic cart key handlers so
    // typing into a focused TextInput doesn't double-dispatch as both
    // an edit AND a cart-level key event.
    if (focusedId !== -1) {
      const node = findInstanceById(focusedId);
      if (node && (node.type === 'TextInput' || node.type === 'TextArea' || node.type === 'TextEditor')) {
        const handled = handleTextInputKey(node, data);
        if (handled) return;
      }
    }
    for (const fn of interceptors) {
      try { if (fn(data)) return; } catch {}
    }
    for (const fn of keyHandlers) {
      try { fn(data); } catch {}
    }
    // After cart-level handlers run, route arrow keys / page nav to the
    // most-recently-active ScrollView. No claim mechanism on keyHandlers,
    // so a cart that consumes arrows for its own state will see this
    // scroll on top — works because a typical cart with a ScrollView
    // child wants both behaviors anyway (arrows scroll the visible
    // viewport).
    if (activeScrollId !== null) {
      if (data === '\x1b[A')      scrollBy(activeScrollId, -1);   // up
      else if (data === '\x1b[B') scrollBy(activeScrollId,  1);   // down
      else if (data === '\x1b[5~') scrollBy(activeScrollId, -10); // PgUp
      else if (data === '\x1b[6~') scrollBy(activeScrollId,  10); // PgDn
      else if (data === '\x1b[H' || data === 'g') scrollBy(activeScrollId, -1e9);
      else if (data === '\x1b[F' || data === 'G') scrollBy(activeScrollId,  1e9);
    }
  });
}

// Text input key handler — appends/backspaces/submits + dispatches
// onChangeText to the cart. Returns true if the key was consumed (so
// upstream key handlers don't double-fire).
//
// Phase 1: cursor pinned at end. Left/right arrow navigation and full
// caret model are Phase 2.
function handleTextInputKey(node: Instance, data: string): boolean {
  const props: any = node.props || {};
  const isMulti = node.type !== 'TextInput';
  const cur: string = typeof props.value === 'string' ? props.value
                    : typeof props.defaultValue === 'string' ? props.defaultValue
                    : '';

  // Tab + Shift-Tab pass through so focus.ts can cycle off the field.
  if (data === '\t' || data === '\x1b[Z') return false;
  // Esc — drop focus on the field, return control to cart-level handlers.
  if (data === '\x1b') {
    setFocusedId(-1);
    return true;
  }
  // Enter — TextInput submits; multi-line nodes append a newline.
  if (data === '\r' || data === '\n') {
    if (isMulti) {
      dispatchTo(node.id, ['onChangeText'], cur + '\n');
      dispatchTo(node.id, ['onChange'], { target: { value: cur + '\n' } });
    } else {
      dispatchTo(node.id, ['onSubmitEditing', 'onSubmit'], { value: cur });
    }
    requestPaint();
    return true;
  }
  // Backspace / Delete — strip the last char.
  if (data === '\x7f' || data === '\b') {
    if (cur.length === 0) return true;
    const next = cur.slice(0, -1);
    dispatchTo(node.id, ['onChangeText'], next);
    dispatchTo(node.id, ['onChange'], { target: { value: next } });
    requestPaint();
    return true;
  }
  // Ignore other ANSI control sequences (arrows, function keys, etc.).
  if (data.startsWith('\x1b')) return true;
  // Printable: append. Multi-byte UTF-8 fragments arrive as one chunk
  // from V8's UTF-8 stdin shim, so we can append wholesale.
  if (data.length === 0) return true;
  // Filter raw control chars except those handled above.
  if (data.length === 1 && data.charCodeAt(0) < 0x20) return true;
  const next = cur + data;
  dispatchTo(node.id, ['onChangeText'], next);
  dispatchTo(node.id, ['onChange'], { target: { value: next } });
  requestPaint();
  return true;
}

// Dispatch helper — fires a handler from handlerRegistry by node id and
// alias name. Used by focus.ts to activate Pressables on Enter, and by
// the mouse path to fire clicks.
export function dispatchTo(id: number, names: string[], ...args: any[]): boolean {
  const h = handlerRegistry.get(id);
  if (!h) return false;
  for (const n of names) {
    const fn = h[n];
    if (typeof fn === 'function') { try { fn(...args); } catch {} return true; }
  }
  return false;
}
