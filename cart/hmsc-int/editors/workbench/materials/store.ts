// editors/workbench/materials/store.ts -- the MATERIAL WorkbenchSource truth
// (WBSTEP7-0606). It folds /textures + /compose into one headless state object:
// shader recipes, stored materials, decal composition, and the hero Materialize
// action all read/write through this boundary.

import type { ActionSpec, RosterRow } from '../../../shell/Workbench';
import type { FieldSpec, PanelSpec } from '../../../shell/fields';
import type { LensSpec } from '../../../shell/stage';
import {
  emptyDecalDoc,
  validateDecalDoc,
  type DecalDoc,
  type DecalNode,
} from '../../../game/textures/decal';
import { paramDefaults, type ShaderParam, type ShaderSpec } from '../../../game/textures/shaders';
import * as decalEdit from '../../decal/decalEdit';
import { type DecalResizeHandle } from '../../decal/decalEdit';
import { decalAddFields, decalCanvasFields, decalNodeFields } from '../../decal/DecalNodeFields';
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
// The decal node-editing vocabulary now lives in editors/decal/decalEdit (shared
// with the studio painter, req_1730); ComposeResizeHandle stays as an alias so
// existing consumers (source.tsx) keep importing it from here.
export type ComposeResizeHandle = DecalResizeHandle;

const TEXTURE_ROUTE = '/textures';
const COMPOSE_ROUTE = '/compose';

function snapParam(p: ShaderParam, v: number): number {
  const stepped = Math.round(v / p.step) * p.step;
  const clamped = Math.max(p.min, Math.min(p.max, stepped));
  return p.integer ? Math.round(clamped) : Math.round(clamped * 1000) / 1000;
}

function showParam(p: ShaderParam, v: number): string {
  const n = p.integer ? String(Math.round(v)) : v.toFixed(p.step < 0.05 ? 3 : 2);
  return p.unit ? `${n}${p.unit}` : n;
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
    const opened = validateDecalDoc(decalEdit.cloneDoc(material.decal));
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
    const opened = validateDecalDoc(decalEdit.cloneDoc(doc));
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
  // All node mutations route through the shared pure ops (editors/decal/decalEdit);
  // these closures own only the side-effects (twig write + emit + selection).
  const patchDocNodes = (next: DecalDoc) => { composeDoc = next; writeCompose(); emit(); };
  const patchNode = (id: string, patch: Partial<DecalNode>) => patchDocNodes(decalEdit.patchNode(composeDoc, id, patch));
  const addNode = (node: DecalNode) => {
    composeDoc = decalEdit.addNode(composeDoc, node);
    selectedNodeId = node.id;
    writeCompose();
    emit();
  };
  const removeNode = (id: string) => {
    composeDoc = decalEdit.removeNode(composeDoc, id);
    if (selectedNodeId === id) selectedNodeId = null;
    writeCompose();
    emit();
  };
  const duplicateNode = (id: string) => {
    const next = decalEdit.duplicateNode(composeDoc, id);
    if (next === composeDoc) return;
    composeDoc = next;
    selectedNodeId = next.nodes[next.nodes.length - 1]?.id ?? selectedNodeId;
    writeCompose();
    emit();
  };
  const reorderNode = (id: string, dir: 1 | -1) => patchDocNodes(decalEdit.reorderNode(composeDoc, id, dir));
  const pickImageForNode = (id: string) => {
    const apply = (raw: string | null) => {
      if (!raw) return;
      patchNode(id, { src: decalEdit.cleanPickedPath(raw) } as Partial<DecalNode>);
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
    const node = decalEdit.newImage(composeDoc);
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
    ...decalCanvasFields(composeDoc, patchDoc),
    { k: '3D billboard', t: 'bool', get: () => show3d, set: (v) => { show3d = v; writeCompose(); } },
    { k: 'new decal', t: 'act', tone: 'success', run: () => { openDecal(null); emit(); } },
    ...decalAddFields({ doc: composeDoc, addNode, pickImageForNode }),
  ];

  const canvasOrNodeFields = (): FieldSpec[] =>
    decalNodeFields({ doc: composeDoc, selectedId: selectedNodeId, recipes: recipes(), patchNode, patchDoc, pickImageForNode });

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
    moveComposeNode(id, dx, dy) { patchDocNodes(decalEdit.moveNode(composeDoc, id, dx, dy)); },
    resizeComposeNode(id, handle, dx, dy) { patchDocNodes(decalEdit.resizeNode(composeDoc, id, handle, dx, dy)); },
    renameComposeNode(id, name) { patchDocNodes(decalEdit.renameNode(composeDoc, id, name)); },
    toggleComposeNodeHidden(id) { patchDocNodes(decalEdit.toggleHidden(composeDoc, id)); },
    duplicateComposeNode: duplicateNode,
    removeComposeNode: removeNode,
    moveComposeNodeLayer: reorderNode,
  };

  return api;
}
