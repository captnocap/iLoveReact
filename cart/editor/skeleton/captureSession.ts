// Editor coordinator for the native capture/retarget session.
//
// React retains only an opaque session id, its latest revision, and one compact
// diagnostic snapshot. Camera-frame ownership, landmark reconstruction,
// calibration, confidence recovery, constraint clamping, FK, and live pose
// publication stay behind __capture_session.

import type {
  CaptureSessionApi,
  CaptureSessionReply,
  CaptureSessionRequest,
  CaptureSessionSnapshot,
  CaptureTarget,
} from '../../../runtime/skeleton';
const CAMERA_KEYPOINT_IDS = [
  'nose', 'eye_left', 'eye_right', 'ear_left', 'ear_right',
  'shoulder_left', 'shoulder_right', 'elbow_left', 'elbow_right',
  'wrist_left', 'wrist_right', 'hip_left', 'hip_right',
  'knee_left', 'knee_right', 'ankle_left', 'ankle_right',
] as const;

const SOURCE_JOINT_IDS = [
  'shoulder_left', 'shoulder_right', 'elbow_left', 'elbow_right',
  'wrist_left', 'wrist_right', 'hip_left', 'hip_right',
  'knee_left', 'knee_right', 'ankle_left', 'ankle_right',
  'shoulder_center', 'hip_center', 'spine', 'head',
] as const;

function exactIdSet(actual: Set<string>, expected: readonly string[]): boolean {
  return actual.size === expected.length && expected.every((id) => actual.has(id));
}

function finiteVec3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((component) => Number.isFinite(component));
}

export type CaptureSessionDoor = (requestJson: string) => unknown;

export class CaptureSessionFault extends Error {
  readonly currentRevision?: number;

  constructor(message: string, currentRevision?: number) {
    super(message);
    this.name = 'CaptureSessionFault';
    this.currentRevision = currentRevision;
  }
}

function parseReply<T>(raw: unknown): CaptureSessionReply<T> {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as { ok?: unknown }).ok !== 'boolean') {
    throw new CaptureSessionFault('capture host returned a malformed reply');
  }
  return parsed as CaptureSessionReply<T>;
}

function layerFrameIds(snapshot: CaptureSessionSnapshot): number[] {
  return [snapshot.detected?.frameId, snapshot.source?.frameId, snapshot.target?.frameId, snapshot.targetSkeleton?.frameId]
    .filter((frameId): frameId is number => frameId !== undefined && frameId !== null);
}

/** The three diagnostic layers are one promoted transaction: either no frame
 * exists yet, or detection, reconstruction, and target pose are all present at
 * one identical frame id. */
export function captureSnapshotFrameId(snapshot: CaptureSessionSnapshot): number | null {
  const layers = [snapshot.detected, snapshot.source, snapshot.target];
  const populated = layers.filter((layer) => layer !== null).length;
  if (populated === 0) {
    if (snapshot.targetSkeleton?.frameId !== null && snapshot.targetSkeleton?.frameId !== undefined) {
      throw new CaptureSessionFault('target skeleton diagnostic has no promoted frame triplet');
    }
    return null;
  }
  if (populated !== layers.length) {
    throw new CaptureSessionFault('capture host returned a partial frame triplet');
  }
  const ids = layerFrameIds(snapshot);
  const first = ids[0];
  if (!Number.isInteger(first) || (first ?? -1) < 0 || ids.some((id) => id !== first)) {
    throw new CaptureSessionFault('capture diagnostic layers do not share one frame id');
  }
  return first!;
}

