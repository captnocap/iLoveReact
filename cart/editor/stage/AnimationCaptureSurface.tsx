// stage/AnimationCaptureSurface.tsx — the ANIMATION capture tab (req_2786).
//
// Globals → Animation: the webcam feed beside the exported player model, with
// live pose sync — the animation workbench arc's CAPTURE surface arriving.
// Left pane: the cam:0 feed with the tracker's 17 keypoints overdrawn (limbs
// cyan, legs orange, face gold — see where identification lands before
// trusting it). Right pane: the SAME playtest world, its player body driven
// by the solved pose through __compiled_world_set_player_live_pose (the clip
// sampler resumes ~3/4s after pushes stop). The solve is FRONTAL by design —
// single camera sees lateral raises/bends/leans/squats; depth is the
// multi-cam phase. RECORD grows from this surface next: the same solved
// angles, keyframed + reduced into the clip stream.
//
// SELFSHOT law: this surface opens V4L2 camera sources ONLY — never a
// screen:/window: source.
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Pressable, Row, Text } from '@reactjit/primitives';
import { RenderTarget } from '../../../runtime/primitives';
import { C } from '../workspace.cls';
import { EDITOR_GAME_FILE, EDITOR_STORE_DIR } from './WorldEditorSurface';
import { pushPlayerModel } from '../world/playerModelPush';
import { frontalPose, encodeLivePose } from '../world/playerAnimation';
import { initialSolve, solveFrontal, MIN_SCORE } from '../world/poseSolve';
import {
  POSE_CAPTURE_TUNING,
  listPoseCameraDevices,
  poseDoorsAvailable,
  requestPose,
  type PoseCameraDevice,
  type PoseKeypoint,
  type PoseResult,
} from '../../../runtime/capture/pose';

const g: any = globalThis;

const DEFAULT_CAMERA_SOURCE = 'cam:0';
const CAMERA_SOURCE_STORE_KEY = 'editor.animation.cameraSource';
const DEFAULT_CAMERA: PoseCameraDevice = {
  index: 0,
  source: DEFAULT_CAMERA_SOURCE,
  name: 'Default camera',
  driver: '',
  bus: '',
};
/** The fixed feed pane (fixed-region law): overlay dots position in RAW px
 *  against this box; a 4:3 cam fills it edge-to-edge (contain-fit). */
const FEED_W = 640;
const FEED_H = 480;
const DOT = 7;
const FACE = new Set(['nose', 'eye_left', 'eye_right', 'ear_left', 'ear_right']);
const LEGS = new Set(['hip_left', 'hip_right', 'knee_left', 'knee_right', 'ankle_left', 'ankle_right']);
const dotColor = (name: string): string => (FACE.has(name) ? '#e8c14c' : LEGS.has(name) ? '#e8874c' : '#4cc9e8');

