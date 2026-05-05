import { Component, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Canvas, Pressable, ScrollView, Text, TextInput } from '@reactjit/runtime/primitives';
import { classifiers as S } from '@reactjit/core';
import { storySections } from '../gallery/stories';
import { getCanonicalStoryTags, formatCanonicalTagLabel, resolveGalleryGroup } from '../gallery/taxonomy';
import { getDataStoryStorage, isDataStory } from '../gallery/types';
import type { GallerySection } from '../gallery/types';
import { LayerToolButton } from '../gallery/components/layer-control-panel/LayerToolbar';
import { LayerPropertiesPanel } from '../gallery/components/layer-control-panel/LayerPropertiesPanel';
import { LayerThumbnail } from '../gallery/components/layer-control-panel/LayerThumbnail';
import { LayerLockToggle, LayerVisibilityToggle } from '../gallery/components/layer-control-panel/LayerToggleAtoms';
import { StripBadge } from '../gallery/components/controls-specimen/StripBadge';
import { StepSlider } from '../gallery/components/controls-specimen/StepSlider';
import { SyntaxHighlighter } from '../gallery/components/syntax-highlighter/SyntaxHighlighter';
import { layerBlendModes, type LayerBlendMode, type LayerControlLayer, type LayerKind } from '../gallery/data/overstock/layer-control-panel';
import type { CodeLine } from '../gallery/data/overstock/code-line';
import { BoxSelect, ClipboardPaste, Copy, Group, Hand, MonitorCheck, MousePointer, MousePointerClick, PenLine, Square, Trash2, Type, Ungroup } from '@reactjit/runtime/icons/icons';
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';

type NodeKind = 'Page' | 'Box' | 'Text' | 'Pressable' | 'GalleryAtom';
type Align = 'flex-start' | 'center' | 'flex-end';

type SNode = {
  id: string;
  kind: NodeKind;
  name?: string;
  galleryId?: string;
  shapeId?: string;
  text?: string;
  bg?: string;
  color?: string;
  width?: number;
  height?: number;
  padding?: number;
  gap?: number;
  flexDirection?: 'row' | 'column';
  alignH?: Align;
  alignV?: Align;
  x?: number;
  y?: number;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  fill?: number;
  blendMode?: LayerBlendMode;
  effects?: number;
  mask?: boolean;
  maskLow?: number;
  maskHigh?: number;
  children: SNode[];
};

type ComposerDoc = {
  id: string;
  name: string;
  version: 1;
  updatedAt: number;
  pages: SNode[];
  selection: string[];
  viewport: { x: number; y: number; zoom: number };
};

type PaletteAtom = {
  id: string;
  title: string;
  group: string;
  tags: string[];
  kind: 'primitive' | 'gallery' | 'shape';
  section?: GallerySection;
};

type ComposerTool = 'select' | 'move' | 'draw';
type PaletteTab = 'all' | 'primitives' | 'shapes' | 'gallery';

