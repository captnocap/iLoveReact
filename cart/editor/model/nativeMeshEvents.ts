// Native mesh journal outcomes — the cart-side decoder for the resident mesh
// authority. Geometry never crosses this bridge: the host reports one compact
// semantic row after an accepted mutation, undo, or redo.

import type { CommandSource } from '../../../runtime/commands';

export const NATIVE_MESH_ACTIONS = [
  { kind: 'extrude-face', label: 'extrude face', commandId: 'model.mesh.extrude-face' },
  { kind: 'extrude-edge', label: 'extrude edge', commandId: 'model.mesh.extrude-edge' },
  { kind: 'create-face', label: 'create face', commandId: 'model.mesh.create-face' },
  { kind: 'loop-cut', label: 'loop cut', commandId: 'model.mesh.loop-cut' },
  { kind: 'symmetrize', label: 'symmetrize', commandId: 'model.mesh.symmetrize' },
  { kind: 'delete-selection', label: 'delete selection', commandId: 'model.mesh.delete-selection' },
  { kind: 'delete-part', label: 'delete part', commandId: 'model.mesh.delete-part' },
  { kind: 'add-part', label: 'add part', commandId: 'model.mesh.add-part' },
  { kind: 'hide-part', label: 'hide part', commandId: 'model.mesh.hide-part' },
  { kind: 'show-part', label: 'show part', commandId: 'model.mesh.show-part' },
  { kind: 'duplicate-part', label: 'duplicate part', commandId: 'model.mesh.duplicate-part' },
  { kind: 'mirror-part', label: 'mirror part', commandId: 'model.mesh.mirror-part' },
  { kind: 'path-array', label: 'path array', commandId: 'model.mesh.path-array' },
  { kind: 'detach-faces', label: 'detach faces', commandId: 'model.mesh.detach-faces' },
  { kind: 'merge-parts', label: 'merge parts', commandId: 'model.mesh.merge-parts' },
  { kind: 'flip-faces', label: 'flip faces', commandId: 'model.mesh.flip-faces' },
  { kind: 'merge-faces', label: 'merge faces', commandId: 'model.mesh.merge-faces' },
  { kind: 'glass-faces', label: 'glass faces', commandId: 'model.mesh.glass-faces' },
  { kind: 'solidify-faces', label: 'solidify faces', commandId: 'model.mesh.solidify-faces' },
  { kind: 'split-quads', label: 'split quads', commandId: 'model.mesh.split-quads' },
  { kind: 'transform', label: 'transform', commandId: 'model.mesh.transform' },
  { kind: 'nudge', label: 'nudge', commandId: 'model.mesh.nudge' },
  { kind: 'scale-by-value', label: 'scale by value', commandId: 'model.mesh.scale-by' },
  { kind: 'uv-edit', label: 'edit UV', commandId: 'model.uv.edit' },
  { kind: 'uv-texture-import', label: 'import UV texture', commandId: 'model.uv.import-texture' },
  { kind: 'uv-texture-reload', label: 'reload UV texture', commandId: 'model.uv.reload-texture' },
] as const;

const NATIVE_MESH_PHASES = ['applied', 'undone', 'redone'] as const;
const NATIVE_MESH_SOURCES: readonly CommandSource[] = [
  'native', 'menu', 'hotkey', 'toolbar', 'dock', 'context-menu', 'palette', 'viewport', 'remote', 'automation',
];
const NATIVE_MESH_EVENT_WORDS = 10;

export type NativeMeshActionKind = typeof NATIVE_MESH_ACTIONS[number]['kind'];
export type NativeMeshActionPhase = typeof NATIVE_MESH_PHASES[number];
export type NativeMeshActionReport = Readonly<{
  id: number;
  documentToken: number;
  kind: NativeMeshActionKind;
  label: string;
  commandId: string;
  phase: NativeMeshActionPhase;
  source: CommandSource;
  beforeVertices: number;
  afterVertices: number;
  beforeParts: number;
  afterParts: number;
  droppedBefore: number;
}>;

function intValue(raw: number | undefined): number {
  return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw!)) : 0;
}

/** Stable positive per-document token. The real model id remains in the event
 * payload; this token only prevents a queued
 * native outcome from being attributed to whichever tab happens to be active
 * when React drains it. */
export function modelDocumentToken(modelId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < modelId.length; i += 1) {
    hash = Math.imul(hash ^ modelId.charCodeAt(i), 0x01000193) >>> 0;
  }
  return (hash & 0x7fff_ffff) || 1;
}

export function nativeMeshActionSourceOrdinal(source: string): number {
  const normalized = source === 'action bar' ? 'toolbar'
    : source === 'context' ? 'context-menu'
      : source === 'stage' ? 'viewport'
        : source === 'focus-panel' ? 'dock'
          : source === 'device' ? 'native'
            : source;
  const index = NATIVE_MESH_SOURCES.indexOf(normalized as CommandSource);
  return index < 0 ? NATIVE_MESH_SOURCES.indexOf('automation') : index;
}

/** Scope a synchronous JS projection of a native mutation. The journal remains
 * the one authority; this only stamps where its invocation came from. */
export function withNativeMeshActionSource<T>(source: string, mutate: () => T): T {
  const setSource = (globalThis as any).__mesh_action_source as ((ordinal: number) => void) | undefined;
  setSource?.(nativeMeshActionSourceOrdinal(source));
  try {
    return mutate();
  } finally {
    setSource?.(0);
  }
}

export function decodeNativeMeshActions(buffer: ArrayBuffer | null | undefined): NativeMeshActionReport[] {
  if (!buffer) return [];
  const values = new Uint32Array(buffer);
  const available = Math.floor(Math.max(0, values.length - 1) / NATIVE_MESH_EVENT_WORDS);
  const count = Math.min(intValue(values[0]), available);
  const reports: NativeMeshActionReport[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = 1 + i * NATIVE_MESH_EVENT_WORDS;
    const action = NATIVE_MESH_ACTIONS[intValue(values[base + 2])];
    if (!action) continue;
    const phase = NATIVE_MESH_PHASES[intValue(values[base + 3])] ?? 'applied';
    const source = NATIVE_MESH_SOURCES[intValue(values[base + 4])] ?? 'native';
    reports.push({
      id: intValue(values[base]),
      documentToken: intValue(values[base + 1]),
      kind: action.kind,
      label: action.label,
      commandId: action.commandId,
      phase,
      source,
      beforeVertices: intValue(values[base + 5]),
      afterVertices: intValue(values[base + 6]),
      beforeParts: intValue(values[base + 7]),
      afterParts: intValue(values[base + 8]),
      droppedBefore: intValue(values[base + 9]),
    });
  }
  return reports;
}

export function nativeMeshActionDrain(): NativeMeshActionReport[] {
  const drain = (globalThis as any).__mesh_action_drain as (() => ArrayBuffer | null | undefined) | undefined;
  return decodeNativeMeshActions(drain?.());
}
