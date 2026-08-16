import { useEffect, useRef } from 'react';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { ModelPackage, ModelPart, ModelToolApi, ModelToolSnapshot, PrimitiveKind } from '../data/types';
import ModelView, { type PartRange } from './ModelView';
import { primitiveMeshData, composeModelParts, packageMeshDoc, packageMeshDocParts } from '../data/assetCatalog';
import { meshDocIsUnreadable } from '../data/meshDoc';
import { resolvePackageDir } from '../data/modelPackageStore';
import type { ModelOutlinerDragItem, ModelOutlinerDropTarget } from '../data/modelOutliner';
import type { LightRig } from '../model/editMesh';
import type { PaintLayoutKeepLiveOptions } from '../model/paintLayoutConflict';
import {
  EMPTY_MODEL_VIEW_RESIDENCY,
  advanceModelViewResidency,
} from '../model/partResidency';
import { modelDocumentSeed, type ModelDocumentSeed } from '../model/modelDocumentSeed';
import type { CharacterRigApi, CharacterRigSnapshot } from '../../../runtime/skeleton';
import type { RoleContractId } from '../data/roleNamer';
import { characterRigPackagePath } from '../skeleton/characterRigPackagePath';
import { hasCharacterRigCapability } from '../skeleton/characterRigCapability';
import { characterRigRangeObjectIds } from '../skeleton/characterRigOpen';
import { EXTERNAL_AUTO_RIG_PREVIEW_OVERLAY } from '../skeleton/externalAutoRig';
import {
  modelDocumentCharacterColdMountGate,
  modelDocumentColdMountGate,
  modelDocumentMountSource,
  modelDocumentResidentLeaseForLifecycle,
  modelDocumentRjmdSeedPresentation,
  modelDocumentViewLifecycleId,
  type ModelDocumentResidentLease,
} from '../model/modelDocumentColdMount';
import { MODEL_DOC_SESSION_PROTOCOL } from '../model/docSession';

