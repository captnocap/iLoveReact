// Public character-rig session contracts. The native session owns topology,
// weights, inverse binds, overlays, heatmaps, selection, and test poses; React
// receives only these compact control/status records.

import type {
  BoneFitMetadata,
  BoneId,
  CharacterObjectBinding,
  CharacterRigDescriptor,
  HumanoidSemanticBinding,
  HumanoidSemanticRole,
  HumanoidSide,
  Joint,
  Quat,
  SkinBindingRef,
  Transform,
  Vec3,
} from './schema';

export type CharacterRigOverlay = {
  bindMesh: boolean;
  deformedMesh: boolean;
  axes: boolean;
  names: boolean;
  heatmap: boolean;
};

export type CharacterRigTestPoseName =
  | 'bind'
  | 'shoulder_abduction'
  | 'elbow_flex'
  | 'wrist_flex'
  | 'hip_flex'
  | 'knee_flex'
  | 'selected_joint';

export type CharacterRigTestPose = {
  name: CharacterRigTestPoseName;
  side?: 'left' | 'right' | 'both';
  /** Required for selected_joint; otherwise the generated preset supplies it. */
  angleDeg?: number;
};

export type CharacterRigCommand =
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'setViewportActive'; active: boolean }
  | { kind: 'fitSkeleton' }
  | {
      kind: 'setJointTransform';
      boneId: BoneId;
      transform: Transform;
      /** Bind-fitting translation mode. Immediate child joint origins remain
       * fixed in model space so moving this joint changes segment lengths. */
      preserveChildren?: boolean;
    }
  | {
      kind: 'setJointGlobalTransform';
      boneId: BoneId;
      /** Absolute model-space joint origin. */
      origin: Vec3;
      /** Optional absolute model-space joint frame (xyzw). */
      frame?: Quat;
    }
  | { kind: 'setJointConstraint'; boneId: BoneId; joint: Joint }
  | { kind: 'setJointLock'; boneId: BoneId; locked: boolean }
  | { kind: 'mirrorJoints'; source: 'left' | 'right' }
  | {
      /** Uniformly scale an adopted external skeleton about the model origin.
       * The caller applies the same positive factor to the resident mesh; the
       * native session preserves stable palette IDs and logical weights. */
      kind: 'scaleExternalSkeleton';
      factor: number;
    }
  | {
      /** Bind one stable humanoid role to a generated bone without changing
       * the bone id used by RJSK palettes and hierarchy references. */
      kind: 'setSemanticBinding';
      boneId: BoneId;
      role: HumanoidSemanticRole;
      side?: HumanoidSide;
    }
  | { kind: 'setObjectBinding'; binding: CharacterObjectBinding }
  | {
      /** Adopt one SkinTokens result against the resident RJMD corner order.
       * Native code validates coordinates, folds corners back to logical
       * vertices, derives names/roles from the ordered model parts, and owns
       * the resulting draft weights. */
      kind: 'adoptExternalRig';
      partNames: string[];
      rig: {
        ok?: boolean;
        cls?: string | null;
        joints: Vec3[];
        parents: number[];
        vertices: Vec3[];
        skin_top4: Array<Array<[number, number]>>;
        seconds?: number;
      };
    }
  | { kind: 'autoBind' }
  | { kind: 'selectBone'; boneId: BoneId | null }
  | { kind: 'selectVertex'; viewportX: number; viewportY: number }
  | { kind: 'setOverlay'; overlay: Partial<CharacterRigOverlay> }
  | { kind: 'setTestPose'; pose: CharacterRigTestPose }
  /** Mount one motion document on the working body (req_4323): `clip:<id>`
   * for a built-in clip, otherwise a motion document path. The specimens play
   * it through the same role channels and constraint clamp the world mixer
   * uses; setTestPose stops it — two writers, one slot, last writer answers. */
  | { kind: 'mountExercise'; source: string }
  /** Park the exercise playhead at an exact time — the authoring scrub. A
   * negative time parks in place: only the native clock knows where a playing
   * exercise stands right now. */
  | { kind: 'parkExercise'; seconds: number }
  | { kind: 'resumeExercise' }
  | { kind: 'clearExercise' };

export type CharacterRigReadinessCheckId =
  | 'connected_body'
  | 'required_semantics'
  | 'canonical_skeleton'
  | 'current_topology_hash'
  | 'current_semantic_hash'
  | 'current_object_binding_hash'
  | 'saved_four_influence_weights';

