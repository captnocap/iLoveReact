import { useRef } from 'react';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { ModelPackage, ModelPart, ModelToolApi, ModelToolSnapshot, PrimitiveKind } from '../data/types';
import ModelView, { type PartRange } from './ModelView';
import { primitiveMeshData, composeModelParts, packageMeshDoc } from '../data/assetCatalog';
import { meshDocHiddenRanges } from '../data/meshDoc';
import type { ModelOutlinerDragItem, ModelOutlinerDropTarget } from '../data/modelOutliner';
import type { LightRig } from '../model/editMesh';
import {
  EMPTY_MODEL_VIEW_RESIDENCY,
  advanceModelViewResidency,
} from '../model/partResidency';
import { modelDocumentSeed, type ModelDocumentSeed } from '../model/modelDocumentSeed';

// The outliner's part handlers, threaded from AppFrame (which owns state). Split from the
// live parts/active so Workspace + Stage can carry the stable handlers and Stage supplies
// the per-model parts from state.
export type OutlinerHandlers = {
  onSelectPart: (id: string) => void;
  onRenamePart: (id: string, name: string) => void;
  onToggleVisiblePart: (id: string) => void;
  onDeletePart: (id: string) => void;
  // Organizational folders reference part ids only; none of these verbs fuse topology.
  onSelectPartGroup: (groupId: string) => void;
  onRenamePartGroup: (groupId: string, name: string) => void;
  onToggleVisiblePartGroup: (groupId: string) => void;
  onDuplicatePartGroup: (groupId: string) => void;
  onDissolvePartGroup: (groupId: string) => void;
  onGroupSelectedParts: () => void;
  onUngroupSelectedParts: () => void;
  onMoveOutlinerItem: (item: ModelOutlinerDragItem, target: ModelOutlinerDropTarget) => void;
  onAddPart: (kind: PrimitiveKind) => void;
  // Duplicate a part in place (host copies geometry + paint; the row gains a twin).
  onDuplicatePart: (id: string) => void;
  // Open the library picker — append a saved model into this model as new part(s).
  onImportModel: () => void;
  // A file-backed mount reports where each part landed in the host mesh (the import's
  // range is only known after the host parses the file) — AppFrame stamps lo/hi.
  onStampRanges: (modelId: string, ranges: PartRange[]) => void;
  onPathPlaneCreated: (range: PartRange, kind?: 'plane' | 'edges') => void;
  // The guided role-naming pass (req_3263): while a session is live, part-row
  // clicks ASSIGN the current role instead of selecting. The strip shows the
  // role being asked for; skip passes a role the model doesn't have.
  roleNamer: { role: string; done: number; total: number; contract: string } | null;
  onStartRoleNamer: (contract: 'head' | 'body' | 'car') => void;
  onSkipRole: () => void;
  onCancelRoleNamer: () => void;
};
export type OutlinerApi = OutlinerHandlers & {
  parts: ModelPart[];
  activePartId: string | null;
};

// The live viewer source for a model document: a file path, resident mesh data,
// or a "data missing" placeholder. Resolved once so the render branches stay flat.
// faceGroups (studio models only): one id per triangle so the host regroups the
// fan-triangulated soup back into the original authored faces.
type ViewerSource =
  | { kind: 'path'; path: string }
  | ({ kind: 'mesh' } & ModelDocumentSeed)
  | { kind: 'missing'; title: string; label: string }
  | null;

