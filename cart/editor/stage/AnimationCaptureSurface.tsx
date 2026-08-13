// The character capture workbench: one native, revisioned capture session and
// three views of the exact same completed frame.
//
// React coordinates cameras, controls, and compact diagnostics only. It never
// reconstructs depth, derives rotations, clamps joints, runs FK, or stages a
// fallback skin. The host owns the immutable camera frame, detected landmarks,
// reconstructed source skeleton, target-local pose, and native target viewport.
//
// SELFSHOT law: only V4L2 cam:N or /dev/videoN sources enter this surface.

import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Graph, Pressable, Row, Text } from '@reactjit/primitives';
import { RenderTarget } from '../../../runtime/primitives';
import type {
  CaptureSessionSnapshot,
  SourceJoint3D,
  SourceJointId,
  TargetSkeletonBoneDiagnostic,
} from '../../../runtime/skeleton';
import type { ModelPackage } from '../data/types';
import { listPoseCameraDevices, requestPose, type PoseCameraDevice } from '../../../runtime/capture/pose';
import { C } from '../workspace.cls';
import { EDITOR_GAME_FILE, EDITOR_STORE_DIR } from './WorldEditorSurface';
import {
  CaptureSessionFault,
  captureDisplayCameraSource,
  captureSnapshotFrameId,
  captureTargetMountPending,
  createCaptureSessionApi,
} from '../skeleton/captureSession';
import { resolveCaptureTarget } from '../skeleton/captureTarget';
import MotionDock from './MotionDock';

const g: any = globalThis;

const CAPTURE_UI_TUNING = Object.freeze({
  snapshotPollMs: 50,
  viewportMountPollMs: 32,
  viewportMountMaxPolls: 120,
  targetMountRetryMs: 32,
  targetMountMaxPolls: 120,
  landmarkConfidence: 0.5,
  feedWidth: 360,
  feedHeight: 270,
  sourceWidth: 360,
  sourceHeight: 360,
  targetSkeletonWidth: 360,
  targetSkeletonHeight: 176,
  targetSkeletonGap: 18,
  diagnosticPadding: 24,
  sourceDepthX: 0.35,
  sourceDepthY: 0.15,
  markerSize: 7,
});

const DEFAULT_CAMERA_SOURCE = 'cam:0';
const CAMERA_SOURCE_STORE_KEY = 'editor.animation.cameraSource';
const DEFAULT_CAMERA: PoseCameraDevice = {
  index: 0,
  source: DEFAULT_CAMERA_SOURCE,
  name: 'Default camera',
  driver: '',
  bus: '',
};

const FACE = new Set(['nose', 'eye_left', 'eye_right', 'ear_left', 'ear_right']);
const LEGS = new Set(['hip_left', 'hip_right', 'knee_left', 'knee_right', 'ankle_left', 'ankle_right']);
const landmarkColor = (name: string): string => FACE.has(name) ? '#e8c14c' : LEGS.has(name) ? '#e8874c' : '#4cc9e8';

const SOURCE_EDGES: ReadonlyArray<readonly [SourceJointId, SourceJointId]> = [
  ['head', 'shoulder_center'],
  ['shoulder_center', 'spine'],
  ['spine', 'hip_center'],
  ['shoulder_left', 'shoulder_center'],
  ['shoulder_center', 'shoulder_right'],
  ['shoulder_left', 'elbow_left'],
  ['elbow_left', 'wrist_left'],
  ['shoulder_right', 'elbow_right'],
  ['elbow_right', 'wrist_right'],
  ['hip_left', 'hip_center'],
  ['hip_center', 'hip_right'],
  ['hip_left', 'knee_left'],
  ['knee_left', 'ankle_left'],
  ['hip_right', 'knee_right'],
  ['knee_right', 'ankle_right'],
];

type ProjectedJoint = SourceJoint3D & { x: number; y: number };
type ProjectedTargetBone = Pick<TargetSkeletonBoneDiagnostic, 'boneId' | 'parentBoneId'> & { x: number; y: number };

export function projectSourceJoints(joints: readonly SourceJoint3D[]): ProjectedJoint[] {
  if (joints.length === 0) return [];
  const raw = joints.map((joint) => ({
    joint,
    x: joint.position[0] - joint.position[2] * CAPTURE_UI_TUNING.sourceDepthX,
    y: -joint.position[1] - joint.position[2] * CAPTURE_UI_TUNING.sourceDepthY,
  }));
  const minX = Math.min(...raw.map((row) => row.x));
  const maxX = Math.max(...raw.map((row) => row.x));
  const minY = Math.min(...raw.map((row) => row.y));
  const maxY = Math.max(...raw.map((row) => row.y));
  const usableWidth = CAPTURE_UI_TUNING.sourceWidth - CAPTURE_UI_TUNING.diagnosticPadding * 2;
  const usableHeight = CAPTURE_UI_TUNING.sourceHeight - CAPTURE_UI_TUNING.diagnosticPadding * 2;
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min(usableWidth / spanX, usableHeight / spanY);
  const occupiedWidth = spanX * scale;
  const occupiedHeight = spanY * scale;
  const offsetX = (CAPTURE_UI_TUNING.sourceWidth - occupiedWidth) * 0.5;
  const offsetY = (CAPTURE_UI_TUNING.sourceHeight - occupiedHeight) * 0.5;
  return raw.map(({ joint, x, y }) => ({
    ...joint,
    x: offsetX + (x - minX) * scale,
    y: offsetY + (y - minY) * scale,
  }));
}

