// editors/workbench/materials/store.ts -- the MATERIAL WorkbenchSource truth
// (WBSTEP7-0606). It folds /textures + /compose into one headless state object:
// shader recipes, stored materials, decal composition, and the hero Materialize
// action all read/write through this boundary.

import type { ActionSpec, RosterRow } from '../../../shell/Workbench';
import type { FieldSpec, PanelSpec, PickOption } from '../../../shell/fields';
import type { LensSpec } from '../../../shell/stage';
import {
  DECAL_SIZE_PRESETS,
  emptyDecalDoc,
  validateDecalDoc,
  type DecalAlign,
  type DecalDoc,
  type DecalNode,
} from '../../../game/textures/decal';
import { defaultShaderData, paramDefaults, type ShaderParam, type ShaderSpec } from '../../../game/textures/shaders';
import { missionCodePresets } from '../../../game/missions/codes';
import type { MaterialsEvent } from '../../materials/stream';

export type MaterialLens = 'preview' | 'shader' | 'compose';

export type TextureSummary = {
  id: string;
  label: string;
  kind: 'react' | 'shader';
};

export type StoredMaterialSummary = {
  id: string;
  label: string;
  shaderId?: string;
  data?: number[];
  decal?: DecalDoc;
};

export type MaterialTwigAdapter = {
  read<T>(route: string, key: string, initial: T): T;
  write<T>(route: string, key: string, value: T): void;
};

export type MaterialSession = {
  commit(event: MaterialsEvent, label: string): void;
  note?(label: string): void;
};

export type MaterialWorkbenchDeps = {
  recipes(): ShaderSpec[];
  reactTextures(): TextureSummary[];
  stored(): StoredMaterialSummary[];
  saveShader(label: string, shaderId: string, data: number[]): StoredMaterialSummary;
  saveDecal(label: string, doc: DecalDoc, existingId?: string): StoredMaterialSummary | null;
  remove(id: string): void;
  pickImage?(): string | null | Promise<string | null>;
  session?: MaterialSession | null;
  twig?: boolean | MaterialTwigAdapter;
};

export type MaterialRow =
  | { kind: 'recipe'; id: string; label: string; spec: ShaderSpec }
  | { kind: 'react'; id: string; label: string; texture: TextureSummary }
  | { kind: 'stored'; id: string; label: string; material: StoredMaterialSummary }
  | { kind: 'decal'; id: 'new'; label: string; material?: undefined }
  | { kind: 'decal'; id: string; label: string; material: StoredMaterialSummary }
  | { kind: 'mission'; id: string; label: string; doc: DecalDoc; key: string };

export type MaterialSubject = {
  store: MaterialStore;
  row: MaterialRow;
};

type BankedMaterial = { name: string; shaderId: string; data: number[] };
export type ComposeResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const TEXTURE_ROUTE = '/textures';
const COMPOSE_ROUTE = '/compose';
const FONT_FAMILIES = ['default', 'sans-serif', 'serif', 'monospace', 'noto', 'arial', 'inter', 'roboto'];
const FONT_WEIGHTS = ['400', '600', '700', '800', '900'];
const ALIGN_OPTS: DecalAlign[] = ['left', 'center', 'right'];
const MIN_NODE_SIZE = 1;

function isEffectFillSpec(spec: ShaderSpec): boolean {
  return /^[a-j]-/.test(spec.id);
}

function snapParam(p: ShaderParam, v: number): number {
  const stepped = Math.round(v / p.step) * p.step;
  const clamped = Math.max(p.min, Math.min(p.max, stepped));
  return p.integer ? Math.round(clamped) : Math.round(clamped * 1000) / 1000;
}

function showParam(p: ShaderParam, v: number): string {
  const n = p.integer ? String(Math.round(v)) : v.toFixed(p.step < 0.05 ? 3 : 2);
  return p.unit ? `${n}${p.unit}` : n;
}

function cloneDoc(doc: DecalDoc): DecalDoc {
  return JSON.parse(JSON.stringify(doc)) as DecalDoc;
}