export default function ModelDocumentSurface({ model, lights, textureSlots = [], triggerProps, onToolApi, onToolState, outliner, modelOnDisk, onRequireFirstSave, onDocumentMutated }: {
  model: ModelPackage | null;
  lights: readonly LightRig[];
  /** Texture-slot table (Rig draft ?? manifest) — slots wearing a liveMaterial
   * become live material regions in the viewer (req_3397). */
  textureSlots?: readonly import('../data/types').ModelTextureSlot[];
  // Right-click trigger from the app-root context menu (useContextMenu lives in
  // AppFrame so the menu lands at the cursor — see ModelContextMenu). Spread onto
  // the surface so a right-click here opens it.
  triggerProps: { onRightClick: (e: { x: number; y: number }) => void };
  onToolApi: (api: ModelToolApi) => void;
  onToolState: (state: ModelToolSnapshot) => void;
  // Present only for multi-part (primitive-authored) models — drives the outliner and the
  // composed host mesh. Absent for imported single meshes (their outliner is a follow-up).
  outliner: OutlinerApi | null;
  modelOnDisk: boolean;
  onRequireFirstSave: () => boolean;
  onDocumentMutated: () => void;
}) {
  const residencyRef = useRef(EMPTY_MODEL_VIEW_RESIDENCY);
  // Leaving this model's multipart surface destroys its ModelView, so do not let a
  // later seedless document borrow the old native session merely because the shell
  // component itself stayed mounted.
  if (!model || !outliner) {
    residencyRef.current = advanceModelViewResidency(
      residencyRef.current,
      model?.id ?? null,
      false,
      false,
    );
  }
  // The model surface stays bland — its tools live in the editor toolbar and in
  // the app-root context menu (opened by right-click here), both mirroring the one
  // command registry. The viewer runs hostChrome (no floating buttons) and reports
  // its host-native tool state up so both surfaces highlight the active tool.
  if (!model) {
    return (
      <C.HW_ModelDocument>
        <C.HW_ModelDocEmpty>
          <Icon name="SearchX" size={18} color={accentFor('textFaint')} />
          <C.HW_StageSocketTitle>MODEL NOT FOUND</C.HW_StageSocketTitle>
        </C.HW_ModelDocEmpty>
      </C.HW_ModelDocument>
    );
  }

  // FILE-BACKED multi-part model: the base part is an imported .glb/.obj the host parses
  // on mount; the doc's other (primitive) parts replay as appends. The viewer reports each
  // part's landed range up through onStampRanges so the outliner's lo/hi stay host-true.
  const fileBase = outliner?.parts.find((p) => p.sourcePath);
  if (outliner && fileBase?.sourcePath) {
    const appends = outliner.parts
      .filter((p) => p !== fileBase && p.mesh && p.visible)
      .map((p) => {
        const geo = composeModelParts([{ ...p, visible: true }]);
        return { partId: p.id, color: p.color, positions: geo.positions, faceGroups: geo.faceGroups };
      })
      .filter((a) => a.positions.length > 0);
    return (
      <C.HW_ModelDocument {...triggerProps}>
        <ModelView
          key={`${model.id}:parts`}
          initialTitle={model.name}
          initialFileParts={{ path: fileBase.sourcePath, basePartId: fileBase.id, baseColor: fileBase.color, baseHidden: !fileBase.visible, appends }}
          allowFilePicker={false} trackAttribution={false} hostChrome onToolApi={onToolApi} onToolState={onToolState} paintTarget={{ kind: model.kind, id: model.id, name: model.name }} paintTargetOnDisk={modelOnDisk} onRequireFirstSave={onRequireFirstSave} onDocumentMutated={onDocumentMutated}
          authoredLights={lights} textureSlots={textureSlots}
          onPartRanges={(ranges) => outliner.onStampRanges(model.id, ranges)}
          onPathPlaneCreated={outliner.onPathPlaneCreated}
        />
      </C.HW_ModelDocument>
    );
  }

  // Multi-part model: compose the parts into one host mesh and reload when its geometry
  // signature changes. The outliner UI itself lives in the Model Focus panel (Inspector) —
  // here we only consume the parts to build the mesh. An imported/single model has no parts
  // and resolves the old way.
  const composed = outliner ? composeModelParts(outliner.parts) : null;

  if (composed) {
    // The mount SEED prefers the package's saved meshdoc over the parts' seed geometry
    // (req_2753): parts are metadata + a group range — their .mesh only knows the shape
    // they SPAWNED as, while every edit since lives in the host mesh, which save/autosave
    // journals into mesh/doc.blob. Composing seeds on remount was the bug that reopened a
    // touched-up model as bare primitives (and a restart, whose rows hydrate seedless from
    // the package, composed to NOTHING). Never-saved docs have no meshdoc and keep the
    // composed-seed mount. The saved doc always contains ALL parts; saved hidden ranges
    // are removed from the live draw only after that complete geometry is resident.
    const doc = packageMeshDoc(model);
    const mountDoc = doc && doc.vertices.length >= 8 ? doc : null;
    // Each part's group range → its outliner colour, so the viewer tints the parts on load.
    // Meshdoc ranges pair with rows by RANK (both ascend by lo — the parts.json contract).
    const rowsByLo = outliner!.parts.slice().sort((a, b) => ((a.lo ?? Number.MAX_SAFE_INTEGER) - (b.lo ?? Number.MAX_SAFE_INTEGER)));
    const partColors = mountDoc
      ? mountDoc.ranges.map((r, i) => ({ lo: r.lo, hi: r.hi, color: rowsByLo[i]?.color ?? '#8fb6c9' }))
      : composed.ranges.map((r) => ({ lo: r.lo, hi: r.hi, color: outliner!.parts.find((p) => p.id === r.id)?.color ?? '#8fb6c9' }));
    // The viewer is keyed on the MODEL id only (stable) — host-authoritative. The seed
    // (meshdoc or composed parts) is loaded once on mount; every later part op
    // (add/hide/delete) mutates the host mesh in place (no remount, no JS recompose), so
    // edits persist. A remount happens only on a real doc switch.
    const seed = mountDoc
      ? {
          ...modelDocumentSeed(model.id, model.name, mountDoc),
          partColors,
          hiddenRanges: meshDocHiddenRanges(mountDoc.ranges, rowsByLo),
        }
      : composed.positions.length > 0
        ? { key: model.id, name: model.name, vertices: composed.positions, count: Math.floor(composed.positions.length / 8), faceGroups: composed.faceGroups, partColors }
        : null;
    // `seed` is a BOOT input, not a liveness signal. Add From Library rows are
    // metadata + native group ranges, so deleting the original primitive can make
    // `composed` empty while the imported native geometry is still fully resident.
    // Keep the same keyed ModelView mounted for this continuous document lifetime.
    residencyRef.current = advanceModelViewResidency(
      residencyRef.current,
      model.id,
      true,
      Boolean(seed),
    );
    const modelView = residencyRef.current.established ? (
      <ModelView
        key={model.id}
        initialTitle={model.name}
        initialMesh={seed ?? undefined}
        allowFilePicker={false} trackAttribution={false} hostChrome onToolApi={onToolApi} onToolState={onToolState} paintTarget={{ kind: model.kind, id: model.id, name: model.name }} paintTargetOnDisk={modelOnDisk} onRequireFirstSave={onRequireFirstSave} onDocumentMutated={onDocumentMutated}
        authoredLights={lights} textureSlots={textureSlots}
        onPathPlaneCreated={outliner!.onPathPlaneCreated}
      />
    ) : (
      <C.HW_ModelDocEmpty>
        <Icon name="Boxes" size={18} color={accentFor('textFaint')} />
        <C.HW_StageSocketTitle>NO VISIBLE PARTS</C.HW_StageSocketTitle>
      </C.HW_ModelDocEmpty>
    );
    return (
      <C.HW_ModelDocument {...triggerProps}>
        {modelView}
      </C.HW_ModelDocument>
    );
  }

  const viewer = resolveViewer(model);

  if (viewer && (viewer.kind === 'path' || viewer.kind === 'mesh')) {
    const modelView = viewer.kind === 'path'
      ? <ModelView key={model.id} initialPath={viewer.path} initialTitle={model.name} allowFilePicker={false} trackAttribution={false} hostChrome onToolApi={onToolApi} onToolState={onToolState} paintTarget={{ kind: model.kind, id: model.id, name: model.name }} paintTargetOnDisk={modelOnDisk} onRequireFirstSave={onRequireFirstSave} onDocumentMutated={onDocumentMutated} authoredLights={lights} textureSlots={textureSlots} />
      : <ModelView key={model.id} initialTitle={model.name} initialMesh={viewer} importedTextureSourcePath={model.viewerPath} allowFilePicker={false} trackAttribution={false} hostChrome onToolApi={onToolApi} onToolState={onToolState} paintTarget={{ kind: model.kind, id: model.id, name: model.name }} paintTargetOnDisk={modelOnDisk} onRequireFirstSave={onRequireFirstSave} onDocumentMutated={onDocumentMutated} authoredLights={lights} textureSlots={textureSlots} />;
    return (
      <C.HW_ModelDocument {...triggerProps}>
        {modelView}
      </C.HW_ModelDocument>
    );
  }

  if (viewer && viewer.kind === 'missing') {
    return (
      <C.HW_ModelDocument>
        <C.HW_ModelDocEmpty>
          <Icon name="SearchX" size={18} color={accentFor('textFaint')} />
          <C.HW_StageSocketTitle>{viewer.title}</C.HW_StageSocketTitle>
          <C.HW_StatusText>{viewer.label}</C.HW_StatusText>
        </C.HW_ModelDocEmpty>
      </C.HW_ModelDocument>
    );
  }

  return (
    <C.HW_ModelDocument>
      <C.HW_ModelDocShell>
        <C.HW_ModelDocHeader>
          <C.HW_ModelDocThumb style={{ backgroundColor: model.color }} />
          <C.HW_ModelDocTitleBlock>
            <C.HW_ModelDocTitle numberOfLines={1} noWrap>{model.name}</C.HW_ModelDocTitle>
            <C.HW_ModelDocPath numberOfLines={1} noWrap>{model.path}</C.HW_ModelDocPath>
          </C.HW_ModelDocTitleBlock>
          <C.HW_Spacer />
          <C.HW_ModelDocBadge><C.HW_MaterialStat>{model.stage}</C.HW_MaterialStat></C.HW_ModelDocBadge>
        </C.HW_ModelDocHeader>
        <C.HW_ModelDocStats>
          <DocStat label="kind" value={model.semanticKind ?? model.kind} />
          <DocStat label="source" value={model.sourceKind ?? 'indexed'} />
          <DocStat label="tris" value={model.triangles > 0 ? formatCount(model.triangles) : '-'} />
          <DocStat label="atlases" value={String(model.atlases.length)} />
        </C.HW_ModelDocStats>
        <C.HW_ModelDocGrid>
          <C.HW_ModelDocPanel>
            <C.HW_ModelDocPanelHead>
              <Icon name="PackageCheck" size={13} color={accentFor('primary')} />
              <C.HW_GroupText>STORED MODEL DATA</C.HW_GroupText>
            </C.HW_ModelDocPanelHead>
            {[
              ['source model', model.source],
              ['rig data', model.rig],
              ['manifest', model.data],
              ['lods', String(model.lods)],
            ].map(([label, value]) => <DocRow key={label} label={label} value={value} />)}
          </C.HW_ModelDocPanel>
          <C.HW_ModelDocPanel>
            <C.HW_ModelDocPanelHead>
              <Icon name="Layers" size={13} color={accentFor('primary')} />
              <C.HW_GroupText>TEXTURE / ATLAS DATA</C.HW_GroupText>
            </C.HW_ModelDocPanelHead>
            {model.atlases.length ? model.atlases.map((atlas) => (
              <DocRow key={atlas.id} label={atlas.label} value={`${atlas.scope} / ${atlas.resolution}`} swatch={atlas.color} />
            )) : <DocRow label="atlas" value="none stored" />}
          </C.HW_ModelDocPanel>
        </C.HW_ModelDocGrid>
        <C.HW_ModelDocPanel>
          <C.HW_ModelDocPanelHead>
            <Icon name="Workflow" size={13} color={accentFor('primary')} />
            <C.HW_GroupText>DECOMPOSITION</C.HW_GroupText>
          </C.HW_ModelDocPanelHead>
          <C.HW_ChipRow>
            {model.decompositions.map((item) => (
              <C.HW_TraceChip key={item}><C.HW_MaterialStat>{item}</C.HW_MaterialStat></C.HW_TraceChip>
            ))}
          </C.HW_ChipRow>
        </C.HW_ModelDocPanel>
      </C.HW_ModelDocShell>
    </C.HW_ModelDocument>
  );
}