export function projectTargetSkeleton(
  bones: readonly TargetSkeletonBoneDiagnostic[],
  pose: 'bind' | 'deformed',
  width: number,
  height: number,
): ProjectedTargetBone[] {
  const positioned = bones.flatMap((bone) => {
    const position = pose === 'bind' ? bone.bindPosition : bone.deformedPosition;
    return position ? [{ bone, position }] : [];
  });
  if (positioned.length === 0) return [];
  const raw = positioned.map(({ bone, position }) => ({
    bone,
    x: position[0] - position[2] * CAPTURE_UI_TUNING.sourceDepthX,
    y: -position[1] - position[2] * CAPTURE_UI_TUNING.sourceDepthY,
  }));
  const minX = Math.min(...raw.map((row) => row.x));
  const maxX = Math.max(...raw.map((row) => row.x));
  const minY = Math.min(...raw.map((row) => row.y));
  const maxY = Math.max(...raw.map((row) => row.y));
  const padding = 16;
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const occupiedWidth = spanX * scale;
  const occupiedHeight = spanY * scale;
  const offsetX = (width - occupiedWidth) * 0.5;
  const offsetY = (height - occupiedHeight) * 0.5;
  return raw.map(({ bone, x, y }) => ({
    boneId: bone.boneId,
    parentBoneId: bone.parentBoneId,
    x: offsetX + (x - minX) * scale,
    y: offsetY + (y - minY) * scale,
  }));
}

