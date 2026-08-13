// Public contracts for the native three-layer capture session. A promoted
// snapshot always carries one immutable frame id through detection,
// reconstruction, and retargeting.

import type { BoneId, Quat, Vec3 } from './schema';

export type CameraKeypoint = {
  name: string;
  x: number;
  y: number;
  confidence: number;
};

export type DetectedLandmarkFrame = {
  frameId: number;
  timestampMs: number;
  keypoints: CameraKeypoint[];
};

export type SourceJointId =
  | 'shoulder_left' | 'shoulder_right'
  | 'elbow_left' | 'elbow_right'
  | 'wrist_left' | 'wrist_right'
  | 'hip_left' | 'hip_right'
  | 'knee_left' | 'knee_right'
  | 'ankle_left' | 'ankle_right'
  | 'shoulder_center' | 'hip_center' | 'spine' | 'head';

export type SourceJoint3D = {
  id: SourceJointId;
  position: Vec3;
  confidence: number;
};

export type SourceSkeletonFrame = {
  frameId: number;
  joints: SourceJoint3D[];
};

export type TargetPoseFrame = {
  frameId: number;
  rootTranslation: Vec3;
  localRotations: Record<BoneId, Quat>;
};

/** Native FK origins for the capture target. Bind positions exist as soon as
 * the saved rig opens. Deformed positions are one transaction with `frameId`
 * and therefore remain pinned with the rest of a frozen capture triplet. */
export type TargetSkeletonBoneDiagnostic = {
  boneId: BoneId;
  parentBoneId: BoneId | null;
  bindPosition: Vec3;
  deformedPosition: Vec3 | null;
};

export type TargetSkeletonDiagnostic = {
  frameId: number | null;
  bones: TargetSkeletonBoneDiagnostic[];
};

export type LocalQuaternionPoseFrame = {
  version: 1;
  boneCount: number;
  frameId: number;
  rootTranslation: Vec3;
  /** Rows use the loader-returned stable bone-ID palette order. */
  localQuaternions: Quat[];
};

export type CaptureCalibrationStatus = {
  state: 'uncalibrated' | 'collecting' | 'calibrated' | 'failed';
  validFrameCount: number;
  requiredFrameCount: 30;
  deadlineMs?: number;
  detail?: string;
};

/** Live recording progress (req_4285). Null when no take is being recorded.
 * `truncated` reports dropped frames loudly instead of absorbing them. */
export type CaptureRecordingStatus = {
  frameCount: number;
  truncated: boolean;
} | null;

/** One persisted take: a content-addressed RJAN motion document on disk. */
export type CaptureRecordingResult = {
  path: string;
  frameCount: number;
  durationSeconds: number;
  truncated: boolean;
  revision: number;
};

export type CaptureSessionSnapshot = {
  sessionId: string;
  revision: number;
  frozen: boolean;
  depthSign: 1 | -1;
  calibration: CaptureCalibrationStatus;
  detected: DetectedLandmarkFrame | null;
  source: SourceSkeletonFrame | null;
  target: TargetPoseFrame | null;
  recording?: CaptureRecordingStatus;
  targetSkeleton: TargetSkeletonDiagnostic;
};

export type CaptureTarget = {
  geometryPath: string;
  skinPath: string;
  skeletonJson: string;
  /** V4L2 render source whose immutable frames feed native inference. */
  cameraSource: string;
  /** Native WorldLoader that presents the bind/deformed target diagnostic. */
  viewportNodeId: number;
};

export type CaptureSessionCommand =
  | { op: 'openTarget'; payload: CaptureTarget }
  | { op: 'calibrate' }
  | { op: 'freeze' }
  | { op: 'resume' }
  | { op: 'setDepthSign'; payload: { depthSign: 1 | -1 } }
  | { op: 'record' }
  | { op: 'recordStop'; payload: { directory: string; name: string } }
  | { op: 'poseKey' }
  | { op: 'snapshot' }
  | { op: 'close' };

/** The visible promoted pose as role-addressed bind-relative deltas — the
 * workbench's "add key from this pose" (req_4285). */
export type CapturePoseKeySample = {
  root: Vec3;
  channels: Record<string, Quat>;
};

export type CaptureSessionRequest = CaptureSessionCommand & {
  sessionId?: string;
  expectedRevision?: number;
};

export type CaptureSessionReply<T = CaptureSessionSnapshot> =
  | { ok: true; value: T }
  | { ok: false; error: string; currentRevision?: number };

export interface CaptureSessionApi {
  available(): boolean;
  openTarget(target: CaptureTarget): CaptureSessionSnapshot;
  calibrate(): CaptureSessionSnapshot;
  freeze(): CaptureSessionSnapshot;
  resume(): CaptureSessionSnapshot;
  setDepthSign(depthSign: 1 | -1): CaptureSessionSnapshot;
  record(): CaptureSessionSnapshot;
  recordStop(directory: string, name: string): CaptureRecordingResult;
  poseKey(): CapturePoseKeySample;
  snapshot(): CaptureSessionSnapshot;
  close(): void;
}