export type CharacterRigReadinessCheck = {
  id: CharacterRigReadinessCheckId;
  status: 'ready' | 'blocked' | 'waiting' | 'stale';
  /** Compatibility convenience for the visual readiness matrix. Always equal
   * to `status === "ready"`; automation reasons from `status`. */
  ready: boolean;
  detail?: string;
};

export type CharacterRigBoneSnapshot = {
  id: BoneId;
  displayName: string;
  parent: BoneId | null;
  transform: Required<Transform>;
  tip?: Vec3;
  joint?: Joint;
  fit: BoneFitMetadata;
  /** Model-space distance from this origin to its first child origin, or to the
   * authored terminal tip when this is a leaf. Zero is reserved for `root`. */
  segmentLength: number;
};

export type CharacterRigInfluence = {
  /** Null is the inspectable RJSK 0xffff unused slot; its weight is always 0. */
  boneId: BoneId | null;
  weight: number;
};

export type CharacterRigVertexProbe = {
  logicalVertexId: number;
  renderDuplicateCount: number;
  modelPosition: Vec3;
  influences: [
    CharacterRigInfluence,
    CharacterRigInfluence,
    CharacterRigInfluence,
    CharacterRigInfluence,
  ];
};

/** Compact native-session history truth. The host owns the actual before/after
 * states; React only needs availability and depth for controls and command
 * routing. Undo/redo themselves are revision-pinned character-rig commands. */
export type CharacterRigHistory = {
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
};

/** Exact resident BODY connectivity summary. Face ids are lowered/displayed
 * triangle indices accepted by the model editor's one native selection path. */
export type CharacterRigBodyTopology = {
  componentCount: number;
  mainLogicalVertexCount: number;
  mainTriangleCount: number;
  detachedLogicalVertexCount: number;
  detachedTriangleCount: number;
  detachedFaceIndices: number[];
  /** False means the native snapshot capped its compact face-index payload; a
   * partial list must never be presented as "Select Detached". */
  detachedSelectionComplete: boolean;
};

export type CharacterRigSemanticRoleCount = {
  /** Stable persisted key: `pelvis` for center roles, `hand:left` for pairs. */
  key: string;
  faceCount: number;
};

/** Exact semantic coverage of the resident BODY object. Generic display roles
 * remain valid mesh metadata, but count as uncovered anatomy here. */
export type CharacterRigSemanticCoverage = {
  bodyFaceCount: number;
  coveredBodyFaceCount: number;
  uncoveredBodyFaceCount: number;
  missingRequiredRoles: string[];
  roleFaceCounts: CharacterRigSemanticRoleCount[];
  uncoveredFaceIndices: number[];
  uncoveredSelectionComplete: boolean;
};

export type CharacterRigBoundaryAuditEntry = {
  proximalRole: string;
  distalRole: string;
  sharedEdgeCount: number;
  componentCount: number;
  closedLoopCount: number;
  ragged: boolean;
  point?: Vec3;
  planeNormal?: Vec3;
  width?: number;
  perimeter?: number;
  planarity?: number;
  confidence?: number;
};

export type CharacterRigBoundaryAudit = {
  entries: CharacterRigBoundaryAuditEntry[];
  raggedCount: number;
};

export type CharacterRigWeightsSummary = {
  boneId: BoneId;
  vertices: number;
  totalWeight: number;
  bbox: [number, number, number, number, number, number] | null;
  maxWeightOutsideRole: number;
  bleedsInto: Array<{ role: string; totalWeight: number; maxWeight: number }>;
};

export type CharacterRigWeightsSymmetry = {
  tolerance: number;
  comparedVertices: number;
  unmatchedVertices: number;
  offenderCount: number;
  maxError: number;
  offenderVertexIds: number[];
  offenderListComplete: boolean;
};

