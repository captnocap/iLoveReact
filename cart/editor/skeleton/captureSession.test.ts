// cart/editor/skeleton/captureSession.test.ts
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/skeleton/captureSession.test.ts --bundle \
//     --outfile=/tmp/capture-session.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli /tmp/capture-session.test.js

import { HUMANOID_V1_BONE_IDS, HUMANOID_V1_BONES, type CaptureSessionRequest, type CaptureSessionSnapshot, type CaptureTarget } from '../../../runtime/skeleton';
import { CaptureSessionFault, captureDisplayCameraSource, captureSessionCameraRenderSource, captureSnapshotFrameId, captureTargetMountPending, createCaptureSessionApi } from './captureSession';

let passed = 0;
let failed = 0;
const log = (globalThis as any).print ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function test(name: string, run: () => void) {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

const target: CaptureTarget = {
  geometryPath: 'models/player/mesh/character.rjmd',
  skinPath: 'models/player/mesh/skin.rjsk',
  skeletonJson: '{"id":"humanoid"}',
  cameraSource: '/dev/video2',
  viewportNodeId: 71,
};

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

function snapshot(revision: number, frameId: number | null = null): CaptureSessionSnapshot {
  return {
    sessionId: 'capture:one',
    revision,
    frozen: false,
    depthSign: 1,
    calibration: { state: 'calibrated', validFrameCount: 30, requiredFrameCount: 30 },
    detected: frameId === null ? null : {
      frameId,
      timestampMs: 1000,
      keypoints: CAMERA_KEYPOINT_IDS.map((name) => ({ name, x: 0.5, y: 0.5, confidence: 0.9 })),
    },
    source: frameId === null ? null : {
      frameId,
      joints: SOURCE_JOINT_IDS.map((id) => ({ id, position: [0, 0, 0], confidence: 0.9 })),
    },
    target: frameId === null ? null : {
      frameId,
      rootTranslation: [0, 0, 0],
      localRotations: Object.fromEntries(HUMANOID_V1_BONE_IDS.map((id) => [id, [0, 0, 0, 1]])),
    },
    targetSkeleton: {
      frameId,
      bones: HUMANOID_V1_BONES.map((bone, index) => ({
        boneId: bone.id,
        parentBoneId: bone.parent ?? null,
        bindPosition: [0, index * 0.1, 0],
        deformedPosition: frameId === null ? null : [index * 0.01, index * 0.1, 0],
      })),
    },
  };
}

function externalSnapshot(revision: number): CaptureSessionSnapshot {
  const ids = Array.from({ length: 53 }, (_, index) => `external_joint_${index}`);
  ids[1] = 'pelvis';
  ids[4] = 'head';
  return {
    ...snapshot(revision),
    targetSkeleton: {
      frameId: null,
      bones: ids.map((boneId, index) => ({
        boneId,
        parentBoneId: index === 0 ? null : ids[index - 1]!,
        bindPosition: [0, index * 0.01, 0],
        deformedPosition: null,
      })),
    },
  };
}

test('open and revision-pinned commands serialize through one door', () => {
  const requests: CaptureSessionRequest[] = [];
  let revision = 2;
  const api = createCaptureSessionApi(() => (json) => {
    const request = JSON.parse(json) as CaptureSessionRequest;
    requests.push(request);
    if (request.op === 'openTarget') return { ok: true, value: snapshot(revision) };
    if (request.op === 'setDepthSign') {
      assert(request.expectedRevision === revision, 'depth command omitted current revision');
      revision += 1;
      return { ok: true, value: { ...snapshot(revision), depthSign: request.payload.depthSign } };
    }
    if (request.op === 'freeze') {
      assert(request.expectedRevision === revision, 'freeze omitted current revision');
      revision += 1;
      return { ok: true, value: { ...snapshot(revision, 9), frozen: true } };
    }
    if (request.op === 'close') return { ok: true, value: null };
    throw new Error(`unexpected ${request.op}`);
  });
  api.openTarget(target);
  assert(api.setDepthSign(-1).depthSign === -1, 'depth sign did not round-trip');
  assert(api.freeze().frozen, 'freeze did not round-trip');
  assert(requests[0]?.op === 'openTarget' && requests[0].payload.cameraSource === '/dev/video2', 'open target lost camera identity');
  api.close();
});

test('snapshot reads may advance asynchronously without an expected revision', () => {
  let revision = 4;
  const api = createCaptureSessionApi(() => (json) => {
    const request = JSON.parse(json) as CaptureSessionRequest;
    if (request.op === 'openTarget') return { ok: true, value: snapshot(revision) };
    if (request.op === 'snapshot') {
      assert(request.expectedRevision === undefined, 'async snapshot was revision-pinned');
      revision = 8;
      return { ok: true, value: snapshot(revision, 42) };
    }
    if (request.op === 'close') return { ok: true, value: null };
    throw new Error(`unexpected ${request.op}`);
  });
  api.openTarget(target);
  assert(api.snapshot().revision === 8, 'newly promoted revision was not accepted');
  assert(captureSnapshotFrameId(api.currentSnapshot()!) === 42, 'promoted triplet lost its frame id');
  assert(captureSessionCameraRenderSource('capture:one') === 'capture-session:capture:one:camera', 'promoted camera source key drifted');
});

test('partial and cross-frame triplets fail at the host boundary', () => {
  const partial = { ...snapshot(1, 7), source: null };
  let partialFailed = false;
  try { captureSnapshotFrameId(partial); } catch { partialFailed = true; }
  assert(partialFailed, 'partial triplet was accepted');

  const mismatched = { ...snapshot(1, 7), target: { ...snapshot(1, 8).target!, frameId: 8 } };
  let mismatchFailed = false;
  try { captureSnapshotFrameId(mismatched); } catch { mismatchFailed = true; }
  assert(mismatchFailed, 'cross-frame diagnostics were accepted');
});

test('snapshot boundary rejects an incomplete stable target palette', () => {
  const malformed = snapshot(1, 7);
  delete (malformed.target!.localRotations as Record<string, unknown>)[HUMANOID_V1_BONE_IDS[23]];
  const api = createCaptureSessionApi(() => () => ({ ok: true, value: malformed }));
  let failedAtBoundary = false;
  try { api.openTarget(target); } catch { failedAtBoundary = true; }
  assert(failedAtBoundary, 'incomplete target palette crossed into React state');
});

test('external target keeps its complete 53-bone palette stable across snapshots', () => {
  let reads = 0;
  const api = createCaptureSessionApi(() => (json) => {
    const request = JSON.parse(json) as CaptureSessionRequest;
    if (request.op === 'openTarget') return { ok: true, value: externalSnapshot(1) };
    if (request.op === 'snapshot') {
      reads += 1;
      const next = externalSnapshot(2);
      if (reads > 1) next.targetSkeleton.bones[52]!.boneId = 'changed_after_open';
      return { ok: true, value: next };
    }
    throw new Error(`unexpected ${request.op}`);
  });
  assert(api.openTarget(target).targetSkeleton.bones.length === 53, 'external palette was forced onto the canonical count');
  assert(api.snapshot().targetSkeleton.bones[4]?.boneId === 'head', 'role-derived external identity was discarded');
  let driftRejected = false;
  try { api.snapshot(); } catch { driftRejected = true; }
  assert(driftRejected, 'external target palette changed after open');
});

test('only native WorldLoader mount lag is retryable', () => {
  assert(captureTargetMountPending(new CaptureSessionFault('capture target open rejected: WorldLoaderNotMounted')),
    'one-tick WorldLoader mount lag became a hard failure');
  assert(!captureTargetMountPending(new CaptureSessionFault('capture target open rejected: StaleSkinBinding')),
    'artifact failure entered the mount retry loop');
});

test('target bind origins exist before capture and deformed origins pin to the promoted frame', () => {
  const beforeCapture = snapshot(1);
  const api = createCaptureSessionApi(() => () => ({ ok: true, value: beforeCapture }));
  const opened = api.openTarget(target);
  assert(opened.targetSkeleton.frameId === null, 'bind-only diagnostic invented a frame id');
  assert(opened.targetSkeleton.bones.every((bone) => bone.deformedPosition === null), 'bind-only diagnostic exposed stale deformed origins');

  const crossFrame = snapshot(2, 11);
  crossFrame.targetSkeleton.frameId = 12;
  const mismatchedApi = createCaptureSessionApi(() => () => ({ ok: true, value: crossFrame }));
  let rejected = false;
  try { mismatchedApi.openTarget(target); } catch { rejected = true; }
  assert(rejected, 'cross-frame target skeleton diagnostics entered React state');
});

test('camera display stays on the live feed while tracking and pins the immutable frame only when frozen', () => {
  const liveSource = '/dev/video2';
  assert(captureDisplayCameraSource(snapshot(1), liveSource) === liveSource, 'bind-only snapshot retained a retired immutable camera');
  // A live promoted triplet must NOT retire the camera feed: the pane's
  // RenderTarget keeps the feed mounted and inference reads its frames.
  assert(
    captureDisplayCameraSource(snapshot(2, 11), liveSource) === liveSource,
    'live tracking replaced the camera feed and starved inference (req_4269)',
  );
  const pinned = snapshot(3, 11);
  pinned.frozen = true;
  assert(
    captureDisplayCameraSource(pinned, liveSource) === 'capture-session:capture:one:camera',
    'frozen session did not pin its immutable camera frame',
  );
  assert(captureDisplayCameraSource(null, liveSource) === liveSource, 'closed session did not return to the raw camera');
});

test('stale mutations fail visibly and are never retried', () => {
  let calls = 0;
  const api = createCaptureSessionApi(() => (json) => {
    const request = JSON.parse(json) as CaptureSessionRequest;
    calls += 1;
    if (request.op === 'openTarget') return { ok: true, value: snapshot(3) };
    return { ok: false, error: 'stale revision', currentRevision: 4 };
  });
  api.openTarget(target);
  let fault: CaptureSessionFault | null = null;
  try { api.calibrate(); } catch (error) { fault = error as CaptureSessionFault; }
  assert(fault?.message === 'stale revision' && fault.currentRevision === 4, 'stale detail was hidden');
  assert(calls === 2, `stale command was retried ${calls - 1} times`);
});

test('only camera sources and a mounted native viewport can open', () => {
  const api = createCaptureSessionApi(() => () => ({ ok: true, value: snapshot(0) }));
  let sourceFailed = false;
  try { api.openTarget({ ...target, cameraSource: 'screen:0' }); } catch { sourceFailed = true; }
  assert(sourceFailed, 'screen capture source entered the pose session');
  let viewportFailed = false;
  try { api.openTarget({ ...target, viewportNodeId: 0 }); } catch { viewportFailed = true; }
  assert(viewportFailed, 'unmounted diagnostic viewport entered the pose session');
});

log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILED`} (${passed} passed)`);
if (failed > 0) throw new Error(`${failed} capture session tests failed`);
