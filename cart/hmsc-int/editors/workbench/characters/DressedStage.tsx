// editors/workbench/characters/DressedStage.tsx — column 4 for the CLOTHING
// and ANIMATION contexts (CLOTHSPLIT-0606 phase 2, parity rows S1-S7, S9).
//
// The DRESSED figure: buildRigFrame (mesh + attachOutfit) + the held prop —
// what the pre-split FIGURE lens showed. Two modes, one surface:
//   animate=false (clothing)  — static pose; the outfit demonstrates on the
//                               current body. No clocks mount at all.
//   animate=true  (animation) — the pre-split Stage's three clocks live HERE
//                               (face 150ms · rig 90ms · script 50ms with the
//                               auto-stop + frame-zero reset), scriptMouth
//                               beats the manual face anim, identical fold.
// LAW 1 holds: everything here demonstrates; every parameter edit lives in
// gutter 3 (the clothing/animation panels). The viewport chips (fly/undo/
// redo) are workspace controls, the character stage's own convention.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Pressable, Row, Scene3D, Text } from '@reactjit/runtime/primitives';
import { useIFTTT } from '@reactjit/runtime/hooks/useIFTTT';
import { GAME_ANIMATION } from '../../../game/animation';
import { GAME_CHROME } from '../../../game/chrome';
import { HED_ANIM_FRAMES, type HedAnimation } from '../../../game/figure/hed';
import { buildRigFrame } from '../../../game/figure/rig';
import { PAINT_EDITOR_TUNING } from '../../characters/paintKit';
import { HeldItemMeshes, PartMeshes } from '../../characters/preview';
import { useSculptCamera } from '../../sculptCamera';
import { FigureCaptures, useFigureRender } from './figureFrame';
import type { CharacterStore } from './store';

const { Chip, Knob, LabEnvironment } = GAME_CHROME;
const T = GAME_CHROME.tokens.color;
const TUNE = PAINT_EDITOR_TUNING;