// Package document, imported file, fresh primitive, or a typed missing package.
function resolveViewer(model: ModelPackage): ViewerSource {
  // The package's saved model document beats every seed-shaped source (req_2753):
  // a saved-then-reopened model must show its EDITS, not re-arm its primitive seed.
  const doc = packageMeshDoc(model);
  if (doc && doc.vertices.length >= 8) {
    return { kind: 'mesh', ...modelDocumentSeed(model.id, model.name, doc) };
  }
  // A freshly-authored primitive builds its geometry on the spot (cuboid → grouped soup),
  // keyed by the doc id so each new cube is its own resident mesh.
  if (model.primitive) {
    const built = primitiveMeshData(model.primitive);
    return { kind: 'mesh', key: `primitive:${model.primitive}:${model.id}`, name: model.name, vertices: built.positions, count: Math.floor(built.positions.length / 8), faceGroups: built.faceGroups };
  }
  if (model.viewerPath) return { kind: 'path', path: model.viewerPath };
  return { kind: 'missing', title: 'MODEL PACKAGE GEOMETRY MISSING', label: `${model.path}/mesh` };
}

function DocStat({ label, value }: { label: string; value: string }) {
  return (
    <C.HW_ModelDocStat>
      <C.HW_StatValue>{value}</C.HW_StatValue>
      <C.HW_StatLabel>{label}</C.HW_StatLabel>
    </C.HW_ModelDocStat>
  );
}

function DocRow({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
  return (
    <C.HW_ModelDocRow>
      {swatch ? <C.HW_VariantSwatch style={{ backgroundColor: swatch }} /> : null}
      <C.HW_ToolLabel>{label}</C.HW_ToolLabel>
      <C.HW_ToolValue numberOfLines={1} noWrap>{value}</C.HW_ToolValue>
    </C.HW_ModelDocRow>
  );
}

function formatCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}