function readStoredCameraSource(): string | null {
  try {
    const value = typeof g.__store_get === 'function' ? g.__store_get(CAMERA_SOURCE_STORE_KEY) : null;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function persistCameraSource(source: string): void {
  try {
    if (typeof g.__store_set === 'function') g.__store_set(CAMERA_SOURCE_STORE_KEY, source);
  } catch { /* selection still works for this session */ }
}

export default function AnimationCaptureSurface() {
  const loaderRef = useRef<any>(null);
  // Stage the exported body + basic clips DURING FIRST RENDER (pre-construct,
  // same move as the playtest surface).
  // This loader alone asks the skin payload for applied-pose markers. They are
  // real 3D bone-origin spheres updated beside the palette, not a projected
  // duplicate of the camera dots; ordinary playtest constructs none.
  const playerModel = useMemo(() => pushPlayerModel({ poseMarkers: true }), []);
  const [keypoints, setKeypoints] = useState<PoseKeypoint[] | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [solveHz, setSolveHz] = useState(0);
  const solveRef = useRef(initialSolve());
  const discoveredAtMount = useMemo(() => listPoseCameraDevices(), []);
  const savedCameraAtMount = useMemo(readStoredCameraSource, []);
  const savedCameraIsAvailable = typeof savedCameraAtMount === 'string'
    && discoveredAtMount.some((device) => device.source === savedCameraAtMount);
  const [cameras, setCameras] = useState<PoseCameraDevice[]>(discoveredAtMount);
  const [cameraMenuOpen, setCameraMenuOpen] = useState(!savedCameraIsAvailable && discoveredAtMount.length > 1);
  const [cameraSrc, setCameraSrc] = useState(() => {
    if (savedCameraIsAvailable) return savedCameraAtMount as string;
    return discoveredAtMount[0]?.source ?? DEFAULT_CAMERA_SOURCE;
  });
  const cameraChoices = cameras.length > 0 ? cameras : [DEFAULT_CAMERA];
  const selectedCamera = cameraChoices.find((device) => device.source === cameraSrc)
    ?? { ...DEFAULT_CAMERA, source: cameraSrc, name: 'Saved camera source' };

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

  // The live loop: snapshot → OFF-THREAD estimate → overlay → solve → push.
  // Exactly one request stays in flight; its cancel function detaches the
  // completion on unmount without waiting for ONNX. The live pose is cleared
  // too, so the playtest body never freezes in its last captured frame.
  useEffect(() => {
    if (!poseDoorsAvailable()) {
      setTrackError('this host build has no __pose_estimate_async door — re-ship the editor');
      return;
    }
    let live = true;
    let timer: any = null;
    let cancelPending: (() => void) | null = null;
    let ticks = 0;
    let windowStart = Date.now();
    setKeypoints(null);
    setTrackError(null);
    setSolveHz(0);
    solveRef.current = initialSolve();
    const applyResult = (res: PoseResult) => {
      if (!live) return;
      if ('error' in res) {
        setTrackError(res.error);
        setKeypoints(null);
        return;
      }
      setTrackError(null);
      setKeypoints(res.keypoints);
      if (playerModel && playerModel.nodes.length > 0 && playerModel.trackedJoints > 0) {
        solveRef.current = solveFrontal(solveRef.current, res);
        const transforms = frontalPose(playerModel.nodes, solveRef.current.angles);
        const nodeId = Number(loaderRef.current?.id ?? 0);
        if (nodeId && typeof g.__compiled_world_set_player_live_pose === 'function') {
          g.__compiled_world_set_player_live_pose(nodeId, encodeLivePose(transforms));
        }
      }
      ticks += 1;
      const now = Date.now();
      if (now - windowStart >= 1000) {
        setSolveHz(ticks);
        ticks = 0;
        windowStart = now;
      }
    };
    const tick = () => {
      if (!live) return;
      const cycleStarted = Date.now();
      cancelPending = requestPose(cameraSrc, (res) => {
        cancelPending = null;
        if (!live) return;
        applyResult(res);
        const spent = Date.now() - cycleStarted;
        timer = setTimeout(tick, Math.max(0, POSE_CAPTURE_TUNING.targetIntervalMs - spent));
      });
    };
    // First estimate waits a beat for the cam feed to open.
    timer = setTimeout(tick, POSE_CAPTURE_TUNING.startupDelayMs);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      cancelPending?.();
      const nodeId = Number(loaderRef.current?.id ?? 0);
      if (nodeId) g.__compiled_world_clear_player_live_pose?.(nodeId);
    };
  }, [cameraSrc, playerModel]);

  const tracked = keypoints ? keypoints.filter((kp) => kp.score >= MIN_SCORE) : [];
  return (
    <C.HW_WorldEditorSurface>
      <Row style={{ width: '100%', height: '100%', backgroundColor: '#0a0c10' }}>
        {/* ── the camera pane ─────────────────────────────────────────── */}
        <Col style={{ flexGrow: 1, flexBasis: 0, height: '100%', position: 'relative', alignItems: 'center', justifyContent: 'center', backgroundColor: '#07080b' }}>
          <Box style={{ width: FEED_W, height: FEED_H, position: 'relative', backgroundColor: '#000000', borderWidth: 1, borderColor: '#2a2c31', borderRadius: 6 }}>
            <RenderTarget key={cameraSrc} renderSrc={cameraSrc} style={{ width: FEED_W, height: FEED_H }} />
            {tracked.map((kp) => (
              <Box
                key={kp.name}
                style={{
                  position: 'absolute',
                  left: Math.round(kp.x * FEED_W - DOT / 2),
                  top: Math.round(kp.y * FEED_H - DOT / 2),
                  width: DOT, height: DOT, borderRadius: DOT / 2,
                  backgroundColor: dotColor(kp.name),
                }}
              />
            ))}
            <Row style={{ position: 'absolute', left: 6, top: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, backgroundColor: 'rgba(10,12,16,0.82)', borderRadius: 6 }}>
              <Text style={{ color: trackError ? '#e8b04c' : '#7fe89a', fontSize: 10, fontFamily: 'monospace' }}>
                {trackError ?? `tracking · ${tracked.length}/17 keypoints · ${solveHz} Hz`}
              </Text>
            </Row>
          </Box>
          <Text style={{ color: '#9a9ea6', fontSize: 10, fontFamily: 'monospace', marginTop: 8 }}>
            {`${selectedCamera.name} · ${cameraSrc} — stand back until hips are in frame; frontal moves read best`}
          </Text>
          <Col style={{ position: 'absolute', right: 8, top: 8, width: 250 }}>
            <Pressable
              onPress={() => setCameraMenuOpen((open) => !open)}
              style={{ height: 25, paddingLeft: 8, paddingRight: 8, justifyContent: 'center', backgroundColor: 'rgba(10,12,16,0.94)', borderRadius: 6, borderWidth: 1, borderColor: '#343943' }}
            >
              <Text numberOfLines={1} noWrap style={{ color: '#b9c8da', fontSize: 10, fontFamily: 'monospace' }}>
                {`camera · ${selectedCamera.name}`}
              </Text>
            </Pressable>
            {cameraMenuOpen ? (
              <Col style={{ marginTop: 4, backgroundColor: '#11151c', borderRadius: 6, borderWidth: 1, borderColor: '#3c4655', overflow: 'hidden' }}>
                {cameraChoices.map((device) => (
                  <Pressable
                    key={device.source}
                    onPress={() => chooseCamera(device.source)}
                    style={{ height: 38, paddingLeft: 9, paddingRight: 9, justifyContent: 'center', backgroundColor: device.source === cameraSrc ? '#182838' : '#11151c', borderBottomWidth: 1, borderBottomColor: '#252c36' }}
                  >
                    <Text numberOfLines={1} noWrap style={{ color: device.source === cameraSrc ? '#7fe89a' : '#d3d9e1', fontSize: 10, fontFamily: 'monospace' }}>
                      {`${device.source === cameraSrc ? 'ACTIVE · ' : ''}${device.name}`}
                    </Text>
                    <Text numberOfLines={1} noWrap style={{ color: '#778391', fontSize: 9, fontFamily: 'monospace' }}>
                      {device.source}
                    </Text>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => { rescanCameras(); setCameraMenuOpen(false); }}
                  style={{ height: 28, paddingLeft: 9, justifyContent: 'center', backgroundColor: '#0d1117' }}
                >
                  <Text style={{ color: '#9fc1ee', fontSize: 9, fontFamily: 'monospace' }}>rescan camera devices</Text>
                </Pressable>
              </Col>
            ) : null}
          </Col>
        </Col>
        {/* ── the body pane: the playtest world wearing the live pose ──── */}
        <Box style={{ flexGrow: 1, flexBasis: 0, height: '100%', position: 'relative', backgroundColor: '#0d141f' }}>
          {createElement('WorldLoader', {
            ref: loaderRef,
            gameFile: EDITOR_GAME_FILE,
            storeDir: EDITOR_STORE_DIR,
            testID: 'editor-animation-viewport',
            style: { width: '100%', height: '100%' },
          })}
          <Row style={{ position: 'absolute', left: 8, bottom: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, backgroundColor: 'rgba(10,12,16,0.82)', borderRadius: 6 }}>
            <Text style={{ color: playerModel && playerModel.trackedJoints === 0 ? '#e8b04c' : '#9fc1ee', fontSize: 10, fontFamily: 'monospace' }}>
              {playerModel
                ? playerModel.trackedJoints === 0
                  ? `RIG UNAVAILABLE · ${playerModel.name} exposes ${playerModel.groups} bone(s), 0 tracked joints · camera points cannot drive this mesh`
                  : `player model: ${playerModel.name} · ${playerModel.groups} bones · ${playerModel.trackedJoints} applied markers · live sync ${trackError ? 'waiting' : 'on'}${playerModel.recoveredRig ? ' · recovered range table' : ''}`
                : 'no model declared as THE player — File → Export → Player Model first'}
            </Text>
          </Row>
        </Box>
      </Row>
    </C.HW_WorldEditorSurface>
  );
}
