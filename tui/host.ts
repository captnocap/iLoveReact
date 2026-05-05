// Tiny TUI host for ReactJIT primitives (Box, Text).
// Same shape as renderer/hostConfig.ts — react-reconciler talks to us,
// we build a tree, lay it out on a character grid, and paint with ANSI.

import Reconciler from 'react-reconciler';
import { DefaultEventPriority } from 'react-reconciler/constants';

// ── Tree ────────────────────────────────────────────────────────────

export type BoxProps = {
  width?: number | 'fill';
  height?: number | 'fill';
  flexDirection?: 'row' | 'column';
  gap?: number;
  padding?: number;
  paddingX?: number;
  paddingY?: number;
  bg?: string;     // hex "#rrggbb"
  fg?: string;
  border?: boolean;
  borderColor?: string;
  bold?: boolean;
  flexGrow?: number;
  justify?: 'start' | 'center' | 'end' | 'between';
  align?: 'start' | 'center' | 'end';
  wrap?: boolean;
};

type Node =
  | { kind: 'box'; id: number; type: 'box'; props: BoxProps; children: Node[] }
  | { kind: 'text'; id: number; type: 'text'; props: BoxProps; children: Node[] }
  | { kind: 'rawtext'; id: number; text: string };

// A <text> node's rendered string is *derived* every paint from its
// rawtext children — never cached. Otherwise React's commitTextUpdate
// (which mutates the rawtext) would never propagate to the parent.
function textOf(n: Node): string {
  if (n.kind === 'rawtext') return n.text;
  if (n.kind === 'text') return n.children.map(textOf).join('');
  return '';
}

let idc = 0;
const root: { children: Node[] } = { children: [] };
let scheduled = false;
let entered = false;

function scheduleRepaint() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => { scheduled = false; repaint(); });
}

// ── Reconciler config ───────────────────────────────────────────────

const cfg: any = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,

  getRootHostContext: () => ({}),
  getChildHostContext: () => ({}),
  getPublicInstance: (n: any) => n,
  prepareForCommit: () => null,
  resetAfterCommit: () => scheduleRepaint(),
  preparePortalMount: () => {},
  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,
  // Always reconcile children — even single-string text content goes through
  // createTextInstance so updates land in commitTextUpdate.
  shouldSetTextContent: () => false,
  getCurrentEventPriority: () => DefaultEventPriority,
  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur: () => {},
  afterActiveInstanceBlur: () => {},
  prepareScopeUpdate: () => {},
  getInstanceFromScope: () => null,
  detachDeletedInstance: () => {},
  clearContainer: (c: any) => { c.children.length = 0; },

  createInstance(type: string, props: any): Node {
    const id = ++idc;
    if (type === 'text') return { kind: 'text', id, type: 'text', props, children: [] };
    return { kind: 'box', id, type: 'box', props, children: [] };
  },
  createTextInstance(text: string): Node {
    return { kind: 'rawtext', id: ++idc, text };
  },

  appendInitialChild(parent: Node, child: Node) {
    if (parent.kind === 'box' || parent.kind === 'text') parent.children.push(child);
  },
  appendChild(parent: Node, child: Node) { (cfg as any).appendInitialChild(parent, child); },
  appendChildToContainer(container: any, child: Node) { container.children.push(child); },
  removeChild(parent: Node, child: Node) {
    if (parent.kind === 'box' || parent.kind === 'text') {
      const i = parent.children.indexOf(child);
      if (i !== -1) parent.children.splice(i, 1);
    }
  },
  removeChildFromContainer(container: any, child: Node) {
    const i = container.children.indexOf(child);
    if (i !== -1) container.children.splice(i, 1);
  },
  insertBefore(parent: Node, child: Node, before: Node) {
    if (parent.kind !== 'box' && parent.kind !== 'text') return;
    const i = parent.children.indexOf(before);
    if (i === -1) parent.children.push(child);
    else parent.children.splice(i, 0, child);
  },
  insertInContainerBefore(container: any, child: Node, before: Node) {
    const i = container.children.indexOf(before);
    if (i === -1) container.children.push(child);
    else container.children.splice(i, 0, child);
  },
  finalizeInitialChildren: () => false,
  prepareUpdate(_inst: Node, _t: string, oldProps: any, newProps: any) {
    return oldProps === newProps ? null : newProps;
  },
  commitUpdate(inst: Node, payload: any) {
    if (!payload) return;
    if (inst.kind === 'box' || inst.kind === 'text') inst.props = payload;
  },
  commitTextUpdate(inst: Node, _old: string, next: string) {
    if (inst.kind === 'rawtext') inst.text = next;
  },
};