const STORE_KEY = 'composer:draft:default';
const STORE_INDEX_KEY = 'composer:drafts';
const PAGE_PRESETS = [
  { label: '1440 x 900', width: 1440, height: 900 },
  { label: '1280 x 800', width: 1280, height: 800 },
  { label: 'iPhone 16 Pro', width: 393, height: 852 },
];
const SURFACE_COLORS = ['#ffffff', '#f8fafc', '#f3f4f6', '#e5e7eb', '#dbeafe', '#dcfce7', '#fef3c7', '#fee2e2', '#ede9fe', '#111827'];
const ACCENT_COLORS = ['#111827', '#374151', '#6b7280', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#16a34a', '#0891b2'];
const PAGE_SIZES = [
  { label: '1440', width: 1440, height: 900 },
  { label: '1280', width: 1280, height: 800 },
  { label: '1024', width: 1024, height: 768 },
  { label: 'Phone', width: 393, height: 852 },
];
const SPACING_PRESETS = [
  { label: 'ZERO', padding: 0, gap: 0 },
  { label: 'TIGHT', padding: 8, gap: 4 },
  { label: 'BASE', padding: 12, gap: 8 },
  { label: 'ROOMY', padding: 20, gap: 12 },
  { label: 'LOOSE', padding: 32, gap: 18 },
];

let seq = 0;
function nextId(prefix = 'n'): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}`;
}

function defaultPage(index: number): SNode {
  return {
    id: nextId('page'),
    kind: 'Page',
    name: `Page ${index + 1}`,
    x: 80 + index * 360,
    y: 80,
    width: 320,
    height: 220,
    bg: '#ffffff',
    padding: 20,
    gap: 12,
    flexDirection: 'column',
    children: [],
  };
}

function nextPagePosition(pages: SNode[]): { x: number; y: number } {
  if (!pages.length) return { x: 80, y: 80 };
  const right = pages.reduce((max, page) => Math.max(max, (page.x || 0) + (page.width || 320)), 0);
  return { x: right + 80, y: 80 };
}

function initialDoc(): ComposerDoc {
  return {
    id: 'default',
    name: 'Composer Draft',
    version: 1,
    updatedAt: Date.now(),
    pages: [defaultPage(0)],
    selection: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

function readStore(key: string): string | null {
  const host = globalThis as { __store_get?: (storeKey: string) => unknown };
  if (typeof host.__store_get !== 'function') return null;
  const value = host.__store_get(key);
  return typeof value === 'string' ? value : null;
}

function writeStore(key: string, value: string) {
  const host = globalThis as { __store_set?: (storeKey: string, storeValue: string) => void };
  if (typeof host.__store_set === 'function') host.__store_set(key, value);
}

function loadDoc(): ComposerDoc {
  const raw = readStore(STORE_KEY);
  if (!raw) return initialDoc();
  try {
    const parsed = JSON.parse(raw) as ComposerDoc;
    if (parsed?.version === 1 && Array.isArray(parsed.pages)) {
      return normalizeDoc({ ...parsed, selection: [] });
    }
  } catch {}
  return initialDoc();
}

function saveDoc(doc: ComposerDoc) {
  const updated = { ...doc, updatedAt: Date.now() };
  writeStore(STORE_KEY, JSON.stringify(updated));
  writeStore(STORE_INDEX_KEY, JSON.stringify([{ id: updated.id, name: updated.name, updatedAt: updated.updatedAt }]));
}

function walk(nodes: SNode[], fn: (node: SNode, parent: SNode | null) => void, parent: SNode | null = null) {
  for (const node of nodes) {
    fn(node, parent);
    walk(node.children, fn, node);
  }
}

function findNode(nodes: SNode[], id: string): SNode | null {
  let found: SNode | null = null;
  walk(nodes, (node) => {
    if (node.id === id) found = node;
  });
  return found;
}

function findParent(nodes: SNode[], id: string): SNode | null {
  let found: SNode | null = null;
  walk(nodes, (node, parent) => {
    if (node.id === id) found = parent;
  });
  return found;
}

function findOwningPage(pages: SNode[], id: string | null): SNode | null {
  if (!id) return null;
  for (const page of pages) {
    if (page.id === id) return page;
    if (findNode(page.children, id)) return page;
  }
  return null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function maxSizeIn(parent: SNode | null): { width?: number; height?: number } {
  if (!parent) return {};
  return {
    width: parent.width != null ? Math.max(1, parent.width - (parent.padding || 0) * 2) : undefined,
    height: parent.height != null ? Math.max(1, parent.height - (parent.padding || 0) * 2) : undefined,
  };
}

function clampPatchToParent(node: SNode, parent: SNode | null, patch: Partial<SNode>): Partial<SNode> {
  if (node.kind === 'Page') return patch;
  const max = maxSizeIn(parent);
  const next = { ...patch };
  if (typeof next.width === 'number' && typeof max.width === 'number') next.width = clampNumber(next.width, 1, max.width);
  if (typeof next.height === 'number' && typeof max.height === 'number') next.height = clampNumber(next.height, 1, max.height);
  return next;
}

function patchNode(nodes: SNode[], id: string, patch: Partial<SNode>): SNode[] {
  return nodes.map((node) => node.id === id
    ? { ...node, ...patch }
    : { ...node, children: patchNode(node.children, id, patch) });
}

function insertNode(nodes: SNode[], parentId: string | null, child: SNode): SNode[] {
  if (!parentId) return [...nodes, child];
  return nodes.map((node) => node.id === parentId
    ? { ...node, children: [...node.children, child] }
    : { ...node, children: insertNode(node.children, parentId, child) });
}

function removeNodes(nodes: SNode[], ids: Set<string>): SNode[] {
  return nodes
    .filter((node) => !ids.has(node.id))
    .map((node) => ({ ...node, children: removeNodes(node.children, ids) }));
}

function moveNodeInList(nodes: SNode[], id: string, delta: -1 | 1): SNode[] {
  let moved = false;
  const visit = (items: SNode[]): SNode[] => {
    if (moved) return items;
    const index = items.findIndex((node) => node.id === id);
    if (index >= 0) {
      moved = true;
      const nextIndex = index + delta;
      if (nextIndex < 0 || nextIndex >= items.length) return items;
      const next = [...items];
      const current = next[index];
      next[index] = next[nextIndex];
      next[nextIndex] = current;
      return next;
    }
    return items.map((node) => {
      if (moved) return node;
      const nextChildren = visit(node.children);
      return nextChildren === node.children ? node : { ...node, children: nextChildren };
    });
  };
  return visit(nodes);
}

function ensureUniqueIds(nodes: SNode[], seen = new Set<string>()): SNode[] {
  return nodes.map((node) => {
    const id = seen.has(node.id) ? nextId(node.kind.toLowerCase()) : node.id;
    seen.add(id);
    const children = Array.isArray(node.children) ? node.children : [];
    const upgradedGalleryChildren = node.kind === 'GalleryAtom' && children.length === 0;
    const nextChildren = node.kind === 'GalleryAtom' && children.length === 0
      ? node.shapeId
        ? editableShapeChildren(node.name || node.galleryId || 'Shape atom')
        : editableGalleryChildren(node.name || node.galleryId || 'Gallery atom', node.galleryId || 'gallery-atom')
      : children;
    const nextNode: SNode = { ...node, id, children: ensureUniqueIds(nextChildren, seen) };
    if (node.kind === 'GalleryAtom') {
      const minimumHeight = galleryTemplateHeight(node.galleryId || node.shapeId || 'gallery-atom', Boolean(node.shapeId));
      if (upgradedGalleryChildren || node.height === 112 || node.height === 148) {
        nextNode.height = Math.max(node.height || 0, minimumHeight);
      }
      if (!node.width || node.width < 200) nextNode.width = node.shapeId ? 260 : 240;
    }
    return nextNode;
  });
}

function collectIds(nodes: SNode[], ids = new Set<string>()): Set<string> {
  for (const node of nodes) {
    ids.add(node.id);
    collectIds(node.children, ids);
  }
  return ids;
}

function flattenIds(nodes: SNode[]): string[] {
  const ids: string[] = [];
  walk(nodes, (node) => ids.push(node.id));
  return ids;
}

function normalizeDoc(doc: ComposerDoc): ComposerDoc {
  const pages = ensureUniqueIds(Array.isArray(doc.pages) ? doc.pages : []);
  const ids = collectIds(pages);
  const sel = Array.isArray(doc.selection) ? doc.selection : [];
  const selection = sel.filter((id, index) => ids.has(id) && sel.indexOf(id) === index);
  return { ...doc, pages, selection };
}

function outdentNode(nodes: SNode[], id: string): SNode[] {
  return nodes.flatMap((node) => {
    const childIndex = node.children.findIndex((child) => child.id === id);
    if (childIndex >= 0) {
      const child = node.children[childIndex];
      const parentWithoutChild = {
        ...node,
        children: node.children.filter((candidate) => candidate.id !== id),
      };
      return [parentWithoutChild, child];
    }
    return [{ ...node, children: outdentNode(node.children, id) }];
  });
}

function indentNode(nodes: SNode[], id: string): SNode[] {
  const index = nodes.findIndex((node) => node.id === id);
  if (index > 0) {
    const target = nodes[index - 1];
    if (target.kind !== 'Page' && target.kind !== 'Box' && target.kind !== 'GalleryAtom') return nodes;
    const child = nodes[index];
    return nodes
      .slice(0, index - 1)
      .concat([{ ...target, children: [...target.children, child] }])
      .concat(nodes.slice(index + 1));
  }
  return nodes.map((node) => ({ ...node, children: indentNode(node.children, id) }));
}

function cloneNode(node: SNode): SNode {
  return { ...node, id: nextId(), children: node.children.map(cloneNode) };
}

function readClipboardNodes(): SNode[] {
  const host = globalThis as { __clipboard_get?: () => unknown };
  if (typeof host.__clipboard_get !== 'function') return [];
  const raw = host.__clipboard_get();
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.type === 'reactjit/composer-nodes' && Array.isArray(parsed.nodes)) return parsed.nodes;
  } catch {}
  return [];
}

function writeClipboardNodes(nodes: SNode[]) {
  const host = globalThis as { __clipboard_set?: (value: string) => void };
  if (typeof host.__clipboard_set !== 'function') return;
  host.__clipboard_set(JSON.stringify({ type: 'reactjit/composer-nodes', version: 1, nodes }));
}

function primitiveNode(kind: 'Box' | 'Text' | 'Pressable'): SNode {
  if (kind === 'Text') return { id: nextId(), kind, text: 'Text', color: '#111827', children: [] };
  if (kind === 'Pressable') {
    return { id: nextId(), kind, text: 'Action', bg: '#2563eb', color: '#ffffff', padding: 10, children: [] };
  }
  return { id: nextId(), kind, width: 220, height: 120, bg: '#f3f4f6', padding: 12, gap: 8, children: [] };
}

function editableGalleryChildren(title: string, galleryId: string): SNode[] {
  const lower = galleryId.toLowerCase();
  if (lower.includes('bar-chart') || lower.includes('chart')) {
    return [
      { id: nextId(), kind: 'Text', text: title, color: '#111827', children: [] },
      {
        id: nextId('bars'),
        kind: 'Box',
        name: 'Chart bars',
        width: 220,
        height: 96,
        bg: '#ffffff',
        padding: 10,
        gap: 6,
        flexDirection: 'row',
        alignV: 'flex-end',
        children: [42, 68, 54, 88, 72].map((height, index) => ({
          id: nextId('bar'),
          kind: 'Box',
          name: `Bar ${index + 1}`,
          width: 28,
          height,
          bg: index % 2 === 0 ? '#2563eb' : '#06b6d4',
          children: [],
        })),
      },
      { id: nextId(), kind: 'Text', text: 'Editable chart template', color: '#4b5563', children: [] },
    ];
  }
  if (lower.includes('slider') || lower.includes('toggle') || lower.includes('selector') || lower.includes('badge')) {
    return [
      { id: nextId(), kind: 'Text', text: title, color: '#111827', children: [] },
      {
        id: nextId('control'),
        kind: 'Box',
        name: 'Control body',
        width: 220,
        height: 42,
        bg: '#ffffff',
        padding: 8,
        gap: 8,
        flexDirection: 'row',
        alignH: 'center',
        alignV: 'center',
        children: [
          { id: nextId('track'), kind: 'Box', name: 'Track', width: 132, height: 8, bg: '#d1d5db', children: [] },
          { id: nextId('knob'), kind: 'Box', name: 'Knob', width: 24, height: 24, bg: '#2563eb', children: [] },
          { id: nextId(), kind: 'Text', text: '64', color: '#4b5563', children: [] },
        ],
      },
    ];
  }
  if (lower.includes('card') || lower.includes('panel') || lower.includes('row') || lower.includes('notification')) {
    return [
      { id: nextId(), kind: 'Text', text: title, color: '#111827', children: [] },
      {
        id: nextId('body'),
        kind: 'Box',
        name: 'Content body',
        width: 220,
        height: 92,
        bg: '#ffffff',
        padding: 10,
        gap: 7,
        children: [
          { id: nextId(), kind: 'Text', text: 'Primary label', color: '#111827', children: [] },
          { id: nextId('line'), kind: 'Box', name: 'Supporting line', width: 160, height: 8, bg: '#d1d5db', children: [] },
          { id: nextId('line'), kind: 'Box', name: 'Detail line', width: 112, height: 8, bg: '#e5e7eb', children: [] },
        ],
      },
      { id: nextId(), kind: 'Pressable', text: 'Action', bg: '#111827', color: '#ffffff', padding: 8, children: [] },
    ];
  }
  if (lower.includes('scatter') || lower.includes('bubble')) {
    return [
      { id: nextId(), kind: 'Text', text: title, color: '#111827', children: [] },
      {
        id: nextId('plot'),
        kind: 'Box',
        name: 'Plot area',
        width: 220,
        height: 112,
        bg: '#ffffff',
        padding: 12,
        gap: 8,
        children: [1, 2, 3, 4].map((index) => ({
          id: nextId('bubble'),
          kind: 'Box',
          name: `Bubble ${index}`,
          width: 28 + index * 6,
          height: 28 + index * 6,
          bg: index % 2 === 0 ? '#7c3aed' : '#0891b2',
          children: [],
        })),
      },
    ];
  }
  return [
    { id: nextId(), kind: 'Text', text: title, color: '#111827', children: [] },
    {
      id: nextId('body'),
      kind: 'Box',
      name: 'Editable body',
      width: 220,
      height: 76,
      bg: '#ffffff',
      padding: 10,
      gap: 7,
      children: [
        { id: nextId(), kind: 'Text', text: 'Editable component section', color: '#4b5563', children: [] },
        { id: nextId('line'), kind: 'Box', name: 'Content line', width: 164, height: 8, bg: '#d1d5db', children: [] },
        { id: nextId('line'), kind: 'Box', name: 'Secondary line', width: 120, height: 8, bg: '#e5e7eb', children: [] },
      ],
    },
    { id: nextId(), kind: 'Pressable', text: 'Action', bg: '#111827', color: '#ffffff', padding: 8, children: [] },
  ];
}

function editableShapeChildren(title: string): SNode[] {
  return [
    { id: nextId(), kind: 'Text', text: title, color: '#111827', children: [] },
    { id: nextId(), kind: 'Text', text: 'Mock field / primary label', color: '#4b5563', children: [] },
    { id: nextId(), kind: 'Pressable', text: 'Open', bg: '#111827', color: '#ffffff', padding: 8, children: [] },
  ];
}

function galleryTemplateHeight(galleryId: string, isShape: boolean): number {
  if (isShape) return 168;
  const lower = galleryId.toLowerCase();
  if (lower.includes('chart') || lower.includes('scatter') || lower.includes('bubble')) return 190;
  if (lower.includes('card') || lower.includes('panel') || lower.includes('row') || lower.includes('notification')) return 196;
  if (lower.includes('slider') || lower.includes('toggle') || lower.includes('selector') || lower.includes('badge')) return 126;
  return 178;
}

function galleryNode(atom: PaletteAtom): SNode {
  const isShape = atom.kind === 'shape';
  return {
    id: nextId(),
    kind: 'GalleryAtom',
    galleryId: atom.id,
    shapeId: isShape ? atom.id : undefined,
    name: atom.title,
    width: isShape ? 260 : 240,
    height: galleryTemplateHeight(atom.id, isShape),
    bg: isShape ? '#ffffff' : '#f8fafc',
    padding: 12,
    gap: 8,
    children: isShape ? editableShapeChildren(atom.title) : editableGalleryChildren(atom.title, atom.id),
  };
}

function layerKindForNode(node: SNode): LayerKind {
  if (node.kind === 'Text') return 'type';
  if (node.kind === 'Page' || node.children.length > 0) return 'group';
  if (node.kind === 'GalleryAtom') return node.shapeId ? 'smart' : 'adjustment';
  if (node.kind === 'Pressable') return 'smart';
  return 'pixel';
}

function layerKindLabelForNode(node: SNode): string {
  if (node.kind === 'Page') return 'PAGE';
  if (node.kind === 'GalleryAtom') return node.shapeId ? 'SHAPE' : 'ATOM';
  if (node.kind === 'Pressable') return 'BUTTON';
  return node.kind.toUpperCase();
}

function layerThumbnailForNode(node: SNode): string {
  if (node.kind === 'Page') return 'PG';
  if (node.kind === 'Text') return 'TXT';
  if (node.kind === 'Pressable') return 'BTN';
  if (node.kind === 'GalleryAtom') return node.shapeId ? 'SHP' : 'ATM';
  return node.children.length ? 'GRP' : 'BOX';
}

function layerColorForNode(node: SNode): string {
  if (node.color) return node.color;
  if (node.bg) return node.bg;
  if (node.kind === 'Text') return 'theme:ink';
  if (node.kind === 'Pressable') return 'theme:blue';
  if (node.kind === 'GalleryAtom') return node.shapeId ? 'theme:lilac' : 'theme:accent';
  if (node.kind === 'Page') return 'theme:paperRule';
  return 'theme:ruleBright';
}

function nodeToLayer(node: SNode): LayerControlLayer {
  const width = node.width != null ? String(node.width) : '-';
  const height = node.height != null ? String(node.height) : '-';
  return {
    id: node.id,
    name: node.name || node.text || node.kind,
    kind: layerKindForNode(node),
    visible: node.visible !== false,
    locked: Boolean(node.locked),
    clipped: false,
    opacity: node.opacity ?? 100,
    fill: node.fill ?? 100,
    blendMode: node.blendMode || 'Normal',
    effects: node.effects ?? 0,
    mask: Boolean(node.mask),
    maskLow: node.maskLow ?? 0,
    maskHigh: node.maskHigh ?? 100,
    color: layerColorForNode(node),
    thumbnail: layerThumbnailForNode(node),
    childCount: node.children.length || undefined,
    note: `${node.kind} / ${width} x ${height}`,
  };
}

function layerPatchToNodePatch(patch: Partial<LayerControlLayer>): Partial<SNode> {
  const next: Partial<SNode> = {};
  if (patch.visible != null) next.visible = patch.visible;
  if (patch.locked != null) next.locked = patch.locked;
  if (patch.opacity != null) next.opacity = patch.opacity;
  if (patch.fill != null) next.fill = patch.fill;
  if (patch.blendMode != null) next.blendMode = patch.blendMode;
  if (patch.effects != null) next.effects = patch.effects;
  if (patch.mask != null) next.mask = patch.mask;
  if (patch.maskLow != null) next.maskLow = patch.maskLow;
  if (patch.maskHigh != null) next.maskHigh = patch.maskHigh;
  return next;
}

function spacingPresetIndex(node: SNode): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < SPACING_PRESETS.length; index += 1) {
    const preset = SPACING_PRESETS[index];
    const distance = Math.abs((node.padding || 0) - preset.padding) + Math.abs((node.gap || 0) - preset.gap);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

function codeLinesForSnippet(code: string): CodeLine[] {
  if (!code.trim()) return [];
  return code.split('\n').map((text, index) => ({
    id: `composer-code-line-${index + 1}`,
    snippetId: 'composer-selected',
    lineNumber: index + 1,
    text,
    language: 'tsx',
    highlighted: false,
    startsInBlockComment: false,
  }));
}

function buildPalette(): PaletteAtom[] {
  const primitives: PaletteAtom[] = [
    { id: 'Box', title: 'Box', group: 'Primitives', tags: ['panel'], kind: 'primitive' },
    { id: 'Text', title: 'Text', group: 'Primitives', tags: ['input'], kind: 'primitive' },
    { id: 'Pressable', title: 'Pressable', group: 'Primitives', tags: ['button'], kind: 'primitive' },
  ];
  const fromGallery = storySections.map((rawSection) => {
    const section = { ...rawSection, group: resolveGalleryGroup(rawSection) };
    const story = section.stories?.[0];
    const tags = story ? getCanonicalStoryTags(section, story).map(formatCanonicalTagLabel) : [];
    const shape = story ? isDataStory(story) || getDataStoryStorage(story).length > 0 : false;
    return {
      id: section.id,
      title: section.title,
      group: section.group?.title || 'Gallery',
      tags,
      kind: shape ? 'shape' : 'gallery',
      section,
    } satisfies PaletteAtom;
  });
  return [...primitives, ...fromGallery];
}

function addToSelectionTarget(doc: ComposerDoc, node: SNode): ComposerDoc {
  if (!doc.pages.length) {
    const page = defaultPage(0);
    page.children = [{ ...node, ...clampPatchToParent(node, page, node) }];
    return { ...doc, pages: [page], selection: [node.id] };
  }
  const selectedId = doc.selection[0] || null;
  const selected = selectedId ? findNode(doc.pages, selectedId) : null;
  const parent = selectedId ? findParent(doc.pages, selectedId) : null;
  const targetParent = selected?.kind === 'Page' || selected?.kind === 'Box' || selected?.kind === 'GalleryAtom'
    ? selected.id
    : parent?.id || doc.pages[0]?.id || null;
  const target = targetParent ? findNode(doc.pages, targetParent) : null;
  const nextNode = { ...node, ...clampPatchToParent(node, target, node) };
  return { ...doc, pages: insertNode(doc.pages, targetParent, nextNode), selection: [node.id] };
}

function groupSelection(doc: ComposerDoc): ComposerDoc {
  const ids = doc.selection;
  if (!ids.length) return doc;
  const parent = findParent(doc.pages, ids[0]);
  if (!parent || ids.some((id) => findParent(doc.pages, id)?.id !== parent.id)) return doc;
  const selected = parent.children.filter((child) => ids.includes(child.id));
  if (!selected.length) return doc;
  const selectedIds = new Set(ids);
  const group: SNode = {
    id: nextId('group'),
    kind: 'Box',
    name: 'Group',
    bg: '#f3f4f6',
    padding: 10,
    gap: 8,
    flexDirection: parent.flexDirection || 'column',
    children: selected,
  };
  const nextChildren: SNode[] = [];
  let inserted = false;
  for (const child of parent.children) {
    if (selectedIds.has(child.id)) {
      if (!inserted) {
        nextChildren.push(group);
        inserted = true;
      }
    } else {
      nextChildren.push(child);
    }
  }
  return { ...doc, pages: patchNode(doc.pages, parent.id, { children: nextChildren }), selection: [group.id] };
}

function ungroupSelection(doc: ComposerDoc): ComposerDoc {
  const id = doc.selection[0];
  if (!id) return doc;
  const group = findNode(doc.pages, id);
  const parent = findParent(doc.pages, id);
  if (!group || !parent || group.children.length === 0) return doc;
  const nextChildren = parent.children.flatMap((child) => child.id === id ? group.children : [child]);
  return {
    ...doc,
    pages: patchNode(doc.pages, parent.id, { children: nextChildren }),
    selection: group.children.map((child) => child.id),
  };
}

function styleFor(node: SNode): any {
  return {
    width: node.kind === 'Page' ? '100%' : node.width,
    height: node.kind === 'Page' ? '100%' : node.height,
    minWidth: 0,
    minHeight: 0,
    flexDirection: node.flexDirection || 'column',
    gap: node.gap,
    padding: node.padding,
    alignItems: node.alignH,
    justifyContent: node.alignV,
    backgroundColor: node.bg,
    opacity: node.visible === false ? 0.18 : (node.opacity ?? 100) / 100,
    overflow: 'hidden',
  };
}

function selectionFrame(active: boolean, fallbackColor = 'transparent') {
  return {
    borderWidth: active ? 2 : 0,
    borderColor: active ? 'theme:accentHot' : fallbackColor,
  };
}

function renderNode(node: SNode, selected: Set<string>, onSelect: (id: string) => void): any {
  const active = selected.has(node.id);
  const outline = selectionFrame(active);
  if (node.kind === 'Page') {
    return (
      <Box key={node.id} style={{ ...styleFor(node), ...selectionFrame(active, '#d1d5db') }}>
        {node.children.map((child) => renderNode(child, selected, onSelect))}
        <Box style={{ flexGrow: 1, minHeight: 0 }} />
      </Box>
    );
  }
  if (node.kind === 'Text') {
    return (
      <Pressable key={node.id} onPress={() => onSelect(node.id)}>
        <Box style={{ padding: active ? 3 : 0, ...outline }}>
          <Text style={{ color: node.color || '#111827', fontSize: 14 }}>{node.text || 'Text'}</Text>
        </Box>
      </Pressable>
    );
  }
  if (node.kind === 'Pressable') {
    return (
      <Pressable key={node.id} onPress={() => onSelect(node.id)} style={{ ...styleFor(node), ...outline }}>
        <Text style={{ color: node.color || 'theme:bg', fontSize: 12, fontWeight: 700 }}>{node.text || 'Action'}</Text>
      </Pressable>
    );
  }
  if (node.kind === 'GalleryAtom') {
    const body = (
      <>
        <Pressable onPress={() => onSelect(node.id)}>
          <Box style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ color: '#6b7280', fontSize: 9, fontFamily: 'monospace' }}>{node.shapeId ? 'SHAPE' : 'ATOM'}</Text>
            <Text style={{ color: '#2563eb', fontSize: 9, fontFamily: 'monospace' }}>{node.galleryId}</Text>
          </Box>
        </Pressable>
        {node.children.length ? node.children.map((child) => renderNode(child, selected, onSelect)) : (
          <Text style={{ color: '#111827', fontSize: 14, fontWeight: 700 }}>{node.name || node.galleryId}</Text>
        )}
      </>
    );
    if (node.children.length) {
      return <Box key={node.id} style={{ ...styleFor(node), ...outline }}>{body}</Box>;
    }
    return (
      <Pressable key={node.id} onPress={() => onSelect(node.id)} style={{ ...styleFor(node), ...outline }}>
        {body}
      </Pressable>
    );
  }
  if (node.children.length) {
    return (
      <Box key={node.id} style={{ ...styleFor(node), ...outline }}>
        {node.children.map((child) => renderNode(child, selected, onSelect))}
      </Box>
    );
  }
  return (
    <Pressable key={node.id} onPress={() => onSelect(node.id)} style={{ ...styleFor(node), ...outline }}>
    </Pressable>
  );
}

class ComposerBoundary extends Component<{ children: any }, { error: string | null }> {
  constructor(props: { children: any }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { error: error?.message || String(error) };
  }

  render() {
    if (this.state.error) {
      return (
        <S.Page>
          <Box style={{ width: '100%', height: '100%', padding: 24, gap: 10, backgroundColor: 'theme:bg' }}>
            <S.Heading>Composer failed to render</S.Heading>
            <S.BodyDim>{this.state.error}</S.BodyDim>
          </Box>
        </S.Page>
      );
    }
    return this.props.children;
  }
}

function emitNode(node: SNode, depth = 0): string {
  const ind = '  '.repeat(depth);
  if (node.kind === 'Page') {
    return node.children.map((child) => emitNode(child, depth)).join('\n');
  }
  const tag = node.kind === 'GalleryAtom' ? 'Box' : node.kind;
  const props: string[] = [];
  if (node.galleryId) props.push(`data-gallery="${node.galleryId}"`);
  if (node.shapeId) props.push(`data-shape="${node.shapeId}"`);
  const style: string[] = [];
  if (node.width != null) style.push(`width: ${node.width}`);
  if (node.height != null) style.push(`height: ${node.height}`);
  if (node.padding != null) style.push(`padding: ${node.padding}`);
  if (node.gap != null) style.push(`gap: ${node.gap}`);
  if (node.bg) style.push(`backgroundColor: '${node.bg}'`);
  if (node.flexDirection) style.push(`flexDirection: '${node.flexDirection}'`);
  if (style.length) props.push(`style={{ ${style.join(', ')} }}`);
  if ((node.kind === 'Text' || node.kind === 'Pressable') && node.color) props.push(`color="${node.color}"`);
  const attrs = props.length ? ` ${props.join(' ')}` : '';
  if (node.kind === 'Text' || node.kind === 'Pressable') return `${ind}<${tag}${attrs}>${node.text || ''}</${tag}>`;
  if (!node.children.length) return `${ind}<${tag}${attrs} />`;
  return `${ind}<${tag}${attrs}>\n${node.children.map((child) => emitNode(child, depth + 1)).join('\n')}\n${ind}</${tag}>`;
}

function emitDoc(doc: ComposerDoc): string {
  return doc.pages.map((page) => `// ${page.name || 'Page'}\n${emitNode(page)}`).join('\n\n');
}

