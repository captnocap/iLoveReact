// editors/vehicles/ — the VEHICLES editor route (V10/V17-TRIAGE).
//
// vehicle_lab's authoring UI REMADE as a tool route inside the one app:
// authors VehicleDocs that game/vehicle builds. cart/vehicle_lab is the
// behavior reference only (read, never imported); the system it edited is
// game/vehicle/, reached strictly through the @game door (the figure
// internal-reach exception does not extend to vehicles).
//
// Persistence is not a retrofit (V20): the garage IS the 'vehicles' stream —
// every edit appends an 'authored' event (one undo position per edit) and
// re-materializes the snapshot the game/compile loads. View state (camera,
// selection, playback) is transient by design; the CONTENT lives in data/.
//
// Session history (the user's ruling): the route opens a SESSION on the
// vehicles channel (editors/sessions.ts) — every interaction is one LABELED
// edit-commit on the one global chain, so "what did I do this session, on
// this route" is answerable. The channel handle comes from editorChannel()
// (the tool's ONE store; a private openStore here would fork the undo chain).
//
// Deletion contract: editors/vehicles/CAPTURE.md — when every inventory
// capability is DONE there, the user deletes cart/vehicle_lab.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Pressable, Row, Scene3D, ScrollView, Text } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import {
  GAME_ANIMATION,
  GAME_CAMERA,
  GAME_CHROME,
  GAME_NATIVE_CAMERA,
  GAME_VEHICLE,
  vehiclesStream,
  type DamageLevel,
  type VehicleBuild,
  type VehicleDoc,
  type VehiclePartId,
  type VehiclePoseId,
  type VehicleRoleId,
  type VehicleStyleId,
  type VehiclesEvent,
  type VehiclesStreamState,
} from '@game';
import type { StreamHandle } from '../../data';
import { editorChannel } from '../store';
import { editorSessions, type RouteSession } from '../sessions';
import { editorTunables } from '../tunables';
// MODELPAINT-0605: render /cutout's per-part paintings + deep-link into it
import { VehiclePaintCaptures } from '../../game/paintedRender';
import { setPendingModelTarget } from '../cutout/models';
import {
  editGasSide,
  editRole,
  editStyle,
  gasZKnobSpec,
  generateVehicle,
  nudgeDamage,
  repaint,
  repairAll,
  setGasZ,
  setPartDamage,
  wreck,
} from './edits';

const T = GAME_CHROME.tokens.color;

// The editor's own view tuning (P2) — camera feel and playback cadence carried
// from the reference lab; never gameplay numbers. SETTINGS-0605: the numeric
// leaves register into THE P2 registry below (same values, now
// /settings-editable; the registry writes through, so no freeze). The target
// vec3 stays static (registry is numeric v1 — CAPTURE burndown).
const VIEW_TUNING = {
  orbit: { yawPerPixel: 0.38, pitchPerPixel: 0.3, minPitch: 5, maxPitch: 82, boot: { yaw: 34, pitch: 24, dist: 8.2 }, fov: 42, target: [0, 0.8, 0] as [number, number, number] },
  playback: { frameMs: 33, secondsPerFrame: 1 / 60 },
  highlight: { scale: 1.04 },
};
editorTunables().register({
  system: 'vehicles-view', route: '/vehicles', table: VIEW_TUNING,
  specs: {
    'orbit.yawPerPixel': { label: 'yaw/px', min: 0.05, max: 2, step: 0.01, precision: 2 },
    'orbit.pitchPerPixel': { label: 'pitch/px', min: 0.05, max: 2, step: 0.01, precision: 2 },
    'orbit.minPitch': { label: 'pitch min', min: -10, max: 45, step: 1, precision: 0 },
    'orbit.maxPitch': { label: 'pitch max', min: 45, max: 89, step: 1, precision: 0 },
    'orbit.boot.yaw': { label: 'boot yaw', min: -180, max: 180, step: 1, precision: 0 },
    'orbit.boot.pitch': { label: 'boot pitch', min: 0, max: 89, step: 1, precision: 0 },
    'orbit.boot.dist': { label: 'boot dist', min: 2, max: 30, step: 0.2, precision: 1 },
    'orbit.fov': { label: 'fov', min: 20, max: 90, step: 1, precision: 0 },
    'playback.frameMs': { label: 'frame ms', min: 8, max: 200, step: 1, precision: 0 },
    'highlight.scale': { label: 'highlight ×', min: 1, max: 1.5, step: 0.01, precision: 2 },
  },
});