const reconciler = Reconciler(cfg);
const container = reconciler.createContainer(root, 0, null, false, null, '', () => {}, null);

export function render(element: any) {
  reconciler.updateContainer(element, container, null, () => {});
}

// ── Layout (flex on character grid) ─────────────────────────────────

type Box = { x: number; y: number; w: number; h: number; node: Node };

function intrinsic(node: Node): { w: number; h: number } {
  if (node.kind === 'rawtext') return { w: node.text.length, h: 1 };
  if (node.kind === 'text') return { w: textOf(node).length, h: 1 };

  const p = node.props;
  const padX = p.paddingX ?? p.padding ?? 0;
  const padY = p.paddingY ?? p.padding ?? 0;
  const gap = p.gap ?? 0;
  const dir = p.flexDirection ?? 'column';
  const border = p.border ? 1 : 0;
  const kids = node.children.map(intrinsic);

  let cw = 0, ch = 0;
  if (dir === 'row') {
    cw = kids.reduce((a, k) => a + k.w, 0) + Math.max(0, kids.length - 1) * gap;
    ch = kids.reduce((m, k) => Math.max(m, k.h), 0);
  } else {
    cw = kids.reduce((m, k) => Math.max(m, k.w), 0);
    ch = kids.reduce((a, k) => a + k.h, 0) + Math.max(0, kids.length - 1) * gap;
  }
  const w = (typeof p.width === 'number') ? p.width : cw + padX * 2 + border * 2;
  const h = (typeof p.height === 'number') ? p.height : ch + padY * 2 + border * 2;
  return { w, h };
}