function readStoredCameraSource(): string | null {
  try {
    const value = typeof g.__store_get === 'function' ? g.__store_get(CAMERA_SOURCE_STORE_KEY) : null;
    return typeof value === 'string' && /^(?:cam:\d+|\/dev\/video\d+)$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function persistCameraSource(source: string): void {
  try {
    if (typeof g.__store_set === 'function') g.__store_set(CAMERA_SOURCE_STORE_KEY, source);
  } catch { /* selection remains valid for this mounted session */ }
}

function errorMessage(error: unknown): string {
  if (error instanceof CaptureSessionFault) {
    return error.currentRevision === undefined
      ? error.message
      : `${error.message} (native revision ${error.currentRevision}; command was not retried)`;
  }
  return error instanceof Error ? error.message : String(error);
}

function PanelTitle(props: { index: string; title: string; detail: string; color: string }) {
  return (
    <Row style={{ height: 34, paddingLeft: 10, paddingRight: 10, alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#11151c', borderBottomWidth: 1, borderBottomColor: '#29313d' }}>
      <Text style={{ color: props.color, fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>
        {`${props.index} · ${props.title}`}
      </Text>
      <Text style={{ color: '#758090', fontSize: 9, fontFamily: 'monospace' }}>{props.detail}</Text>
    </Row>
  );
}

function SourceSkeletonDiagnostic(props: { snapshot: CaptureSessionSnapshot | null }) {
  const projected = useMemo(() => projectSourceJoints(props.snapshot?.source?.joints ?? []), [props.snapshot?.source]);
  const byId = useMemo(() => new Map(projected.map((joint) => [joint.id, joint])), [projected]);
  const segments = useMemo(() => SOURCE_EDGES.flatMap(([from, to]) => {
    const a = byId.get(from);
    const b = byId.get(to);
    return a && b ? [a.x, a.y, b.x, b.y] : [];
  }), [byId]);
  const confident = projected.filter((joint) => joint.confidence >= CAPTURE_UI_TUNING.landmarkConfidence).length;
  const zValues = projected.map((joint) => joint.position[2]);
  const depthSpan = zValues.length > 0 ? Math.max(...zValues) - Math.min(...zValues) : 0;

  return (
    <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 300, height: '100%', backgroundColor: '#090d13', borderRightWidth: 1, borderRightColor: '#252d38' }}>
      <PanelTitle index="2" title="SOURCE SKELETON" detail="calibrated 3D" color="#72e3b3" />
      <Col style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Box style={{ width: CAPTURE_UI_TUNING.sourceWidth, height: CAPTURE_UI_TUNING.sourceHeight, position: 'relative', backgroundColor: '#080b10', borderWidth: 1, borderColor: '#242d39', borderRadius: 6 }}>
          <Graph style={{ position: 'absolute', left: 0, top: 0, width: CAPTURE_UI_TUNING.sourceWidth, height: CAPTURE_UI_TUNING.sourceHeight }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
            {segments.length > 0 ? <Graph.Polyline segments points={segments} stroke="#67d6ae" strokeWidth={2.2} /> : null}
          </Graph>
          {projected.map((joint) => (
            <Box
              key={joint.id}
              style={{
                position: 'absolute',
                left: Math.round(joint.x - CAPTURE_UI_TUNING.markerSize / 2),
                top: Math.round(joint.y - CAPTURE_UI_TUNING.markerSize / 2),
                width: CAPTURE_UI_TUNING.markerSize,
                height: CAPTURE_UI_TUNING.markerSize,
                borderRadius: CAPTURE_UI_TUNING.markerSize / 2,
                backgroundColor: joint.confidence >= CAPTURE_UI_TUNING.landmarkConfidence ? '#a2f0d1' : '#6b4b50',
              }}
            />
          ))}
          {projected.length === 0 ? (
            <Text style={{ position: 'absolute', left: 18, right: 18, top: 164, color: '#6f7987', fontSize: 10, fontFamily: 'monospace', textAlign: 'center' }}>
              waiting for one completed reconstructed frame
            </Text>
          ) : null}
        </Box>
        <Row style={{ marginTop: 8, gap: 12 }}>
          <Text style={{ color: '#8e9baa', fontSize: 9, fontFamily: 'monospace' }}>{`${confident}/${projected.length} joints ≥ 0.5`}</Text>
          <Text style={{ color: '#8e9baa', fontSize: 9, fontFamily: 'monospace' }}>{`depth span ${depthSpan.toFixed(3)} m`}</Text>
        </Row>
      </Col>
    </Col>
  );
}

function TargetSkeletonDiagnostic(props: { snapshot: CaptureSessionSnapshot | null }) {
  const bones = props.snapshot?.targetSkeleton.bones ?? [];
  const frameId = props.snapshot?.targetSkeleton.frameId ?? null;
  const specimenWidth = (CAPTURE_UI_TUNING.targetSkeletonWidth - CAPTURE_UI_TUNING.targetSkeletonGap) * 0.5;
  const bind = useMemo(
    () => projectTargetSkeleton(bones, 'bind', specimenWidth, CAPTURE_UI_TUNING.targetSkeletonHeight),
    [bones, specimenWidth],
  );
  const deformed = useMemo(
    () => projectTargetSkeleton(bones, 'deformed', specimenWidth, CAPTURE_UI_TUNING.targetSkeletonHeight),
    [bones, specimenWidth],
  );
  const bindById = useMemo(() => new Map(bind.map((bone) => [bone.boneId, bone])), [bind]);
  const deformedById = useMemo(() => new Map(deformed.map((bone) => [bone.boneId, bone])), [deformed]);
  const bindSegments = useMemo(() => bind.flatMap((bone) => {
    const parent = bone.parentBoneId ? bindById.get(bone.parentBoneId) : null;
    return parent ? [parent.x, parent.y, bone.x, bone.y] : [];
  }), [bind, bindById]);
  const deformedSegments = useMemo(() => deformed.flatMap((bone) => {
    const parent = bone.parentBoneId ? deformedById.get(bone.parentBoneId) : null;
    return parent ? [
      parent.x + specimenWidth + CAPTURE_UI_TUNING.targetSkeletonGap,
      parent.y,
      bone.x + specimenWidth + CAPTURE_UI_TUNING.targetSkeletonGap,
      bone.y,
    ] : [];
  }), [deformed, deformedById, specimenWidth]);

  return (
    <Col style={{ height: 214, alignItems: 'center', backgroundColor: '#090d14', borderTopWidth: 1, borderTopColor: '#27313e' }}>
      <Row style={{ width: CAPTURE_UI_TUNING.targetSkeletonWidth, height: 30, alignItems: 'center' }}>
        <Text style={{ width: specimenWidth, color: '#63ccec', fontSize: 9, fontFamily: 'monospace', textAlign: 'center', fontWeight: '700' }}>BIND SKELETON</Text>
        <Box style={{ width: CAPTURE_UI_TUNING.targetSkeletonGap }} />
        <Text style={{ width: specimenWidth, color: '#75e3a1', fontSize: 9, fontFamily: 'monospace', textAlign: 'center', fontWeight: '700' }}>
          {frameId === null ? 'DEFORMED · WAITING' : `DEFORMED · FRAME ${frameId}`}
        </Text>
      </Row>
      <Box style={{ width: CAPTURE_UI_TUNING.targetSkeletonWidth, height: CAPTURE_UI_TUNING.targetSkeletonHeight, position: 'relative', backgroundColor: '#070a0f', borderWidth: 1, borderColor: '#242d39', borderRadius: 6 }}>
        <Graph style={{ position: 'absolute', left: 0, top: 0, width: CAPTURE_UI_TUNING.targetSkeletonWidth, height: CAPTURE_UI_TUNING.targetSkeletonHeight }} viewX={0} viewY={0} viewZoom={1} originTopLeft>
          {bindSegments.length > 0 ? <Graph.Polyline segments points={bindSegments} stroke="#53b8dc" strokeWidth={1.8} /> : null}
          {deformedSegments.length > 0 ? <Graph.Polyline segments points={deformedSegments} stroke="#69d995" strokeWidth={1.8} /> : null}
        </Graph>
        {bind.map((bone) => (
          <Box key={`bind:${bone.boneId}`} style={{ position: 'absolute', left: Math.round(bone.x - 2.5), top: Math.round(bone.y - 2.5), width: 5, height: 5, borderRadius: 3, backgroundColor: '#8de4ff' }} />
        ))}
        {deformed.map((bone) => (
          <Box key={`deformed:${bone.boneId}`} style={{ position: 'absolute', left: Math.round(bone.x + specimenWidth + CAPTURE_UI_TUNING.targetSkeletonGap - 2.5), top: Math.round(bone.y - 2.5), width: 5, height: 5, borderRadius: 3, backgroundColor: '#9af0b7' }} />
        ))}
      </Box>
    </Col>
  );
}

export default function AnimationCaptureSurface(props: { targetPackage: ModelPackage | null }) {
  const loaderRef = useRef<any>(null);
  const apiRef = useRef<ReturnType<typeof createCaptureSessionApi> | null>(null);
  if (apiRef.current === null) apiRef.current = createCaptureSessionApi();
  const preferredDepthSignRef = useRef<1 | -1>(1);

  const discoveredAtMount = useMemo(() => listPoseCameraDevices(), []);
  const savedCameraAtMount = useMemo(readStoredCameraSource, []);
  const savedCameraIsAvailable = typeof savedCameraAtMount === 'string'
    && discoveredAtMount.some((device) => device.source === savedCameraAtMount);
  const [cameras, setCameras] = useState<PoseCameraDevice[]>(discoveredAtMount);
  const [cameraMenuOpen, setCameraMenuOpen] = useState(!savedCameraIsAvailable && discoveredAtMount.length > 0);
  // The saved choice survives discovery misses (req_4270): an OBS virtual
  // camera only advertises capture capability WHILE OBS produces, so a scan
  // during a producer gap must not silently discard the user's selection —
  // the feed mounts on it and retries until the producer returns. The menu
  // auto-opens as the "not detected right now" nudge.
  const [cameraSrc, setCameraSrc] = useState(() => (typeof savedCameraAtMount === 'string'
    ? savedCameraAtMount
    : discoveredAtMount[0]?.source ?? DEFAULT_CAMERA_SOURCE));
  const [viewportNodeId, setViewportNodeId] = useState(0);
  const [snapshot, setSnapshot] = useState<CaptureSessionSnapshot | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [preferredDepthSign, setPreferredDepthSign] = useState<1 | -1>(1);

  const discoveredChoices = cameras.length > 0 ? cameras : [DEFAULT_CAMERA];
  // A selected source the scan missed stays pickable/visible instead of
  // vanishing — loopback cameras drop out of discovery whenever their
  // producer pauses (req_4270).
  const cameraChoices = discoveredChoices.some((device) => device.source === cameraSrc)
    ? discoveredChoices
    : [{ ...DEFAULT_CAMERA, source: cameraSrc, name: 'saved source · not detected — is the virtual camera running?' }, ...discoveredChoices];
  const selectedCamera = cameraChoices.find((device) => device.source === cameraSrc)
    ?? { ...DEFAULT_CAMERA, source: cameraSrc, name: 'Saved camera source' };

  useEffect(() => {
    let polls = 0;
    const acquire = (): boolean => {
      const nodeId = Number(loaderRef.current?.id ?? 0);
      if (!Number.isInteger(nodeId) || nodeId < 1) return false;
      setViewportNodeId(nodeId);
      return true;
    };
    if (acquire()) return;
    const timer = setInterval(() => {
      polls += 1;
      if (acquire() || polls >= CAPTURE_UI_TUNING.viewportMountMaxPolls) clearInterval(timer);
    }, CAPTURE_UI_TUNING.viewportMountPollMs);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const api = apiRef.current!;
    setSnapshot(null);
    setSessionError(null);
    if (viewportNodeId < 1) return;
    if (!api.available()) {
      setSessionError('this host build has no __capture_session door — re-ship the editor');
      return;
    }
    const resolution = resolveCaptureTarget(props.targetPackage, cameraSrc, viewportNodeId);
    if (!resolution.ok) {
      setSessionError(resolution.error);
      return;
    }
    let live = true;
    let mountPolls = 0;
    let mountTimer: ReturnType<typeof setInterval> | null = null;
    let snapshotTimer: ReturnType<typeof setInterval> | null = null;
    const beginSnapshotPolling = () => {
      snapshotTimer = setInterval(() => {
        if (!live) return;
        try {
          setSnapshot(api.snapshot());
          setSessionError(null);
        } catch (error) {
          // Keep rendering the last known-good atomic triplet; never admit a
          // malformed or cross-frame native snapshot into the three panes.
          setSessionError(errorMessage(error));
        }
      }, CAPTURE_UI_TUNING.snapshotPollMs);
    };
    const openMountedTarget = (): boolean => {
      if (!live) return true;
      try {
        let opened = api.openTarget(resolution.target);
        if (opened.depthSign !== preferredDepthSignRef.current) {
          opened = api.setDepthSign(preferredDepthSignRef.current);
        }
        // Calibration begins the moment a session opens (req_4265): the feed
        // is the rest reference, and sessions reopen on camera change and hot
        // reload — demanding a manual click after each one reads as "detection
        // is dead". The calibrate button remains as the manual re-baseline.
        try { opened = api.calibrate(); } catch { /* button remains the manual path */ }
        setSnapshot(opened);
        setSessionError(null);
        beginSnapshotPolling();
        return true;
      } catch (error) {
        if (captureTargetMountPending(error) && mountPolls < CAPTURE_UI_TUNING.targetMountMaxPolls) {
          setSessionError('mounting target viewport…');
          return false;
        }
        setSessionError(errorMessage(error));
        return true;
      }
    };
    if (!openMountedTarget()) {
      mountTimer = setInterval(() => {
        mountPolls += 1;
        if (openMountedTarget() && mountTimer !== null) {
          clearInterval(mountTimer);
          mountTimer = null;
        }
      }, CAPTURE_UI_TUNING.targetMountRetryMs);
    }
    return () => {
      live = false;
      if (mountTimer !== null) clearInterval(mountTimer);
      if (snapshotTimer !== null) clearInterval(snapshotTimer);
      try { api.close(); } catch { /* native worker teardown is best-effort */ }
    };
  }, [cameraSrc, props.targetPackage, viewportNodeId]);

  useEffect(() => () => {
    try { apiRef.current?.close(); } catch { /* host process teardown */ }
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (nodeId) g.__compiled_world_unmount?.(nodeId);
  }, []);

  const applyCommand = (command: (api: NonNullable<typeof apiRef.current>) => CaptureSessionSnapshot): void => {
    try {
      setSnapshot(command(apiRef.current!));
      setSessionError(null);
    } catch (error) {
      setSessionError(errorMessage(error));
    }
  };

  const chooseCamera = (source: string) => {
    setCameraMenuOpen(false);
    persistCameraSource(source);
    setCameraSrc(source);
  };

  const rescanCameras = () => {
    const next = listPoseCameraDevices();
    setCameras(next);
    setCameraSrc((current) => {
      if (next.some((device) => device.source === current)) return current;
      const replacement = next[0]?.source ?? DEFAULT_CAMERA_SOURCE;
      persistCameraSource(replacement);
      return replacement;
    });
  };

  const setDepthSign = (depthSign: 1 | -1) => {
    preferredDepthSignRef.current = depthSign;
    setPreferredDepthSign(depthSign);
    if (snapshot) applyCommand((api) => api.setDepthSign(depthSign));
  };

  const frameId = snapshot ? captureSnapshotFrameId(snapshot) : null;
  const detectedKeypoints = snapshot?.detected?.keypoints ?? [];

  // Pre-calibration live preview (req_4263): until the native session promotes
  // its first completed triplet, the camera pane shows raw MoveNet detections
  // through the legacy async door so detection is visible the moment the feed
  // opens. Native triplet keypoints replace the preview the instant they exist;
  // the preview never feeds calibration, reconstruction, or the target rig.
  const nativeDetected = detectedKeypoints.length > 0;
  const [previewKeypoints, setPreviewKeypoints] = useState<{ name: string; x: number; y: number; confidence: number }[]>([]);
  const [feedFrameAspect, setFeedFrameAspect] = useState<number | null>(null);
  useEffect(() => {
    if (nativeDetected) {
      setPreviewKeypoints([]);
      return;
    }
    let cancelRequest: (() => void) | null = null;
    const timer = setInterval(() => {
      cancelRequest?.();
      cancelRequest = requestPose(cameraSrc, (result) => {
        if ('error' in result) return; // transient busy/no-frame; next tick retries
        if (result.width && result.height) setFeedFrameAspect(result.width / result.height);
        setPreviewKeypoints(result.keypoints.map((keypoint) => ({
          name: keypoint.name,
          x: keypoint.x,
          y: keypoint.y,
          confidence: keypoint.score,
        })));
      });
    }, 200);
    return () => { clearInterval(timer); cancelRequest?.(); };
  }, [cameraSrc, nativeDetected]);

  // Landmark x/y are normalized to the camera frame, but RenderTarget paints
  // that frame contain-fit inside the 4:3 feed box (render_surfaces aspect
  // "contain"), so dots must land on the fitted rect, not the box. The host
  // requests 1280x720 for cams and stubborn devices deliver 1920x1080 — both
  // 16:9 — so that is the fallback until a dimension-carrying reply arrives.
  const feedBoxAspect = CAPTURE_UI_TUNING.feedWidth / CAPTURE_UI_TUNING.feedHeight;
  const fittedAspect = feedFrameAspect ?? 16 / 9;
  const fittedWidth = fittedAspect > feedBoxAspect ? CAPTURE_UI_TUNING.feedWidth : CAPTURE_UI_TUNING.feedHeight * fittedAspect;
  const fittedHeight = fittedAspect > feedBoxAspect ? CAPTURE_UI_TUNING.feedWidth / fittedAspect : CAPTURE_UI_TUNING.feedHeight;
  const fittedLeft = (CAPTURE_UI_TUNING.feedWidth - fittedWidth) / 2;
  const fittedTop = (CAPTURE_UI_TUNING.feedHeight - fittedHeight) / 2;

  const displayKeypoints = nativeDetected ? detectedKeypoints : previewKeypoints;
  const confidentKeypoints = displayKeypoints.filter((keypoint) => keypoint.confidence >= CAPTURE_UI_TUNING.landmarkConfidence);
  const meanConfidence = displayKeypoints.length > 0
    ? displayKeypoints.reduce((sum, keypoint) => sum + keypoint.confidence, 0) / displayKeypoints.length
    : 0;
  const depthSign = snapshot?.depthSign ?? preferredDepthSign;
  const calibration = snapshot?.calibration;
  const localRotationCount = snapshot?.target ? Object.keys(snapshot.target.localRotations).length : 0;
  const root = snapshot?.target?.rootTranslation;
  const promotedCameraSource = captureDisplayCameraSource(snapshot, cameraSrc);

  // TEMP DIAGNOSTIC (req_4263): calibration transitions are log-silent on the
  // native side; keep reporting them to the terminal until the pipeline is
  // confirmed end-to-end, then remove.
  const calibrationState = calibration?.state ?? 'no-session';
  const calibrationValid = calibration?.validFrameCount ?? -1;
  useEffect(() => {
    console.warn(`[capture-probe] calibration state=${calibrationState} valid=${calibrationValid}/30 sessionError=${sessionError ?? 'none'}`);
  }, [calibrationState, calibrationValid, sessionError]);
  // Weak footage fails the 10s calibration deadline; retry quietly so the
  // session recovers by itself once the feed improves (req_4265).
  useEffect(() => {
    if (calibrationState !== 'failed') return;
    const timer = setTimeout(() => applyCommand((api) => api.calibrate()), 4000);
    return () => clearTimeout(timer);
  }, [calibrationState]);
  const targetBoneIds = snapshot?.targetSkeleton?.bones?.map((bone) => bone.boneId).join(',') ?? '';
  useEffect(() => {
    if (targetBoneIds) console.warn(`[capture-probe] target bones: ${targetBoneIds}`);
  }, [targetBoneIds]);
  const skeletonBones = snapshot?.targetSkeleton?.bones;
  useEffect(() => {
    if (!skeletonBones || frameId === null || frameId % 30 !== 0) return;
    let max = 0;
    let movedBone = 'none';
    for (const bone of skeletonBones) {
      if (!bone.deformedPosition) continue;
      const d = Math.hypot(
        bone.deformedPosition[0] - bone.bindPosition[0],
        bone.deformedPosition[1] - bone.bindPosition[1],
        bone.deformedPosition[2] - bone.bindPosition[2],
      );
      if (d > max) { max = d; movedBone = bone.boneId; }
    }
    const rootText = root ? `${root[0].toFixed(3)},${root[1].toFixed(3)},${root[2].toFixed(3)}` : 'none';
    console.warn(`[capture-probe] frame=${frameId} deform-vs-bind max=${max.toFixed(4)}m at ${movedBone} root=${rootText} localRot=${localRotationCount}`);
  }, [frameId]);

  return (
    <C.HW_WorldEditorSurface>
      <Col style={{ width: '100%', height: '100%', backgroundColor: '#080b10' }}>
        <Row style={{ minHeight: 42, paddingLeft: 9, paddingRight: 9, gap: 7, alignItems: 'center', backgroundColor: '#0d1117', borderBottomWidth: 1, borderBottomColor: '#2a323e' }}>
          <Text style={{ color: frameId === null ? '#d6ad61' : '#7fe89a', fontSize: 10, fontFamily: 'monospace', fontWeight: '700' }}>
            {frameId === null ? 'WAITING FOR COMPLETED TRIPLET' : `FRAME ${frameId} · DETECTED = SOURCE = TARGET`}
          </Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable
            onPress={() => snapshot && applyCommand((api) => api.calibrate())}
            style={{ height: 26, paddingLeft: 9, paddingRight: 9, justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: '#3b5d55', backgroundColor: '#12251f' }}
          >
            <Text style={{ color: '#9be4c9', fontSize: 9, fontFamily: 'monospace' }}>
              {calibration?.state === 'collecting'
                ? `CALIBRATING ${calibration.validFrameCount}/${calibration.requiredFrameCount}`
                : calibration?.state === 'calibrated' ? 'RECALIBRATE REST' : 'CALIBRATE REST'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => snapshot && applyCommand((api) => snapshot.frozen ? api.resume() : api.freeze())}
            style={{ height: 26, paddingLeft: 9, paddingRight: 9, justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: snapshot?.frozen ? '#906f33' : '#3a4656', backgroundColor: snapshot?.frozen ? '#30240f' : '#121821' }}
          >
            <Text style={{ color: snapshot?.frozen ? '#f1c66b' : '#b8c5d5', fontSize: 9, fontFamily: 'monospace' }}>
              {snapshot?.frozen ? 'RESUME' : 'FREEZE TRIPLET'}
            </Text>
          </Pressable>
          {([[1, 'TOWARD'], [-1, 'AWAY']] as const).map(([sign, label]) => (
            <Pressable
              key={label}
              onPress={() => setDepthSign(sign)}
              style={{ height: 26, paddingLeft: 8, paddingRight: 8, justifyContent: 'center', borderRadius: 5, borderWidth: 1, borderColor: depthSign === sign ? '#4cc9e8' : '#343943', backgroundColor: depthSign === sign ? '#15303b' : '#11151c' }}
            >
              <Text style={{ color: depthSign === sign ? '#7edcf2' : '#8b949e', fontSize: 9, fontFamily: 'monospace' }}>{label}</Text>
            </Pressable>
          ))}
          <Col style={{ position: 'relative', width: 220 }}>
            <Pressable
              onPress={() => setCameraMenuOpen((open) => !open)}
              style={{ height: 26, paddingLeft: 8, paddingRight: 8, justifyContent: 'center', backgroundColor: '#121821', borderRadius: 5, borderWidth: 1, borderColor: '#343943' }}
            >
              <Text numberOfLines={1} noWrap style={{ color: '#b9c8da', fontSize: 9, fontFamily: 'monospace' }}>{`camera · ${selectedCamera.name}`}</Text>
            </Pressable>
            {cameraMenuOpen ? (
              <Col style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: 30, backgroundColor: '#11151c', borderRadius: 6, borderWidth: 1, borderColor: '#3c4655', overflow: 'hidden' }}>
                {cameraChoices.map((device) => (
                  <Pressable key={device.source} onPress={() => chooseCamera(device.source)} style={{ minHeight: 36, paddingLeft: 8, paddingRight: 8, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#252c36', backgroundColor: device.source === cameraSrc ? '#182838' : '#11151c' }}>
                    <Text numberOfLines={1} noWrap style={{ color: device.source === cameraSrc ? '#7fe89a' : '#d3d9e1', fontSize: 9, fontFamily: 'monospace' }}>{device.name}</Text>
                    <Text numberOfLines={1} noWrap style={{ color: '#778391', fontSize: 8, fontFamily: 'monospace' }}>{device.source}</Text>
                  </Pressable>
                ))}
                <Pressable onPress={() => { rescanCameras(); setCameraMenuOpen(false); }} style={{ height: 27, paddingLeft: 8, justifyContent: 'center', backgroundColor: '#0d1117' }}>
                  <Text style={{ color: '#9fc1ee', fontSize: 9, fontFamily: 'monospace' }}>rescan camera devices</Text>
                </Pressable>
              </Col>
            ) : null}
          </Col>
        </Row>

        {sessionError ? (
          <Row style={{ minHeight: 28, paddingLeft: 10, paddingRight: 10, alignItems: 'center', backgroundColor: '#352015', borderBottomWidth: 1, borderBottomColor: '#714329' }}>
            <Text style={{ color: '#f0bd80', fontSize: 10, fontFamily: 'monospace' }}>{sessionError}</Text>
          </Row>
        ) : null}

        <Row style={{ flexGrow: 1, minHeight: 0 }}>
          <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 300, height: '100%', backgroundColor: '#07090d', borderRightWidth: 1, borderRightColor: '#252d38' }}>
            <PanelTitle index="1" title="CAMERA + LANDMARKS" detail="immutable inference frame" color="#6fdaf2" />
            <Col style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Box style={{ width: CAPTURE_UI_TUNING.feedWidth, height: CAPTURE_UI_TUNING.feedHeight, position: 'relative', backgroundColor: '#000000', borderWidth: 1, borderColor: '#28313c', borderRadius: 6 }}>
                <RenderTarget key={`${cameraSrc}:${snapshot?.sessionId ?? 'opening'}`} renderSrc={promotedCameraSource} style={{ width: CAPTURE_UI_TUNING.feedWidth, height: CAPTURE_UI_TUNING.feedHeight }} />
                {displayKeypoints.map((keypoint) => (
                  <Box
                    key={keypoint.name}
                    style={{
                      position: 'absolute',
                      left: Math.round(fittedLeft + keypoint.x * fittedWidth - CAPTURE_UI_TUNING.markerSize / 2),
                      top: Math.round(fittedTop + keypoint.y * fittedHeight - CAPTURE_UI_TUNING.markerSize / 2),
                      width: CAPTURE_UI_TUNING.markerSize,
                      height: CAPTURE_UI_TUNING.markerSize,
                      borderRadius: CAPTURE_UI_TUNING.markerSize / 2,
                      backgroundColor: keypoint.confidence >= CAPTURE_UI_TUNING.landmarkConfidence ? landmarkColor(keypoint.name) : '#5a4146',
                    }}
                  />
                ))}
              </Box>
              <Text style={{ color: '#9a9ea6', fontSize: 9, fontFamily: 'monospace', marginTop: 8 }}>{`${selectedCamera.name} · ${cameraSrc}`}</Text>
              <Row style={{ marginTop: 5, gap: 12 }}>
                <Text style={{ color: '#8e9baa', fontSize: 9, fontFamily: 'monospace' }}>{`${confidentKeypoints.length}/${displayKeypoints.length || 17} landmarks ≥ 0.5`}</Text>
                <Text style={{ color: '#8e9baa', fontSize: 9, fontFamily: 'monospace' }}>{`mean confidence ${meanConfidence.toFixed(2)}`}</Text>
                {!nativeDetected && displayKeypoints.length > 0 ? (
                  <Text style={{ color: '#d6ad61', fontSize: 9, fontFamily: 'monospace' }}>live preview · calibrate to track</Text>
                ) : null}
              </Row>
            </Col>
          </Col>

          <SourceSkeletonDiagnostic snapshot={snapshot} />

          <Col style={{ flexGrow: 1, flexBasis: 0, minWidth: 300, height: '100%', backgroundColor: '#0a1019' }}>
            <PanelTitle index="3" title="TARGET RIG + MESH" detail="native bind/deformed FK diagnostics" color="#d4a8ff" />
            <Col style={{ flexGrow: 1, minHeight: 0 }}>
              <Box style={{ flexGrow: 1, minHeight: 160, position: 'relative', backgroundColor: '#0d141f' }}>
                {createElement('WorldLoader', {
                  ref: loaderRef,
                  gameFile: EDITOR_GAME_FILE,
                  storeDir: EDITOR_STORE_DIR,
                  captureSessionId: snapshot?.sessionId ?? '',
                  captureFrameId: frameId ?? -1,
                  captureDiagnosticMode: 'target',
                  testID: 'editor-animation-target-viewport',
                  style: { width: '100%', height: '100%' },
                })}
                <Row style={{ position: 'absolute', left: 8, right: 8, bottom: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5, backgroundColor: 'rgba(10,12,16,0.86)', borderRadius: 6, justifyContent: 'space-between' }}>
                  <Text style={{ color: '#bfa3dc', fontSize: 9, fontFamily: 'monospace' }}>
                    {snapshot?.target ? `${localRotationCount} local quaternions · constrained · FK mesh` : 'bind mesh · waiting for target-local pose'}
                  </Text>
                  <Text style={{ color: '#8996a8', fontSize: 9, fontFamily: 'monospace' }}>
                    {root ? `root ${root.map((value) => value.toFixed(3)).join(' · ')}` : 'root —'}
                  </Text>
                </Row>
              </Box>
              <TargetSkeletonDiagnostic snapshot={snapshot} />
            </Col>
          </Col>
        </Row>

        <MotionDock api={apiRef.current!} snapshot={snapshot} />
      </Col>
    </C.HW_WorldEditorSurface>
  );
}