// The outliner's part handlers, threaded from AppFrame (which owns state). Split from the
// live parts/active so Workspace + Stage can carry the stable handlers and Stage supplies
// the per-model parts from state.
export type OutlinerHandlers = {
  onSelectPart: (id: string) => void;
  /** Focus the Outliner owner of the live topology selection and preserve that selection. */
  onFocusSelectionOwner: () => void;
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
  // One-shot disk-authority result from a successful cold RJMD apply. Resumed
  // sessions and ordinary live edits never call this handler.
  onColdRjmdApplied: (modelId: string, modelSourceKey: string) => void;
  onPathPlaneCreated: (range: PartRange, kind?: 'plane' | 'edges') => void;
  // The guided role-naming pass (req_3263): while a session is live, part-row
  // clicks ASSIGN the current role instead of selecting. The strip shows the
  // role being asked for; skip passes a role the model doesn't have.
  roleNamer: { role: string; done: number; total: number; contract: string } | null;
  onStartRoleNamer: (contract: RoleContractId) => void;
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

export default function ModelDocumentSurface({ model, documentId, lights, textureSlots = [], triggerProps, onToolApi, onToolState, outliner, modelOnDisk, modelDirty, reloadRevision, onDiscardLive, onKeepLive, onRequireFirstSave, onDocumentMutated, onResidentModelReady, characterRigApi, characterRigSnapshot, onCharacterRigSnapshot, onCharacterRigStatus, characterRigViewportActive }: {
  model: ModelPackage | null;
  documentId: string;
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
  modelDirty: boolean;
  reloadRevision: number;
  onDiscardLive: () => void;
  onKeepLive: (options?: PaintLayoutKeepLiveOptions) => boolean;
  /** First save propagated by atlas creation — true, or the exact refusal (req_4551). */
  onRequireFirstSave: () => true | string;
  onDocumentMutated: () => void;
  /** Successful native adoption/resume for the visible model. The shell may
   * retain this opaque key for transactional capability attachment. */
  onResidentModelReady?: (modelId: string, modelSourceKey: string) => void;
  characterRigApi: CharacterRigApi | null;
  characterRigSnapshot: CharacterRigSnapshot | null;
  onCharacterRigSnapshot: (snapshot: CharacterRigSnapshot | null) => void;
  onCharacterRigStatus: (message: string) => void;
  characterRigViewportActive: boolean;
}) {
  const residencyRef = useRef(EMPTY_MODEL_VIEW_RESIDENCY);
  // Successful ModelView adoption is the sole authority for continuing an
  // in-place humanoid attachment before its first immutable character save.
  // The identity includes reloadRevision so Discard/reload cannot borrow the
  // resident exception that belonged to the previous document lifetime.
  const residentViewRef = useRef<ModelDocumentResidentLease | null>(null);
  const openedRigRef = useRef<{ modelId: string; sessionId: string } | null>(null);
  const residentRigSourceKeyRef = useRef<string | null>(null);
  const hasCharacterRig = Boolean(model && hasCharacterRigCapability(model));
  const viewLifecycleId = modelDocumentViewLifecycleId(documentId, model?.id, reloadRevision);
  // Reconciliation happens during render, before any mount gate can consult the
  // lease. Effects are too late: A -> blocked B -> A can occur before B ever
  // publishes a resident callback, and must not resurrect A's old permission.
  residentViewRef.current = modelDocumentResidentLeaseForLifecycle(
    residentViewRef.current,
    viewLifecycleId,
  );
  useEffect(() => {
    openedRigRef.current = null;
    residentRigSourceKeyRef.current = null;
  }, [documentId, model?.id, reloadRevision]);
  useEffect(() => {
    if (!model || !hasCharacterRig || !characterRigApi || !characterRigSnapshot) return;
    const opened = openedRigRef.current;
    const currentNative = characterRigApi.currentSnapshot?.() ?? null;
    const currentTarget = characterRigApi.currentOpenTarget?.() ?? null;
    const ownsSnapshot = opened?.modelId === model.id && opened.sessionId === characterRigSnapshot.sessionId;
    const recoveredRetry = currentNative?.sessionId === characterRigSnapshot.sessionId &&
      currentTarget?.modelId === model.id && currentTarget.documentId === documentId &&
      currentTarget.modelSourceKey === residentRigSourceKeyRef.current;
    if (!ownsSnapshot && !recoveredRetry) return;
    if (recoveredRetry && !ownsSnapshot) {
      // Retry Open lives in the inspector but replays this surface's immutable
      // payload. Adopt that recovered native identity before activating overlays.
      openedRigRef.current = { modelId: model.id, sessionId: characterRigSnapshot.sessionId };
    }
    try {
      onCharacterRigSnapshot(characterRigApi.command({
        kind: 'setViewportActive',
        active: characterRigViewportActive,
      }));
    } catch (error) {
      onCharacterRigStatus(error instanceof Error ? error.message : String(error));
    }
  }, [documentId, model?.id, hasCharacterRig, characterRigSnapshot?.sessionId, characterRigViewportActive]);
  // A missing document destroys its ModelView immediately. Outliner presence does
  // not: an ordinary single-mesh resident may gain its first body row during an
  // in-place rig attach without ceasing to be the same adopted native document.
  if (!model) {
    residentViewRef.current = null;
    residencyRef.current = advanceModelViewResidency(
      residencyRef.current,
      null,
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

  const mountIdentity = viewLifecycleId!;
  const modelViewKey = `${mountIdentity}:mount-v${MODEL_DOC_SESSION_PROTOCOL}`;
  const packageDir = resolvePackageDir(model.kind, model.id);
  const packageDoc = packageMeshDoc(model);
  const readablePackageDoc = packageDoc && packageDoc.vertices.length >= 8 ? packageDoc : null;
  const characterGeometryPath = model.skeleton?.meshes?.kind === 'skinned'
    ? model.skeleton.meshes.geometryPath
    : undefined;
  const residentContinuation = residentViewRef.current?.lifecycleId === mountIdentity;

  // The ordinary RJMD reader has three states: readable, absent, and present but
  // unreadable. Only absence may proceed to seed/file compatibility sources. A
  // character-capable package uses its manifest-declared immutable geometry
  // artifact instead, so a legacy mesh/doc.blob does not participate in that path.
  const coldMountGate = hasCharacterRig
    ? modelDocumentCharacterColdMountGate({
        packageDir,
        geometryPath: characterGeometryPath,
        immutableDocumentReadable: readablePackageDoc !== null,
        // The exception exists only before the first character artifact is
        // declared. Once geometryPath exists, its integrity wins immediately.
        residentContinuation: residentContinuation && !characterGeometryPath,
      })
    : modelDocumentColdMountGate(
        packageDir,
        packageDir ? meshDocIsUnreadable(packageDir) : false,
      );
  if (coldMountGate.kind === 'blocked') {
    residentViewRef.current = null;
    residencyRef.current = advanceModelViewResidency(residencyRef.current, model.id, false, false);
    return (
      <C.HW_ModelDocument>
        <C.HW_ModelDocEmpty>
          <Icon name="FileWarning" size={18} color={accentFor('error')} />
          <C.HW_StageSocketTitle>{coldMountGate.title}</C.HW_StageSocketTitle>
          <C.HW_StatusText>{coldMountGate.artifactPath}</C.HW_StatusText>
          <C.HW_StatusText>{coldMountGate.detail}</C.HW_StatusText>
          <C.HW_StatusText>{coldMountGate.recovery}</C.HW_StatusText>
        </C.HW_ModelDocEmpty>
      </C.HW_ModelDocument>
    );
  }

  const openCharacterRig = (modelSourceKey: string) => {
    residentRigSourceKeyRef.current = modelSourceKey;
    if (!hasCharacterRig) return;
    if (!model.skeleton) {
      onCharacterRigSnapshot(null);
      onCharacterRigStatus('character readiness failed — the package has no skeleton');
      return;
    }
    if (!characterRigApi?.available()) {
      onCharacterRigSnapshot(null);
      onCharacterRigStatus('character rig host is unavailable — restart into the rebuilt editor');
      return;
    }
    try {
      const currentTarget = characterRigApi.currentOpenTarget?.() ?? null;
      const currentSnapshot = characterRigApi.currentSnapshot?.() ?? null;
      if (currentTarget?.documentId === documentId && currentTarget.modelId === model.id &&
          currentTarget.modelSourceKey === modelSourceKey && currentSnapshot) {
        // attach-humanoid opens the candidate session before committing the
        // capability. When that commit makes onResidentModel appear, adopt the
        // exact transaction result instead of reopening and creating a second
        // failure edge after the package has already changed.
        openedRigRef.current = { modelId: model.id, sessionId: currentSnapshot.sessionId };
        onCharacterRigSnapshot(currentSnapshot);
        return;
      }
      const rangeObjectIds = characterRigRangeObjectIds(
        outliner?.parts,
        model.skeleton.characterRig!.objectBindings,
      );
      let opened = characterRigApi.open({
        documentId,
        modelId: model.id,
        packagePath: characterRigPackagePath(model),
        modelSourceKey,
        rangeObjectIds,
        skeletonJson: JSON.stringify(model.skeleton),
        descriptor: model.skeleton.characterRig,
      });
      if (model.skeleton.characterRig.externalProvenance) {
        opened = characterRigApi.command({
          kind: 'setOverlay',
          overlay: EXTERNAL_AUTO_RIG_PREVIEW_OVERLAY,
        });
      }
      openedRigRef.current = { modelId: model.id, sessionId: opened.sessionId };
      onCharacterRigSnapshot(opened);
    } catch (error) {
      onCharacterRigSnapshot(null);
      onCharacterRigStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const characterViewProps = hasCharacterRig
    ? {
        characterRigMode: characterRigViewportActive && characterRigSnapshot !== null,
        characterRigSpecimenSeparation: characterRigSnapshot?.specimenSeparation ?? 0,
        characterRigBound: characterRigSnapshot?.state === 'bound',
        characterRigBindVisible: characterRigSnapshot?.overlay.bindMesh ?? true,
        characterRigDeformedVisible: characterRigSnapshot?.overlay.deformedMesh ?? true,
        onResidentModel: openCharacterRig,
        onCharacterRigVertexPress: (viewportX: number, viewportY: number) => {
          if (!characterRigApi || characterRigSnapshot === null) return;
          try {
            onCharacterRigSnapshot(characterRigApi.command({ kind: 'selectVertex', viewportX, viewportY }));
          } catch (error) {
            onCharacterRigStatus(error instanceof Error ? error.message : String(error));
          }
        },
        onCharacterRigJointTransform: (boneIndex: number, transform: {
          pos: [number, number, number];
          rot: [number, number, number, number];
          scale: [number, number, number];
        }) => {
          const bone = characterRigSnapshot?.bones[boneIndex];
          if (!characterRigApi || !bone) return;
          try {
            onCharacterRigSnapshot(characterRigApi.command({
              kind: 'setJointTransform',
              boneId: bone.id,
              transform,
              preserveChildren: bone.parent !== null && transform.pos.some((value, axis) =>
                Math.abs(value - bone.transform.pos[axis]!) > 1e-7),
            }));
            onDocumentMutated();
          } catch (error) {
            onCharacterRigStatus(error instanceof Error ? error.message : String(error));
          }
        },
      }
    : {};
  const residentReadyProps = {
    onResidentReady: (modelSourceKey: string) => {
      residentViewRef.current = { lifecycleId: mountIdentity, sourceKey: modelSourceKey };
      residencyRef.current = { modelId: model.id, established: true };
      onResidentModelReady?.(model.id, modelSourceKey);
    },
  };

  // Resolve durable-vs-import ownership before branching. A retained sourcePath is
  // provenance/seed data only after the first save; it can never outrank a readable
  // package document (or its durable semantic membership) on reopen.
  const fileBase = outliner?.parts.find((p) => p.sourcePath);
  const mountSource = modelDocumentMountSource(readablePackageDoc, fileBase?.sourcePath);

  // FILE-BACKED multi-part model: only a package with no durable RJMD may parse
  // the original .glb/.obj on mount. Other primitive parts replay as appends.
  if (outliner && fileBase?.sourcePath && mountSource.kind === 'file') {
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
          key={modelViewKey}
          initialTitle={model.name}
          initialFileParts={{ path: fileBase.sourcePath, basePartId: fileBase.id, baseColor: fileBase.color, baseHidden: !fileBase.visible, appends }}
          allowFilePicker={false} trackAttribution={false} hostChrome onToolApi={onToolApi} onToolState={onToolState} paintTarget={{ kind: model.kind, id: model.id, name: model.name }} paintTargetOnDisk={modelOnDisk} documentDirty={modelDirty} onDiscardLive={onDiscardLive} onKeepLive={onKeepLive} onRequireFirstSave={onRequireFirstSave} onDocumentMutated={onDocumentMutated}
          authoredLights={lights} textureSlots={textureSlots}
          {...residentReadyProps}
          {...characterViewProps}
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
    const mountDoc = mountSource.kind === 'rjmd' ? mountSource.document : null;
    // A cold RJMD native apply and the shell's subsequent Outliner hydration must
    // consume the same saved rank projection. Hot rows can belong to a discarded
    // resident and therefore never supply cold visibility or colour.
    const savedPresentation = mountDoc
      ? modelDocumentRjmdSeedPresentation({
          ranges: mountDoc.ranges,
          rangeObjectIds: mountDoc.rangeObjectIds,
          savedParts: packageMeshDocParts(model) ?? [],
          fallbackColor: '#8fb6c9',
        })
      : null;
    const partColors = mountDoc
      ? savedPresentation!.partColors
      : composed.ranges.map((r) => ({ lo: r.lo, hi: r.hi, color: outliner!.parts.find((p) => p.id === r.id)?.color ?? '#8fb6c9' }));
    // The viewer is keyed on the MODEL id only (stable) — host-authoritative. The seed
    // (meshdoc or composed parts) is loaded once on mount; every later part op
    // (add/hide/delete) mutates the host mesh in place (no remount, no JS recompose), so
    // edits persist. A remount happens only on a real doc switch.
    const seed = mountDoc
      ? {
          ...modelDocumentSeed(model.id, model.name, mountDoc),
          partColors,
          hiddenRanges: savedPresentation!.hiddenRanges,
        }
      : composed.positions.length > 0
        ? {
            source: 'composed' as const,
            key: model.id,
            name: model.name,
            vertices: composed.positions,
            count: Math.floor(composed.positions.length / 8),
            faceGroups: composed.faceGroups,
            semanticRegions: composed.semanticRegions,
            semanticInstances: composed.semanticInstances,
            semanticTable: composed.semanticTable,
            logicalVertexCount: composed.logicalVertexCount,
            renderCornerLogicalIds: composed.renderCornerLogicalIds,
            partColors,
          }
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
    if (!residencyRef.current.established) residentViewRef.current = null;
    const modelView = residencyRef.current.established ? (
      <ModelView
        key={modelViewKey}
        initialTitle={model.name}
        initialMesh={seed ?? undefined}
        allowFilePicker={false} trackAttribution={false} hostChrome onToolApi={onToolApi} onToolState={onToolState} paintTarget={{ kind: model.kind, id: model.id, name: model.name }} paintTargetOnDisk={modelOnDisk} documentDirty={modelDirty} onDiscardLive={onDiscardLive} onKeepLive={onKeepLive} onRequireFirstSave={onRequireFirstSave} onDocumentMutated={onDocumentMutated}
        authoredLights={lights} textureSlots={textureSlots}
        {...residentReadyProps}
        {...characterViewProps}
        onColdRjmdApplied={(modelSourceKey) => outliner!.onColdRjmdApplied(model.id, modelSourceKey)}
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
      ? <ModelView key={modelViewKey} initialPath={viewer.path} initialTitle={model.name} allowFilePicker={false} trackAttribution={false} hostChrome onToolApi={onToolApi} onToolState={onToolState} paintTarget={{ kind: model.kind, id: model.id, name: model.name }} paintTargetOnDisk={modelOnDisk} documentDirty={modelDirty} onDiscardLive={onDiscardLive} onKeepLive={onKeepLive} onRequireFirstSave={onRequireFirstSave} onDocumentMutated={onDocumentMutated} authoredLights={lights} textureSlots={textureSlots} {...residentReadyProps} {...characterViewProps} />
      : <ModelView key={modelViewKey} initialTitle={model.name} initialMesh={viewer} allowFilePicker={false} trackAttribution={false} hostChrome onToolApi={onToolApi} onToolState={onToolState} paintTarget={{ kind: model.kind, id: model.id, name: model.name }} paintTargetOnDisk={modelOnDisk} documentDirty={modelDirty} onDiscardLive={onDiscardLive} onKeepLive={onKeepLive} onRequireFirstSave={onRequireFirstSave} onDocumentMutated={onDocumentMutated} authoredLights={lights} textureSlots={textureSlots} {...residentReadyProps} {...characterViewProps} />;
    return (
      <C.HW_ModelDocument {...triggerProps}>
        {modelView}
      </C.HW_ModelDocument>
    );
  }

  if (viewer && viewer.kind === 'missing') {
    residentViewRef.current = null;
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

  // The stored-data placeholder owns no ModelView. Keep this explicit even
  // though today's resolver normally returns a typed missing result, so a future
  // metadata-only package cannot inherit an earlier adoption lease.
  residentViewRef.current = null;
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
    return { kind: 'mesh', source: 'primitive', key: `primitive:${model.primitive}:${model.id}`, name: model.name, vertices: built.positions, count: Math.floor(built.positions.length / 8), faceGroups: built.faceGroups };
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