function layout(node: Node, x: number, y: number, w: number, h: number, out: Box[]) {
  out.push({ x, y, w, h, node });
  if (node.kind !== 'box') return;
  const p = node.props;
  const padX = p.paddingX ?? p.padding ?? 0;
  const padY = p.paddingY ?? p.padding ?? 0;
  const gap = p.gap ?? 0;
  const dir = p.flexDirection ?? 'column';
  const border = p.border ? 1 : 0;
  const ix = x + padX + border;
  const iy = y + padY + border;
  const iw = Math.max(0, w - padX * 2 - border * 2);
  const ih = Math.max(0, h - padY * 2 - border * 2);

  const kids = node.children;
  if (kids.length === 0) return;

  // flexWrap: greedy line-pack along main, stack lines along cross.
  // Only meaningful when direction has a finite main extent.
  if (p.wrap && (dir === 'row' ? iw : ih) > 0) {
    const measured = kids.map(k => {
      const ip = intrinsic(k);
      const kp: BoxProps = (k as any).props ?? {};
      const m = dir === 'row'
        ? (typeof kp.width  === 'number' ? kp.width  : ip.w)
        : (typeof kp.height === 'number' ? kp.height : ip.h);
      const c = dir === 'row'
        ? (typeof kp.height === 'number' ? kp.height : ip.h)
        : (typeof kp.width  === 'number' ? kp.width  : ip.w);
      return { m, c };
    });
    const lines: { idxs: number[]; main: number; cross: number }[] = [];
    let line: { idxs: number[]; main: number; cross: number } = { idxs: [], main: 0, cross: 0 };
    const innerMainExtent = dir === 'row' ? iw : ih;
    for (let i = 0; i < kids.length; i++) {
      const { m, c } = measured[i];
      const tentative = line.main + (line.idxs.length ? gap : 0) + m;
      if (line.idxs.length > 0 && tentative > innerMainExtent) {
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
        layout(kids[i], cx, cy, cw, chh, out);
        mainCursor += m + gap;
      }
      crossCursor += ln.cross + gap;
    }
    return;
  }

  // Resolve fixed sizes; collect grow weights
  const main = (k: { w: number; h: number }) => dir === 'row' ? k.w : k.h;
  const cross = (k: { w: number; h: number }) => dir === 'row' ? k.h : k.w;
  const innerMain = dir === 'row' ? iw : ih;
  const innerCross = dir === 'row' ? ih : iw;

  const sizes: { main: number; cross: number; grow: number; align: BoxProps['align'] | undefined }[] = [];
  let fixed = 0, growSum = 0;
  for (const k of kids) {
    const ip = intrinsic(k);
    const kp: BoxProps = (k as any).props ?? {};
    const explicitMain = dir === 'row' ? kp.width : kp.height;
    const explicitCross = dir === 'row' ? kp.height : kp.width;
    let mainSize: number;
    let grow = kp.flexGrow ?? 0;
    if (explicitMain === 'fill') { grow = Math.max(grow, 1); mainSize = 0; }
    else if (typeof explicitMain === 'number') mainSize = explicitMain;
    else mainSize = main(ip);
    // CSS-flex cross sizing. `align` resolves like CSS align-self: child
    // wins, else parent's align acts as align-items, else stretch. Stretch
    // means crossSize = innerCross (full); start/center/end means shrink to
    // intrinsic and offset.
    const align = kp.align ?? p.align;
    let crossSize: number;
    if (explicitCross === 'fill') crossSize = innerCross;
    else if (typeof explicitCross === 'number') crossSize = explicitCross;
    else if (align === 'start' || align === 'center' || align === 'end') crossSize = Math.min(innerCross, cross(ip));
    else crossSize = innerCross; // stretch (default)
    fixed += mainSize;
    growSum += grow;
    sizes.push({ main: mainSize, cross: crossSize, grow, align });
  }

  const totalGap = Math.max(0, kids.length - 1) * gap;
  const free = Math.max(0, innerMain - fixed - totalGap);
  if (growSum > 0) {
    for (const s of sizes) if (s.grow > 0) s.main += Math.floor(free * s.grow / growSum);
  }

  // justify
  const consumed = sizes.reduce((a, s) => a + s.main, 0) + totalGap;
  const slack = Math.max(0, innerMain - consumed);
  let cursor = 0;
  let extraGap = 0;
  if (growSum === 0) {
    if (p.justify === 'center') cursor = Math.floor(slack / 2);
    else if (p.justify === 'end') cursor = slack;
    else if (p.justify === 'between' && kids.length > 1) extraGap = Math.floor(slack / (kids.length - 1));
  }

  for (let i = 0; i < kids.length; i++) {
    const s = sizes[i];
    let crossOffset = 0;
    if (s.align === 'center') crossOffset = Math.floor((innerCross - s.cross) / 2);
    else if (s.align === 'end') crossOffset = innerCross - s.cross;
    const cx = dir === 'row' ? ix + cursor : ix + crossOffset;
    const cy = dir === 'row' ? iy + crossOffset : iy + cursor;
    const cw = dir === 'row' ? s.main : s.cross;
    const chh = dir === 'row' ? s.cross : s.main;
    layout(kids[i], cx, cy, cw, chh, out);
    cursor += s.main + gap + extraGap;
  }
}

// ── Paint ───────────────────────────────────────────────────────────

type Cell = { ch: string; fg: string | null; bg: string | null; bold: boolean };
const blank = (): Cell => ({ ch: ' ', fg: null, bg: null, bold: false });

