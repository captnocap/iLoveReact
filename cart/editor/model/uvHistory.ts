// UV document-history vocabulary shared by the inspector and ModelView bridge.
// Ordinals are a host ABI with framework/gpu/mesh_journal_log.zig: append only.

export const UV_HISTORY_ACTIONS = [
  { id: 'move', label: 'move UV islands' },
  { id: 'vertex', label: 'move UV vertex' },
  { id: 'rotate', label: 'rotate UV' },
  { id: 'scale', label: 'scale UV' },
  { id: 'flip-u', label: 'flip UV U' },
  { id: 'flip-v', label: 'flip UV V' },
  { id: 'numeric', label: 'edit UV values' },
  { id: 'match-width', label: 'match UV width' },
  { id: 'match-height', label: 'match UV height' },
  { id: 'match-size', label: 'match UV size' },
  { id: 'chain-horizontal', label: 'chain UV horizontally' },
  { id: 'chain-vertical', label: 'chain UV vertically' },
  { id: 'pack', label: 'pack UV islands' },
  { id: 'restore-shape', label: 'restore UV shape' },
  { id: 'stack', label: 'stack UV islands' },
] as const;

export const UV_ATLAS_IMPORT_LABEL = 'import UV texture';
export const UV_ATLAS_RELOAD_LABEL = 'reload UV texture';
export const JOURNAL_UV_ATLAS_MUTATION = 1;
export const UV_HISTORY_TUNING = { refreshMs: 250 } as const;

export type UvHistoryAction = typeof UV_HISTORY_ACTIONS[number]['id'];

export type ModelHistoryDepths = Readonly<{
  undo: number;
  redo: number;
  undoLabel: string;
  redoLabel: string;
}>;

export const EMPTY_MODEL_HISTORY: ModelHistoryDepths = {
  undo: 0,
  redo: 0,
  undoLabel: '',
  redoLabel: '',
};

/** Translate the semantic action to the append-only host ordinal. */
export function uvHistoryActionOrdinal(action: UvHistoryAction): number {
  const ordinal = UV_HISTORY_ACTIONS.findIndex((row) => row.id === action);
  if (ordinal < 0) throw new Error(`unknown UV history action: ${action}`);
  return ordinal;
}

export function isUvDocumentHistoryLabel(label: string): boolean {
  return label === UV_ATLAS_IMPORT_LABEL
    || label === UV_ATLAS_RELOAD_LABEL
    || UV_HISTORY_ACTIONS.some((row) => row.label === label);
}

/**
 * UV and paint use different replay engines but share one model chronology. A UV
 * step may run only when no newer paint undo (or earlier-undone paint redo) sits
 * in front of it.
 */
export function uvHistoryAvailability(model: ModelHistoryDepths, paint: ModelHistoryDepths): Readonly<{ undo: boolean; redo: boolean }> {
  return {
    undo: model.undo > 0 && paint.undo === 0 && isUvDocumentHistoryLabel(model.undoLabel),
    redo: model.redo > 0 && paint.redo === 0 && isUvDocumentHistoryLabel(model.redoLabel),
  };
}

function boundedDepth(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

/** Parse the native journal's cheap depth read without trusting malformed host data. */
export function parseModelHistory(raw: unknown): ModelHistoryDepths {
  if (typeof raw !== 'string' || raw.length === 0) return EMPTY_MODEL_HISTORY;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      undo: boundedDepth(value.undo),
      redo: boundedDepth(value.redo),
      undoLabel: typeof value.undoLabel === 'string' ? value.undoLabel : '',
      redoLabel: typeof value.redoLabel === 'string' ? value.redoLabel : '',
    };
  } catch {
    return EMPTY_MODEL_HISTORY;
  }
}

/** The paint journal uses `label` for its undo-side top; normalize it to the same shape. */
export function parsePaintHistory(raw: unknown): ModelHistoryDepths {
  if (typeof raw !== 'string' || raw.length === 0) return EMPTY_MODEL_HISTORY;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      undo: boundedDepth(value.undo),
      redo: boundedDepth(value.redo),
      undoLabel: typeof value.label === 'string' ? value.label : '',
      redoLabel: typeof value.redoLabel === 'string' ? value.redoLabel : '',
    };
  } catch {
    return EMPTY_MODEL_HISTORY;
  }
}
