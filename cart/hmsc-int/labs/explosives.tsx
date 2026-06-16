// labs/explosives.tsx — the EXPLOSIVES integration lab: a propane tank that
// cooks off into a knockback blast, and a gasoline trail that crawls cell by
// cell and chain-detonates the tank when the fire reaches it.
//
// THE WHOLE POINT (req_1140, follows req_1132/1133): this lab proves the two
// pure foundation doors — GAME_EXPLOSION (the instant radial blast) and
// GAME_FIRE (lingering, spreading combustion) — drive real on-foot gameplay.
// Like combat-arena it rides the GAME'S OWN player substrate (useEmbodiedPlayer):
// the host physics step owns movement/gravity/collision AND the dynamic barrel
// bodies (worldExtras.bodies — running into one kicks it), the V23 host camera
// owns the orbit/aim solve. We add ONLY explosives on top, in onFrame:
//
//   • a PROPANE TANK is a GAME_FIRE Combustible (≈0 s fuel + cookoff) — shoot it
//     or let fire reach it and it's a "big ass boom", not a fire. Cookoff fires
//     a GAME_EXPLOSION blast: each barrel gets a falloff impulse (→ its physics
//     velocity, so the host launches it next step) and the player takes falloff
//     damage. The blast also lights any gasoline within its radius.
//   • a GASOLINE TRAIL is a GAME_FIRE FireField over a hand-poured fuel path.
//     Light the far end and the front crawls along the fuel, turns the corner,
//     reaches the tank, and chain-detonates it. Standing in fire hurts.
//
// VFX is deliberately host-free: an expanding bright fireball mesh + a screen
// flash sell the boom; flame boxes mark burning cells. The real fireball shader
// + camera shake are a later layer. Contract: explosives.notes.md. (STRUCTURE
// note: a lab may import game/ only, but the embodied controller lives in
// Embodied.tsx — the user ruled labs MUST reuse it, so we import it directly,
// same as combat-arena, until it graduates to a game/ door.)

import { useMemo, useRef, useState } from 'react';
import { useRerender } from '@reactjit/runtime/hooks';
import {
  GAME_EXPLOSION,
  GAME_FIRE,
  GAME_INPUT,
  GAME_LOOP,
  GAME_NATIVE_CAMERA,
  GAME_CAMERA,
  type Combustible,
  type FireField,
  type FuelPredicate,
  type OrientedCollisionRect,
  type PhysicsBody,
  type SteppedBody,
} from '@game';
import { Box, Col, Row, Text, Pressable, Scene3D } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import type { GameState } from '../design';
import { createInitialGameState } from '../state/gameState';
import { EmbodiedCaptures, EmbodiedMouseSurface, EmbodiedScene, useEmbodiedPlayer, type PlayerPose } from '../Embodied';

type V3 = [number, number, number];

// ── palette ──────────────────────────────────────────────────────────────────
const BG = '#0a0f1a';
const PANEL = '#0a1120';
const INK = '#e8eef8';
const DIM = '#7e93b4';
const FAINT = '#46587a';
const ACCENT = '#fb923c';
const DEG = Math.PI / 180;
const EYE_HEIGHT = 1.6;

// ── the explosives this lab tunes (each notes where it graduates) ─────────────
// These are the per-explosive MAGNITUDES the foundation doors take per-call (a
// propane tank vs a firecracker differ here) — they'll live on the prop/item
// kind once tagged. The doors' shape tables (falloff, ignite threshold) stay.
const PROPANE_BLAST = { radiusMeters: 8, peakImpulse: 16, peakDamage: 75 }; // → propaneTank prop data
const PROPANE_FUSE_SECONDS = 0.06; // ≈instant: ignite → boom next step
const BARREL_MASS = 3; // heavier than a person; a near-center barrel still flies
const FIRE_DOT_PER_SECOND = 14; // hp/s for standing in flame → a player condition system
const FIREBALL_TTL = 0.6;
const FLASH_TTL = 0.35;