function hex(c: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function fgEsc(c: string | null) { if (!c) return ''; const r = hex(c); return r ? `\x1b[38;2;${r[0]};${r[1]};${r[2]}m` : ''; }
function bgEsc(c: string | null) { if (!c) return ''; const r = hex(c); return r ? `\x1b[48;2;${r[0]};${r[1]};${r[2]}m` : ''; }

function fillRect(grid: Cell[][], x: number, y: number, w: number, h: number, bg: string | null, fg: string | null) {
  const W = grid[0]?.length ?? 0, H = grid.length;
  for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) {
      const c = grid[yy][xx];
      if (bg) c.bg = bg;
      if (fg) c.fg = fg;
    }
  }
}
function drawBorder(grid: Cell[][], x: number, y: number, w: number, h: number, color: string | null) {
  const W = grid[0]?.length ?? 0, H = grid.length;
  const put = (xx: number, yy: number, ch: string) => {
    if (xx < 0 || yy < 0 || xx >= W || yy >= H) return;
    const c = grid[yy][xx];
    c.ch = ch; if (color) c.fg = color;
  };
  if (w < 2 || h < 2) return;
  put(x, y, '┌'); put(x + w - 1, y, '┐'); put(x, y + h - 1, '└'); put(x + w - 1, y + h - 1, '┘');
  for (let xx = x + 1; xx < x + w - 1; xx++) { put(xx, y, '─'); put(xx, y + h - 1, '─'); }
  for (let yy = y + 1; yy < y + h - 1; yy++) { put(x, yy, '│'); put(x + w - 1, yy, '│'); }
}
function writeText(grid: Cell[][], x: number, y: number, w: number, h: number, text: string, fg: string | null, bold: boolean) {
  const W = grid[0]?.length ?? 0, H = grid.length;
  if (y < 0 || y >= H || h <= 0) return;
  const max = Math.min(text.length, w);
  for (let i = 0; i < max; i++) {
    const xx = x + i;
    if (xx < 0 || xx >= W) continue;
    const c = grid[y][xx];
    c.ch = text[i];
    if (fg) c.fg = fg;
    if (bold) c.bold = true;
  }
}

// Previous-frame buffer for dirty diffing. React will commit per state
// change, and full-screen repaints flood the TTY — only emit cells that
// actually differ from the last frame.
let prev: Cell[][] | null = null;
let prevW = 0, prevH = 0;

function cellEq(a: Cell, b: Cell): boolean {
  return a.ch === b.ch && a.fg === b.fg && a.bg === b.bg && a.bold === b.bold;
}

function repaint() {
  if (!entered) return; // headless mode: paint goes through headlessSnapshot()
  const W = process.stdout.columns || 80;
  const H = process.stdout.rows || 24;
  const grid: Cell[][] = Array.from({ length: H }, () => Array.from({ length: W }, blank));

  const boxes: Box[] = [];
  for (const child of root.children) {
    layout(child, 0, 0, W, H, boxes);
  }

  // Paint boxes back-to-front (parents first thanks to push order in layout())
  for (const b of boxes) {
    if (b.node.kind === 'box') {
      const p = b.node.props;
      const inheritedFg = p.fg ?? null;
      const bg = p.bg ?? null;
      if (bg) fillRect(grid, b.x, b.y, b.w, b.h, bg, inheritedFg);
      else if (inheritedFg) fillRect(grid, b.x, b.y, b.w, b.h, null, inheritedFg);
      if (p.border) drawBorder(grid, b.x, b.y, b.w, b.h, p.borderColor ?? p.fg ?? null);
    } else if (b.node.kind === 'text') {
      const p = b.node.props;
      writeText(grid, b.x, b.y, b.w, b.h, textOf(b.node), p.fg ?? null, !!p.bold);
    }
  }

  // Resize invalidates the entire prev buffer — fall back to full paint.
  const fullRepaint = !prev || prevW !== W || prevH !== H;

  let out = '';
  let lastFg: string | null | '__init' = '__init';
  let lastBg: string | null | '__init' = '__init';
  let lastBold = false;
  let cursorX = -1, cursorY = -1;

  const moveTo = (x: number, y: number) => {
    if (cursorX === x && cursorY === y) return;
    out += `\x1b[${y + 1};${x + 1}H`;
    cursorX = x; cursorY = y;
  };

  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const c = grid[y][x];
      const same = !fullRepaint && cellEq(prev![y][x], c);
      if (same) { x++; continue; }
      // Found a dirty run starting at x — emit until next clean cell.
      moveTo(x, y);
      while (x < W) {
        const cc = grid[y][x];
        if (!fullRepaint && cellEq(prev![y][x], cc)) break;
        if (cc.fg !== lastFg) { out += cc.fg ? fgEsc(cc.fg) : '\x1b[39m'; lastFg = cc.fg; }
        if (cc.bg !== lastBg) { out += cc.bg ? bgEsc(cc.bg) : '\x1b[49m'; lastBg = cc.bg; }
        if (cc.bold !== lastBold) { out += cc.bold ? '\x1b[1m' : '\x1b[22m'; lastBold = cc.bold; }
        out += cc.ch;
        cursorX = x + 1; cursorY = y;
        x++;
      }
    }
  }

  if (out.length > 0) {
    out += '\x1b[0m';
    process.stdout.write(out);
  }

  prev = grid;
  prevW = W; prevH = H;
}

