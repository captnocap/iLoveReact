// editors/workbench/model/source.tsx — the STUDIO WorkbenchSource (req_0958 →
// req_0998/req_1000). The roster is now the LIBRARY of saved models (the painter
// idiom): a '+ new' row + one row per stored model. The Studio boots to 'new'
// (blank) on a cold start; picking a model opens it; the active part edits land
// in the column-4 viewport (StudioEditor). The roster HIGHLIGHT follows the
// studio store's open model (a twig), not the shell's disk selection — so it
// reads 'new' on a fresh start and the open model after a hot reload.
// See ../../model/MESH_EDITOR_PLAYBOOK.md + [[feedback_studio_branch_twig_cold_hot]].

import type { WorkbenchSource, RosterRow } from '../../../shell/Workbench';
import type { PanelSpec } from '../../../shell/fields';
import { StudioEditor } from '../../model/studiokit';
import { StudioUVPanel } from '../../model/UVPanel';
import { StudioRigPanel } from '../../model/RigMetaPanel';
import { StudioShapePanel } from '../../model/ShapePanel';
import {
  subscribeStudio, studioModelsList, studioOpenModelId, studioNewModel, studioOpenModel,
  studioModelName, studioRenameModel, studioDeleteModel, studioDuplicateModel,
} from '../../model/studioModel';

const NEW_ROW = 'new';
const MODEL_PREFIX = 'model:';

export function modelSource(): WorkbenchSource<null> {
  return {
    id: 'model',
    icon: 'Box',
    kicker: 'STUDIO',

    // the library: a '+ new' row, then every saved model (newest-created last).
    list: (): RosterRow[] => [
      { id: NEW_ROW, label: '+ new', icon: 'Plus' },
      ...studioModelsList().map((m) => ({ id: `${MODEL_PREFIX}${m.id}`, label: m.name, icon: 'Box' })),
    ],

    // the roster highlight follows the OPEN MODEL (a twig) — 'new' on cold start.
    selectedRow: (): string => {
      const open = studioOpenModelId();
      return open ? `${MODEL_PREFIX}${open}` : NEW_ROW;
    },

    // load is a side effect (never in render): blank scene, or open the model.
    onPick: (rowId: string): void => {
      if (rowId === NEW_ROW) studioNewModel();
      else if (rowId.startsWith(MODEL_PREFIX)) studioOpenModel(rowId.slice(MODEL_PREFIX.length));
    },

    // req_1064: delete a saved model straight from its roster row (the ✕ + confirm
    // the frame draws) — the column-3 LIBRARY panel that duplicated the roster is
    // gone. The '+ new' row is not deletable.
    canDeleteRow: (rowId: string): boolean => rowId.startsWith(MODEL_PREFIX),
    onDeleteRow: (rowId: string): void => {
      if (rowId.startsWith(MODEL_PREFIX)) studioDeleteModel(rowId.slice(MODEL_PREFIX.length));
    },

    subscribe: (fn) => subscribeStudio(fn),
    select: (): null => null,

    // hero-bar verb (req_1732): "Save a Copy" forks the open model into a new
    // library model and opens it, so making variations never overwrites the
    // original. Only meaningful once a model is open (the 'new' blank scene has
    // nothing to copy yet — it becomes a real model on the first edit).
    actions: () =>
      studioOpenModelId()
        ? [{ id: 'duplicate', label: 'Save a Copy', icon: 'Copy', run: () => studioDuplicateModel() }]
        : [],

    // Column 3 (req_0981): the open model (rename), the STUDIO facts, and the
    // LIVE UV preview formed from the active part's mesh.
    panel: (): PanelSpec => ({
      groups: [
        ...(studioOpenModelId() ? [{
          title: 'MODEL',
          fields: [
            { k: 'name', t: 'text' as const, width: 150, get: () => studioModelName() ?? '', set: (x: string) => studioRenameModel(x) },
          ],
        }] : []),
        {
          title: 'STUDIO',
          fields: [
            { k: 'tool', t: 'val' as const, get: () => 'mesh editor' },
            { k: 'outliner', t: 'val' as const, get: () => 'parts → layers (+ add)' },
            { k: 'scale', t: 'val' as const, get: () => '16 u = 1 tile = 1 m' },
          ],
        },
        {
          title: 'UV',
          fields: [
            { k: 'atlas', t: 'node' as const, render: () => <StudioUVPanel /> },
          ],
        },
        // req_1053: the layer's rig METADATA lives under the UV unwrap (the outliner
        // row can't hold it). Names here are the binding keys (model.joint.<name>).
        {
          title: 'RIG',
          fields: [
            { k: 'pivotJoints', t: 'node' as const, render: () => <StudioRigPanel /> },
          ],
        },
        // req_1060: the ENCODED SHAPE of the live edit mesh — a read-only view of
        // the exact bytes the V20 stream persists (counts, per-face loops, pivot,
        // mounts, raw JSON). The data behind what the viewport renders.
        {
          title: 'SHAPE',
          fields: [
            { k: 'encoded', t: 'node' as const, render: () => <StudioShapePanel /> },
          ],
        },
      ],
    }),
    stage: (): any => <StudioEditor />,
  };
}