export type CharacterRigBendTest = {
  test: Exclude<CharacterRigTestPoseName, 'bind' | 'selected_joint'>;
  side: 'left' | 'right' | 'both';
  maxDisplacement: number;
  volumeDelta: number | null;
  selfIntersections: number | null;
  creaseDepth: number;
  asymmetry: number | null;
  worstVertices: Array<{
    logicalVertexId: number;
    displacement: number;
    roles: string[];
    nearestJoint: BoneId;
  }>;
  /** A `both` request evaluates left and right independently so asymmetry and
   * failures stay attributable instead of being hidden in one combined pose. */
  sides: Array<{
    side: 'left' | 'right';
    maxDisplacement: number;
    volumeDelta: number | null;
    selfIntersections: number | null;
    creaseDepth: number;
    displacedVertices: number;
    worstVertexListComplete: boolean;
    worstVertices: Array<{
      logicalVertexId: number;
      displacement: number;
      roles: string[];
      nearestJoint: BoneId;
    }>;
  }>;
};

export type CharacterRigSkeletonInspection = {
  bones: Array<Pick<CharacterRigBoneSnapshot,
    'id' | 'parent' | 'tip' | 'joint' | 'fit' | 'segmentLength'> & {
      origin: Vec3;
      frame: Quat;
      localTransform: Required<Transform>;
    }>;
};

export type CharacterRigSelectionInspection = {
  selectedFaces: number;
  expectedFaces: number;
};

export type CharacterRigAttachPreflight = {
  accepted: boolean;
  candidateBodyObjectId: string;
  recommendedBodyObjectId: string;
  objects: Array<{
    objectId: string;
    rank: number;
    components: number;
    triangles: number;
    largestConnectedTriangles: number;
    largestConnectedVertices: number;
  }>;
};

export type CharacterRigInspectionQuery =
  | { kind: 'probe'; logicalVertexId: number }
  | { kind: 'boundaryAudit' }
  | { kind: 'weightsSummary'; boneId: BoneId }
  | { kind: 'weightsSymmetry'; tolerance?: number }
  | {
      kind: 'bendTest';
      test: CharacterRigBendTest['test'];
      side: CharacterRigBendTest['side'];
    }
  | { kind: 'skeleton' }
  | { kind: 'selectDetached' }
  | { kind: 'selectUncovered' };

export type CharacterRigInspection =
  | CharacterRigVertexProbe
  | CharacterRigBoundaryAudit
  | CharacterRigWeightsSummary
  | CharacterRigWeightsSymmetry
  | CharacterRigBendTest
  | CharacterRigSkeletonInspection
  | CharacterRigSelectionInspection;

/** The motion document currently mounted on the working body (req_4323). */
export type CharacterRigExercise = {
  /** `clip:<id>` for a built-in clip, otherwise the mounted document path. */
  source: string;
  name: string;
  durationSeconds: number;
  looping: boolean;
  /** False while parked; the native clock owns playback either way. */
  playing: boolean;
  /** Clock value when this snapshot was written; a playing exercise keeps
   * advancing natively between snapshots. */
  playheadSeconds: number;
  channelCount: number;
  /** Channels this body's role palette actually answers to. */
  matchedChannelCount: number;
};

export type CharacterRigSnapshot = {
  sessionId: string;
  revision: number;
  state: CharacterRigDescriptor['state'];
  /** Present only for a machine-generated draft. Manual adjustment preserves
   * this provenance until the rig is replaced. */
  externalProvenance: CharacterRigDescriptor['externalProvenance'] | null;
  /** Native rig overlays, picking, and joint gizmos are enabled only while the
   * editor has deliberately handed viewport input to this resident session. */
  viewportActive: boolean;
  /** Model-space distance between bind and deformed specimens, authored as
   * 1.25 times the resident character bounds width. */
  specimenSeparation: number;
  bodyTopology: CharacterRigBodyTopology | null;
  semanticCoverage: CharacterRigSemanticCoverage | null;
  selectedBoneId: BoneId | null;
  selectedVertex: CharacterRigVertexProbe | null;
  bones: CharacterRigBoneSnapshot[];
  semanticBindings: HumanoidSemanticBinding[];
  objectBindings: CharacterObjectBinding[];
  overlay: CharacterRigOverlay;
  testPose: CharacterRigTestPose;
  /** Null when the specimens display the static test pose instead. */
  exercise: CharacterRigExercise | null;
  history: CharacterRigHistory;
  readiness: CharacterRigReadinessCheck[];
  /** Ambient rebind debt. False for a never-bound draft; true as soon as a
   * resident or saved binding is invalidated by topology, anatomy, or object
   * ownership, and false again only after a successful bind. */
  weightsStale: boolean;
  fitNeedsReview: boolean;
  bindNeedsReview: boolean;
};