function requireSnapshot(
  value: CaptureSessionSnapshot,
  expectedSkeleton: CaptureSessionSnapshot['targetSkeleton'] | null,
): CaptureSessionSnapshot {
  if (!value || typeof value !== 'object' || typeof value.sessionId !== 'string' || value.sessionId.length === 0 ||
      !Number.isInteger(value.revision) || value.revision < 0 || typeof value.frozen !== 'boolean' ||
      (value.depthSign !== 1 && value.depthSign !== -1)) {
    throw new CaptureSessionFault('capture host returned a malformed snapshot');
  }
  const calibrationStates = new Set(['uncalibrated', 'collecting', 'calibrated', 'failed']);
  if (!value.calibration || !calibrationStates.has(value.calibration.state) || value.calibration.requiredFrameCount !== 30 ||
      !Number.isInteger(value.calibration.validFrameCount) || value.calibration.validFrameCount < 0 || value.calibration.validFrameCount > 30 ||
      (value.calibration.deadlineMs !== undefined && !Number.isFinite(value.calibration.deadlineMs))) {
    throw new CaptureSessionFault('capture host returned malformed calibration state');
  }
  const promotedFrameId = captureSnapshotFrameId(value);
  if (value.detected) {
    if (!Number.isFinite(value.detected.timestampMs) || !Array.isArray(value.detected.keypoints) ||
        value.detected.keypoints.length !== CAMERA_KEYPOINT_IDS.length) {
      throw new CaptureSessionFault('capture host returned malformed detected landmarks');
    }
    const names = new Set<string>();
    for (const point of value.detected.keypoints) {
      if (!point || typeof point.name !== 'string' || point.name.length === 0 || names.has(point.name) ||
          !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.confidence) ||
          point.confidence < 0 || point.confidence > 1) {
        throw new CaptureSessionFault('capture host returned malformed detected landmarks');
      }
      names.add(point.name);
    }
    if (!exactIdSet(names, CAMERA_KEYPOINT_IDS)) {
      throw new CaptureSessionFault('capture host returned an unstable landmark vocabulary');
    }
  }
  if (value.source) {
    if (!Array.isArray(value.source.joints) || value.source.joints.length !== SOURCE_JOINT_IDS.length) {
      throw new CaptureSessionFault('capture host returned malformed source skeleton');
    }
    const ids = new Set<string>();
    for (const joint of value.source.joints) {
      if (!joint || typeof joint.id !== 'string' || ids.has(joint.id) || !Array.isArray(joint.position) || joint.position.length !== 3 ||
          joint.position.some((component) => !Number.isFinite(component)) || !Number.isFinite(joint.confidence) ||
          joint.confidence < 0 || joint.confidence > 1) {
        throw new CaptureSessionFault('capture host returned malformed source skeleton');
      }
      ids.add(joint.id);
    }
    if (!exactIdSet(ids, SOURCE_JOINT_IDS)) {
      throw new CaptureSessionFault('capture host returned an unstable source-joint vocabulary');
    }
  }
  const skeleton = value.targetSkeleton;
  if (!skeleton || typeof skeleton !== 'object' || !Array.isArray(skeleton.bones) ||
      skeleton.bones.length < 1 || skeleton.bones.length > 255 ||
      (skeleton.frameId !== null && (!Number.isInteger(skeleton.frameId) || skeleton.frameId < 0)) ||
      skeleton.frameId !== promotedFrameId) {
    throw new CaptureSessionFault('capture host returned malformed target skeleton diagnostics');
  }
  const paletteIds = new Set<string>();
  for (let index = 0; index < skeleton.bones.length; index += 1) {
    const bone = skeleton.bones[index];
    if (!bone || typeof bone.boneId !== 'string' || bone.boneId.length === 0 || paletteIds.has(bone.boneId) ||
        (bone.parentBoneId !== null && (typeof bone.parentBoneId !== 'string' || !paletteIds.has(bone.parentBoneId))) ||
        !finiteVec3(bone.bindPosition) ||
        (promotedFrameId === null ? bone.deformedPosition !== null : !finiteVec3(bone.deformedPosition))) {
      throw new CaptureSessionFault('capture host returned malformed target skeleton diagnostics');
    }
    if (expectedSkeleton) {
      const expected = expectedSkeleton.bones[index];
      if (!expected || expected.boneId !== bone.boneId || expected.parentBoneId !== bone.parentBoneId) {
        throw new CaptureSessionFault('capture host changed the target palette');
      }
    }
    paletteIds.add(bone.boneId);
  }
  if (expectedSkeleton && expectedSkeleton.bones.length !== skeleton.bones.length) {
    throw new CaptureSessionFault('capture host changed the target palette');
  }
  if (value.target) {
    if (!Array.isArray(value.target.rootTranslation) || value.target.rootTranslation.length !== 3 ||
        value.target.rootTranslation.some((component) => !Number.isFinite(component)) ||
        !value.target.localRotations || typeof value.target.localRotations !== 'object') {
      throw new CaptureSessionFault('capture host returned malformed target pose');
    }
    const rotationIds = new Set(Object.keys(value.target.localRotations));
    if (rotationIds.size !== paletteIds.size || [...paletteIds].some((id) => !rotationIds.has(id))) {
      throw new CaptureSessionFault('capture host returned an unstable target palette');
    }
    for (const rotation of Object.values(value.target.localRotations)) {
      if (!Array.isArray(rotation) || rotation.length !== 4 || rotation.some((component) => !Number.isFinite(component))) {
        throw new CaptureSessionFault('capture host returned malformed target pose');
      }
      const lengthSquared = rotation.reduce((sum, component) => sum + component * component, 0);
      if (Math.abs(lengthSquared - 1) > 1e-3) throw new CaptureSessionFault('capture host returned a non-normalized target rotation');
    }
  }
  return value;
}

