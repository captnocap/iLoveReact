import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { ModelPackage, ModelPart, ModelToolApi, ModelToolSnapshot, PrimitiveKind } from '../data/types';
import ModelView from './ModelView';
import { cookedMeshBlobData, cookedMeshRefForAsset, storedModelMeshData, storedModelFaceGroupData, primitiveMeshData, composeModelParts } from '../data/hmscAssetCatalog';

// The composed geometry changes (add/delete/hide/reorder a part) → the host mesh must
// reload. Renaming doesn't touch geometry, so it isn't in the signature (the outliner row
// updates without a viewer reload).
function partsSignature(parts: ModelPart[]): string {
  return parts.map((p) => `${p.id}:${p.visible ? 1 : 0}:${p.mesh.faces.length}`).join(',');
}

// The outliner's part handlers, threaded from AppFrame (which owns state). Split from the
// live parts/active so Workspace + Stage can carry the stable handlers and Stage supplies
// the per-model parts from state.
export type OutlinerHandlers = {
  onSelectPart: (id: string) => void;
  onToggleVisiblePart: (id: string) => void;
  onDeletePart: (id: string) => void;
  onAddPart: (kind: PrimitiveKind) => void;
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
  | { kind: 'mesh'; key: string; vertices: Float32Array; faceGroups?: Uint32Array }
  | { kind: 'missing'; title: string; label: string }
  | null;

export default function ModelDocumentSurface({ model, triggerProps, onToolApi, onToolState, outliner }: {
  model: ModelPackage | null;
  // Right-click trigger from the app-root context menu (useContextMenu lives in
  // AppFrame so the menu lands at the cursor — see ModelContextMenu). Spread onto
  // the surface so a right-click here opens it.
  triggerProps: { onRightClick: (e: { x: number; y: number }) => void };
  onToolApi: (api: ModelToolApi) => void;
  onToolState: (state: ModelToolSnapshot) => void;
  // Present only for multi-part (primitive-authored) models — drives the outliner and the
  // composed host mesh. Absent for imported single meshes (their outliner is a follow-up).
  outliner: OutlinerApi | null;
}) {
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

  // Multi-part model: compose the parts into one host mesh and reload when its geometry
  // signature changes. The outliner UI itself lives in the Model Focus panel (Inspector) —
  // here we only consume the parts to build the mesh. An imported/single model has no parts
  // and resolves the old way.
  const composed = outliner ? composeModelParts(outliner.parts) : null;

  if (composed) {
    // Every part hidden/deleted → nothing to draw (the outliner in Model Focus lets you add
    // or un-hide). A non-empty compose mounts the viewer keyed on the geometry signature.
    const modelView = composed.positions.length > 0 ? (
      <ModelView
        key={`${model.id}:${partsSignature(outliner!.parts)}`}
        initialTitle={model.name}
        initialMesh={{ key: `${model.id}:${partsSignature(outliner!.parts)}`, name: model.name, vertices: composed.positions, count: Math.floor(composed.positions.length / 8), faceGroups: composed.faceGroups }}
        allowFilePicker={false} trackAttribution={false} hostChrome onToolApi={onToolApi} onToolState={onToolState}
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
      ? <ModelView key={model.id} initialPath={viewer.path} initialTitle={model.name} allowFilePicker={false} trackAttribution={false} hostChrome onToolApi={onToolApi} onToolState={onToolState} />
      : <ModelView key={model.id} initialTitle={model.name} initialMesh={{ key: viewer.key, name: model.name, vertices: viewer.vertices, count: Math.floor(viewer.vertices.length / 8), faceGroups: viewer.faceGroups }} allowFilePicker={false} trackAttribution={false} hostChrome onToolApi={onToolApi} onToolState={onToolState} />;
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

// A cooked file path, resident cooked mesh, resident studio part, a typed
// "missing" placeholder, or null (no live viewer → the stored-data doc card).
function resolveViewer(model: ModelPackage): ViewerSource {
  // A freshly-authored primitive builds its geometry on the spot (cuboid → grouped soup),
  // keyed by the doc id so each new cube is its own resident mesh.
  if (model.primitive) {
    const built = primitiveMeshData(model.primitive);
    return { kind: 'mesh', key: `primitive:${model.primitive}:${model.id}`, vertices: built.positions, faceGroups: built.faceGroups };
  }
  if (model.viewerPath) return { kind: 'path', path: model.viewerPath };

  const meshRef = viewerMeshRefFor(model);
  if (meshRef) {
    const vertices = cookedMeshBlobData(meshRef);
    return vertices
      ? { kind: 'mesh', key: meshRef, vertices }
      : { kind: 'missing', title: 'MODEL TRIANGLE DATA MISSING', label: meshRef };
  }

  const storedModelId = viewerStoredModelId(model);
  if (storedModelId) {
    const vertices = storedModelMeshData(storedModelId);
    return vertices
      ? { kind: 'mesh', key: `studio:${storedModelId}`, vertices, faceGroups: storedModelFaceGroupData(storedModelId) ?? undefined }
      : { kind: 'missing', title: 'MODEL PART GEOMETRY MISSING', label: storedModelId };
  }

  return null;
}

function viewerMeshRefFor(model: ModelPackage): string | null {
  if (model.viewerMeshRef) return model.viewerMeshRef;
  const assetId = cookedAssetId(model);
  return assetId ? cookedMeshRefForAsset(assetId) : null;
}

function cookedAssetId(model: ModelPackage): string | null {
  if (model.sourceKind !== 'cooked-asset') return null;
  return model.id.startsWith('cooked:') ? model.id.slice('cooked:'.length) : model.id;
}

function viewerStoredModelId(model: ModelPackage): string | null {
  if (model.sourceKind !== 'studio-model') return null;
  return model.id.startsWith('studio:') ? model.id.slice('studio:'.length) : model.id;
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
