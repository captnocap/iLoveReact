// editors/workbench/paint/source.tsx — the PAINT WorkbenchSource
// (AGNOSTICPAINT-0606, dispatch §1): the agnostic painting surface as a
// top-level workbench category. The roster lists every paintable thing
// /cutout serves today — figures, vehicles, stored materials, recipes,
// saved documents, extracted cutouts, a blank canvas; the panel carries the
// target's properties (the PART enum is the model sub-selection, the
// workbench idiom); the stage is THE bench. Materialize/remove ride the
// hero for library subjects; save/extract live on the bench's verb strip
// (they act on the canvas, the surface's own verbs — cutout's header law).

import type { WorkbenchSource, RosterRow, ActionSpec } from '../../../shell/Workbench';
import type { PanelSpec, FieldSpec } from '../../../shell/fields';
import { PaintBench } from './PaintBench';
import { paintBenchStore } from './live';
import type { PaintBenchStore } from './store';
import { decodeTargetRow, encodeTargetRow, type PaintTarget } from './targets';
import { FIGURE_PAINT_TARGETS } from '../../cutout/models';
import { libraryCutouts, libraryDocuments } from '../../cutout/stream';
import { VEHICLE_PART_IDS } from '../../../game/vehicle';

export function paintSource(store?: PaintBenchStore): WorkbenchSource<PaintBenchStore> {
  const s = store ?? paintBenchStore();

  // model rows decode without a part — keep the current part when re-picking
  // the same model, else the family's first target (the panel enum retargets)
  const partFor = (family: 'figure' | 'vehicle', docId: string): string => {
    const m = s.work.model;
    if (m && m.family === family && m.docId === docId) return m.part;
    return family === 'figure' ? FIGURE_PAINT_TARGETS[0] : VEHICLE_PART_IDS[0];
  };

  return {
    id: 'paint',
    icon: 'Brush',
    kicker: 'PAINT',

    list(): RosterRow[] {
      const rows: RosterRow[] = [{ id: 'blank', label: 'blank canvas', icon: 'Plus' }];
      const figs = s.figures();
      for (const id of figs?.order ?? []) rows.push({ id: `fig:${id}`, label: id, icon: 'User' });
      const vehs = s.vehicles();
      for (const id of vehs?.order ?? []) rows.push({ id: `veh:${id}`, label: id, icon: 'Car' });
      const cats = s.catalogs();
      for (const m of cats.materials) rows.push({ id: `mat:${m.id}`, label: m.label, icon: 'Palette' });
      for (const r of cats.recipes) rows.push({ id: `mat:${r.id}`, label: r.label, icon: 'FlaskConical' });
      const lib = s.library();
      if (lib) {
        for (const rec of libraryDocuments(lib)) rows.push({ id: `doc:${rec.id}`, label: rec.name, icon: 'FileImage' });
        for (const asset of libraryCutouts(lib)) rows.push({ id: `cut:${asset.id}`, label: asset.name, icon: 'Scissors' });
      }
      return rows;
    },

    // the open canvas names its row (TWIGSTATE: the frame twigs the pick;
    // the bench's own restore re-targets, this keeps the rail in agreement)
    defaultRow(rows) {
      const t = s.lastTarget;
      if (t) {
        const id = encodeTargetRow(t);
        if (rows.some((r) => r.id === id)) return id;
      }
      const w = s.work;
      if (w.model) {
        const id = `${w.model.family === 'figure' ? 'fig' : 'veh'}:${w.model.docId}`;
        if (rows.some((r) => r.id === id)) return id;
      }
      if (w.textureId && rows.some((r) => r.id === `mat:${w.textureId}`)) return `mat:${w.textureId}`;
      if (rows.some((r) => r.id === `doc:${w.docId}`)) return `doc:${w.docId}`;
      return 'blank';
    },

    onPick(rowId) {
      const target = decodeTargetRow(rowId, partFor as any);
      if (target) s.open(target);
    },

    select: () => s,
    subscribe: (fn) => s.subscribe(fn),

    panel(): PanelSpec {
      const w = s.work;
      const groups: PanelSpec['groups'] = [];

      const targetFields: FieldSpec[] = [
        { k: 'name', t: 'text', width: 150, get: () => s.work.name, set: (x) => s.rename(x) },
        { k: 'apply name', t: 'act', run: () => s.commitName() },
        { k: 'size', t: 'val', get: () => `${s.work.dims.w}×${s.work.dims.h}` },
      ];
      if (w.srcPath) targetFields.push({ k: 'image', t: 'val', get: () => s.work.srcPath ?? '' });
      if (w.textureId) targetFields.push({ k: 'material', t: 'val', get: () => s.work.textureId ?? '' });
      groups.push({ title: 'TARGET', fields: targetFields });

      if (w.model) {
        const binding = w.model;
        const opts = binding.family === 'figure' ? FIGURE_PAINT_TARGETS.slice() : VEHICLE_PART_IDS.slice();
        const painted = binding.family === 'figure'
          ? Object.keys((s.figures()?.characters[binding.docId] as any)?.paint ?? {})
          : Object.keys((s.vehicles()?.vehicles[binding.docId] as any)?.paint ?? {});
        groups.push({
          title: `PART · ${binding.docId.toUpperCase()}`,
          fields: [
            {
              k: 'part', t: 'enum', opts: opts as string[],
              get: () => s.work.model?.part ?? opts[0],
              // the enum RETARGETS the bench — flush + slot laws ride open()
              set: (part) => {
                s.open(binding.family === 'figure'
                  ? { kind: 'figure-part', docId: binding.docId, part: part as any }
                  : { kind: 'vehicle-part', docId: binding.docId, part });
              },
            },
            { k: 'painted', t: 'val', get: () => (painted.length ? painted.join(', ') : 'none') },
          ],
        });
      } else {
        groups.push({
          title: 'CANVAS',
          fields: [
            { k: 'new blank canvas', t: 'act', tone: 'success', run: () => s.open({ kind: 'blank' }) },
            { k: 'hint', t: 'val', get: () => 'sizes + image load live in the SOURCE tab' },
          ],
        });
      }

      return { groups };
    },

    actions(): ActionSpec[] {
      // save/extract are the BENCH's verbs (they act on the canvas, and the
      // character lens mounts the bench without this hero) — the hero carries
      // the LIBRARY-row verbs for the subject the canvas came from
      const t = s.lastTarget;
      const out: ActionSpec[] = [];
      if (t?.kind === 'cutout') {
        out.push({ id: 'materialize', label: 'Materialize', icon: 'Hammer', run: () => s.materializeAsset(t.id) });
        out.push({ id: 'remove', label: 'Remove', icon: 'Trash2', run: () => s.removeEntry(t.id, 'cutout', s.work.name) });
      }
      if (t?.kind === 'document') {
        out.push({ id: 'remove', label: 'Remove', icon: 'Trash2', run: () => s.removeEntry(t.id, 'document', s.work.name) });
      }
      return out;
    },

    stage: (subject) => <PaintBench store={subject} />,
  };
}