/** The renderer-boundary mapping the V10 capture prescribes: the game door
 *  emits mesh KINDS; the editor maps them to geometry objects. */
function geometryFor(kind: 'box' | 'cylinder' | 'sphere') {
  return kind === 'cylinder' ? Geometry.Cylinder : kind === 'sphere' ? Geometry.Sphere : Geometry.Box;
}

// Capability 9 — the debug overlays: meshes, selected highlight, hitbox tints
// by damage/critical, anchor spheres. memo'd so non-camera updates never
// re-diff the ~80 mesh nodes (the TestRoute lesson; orbit drags don't render
// at all now — the V23 native controller owns the camera per-frame).
const VehicleMeshes = memo(function VehicleMeshes(props: {
  build: VehicleBuild;
  selected: VehiclePartId | null;
  showHitboxes: boolean;
  showAnchors: boolean;
}) {
  const box = GAME_VEHICLE.tables.meshParams.box;
  return (
    <>
      {props.build.meshes.map((m, i) => (
        <Scene3D.Mesh
          key={`${m.id}.${i}`}
          geometry={geometryFor(m.kind)}
          params={m.params}
          position={m.position}
          rotation={m.rotation ?? [0, 0, 0]}
          scale={m.scale}
          // MODELPAINT-0605: painted panels sample their capture (white base
          // so the texture reads true); decals/unpainted keep their material
          material={m.textureKey ? '#ffffff' : m.material}
          textureKey={m.textureKey}
        />
      ))}
      {props.selected ? props.build.hitboxes.filter((h) => h.id === props.selected).map((h, i) => (
        <Scene3D.Mesh
          key={`selected-${h.id}.${i}`}
          geometry={Geometry.Box}
          params={box}
          position={h.position}
          rotation={h.rotation ?? [0, 0, 0]}
          scale={[h.size[0] * VIEW_TUNING.highlight.scale, h.size[1] * VIEW_TUNING.highlight.scale, h.size[2] * VIEW_TUNING.highlight.scale]}
          material={{ color: T.warn, opacity: 0.28 }}
        />
      )) : null}
      {props.showHitboxes ? props.build.hitboxes.map((h, i) => (
        <Scene3D.Mesh
          key={`hitbox-${h.id}.${i}`}
          geometry={Geometry.Box}
          params={box}
          position={h.position}
          rotation={h.rotation ?? [0, 0, 0]}
          scale={h.size}
          material={{ color: h.damage >= 3 ? '#ef4444' : h.damage >= 2 ? '#f97316' : h.damage >= 1 ? '#facc15' : h.critical ? '#fb7185' : '#38bdf8', opacity: 0.18 }}
        />
      )) : null}
      {props.showAnchors ? Object.entries(props.build.anchors).map(([id, p]) => (
        <Scene3D.Mesh
          key={`anchor-${id}`}
          geometry={Geometry.Sphere}
          params={{ radius: 0.5, segments: 12, rings: 8 }}
          position={p as [number, number, number]}
          scale={0.08}
          material={id === 'gasPort' ? '#eab308' : '#34d399'}
        />
      )) : null}
    </>
  );
});

type Garage = {
  channel: StreamHandle<VehiclesStreamState, VehiclesEvent> | null;
  session: RouteSession<VehiclesEvent> | null;
  error: string | null;
};

function freshId(state: VehiclesStreamState): string {
  let n = state.order.length + 1;
  while (state.vehicles[`car-${n}`]) n += 1;
  return `car-${n}`;
}

// The reference lab's deliberately non-deterministic UI seed source (a known,
// accepted hazard): the doc RECORDS the seed, so the result is reproducible.
function freshSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0;
}