// ── the scene: a propane tank, a ring of loose barrels, a gasoline trail ──────
const TANK: { pos: V3; radius: number; height: number } = { pos: [2, 0, 0], radius: 0.45, height: 1.2 };
const TANK_CELL = { x: Math.round(TANK.pos[0]), z: Math.round(TANK.pos[2]) };

function spawnBarrels(): PhysicsBody[] {
  // a cluster around the tank — close ones launch hard, the far one barely rocks
  const spots: V3[] = [
    [3.4, 0.5, 0.6],
    [1.1, 0.5, 1.5],
    [2.7, 0.5, -1.6],
    [0.7, 0.5, -0.9],
    [4.0, 0.5, -0.8],
    [2.0, 0.5, 2.4],
  ];
  return spots.map((p) => ({ position: { x: p[0], y: p[1], z: p[2] }, velocity: { x: 0, y: 0, z: 0 }, radiusMeters: 0.5, restitution: 0.42 }));
}

// A gasoline trail: an L from a jerry can at the west, east along z=4, then
// south down x=2 right into the tank's cell. hasFuel answers the FireField.
const GAS_TRAIL: FuelPredicate = (x, z) =>
  (z === 4 && x >= -5 && x <= 2) || (x === 2 && z >= TANK_CELL.z && z <= 4);
const GAS_LIGHT_CELL = { x: -5, z: 4 }; // the far end the player lights
const GAS_TUNING = { spreadDelaySeconds: 0.28, burnSeconds: 4, diagonal: false, jitter: 0 };

// ── vector + ray helpers (the shoot ray, mirrored from combat-arena) ──────────
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function aimForward(yawDeg: number, pitchDeg: number): V3 {
  const y = yawDeg * DEG, pp = pitchDeg * DEG, cp = Math.cos(pp);
  return [-Math.sin(y) * cp, Math.sin(pp), -Math.cos(y) * cp];
}
function rayAABB(o: V3, dir: V3, center: V3, half: V3): number | null {
  let tMin = -Infinity, tMax = Infinity;
  for (let a = 0; a < 3; a++) {
    const od = o[a] - center[a], dd = dir[a], h = half[a];
    if (Math.abs(dd) < 1e-8) { if (od < -h || od > h) return null; continue; }
    let t1 = (-h - od) / dd, t2 = (h - od) / dd;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1); tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMax < 0 ? null : tMin >= 0 ? tMin : tMax;
}

type Fireball = { center: V3; born: number; radius: number };

