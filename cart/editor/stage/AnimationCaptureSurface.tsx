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
// SELFSHOT law: this surface opens cam:0 ONLY — never a screen:/window: source.
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Row, Text } from '@reactjit/primitives';
import { RenderTarget } from '../../../runtime/primitives';
import { C } from '../workspace.cls';
import { EDITOR_GAME_FILE, EDITOR_STORE_DIR } from './WorldEditorSurface';
import { pushPlayerModel } from '../world/playerModelPush';
import { frontalPose, encodeLivePose } from '../world/playerAnimation';
import { initialSolve, solveFrontal, MIN_SCORE } from '../world/poseSolve';
import {
  POSE_CAPTURE_TUNING,
  poseDoorsAvailable,
  requestPose,
  type PoseKeypoint,
  type PoseResult,
} from '../../../runtime/capture/pose';

const g: any = globalThis;

const CAM_SRC = 'cam:0';
/** The fixed feed pane (fixed-region law): overlay dots position in RAW px
 *  against this box; a 4:3 cam fills it edge-to-edge (contain-fit). */
const FEED_W = 640;
const FEED_H = 480;
const DOT = 7;
const FACE = new Set(['nose', 'eye_left', 'eye_right', 'ear_left', 'ear_right']);
const LEGS = new Set(['hip_left', 'hip_right', 'knee_left', 'knee_right', 'ankle_left', 'ankle_right']);
const dotColor = (name: string): string => (FACE.has(name) ? '#e8c14c' : LEGS.has(name) ? '#e8874c' : '#4cc9e8');

export default function AnimationCaptureSurface() {
  const loaderRef = useRef<any>(null);
  // Stage the exported body + basic clips DURING FIRST RENDER (pre-construct,
  // same move as the playtest surface).
  const playerModel = useMemo(() => pushPlayerModel(), []);
  const [keypoints, setKeypoints] = useState<PoseKeypoint[] | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [solveHz, setSolveHz] = useState(0);
  const solveRef = useRef(initialSolve());

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
    const applyResult = (res: PoseResult) => {
      if (!live) return;
      if ('error' in res) {
        setTrackError(res.error);
        setKeypoints(null);
        return;
      }
      setTrackError(null);
      setKeypoints(res.keypoints);
      if (playerModel && playerModel.nodes.length > 0) {
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
      cancelPending = requestPose(CAM_SRC, (res) => {
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
  }, []);

  const tracked = keypoints ? keypoints.filter((kp) => kp.score >= MIN_SCORE) : [];
  return (
    <C.HW_WorldEditorSurface>
      <Row style={{ width: '100%', height: '100%', backgroundColor: '#0a0c10' }}>
        {/* ── the camera pane ─────────────────────────────────────────── */}
        <Col style={{ flexGrow: 1, flexBasis: 0, height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#07080b' }}>
          <Box style={{ width: FEED_W, height: FEED_H, position: 'relative', backgroundColor: '#000000', borderWidth: 1, borderColor: '#2a2c31', borderRadius: 6 }}>
            <RenderTarget renderSrc={CAM_SRC} style={{ width: FEED_W, height: FEED_H }} />
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
            {`${CAM_SRC} — stand back until hips are in frame; frontal moves read best (raises, bends, leans, squats)`}
          </Text>
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
            <Text style={{ color: '#9fc1ee', fontSize: 10, fontFamily: 'monospace' }}>
              {playerModel
                ? `player model: ${playerModel.name} · ${playerModel.groups} parts · live sync ${trackError ? 'waiting' : 'on'}`
                : 'no model declared as THE player — File → Export → Player Model first'}
            </Text>
          </Row>
        </Box>
      </Row>
    </C.HW_WorldEditorSurface>
  );
}