export function VehiclesRoute(props: { onExit: () => void; onPaintTexture?: () => void }) {
  // ── the garage: the 'vehicles' channel on the tool's ONE store, plus this
  // route visit's session (one edit-commit per interaction) ────────────────
  const garage: Garage = useMemo(() => {
    try {
      const channel = editorChannel(vehiclesStream);
      return { channel, session: editorSessions().open('/vehicles', channel), error: null };
    } catch (error: any) {
      return { channel: null, session: null, error: String(error?.message ?? error) };
    }
  }, []);
  // The session boundary: leaving the route records the close marker.
  useEffect(() => () => garage.session?.close(), [garage]);
  const [state, setState] = useState<VehiclesStreamState>(() => garage.channel ? garage.channel.state() : { vehicles: {}, order: [] });
  const [activeId, setActiveId] = useState<string | null>(() => state.order[state.order.length - 1] ?? null);

  // ── transient view state (never persisted — content lives in the stream) ──
  const [pose, setPose] = useState<VehiclePoseId>('parked');
  const [frame, setFrame] = useState(0);
  const [running, setRunning] = useState(false);
  const [showHitboxes, setShowHitboxes] = useState(true);
  const [showAnchors, setShowAnchors] = useState(true);
  const [selected, setSelected] = useState<VehiclePartId | null>('gas_tank');
  // zoom is a KNOB (param-rate); yaw/pitch live in lookRef — drag deltas ride
  // the V23 native controller and never re-render the cart (TestRoute /
  // CharactersRoute pattern).
  const [dist, setDist] = useState(VIEW_TUNING.orbit.boot.dist);
  const lookRef = useRef({ yaw: VIEW_TUNING.orbit.boot.yaw, pitch: VIEW_TUNING.orbit.boot.pitch });
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const cameraRef = useRef<any>(null);
  const camCtlRef = useRef<ReturnType<typeof GAME_NATIVE_CAMERA.forNode> | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setFrame((f) => f + 1), VIEW_TUNING.playback.frameMs);
    return () => clearInterval(id);
  }, [running]);

  const doc: VehicleDoc | null = activeId ? state.vehicles[activeId] ?? null : null;

  // ── capability 13: every edit is one LABELED session commit (content event
  // on the vehicles channel + commit marker + fresh snapshots) ──────────────
  const author = (id: string, next: VehicleDoc, label: string) => {
    if (!garage.session || !garage.channel) return;
    garage.session.commit({ kind: 'authored', id, doc: next }, `${id}: ${label}`);
    setState(garage.channel.state());
  };
  const apply = (next: VehicleDoc, label: string) => { if (activeId) author(activeId, next, label); };
  const newVehicle = () => {
    if (!garage.session) return;
    const id = freshId(state);
    author(id, generateVehicle(freshSeed()), 'authored');
    setActiveId(id);
    setSelected('gas_tank');
    setPose('parked');
    setFrame(0);
    setRunning(false);
  };
  const removeActive = () => {
    if (!garage.session || !garage.channel || !activeId) return;
    garage.session.commit({ kind: 'removed', id: activeId }, `${activeId}: deleted`);
    const next = garage.channel.state();
    setState(next);
    setActiveId(next.order[next.order.length - 1] ?? null);
  };

  // ── capability 3 + 12: pose DSL → sampled actions → build ────────────────
  const seconds = (running ? frame : 0) * VIEW_TUNING.playback.secondsPerFrame;
  const poseDef = GAME_VEHICLE.tables.poses[pose];
  const timeline = useMemo(() => GAME_ANIMATION.parse(poseDef.dsl), [poseDef.dsl]);
  const sampledActions = useMemo(() => GAME_ANIMATION.sample(timeline, seconds), [timeline, seconds]);
  const build = useMemo(() => (doc ? GAME_VEHICLE.build(doc, sampledActions) : null), [doc, sampledActions]);

  // ── capability 10: the orbit viewport — V23: THE CAMERA IS NOT JAVASCRIPT ──
  // The host (framework/game/camera.zig) owns per-frame solve/smoothing of the
  // route's own camera node; JS sends rig params on CHANGE (the zoom knob) and
  // deltas per drag move. VIEW_TUNING stays the rig params (P2, unchanged feel).
  const sendOrbit = (distance: number) => {
    const l = lookRef.current;
    camCtlRef.current?.setOrbit({
      target: VIEW_TUNING.orbit.target, yaw: l.yaw, pitch: l.pitch,
      distance, fov: VIEW_TUNING.orbit.fov, zoom: 1,
    });
  };

  // Engage: params ride the node id from the camera ref (the nativeCamera prop
  // already bound it host-side at CREATE). Disable on unmount returns the node
  // to the declarative JS-props path.
  useEffect(() => {
    const nodeId = Number(cameraRef.current?.id ?? 0);
    if (!nodeId) {
      console.warn('[vehicles] native camera not engaged — camera node id unavailable (rebuild the host with has-game-camera?)');
      return;
    }
    const ctl = GAME_NATIVE_CAMERA.forNode(nodeId);
    camCtlRef.current = ctl;
    ctl.setOrbit({
      target: VIEW_TUNING.orbit.target, yaw: lookRef.current.yaw, pitch: lookRef.current.pitch,
      distance: dist, fov: VIEW_TUNING.orbit.fov, zoom: 1,
    });
    ctl.setMode('orbit');
    return () => {
      camCtlRef.current = null;
      ctl.disable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- engage once; param changes ride the effect below
  }, []);

  // Param changes (the zoom knob) re-send the rig params; yaw/pitch ride along
  // from the ref unchanged.
  useEffect(() => { sendOrbit(dist); }, [dist]);

  const orbitDown = (e: any) => { dragRef.current = { x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) }; };
  const orbitMove = (e: any) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Number(e?.x ?? 0), ny = Number(e?.y ?? 0);
    const dx = nx - d.x, dy = ny - d.y;
    d.x = nx; d.y = ny;
    // Pitch clamps apply HERE so the JS shadow and the host accumulate
    // identically — only the post-clamp delta is sent. Horizontal sign: yaw
    // DECREASES with a rightward drag — the /test USER-VERDICT-pinned
    // convention, applied here by V25 (DRAGSIGN-0605: one drag convention
    // everywhere; the lab's legacy +dx was divergence, not design).
    const l = lookRef.current;
    const nextYaw = l.yaw - dx * VIEW_TUNING.orbit.yawPerPixel;
    const nextPitch = Math.max(VIEW_TUNING.orbit.minPitch, Math.min(VIEW_TUNING.orbit.maxPitch, l.pitch - dy * VIEW_TUNING.orbit.pitchPerPixel));
    camCtlRef.current?.setInputDeltas(nextYaw - l.yaw, nextPitch - l.pitch);
    l.yaw = nextYaw;
    l.pitch = nextPitch;
  };
  const orbitUp = () => { dragRef.current = null; };

  // The DECLARATIVE camera is the boot frame only — static props, so React
  // never sends camera UPDATEs after mount; the host writes the node fields
  // every frame once engaged.
  const [bootCam] = useState(() =>
    GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: VIEW_TUNING.orbit.target,
      yaw: lookRef.current.yaw,
      pitch: lookRef.current.pitch,
      dist: VIEW_TUNING.orbit.boot.dist,
      zoom: 1,
      fov: VIEW_TUNING.orbit.fov,
    }));

  const tables = GAME_VEHICLE.tables;
  const dims = doc ? tables.styles[doc.style] : null;
  const selectedDamage: DamageLevel = doc && selected ? GAME_VEHICLE.damageOf(doc, selected) : 0;
  const hitboxGroups = useMemo(() => {
    if (!build) return [] as VehiclePartId[];
    const ids: VehiclePartId[] = [];
    for (const h of build.hitboxes) if (!ids.includes(h.id)) ids.push(h.id);
    return ids;
  }, [build]);

  return (
    // Route surfaces must COVER the always-mounted editor (later siblings
    // paint on top; coverage is the overlay mechanism in this shell):
    // absolute full-area + opaque bg, exactly like LabsRoute/CharactersRoute.
    <Row style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', backgroundColor: T.page }}>
      <Col style={{ width: 390, height: '100%' }}>
        {/* VEHUI-0605: the viewport must FILL the panel — a literal height
            beside flexGrow resolved to 100px and clipped the rail mid-glyph
            (ScrollView needs an explicit height; '100%' is the panel-filling
            one, the same shape the characters route proves out). */}
        <ScrollView showScrollbar={true} style={{ width: '100%', height: '100%' }}>
          <Col style={{ padding: 14, gap: 10 }}>
            <Row style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Text fontSize={16} color={T.ink} style={{ fontWeight: 900 }}>VEHICLES</Text>
              <GAME_CHROME.Chip label="← editor" onPress={props.onExit} />
            </Row>
            <Text fontSize={11} color={T.dim}>
              authors VehicleDocs for game/vehicle — semantic panels, hitboxes, damage, gas tank
            </Text>
            {garage.error ? (
              <Text fontSize={11} color={T.bad}>{`store unavailable: ${garage.error}`}</Text>
            ) : null}

            {/* the garage — the persisted rail (capability 13) */}
            <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <Text fontSize={11} color={T.dim} style={{ width: 56 }}>garage</Text>
              {state.order.map((id) => (
                <GAME_CHROME.Chip key={id} label={id} active={activeId === id} color="cyan" onPress={() => { setActiveId(id); setSelected('gas_tank'); }} />
              ))}
              <GAME_CHROME.Chip label="+ new" color="good" onPress={newVehicle} />
              {doc ? <GAME_CHROME.Chip label="delete" color="bad" onPress={removeActive} /> : null}
            </Row>

            {doc && dims && build ? (
              <>
                {/* capability 1 — style */}
                <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Text fontSize={11} color={T.dim} style={{ width: 56 }}>style</Text>
                  {(Object.keys(tables.styles) as VehicleStyleId[]).map((id) => (
                    <GAME_CHROME.Chip key={id} label={tables.styles[id].label} active={doc.style === id} color="good" onPress={() => apply(editStyle(doc, id), `style → ${id}`)} />
                  ))}
                </Row>
                {/* capability 2 — role/service */}
                <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Text fontSize={11} color={T.dim} style={{ width: 56 }}>service</Text>
                  {(Object.keys(tables.roles) as VehicleRoleId[]).map((id) => (
                    <GAME_CHROME.Chip key={id} label={tables.roles[id].label} active={doc.role === id} color={id === 'police' ? 'accent' : id === 'medical' ? 'bad' : id === 'fire' ? 'warn' : 'dim'} onPress={() => apply(editRole(doc, id), `service → ${id}`)} />
                  ))}
                </Row>
                {/* capability 3 — motion poses + run */}
                <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Text fontSize={11} color={T.dim} style={{ width: 56 }}>motion</Text>
                  {(Object.keys(tables.poses) as VehiclePoseId[]).map((id) => (
                    <GAME_CHROME.Chip key={id} label={tables.poses[id].label} active={pose === id} color="warn" onPress={() => { setPose(id); setFrame(0); setRunning(id !== 'parked'); }} />
                  ))}
                  <GAME_CHROME.Chip label={running ? 'run ■' : 'run'} active={running} color="good" onPress={() => setRunning((v) => !v)} />
                </Row>
                {/* capabilities 4/5/9 — generate seed, paint, overlays */}
                <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Text fontSize={11} color={T.dim} style={{ width: 56 }}>debug</Text>
                  <GAME_CHROME.Chip label="hitboxes" active={showHitboxes} color="accent" onPress={() => setShowHitboxes((v) => !v)} />
                  <GAME_CHROME.Chip label="anchors" active={showAnchors} color="good" onPress={() => setShowAnchors((v) => !v)} />
                  <GAME_CHROME.Chip label="reroll" color="#a78bfa" onPress={() => apply(generateVehicle(freshSeed()), 'reroll')} />
                  <GAME_CHROME.Chip label="paint" color={doc.color} onPress={() => apply(repaint(doc, freshSeed()), 'repaint')} />
                </Row>
                {/* MODELPAINT-0605: per-part TEXTURE painting lives in /cutout —
                    deep-link with the selected part (or the body) preloaded */}
                <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Text fontSize={11} color={T.dim} style={{ width: 56 }}>texture</Text>
                  <GAME_CHROME.Chip
                    label={`paint ${selected ?? 'body'} → /cutout`}
                    color="cyan"
                    onPress={() => {
                      if (!activeId) return;
                      setPendingModelTarget({ family: 'vehicle', docId: activeId, part: selected ?? 'body' });
                      garage.session?.note(`paint texture → /cutout · ${activeId} · ${selected ?? 'body'}`);
                      props.onPaintTexture?.();
                    }}
                  />
                </Row>

                {/* capability 6 — gas tank placement */}
                <Col style={{ gap: 6, paddingTop: 4 }}>
                  <Text fontSize={11} color={T.dim}>gas tank placement</Text>
                  <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                    <GAME_CHROME.Chip label="driver side" active={doc.gasSide < 0} color="#eab308" onPress={() => apply(editGasSide(doc, -1), 'gas → driver side')} />
                    <GAME_CHROME.Chip label="passenger side" active={doc.gasSide > 0} color="#eab308" onPress={() => apply(editGasSide(doc, 1), 'gas → passenger side')} />
                  </Row>
                  <GAME_CHROME.Knob label="gas z" value={doc.gasZ} spec={gasZKnobSpec(doc.style)} onChange={(v) => apply(setGasZ(doc, v), `gas z → ${v.toFixed(2)}`)} />
                </Col>

                {/* capability 7 — hitbox group selection */}
                <Col style={{ gap: 6, paddingTop: 4 }}>
                  <Text fontSize={11} color={T.dim}>hitbox groups</Text>
                  <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                    <GAME_CHROME.Chip label="none" active={selected == null} onPress={() => setSelected(null)} />
                    {hitboxGroups.map((id) => (
                      <GAME_CHROME.Chip key={id} label={tables.labels[id]} active={selected === id} color={id === 'gas_tank' ? '#eab308' : id.includes('wheel') ? '#fb7185' : 'accent'} onPress={() => setSelected(id)} />
                    ))}
                  </Row>
                </Col>

                {/* capability 8 — damage state */}
                <Col style={{ gap: 6, paddingTop: 4 }}>
                  <Text fontSize={11} color={T.dim}>damage state</Text>
                  <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <GAME_CHROME.Chip label="repair" color="good" onPress={() => selected ? apply(setPartDamage(doc, selected, 0), `repaired ${selected}`) : apply(repairAll(doc), 'repaired all')} />
                    <GAME_CHROME.Chip label="damage" color="#fb7185" onPress={() => selected ? apply(nudgeDamage(doc, selected, 1), `damaged ${selected}`) : undefined} />
                    <GAME_CHROME.Chip label="wreck" color="warn" onPress={() => apply(wreck(doc, freshSeed()), 'wrecked')} />
                  </Row>
                  <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                    {([0, 1, 2, 3] as DamageLevel[]).map((level) => (
                      <GAME_CHROME.Chip key={level} label={tables.damageLabels[level]} active={selectedDamage === level} color={level === 0 ? 'good' : level === 1 ? '#facc15' : level === 2 ? 'warn' : '#fb7185'} onPress={() => selected ? apply(setPartDamage(doc, selected, level), `${selected} → ${tables.damageLabels[level]}`) : undefined} />
                    ))}
                  </Row>
                </Col>

                {/* capability 11 — the contract readout */}
                <Col style={{ gap: 4, paddingTop: 6 }}>
                  <Text fontSize={11} color={T.dim}>contract</Text>
                  <Text fontSize={11} color={T.ink}>{`id: ${activeId} (saved @ seq ${garage.session ? editorSessions().undoPoint() : '—'})`}</Text>
                  <Text fontSize={11} color={T.ink}>{`style: ${tables.styles[doc.style].label}`}</Text>
                  <Text fontSize={11} color={T.ink}>{`role: ${tables.roles[doc.role].label}`}</Text>
                  <Text fontSize={11} color={T.ink}>scale: 1 unit = 1m, player ref 1.65m</Text>
                  <Text fontSize={11} color={T.ink}>{`size: ${dims.length.toFixed(2)}m L x ${dims.width.toFixed(2)}m W`}</Text>
                  <Text fontSize={11} color={T.ink}>{`wheel: ${(dims.wheelR * 2).toFixed(2)}m diameter`}</Text>
                  <Text fontSize={11} color={T.ink}>{`dsl: ${poseDef.dsl}`}</Text>
                  <Text fontSize={11} color={T.ink}>{`seed: ${doc.seed}`}</Text>
                  <Text fontSize={11} color={T.ink}>{`gas tank: ${doc.gasSide < 0 ? 'driver' : 'passenger'} side, z ${doc.gasZ.toFixed(2)}`}</Text>
                  <Text fontSize={11} color={T.ink}>{`selected: ${selected ? tables.labels[selected] : 'none'}`}</Text>
                  <Text fontSize={11} color={T.ink}>{`damage: ${selected ? tables.damageLabels[selectedDamage] : 'none selected'}`}</Text>
                </Col>
              </>
            ) : (
              <Col style={{ gap: 6, paddingTop: 10 }}>
                <Text fontSize={12} color={T.dim}>the garage is empty — author the first vehicle</Text>
                <Row><GAME_CHROME.Chip label="+ new vehicle" color="good" onPress={newVehicle} /></Row>
              </Col>
            )}
          </Col>
        </ScrollView>
      </Col>

      <Pressable
        onMouseDown={orbitDown}
        onMouseMove={orbitMove}
        onMouseUp={orbitUp}
        style={{ flexGrow: 1, height: '100%', position: 'relative', overflow: 'hidden' }}
      >
        <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={T.page}>
          <Scene3D.Camera nativeCamera ref={cameraRef} position={bootCam.pos} target={bootCam.target} fov={bootCam.fov} />
          <GAME_CHROME.LabEnvironment preset="arena" />
          {build ? (
            <VehicleMeshes build={build} selected={selected} showHitboxes={showHitboxes} showAnchors={showAnchors} />
          ) : null}
        </Scene3D>
        {/* MODELPAINT-0605: the painted parts' texture captures (offscreen) */}
        {doc ? <VehiclePaintCaptures doc={doc} /> : null}
        <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <GAME_CHROME.Knob label="zoom" value={dist} spec={GAME_CHROME.knobPresets['orbit.zoom']} onChange={setDist} />
        </Box>
      </Pressable>
    </Row>
  );
}