// ── the lab ──────────────────────────────────────────────────────────────────
export default function ExplosivesLab() {
  const rerender = useRerender();

  // explosives state in refs — the substrate owns the loop; we mutate in onFrame.
  const barrelsRef = useRef<PhysicsBody[]>(spawnBarrels());
  const tankRef = useRef<Combustible>(GAME_FIRE.makeCombustible({ fuelSeconds: PROPANE_FUSE_SECONDS, damagePerSecond: 0, end: 'cookoff' }));
  const tankAliveRef = useRef(true);
  const fireRef = useRef<FireField>(GAME_FIRE.makeFireField());
  const fireActiveRef = useRef(false);
  const fxRef = useRef<Fireball[]>([]);
  const flashRef = useRef(0); // nowS the last flash started
  const hpRef = useRef(100);
  const deadRef = useRef(false);
  const logRef = useRef<string[]>([]);
  const lastTRef = useRef(GAME_LOOP.now());
  const prevLeftRef = useRef(false);
  const gateRef = useRef(0);

  const log = (line: string) => { logRef.current = [line, ...logRef.current].slice(0, 7); };

  // a flat arena: the default world stripped to its chunk floor (the ground).
  const arena = useMemo<GameState>(() => {
    const base = createInitialGameState();
    return {
      ...base,
      sceneStep: 'lab.aim',
      player: { ...base.player, position: { x: 0.5, y: 0, z: 9 }, yawDegrees: 180 },
      world: { ...base.world, roads: [], junctions: [], props: [], buildings: [], landforms: [], waterBodies: [], zones: [], spawnedEntities: {}, npcs: {} },
    };
  }, []);

  // the barrel bodies door: the substrate steps them with the player every frame
  // (capsule-vs-sphere = walk into one, kick it) and writes results back here.
  const worldExtras = useMemo(
    () => ({
      solids: { rects: [], orientedRects: [] as OrientedCollisionRect[] },
      bodies: {
        get: () => barrelsRef.current,
        commit: (stepped: SteppedBody[]) => {
          for (let i = 0; i < stepped.length && i < barrelsRef.current.length; i++) {
            barrelsRef.current[i].position = stepped[i].position;
            barrelsRef.current[i].velocity = stepped[i].velocity;
          }
        },
      },
    }),
    [],
  );

  const tickRef = useRef<() => void>(() => {});
  const embodied = useEmbodiedPlayer({
    state: arena,
    figureCartKey: 'hmscint.explosives.player',
    logTag: '[explosives]',
    aim: true,
    worldExtras,
    onFrame: () => { try { tickRef.current(); } catch (e) { console.error('[explosives] tick threw', e); } },
  });

  // ── the blast: barrels fly, the player is hurt, nearby gasoline lights ──────
  function detonateAt(center: V3, label: string) {
    const barrels = barrelsRef.current;
    const p = embodied.playerRef.current;
    const playerTarget = { position: { x: p.x, y: p.y + 0.9, z: p.z }, radiusMeters: 0.4 };
    const targets = [
      ...barrels.map((b) => ({ position: b.position, radiusMeters: b.radiusMeters, mass: BARREL_MASS })),
      playerTarget,
    ];
    const { hits } = GAME_EXPLOSION.blastAt(
      { center: { x: center[0], y: center[1], z: center[2] }, ...PROPANE_BLAST },
      targets,
    );
    let hurt = 0;
    for (const hit of hits) {
      if (hit.index < barrels.length) {
        const v = barrels[hit.index].velocity;
        v.x += hit.impulse.x; v.y += hit.impulse.y; v.z += hit.impulse.z;
      } else {
        hurt = hit.damage;
        hpRef.current = Math.max(0, hpRef.current - hit.damage);
        if (hpRef.current <= 0) deadRef.current = true;
      }
    }
    // the blast lights any gasoline it reaches (a chain the other direction)
    let lit = 0;
    for (let z = TANK_CELL.z; z <= 4; z++) for (let x = -5; x <= 2; x++) {
      if (!GAS_TRAIL(x, z)) continue;
      if (Math.hypot(x - center[0], z - center[2]) > PROPANE_BLAST.radiusMeters) continue;
      const before = GAME_FIRE.burningCells(fireRef.current).length;
      fireRef.current = GAME_FIRE.igniteCell(fireRef.current, x, z, GAS_TRAIL);
      if (GAME_FIRE.burningCells(fireRef.current).length > before) { lit++; fireActiveRef.current = true; }
    }
    const nowS = GAME_LOOP.now() / 1000;
    fxRef.current.push({ center: [center[0], center[1] + 0.6, center[2]], born: nowS, radius: PROPANE_BLAST.radiusMeters * 0.55 });
    flashRef.current = nowS;
    log(`${label} — ${hits.filter((h) => h.index < barrels.length).length} barrels launched, you −${Math.round(hurt)}${lit ? `, gas lit ×${lit}` : ''}`);
  }

  function igniteTank(why: string) {
    if (!tankAliveRef.current) return;
    const t = tankRef.current;
    if (t.burning || t.spent) return;
    tankRef.current = GAME_FIRE.ignite(t);
    log(`tank lit (${why}) — fuse ${PROPANE_FUSE_SECONDS}s`);
  }

  const tick = () => {
    const now = GAME_LOOP.now();
    const dt = clamp((now - lastTRef.current) / 1000, 0.001, 0.05);
    lastTRef.current = now;
    const nowS = now / 1000;
    const p = embodied.playerRef.current;
    const look = embodied.lookRef.current;
    const ptr = GAME_INPUT.readPointer();
    const aiming = embodied.mouseCaptured && ptr.rightDown && !deadRef.current;

    // ── PLAYER FIRE: a host-camera ray vs the tank box (shoot it to set it off) ─
    const fireEdge = ptr.leftDown && !prevLeftRef.current;
    prevLeftRef.current = ptr.leftDown;
    if (aiming && fireEdge && tankAliveRef.current) {
      const hostRay = GAME_NATIVE_CAMERA.activeRay();
      const origin: V3 = hostRay ? hostRay.origin : [p.x, p.y + EYE_HEIGHT, p.z];
      const dir: V3 = hostRay
        ? normalize(hostRay.dir)
        : aimForward(GAME_CAMERA.orientation.figureYawForCameraYaw(look.yaw), GAME_CAMERA.orientation.orbitPitchToAimPitch(look.pitch));
      const t = rayAABB(origin, dir, [TANK.pos[0], TANK.height / 2, TANK.pos[2]], [TANK.radius, TANK.height / 2, TANK.radius]);
      if (t != null && t > 0 && t <= 60) igniteTank('shot');
      else log('shot — missed the tank');
    }

    // ── tank combustion: ignite → fuse → cookoff blast ─────────────────────────
    if (tankAliveRef.current && tankRef.current.burning) {
      const step = GAME_FIRE.stepCombustible(tankRef.current, dt);
      tankRef.current = step.state;
      if (step.event === 'cookoff') {
        tankAliveRef.current = false;
        detonateAt(TANK.pos, 'PROPANE COOKOFF');
      }
    }

    // ── gasoline: spread the front; chain the tank when it arrives ─────────────
    if (fireActiveRef.current) {
      const fstep = GAME_FIRE.stepFireField(fireRef.current, dt, GAS_TRAIL, GAS_TUNING);
      fireRef.current = fstep.field;
      const live = GAME_FIRE.burningCells(fireRef.current);
      if (live.length === 0) fireActiveRef.current = false;
      // fire touching the tank's cell (or just shy of it) sets the tank off
      if (tankAliveRef.current && !tankRef.current.burning &&
          (GAME_FIRE.isCellBurning(fireRef.current, TANK_CELL.x, TANK_CELL.z) ||
           GAME_FIRE.isCellBurning(fireRef.current, TANK_CELL.x, TANK_CELL.z + 1))) {
        igniteTank('gas reached it');
      }
      // standing in flame hurts
      if (!deadRef.current && GAME_FIRE.isCellBurning(fireRef.current, Math.round(p.x), Math.round(p.z))) {
        hpRef.current = Math.max(0, hpRef.current - FIRE_DOT_PER_SECOND * dt);
        if (hpRef.current <= 0) { deadRef.current = true; log('burned to death'); }
      }
    }

    // expire fireballs
    fxRef.current = fxRef.current.filter((f) => nowS - f.born < FIREBALL_TTL);

    // re-render at ~30Hz (barrels/fire/fx); the player figure re-renders via the substrate.
    gateRef.current++;
    if ((gateRef.current & 1) === 0) rerender();
  };
  tickRef.current = tick;

  const reset = () => {
    barrelsRef.current = spawnBarrels();
    tankRef.current = GAME_FIRE.makeCombustible({ fuelSeconds: PROPANE_FUSE_SECONDS, damagePerSecond: 0, end: 'cookoff' });
    tankAliveRef.current = true;
    fireRef.current = GAME_FIRE.makeFireField();
    fireActiveRef.current = false;
    fxRef.current = [];
    hpRef.current = 100;
    deadRef.current = false;
    logRef.current = [];
    embodied.resetPlayer();
    rerender();
  };

  const lightGas = () => {
    fireRef.current = GAME_FIRE.igniteCell(GAME_FIRE.makeFireField(), GAS_LIGHT_CELL.x, GAS_LIGHT_CELL.z, GAS_TRAIL);
    fireActiveRef.current = GAME_FIRE.burningCells(fireRef.current).length > 0;
    log('gasoline lit at the west end');
  };

  // ── render ────────────────────────────────────────────────────────────────
  const nowS = GAME_LOOP.now() / 1000;
  const barrels = barrelsRef.current;
  const flames = GAME_FIRE.burningCells(fireRef.current);
  const hp = hpRef.current;
  const aimingNow = embodied.mouseCaptured && GAME_INPUT.readPointer().rightDown && !deadRef.current;
  const flashAge = nowS - flashRef.current;
  const flashOn = flashAge >= 0 && flashAge < FLASH_TTL;

  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: BG }}>
      {/* ── left: the bench ──────────────────────────────────────────────────── */}
      <Col style={{ width: 232, height: '100%', backgroundColor: PANEL, padding: 12 }}>
        <Text style={{ color: INK, fontSize: 15 }}>explosives</Text>
        <Text style={{ color: DIM, fontSize: 10, marginBottom: 10 }}>propane cookoff · gasoline fire</Text>

        <Pressable onPress={() => igniteTank('button')}>
          <Box style={{ padding: 9, borderRadius: 6, backgroundColor: '#5a2410', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ color: '#fdba74', fontSize: 12 }}>detonate tank</Text>
          </Box>
        </Pressable>
        <Pressable onPress={lightGas}>
          <Box style={{ padding: 9, borderRadius: 6, backgroundColor: '#4a3a12', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ color: '#fde68a', fontSize: 12 }}>light gasoline (west end)</Text>
          </Box>
        </Pressable>
        <Pressable onPress={reset}>
          <Box style={{ padding: 9, borderRadius: 6, backgroundColor: '#16345a', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: '#7dd3fc', fontSize: 12 }}>reset</Text>
          </Box>
        </Pressable>

        <Text style={{ color: DIM, fontSize: 10, marginBottom: 4 }}>PLAYER · health</Text>
        <Row style={{ alignItems: 'center', marginBottom: 12 }}>
          <Box style={{ flexGrow: 1, height: 9, borderRadius: 4, backgroundColor: '#10203a', overflow: 'hidden' }}>
            <Box style={{ width: `${clamp(hp, 0, 100)}%`, height: '100%', backgroundColor: hp > 50 ? '#6fe08a' : hp > 25 ? '#f59e0b' : '#ef4444' }} />
          </Box>
          <Text style={{ color: FAINT, fontSize: 9, width: 28, textAlign: 'right' }}>{Math.max(0, Math.round(hp))}</Text>
        </Row>

        <Text style={{ color: DIM, fontSize: 10 }}>{`tank: ${tankAliveRef.current ? (tankRef.current.burning ? 'FUSE LIT' : 'intact') : 'detonated'}`}</Text>
        <Text style={{ color: DIM, fontSize: 10 }}>{`barrels: ${barrels.length} · flames: ${flames.length}`}</Text>

        <Box style={{ flexGrow: 1 }} />
        <Text style={{ color: DIM, fontSize: 10 }}>click scene to capture · Esc release</Text>
        <Text style={{ color: DIM, fontSize: 10 }}>WASD move · Shift run · Space jump</Text>
        <Text style={{ color: DIM, fontSize: 10 }}>RMB aim · LMB shoot the tank</Text>
        <Text style={{ color: DIM, fontSize: 10 }}>walk into barrels to kick them</Text>
        {!GAME_INPUT.availability().complete ? <Text style={{ color: '#fbbf24', fontSize: 9, marginTop: 4 }}>pointer wire absent — use the buttons</Text> : null}
      </Col>

      {/* ── right: the scene (the REAL embodied player) ──────────────────────── */}
      <Box style={{ flexGrow: 1, height: '100%', position: 'relative' }}>
        <EmbodiedScene embodied={embodied}>
          {/* a safety floor under the chunk floor so nothing floats */}
          <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} material="#0e1a28" position={[0, -0.2, 0]} scale={[200, 0.2, 200]} />

          {/* the gasoline trail (dark fuel sheen on the ground) */}
          {gasTrailCells().map((c, i) => (
            <Scene3D.Mesh key={`gas-${i}`} geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} material={{ color: '#1c2230', opacity: 0.85 } as any}
              position={[c.x, 0.02, c.z]} scale={[0.9, 0.04, 0.9]} />
          ))}

          {/* the propane tank (gone once detonated) */}
          {tankAliveRef.current ? (
            <Scene3D.Mesh geometry={Geometry.Cylinder} params={{ radius: 1, height: 1, segments: 12 }}
              material={tankRef.current.burning ? '#f97316' : '#c23b2a'}
              position={[TANK.pos[0], TANK.height / 2, TANK.pos[2]]} scale={[TANK.radius * 2, TANK.height, TANK.radius * 2]} />
          ) : (
            <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} material="#14110e"
              position={[TANK.pos[0], 0.02, TANK.pos[2]]} scale={[2.4, 0.04, 2.4]} />
          )}

          {/* the loose barrels (dynamic bodies the host steps) */}
          {barrels.map((b, i) => (
            <Scene3D.Mesh key={`barrel-${i}`} geometry={Geometry.Cylinder} params={{ radius: 1, height: 1, segments: 10 }} material="#3f6d52"
              position={[b.position.x, b.position.y, b.position.z]} scale={[b.radiusMeters * 2, b.radiusMeters * 2, b.radiusMeters * 2]} />
          ))}

          {/* flames on every burning cell (the crawling fire front) — variable
              length, but a stable own-container list so the reconciler keeps it */}
          <>
            {flames.map((c) => (
              <Scene3D.Mesh key={`flame-${c.x},${c.z}`} geometry={Geometry.Cone} params={{ radius: 1, height: 1, segments: 6 }} material={{ color: '#fb923c', opacity: 0.92 } as any}
                position={[c.x, 0.35, c.z]} scale={[0.7, 0.8, 0.7]} />
            ))}
          </>

          {/* the fireball(s): a bright sphere expanding and fading — DEAD LAST
              (variable length → reconciler sibling-shift guard) */}
          {fxRef.current.map((f, i) => {
            const t = clamp((nowS - f.born) / FIREBALL_TTL, 0, 1);
            const r = (0.6 + (f.radius - 0.6) * (1 - (1 - t) * (1 - t))) * 2; // ease-out diameter
            return (
              <Scene3D.Mesh key={`fb-${f.born}-${i}`} geometry={Geometry.Sphere} params={{ radius: 1, segments: 14 } as any}
                material={{ color: t < 0.35 ? '#fff1c2' : '#fb6a1a', opacity: 0.85 * (1 - t) } as any}
                position={f.center} scale={[r, r, r]} />
            );
          })}
        </EmbodiedScene>

        <EmbodiedMouseSurface embodied={embodied} />

        {/* the boom flash — full-screen white, fades fast (the host-free punch) */}
        {flashOn ? (
          <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: `rgba(255,240,210,${(0.62 * (1 - flashAge / FLASH_TTL)).toFixed(3)})` }} />
        ) : null}

        {/* crosshair while aiming (absolute children consume RAW left/top, not % —
            center with a full-area flex box) */}
        {aimingNow ? (
          <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <Box style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.85)' }} />
          </Box>
        ) : null}

        {/* event log */}
        <Box style={{ position: 'absolute', left: 12, bottom: 12, minWidth: 260, padding: 10, borderRadius: 8, backgroundColor: 'rgba(8,14,24,0.78)' }}>
          {logRef.current.length === 0 ? <Text style={{ color: FAINT, fontSize: 10 }}>shoot the tank (RMB+LMB) or light the gasoline — walk close and feel the blast</Text> : null}
          {logRef.current.map((line, i) => <Text key={i} style={{ color: i === 0 ? INK : DIM, fontSize: 10, fontFamily: 'monospace' }}>{line}</Text>)}
        </Box>

        {deadRef.current ? (
          <Box style={{ position: 'absolute', left: 0, right: 0, top: 24, alignItems: 'center' }}>
            <Box style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8, borderRadius: 8, backgroundColor: 'rgba(120,20,20,0.85)' }}>
              <Text style={{ color: '#fee2e2', fontSize: 14, fontFamily: 'monospace' }}>DEAD — too close to the boom. reset.</Text>
            </Box>
          </Box>
        ) : null}
      </Box>

      <EmbodiedCaptures embodied={embodied} />
    </Row>
  );
}

// the static fuel cells, for drawing the trail sheen on the ground
function gasTrailCells(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let z = TANK_CELL.z; z <= 4; z++) for (let x = -5; x <= 2; x++) if (GAS_TRAIL(x, z)) out.push({ x, z });
  return out;
}