function ActionBarButton({ icon, label, active = false, onPress }: {
  icon: number[][];
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Box style={{ width: 34, alignItems: 'center', gap: 3 }}>
      <LayerToolButton icon={icon} active={active} onPress={onPress} />
      <Text style={{ fontSize: 7, color: active ? 'theme:accentHot' : 'theme:inkDim', fontFamily: 'monospace' }}>
        {label}
      </Text>
    </Box>
  );
}

function ActionBarDivider() {
  return <Box style={{ width: 1, height: 28, backgroundColor: 'theme:ruleBright', marginLeft: 2, marginRight: 2 }} />;
}

function RailTab({ label, active = false, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Box
        style={{
          width: 44,
          height: 38,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: active ? 'theme:accentHot' : 'theme:rule',
          backgroundColor: active ? 'theme:bg2' : 'theme:bg1',
        }}
      >
        <Text style={{ fontSize: 8, color: active ? 'theme:accentHot' : 'theme:inkDim', fontFamily: 'monospace' }}>{label}</Text>
      </Box>
    </Pressable>
  );
}

function FieldInput({ value, onChange, placeholder, compact = false, onFocus, onBlur }: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  compact?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  return (
    <TextInput
      value={value}
      onChange={onChange}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={placeholder}
      style={{
        width: compact ? 132 : '100%',
        minWidth: compact ? 104 : 0,
        flexGrow: compact ? 1 : 0,
        height: 30,
        paddingLeft: 8,
        paddingRight: 8,
        color: 'theme:ink',
        backgroundColor: 'theme:bg2',
        borderWidth: 1,
        borderColor: 'theme:rule',
      }}
    />
  );
}

