// editors/model/Outliner.tsx — the Studio OUTLINER is the paint editor's layers
// component (req_0961/0962). The user: "look at the painter we have right now
// that has a layers component, we are going to use that for meshes." So this is
// a thin adapter: map the scene's EditMesh parts → LayerStripRowModel[] and wire
// the row verbs (visibility / duplicate / reorder / rename / delete) + the +add
// straight to the StudioModel. NO bespoke layer list — LayerStackStrip is the
// one paint-layer control surface (PAINTLAYERS-0606) and the outliner reuses it.

import { Box } from '@reactjit/primitives';
import { LayerStackStrip, type LayerStripRowModel } from '../paint/LayerStrip';
import type { StudioModel, StudioPart } from './studioModel';

function partRow(part: StudioPart, active: boolean, i: number, count: number): LayerStripRowModel {
  return {
    id: part.id,
    name: part.name,
    meta: `${part.mesh.verts.length}v · ${part.mesh.faces.length}f`,
    active,
    muted: !part.visible,
    // a colored swatch until per-part 3D thumbnails land (the swatch matches the
    // part's viewport tint so the outliner row and the mesh read as the same thing).
    preview: <Box style={{ width: '100%', height: '100%', backgroundColor: part.color }} />,
    canMoveUp: i > 0,
    canMoveDown: i < count - 1,
    // merge folds this layer into the one above it (req_1296) — disabled on the
    // topmost row, where there's nothing above to merge into.
    canMerge: i > 0,
  };
}

export function StudioOutliner(props: { model: StudioModel; height?: number | string; onAdd?: () => void; onImport?: () => void }) {
  const { model } = props;
  const rows = model.parts.map((p, i) => partRow(p, p.id === model.activeId, i, model.parts.length));
  return (
    <LayerStackStrip
      title="OUTLINER"
      rows={rows}
      height={props.height}
      emptyText="No meshes yet — press + add to drop one on the grid."
      onAdd={props.onAdd ?? (() => model.addCuboid())}
      onImport={props.onImport}
      importLabel="⤓ part"
      onSelect={model.select}
      onRename={model.rename}
      onAction={model.runAction}
    />
  );
}