export function DressedStage(props: {
  store: CharacterStore;
  /** false = clothing context (static pose) · true = animation context (clocks) */
  animate: boolean;
  /** the lens-identity caption (top right) */
  caption: string;
  /** the camera's twig namespace — each context keeps its own saved pose */
  camRoute: string;
  /** the status strip's idle hint */
  idleHint: string;
}) {
  const s = props.store;
  const [, setTick] = useState(0);
  useEffect(() => s.subscribe(() => setTick((t) => t + 1)), [s]);

  const draft = s.draft;
  const v = s.view;

  // ── the animation clocks (parity S1-S4) — mount ONLY in animate mode ──────
  const [animFrame, setAnimFrame] = useState(0);
  const [rigFrame, setRigFrame] = useState(0);
  const [scriptFrame, setScriptFrame] = useState(0);
  useEffect(() => {
    if (!props.animate || !v.faceAnim || !draft.face) return;
    const iv = setInterval(() => setAnimFrame((f) => f + 1), 150);
    return () => clearInterval(iv);
  }, [props.animate, v.faceAnim, !!draft.face]);
  useEffect(() => {
    if (!props.animate || !v.bodyRigAnim) return;
    const iv = setInterval(() => setRigFrame((f) => f + 1), 90);
    return () => clearInterval(iv);
  }, [props.animate, v.bodyRigAnim]);
  useEffect(() => {
    if (!props.animate || !v.scriptPlaying) return;
    const iv = setInterval(() => setScriptFrame((f) => f + 1), 50);
    return () => clearInterval(iv);
  }, [props.animate, v.scriptPlaying]);
  // a fresh script starts from frame zero (the pre-split reset semantics)
  useEffect(() => { setScriptFrame(0); }, [v.animScript]);

  const timeline = useMemo(() => GAME_ANIMATION.parse(v.animScript), [v.animScript]);
  const timelineLoops = useMemo(() => GAME_ANIMATION.isLooping(timeline), [timeline]);
  const scriptActions = useMemo(
    () => (props.animate && (v.scriptPlaying || scriptFrame > 0) ? GAME_ANIMATION.sample(timeline, scriptFrame / 20) : []),
    [props.animate, v.scriptPlaying, timeline, scriptFrame],
  );
  useEffect(() => {
    if (!props.animate || !v.scriptPlaying || timelineLoops || timeline.total <= 0) return;
    if (scriptFrame / 20 >= timeline.total) s.setScriptPlaying(false);
  }, [props.animate, v.scriptPlaying, timelineLoops, timeline.total, scriptFrame]);

  // scriptMouth beats the manual face anim (parity S5 — identical fold)
  const scriptMouth = scriptActions.find((a: any) => a.target === 'mouth' && (['talk', 'chew', 'cry', 'yell'] as string[]).includes(a.action));
  const activeAnim: HedAnimation | null = props.animate
    ? (scriptMouth ? scriptMouth.action as HedAnimation : v.faceAnim)
    : null;
  const phase = activeAnim
    ? scriptMouth
      ? Math.min(HED_ANIM_FRAMES[activeAnim] - 1, Math.floor(scriptMouth.phase * HED_ANIM_FRAMES[activeAnim]))
      : animFrame % HED_ANIM_FRAMES[activeAnim]
    : 0;

  const fr = useFigureRender(s, { anim: activeAnim, phase });

  // ── the dressed rig (parity S6) — mesh + attachOutfit, the phase-1 doors ──
  const bodyPhase = props.animate ? (v.scriptPlaying ? scriptFrame / 20 : v.bodyRigAnim ? rigFrame / 24 : 0) : 0;
  const rig = useMemo(
    () => buildRigFrame(draft.bodyShape, draft.bodyPose, bodyPhase, scriptActions, draft.clothing, draft.clothingSkin, draft.accessories, draft.bottoms),
    [draft.bodyShape, draft.bodyPose, bodyPhase, scriptActions, draft.clothing, draft.clothingSkin, draft.accessories, draft.bottoms],
  );
  const sculpted = s.sculptedItems();

  // ── camera: the shared sculpt rig on this context's OWN twig keys (F3) ────
  const viewRect = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const camera = useSculptCamera({
    route: props.camRoute,
    center: [0, 1.05, 0],
    viewRect,
    defaults: { dist: 4.2, look: { yaw: 20, pitch: 12 }, flyPose: { pos: [0, 1.5, -3.4], yaw: 0, pitch: -4 }, mode: 'orbit' },
  });

  // draft undo/redo stay reachable while dressing/posing (parity §4)
  useIFTTT('key:ctrl+z', () => s.undo());
  useIFTTT('key:ctrl+y', () => s.redo());
  useIFTTT('key:ctrl+shift+z', () => s.redo());

  const hint = s.status ?? props.idleHint;

  return (
    <Col style={{ flexGrow: 1, minHeight: 0 }}>
      <Pressable
        onLayout={(lr: any) => { viewRect.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height }; }}
        onMouseDown={camera.orbitDown}
        onMouseMove={(e: any) => { if (camera.dragging()) camera.orbitMove(e); }}
        onMouseUp={camera.orbitUp}
        onScroll={camera.onWheel}
        style={{ flexGrow: 1, minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={T.panelSolid} showGrid={false} showAxes={false}>
          <Scene3D.Camera nativeCamera ref={camera.cameraRef} position={camera.bootCam.pos} target={camera.bootCam.target} fov={camera.bootCam.fov} />
          <LabEnvironment preset="studio" ground={false} />
          <PartMeshes view="figure" selPart={v.selPart} parts={fr.partRender} rig={rig} showHitboxes={false} paint={draft.paint} skin={draft.skin} />
          {draft.heldItem !== 'none' ? <HeldItemMeshes itemId={draft.heldItem} rig={rig} extraItems={sculpted} /> : null}
        </Scene3D>
        <Text fontSize={9} color={T.dim} style={{ position: 'absolute', right: 14, top: 14, fontWeight: 800, letterSpacing: 1 }}>{props.caption}</Text>
        <Row style={{ position: 'absolute', left: 14, top: 14, gap: 8 }}>
          <Chip label="fly" active={camera.camMode === 'fly'} color="good" onPress={() => camera.setCamMode(camera.camMode === 'fly' ? 'orbit' : 'fly')} />
          <Chip label="undo ⌃Z" onPress={s.undo} />
          <Chip label="redo ⌃Y" onPress={s.redo} />
        </Row>
        {camera.camMode === 'fly' ? (
          <Text fontSize={10} color={T.dim} style={{ position: 'absolute', right: 14, bottom: 14 }}>
            wasd move · q/e down/up · drag look · wheel dolly
          </Text>
        ) : (
          <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
            <Knob label="zoom" value={camera.zoomReflect - camera.dist} spec={TUNE.knobs.zoom} onChange={(x: number) => camera.zoomTo(camera.zoomReflect - x)} />
          </Box>
        )}
      </Pressable>
      {/* the status strip — every store status lands here (parity B7) */}
      <Row style={{ alignItems: 'center', gap: 10, paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, backgroundColor: T.panelSolid, borderTopWidth: 1, borderColor: T.frame }}>
        <Text fontSize={10} color={T.dim} numberOfLines={1}>{hint}</Text>
        <Box style={{ flexGrow: 1 }} />
        {s.sessionError ? <Text fontSize={10} color={T.bad}>{`store offline — ${s.sessionError}`}</Text> : null}
      </Row>
      {/* offscreen: the capture stack in lockstep with this stage's texKeys */}
      <FigureCaptures store={s} r={fr} />
    </Col>
  );
}
