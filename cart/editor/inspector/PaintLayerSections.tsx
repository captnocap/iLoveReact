// Paint-target adapters for the one shared PaintLayersPanel. Model layers live
// in the host stroke program; facade layers live in the map document. The left
// Paint dock consumes only these narrow components and never invents a second
// layer state for either backend.
import { useEffect, useState } from 'react';
import { facadeLayers, type Facade, type FacadeLayer } from '../world/facades';
import PaintLayersPanel from './PaintLayersPanel';

const MODEL_LAYER_TUNING = {
  hostRefreshMs: 1000,
} as const;

type ModelLayerRow = { id: number; name: string; visible: number; strokes: number };
type ModelLayersSnapshot = { active: number; layers: ModelLayerRow[] };

function readModelPaintLayers(): ModelLayersSnapshot | null {
  try {
    const json = (globalThis as any).__mesh_paint_layers?.();
    if (typeof json !== 'string' || !json) return null;
    const value = JSON.parse(json);
    if (value?.ok !== 1 || !Array.isArray(value.layers)) return null;
    return { active: (value.active ?? 0) | 0, layers: value.layers as ModelLayerRow[] };
  } catch {
    return null;
  }
}

/** Host-backed model layers. refreshKey advances at stroke end, while the low
 * frequency poll catches undo or host-side edits that do not cross React. */
export function ModelPaintLayersSection(props: { refreshKey: number; onDocumentMutated: () => void }) {
  const [snapshot, setSnapshot] = useState<ModelLayersSnapshot | null>(() => readModelPaintLayers());
  useEffect(() => {
    const read = () => {
      const next = readModelPaintLayers();
      setSnapshot((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    read();
    const timer = setInterval(read, MODEL_LAYER_TUNING.hostRefreshMs);
    return () => clearInterval(timer);
  }, [props.refreshKey]);

  const run = (operation: string, id: number, argument?: string | number): boolean => {
    try {
      const json = (globalThis as any).__mesh_paint_layer_op?.(operation, id, argument ?? 0);
      if (typeof json === 'string' && json) {
        const value = JSON.parse(json);
        if (value?.ok === 1 && Array.isArray(value.layers)) {
          setSnapshot({ active: (value.active ?? 0) | 0, layers: value.layers as ModelLayerRow[] });
          if (operation !== 'active' && operation !== 'visible') props.onDocumentMutated();
          return true;
        }
      }
    } catch { /* honest host re-read below */ }
    setSnapshot(readModelPaintLayers());
    return false;
  };

  if (!snapshot?.layers.length) return null;
  return (
    <PaintLayersPanel
      rows={snapshot.layers.map((layer) => ({ ...layer, visible: !!layer.visible }))}
      activeId={snapshot.active}
      onAdd={() => run('add', 0)}
      onActive={(id) => run('active', id)}
      onVisible={(id, visible) => run('visible', id, visible ? 1 : 0)}
      onRename={(id, name) => run('rename', id, name)}
      onMove={(id, direction) => run(direction, id)}
      onMergeDown={(id) => run('mergedown', id)}
      onDelete={(id) => run('delete', id)}
    />
  );
}

/** Durable facade layers, projected into the same controls as model layers. */
export function FacadePaintLayersSection(props: {
  facade: Facade;
  onLayers: (facadeId: string, layers: FacadeLayer[], activeLayerId: string) => void;
}) {
  const layers = facadeLayers(props.facade);
  const activeId = layers.some((layer) => layer.id === props.facade.activeLayerId)
    ? props.facade.activeLayerId
    : layers[0]!.id;
  const update = (next: FacadeLayer[], nextActive = activeId): boolean => {
    if (!next.length || !next.some((layer) => layer.id === nextActive)) return false;
    props.onLayers(props.facade.id, next, nextActive);
    return true;
  };
  const add = () => {
    let suffix = 1;
    while (layers.some((layer) => layer.id === `layer-${suffix}`)) suffix += 1;
    const id = `layer-${suffix}`;
    return update([...layers, { id, name: `Layer ${suffix}`, visible: true, opacity: 1, strokes: [] }], id);
  };
  const move = (id: string, direction: 'up' | 'down') => {
    const at = layers.findIndex((layer) => layer.id === id);
    const to = direction === 'up' ? at + 1 : at - 1;
    if (at < 0 || to < 0 || to >= layers.length) return false;
    const next = layers.slice();
    [next[at], next[to]] = [next[to]!, next[at]!];
    return update(next);
  };
  const mergeDown = (id: string) => {
    const at = layers.findIndex((layer) => layer.id === id);
    if (at <= 0) return false;
    const next = layers.slice();
    next[at - 1] = { ...next[at - 1]!, strokes: [...next[at - 1]!.strokes, ...next[at]!.strokes] };
    next.splice(at, 1);
    return update(next, next[at - 1]!.id);
  };

  return (
    <PaintLayersPanel
      rows={layers.map((layer) => ({ id: layer.id, name: layer.name, visible: layer.visible, strokes: layer.strokes.length }))}
      activeId={activeId}
      onAdd={add}
      onActive={(id) => update(layers, id)}
      onVisible={(id, visible) => update(layers.map((layer) => layer.id === id ? { ...layer, visible } : layer))}
      onRename={(id, name) => update(layers.map((layer) => layer.id === id ? { ...layer, name } : layer))}
      onMove={move}
      onMergeDown={mergeDown}
      onDelete={(id) => layers.length > 1
        ? update(layers.filter((layer) => layer.id !== id), id === activeId ? layers.find((layer) => layer.id !== id)!.id : activeId)
        : false}
    />
  );
}