export default function ComposerPage() {
  return (
    <ComposerBoundary>
      <ComposerPageInner />
    </ComposerBoundary>
  );
}

function ComposerPageInner() {
  const [doc, setDoc] = useState<ComposerDoc>(() => loadDoc());
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('restored');
  const [tool, setTool] = useState<ComposerTool>('select');
  const [atomMenuOpen, setAtomMenuOpen] = useState(true);
  const [paletteTab, setPaletteTab] = useState<PaletteTab>('all');
  const [inputFocused, setInputFocused] = useState(false);
  const clipboardRef = useRef<SNode[]>([]);
  const saveTimer = useRef<any>(null);
  const palette = useMemo(buildPalette, []);
  const docSelection = Array.isArray(doc.selection) ? doc.selection : [];
  const docPages = Array.isArray(doc.pages) ? doc.pages : [];
  const selected = docSelection[0] ? findNode(docPages, docSelection[0]) : null;
  const activePage = findOwningPage(docPages, selected?.id || null);
  const layerRoots = docPages;
  const selectedSet = new Set(docSelection);
  const filteredPalette = palette.filter((atom) => {
    const inTab = paletteTab === 'all'
      || (paletteTab === 'primitives' && atom.kind === 'primitive')
      || (paletteTab === 'shapes' && atom.kind === 'shape')
      || (paletteTab === 'gallery' && atom.kind === 'gallery');
    if (!inTab) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return `${atom.title} ${atom.id} ${atom.group} ${atom.tags.join(' ')}`.toLowerCase().includes(q);
  }).slice(0, 90);

  useEffect(() => {
    setDoc((current) => normalizeDoc(current));
  }, []);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveDoc(doc);
      setStatus('saved');
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [doc]);

  const updateDoc = (fn: (current: ComposerDoc) => ComposerDoc) => {
    setStatus('editing');
    setDoc((current) => normalizeDoc(fn({ ...current, updatedAt: Date.now() })));
  };
  const patchSelected = (patch: Partial<SNode>) => updateDoc((current) => {
    const id = current.selection[0];
    if (!id) return current;
    const node = findNode(current.pages, id);
    if (!node) return current;
    const parent = findParent(current.pages, id);
    return { ...current, pages: patchNode(current.pages, id, clampPatchToParent(node, parent, patch)) };
  });
  const patchSelectedNumber = (key: keyof SNode, value: string) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) patchSelected({ [key]: parsed } as Partial<SNode>);
  };
  const alignSelected = (alignH: Align, alignV: Align) => patchSelected({ alignH, alignV });
  const addAtom = (atom: PaletteAtom) => updateDoc((current) => {
    if (atom.kind === 'primitive') return addToSelectionTarget(current, primitiveNode(atom.id as 'Box' | 'Text' | 'Pressable'));
    return addToSelectionTarget(current, galleryNode(atom));
  });
  const addPage = (preset = PAGE_PRESETS[1]) => updateDoc((current) => {
    const page = defaultPage(current.pages.length);
    const position = nextPagePosition(current.pages);
    page.width = preset.width;
    page.height = preset.height;
    page.x = position.x;
    page.y = position.y;
    return { ...current, pages: [...current.pages, page], selection: [page.id] };
  });
  const duplicate = () => updateDoc((current) => {
    const source = current.selection[0] ? findNode(current.pages, current.selection[0]) : null;
    const parent = current.selection[0] ? findParent(current.pages, current.selection[0]) : null;
    if (!source) return current;
    const copy = cloneNode(source);
    if (copy.kind === 'Page') {
      copy.x = (copy.x || 0) + 36;
      copy.y = (copy.y || 0) + 36;
      return { ...current, pages: [...current.pages, copy], selection: [copy.id] };
    }
    return { ...current, pages: insertNode(current.pages, parent?.id || current.pages[0]?.id || null, copy), selection: [copy.id] };
  });
  const copy = () => {
    const nodes = docSelection
      .map((id) => findNode(docPages, id))
      .filter(Boolean) as SNode[];
    clipboardRef.current = nodes.map(cloneNode);
    writeClipboardNodes(clipboardRef.current);
    setStatus(nodes.length ? 'copied' : 'nothing to copy');
  };
  const paste = () => updateDoc((current) => {
    const source = clipboardRef.current.length ? clipboardRef.current : readClipboardNodes();
    if (!source.length) return current;
    const copies = source.map(cloneNode);
    const selectedId = current.selection[0] || null;
    const selectedNode = selectedId ? findNode(current.pages, selectedId) : null;
    const parent = selectedId ? findParent(current.pages, selectedId) : null;
    const targetParent = selectedNode?.kind === 'Page' || selectedNode?.kind === 'Box' || selectedNode?.kind === 'GalleryAtom'
      ? selectedNode.id
      : parent?.id || current.pages[0]?.id || null;
    let pages = current.pages;
    for (const node of copies) {
      if (node.kind === 'Page') {
        node.x = (node.x || 0) + 36;
        node.y = (node.y || 0) + 36;
        pages = [...pages, node];
      } else {
        pages = insertNode(pages, targetParent, node);
      }
    }
    return { ...current, pages, selection: copies[0] ? [copies[0].id] : [] };
  });
  const remove = () => updateDoc((current) => {
    if (!current.selection.length) return current;
    return { ...current, pages: removeNodes(current.pages, new Set(current.selection)), selection: [] };
  });
  const moveLayer = (id: string, delta: -1 | 1) => updateDoc((current) => ({
    ...current,
    pages: moveNodeInList(current.pages, id, delta),
    selection: [id],
  }));
  const indentLayer = (id: string) => updateDoc((current) => {
    if (findNode(current.pages, id)?.kind === 'Page') return current;
    return { ...current, pages: indentNode(current.pages, id), selection: [id] };
  });
  const outdentLayer = (id: string) => updateDoc((current) => {
    if (findNode(current.pages, id)?.kind === 'Page') return current;
    const parent = findParent(current.pages, id);
    if (!parent || parent.kind === 'Page') return current;
    return { ...current, pages: outdentNode(current.pages, id), selection: [id] };
  });
  const removeLayer = (id: string) => updateDoc((current) => {
    return { ...current, pages: removeNodes(current.pages, new Set([id])), selection: current.selection[0] === id ? [] : current.selection };
  });
  const patchLayer = (id: string, patch: Partial<LayerControlLayer>) => updateDoc((current) => ({
    ...current,
    pages: patchNode(current.pages, id, layerPatchToNodePatch(patch)),
  }));
  const toggleLayerVisible = (id: string) => updateDoc((current) => {
    const node = findNode(current.pages, id);
    if (!node) return current;
    return { ...current, pages: patchNode(current.pages, id, { visible: node.visible === false }) };
  });
  const toggleLayerLock = (id: string) => updateDoc((current) => {
    const node = findNode(current.pages, id);
    if (!node) return current;
    return { ...current, pages: patchNode(current.pages, id, { locked: !node.locked }) };
  });
  const selectLayer = (id: string) => updateDoc((current) => ({
    ...current,
    selection: [id],
  }));
  const clearSelection = () => updateDoc((current) => ({ ...current, selection: [] }));
  const focusInput = () => setInputFocused(true);
  const blurInput = () => setInputFocused(false);
  const selectScopedLayers = () => updateDoc((current) => {
    const activeId = current.selection[0] || null;
    const page = findOwningPage(current.pages, activeId) || current.pages[0] || null;
    if (!page) return current;
    const ids = page.children.length ? flattenIds(page.children) : [page.id];
    return { ...current, selection: ids };
  });
  const moveSelectedLayer = (delta: -1 | 1) => updateDoc((current) => {
    const id = current.selection[0];
    if (!id) return current;
    return { ...current, pages: moveNodeInList(current.pages, id, delta), selection: [id] };
  });
  const indentSelectedLayer = () => updateDoc((current) => {
    const id = current.selection[0];
    if (!id || findNode(current.pages, id)?.kind === 'Page') return current;
    return { ...current, pages: indentNode(current.pages, id), selection: [id] };
  });
  const outdentSelectedLayer = () => updateDoc((current) => {
    const id = current.selection[0];
    if (!id || findNode(current.pages, id)?.kind === 'Page') return current;
    const parent = findParent(current.pages, id);
    if (!parent || parent.kind === 'Page') return current;
    return { ...current, pages: outdentNode(current.pages, id), selection: [id] };
  });

  const runShortcut = (fn: () => void) => {
    if (inputFocused) return;
    fn();
  };
  useIFTTT('key:ctrl+a', () => runShortcut(selectScopedLayers));
  useIFTTT('key:meta+a', () => runShortcut(selectScopedLayers));
  useIFTTT('key:delete', () => runShortcut(remove));
  useIFTTT('key:backspace', () => runShortcut(remove));
  useIFTTT('key:escape', () => runShortcut(clearSelection));
  useIFTTT('key:ctrl+c', () => runShortcut(copy));
  useIFTTT('key:meta+c', () => runShortcut(copy));
  useIFTTT('key:ctrl+v', () => runShortcut(paste));
  useIFTTT('key:meta+v', () => runShortcut(paste));
  useIFTTT('key:ctrl+d', () => runShortcut(duplicate));
  useIFTTT('key:meta+d', () => runShortcut(duplicate));
  useIFTTT('key:ctrl+g', () => runShortcut(() => updateDoc(groupSelection)));
  useIFTTT('key:meta+g', () => runShortcut(() => updateDoc(groupSelection)));
  useIFTTT('key:ctrl+shift+g', () => runShortcut(() => updateDoc(ungroupSelection)));
  useIFTTT('key:meta+shift+g', () => runShortcut(() => updateDoc(ungroupSelection)));
  useIFTTT('key:alt+up', () => runShortcut(() => moveSelectedLayer(-1)));
  useIFTTT('key:alt+down', () => runShortcut(() => moveSelectedLayer(1)));
  useIFTTT('key:alt+left', () => runShortcut(outdentSelectedLayer));
  useIFTTT('key:alt+right', () => runShortcut(indentSelectedLayer));

  const codeRoot = selected;
  const selectedCode = codeRoot ? emitNode(codeRoot) : '';
  const selectedCodeLines = codeLinesForSnippet(selectedCode);
  const selectedLayer = selected ? nodeToLayer(selected) : null;

  return (
    <S.Page>
      <Box style={{ width: '100%', height: '100%', flexDirection: 'column', backgroundColor: 'theme:bg' }}>
        <Box style={{ flexGrow: 1, minHeight: 0, flexDirection: 'row' }}>
          <Box style={{ width: atomMenuOpen ? 316 : 56, flexShrink: 0, flexDirection: 'row', borderRightWidth: 1, borderColor: 'theme:rule', backgroundColor: 'theme:bg1' }}>
            <Box style={{ width: 56, height: '100%', flexShrink: 0, paddingTop: 8, paddingLeft: 6, paddingRight: 6, gap: 6, borderRightWidth: atomMenuOpen ? 1 : 0, borderColor: 'theme:rule', backgroundColor: 'theme:bg' }}>
              <RailTab label="ALL" active={atomMenuOpen && paletteTab === 'all'} onPress={() => { setPaletteTab('all'); setAtomMenuOpen(true); }} />
              <RailTab label="PRIM" active={atomMenuOpen && paletteTab === 'primitives'} onPress={() => { setPaletteTab('primitives'); setAtomMenuOpen(true); }} />
              <RailTab label="SHAPE" active={atomMenuOpen && paletteTab === 'shapes'} onPress={() => { setPaletteTab('shapes'); setAtomMenuOpen(true); }} />
              <RailTab label="UI" active={atomMenuOpen && paletteTab === 'gallery'} onPress={() => { setPaletteTab('gallery'); setAtomMenuOpen(true); }} />
              <RailTab label={atomMenuOpen ? 'HIDE' : 'OPEN'} onPress={() => setAtomMenuOpen((open) => !open)} />
            </Box>
            {atomMenuOpen ? (
              <Box style={{ width: 260, height: '100%', flexShrink: 0 }}>
                <Box style={{ height: 42, paddingLeft: 10, paddingRight: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: 'theme:rule' }}>
                  <S.GitTextHot>{paletteTab === 'all' ? 'ATOM LIBRARY' : paletteTab.toUpperCase()}</S.GitTextHot>
                  <Pressable onPress={() => setAtomMenuOpen(false)}>
                    <S.MicroDim>CLOSE</S.MicroDim>
                  </Pressable>
                </Box>
                <Box style={{ padding: 10, gap: 8 }}>
                  <TextInput
                    value={query}
                    onChange={setQuery}
                    onFocus={focusInput}
                    onBlur={blurInput}
                    placeholder="filter atoms and gallery"
                    style={{ height: 30, paddingLeft: 8, paddingRight: 8, color: 'theme:ink', backgroundColor: 'theme:bg2', borderWidth: 1, borderColor: 'theme:rule' }}
                  />
                </Box>
                <ScrollView style={{ flexGrow: 1, minHeight: 0 }}>
                  <Box style={{ padding: 10, gap: 6 }}>
                    {filteredPalette.map((atom) => (
                      <Pressable key={atom.id} onPress={() => addAtom(atom)}>
                        <Box style={{ padding: 8, gap: 4, backgroundColor: 'theme:bg2', borderWidth: 1, borderColor: atom.kind === 'shape' ? 'theme:accent' : 'theme:rule' }}>
                          <S.Body>{atom.title}</S.Body>
                          <S.MicroDim>{atom.group} / {atom.kind}</S.MicroDim>
                        </Box>
                      </Pressable>
                    ))}
                  </Box>
                </ScrollView>
              </Box>
            ) : null}
          </Box>

          <Box style={{ flexGrow: 1, minWidth: 0, minHeight: 0, backgroundColor: 'theme:bg' }}>
            <Canvas
              style={{ width: '100%', height: '100%', backgroundColor: 'theme:bg' }}
              gridStep={16}
              gridStroke={1}
              gridColor="theme:gridDot"
              gridMajorColor="theme:gridDotStrong"
              gridMajorEvery={4}
            >
              <Canvas.Clamp>
                <Box
                  style={{
                    width: '100%',
                    height: '100%',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    paddingBottom: 14,
                  }}
                >
                  <Box
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingLeft: 8,
                      paddingRight: 8,
                      paddingTop: 7,
                      paddingBottom: 7,
                      backgroundColor: 'theme:bg2',
                      borderWidth: 1,
                      borderColor: 'theme:ruleBright',
                    }}
                  >
                    <ActionBarButton icon={MousePointer} label="SEL" active={tool === 'select'} onPress={() => setTool('select')} />
                    <ActionBarButton icon={Hand} label="PAN" active={tool === 'move'} onPress={() => setTool('move')} />
                    <ActionBarButton icon={PenLine} label="DRAW" active={tool === 'draw'} onPress={() => setTool('draw')} />
                    <ActionBarDivider />
                    <ActionBarButton icon={Square} label="BOX" onPress={() => addAtom({ id: 'Box', title: 'Box', group: 'Primitives', tags: ['panel'], kind: 'primitive' })} />
                    <ActionBarButton icon={Type} label="TEXT" onPress={() => addAtom({ id: 'Text', title: 'Text', group: 'Primitives', tags: ['input'], kind: 'primitive' })} />
                    <ActionBarButton icon={MousePointerClick} label="BTN" onPress={() => addAtom({ id: 'Pressable', title: 'Pressable', group: 'Primitives', tags: ['button'], kind: 'primitive' })} />
                    <ActionBarDivider />
                    <ActionBarButton icon={Copy} label="COPY" onPress={copy} />
                    <ActionBarButton icon={ClipboardPaste} label="PASTE" onPress={paste} />
                    <ActionBarButton icon={BoxSelect} label="DUP" onPress={duplicate} />
                    <ActionBarButton icon={Trash2} label="DEL" onPress={remove} />
                    <ActionBarDivider />
                    <ActionBarButton icon={Group} label="GRP" onPress={() => updateDoc(groupSelection)} />
                    <ActionBarButton icon={Ungroup} label="UNGRP" onPress={() => updateDoc(ungroupSelection)} />
                    <ActionBarDivider />
                    <ActionBarButton icon={MonitorCheck} label="PAGE" onPress={() => addPage(PAGE_PRESETS[1])} />
                  </Box>
                </Box>
              </Canvas.Clamp>
              {doc.pages.map((page) => (
                <Canvas.Node
                  key={page.id}
                  gx={page.x || 0}
                  gy={page.y || 0}
                  gw={page.width || 320}
                  gh={page.height || 220}
                  onMove={(evt: any) => updateDoc((current) => ({
                    ...current,
                    pages: patchNode(current.pages, page.id, { x: Number(evt?.gx ?? page.x ?? 0), y: Number(evt?.gy ?? page.y ?? 0) }),
                    selection: [page.id],
                  }))}
                >
                  <Box style={{ width: '100%', height: '100%', gap: 4 }}>
                    <Pressable onPress={() => updateDoc((current) => ({ ...current, selection: [page.id] }))}>
                      <Box style={{ height: 22, paddingLeft: 8, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'theme:bg1', borderWidth: selectedSet.has(page.id) ? 2 : 1, borderColor: selectedSet.has(page.id) ? 'theme:accentHot' : 'theme:rule' }}>
                        <S.MicroDim>{page.name}</S.MicroDim>
                        <S.MicroDim>{page.width}x{page.height}</S.MicroDim>
                      </Box>
                    </Pressable>
                    {renderNode(page, selectedSet, (id) => updateDoc((current) => ({ ...current, selection: [id] })))}
                  </Box>
                </Canvas.Node>
              ))}
            </Canvas>
          </Box>

          <Box style={{ width: 344, flexShrink: 0, borderLeftWidth: 1, borderColor: 'theme:rule', backgroundColor: 'theme:bg1' }}>
            <Box style={{ width: '100%', height: '100%', padding: 12, gap: 10 }}>
                <S.Section>
                  <S.SectionLabel><S.Label>INSPECTOR</S.Label></S.SectionLabel>
                  <S.Card style={{ height: 72 }}>
                    <S.Heading>{selected?.name || selected?.kind || 'None'}</S.Heading>
                    <S.BodyDim>{selected ? selected.id : 'Select one layer or canvas node.'}</S.BodyDim>
                  </S.Card>
                </S.Section>

                <S.Section style={{ flexGrow: 1, minHeight: 0 }}>
                  <S.SectionLabel><S.Label>PROPERTIES</S.Label></S.SectionLabel>
                  <ScrollView style={{ flexGrow: 1, minHeight: 0 }}>
                  <Box style={{ gap: 8, paddingRight: 2 }}>
                    {selected ? (
                      <>
                      <FieldInput onFocus={focusInput} onBlur={blurInput} value={selected.name || selected.text || ''} onChange={(value) => patchSelected(selected.kind === 'Text' || selected.kind === 'Pressable' ? { text: value } : { name: value })} placeholder="name" />
                      {(selected.kind === 'Text' || selected.kind === 'Pressable') ? (
                        <FieldInput onFocus={focusInput} onBlur={blurInput} value={selected.text || ''} onChange={(value) => patchSelected({ text: value })} placeholder="text" />
                      ) : null}
                      <PropertyLabel label="Size" value={`${selected.width || '-'} x ${selected.height || '-'}`} />
                      <S.InlineX3>
                        <FieldInput onFocus={focusInput} onBlur={blurInput} compact value={String(selected.width || '')} onChange={(value) => patchSelectedNumber('width', value)} placeholder="width" />
                        <FieldInput onFocus={focusInput} onBlur={blurInput} compact value={String(selected.height || '')} onChange={(value) => patchSelectedNumber('height', value)} placeholder="height" />
                      </S.InlineX3>
                      {selected.kind === 'Page' ? (
                        <>
                          <PropertyLabel label="Canvas position" value={`${selected.x || 0}, ${selected.y || 0}`} />
                          <S.InlineX3>
                            <FieldInput onFocus={focusInput} onBlur={blurInput} compact value={String(selected.x || 0)} onChange={(value) => patchSelectedNumber('x', value)} placeholder="x" />
                            <FieldInput onFocus={focusInput} onBlur={blurInput} compact value={String(selected.y || 0)} onChange={(value) => patchSelectedNumber('y', value)} placeholder="y" />
                          </S.InlineX3>
                          <Box style={{ flexDirection: 'row', gap: 4 }}>
                            {PAGE_SIZES.map((preset) => (
                              <MiniPresetButton key={preset.label} label={preset.label} active={selected.width === preset.width && selected.height === preset.height} onPress={() => patchSelected({ width: preset.width, height: preset.height })} />
                            ))}
                          </Box>
                        </>
                      ) : null}
                      <PropertyLabel label="Spacing" value={`pad ${selected.padding || 0} / gap ${selected.gap || 0}`} />
                      <S.InlineX3>
                        <FieldInput onFocus={focusInput} onBlur={blurInput} compact value={String(selected.padding || '')} onChange={(value) => patchSelectedNumber('padding', value)} placeholder="padding" />
                        <FieldInput onFocus={focusInput} onBlur={blurInput} compact value={String(selected.gap || '')} onChange={(value) => patchSelectedNumber('gap', value)} placeholder="gap" />
                      </S.InlineX3>
                      <PropertyLabel label="Spacing preset" value={SPACING_PRESETS[spacingPresetIndex(selected)]?.label || 'BASE'} />
                      <StepSlider
                        labels={SPACING_PRESETS.map((preset) => preset.label)}
                        active={spacingPresetIndex(selected)}
                        onChange={(index) => {
                          const preset = SPACING_PRESETS[index] || SPACING_PRESETS[2];
                          patchSelected({ padding: preset.padding, gap: preset.gap });
                        }}
                      />
                      <PropertyLabel label="Background" value={selected.bg || 'none'} />
                      <ColorSwatchRow colors={SURFACE_COLORS} value={selected.bg || ''} onPick={(color) => patchSelected({ bg: color })} />
                      <FieldInput onFocus={focusInput} onBlur={blurInput} value={selected.bg || ''} onChange={(value) => patchSelected({ bg: value })} placeholder="#ffffff" />
                      <PropertyLabel label="Text color" value={selected.color || 'default'} />
                      <ColorSwatchRow colors={ACCENT_COLORS} value={selected.color || ''} onPick={(color) => patchSelected({ color })} />
                      <FieldInput onFocus={focusInput} onBlur={blurInput} value={selected.color || ''} onChange={(value) => patchSelected({ color: value })} placeholder="#111827" />
                      <PropertyLabel label="Layout flow" value={selected.flexDirection || 'column'} />
                      <S.InlineX3>
                        <S.ButtonOutline onPress={() => patchSelected({ flexDirection: 'row' })}><S.ButtonOutlineLabel>Row</S.ButtonOutlineLabel></S.ButtonOutline>
                        <S.ButtonOutline onPress={() => patchSelected({ flexDirection: 'column' })}><S.ButtonOutlineLabel>Column</S.ButtonOutlineLabel></S.ButtonOutline>
                      </S.InlineX3>
                      <Box style={{ gap: 4 }}>
                        <S.MicroDim>Align</S.MicroDim>
                        <Box style={{ flexDirection: 'row', gap: 4 }}>
                          <AlignButton active={selected.alignH === 'flex-start' && selected.alignV === 'flex-start'} label="TL" onPress={() => alignSelected('flex-start', 'flex-start')} />
                          <AlignButton active={selected.alignH === 'center' && selected.alignV === 'flex-start'} label="TC" onPress={() => alignSelected('center', 'flex-start')} />
                          <AlignButton active={selected.alignH === 'flex-end' && selected.alignV === 'flex-start'} label="TR" onPress={() => alignSelected('flex-end', 'flex-start')} />
                        </Box>
                        <Box style={{ flexDirection: 'row', gap: 4 }}>
                          <AlignButton active={selected.alignH === 'flex-start' && selected.alignV === 'center'} label="ML" onPress={() => alignSelected('flex-start', 'center')} />
                          <AlignButton active={selected.alignH === 'center' && selected.alignV === 'center'} label="MC" onPress={() => alignSelected('center', 'center')} />
                          <AlignButton active={selected.alignH === 'flex-end' && selected.alignV === 'center'} label="MR" onPress={() => alignSelected('flex-end', 'center')} />
                        </Box>
                        <Box style={{ flexDirection: 'row', gap: 4 }}>
                          <AlignButton active={selected.alignH === 'flex-start' && selected.alignV === 'flex-end'} label="BL" onPress={() => alignSelected('flex-start', 'flex-end')} />
                          <AlignButton active={selected.alignH === 'center' && selected.alignV === 'flex-end'} label="BC" onPress={() => alignSelected('center', 'flex-end')} />
                          <AlignButton active={selected.alignH === 'flex-end' && selected.alignV === 'flex-end'} label="BR" onPress={() => alignSelected('flex-end', 'flex-end')} />
                        </Box>
                      </Box>
                      {selectedLayer ? (
                        <>
                          <PropertyLabel label="Layer controls" value={`${selectedLayer.blendMode} / ${selectedLayer.opacity}%`} />
                          <Box style={{ height: 300, borderWidth: 1, borderColor: 'theme:rule', overflow: 'hidden' }}>
                            <LayerPropertiesPanel
                              layer={selectedLayer}
                              canvas={activePage ? `${activePage.width || '-'} x ${activePage.height || '-'}` : 'canvas'}
                              blendModes={layerBlendModes}
                              onLayerChange={(patch) => patchLayer(selected.id, patch)}
                            />
                          </Box>
                        </>
                      ) : null}
                      </>
                    ) : (
                      <Box style={{ height: 30, justifyContent: 'center' }}>
                        <S.BodyDim>No editable layer selected.</S.BodyDim>
                      </Box>
                    )}
                  </Box>
                  </ScrollView>
                </S.Section>

                <S.Section style={{ height: 318, flexShrink: 0 }}>
                  <S.SectionLabel><S.Label>LAYERS</S.Label></S.SectionLabel>
                  <Box style={{ height: 28, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <S.MicroDim>{doc.pages.length} pages</S.MicroDim>
                    <S.MicroDim>{activePage ? `in ${activePage.name || 'Page'}` : 'all'}</S.MicroDim>
                    <S.MicroDim>{docSelection.length} selected</S.MicroDim>
                  </Box>
                  <ScrollView style={{ flexGrow: 1, minHeight: 220 }}>
                    <Box style={{ gap: 2 }}>
                      {!doc.pages.length ? (
                        <Box style={{ height: 34, justifyContent: 'center' }}>
                          <S.BodyDim>No layers.</S.BodyDim>
                        </Box>
                      ) : null}
                      {layerRoots.map((page) => (
                        <LayerTree
                          key={page.id}
                          node={page}
                          depth={0}
                          selected={selectedSet}
                          onSelect={selectLayer}
                          onMove={moveLayer}
                          onIndent={indentLayer}
                          onOutdent={outdentLayer}
                          onRemove={removeLayer}
                          onToggleVisible={toggleLayerVisible}
                          onToggleLock={toggleLayerLock}
                        />
                      ))}
                    </Box>
                  </ScrollView>
                </S.Section>
            </Box>
          </Box>
        </Box>

        <Box style={{ height: 132, flexShrink: 0, borderTopWidth: 1, borderColor: 'theme:rule', backgroundColor: 'theme:bg1' }}>
          <ScrollView style={{ width: '100%', height: '100%' }}>
            <Box style={{ padding: 12, gap: 2 }}>
              {selectedCodeLines.length ? selectedCodeLines.map((line) => (
                <Box key={line.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <Text style={{ width: 28, flexShrink: 0, fontSize: 9, color: 'theme:inkDimmer', fontFamily: 'monospace' }}>{line.lineNumber}</Text>
                  <SyntaxHighlighter row={line} />
                </Box>
              )) : (
                <Text style={{ fontSize: 10, color: 'theme:inkDim', fontFamily: 'monospace' }}>Select a layer to inspect generated JSX.</Text>
              )}
            </Box>
          </ScrollView>
        </Box>
      </Box>
    </S.Page>
  );
}

function LayerTree({ node, depth, selected, onSelect, onMove, onIndent, onOutdent, onRemove, onToggleVisible, onToggleLock }: {
  node: SNode;
  depth: number;
  selected: Set<string>;
  onSelect: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onIndent: (id: string) => void;
  onOutdent: (id: string) => void;
  onRemove: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
}) {
  const isPage = node.kind === 'Page';
  const active = selected.has(node.id);
  const layer = nodeToLayer(node);
  return (
    <Box style={{ gap: 3 }}>
      <Box style={{ paddingLeft: depth * 12 }}>
        <ComposerLayerRow
          node={node}
          layer={layer}
          active={active}
          onSelect={() => onSelect(node.id)}
          onToggleVisible={() => onToggleVisible(node.id)}
          onToggleLock={() => onToggleLock(node.id)}
        />
      </Box>
      {active ? (
        <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, paddingLeft: 6 + depth * 12, paddingRight: 4 }}>
          <LayerRowButton label="UP" onPress={() => onMove(node.id, -1)} />
          <LayerRowButton label="DN" onPress={() => onMove(node.id, 1)} />
          {!isPage ? <LayerRowButton label="OUT" onPress={() => onOutdent(node.id)} /> : null}
          {!isPage ? <LayerRowButton label="IN" onPress={() => onIndent(node.id)} /> : null}
          <LayerRowButton label="DEL" onPress={() => onRemove(node.id)} />
        </Box>
      ) : null}
      {node.children.map((child) => (
        <LayerTree
          key={child.id}
          node={child}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
          onMove={onMove}
          onIndent={onIndent}
          onOutdent={onOutdent}
          onRemove={onRemove}
          onToggleVisible={onToggleVisible}
          onToggleLock={onToggleLock}
        />
      ))}
    </Box>
  );
}

