// editors/decal/decalEdit.ts — the shared DECAL node-editing core (req_1730/req_1831).
//
// The materials/decal COMPOSER (editors/workbench/materials) and the mesh STUDIO
// painter (editors/model/studiokit) both author the same DecalDoc — text (real
// fonts), rect (border/radius + shader/texture fills), image, and neon path. This
// module is the ONE place that vocabulary lives as pure functions over a DecalDoc,
// so the painter folds in the composer's capabilities without a private copy
// ([[feedback_rule_of_two_no_magic_values]]). Every function returns a NEW doc (or
// node) and never mutates — the caller owns persistence + emit.
//
// Data only — no React. The field controls are DecalNodeFields.tsx; the draggable
// flat stage is DecalStage.tsx; both build on these primitives.

import {
  emptyDecalDoc,
  type DecalAlign,
  type DecalDoc,
  type DecalNode,
} from '../../game/textures/decal';

export { emptyDecalDoc };

// CSS-style font surfaces the host maps to a face id (v8_app.zig fontFamilyIdFor);
// unknown names fall back to default. Shared by every text-node control.
export const FONT_FAMILIES = ['default', 'sans-serif', 'serif', 'monospace', 'noto', 'arial', 'inter', 'roboto'];
export const FONT_WEIGHTS = ['400', '600', '700', '800', '900'];
export const ALIGN_OPTS: DecalAlign[] = ['left', 'center', 'right'];
export const MIN_NODE_SIZE = 1;

export type DecalResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** The eight resize-handle anchors, as fractional offsets in the node's box. */
export const DECAL_RESIZE_HANDLES: { id: DecalResizeHandle; x: 0 | 0.5 | 1; y: 0 | 0.5 | 1 }[] = [
  { id: 'nw', x: 0, y: 0 },
  { id: 'n', x: 0.5, y: 0 },
  { id: 'ne', x: 1, y: 0 },
  { id: 'e', x: 1, y: 0.5 },
  { id: 'se', x: 1, y: 1 },
  { id: 's', x: 0.5, y: 1 },
  { id: 'sw', x: 0, y: 1 },
  { id: 'w', x: 0, y: 0.5 },
];

/** Deep clone via JSON — DecalDocs are plain data, so this is lossless. */
export function cloneDoc(doc: DecalDoc): DecalDoc {
  return JSON.parse(JSON.stringify(doc)) as DecalDoc;
}

/** Mint a unique `${kind}-${n}` id for a new node in this doc. */
export function mintNodeId(doc: DecalDoc, kind: DecalNode['kind']): string {
  let n = doc.nodes.length + 1;
  while (doc.nodes.some((node) => node.id === `${kind}-${n}`)) n += 1;
  return `${kind}-${n}`;
}

export function parseWeight(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 400;
}

/** Normalise a file-picker result: strip quotes + a `file://` scheme. */
export function cleanPickedPath(raw: string): string {
  let p = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (p.startsWith('file://')) p = decodeURIComponent(p.slice('file://'.length));
  return p;
}

// ── node factories (default placements scaled to the doc) ─────────────────────

export function newRect(doc: DecalDoc): DecalNode {
  return { id: mintNodeId(doc, 'rect'), kind: 'rect', x: doc.width / 4, y: doc.height / 4, w: doc.width / 2, h: doc.height / 2, bg: '#2563eb', borderRadius: 8 };
}

export function newText(doc: DecalDoc): DecalNode {
  return { id: mintNodeId(doc, 'text'), kind: 'text', x: doc.width / 8, y: doc.height / 3, w: (doc.width * 3) / 4, h: doc.height / 3, text: 'BILLBOARD', color: '#f8fafc', fontSize: Math.round(doc.height / 4), fontWeight: 800, align: 'center' };
}

export function newImage(doc: DecalDoc, src = ''): DecalNode {
  return { id: mintNodeId(doc, 'image'), kind: 'image', x: doc.width / 4, y: doc.height / 4, w: doc.width / 2, h: doc.height / 2, src };
}

/** A starter neon tube — a horizontal lit line across the node box. The pen/logo
 *  path is then edited via the `d` field; coords are absolute doc pixels. */