export type CharacterRigOpenPayload = {
  documentId: string;
  modelId: string;
  /** Package directory used only to cold-load the declared immutable RJSK. */
  packagePath: string;
  /** The resident native model source key, never a geometry array. */
  modelSourceKey: string;
  /** Stable object ids in the resident RJMD range order. Rank locates geometry;
   * these ids own character object identity across rename and reorder. */
  rangeObjectIds: string[];
  skeletonJson: string;
  descriptor?: CharacterRigDescriptor;
};

export type CharacterPreparedArtifact = {
  temporaryPath: string;
  artifactHash: string;
  byteLength: number;
};

/** One revision-pinned native snapshot shared by RJMD and RJSK export. */
export type CharacterSaveSnapshot = {
  sessionId: string;
  revision: number;
  logicalVertexCount: number;
  topologyHash: string;
  semanticHash: string;
  skeletonHash: string;
  objectBindingHash: string;
  geometry: CharacterPreparedArtifact;
  skin?: CharacterPreparedArtifact & { binding: SkinBindingRef };
  /** Native edited bind skeleton; manual transforms/constraints persist here. */
  skeleton: import('./schema').Skeleton;
  descriptor: CharacterRigDescriptor;
};

export type CharacterRigSessionRequest =
  | { op: 'preflightAttach'; payload: { rangeObjectIds: string[] } }
  | { op: 'open'; payload: CharacterRigOpenPayload }
  | { op: 'command'; sessionId: string; expectedRevision: number; payload: CharacterRigCommand }
  | { op: 'snapshot'; sessionId: string; expectedRevision?: number }
  | {
      op: 'inspect';
      sessionId: string;
      expectedRevision: number;
      payload: CharacterRigInspectionQuery;
    }
  | {
      op: 'commitSave';
      sessionId: string;
      expectedRevision: number;
      payload: { binding: SkinBindingRef | null };
    }
  | { op: 'prepareSave'; sessionId: string; expectedRevision: number }
  | { op: 'close'; sessionId: string; expectedRevision?: number };

export type CharacterRigSessionError = {
  ok: false;
  error: string;
  currentRevision?: number;
};

export type CharacterRigSessionReply<T> = { ok: true; value: T } | CharacterRigSessionError;

/** Typed coordinator passed through the editor shell. Implementations serialize
 * this protocol through the single revisioned `__character_rig_session` door. */
export interface CharacterRigApi {
  available(): boolean;
  /** Audit the resident object partition before attaching a descriptor. */
  preflightAttach(rangeObjectIds: string[]): CharacterRigAttachPreflight;
  open(payload: CharacterRigOpenPayload): CharacterRigSnapshot;
  /** Exact failure text from the most recent open attempt, if that attempt did
   * not produce a valid native snapshot. Optional for lightweight test/editor
   * adapters that do not own the native session lifecycle. */
  currentOpenFault?(): string | null;
  /** Replays the most recently supplied open payload. This is deliberately
   * distinct from command retry: revision-pinned commands are never retried. */
  retryOpen?(): CharacterRigSnapshot;
  /** Compact current value for render coordinators. This never polls native. */
  currentSnapshot?(): CharacterRigSnapshot | null;
  /** Identity of the payload that produced the currently accepted native
   * session. A failed attempt is never reported as active. */
  currentOpenTarget?(): Pick<CharacterRigOpenPayload, 'documentId' | 'modelId' | 'modelSourceKey'> | null;
  command(command: CharacterRigCommand): CharacterRigSnapshot;
  /** Traverse the native character-rig history as one revision-pinned step. */
  undo(): CharacterRigSnapshot;
  redo(): CharacterRigSnapshot;
  snapshot(): CharacterRigSnapshot;
  inspect<T extends CharacterRigInspection = CharacterRigInspection>(
    query: CharacterRigInspectionQuery,
  ): T;
  prepareSave(): CharacterSaveSnapshot;
  /** Acknowledge that the manifest cutover for this exact revision succeeded.
   * This updates durability percepts only; it is not an authored undo unit. */
  commitSave(binding: SkinBindingRef | null): CharacterRigSnapshot;
  close(): void;
}

/** Stable runtime pose payload associated with the session's palette order. */
export type CharacterLocalPose = {
  frameId: number;
  rootTranslation: Vec3;
  localRotations: Record<BoneId, Quat>;
};