function ComposerLayerRow({ node, layer, active, onSelect, onToggleVisible, onToggleLock }: {
  node: SNode;
  layer: LayerControlLayer;
  active: boolean;
  onSelect: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
}) {
  const isPage = node.kind === 'Page';
  const kindLabel = layerKindLabelForNode(node);
  const sizeLabel = node.width != null && node.height != null ? `${node.width} x ${node.height}` : 'auto';
  return (
    <Box
      style={{
        minHeight: 58,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 7,
        paddingBottom: 7,
        borderLeftWidth: 3,
        borderBottomWidth: 1,
        borderColor: active ? 'theme:accentHot' : 'theme:rule',
        backgroundColor: active ? 'theme:bg2' : 'theme:bg',
      }}
    >
      <LayerVisibilityToggle active={layer.visible} onPress={onToggleVisible} />
      {isPage ? (
        <Box
          style={{
            width: 44,
            height: 34,
            flexShrink: 0,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: active ? 'theme:accentHot' : 'theme:ruleBright',
            backgroundColor: node.bg || '#ffffff',
          }}
        >
          <Text style={{ fontSize: 8, color: '#111827', fontFamily: 'monospace', fontWeight: 700 }}>PAGE</Text>
        </Box>
      ) : (
        <LayerThumbnail layer={layer} />
      )}
      <Pressable onPress={onSelect} style={{ flexGrow: 1, flexBasis: 0, minWidth: 0 }}>
        <Box style={{ gap: 5, minWidth: 0 }}>
          <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 }}>
            <S.Caption>{node.name || node.text || node.kind}</S.Caption>
            <Text style={{ fontSize: 8, color: 'theme:inkDim', fontFamily: 'monospace' }}>{sizeLabel}</Text>
          </Box>
          <StripBadge
            segments={[
              { label: kindLabel, tone: isPage ? 'ink' : 'neutral' },
              { label: layer.blendMode.toUpperCase(), tone: 'accent' },
              { label: `${layer.opacity}% OP`, tone: layer.opacity < 50 ? 'warn' : 'neutral' },
              ...(node.children.length ? [{ label: `${node.children.length} CHILD`, tone: 'blue' as const }] : []),
            ]}
          />
        </Box>
      </Pressable>
      <LayerLockToggle active={layer.locked} onPress={onToggleLock} />
    </Box>
  );
}