// ── Lifecycle ───────────────────────────────────────────────────────

const ALT = '\x1b[?1049h';
const RESTORE = '\x1b[?1049l';
const HIDE = '\x1b[?25l';
const SHOW = '\x1b[?25h';

// 4Hz resize poll — v8cli has no SIGWINCH wiring, so we ioctl every 250ms
// and repaint when dimensions actually change. Cheap (one syscall) and
// far less hassle than threading a signal through the event loop.
let lastW = 0, lastH = 0;
let resizePollTimer: any = null;
function pollResize() {
  const w = process.stdout.columns || 80;
  const h = process.stdout.rows || 24;
  if (w !== lastW || h !== lastH) {
    lastW = w; lastH = h;
    prev = null; // dimensions changed → full repaint
    scheduleRepaint();
  }
}

export function enter() {
  entered = true;
  prev = null; // first frame after enter is always full repaint
  lastW = process.stdout.columns || 80;
  lastH = process.stdout.rows || 24;
  process.stdout.write(ALT + HIDE + '\x1b[2J\x1b[H');
  scheduleRepaint();
  if (resizePollTimer == null) resizePollTimer = setInterval(pollResize, 250);
}
export function leave() {
  if (!entered) return;
  entered = false;
  if (resizePollTimer != null) { clearInterval(resizePollTimer); resizePollTimer = null; }
  process.stdout.write('\x1b[0m' + SHOW + RESTORE);
}

// Headless snapshot for tests — paints once into an explicit-size grid and
// returns the result as plain text (no ANSI). Bypasses stdout entirely.
export function headlessSnapshot(width: number, height: number): string {
  const grid: Cell[][] = Array.from({ length: height }, () => Array.from({ length: width }, blank));
  const boxes: Box[] = [];
  for (const child of root.children) layout(child, 0, 0, width, height, boxes);
  for (const b of boxes) {
    if (b.node.kind === 'box') {
      const p = b.node.props;
      if (p.bg) fillRect(grid, b.x, b.y, b.w, b.h, p.bg, p.fg ?? null);
      if (p.border) drawBorder(grid, b.x, b.y, b.w, b.h, p.borderColor ?? p.fg ?? null);
    } else if (b.node.kind === 'text') {
      writeText(grid, b.x, b.y, b.w, b.h, textOf(b.node), b.node.props.fg ?? null, !!b.node.props.bold);
    }
  }
  return grid.map(row => row.map(c => c.ch).join('')).join('\n');
}

process.stdout.on('resize', () => scheduleRepaint());
process.on('exit', leave);
process.on('SIGINT', () => { leave(); process.exit(0); });
process.on('SIGTERM', () => { leave(); process.exit(0); });

// Tiny key event bus — carts can subscribe with subscribeKey().
type KeyHandler = (key: string) => void;
const keyHandlers = new Set<KeyHandler>();
export function subscribeKey(fn: KeyHandler): () => void {
  keyHandlers.add(fn);
  return () => keyHandlers.delete(fn);
}

export function startInput() {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data: string) => {
    if (data === '\x03' || data === 'q') { leave(); process.exit(0); }
    for (const fn of keyHandlers) fn(data);
  });
}