/** WorldLoader receives its native mount during the render pass after React
 * creates the node. Opening a target in that one-tick gap is retryable; all
 * artifact, palette, and session failures remain immediate hard errors. */
export function captureTargetMountPending(error: unknown): boolean {
  return error instanceof CaptureSessionFault &&
    (error.message.includes('WorldLoaderNotMounted') || error.message.includes('MountBackoff'));
}

/** Virtual native render source backed by the exact RGBA frame promoted with
 * the session's latest completed triplet. It updates atomically while live and
 * remains pinned when the session is frozen. */
export function captureSessionCameraRenderSource(sessionId: string): string {
  return `capture-session:${sessionId}:camera`;
}

/** The live camera feed is also the INFERENCE frame source: the camera pane's
 * RenderTarget is what keeps that feed mounted, so while the session is live
 * the pane must show the raw camera or submissions starve the moment the
 * first triplet promotes (req_4269 — the quarter-second-then-frozen capture).
 * The immutable promoted frame is displayed only while the session is
 * deliberately frozen — the one state where a pinned exact frame IS the
 * diagnostic and inference is meant to be idle. */
export function captureDisplayCameraSource(
  snapshot: CaptureSessionSnapshot | null,
  liveCameraSource: string,
): string {
  if (!snapshot || !snapshot.frozen || captureSnapshotFrameId(snapshot) === null) return liveCameraSource;
  return captureSessionCameraRenderSource(snapshot.sessionId);
}

function requireTarget(target: CaptureTarget): void {
  if (!target.geometryPath || !target.skinPath || !target.skeletonJson) {
    throw new CaptureSessionFault('capture target is missing saved rig artifacts');
  }
  if (!/^(?:cam:\d+|\/dev\/video\d+)$/.test(target.cameraSource)) {
    throw new CaptureSessionFault('capture source must be a V4L2 camera');
  }
  if (!Number.isInteger(target.viewportNodeId) || target.viewportNodeId < 1) {
    throw new CaptureSessionFault('capture target has no native diagnostic viewport');
  }
}

/** Revision-pinned capture API. Snapshot reads are intentionally unpinned: the
 * native inference worker may atomically promote a newer completed triplet at
 * any time. Mutating commands use the exact latest observed revision and are
 * never retried after a stale-revision refusal. */
export class NativeCaptureSessionApi implements CaptureSessionApi {
  private sessionId: string | null = null;
  private revision: number | null = null;
  private lastSnapshot: CaptureSessionSnapshot | null = null;

