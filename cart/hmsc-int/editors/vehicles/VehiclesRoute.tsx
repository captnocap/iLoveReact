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
// Deletion contract: editors/vehicles/CAPTURE.md — when every inventory
// capability is DONE there, the user deletes cart/vehicle_lab.

import { memo, useEffect, useMemo, useState } from 'react';
import { Box, Col, Pressable, Row, Scene3D, ScrollView, Text } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import {
  GAME_ANIMATION,
  GAME_CAMERA,
  GAME_CHROME,
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
import { openStore, type Store, type StreamHandle } from '../../data';
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
const DATA_ROOT = 'cart/hmsc-int/data';

// The editor's own view tuning (P2) — camera feel and playback cadence carried
// from the reference lab; never gameplay numbers.
const VIEW_TUNING = Object.freeze({
  orbit: { yawPerPixel: 0.38, pitchPerPixel: 0.3, minPitch: 5, maxPitch: 82, boot: { yaw: 34, pitch: 24, dist: 8.2 }, fov: 42, target: [0, 0.8, 0] as [number, number, number] },
  playback: { frameMs: 33, secondsPerFrame: 1 / 60 },
  highlight: { scale: 1.04 },
} as const);

/** The renderer-boundary mapping the V10 capture prescribes: the game door
 *  emits mesh KINDS; the editor maps them to geometry objects. */
function geometryFor(kind: 'box' | 'cylinder' | 'sphere') {
  return kind === 'cylinder' ? Geometry.Cylinder : kind === 'sphere' ? Geometry.Sphere : Geometry.Box;
}

// Capability 9 — the debug overlays: meshes, selected highlight, hitbox tints
// by damage/critical, anchor spheres. memo'd so orbit drags re-solve the
// camera without re-diffing the ~80 mesh nodes (the TestRoute lesson).
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
          material={m.material}
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
  store: Store | null;
  stream: StreamHandle<VehiclesStreamState, VehiclesEvent> | null;
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

export function VehiclesRoute(props: { onExit: () => void }) {
  // ── the garage: the V20 'vehicles' stream, opened once per mount ─────────
  const garage: Garage = useMemo(() => {
    try {
      const store = openStore(DATA_ROOT);
      return { store, stream: store.defineStream(vehiclesStream), error: null };
    } catch (error: any) {
      return { store: null, stream: null, error: String(error?.message ?? error) };
    }
  }, []);
  const [state, setState] = useState<VehiclesStreamState>(() => garage.stream ? garage.stream.state() : { vehicles: {}, order: [] });
  const [activeId, setActiveId] = useState<string | null>(() => state.order[state.order.length - 1] ?? null);

  // ── transient view state (never persisted — content lives in the stream) ──
  const [pose, setPose] = useState<VehiclePoseId>('parked');
  const [frame, setFrame] = useState(0);
  const [running, setRunning] = useState(false);
  const [showHitboxes, setShowHitboxes] = useState(true);
  const [showAnchors, setShowAnchors] = useState(true);
  const [selected, setSelected] = useState<VehiclePartId | null>('gas_tank');
  const [yaw, setYaw] = useState(VIEW_TUNING.orbit.boot.yaw);
  const [pitch, setPitch] = useState(VIEW_TUNING.orbit.boot.pitch);
  const [dist, setDist] = useState(VIEW_TUNING.orbit.boot.dist);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setFrame((f) => f + 1), VIEW_TUNING.playback.frameMs);
    return () => clearInterval(id);
  }, [running]);

  const doc: VehicleDoc | null = activeId ? state.vehicles[activeId] ?? null : null;

  // ── capability 13: every edit is one appended event + a fresh snapshot ────
  const author = (id: string, next: VehicleDoc) => {
    if (!garage.stream || !garage.store) return;
    garage.stream.append({ kind: 'authored', id, doc: next });
    garage.store.materializeSnapshots();
    setState(garage.stream.state());
  };
  const apply = (next: VehicleDoc) => { if (activeId) author(activeId, next); };
  const newVehicle = () => {
    if (!garage.stream) return;
    const id = freshId(state);
    author(id, generateVehicle(freshSeed()));
    setActiveId(id);
    setSelected('gas_tank');
    setPose('parked');
    setFrame(0);
    setRunning(false);
  };
  const removeActive = () => {
    if (!garage.stream || !garage.store || !activeId) return;
    garage.stream.append({ kind: 'removed', id: activeId });
    garage.store.materializeSnapshots();
    const next = garage.stream.state();
    setState(next);
    setActiveId(next.order[next.order.length - 1] ?? null);
  };

  // ── capability 3 + 12: pose DSL → sampled actions → build ────────────────
  const seconds = (running ? frame : 0) * VIEW_TUNING.playback.secondsPerFrame;
  const poseDef = GAME_VEHICLE.tables.poses[pose];
  const timeline = useMemo(() => GAME_ANIMATION.parse(poseDef.dsl), [poseDef.dsl]);
  const sampledActions = useMemo(() => GAME_ANIMATION.sample(timeline, seconds), [timeline, seconds]);
  const build = useMemo(() => (doc ? GAME_VEHICLE.build(doc, sampledActions) : null), [doc, sampledActions]);

  // ── capability 10: the orbit viewport via the ruled camera registry ───────
  const cam = useMemo(
    () => GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: VIEW_TUNING.orbit.target, yaw, pitch, dist, zoom: 1, fov: VIEW_TUNING.orbit.fov }),
    [yaw, pitch, dist],
  );
  const orbitDown = (e: any) => setDrag({ x: Number(e?.x ?? 0), y: Number(e?.y ?? 0) });
  const orbitMove = (e: any) => {
    if (!drag) return;
    const nx = Number(e?.x ?? 0);
    const ny = Number(e?.y ?? 0);
    setYaw((v) => v + (nx - drag.x) * VIEW_TUNING.orbit.yawPerPixel);
    setPitch((v) => Math.max(VIEW_TUNING.orbit.minPitch, Math.min(VIEW_TUNING.orbit.maxPitch, v - (ny - drag.y) * VIEW_TUNING.orbit.pitchPerPixel)));
    setDrag({ x: nx, y: ny });
  };
  const orbitUp = () => setDrag(null);

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
        <ScrollView style={{ flexGrow: 1, height: 100 }}>
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
                    <GAME_CHROME.Chip key={id} label={tables.styles[id].label} active={doc.style === id} color="good" onPress={() => apply(editStyle(doc, id))} />
                  ))}
                </Row>
                {/* capability 2 — role/service */}
                <Row style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Text fontSize={11} color={T.dim} style={{ width: 56 }}>service</Text>
                  {(Object.keys(tables.roles) as VehicleRoleId[]).map((id) => (
                    <GAME_CHROME.Chip key={id} label={tables.roles[id].label} active={doc.role === id} color={id === 'police' ? 'accent' : id === 'medical' ? 'bad' : id === 'fire' ? 'warn' : 'dim'} onPress={() => apply(editRole(doc, id))} />
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
                  <GAME_CHROME.Chip label="reroll" color="#a78bfa" onPress={() => apply(generateVehicle(freshSeed()))} />
                  <GAME_CHROME.Chip label="paint" color={doc.color} onPress={() => apply(repaint(doc, freshSeed()))} />
                </Row>

                {/* capability 6 — gas tank placement */}
                <Col style={{ gap: 6, paddingTop: 4 }}>
                  <Text fontSize={11} color={T.dim}>gas tank placement</Text>
                  <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                    <GAME_CHROME.Chip label="driver side" active={doc.gasSide < 0} color="#eab308" onPress={() => apply(editGasSide(doc, -1))} />
                    <GAME_CHROME.Chip label="passenger side" active={doc.gasSide > 0} color="#eab308" onPress={() => apply(editGasSide(doc, 1))} />
                  </Row>
                  <GAME_CHROME.Knob label="gas z" value={doc.gasZ} spec={gasZKnobSpec(doc.style)} onChange={(v) => apply(setGasZ(doc, v))} />
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
                    <GAME_CHROME.Chip label="repair" color="good" onPress={() => selected ? apply(setPartDamage(doc, selected, 0)) : apply(repairAll(doc))} />
                    <GAME_CHROME.Chip label="damage" color="#fb7185" onPress={() => selected ? apply(nudgeDamage(doc, selected, 1)) : undefined} />
                    <GAME_CHROME.Chip label="wreck" color="warn" onPress={() => apply(wreck(doc, freshSeed()))} />
                  </Row>
                  <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                    {([0, 1, 2, 3] as DamageLevel[]).map((level) => (
                      <GAME_CHROME.Chip key={level} label={tables.damageLabels[level]} active={selectedDamage === level} color={level === 0 ? 'good' : level === 1 ? '#facc15' : level === 2 ? 'warn' : '#fb7185'} onPress={() => selected ? apply(setPartDamage(doc, selected, level)) : undefined} />
                    ))}
                  </Row>
                </Col>

                {/* capability 11 — the contract readout */}
                <Col style={{ gap: 4, paddingTop: 6 }}>
                  <Text fontSize={11} color={T.dim}>contract</Text>
                  <Text fontSize={11} color={T.ink}>{`id: ${activeId} (saved @ seq ${garage.store ? garage.store.undoPoint() : '—'})`}</Text>
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
          <Scene3D.Camera position={cam.pos} target={cam.target} fov={cam.fov} />
          <GAME_CHROME.LabEnvironment preset="arena" />
          {build ? (
            <VehicleMeshes build={build} selected={selected} showHitboxes={showHitboxes} showAnchors={showAnchors} />
          ) : null}
        </Scene3D>
        <Box style={{ position: 'absolute', right: 14, bottom: 14 }}>
          <GAME_CHROME.Knob label="zoom" value={dist} spec={GAME_CHROME.knobPresets['orbit.zoom']} onChange={setDist} />
        </Box>
      </Pressable>
    </Row>
  );
}