function LayerRowButton({ label, active = false, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Box style={{ width: 24, height: 18, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: active ? 'theme:accentHot' : 'theme:rule', backgroundColor: active ? 'theme:bg2' : 'theme:bg1' }}>
        <Text style={{ fontSize: 7, color: active ? 'theme:accentHot' : 'theme:inkDim', fontFamily: 'monospace' }}>{label}</Text>
      </Box>
    </Pressable>
  );
}

function AlignButton({ label, active = false, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Box style={{ width: 28, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: active ? 'theme:accentHot' : 'theme:rule', backgroundColor: active ? 'theme:bg2' : 'theme:bg1' }}>
        <Text style={{ fontSize: 8, color: active ? 'theme:accentHot' : 'theme:inkDim', fontFamily: 'monospace' }}>{label}</Text>
      </Box>
    </Pressable>
  );
}

function PropertyLabel({ label, value }: { label: string; value: string }) {
  return (
    <Box style={{ height: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <S.MicroDim>{label}</S.MicroDim>
      <Text style={{ fontSize: 8, color: 'theme:inkDim', fontFamily: 'monospace' }}>{value}</Text>
    </Box>
  );
}

function ColorSwatchRow({ colors, value, onPick }: { colors: string[]; value: string; onPick: (color: string) => void }) {
  return (
    <Box style={{ flexDirection: 'row', gap: 5 }}>
      {colors.map((color) => (
        <Pressable key={color} onPress={() => onPick(color)}>
          <Box
            style={{
              width: 22,
              height: 22,
              borderWidth: value === color ? 2 : 1,
              borderColor: value === color ? 'theme:accentHot' : 'theme:rule',
              backgroundColor: color,
            }}
          />
        </Pressable>
      ))}
    </Box>
  );
}

function MiniPresetButton({ label, active = false, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Box style={{ width: 48, height: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: active ? 'theme:accentHot' : 'theme:rule', backgroundColor: active ? 'theme:bg2' : 'theme:bg1' }}>
        <Text style={{ fontSize: 8, color: active ? 'theme:accentHot' : 'theme:inkDim', fontFamily: 'monospace' }}>{label}</Text>
      </Box>
    </Pressable>
  );
}