export function newPath(doc: DecalDoc): DecalNode {
  const x0 = Math.round(doc.width / 4);
  const x1 = Math.round((doc.width * 3) / 4);
  const y = Math.round(doc.height / 2);
  return {
    id: mintNodeId(doc, 'path'), kind: 'path',
    x: x0, y: y - 8, w: x1 - x0, h: 16,
    d: `M ${x0} ${y} L ${x1} ${y}`,
    stroke: '#39ff14', strokeWidth: 6, glowOpacity: 0.6,
  };
}

// ── pure doc mutations (return a new doc) ─────────────────────────────────────

export function addNode(doc: DecalDoc, node: DecalNode): DecalDoc {
  return { ...doc, nodes: [...doc.nodes, node] };
}

export function patchNode(doc: DecalDoc, id: string, patch: Partial<DecalNode>): DecalDoc {
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as DecalNode) : n)) };
}

export function removeNode(doc: DecalDoc, id: string): DecalDoc {
  return { ...doc, nodes: doc.nodes.filter((n) => n.id !== id) };
}

export function duplicateNode(doc: DecalDoc, id: string): DecalDoc {
  const src = doc.nodes.find((n) => n.id === id);
  if (!src) return doc;
  return addNode(doc, { ...src, id: mintNodeId(doc, src.kind), x: src.x + 16, y: src.y + 16 } as DecalNode);
}

/** Move a node `dir` (+1 up / -1 down) in the paint order (later = on top). */
export function reorderNode(doc: DecalDoc, id: string, dir: 1 | -1): DecalDoc {
  const i = doc.nodes.findIndex((n) => n.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= doc.nodes.length) return doc;
  const nodes = [...doc.nodes];
  [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
  return { ...doc, nodes };
}

export function moveNode(doc: DecalDoc, id: string, dx: number, dy: number): DecalDoc {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return doc;
  return patchNode(doc, id, { x: node.x + dx, y: node.y + dy });
}

export function toggleHidden(doc: DecalDoc, id: string): DecalDoc {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return doc;
  return patchNode(doc, id, { hidden: node.hidden ? undefined : true } as Partial<DecalNode>);
}

export function renameNode(doc: DecalDoc, id: string, name: string): DecalDoc {
  const clean = name.trim();
  return patchNode(doc, id, { name: clean || undefined } as Partial<DecalNode>);
}

/** The x/y/w/h a resize handle drag yields, clamped to MIN_NODE_SIZE so a box
 *  can't invert. Shared by the flat stage and the resize-by-handle store path. */
export function resizeNodePatch(node: DecalNode, handle: DecalResizeHandle, dx: number, dy: number): Pick<DecalNode, 'x' | 'y' | 'w' | 'h'> {
  let x = node.x;
  let y = node.y;
  let w = node.w;
  let h = node.h;
  if (handle.includes('e')) w += dx;
  if (handle.includes('s')) h += dy;
  if (handle.includes('w')) { x += dx; w -= dx; }
  if (handle.includes('n')) { y += dy; h -= dy; }
  if (w < MIN_NODE_SIZE) {
    if (handle.includes('w')) x = node.x + node.w - MIN_NODE_SIZE;
    w = MIN_NODE_SIZE;
  }
  if (h < MIN_NODE_SIZE) {
    if (handle.includes('n')) y = node.y + node.h - MIN_NODE_SIZE;
    h = MIN_NODE_SIZE;
  }
  return { x, y, w, h };
}

export function resizeNode(doc: DecalDoc, id: string, handle: DecalResizeHandle, dx: number, dy: number): DecalDoc {
  const node = doc.nodes.find((n) => n.id === id);
  if (!node) return doc;
  return patchNode(doc, id, resizeNodePatch(node, handle, dx, dy));
}

/** Display name for a node in a layer list (its name, else `${kind} ${n}`). */
export function nodeLayerName(node: DecalNode, index: number): string {
  return node.name ?? `${node.kind} ${index + 1}`;
}

/** One-line metadata describing a node's content (for layer rows). */
export function nodeLayerMeta(node: DecalNode): string {
  if (node.kind === 'rect') return node.fillShaderId ? `effect · ${node.fillShaderId}` : 'rect · flat fill';
  if (node.kind === 'text') return `text · ${node.text || 'empty'}`;
  if (node.kind === 'path') return `neon · ${node.stroke}`;
  return node.src ? `image · ${node.src.split('/').pop()}` : 'image · no source';
}