function mintNodeId(doc: DecalDoc, kind: DecalNode['kind']): string {
  let n = doc.nodes.length + 1;
  while (doc.nodes.some((node) => node.id === `${kind}-${n}`)) n += 1;
  return `${kind}-${n}`;
}

function labelForPreset(doc: DecalDoc): string {
  return DECAL_SIZE_PRESETS.find((p) => p.width === doc.width && p.height === doc.height)?.label ?? 'custom';
}

function parseWeight(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 400;
}

function cleanPickedPath(raw: string): string {
  let p = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (p.startsWith('file://')) p = decodeURIComponent(p.slice('file://'.length));
  return p;
}

function resizeNodePatch(node: DecalNode, handle: ComposeResizeHandle, dx: number, dy: number): Pick<DecalNode, 'x' | 'y' | 'w' | 'h'> {
  let x = node.x;
  let y = node.y;
  let w = node.w;
  let h = node.h;
  if (handle.includes('e')) w += dx;
  if (handle.includes('s')) h += dy;
  if (handle.includes('w')) {
    x += dx;
    w -= dx;
  }
  if (handle.includes('n')) {
    y += dy;
    h -= dy;
  }
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

export interface MaterialStore {
  subscribe(fn: () => void): () => void;
  listRows(): RosterRow[];
  defaultRow(rows: RosterRow[]): string | undefined;
  pick(rowId: string): void;
  select(rowId: string): MaterialSubject;
  panel(subject: MaterialSubject): PanelSpec;
  lenses(subject: MaterialSubject): LensSpec[];
  actions(subject: MaterialSubject): ActionSpec[];
  setLens(lens: MaterialLens): void;
  get lens(): MaterialLens;
  get activeRowId(): string | null;
  get composeDoc(): DecalDoc;
  get composeName(): string;
  get composeEditingId(): string | null;
  get composeSelectedId(): string | null;
  get show3d(): boolean;
  get bank(): BankedMaterial[];
  currentShader(): ShaderSpec | null;
  currentShaderData(): number[] | null;
  selectComposeNode(id: string | null): void;
  moveComposeNode(id: string, dx: number, dy: number): void;
  resizeComposeNode(id: string, handle: ComposeResizeHandle, dx: number, dy: number): void;
  renameComposeNode(id: string, name: string): void;
  toggleComposeNodeHidden(id: string): void;
  duplicateComposeNode(id: string): void;
  removeComposeNode(id: string): void;
  moveComposeNodeLayer(id: string, dir: 1 | -1): void;
}

export function createMaterialStore(deps: MaterialWorkbenchDeps): MaterialStore {
  const listeners = new Set<() => void>();
  const useTwigs = deps.twig !== false;
  const twigAdapter = typeof deps.twig === 'object' ? deps.twig : null;
  const emit = () => { for (const fn of [...listeners]) fn(); };

  const readTwig = <T,>(route: string, key: string, initial: T): T => {
    if (!useTwigs) return initial;
    if (twigAdapter) return twigAdapter.read(route, key, initial);
    return initial;
  };
  const writeTwig = <T,>(route: string, key: string, value: T): void => {
    if (!useTwigs) return;
    if (twigAdapter) twigAdapter.write(route, key, value);
  };

  const recipes = () => deps.recipes();
  const firstRecipe = () => recipes()[0] ?? null;
  const specById = (id: string) => recipes().find((s) => s.id === id) ?? null;

  let activeRowId: string | null = readTwig('/workbench/materials', 'activeRow', null as string | null);
  let lens: MaterialLens = readTwig('/workbench/materials', 'lens', 'preview' as MaterialLens);
  let saveAs = readTwig(TEXTURE_ROUTE, 'saveAs', '');
  const sel = readTwig<any>(TEXTURE_ROUTE, 'selection', null);
  let shaderId = typeof sel?.id === 'string' && specById(sel.id) ? sel.id : firstRecipe()?.id ?? '';
  let variantId = specById(shaderId)?.variants[0]?.id ?? '';
  let base = paramDefaults(specById(shaderId)?.base ?? []);
  let overlays: Record<string, Record<string, number>> = Object.fromEntries((specById(shaderId)?.variants ?? []).map((v) => [v.id, paramDefaults(v.params)]));
  let bank: BankedMaterial[] = [];

  let composeDoc = validateDecalDoc(readTwig(COMPOSE_ROUTE, 'doc', null as any)) ?? emptyDecalDoc();
  let composeName = readTwig(COMPOSE_ROUTE, 'name', '');
  let composeEditingId = readTwig<string | null>(COMPOSE_ROUTE, 'editingId', null);
  let show3d = readTwig(COMPOSE_ROUTE, 'show3d', true);
  let selectedNodeId: string | null = null;

  let api: MaterialStore;

  const writeActive = () => writeTwig('/workbench/materials', 'activeRow', activeRowId);
  const writeLens = () => writeTwig('/workbench/materials', 'lens', lens);
  const writeShaderSelection = (kind: string, id: string) => writeTwig(TEXTURE_ROUTE, 'selection', { kind, id });
  const writeSaveAs = () => writeTwig(TEXTURE_ROUTE, 'saveAs', saveAs);
  const writeCompose = () => {
    writeTwig(COMPOSE_ROUTE, 'doc', composeDoc);
    writeTwig(COMPOSE_ROUTE, 'name', composeName);
    writeTwig(COMPOSE_ROUTE, 'editingId', composeEditingId);
    writeTwig(COMPOSE_ROUTE, 'show3d', show3d);
  };

  const setShader = (id: string) => {
    const spec = specById(id);
    if (!spec) return;
    shaderId = spec.id;
    variantId = spec.variants[0]?.id ?? '';
    base = paramDefaults(spec.base);
    overlays = Object.fromEntries(spec.variants.map((v) => [v.id, paramDefaults(v.params)]));
    writeShaderSelection('shader', spec.id);
  };

  const currentSpec = () => specById(shaderId);
  const currentVariant = () => {
    const spec = currentSpec();
    if (!spec) return null;
    return spec.variants.find((v) => v.id === variantId) ?? spec.variants[0] ?? null;
  };
  const currentData = () => {
    const spec = currentSpec();
    const variant = currentVariant();
    if (!spec || !variant) return null;
    return spec.buildData(variant.value, base, overlays[variant.id] ?? {});
  };

  const customRows = () => deps.stored();
  const effectFillOptions = (): PickOption[] => recipes()
    .filter(isEffectFillSpec)
    .map((spec) => ({ id: spec.id, label: spec.label, group: spec.group }));
  const effectFillLabel = (id: string): string => recipes().find((spec) => spec.id === id)?.label ?? id;
  const resolveRow = (rowId: string): MaterialRow | null => {
    if (rowId.startsWith('recipe:')) {
      const id = rowId.slice('recipe:'.length);
      const spec = specById(id);
      return spec ? { kind: 'recipe', id, label: spec.label, spec } : null;
    }
    if (rowId.startsWith('react:')) {
      const id = rowId.slice('react:'.length);
      const texture = deps.reactTextures().find((t) => t.id === id) ?? null;
      return texture ? { kind: 'react', id, label: texture.label, texture } : null;
    }
    if (rowId.startsWith('stored:')) {
      const id = rowId.slice('stored:'.length);
      const material = customRows().find((t) => t.id === id) ?? null;
      return material ? { kind: 'stored', id, label: material.label, material } : null;
    }
    if (rowId === 'decal:new') return { kind: 'decal', id: 'new', label: 'new decal' };
    if (rowId.startsWith('decal:')) {
      const id = rowId.slice('decal:'.length);
      const material = customRows().find((t) => t.id === id && t.decal) ?? null;
      return material ? { kind: 'decal', id, label: material.label, material } : null;
    }
    if (rowId.startsWith('mission:')) {
      const key = rowId.slice('mission:'.length);
      const preset = missionCodePresets().find((p) => p.key === key) ?? null;
      return preset ? { kind: 'mission', id: key, label: preset.label, doc: preset.doc, key } : null;
    }
    return null;
  };

  const rowIdOf = (row: MaterialRow): string => {
    if (row.kind === 'recipe') return `recipe:${row.id}`;
    if (row.kind === 'react') return `react:${row.id}`;
    if (row.kind === 'stored') return `stored:${row.id}`;
    if (row.kind === 'mission') return `mission:${row.id}`;
    return row.id === 'new' ? 'decal:new' : `decal:${row.id}`;
  };

  const openDecal = (material: StoredMaterialSummary | null) => {
    if (!material?.decal) {
      composeDoc = emptyDecalDoc(composeDoc.width, composeDoc.height);
      composeName = '';
      composeEditingId = null;
      selectedNodeId = null;
      writeCompose();
      return;
    }
    const opened = validateDecalDoc(cloneDoc(material.decal));
    if (!opened) return;
    composeDoc = opened;
    composeName = material.label;
    composeEditingId = material.id;
    selectedNodeId = null;
    writeCompose();
  };

  // Load a freshly-generated DecalDoc (a mission code) into the compose surface as
  // an UNSAVED draft — the user tweaks colours/size then Materializes it like any
  // decal. composeEditingId stays null so saving mints a new material, never
  // clobbers a stored one.
  const openComposeDoc = (doc: DecalDoc, name: string) => {
    const opened = validateDecalDoc(cloneDoc(doc));
    if (!opened) return;
    composeDoc = opened;
    composeName = name;
    composeEditingId = null;
    selectedNodeId = null;
    writeCompose();
  };

  const patchDoc = (patch: Partial<DecalDoc>) => {
    composeDoc = { ...composeDoc, ...patch };
    writeCompose();
    emit();
  };
  const patchNode = (id: string, patch: Partial<DecalNode>) => {
    composeDoc = {
      ...composeDoc,
      nodes: composeDoc.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as DecalNode) : n)),
    };
    writeCompose();
    emit();
  };
  const addNode = (node: DecalNode) => {
    composeDoc = { ...composeDoc, nodes: [...composeDoc.nodes, node] };
    selectedNodeId = node.id;
    writeCompose();
    emit();
  };
  const removeNode = (id: string) => {
    composeDoc = { ...composeDoc, nodes: composeDoc.nodes.filter((n) => n.id !== id) };
    if (selectedNodeId === id) selectedNodeId = null;
    writeCompose();
    emit();
  };
  const duplicateNode = (id: string) => {
    const src = composeDoc.nodes.find((n) => n.id === id);
    if (!src) return;
    addNode({ ...src, id: mintNodeId(composeDoc, src.kind), x: src.x + 16, y: src.y + 16 } as DecalNode);
  };
  const reorderNode = (id: string, dir: 1 | -1) => {
    const i = composeDoc.nodes.findIndex((n) => n.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= composeDoc.nodes.length) return;
    const nodes = [...composeDoc.nodes];
    [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
    composeDoc = { ...composeDoc, nodes };
    writeCompose();
    emit();
  };
  const pickImageForNode = (id: string) => {
    const apply = (raw: string | null) => {
      if (!raw) return;
      patchNode(id, { src: cleanPickedPath(raw) } as Partial<DecalNode>);
    };
    const picked = deps.pickImage?.();
    if (!picked) return;
    if (typeof (picked as Promise<string | null>).then === 'function') {
      void (picked as Promise<string | null>).then(apply);
    } else {
      apply(picked as string);
    }
  };
  const addImageNode = () => {
    const node: DecalNode = { id: mintNodeId(composeDoc, 'image'), kind: 'image', x: composeDoc.width / 4, y: composeDoc.height / 4, w: composeDoc.width / 2, h: composeDoc.height / 2, src: '' };
    addNode(node);
    pickImageForNode(node.id);
  };

  const materializeShader = () => {
    const spec = currentSpec();
    const data = currentData();
    if (!spec || !data) return;
    const variant = currentVariant();
    const label = saveAs.trim() || `${spec.id}/${variant?.id ?? 'v0'}${bank.length ? `-${bank.length}` : ''}`;
    bank = [...bank, { name: label, shaderId: spec.id, data: [...data] }];
    const saved = deps.saveShader(label, spec.id, data);
    deps.session?.commit(
      { kind: 'materialized', material: { id: saved.id, label: saved.label, shaderId: saved.shaderId, data: saved.data } },
      `materialized · ${saved.label}`,
    );
    saveAs = '';
    writeSaveAs();
    activeRowId = `stored:${saved.id}`;
    lens = 'preview';
    writeActive();
    writeLens();
    emit();
  };

  const materializeDecal = () => {
    const label = composeName.trim() || 'decal';
    const saved = deps.saveDecal(label, composeDoc, composeEditingId ?? undefined);
    if (!saved?.decal) return;
    deps.session?.commit(
      { kind: 'materialized', material: { id: saved.id, label: saved.label, decal: saved.decal } },
      `materialized · ${saved.label} (decal)`,
    );
    composeEditingId = saved.id;
    composeName = saved.label;
    activeRowId = `decal:${saved.id}`;
    lens = 'compose';
    writeCompose();
    writeActive();
    writeLens();
    emit();
  };

  const deleteStored = (id: string) => {
    deps.remove(id);
    deps.session?.commit({ kind: 'removed', id }, `${id}: deleted`);
    if (composeEditingId === id) composeEditingId = null;
    activeRowId = null;
    writeCompose();
    writeActive();
    emit();
  };

  const shaderFields = (): FieldSpec[] => {
    const spec = currentSpec();
    if (!spec) return [{ k: 'shader', t: 'val', get: () => 'none' }];
    const variant = currentVariant();
    return [
      { k: 'recipe', t: 'val', get: () => spec.id },
      { k: 'save as', t: 'text', width: 156, get: () => saveAs, set: (v) => { saveAs = v; writeSaveAs(); } },
      { k: 'variant', t: 'enum', opts: spec.variants.map((v) => v.id), get: () => variant?.id ?? spec.variants[0]?.id ?? '', set: (v) => { variantId = v; writeShaderSelection('shader', spec.id); } },
      { k: 'reset recipe', t: 'act', tone: 'warning', run: () => { setShader(spec.id); emit(); } },
    ];
  };

  const shaderParamFields = (params: ShaderParam[], values: Record<string, number>, setValue: (k: string, v: number) => void): FieldSpec[] =>
    params.map((p): FieldSpec => ({
      k: p.label,
      t: 'slider',
      min: p.min,
      max: p.max,
      show: (v) => showParam(p, v),
      get: () => values[p.key] ?? p.default,
      set: (v) => setValue(p.key, snapParam(p, v)),
    }));

  const composeFields = (): FieldSpec[] => [
    { k: 'name', t: 'text', width: 150, get: () => composeName, set: (v) => { composeName = v; writeCompose(); } },
    { k: 'editing', t: 'val', get: () => composeEditingId ?? 'new' },
    { k: 'size', t: 'enum', opts: DECAL_SIZE_PRESETS.map((p) => p.label), get: () => labelForPreset(composeDoc), set: (label) => {
      const p = DECAL_SIZE_PRESETS.find((x) => x.label === label);
      if (p) patchDoc({ width: p.width, height: p.height });
    } },
    { k: '3D billboard', t: 'bool', get: () => show3d, set: (v) => { show3d = v; writeCompose(); } },
    { k: 'new decal', t: 'act', tone: 'success', run: () => { openDecal(null); emit(); } },
    { k: '+ rect', t: 'act', run: () => addNode({ id: mintNodeId(composeDoc, 'rect'), kind: 'rect', x: composeDoc.width / 4, y: composeDoc.height / 4, w: composeDoc.width / 2, h: composeDoc.height / 2, bg: '#2563eb', borderRadius: 8 }) },
    { k: '+ text', t: 'act', run: () => addNode({ id: mintNodeId(composeDoc, 'text'), kind: 'text', x: composeDoc.width / 8, y: composeDoc.height / 3, w: (composeDoc.width * 3) / 4, h: composeDoc.height / 3, text: 'BILLBOARD', color: '#f8fafc', fontSize: Math.round(composeDoc.height / 4), fontWeight: 800, align: 'center' }) },
    { k: '+ image', t: 'act', run: addImageNode },
  ];

  const canvasOrNodeFields = (): FieldSpec[] => {
    const selected = selectedNodeId ? composeDoc.nodes.find((n) => n.id === selectedNodeId) ?? null : null;
    if (!selected) {
      return [
        { k: 'width', t: 'num', min: 8, max: 4096, step: 8, precision: 0, get: () => composeDoc.width, set: (v) => patchDoc({ width: Math.max(8, Math.round(v)) }) },
        { k: 'height', t: 'num', min: 8, max: 4096, step: 8, precision: 0, get: () => composeDoc.height, set: (v) => patchDoc({ height: Math.max(8, Math.round(v)) }) },
        { k: 'bg', t: 'color', wheel: true, get: () => composeDoc.bg, set: (v) => patchDoc({ bg: v }) },
      ];
    }
    const baseFields: FieldSpec[] = [
      { k: 'x', t: 'num', min: -4096, max: 4096, step: 1, precision: 0, get: () => selected.x, set: (v) => patchNode(selected.id, { x: v }) },
      { k: 'y', t: 'num', min: -4096, max: 4096, step: 1, precision: 0, get: () => selected.y, set: (v) => patchNode(selected.id, { y: v }) },
      { k: 'w', t: 'num', min: 1, max: 4096, step: 1, precision: 0, get: () => selected.w, set: (v) => patchNode(selected.id, { w: Math.max(1, v) }) },
      { k: 'h', t: 'num', min: 1, max: 4096, step: 1, precision: 0, get: () => selected.h, set: (v) => patchNode(selected.id, { h: Math.max(1, v) }) },
      { k: 'opacity', t: 'slider', min: 0.05, max: 1, show: (v) => v.toFixed(2), get: () => selected.opacity ?? 1, set: (v) => patchNode(selected.id, { opacity: v }) },
    ];
    if (selected.kind === 'rect') {
      baseFields.push(
        { k: 'flat fill', t: 'color', wheel: true, get: () => selected.bg, set: (v) => patchNode(selected.id, { bg: v }) },
        {
          k: 'effect fill', t: 'pick',
          get: () => selected.fillShaderId ?? null,
          opts: effectFillOptions,
          show: effectFillLabel,
          clearLabel: 'flat color',
          set: (id) => {
            const spec = id ? recipes().find((s) => s.id === id) : null;
            patchNode(selected.id, spec ? { fillShaderId: spec.id, fillData: defaultShaderData(spec) } : { fillShaderId: undefined, fillData: undefined });
          },
        },
        { k: 'radius', t: 'num', min: 0, max: 128, step: 1, precision: 0, get: () => selected.borderRadius ?? 0, set: (v) => patchNode(selected.id, { borderRadius: v }) },
        { k: 'border', t: 'num', min: 0, max: 32, step: 1, precision: 0, get: () => selected.borderWidth ?? 0, set: (v) => patchNode(selected.id, { borderWidth: v }) },
        { k: 'b.color', t: 'color', wheel: true, get: () => selected.borderColor ?? '#000000', set: (v) => patchNode(selected.id, { borderColor: v }) },
      );
    } else if (selected.kind === 'text') {
      baseFields.push(
        { k: 'text', t: 'text', width: 166, get: () => selected.text, set: (v) => patchNode(selected.id, { text: v }) },
        { k: 'color', t: 'color', wheel: true, get: () => selected.color, set: (v) => patchNode(selected.id, { color: v }) },
        { k: 'size', t: 'num', min: 6, max: 320, step: 1, precision: 0, get: () => selected.fontSize, set: (v) => patchNode(selected.id, { fontSize: v }) },
        { k: 'tracking', t: 'num', min: -4, max: 32, step: 0.5, precision: 1, get: () => selected.letterSpacing ?? 0, set: (v) => patchNode(selected.id, { letterSpacing: v }) },
        { k: 'weight', t: 'enum', opts: FONT_WEIGHTS, get: () => String(selected.fontWeight ?? 400), set: (v) => patchNode(selected.id, { fontWeight: parseWeight(v) }) },
        { k: 'family', t: 'enum', opts: FONT_FAMILIES, get: () => selected.fontFamily ?? 'default', set: (v) => patchNode(selected.id, { fontFamily: v === 'default' ? undefined : v }) },
        { k: 'align', t: 'enum', opts: ALIGN_OPTS, get: () => selected.align ?? 'left', set: (v) => patchNode(selected.id, { align: v as DecalAlign }) },
      );
    } else {
      baseFields.push(
        { k: 'pick file…', t: 'act', run: () => pickImageForNode(selected.id) },
        { k: 'src', t: 'text', width: 174, get: () => selected.src, set: (v) => patchNode(selected.id, { src: v }) },
        { k: 'radius', t: 'num', min: 0, max: 128, step: 1, precision: 0, get: () => selected.borderRadius ?? 0, set: (v) => patchNode(selected.id, { borderRadius: v }) },
      );
    }
    return baseFields;
  };

  api = {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    listRows() {
      const rows: RosterRow[] = [];
      for (const spec of recipes()) rows.push({ id: `recipe:${spec.id}`, label: spec.label, icon: 'FlaskConical' });
      for (const t of deps.reactTextures()) rows.push({ id: `react:${t.id}`, label: t.label, icon: 'Code2' });
      for (const t of customRows()) rows.push({ id: `stored:${t.id}`, label: t.label, icon: t.decal ? 'Image' : 'Palette' });
      rows.push({ id: 'decal:new', label: 'new decal', icon: 'SquarePen' });
      for (const t of customRows().filter((m) => m.decal)) rows.push({ id: `decal:${t.id}`, label: `${t.label} (decal)`, icon: 'ImagePlus' });
      for (const p of missionCodePresets()) rows.push({ id: `mission:${p.key}`, label: p.label, icon: 'QrCode' });
      return rows;
    },
    defaultRow(rows) {
      if (activeRowId && rows.some((r) => r.id === activeRowId)) return activeRowId;
      if (rows.some((r) => r.id === `recipe:${shaderId}`)) return `recipe:${shaderId}`;
      return rows[0]?.id;
    },
    pick(rowId) {
      const row = resolveRow(rowId);
      if (!row) return;
      activeRowId = rowId;
      if (row.kind === 'recipe') {
        setShader(row.id);
        lens = 'shader';
      } else if (row.kind === 'react') {
        writeShaderSelection('react', row.id);
        lens = 'preview';
      } else if (row.kind === 'stored') {
        writeShaderSelection('custom', row.id);
        lens = row.material.decal ? 'compose' : 'preview';
        if (row.material.decal) openDecal(row.material);
      } else if (row.kind === 'mission') {
        lens = 'compose';
        openComposeDoc(row.doc, row.label);
      } else {
        lens = 'compose';
        openDecal(row.id === 'new' ? null : row.material);
      }
      writeActive();
      writeLens();
      emit();
    },
    select(rowId) {
      const row = resolveRow(rowId) ?? resolveRow(api.defaultRow(api.listRows()) ?? '') ?? { kind: 'decal', id: 'new', label: 'new decal' };
      return { store: api, row } as MaterialSubject;
    },
    panel(subject) {
      const row = subject.row;
      const groups: PanelSpec['groups'] = [{
        title: 'IDENTITY',
        fields: [
          { k: 'kind', t: 'val', get: () => row.kind },
          { k: 'id', t: 'val', get: () => row.id },
          { k: 'mode', t: 'enum', opts: ['preview', 'shader', 'compose'], get: () => lens, set: (v) => { lens = v as MaterialLens; writeLens(); } },
        ],
      }];

      if (row.kind === 'recipe' || lens === 'shader') {
        const spec = row.kind === 'recipe' ? row.spec : currentSpec();
        if (spec && spec.id !== shaderId) setShader(spec.id);
        groups.push({ title: 'SHADER RECIPE', fields: shaderFields() });
        const activeSpec = currentSpec();
        const variant = currentVariant();
        if (activeSpec) {
          groups.push({ title: 'BASE PARAMETERS', fields: shaderParamFields(activeSpec.base, base, (k, v) => { base = { ...base, [k]: v }; }) });
        }
        if (variant) {
          groups.push({
            title: `${variant.label.toUpperCase()} PARAMETERS`,
            fields: shaderParamFields(variant.params, overlays[variant.id] ?? {}, (k, v) => { overlays = { ...overlays, [variant.id]: { ...(overlays[variant.id] ?? {}), [k]: v } }; }),
          });
        }
        groups.push({
          title: 'MATERIAL BANK',
          fields: [
            { k: 'count', t: 'val', get: () => String(bank.length) },
            { k: 'latest', t: 'val', get: () => bank[bank.length - 1]?.name ?? 'none' },
          ],
        });
      }

      if (row.kind === 'stored') {
        groups.push({
          title: 'STORED MATERIAL',
          fields: [
            { k: 'label', t: 'val', get: () => row.material.label },
            { k: 'source', t: 'val', get: () => row.material.decal ? 'decal' : row.material.shaderId ?? 'unknown' },
            { k: 'delete stored', t: 'act', tone: 'error', run: () => deleteStored(row.material.id) },
          ],
        });
      }

      if (row.kind === 'decal' || lens === 'compose') {
        groups.push({ title: 'COMPOSE', fields: composeFields() });
        groups.push({ title: selectedNodeId ? 'NODE PROPERTIES' : 'CANVAS', layout: 'rows', fields: canvasOrNodeFields() });
      }

      return { groups };
    },
    lenses() {
      return [
        { id: 'preview', label: 'PREVIEW' },
        { id: 'shader', label: 'SHADER LAB' },
        { id: 'compose', label: 'COMPOSE' },
      ];
    },
    actions(subject) {
      const out: ActionSpec[] = [];
      if (lens === 'shader' || subject.row.kind === 'recipe') out.push({ id: 'materialize', label: 'Materialize', icon: 'Hammer', run: materializeShader });
      if (lens === 'compose' || subject.row.kind === 'decal') out.push({ id: 'materialize-decal', label: 'Materialize', icon: 'Hammer', run: materializeDecal });
      if (subject.row.kind === 'stored') out.push({ id: 'delete', label: 'Remove', icon: 'Trash2', run: () => deleteStored(subject.row.material.id) });
      if (subject.row.kind === 'decal' && subject.row.id !== 'new') out.push({ id: 'delete-decal', label: 'Remove', icon: 'Trash2', run: () => deleteStored(subject.row.id) });
      return out;
    },
    setLens(next) { lens = next; writeLens(); emit(); },
    get lens() { return lens; },
    get activeRowId() { return activeRowId; },
    get composeDoc() { return composeDoc; },
    get composeName() { return composeName; },
    get composeEditingId() { return composeEditingId; },
    get composeSelectedId() { return selectedNodeId; },
    get show3d() { return show3d; },
    get bank() { return bank; },
    currentShader: currentSpec,
    currentShaderData: currentData,
    selectComposeNode(id) { selectedNodeId = id; emit(); },
    moveComposeNode(id, dx, dy) {
      const node = composeDoc.nodes.find((n) => n.id === id);
      if (!node) return;
      patchNode(id, { x: node.x + dx, y: node.y + dy });
    },
    resizeComposeNode(id, handle, dx, dy) {
      const node = composeDoc.nodes.find((n) => n.id === id);
      if (!node) return;
      patchNode(id, resizeNodePatch(node, handle, dx, dy));
    },
    renameComposeNode(id, name) {
      const clean = name.trim();
      patchNode(id, { name: clean || undefined } as Partial<DecalNode>);
    },
    toggleComposeNodeHidden(id) {
      const node = composeDoc.nodes.find((n) => n.id === id);
      if (!node) return;
      patchNode(id, { hidden: node.hidden ? undefined : true } as Partial<DecalNode>);
    },
    duplicateComposeNode: duplicateNode,
    removeComposeNode: removeNode,
    moveComposeNodeLayer: reorderNode,
  };

  return api;
}