  constructor(private readonly resolveDoor: () => CaptureSessionDoor | undefined = () =>
    (globalThis as { __capture_session?: CaptureSessionDoor }).__capture_session) {}

  available(): boolean {
    return typeof this.resolveDoor() === 'function';
  }

  openTarget(target: CaptureTarget): CaptureSessionSnapshot {
    requireTarget(target);
    if (this.sessionId !== null) this.close();
    return this.acceptSnapshot(this.call<CaptureSessionSnapshot>({ op: 'openTarget', payload: target }));
  }

  calibrate(): CaptureSessionSnapshot {
    return this.command({ op: 'calibrate' });
  }

  freeze(): CaptureSessionSnapshot {
    return this.command({ op: 'freeze' });
  }

  resume(): CaptureSessionSnapshot {
    return this.command({ op: 'resume' });
  }

  setDepthSign(depthSign: 1 | -1): CaptureSessionSnapshot {
    return this.command({ op: 'setDepthSign', payload: { depthSign } });
  }

  snapshot(): CaptureSessionSnapshot {
    const { sessionId } = this.requireOpen();
    // Native inference advances the revision independently. An unpinned read is
    // the only legal way to observe that completed promotion.
    return this.acceptSnapshot(this.call<CaptureSessionSnapshot>({ op: 'snapshot', sessionId }));
  }

  close(): void {
    if (this.sessionId === null) return;
    const sessionId = this.sessionId;
    // Close is teardown, not an authoring mutation. It remains valid even when
    // inference promoted a revision after React's last compact poll.
    this.call<unknown>({ op: 'close', sessionId });
    this.clearLocal();
  }

  currentSnapshot(): CaptureSessionSnapshot | null {
    return this.lastSnapshot;
  }

  private command(request: Extract<CaptureSessionRequest, { op: 'calibrate' | 'freeze' | 'resume' | 'setDepthSign' }>): CaptureSessionSnapshot {
    const { sessionId, revision } = this.requireOpen();
    return this.acceptSnapshot(this.call<CaptureSessionSnapshot>({
      ...request,
      sessionId,
      expectedRevision: revision,
    }));
  }

  private call<T>(request: CaptureSessionRequest): T {
    const door = this.resolveDoor();
    if (typeof door !== 'function') throw new CaptureSessionFault('capture host is unavailable');
    let reply: CaptureSessionReply<T>;
    try {
      reply = parseReply<T>(door(JSON.stringify(request)));
    } catch (error) {
      if (error instanceof CaptureSessionFault) throw error;
      throw new CaptureSessionFault(`capture host reply could not be decoded: ${String(error)}`);
    }
    if (!reply.ok) throw new CaptureSessionFault(reply.error, reply.currentRevision);
    return reply.value;
  }

  private acceptSnapshot(snapshot: CaptureSessionSnapshot): CaptureSessionSnapshot {
    const checked = requireSnapshot(snapshot, this.lastSnapshot?.targetSkeleton ?? null);
    if (this.sessionId !== null && checked.sessionId !== this.sessionId) {
      throw new CaptureSessionFault('capture host changed session identity');
    }
    if (this.revision !== null && checked.revision < this.revision) {
      throw new CaptureSessionFault('capture host revision moved backwards');
    }
    this.sessionId = checked.sessionId;
    this.revision = checked.revision;
    this.lastSnapshot = checked;
    return checked;
  }

  private requireOpen(): { sessionId: string; revision: number } {
    if (this.sessionId === null || this.revision === null) {
      throw new CaptureSessionFault('capture session is not open');
    }
    return { sessionId: this.sessionId, revision: this.revision };
  }

  private clearLocal(): void {
    this.sessionId = null;
    this.revision = null;
    this.lastSnapshot = null;
  }
}

export function createCaptureSessionApi(
  resolveDoor?: () => CaptureSessionDoor | undefined,
): NativeCaptureSessionApi {
  return new NativeCaptureSessionApi(resolveDoor);
}
