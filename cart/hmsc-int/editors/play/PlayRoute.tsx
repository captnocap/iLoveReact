// editors/play/PlayRoute — /test + /build FOLDED (PLAYFOLD-0605): ONE embodied
// game surface, two MODES, F-key toggled. The user's ruling: "its the same
// game, one is just build mode, one is test mode. fold it so that i can just
// toggle between them with the F keys like f1 f2."
//
//   F1 = TEST mode   the /test lineage's mode layer, in full: the backtick
//                    GAME_COMMANDS console (gv_speed drives the real walk/run,
//                    pv_teleport adopts back into the pose), RMB ADS aim, the
//                    [probe-player-model] gait/rig diagnostic, Drop in.
//   F2 = BUILD mode  the /build lineage's mode layer, in full: registry-driven
//                    palette + ruled hotkeys (R rotate · E edit · 1 floor ·
//                    2 wall · 3 ramp · 4 roof · X remove · P mark · G grab ·
//                    0 prefabs · [ ] variant), crosshair→snap→ghost→place,
//                    prefab capture, the Fortnite-verbatim HUD (HUD-0605),
//                    live P2 tuning, one-interaction-one-commit sessions.
//
// ONE ROUTE (/test, the ProjectBar Play button), MODE IS ROUTE STATE: the
// /build URL retired once the fold made it a dupe (USER: "remove the one
// route that is now just a dupe of it"). F1/F2 set the mode in place — the
// substrate never remounts: pose, camera, mouse capture, the console session,
// and the placed pieces all carry across the flip. Build a ramp, F1, walk it,
// F2, keep building. ('/build' survives only as the session channel label and
// the twig storage keys — those are names, not URLs.)
//
// THE UNION IS DELIBERATE (fold contract — nothing dropped, additions only
// where the fold makes the surface coherent):
//   • placed pieces are SOLID and VISIBLE in both modes (the world stream's
//     materialized truth is the one world — testing what you built is the
//     point of the toggle).
//   • the backtick console opens in both modes (build hotkeys gate while it's
//     open); its ctx speeds drive the walk/run everywhere on this surface.
//   • RMB ADS aim stays test-mode (build keeps the ruled walk-only camera so
//     the crosshair law's Orbit solve stays the picking truth).
//
// Lineage: TestRoute.tsx (V23 camera/console/probe authority) + editors/build/
// BuildRoute.tsx (V24 creative build) — both folded here verbatim; their mode
// layers are this file's two halves. Substrate: ../../Embodied (SUBSTRATE-0605).

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Scene3D, Text, TextInput } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import {
  GAME_BUILD, GAME_CAMERA, GAME_CHROME, GAME_COMMANDS, GAME_FIGURE, GAME_INPUT,
  GAME_ITEMS, GAME_LOOP, GAME_PHYSICS, GAME_WORLD, worldStream,
} from '@game';
import type {
  BuildMaterial, BuildPieceDef, BuildPieceKind, BuildPrefabDef, PieceRay,
  PlacedBuildPiece, WallEdit, WorldEvent, WorldStreamState,
} from '@game';
import type { GameState } from '../../../hmsc/design'; // GAP: retires when hmsc becomes compile/'s output (V15)
import {
  EmbodiedCaptures, EmbodiedMouseSurface, EmbodiedScene, PLAYER_CAMERA,
  groundColumnTop, normalizeYawDegrees, useEmbodiedPlayer,
  type EmbodiedWorldExtras, type PlayerPose,
} from '../../Embodied';
import { EmbodiedHud, HUD_TUNING, type HudCompassMarker, type HudFeedEntry, type HudSlotDef } from '../../EmbodiedHud';
import { C, accentFor } from '../../studio.cls';
import { editorChannel } from '../store';
import { editorSessions, type RouteSession } from '../sessions';
import { useRouteTwigState } from '../twigs';
import { resolveSnapTarget, SNAP_TUNING_DEFAULTS, type SnapTarget } from '../build/snap';

const DEG = Math.PI / 180;

export type PlayMode = 'test' | 'build';

// ── TEST-mode presentation: the console overlay (route chrome; the SESSION is
//    captured — GAME_COMMANDS.createConsoleSession owns toggle/dispatch). ─────
const CONSOLE_UI = {
  heightPercent: '46%',
  backdrop: '#0b1220e8',
  maxVisibleLines: 22,
  lineColor: { input: '#93c5fd', output: '#d1fae5', error: '#fb7185' } as Record<string, string>,
} as const;

// ── BUILD-mode presentation/feel data (P2: named values, no inline numbers) ──
const BUILD_UI = {
  ghostOpacity: 0.45,
  ghostColor: '#7dd3fc',
  ghostBlockedColor: '#fb7185',
  markColor: '#fbbf24',
  targetColor: '#a5f3fc',
  /** the snap indicator cube's edge, meters */
  indicatorSizeMeters: 0.14,
  /** ramp/stairs render as this many stepped boxes (visual only — collision
   *  is the real heightfield slope) */
  rampVisualSteps: 4,
  panelBg: '#0f1a2ef0',
} as const;

// The ruled category hotkeys lead the palette (USER VERDICT: 1 floor, 2 wall,
// 3 ramp, 4 roof); every other registry kind follows in registry order. The
// registry stays the source of WHAT exists — this only orders the display,
// and the chips show the same numbers the keys answer to.
const RULED_HOTKEY_KINDS: readonly BuildPieceKind[] = ['floor', 'wall', 'ramp', 'roof'];
const PALETTE_KIND_ORDER: readonly BuildPieceKind[] = [
  ...RULED_HOTKEY_KINDS,
  ...GAME_BUILD.kinds.kinds.filter((kind) => !RULED_HOTKEY_KINDS.includes(kind)),
];

// How each material READS (display table — gameplay truth stays in the
// catalog tags; glass opacity matches the materials.ts family look).
const MATERIAL_LOOK: Record<BuildMaterial, { color: string; opacity?: number }> = {
  concrete: { color: '#9aa3ad' },
  brick: { color: '#8a4a3a' },
  stucco: { color: '#d8cdb8' },
  wood: { color: '#8a6a45' },
  metal: { color: '#7d858d' },
  glass: { color: '#cfe6f2', opacity: 0.3 },
  chainlink: { color: '#b9c2c9', opacity: 0.45 },
};
const SIGHTLINE_EDIT_OPACITY: Partial<Record<WallEdit, number>> = {
  window: 0.35,
  doubleWindow: 0.3,
  brokenWindow: 0.12,
};

type Armed =
  | { type: 'piece'; id: string }
  | { type: 'prefab'; id: string };

// ── TEST-mode probe helpers ──────────────────────────────────────────────────

function dist3(a: readonly number[], b: readonly number[]): number {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function turnPlace(p: readonly number[], yawDeg: number, offset: readonly number[]): [number, number, number] {
  const rad = yawDeg * (Math.PI / 180);
  const c = Math.cos(rad), s = Math.sin(rad);
  return [p[0] * c + p[2] * s + offset[0], p[1] + offset[1], -p[0] * s + p[2] * c + offset[2]];
}

function movingAssemblyProbe(rig: ReturnType<typeof GAME_FIGURE.buildRigFrame>) {
  return rig.assembly.find((inst) => inst.bone === 'lUpperArm') ?? rig.assembly.find((inst) => inst.bone === 'lThigh') ?? rig.assembly[0];
}

function movingClothingProbe(rig: ReturnType<typeof GAME_FIGURE.buildRigFrame>) {
  return rig.clothing[3] ?? rig.clothing[0];
}

// ── BUILD-mode piece visuals: the same meaning the colliders carry, as boxes ─

type VisualBox = {
  key: string;
  cx: number; cy: number; cz: number;
  sx: number; sy: number; sz: number;
  yawDegrees: number;
  color: string;
  opacity?: number;
};

/** local (u along width, v along depth) → world offset, R(+yaw) — the same
 *  frame the colliders/raycast/stamp rotate with. */
function localOffset(u: number, v: number, yawDegrees: number): { dx: number; dz: number } {
  const cos = Math.cos(yawDegrees * DEG);
  const sin = Math.sin(yawDegrees * DEG);
  return { dx: u * cos - v * sin, dz: u * sin + v * cos };
}

function pieceVisualBoxes(
  piece: { pieceId: string; x: number; y: number; z: number; yawDegrees: number; edit?: WallEdit },
  key: string,
): VisualBox[] {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  const look = MATERIAL_LOOK[def.material];
  const size = def.size;
  const yaw = piece.yawDegrees;
  const box = (k: string, u: number, baseY: number, w: number, h: number, opacity?: number): VisualBox => {
    const { dx, dz } = localOffset(u, 0, yaw);
    return {
      key: `${key}.${k}`,
      cx: piece.x + dx, cy: baseY + h / 2, cz: piece.z + dz,
      sx: w, sy: h, sz: size.depthMeters,
      yawDegrees: yaw,
      color: look.color,
      opacity: opacity ?? look.opacity,
    };
  };

  if (def.kind === 'ramp' || def.kind === 'stairs') {
    // stepped boxes rising along local +v — the heightfield's own direction,
    // so what you see is the slope you walk
    const boxes: VisualBox[] = [];
    const steps = BUILD_UI.rampVisualSteps;
    for (let i = 0; i < steps; i += 1) {
      const v = (-size.depthMeters / 2) + ((i + 0.5) / steps) * size.depthMeters;
      const h = ((i + 1) / steps) * size.heightMeters;
      const { dx, dz } = localOffset(0, v, yaw);
      boxes.push({
        key: `${key}.s${i}`,
        cx: piece.x + dx, cy: piece.y + h / 2, cz: piece.z + dz,
        sx: size.widthMeters, sy: h, sz: size.depthMeters / steps,
        yawDegrees: yaw,
        color: look.color,
        opacity: look.opacity,
      });
    }
    return boxes;
  }

  const edit = piece.edit;
  if (edit !== undefined && GAME_BUILD.kinds.get(def.kind).edits === 'wall') {
    const meaning = GAME_BUILD.edits.wall[edit];
    if (meaning.portalKind !== 'none') {
      // the opening is OPEN — render the two jambs the collider keeps
      const opening = meaning.portalKind === 'vehicle'
        ? GAME_BUILD.placed.tuning.vehicleOpeningWidthMeters
        : GAME_BUILD.placed.tuning.walkOpeningWidthMeters;
      const jamb = (size.widthMeters - opening) / 2;
      if (jamb <= 0) return [];
      return [
        box('l', -(size.widthMeters - jamb) / 2, piece.y, jamb, size.heightMeters),
        box('r', (size.widthMeters - jamb) / 2, piece.y, jamb, size.heightMeters),
      ];
    }
    if (edit === 'halfHeight') {
      return [box('half', 0, piece.y, size.widthMeters, GAME_BUILD.placed.tuning.halfHeightTopMeters)];
    }
    const paneOpacity = SIGHTLINE_EDIT_OPACITY[edit];
    if (paneOpacity !== undefined) {
      return [box('pane', 0, piece.y, size.widthMeters, size.heightMeters, paneOpacity)];
    }
  }
  return [box('body', 0, piece.y, size.widthMeters, size.heightMeters)];
}

function VisualBoxMesh(props: { box: VisualBox; colorOverride?: string; opacityOverride?: number }) {
  const b = props.box;
  return (
    <Scene3D.Mesh
      geometry={Geometry.Box}
      params={{ width: 1, height: 1, depth: 1 }}
      scale={[b.sx, b.sy, b.sz]}
      rotation={[0, b.yawDegrees, 0]}
      position={[b.cx, b.cy, b.cz]}
      material={{ color: props.colorOverride ?? b.color, opacity: props.opacityOverride ?? b.opacity ?? 1 }}
    />
  );
}

// The standing pieces — memo'd so camera/walk frames don't re-diff the city.
// Rendered in BOTH modes: the stream's materialized truth is the one world.
const PlacedPieceMeshes = memo(function PlacedPieceMeshes(props: {
  pieces: readonly PlacedBuildPiece[];
  markedIds: ReadonlySet<string>;
  targetId: string | null;
}) {
  return (
    <>
      {props.pieces.flatMap((piece) =>
        pieceVisualBoxes(piece, piece.id).map((b) => (
          <VisualBoxMesh
            key={b.key}
            box={b}
            colorOverride={props.markedIds.has(piece.id) ? BUILD_UI.markColor : props.targetId === piece.id ? BUILD_UI.targetColor : undefined}
          />
        )))}
    </>
  );
});

// ── chips (route chrome) ─────────────────────────────────────────────────────

/** HUD-family chip for the blueprint selection (tokens via studio.cls; the
 *  active state colors are raw values read through accentFor — user props are
 *  not token-resolved). */
function BlueprintChip(props: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress}>
      <C.HudPanel
        style={{
          paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3,
          ...(props.on ? { backgroundColor: accentFor('segActiveBg'), borderColor: accentFor('primary') } : {}),
        }}
      >
        <C.HudKeyTag style={props.on ? { color: accentFor('hudText') } : undefined}>{props.label}</C.HudKeyTag>
      </C.HudPanel>
    </Pressable>
  );
}

function Chip(props: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={{
        paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
        borderRadius: 5, borderWidth: 1,
        borderColor: props.on ? '#38bdf8' : '#27364a',
        backgroundColor: props.on ? '#0c4a6e' : '#0f1a2e',
      }}
    >
      <Text fontSize={10} color={props.on ? '#e0f2fe' : '#94a3b8'} style={{ fontWeight: 700 }}>{props.label}</Text>
    </Pressable>
  );
}

// ── the folded route ─────────────────────────────────────────────────────────

export function PlayRoute(props: {
  state: GameState;
  mapName: string;
  onExit: () => void;
}) {
  // Mode is route state (ONE route since the /build dupe retired) — F1/F2
  // flip it in place, nothing remounts.
  const [mode, setMode] = useState<PlayMode>('test');
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // ── the builder's session on the WORLD channel (the user's V20 ruling).
  //    Opened for the surface's lifetime — commits only flow from build-mode
  //    interactions; the '/build' channel id is the settings bus's name for it. ─
  const build = useMemo(() => {
    try {
      const channel = editorChannel(worldStream);
      return { channel, session: editorSessions().open('/build', channel) as RouteSession<WorldEvent>, error: null as string | null };
    } catch (error: any) {
      return { channel: null, session: null, error: String(error?.message ?? error) };
    }
  }, []);
  useEffect(() => () => build.session?.close(), [build]);

  // The stream's materialized state IS the placed-piece truth; rev bumps
  // after each commit and the route re-reads — no second copy anywhere.
  const [piecesRev, setPiecesRev] = useState(0);
  const streamState: WorldStreamState | null = useMemo(
    () => (build.channel ? build.channel.state() : null),
    [build, piecesRev],
  );
  const pieces = streamState?.pieces ?? [];
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;

  // ── the player: the shared embodied substrate, fed BOTH lineages' options ──
  // Placed pieces join the world as solids + ramp/stairs heightfields in BOTH
  // modes (you built it, you can test it). The crosshair re-resolves on the
  // substrate's frame and a captured tap places — build mode only, gated at
  // call time through modeRef (the substrate reads options per frame).
  const worldExtras = useMemo<EmbodiedWorldExtras>(() => ({
    solids: GAME_BUILD.placed.colliders(pieces),
    registerHeightfields: (worldBake) => {
      const ramps = GAME_BUILD.placed.ramps(pieces, worldBake.fields.length);
      let registered = 0;
      for (const field of ramps) {
        if (field.slot >= GAME_WORLD.heightfieldSlots) break;
        GAME_PHYSICS.registerHeightfield(field);
        registered += 1;
      }
      if (registered < ramps.length) console.warn(`[play] ${ramps.length - registered} ramp slopes past the heightfield slots`);
    },
  }), [pieces]);
  const embodied = useEmbodiedPlayer({
    state: props.state,
    figureCartKey: 'hmscint.play.player',
    logTag: '[play]',
    // RMB ADS stays the test lineage's layer; build keeps the ruled walk-only
    // camera (the crosshair law's Orbit solve is the picking truth). The
    // substrate handles a mid-aim mode flip (aim option read per frame).
    aim: mode === 'test',
    isTyping: () => gameConsole.session.isOpen(),
    speeds: () => gameConsole.ctx.player,
    worldExtras,
    onFrame: () => { if (modeRef.current === 'build') refreshSnapRef.current(); },
    onTap: () => { if (modeRef.current === 'build') placeRef.current(); },
  });
  const { player, playerRef, lookRef, rig, figureOffset, pointerWire, worldGrid } = embodied;

  // ── F1/F2: the mode toggle (the fold's reason to exist) — route state,
  //    flipped in place; no remount, the pose and the world carry across. ───
  useEffect(() => {
    const off = GAME_INPUT.onKeyDown((event) => {
      const key = String(event?.key ?? '').toLowerCase();
      if (key === 'f1') setMode('test');
      if (key === 'f2') setMode('build');
    });
    return off;
  }, []);

  // ════ TEST lineage: the backtick console (CS idiom) ═══════════════════════
  // Available in BOTH modes (the fold's union): the session is the captured
  // GAME_COMMANDS console over a per-mount GameCommandState seeded from the
  // authored map (world slice COPIED — the console edits its own copy;
  // rendered-world unification is the world lane's integration ticket). Pose
  // syncs in before each command (pv_where tells the truth) and position
  // changes adopt back out (pv_teleport/pv_respawn move the player). Its ctx
  // speeds drive the real walk/run everywhere on this surface (gv_speed).
  const gameConsole = useMemo(() => {
    type GameCtx = ReturnType<typeof GAME_COMMANDS.createGameState>;
    const registry = GAME_COMMANDS.createRegistry<GameCtx>();
    GAME_COMMANDS.defineGameCommands(registry);
    const ctx = GAME_COMMANDS.createGameState();
    ctx.player.walkSpeedMetersPerSecond = props.state.player.walkSpeedMetersPerSecond;
    ctx.player.runSpeedMetersPerSecond = props.state.player.runSpeedMetersPerSecond;
    ctx.world.cellSizeMeters = props.state.world.cellSizeMeters;
    ctx.world.surfaceRegions = [...props.state.world.surfaceRegions] as GameCtx['world']['surfaceRegions'];
    ctx.world.placedCells = { ...props.state.world.placedCells } as GameCtx['world']['placedCells'];
    ctx.world.landforms = [...(props.state.world.landforms ?? [])] as GameCtx['world']['landforms'];
    const session = GAME_COMMANDS.createConsoleSession(registry, ctx, {
      beforeRun: (c) => {
        const p = playerRef.current;
        c.player.position = { x: p.x, y: p.y, z: p.z };
        c.player.yawDegrees = p.yaw;
        c.player.physics.velocity = { x: p.vx, y: p.vy, z: p.vz };
        c.player.physics.grounded = p.grounded;
      },
      afterRun: (c) => {
        const p = playerRef.current;
        const moved =
          Math.abs(c.player.position.x - p.x) > 1e-6 ||
          Math.abs(c.player.position.y - p.y) > 1e-6 ||
          Math.abs(c.player.position.z - p.z) > 1e-6;
        if (moved) {
          const next: PlayerPose = {
            ...p,
            x: c.player.position.x, y: c.player.position.y, z: c.player.position.z,
            vx: 0, vy: 0, vz: 0,
            yaw: normalizeYawDegrees(c.player.yawDegrees),
          };
          embodied.adoptPose(next); // teleport — the camera follows
        }
      },
    });
    return { ctx, session };
  }, [props.state]);
  // Mirror the session's revision into React state so the overlay re-renders
  // on toggle/typing/output. The game KEEPS PLAYING — nothing here pauses the
  // frame loop; it only gates key reads while open (the substrate's isTyping).
  const [, setConsoleRev] = useState(0);
  const consoleOpen = gameConsole.session.isOpen();
  useEffect(() => {
    const offDown = GAME_INPUT.onKeyDown((event) => {
      const before = gameConsole.session.revision();
      gameConsole.session.handleKey(event ?? {});
      if (gameConsole.session.revision() !== before) setConsoleRev(gameConsole.session.revision());
    });
    // keyups re-arm the toggle edge (one physical press = exactly one flip;
    // the engine bus delivers SDL key repeats unfiltered).
    const offUp = GAME_INPUT.onKeyUp((event) => gameConsole.session.handleKeyUp(event ?? {}));
    return () => {
      offDown();
      offUp();
    };
  }, [gameConsole]);

  // ════ TEST lineage: the [probe-player-model] gait/rig diagnostic ══════════
  // Runs in test mode only (its lineage); build mode clears the last samples
  // so re-entering test never reads a phantom mega-delta.
  const playerProbeRef = useRef({
    lastLog: 0,
    frames: 0,
    rootMoves: 0,
    assemblyMoves: 0,
    clothingMoves: 0,
    assemblyLocalMoves: 0,
    clothingLocalMoves: 0,
    dtSum: 0,
    maxRootDelta: 0,
    maxAssemblyDelta: 0,
    maxClothingDelta: 0,
    maxAssemblyLocalDelta: 0,
    maxClothingLocalDelta: 0,
    zeroAssemblyLocalWhileRoot: 0,
    zeroClothingLocalWhileRoot: 0,
    lastRoot: null as [number, number, number] | null,
    lastAssembly: null as [number, number, number] | null,
    lastClothing: null as [number, number, number] | null,
    lastAssemblyLocal: null as [number, number, number] | null,
    lastClothingLocal: null as [number, number, number] | null,
    lastRenderNow: 0,
  });
  useEffect(() => {
    const probe = playerProbeRef.current;
    if (mode !== 'test') {
      probe.lastRoot = null;
      probe.lastAssembly = null;
      probe.lastClothing = null;
      probe.lastAssemblyLocal = null;
      probe.lastClothingLocal = null;
      probe.lastRenderNow = 0;
      return;
    }
    const now = GAME_LOOP.now();
    const dtMs = probe.lastRenderNow > 0 ? now - probe.lastRenderNow : 0;
    probe.lastRenderNow = now;
    const root = figureOffset;
    const assemblySample = movingAssemblyProbe(rig);
    const clothingSample = movingClothingProbe(rig);
    const assemblyLocal = turnPlace(assemblySample?.position ?? [0, 0, 0], player.yaw, [0, 0, 0]);
    const clothingLocal = turnPlace(clothingSample?.position ?? assemblySample?.position ?? [0, 0, 0], player.yaw, [0, 0, 0]);
    const assembly = turnPlace(assemblySample?.position ?? [0, 0, 0], player.yaw, figureOffset);
    const clothing = turnPlace(clothingSample?.position ?? assemblySample?.position ?? [0, 0, 0], player.yaw, figureOffset);
    if (probe.lastRoot && probe.lastAssembly && probe.lastClothing && probe.lastAssemblyLocal && probe.lastClothingLocal) {
      const rootDelta = dist3(root, probe.lastRoot);
      const assemblyDelta = dist3(assembly, probe.lastAssembly);
      const clothingDelta = dist3(clothing, probe.lastClothing);
      const assemblyLocalDelta = dist3(assemblyLocal, probe.lastAssemblyLocal);
      const clothingLocalDelta = dist3(clothingLocal, probe.lastClothingLocal);
      probe.frames += 1;
      probe.dtSum += dtMs;
      if (rootDelta > 1e-5) probe.rootMoves += 1;
      if (assemblyDelta > 1e-5) probe.assemblyMoves += 1;
      if (clothingDelta > 1e-5) probe.clothingMoves += 1;
      if (assemblyLocalDelta > 1e-5) probe.assemblyLocalMoves += 1;
      if (clothingLocalDelta > 1e-5) probe.clothingLocalMoves += 1;
      if (rootDelta > 1e-5 && assemblyLocalDelta <= 1e-5) probe.zeroAssemblyLocalWhileRoot += 1;
      if (rootDelta > 1e-5 && clothingLocalDelta <= 1e-5) probe.zeroClothingLocalWhileRoot += 1;
      probe.maxRootDelta = Math.max(probe.maxRootDelta, rootDelta);
      probe.maxAssemblyDelta = Math.max(probe.maxAssemblyDelta, assemblyDelta);
      probe.maxClothingDelta = Math.max(probe.maxClothingDelta, clothingDelta);
      probe.maxAssemblyLocalDelta = Math.max(probe.maxAssemblyLocalDelta, assemblyLocalDelta);
      probe.maxClothingLocalDelta = Math.max(probe.maxClothingLocalDelta, clothingLocalDelta);
    }
    probe.lastRoot = [...root] as [number, number, number];
    probe.lastAssembly = assembly;
    probe.lastClothing = clothing;
    probe.lastAssemblyLocal = assemblyLocal;
    probe.lastClothingLocal = clothingLocal;
    if (now - probe.lastLog >= 1000 && probe.frames > 0) {
      console.log(
        `[probe-player-model] frames=${probe.frames} avgRenderDtMs=${(probe.dtSum / probe.frames).toFixed(2)} ` +
        `rootMoves=${probe.rootMoves} assemblyWorldMoves=${probe.assemblyMoves} clothingWorldMoves=${probe.clothingMoves} ` +
        `assemblyLocalMoves=${probe.assemblyLocalMoves} clothingLocalMoves=${probe.clothingLocalMoves} ` +
        `zeroAssemblyLocalWhileRoot=${probe.zeroAssemblyLocalWhileRoot} zeroClothingLocalWhileRoot=${probe.zeroClothingLocalWhileRoot} ` +
        `maxRootDelta=${probe.maxRootDelta.toFixed(4)} maxAssemblyWorldDelta=${probe.maxAssemblyDelta.toFixed(4)} maxClothingWorldDelta=${probe.maxClothingDelta.toFixed(4)} ` +
        `maxAssemblyLocalDelta=${probe.maxAssemblyLocalDelta.toFixed(4)} maxClothingLocalDelta=${probe.maxClothingLocalDelta.toFixed(4)} ` +
        `root=(${root.map((n) => n.toFixed(3)).join(',')}) assemblyProbe=(${assembly.map((n) => n.toFixed(3)).join(',')}) clothingProbe=(${clothing.map((n) => n.toFixed(3)).join(',')})`,
      );
      probe.lastLog = now;
      probe.frames = 0;
      probe.rootMoves = 0;
      probe.assemblyMoves = 0;
      probe.clothingMoves = 0;
      probe.assemblyLocalMoves = 0;
      probe.clothingLocalMoves = 0;
      probe.dtSum = 0;
      probe.maxRootDelta = 0;
      probe.maxAssemblyDelta = 0;
      probe.maxClothingDelta = 0;
      probe.maxAssemblyLocalDelta = 0;
      probe.maxClothingLocalDelta = 0;
      probe.zeroAssemblyLocalWhileRoot = 0;
      probe.zeroClothingLocalWhileRoot = 0;
    }
  }, [figureOffset, player.yaw, rig, mode]);

  // ════ BUILD lineage: live tuning (P2 in-interface; '/build' twig keys keep
  //      every saved value from the pre-fold route) ══════════════════════════
  const [reachMeters, setReachMeters] = useRouteTwigState('/build', 'reachMeters', SNAP_TUNING_DEFAULTS.reachMeters);
  const [ghostOpacity, setGhostOpacity] = useRouteTwigState<number>('/build', 'ghostOpacity', BUILD_UI.ghostOpacity);
  const [marchStep, setMarchStep] = useRouteTwigState('/build', 'marchStep', SNAP_TUNING_DEFAULTS.groundMarchStepMeters);
  const [showTuning, setShowTuning] = useRouteTwigState('/build', 'showTuning', false);
  const snapTuning = useMemo(() => ({
    ...SNAP_TUNING_DEFAULTS,
    reachMeters,
    groundMarchStepMeters: marchStep,
  }), [reachMeters, marchStep]);
  const snapTuningRef = useRef(snapTuning);
  snapTuningRef.current = snapTuning;

  // ── the palette (registry-driven: the catalog is the source) ──────────────
  const kinds = PALETTE_KIND_ORDER;
  const prefabDefs = useMemo<BuildPrefabDef[]>(() => [
    ...GAME_BUILD.prefabs.ids.map((id) => GAME_BUILD.prefabs.get(id)),
    ...Object.values(streamState?.prefabs ?? {}),
  ], [streamState]);
  const [armed, setArmed] = useRouteTwigState<Armed>('/build', 'armed', (() => {
    const first = GAME_BUILD.catalog.byKind(kinds[0])[0];
    return { type: 'piece', id: first.id };
  })());
  const armedRef = useRef(armed);
  armedRef.current = armed;
  const armedDef: BuildPieceDef | null = armed.type === 'piece' ? GAME_BUILD.catalog.get(armed.id) : null;
  const armedPrefab: BuildPrefabDef | null = armed.type === 'prefab' ? (prefabDefs.find((d) => d.id === armed.id) ?? null) : null;
  const armedKind: BuildPieceKind | 'prefab' = armed.type === 'prefab' ? 'prefab' : armedDef!.kind;
  const entriesOfArmedKind = armedKind === 'prefab' ? [] : GAME_BUILD.catalog.byKind(armedKind);
  const prefabDefsRef = useRef(prefabDefs);
  prefabDefsRef.current = prefabDefs;

  const armKind = (kind: BuildPieceKind | 'prefab') => {
    if (kind === 'prefab') {
      const first = prefabDefsRef.current[0];
      if (first) setArmed({ type: 'prefab', id: first.id });
      return;
    }
    const first = GAME_BUILD.catalog.byKind(kind)[0];
    if (first) setArmed({ type: 'piece', id: first.id });
  };
  const cycleEntry = (direction: 1 | -1) => {
    const current = armedRef.current;
    if (current.type === 'prefab') {
      const list = prefabDefsRef.current;
      if (list.length === 0) return;
      const index = Math.max(0, list.findIndex((d) => d.id === current.id));
      setArmed({ type: 'prefab', id: list[(index + direction + list.length) % list.length].id });
      return;
    }
    const list = GAME_BUILD.catalog.byKind(GAME_BUILD.catalog.get(current.id).kind);
    const index = Math.max(0, list.findIndex((d) => d.id === current.id));
    setArmed({ type: 'piece', id: list[(index + direction + list.length) % list.length].id });
  };

  // ghost rotation (R) — a ref for the frame loop + state for the HUD
  const [ghostYaw, setGhostYaw] = useRouteTwigState('/build', 'ghostYaw', 0);
  const ghostYawRef = useRef(ghostYaw);

  // ── crosshair → snap target (recomputed on the substrate's frame, published
  //    only when the SNAPPED result changes — quantized values make that cheap) ─
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null);
  const snapTargetRef = useRef<SnapTarget | null>(null);
  const snapKeyRef = useRef('');

  // The crosshair law: the screen-center axis of the camera the renderer is
  // consuming. The substrate's look shadow + PLAYER_CAMERA are the SAME
  // values the native controller was parameterized with, so this JS solve is
  // registry math for PICKING only — the render drive stays host-side (V23).
  const crosshairRay = (): PieceRay => {
    const p = playerRef.current;
    const l = lookRef.current;
    const solved = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, {
      target: [p.x, p.y + PLAYER_CAMERA.targetHeightMeters, p.z],
      yaw: l.yaw,
      pitch: l.pitch,
      dist: PLAYER_CAMERA.distanceMeters,
      fov: PLAYER_CAMERA.fovDegrees,
    });
    const dx = solved.target[0] - solved.pos[0];
    const dy = solved.target[1] - solved.pos[1];
    const dz = solved.target[2] - solved.pos[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    return {
      origin: { x: solved.pos[0], y: solved.pos[1], z: solved.pos[2] },
      dir: { x: dx / len, y: dy / len, z: dz / len },
    };
  };
  const crosshairRayRef = useRef(crosshairRay);
  crosshairRayRef.current = crosshairRay;

  const refreshSnapTarget = () => {
    const current = armedRef.current;
    const def = current.type === 'piece' ? GAME_BUILD.catalog.get(current.id) : null;
    // prefab stamps drop on the grid; pieces use their OWN catalog snap mode
    const snap = def ? def.snap : 'grid';
    const size = def ? def.size : { widthMeters: 1, heightMeters: 3, depthMeters: 1 };
    const target = resolveSnapTarget({
      ray: crosshairRayRef.current(),
      pieces: piecesRef.current,
      groundTopAt: (x, z) => groundColumnTop(worldGrid, x, z),
      snap,
      size,
      yawDegrees: ghostYawRef.current,
      tuning: snapTuningRef.current,
    });
    const key = target
      ? `${target.surface}:${target.placement.x.toFixed(3)},${target.placement.y.toFixed(3)},${target.placement.z.toFixed(3)},${target.placement.yawDegrees}:${target.targetPieceId ?? ''}`
      : 'none';
    if (key !== snapKeyRef.current) {
      snapKeyRef.current = key;
      snapTargetRef.current = target;
      setSnapTarget(target);
    }
  };
  const refreshSnapRef = useRef(refreshSnapTarget);
  refreshSnapRef.current = refreshSnapTarget;

  // ── one commit per interaction (the editors/sessions ruling) ──────────────
  const commit = (event: WorldEvent, label: string): boolean => {
    if (!build.session) return false;
    build.session.commit(event, label);
    setPiecesRev((r) => r + 1);
    return true;
  };

  const place = () => {
    const target = snapTargetRef.current;
    if (!target || !build.session) return;
    const current = armedRef.current;
    const at = `${target.placement.x.toFixed(1)},${target.placement.z.toFixed(1)}`;
    if (current.type === 'prefab') {
      const def = prefabDefsRef.current.find((d) => d.id === current.id);
      if (!def) return;
      commit(
        { kind: 'prefabStamped', prefabId: def.id, origin: { x: target.placement.x, y: target.placement.y, z: target.placement.z }, yawDegrees: target.placement.yawDegrees },
        `stamped ${def.label} @ ${at}`,
      );
      return;
    }
    const def = GAME_BUILD.catalog.get(current.id);
    const placement = {
      pieceId: def.id,
      x: target.placement.x,
      y: target.placement.y,
      z: target.placement.z,
      yawDegrees: target.placement.yawDegrees,
    };
    const problems = GAME_BUILD.placed.validatePlacement(placement);
    if (problems.length > 0) {
      console.warn(`[play] placement refused: ${problems.join('; ')}`);
      return;
    }
    commit({ kind: 'piecePlaced', placement }, `placed ${def.label} @ ${at}`);
  };
  const placeRef = useRef(place);
  placeRef.current = place;

  // ── prefab capture (P marks → name → save) ────────────────────────────────
  const [markedIdList, setMarkedIdList] = useRouteTwigState<string[]>('/build', 'markedIds', []);
  const markedIds = useMemo<ReadonlySet<string>>(() => new Set(markedIdList), [markedIdList]);
  const setMarkedIds = (next: ReadonlySet<string> | ((prev: ReadonlySet<string>) => ReadonlySet<string>)): void => {
    setMarkedIdList((prevList) => {
      const prevSet = new Set(prevList);
      const nextSet = typeof next === 'function' ? next(prevSet) : next;
      return [...nextSet];
    });
  };
  const markedRef = useRef(markedIds);
  markedRef.current = markedIds;
  const [prefabName, setPrefabName] = useRouteTwigState('/build', 'prefabName', '');

  const savePrefab = () => {
    const ids = markedRef.current;
    if (!build.session || ids.size === 0) return;
    const composition = piecesRef.current.filter((p) => ids.has(p.id));
    const label = prefabName.trim() || `Prefab ${prefabDefsRef.current.length + 1}`;
    let id = GAME_BUILD.placed.mintPrefabId(label);
    let suffix = 2;
    while (prefabDefsRef.current.some((d) => d.id === id)) id = `${GAME_BUILD.placed.mintPrefabId(label)}${suffix++}`;
    const def = GAME_BUILD.placed.prefabFromPieces(id, label, 'common', composition);
    const problems = GAME_BUILD.prefabs.validate({ [def.id]: def });
    if (problems.length > 0) {
      console.warn(`[play] prefab refused: ${problems.join('; ')}`);
      return;
    }
    commit({ kind: 'prefabDefined', def }, `prefab ${label} (${composition.length} pieces)`);
    setMarkedIds(new Set());
    setPrefabName('');
    setArmed({ type: 'prefab', id: def.id }); // clone → stamp, one motion
  };

  // ── the builder keys (route chrome; typing-gated AND build-mode-gated —
  //    the open console owns printables in either mode). USER-RULED hotkeys:
  //    R rotate · E edit · 1 floor · 2 wall · 3 ramp · 4 roof ────────────────
  useEffect(() => {
    const off = GAME_INPUT.onKeyDown((event) => {
      if (modeRef.current !== 'build') return;
      if (GAME_INPUT.isTextEditing()) return;
      if (gameConsole.session.isOpen()) return;
      const key = String(event?.key ?? '').toLowerCase();
      if (key >= '1' && key <= '9') {
        const index = Number(key) - 1;
        if (index < kinds.length) armKind(kinds[index]);
        return;
      }
      if (key === '0') {
        armKind('prefab');
        return;
      }
      if (key === '[') { cycleEntry(-1); return; }
      if (key === ']') { cycleEntry(1); return; }
      if (key === 'r') {
        ghostYawRef.current = normalizeYawDegrees(ghostYawRef.current + 90);
        setGhostYaw(ghostYawRef.current);
        refreshSnapRef.current();
        return;
      }
      const targetId = snapTargetRef.current?.targetPieceId ?? null;
      if (key === 'e' && targetId) {
        const piece = piecesRef.current.find((p) => p.id === targetId);
        if (!piece || !GAME_BUILD.placed.acceptsEdits(piece)) return;
        const edits = GAME_BUILD.edits.wallEdits;
        const next = edits[(edits.indexOf(piece.edit ?? 'solid') + 1) % edits.length];
        commit({ kind: 'pieceEditSet', id: piece.id, edit: next }, `${piece.id}: edit → ${next}`);
        return;
      }
      if (key === 'x' && targetId) {
        commit({ kind: 'pieceRemoved', id: targetId }, `removed ${targetId}`);
        setMarkedIds((prev) => {
          if (!prev.has(targetId)) return prev;
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
        return;
      }
      if (key === 'p' && targetId) {
        setMarkedIds((prev) => {
          const next = new Set(prev);
          if (next.has(targetId)) next.delete(targetId);
          else next.add(targetId);
          return next;
        });
        return;
      }
      // SMARTSEL-0605: G grabs the whole connected shape under the crosshair
      // (every piece transitively touching the target). Pressing G on a shape
      // that is already fully marked unmarks it — the P toggle, shape-sized.
      if (key === 'g' && targetId) {
        const shape = GAME_BUILD.placed.connected(targetId, piecesRef.current);
        if (shape.size === 0) return;
        setMarkedIds((prev) => {
          let allMarked = true;
          for (const id of shape) if (!prev.has(id)) { allMarked = false; break; }
          const next = new Set(prev);
          for (const id of shape) {
            if (allMarked) next.delete(id);
            else next.add(id);
          }
          return next;
        });
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ghost boxes for the armed selection at the snap target ────────────────
  const ghostBoxes = useMemo<VisualBox[]>(() => {
    if (!snapTarget) return [];
    const p = snapTarget.placement;
    if (armedPrefab) {
      return GAME_BUILD.placed
        .stamp(armedPrefab, { x: p.x, y: p.y, z: p.z }, p.yawDegrees)
        .flatMap((piece, index) => pieceVisualBoxes(piece, `ghost.${index}`));
    }
    if (armedDef) {
      return pieceVisualBoxes({ pieceId: armedDef.id, x: p.x, y: p.y, z: p.z, yawDegrees: p.yawDegrees }, 'ghost');
    }
    return [];
  }, [snapTarget, armedDef, armedPrefab]);

  // session history strip: the labeled commits prove one-interaction-one-commit
  const sessionCommits = useMemo(() => {
    if (!build.session) return [];
    const record = editorSessions().state().sessions[build.session.id];
    return record ? record.commits : [];
  }, [build, piecesRev]);

  const armedLabel = armedPrefab ? `${armedPrefab.label} (prefab)` : armedDef ? armedDef.label : '—';
  const targetPiece = snapTarget?.targetPieceId ? pieces.find((p) => p.id === snapTarget.targetPieceId) ?? null : null;
  const inBuild = mode === 'build';

  // ── HUD data (HUD-0605) — every datum through a door ──────────────────────
  // compass + minimap marker: the build target IS this route's live objective
  const hudMarkers = useMemo<HudCompassMarker[]>(
    () => (snapTarget ? [{ x: snapTarget.placement.x, z: snapTarget.placement.z, label: 'target' }] : []),
    [snapTarget],
  );
  // game status updates: the session's labeled commits (the V20 truth channel)
  const hudFeed = useMemo<HudFeedEntry[]>(() => {
    const tail = sessionCommits.slice(-HUD_TUNING.feed.maxLines);
    return tail.map((c, index) => ({ id: c.seq, text: `#${c.seq} ${c.label}`, hot: index === tail.length - 1 }));
  }, [sessionCommits]);
  // equipment: the authored inventory through the items door (empty = honest)
  const hudEquipment = useMemo<HudSlotDef[]>(
    () => (props.state.player.inventory ?? []).slice(0, HUD_TUNING.equipment.slotCount).map((id, index) => ({
      id: `${index}:${id}`,
      label: GAME_ITEMS.is(id) ? GAME_ITEMS.get(id).label : id,
    })),
    [props.state],
  );
  const hudKeyInfo = useMemo(() => [
    { label: 'map', value: props.mapName },
    { label: 'pieces', value: String(pieces.length) },
    { label: 'commits', value: String(sessionCommits.length) },
    { label: 'armed', value: armedLabel },
  ], [props.mapName, pieces.length, sessionCommits.length, armedLabel]);
  const hudMapBlips = useMemo(() => pieces.map((p) => ({ x: p.x, z: p.z })), [pieces]);

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#080d16' }}>
      <EmbodiedCaptures embodied={embodied} />
      <EmbodiedScene embodied={embodied}>
        {/* the standing pieces — the world stream's materialized truth, in
            BOTH modes (solid in both; the toggle exists to walk what you built) */}
        <PlacedPieceMeshes pieces={pieces} markedIds={markedIds} targetId={inBuild ? snapTarget?.targetPieceId ?? null : null} />
        {/* the snap indicator + the ghost — build mode only */}
        {inBuild && snapTarget && (
          <Scene3D.Mesh
            geometry={Geometry.Box}
            params={{ width: 1, height: 1, depth: 1 }}
            scale={[BUILD_UI.indicatorSizeMeters, BUILD_UI.indicatorSizeMeters, BUILD_UI.indicatorSizeMeters]}
            position={[snapTarget.hit.x, snapTarget.hit.y, snapTarget.hit.z]}
            material={{ color: BUILD_UI.ghostColor }}
          />
        )}
        {inBuild && ghostBoxes.map((b) => (
          <VisualBoxMesh key={b.key} box={b} colorOverride={BUILD_UI.ghostColor} opacityOverride={ghostOpacity} />
        ))}
      </EmbodiedScene>

      {/* crosshair (build) — centered by the wrapper (absolute left/top take
          no %), BEFORE the gesture Pressable so the center click still places */}
      {inBuild && (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Box style={{ width: 2, height: 14, backgroundColor: '#e0f2fe88' }} />
          <Box style={{ width: 14, height: 2, backgroundColor: '#e0f2fe88', marginTop: -8 }} />
        </Box>
      )}

      <EmbodiedMouseSurface embodied={embodied} />

      {/* THE GAME HUD (HUD-0605 — Fortnite-verbatim layout, USER ruling) —
          build mode only. The blueprint selection (the ruled 1/2/3/4
          categories + variants) rides the bottom-right slot above the hotbar. */}
      {inBuild && (
        <EmbodiedHud
          embodied={embodied}
          markers={hudMarkers}
          feed={hudFeed}
          vitals={{ health: props.state.player.health }}
          keyInfo={hudKeyInfo}
          mapBlips={hudMapBlips}
          equipment={hudEquipment}
          blueprint={
            <Box style={{ alignItems: 'flex-end', gap: 4, maxWidth: 470 }}>
              {/* variants of the armed category (or the prefab shelf) */}
              <Box style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {armedKind === 'prefab'
                  ? prefabDefs.map((def) => (
                      <BlueprintChip key={def.id} label={def.label} on={armed.type === 'prefab' && armed.id === def.id} onPress={() => setArmed({ type: 'prefab', id: def.id })} />
                    ))
                  : entriesOfArmedKind.map((def) => (
                      <BlueprintChip key={def.id} label={`${def.label} · ${def.theme}`} on={armed.type === 'piece' && armed.id === def.id} onPress={() => setArmed({ type: 'piece', id: def.id })} />
                    ))}
              </Box>
              {/* categories — the registry IS the list, USER-RULED order leads
                  (1 floor · 2 wall · 3 ramp · 4 roof), keys and chips agree */}
              <Box style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {kinds.map((kind, index) => (
                  <BlueprintChip
                    key={kind}
                    label={`${index < 9 ? `${index + 1} ` : ''}${GAME_BUILD.kinds.get(kind).label}`}
                    on={armedKind === kind}
                    onPress={() => armKind(kind)}
                  />
                ))}
                <BlueprintChip label="0 Prefabs" on={armedKind === 'prefab'} onPress={() => armKind('prefab')} />
              </Box>
              <C.HudTextDim>
                {`armed: ${armedLabel} · yaw ${ghostYaw}° · ${snapTarget ? `${snapTarget.surface}${targetPiece ? ` → ${GAME_BUILD.catalog.get(targetPiece.pieceId).label}${targetPiece.edit ? ` [${targetPiece.edit}]` : ''}` : ''}` : 'no target'}`}
              </C.HudTextDim>
            </Box>
          }
        />
      )}

      {/* route chrome (top-left; Fortnite keeps this corner quiet): Back is
          both modes; Drop in is test's; the tuning chip is build's. The help
          lines teach each lineage's keys plus the fold's F1/F2 toggle. */}
      <Box style={{ position: 'absolute', left: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={props.onExit} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
          <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>Back</Text>
        </Pressable>
        {!inBuild && (
          <Pressable onPress={embodied.resetPlayer} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
            <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>Drop in</Text>
          </Pressable>
        )}
        {inBuild && <Chip label="tuning" on={showTuning} onPress={() => setShowTuning((s) => !s)} />}
        {!inBuild && (
          <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>
            {`${props.mapName} · TEST (F2 build) · WASD move · Space jump · Shift run · mouse look (${embodied.mouseCaptured ? 'Esc frees the mouse' : 'click to capture'}) · \` console · ${pointerWire.complete ? 'RMB aim' : `aim unavailable (host missing: ${pointerWire.missing.join(', ')})`}`}
          </Text>
        )}
        {inBuild && !embodied.mouseCaptured && (
          <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>
            {`${props.mapName} · BUILD (F1 test) · click to capture the mouse · WASD move · Space jump · click place · R rotate · E edit · 1 floor · 2 wall · 3 ramp · 4 roof · X remove · P mark · G grab shape · 0 prefabs · [ ] variant · Esc frees the mouse`}
          </Text>
        )}
      </Box>
      {inBuild && build.error != null && (
        <Box style={{ position: 'absolute', left: 12, top: 44, backgroundColor: '#7f1d1dcc', borderRadius: 6, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }}>
          <Text fontSize={10} color="#fecaca" style={{ fontFamily: 'monospace' }}>{`persistence host missing — placements disabled (${build.error})`}</Text>
        </Box>
      )}
      {inBuild && showTuning && (
        <Box style={{ position: 'absolute', left: 12, top: 44, backgroundColor: BUILD_UI.panelBg, borderWidth: 1, borderColor: '#27364a', borderRadius: 8, padding: 10, gap: 6, width: 240 }}>
          <GAME_CHROME.Knob label="build reach (m)" value={reachMeters} spec={{ min: 4, max: 30, step: 1, precision: 0 }} onChange={setReachMeters} />
          <GAME_CHROME.Knob label="ghost opacity" value={ghostOpacity} spec={{ min: 0.1, max: 0.9, step: 0.05, precision: 2 }} onChange={setGhostOpacity} />
          <GAME_CHROME.Knob label="ground march (m)" value={marchStep} spec={{ min: 0.1, max: 1, step: 0.05, precision: 2 }} onChange={setMarchStep} />
        </Box>
      )}

      {/* prefab capture panel (build) — appears while pieces are marked (sits
          above the bottom-right blueprint/hotbar stack) */}
      {inBuild && markedIds.size > 0 && (
        <Box style={{ position: 'absolute', right: 12, bottom: 190, backgroundColor: BUILD_UI.panelBg, borderWidth: 1, borderColor: '#facc15', borderRadius: 8, padding: 10, gap: 6, width: 240 }}>
          <Text fontSize={10} color="#fde68a" style={{ fontWeight: 700 }}>{`${markedIds.size} piece${markedIds.size === 1 ? '' : 's'} marked (P toggles one · G grabs the shape)`}</Text>
          <TextInput
            value={prefabName}
            onChangeText={setPrefabName}
            placeholder="prefab name…"
            style={{ backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: '#27364a', borderRadius: 4, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, color: '#e2e8f0', fontSize: 11 }}
          />
          <Box style={{ flexDirection: 'row', gap: 6 }}>
            <Chip label="Save prefab" on={true} onPress={savePrefab} />
            <Chip label="Clear marks" on={false} onPress={() => setMarkedIds(new Set())} />
          </Box>
        </Box>
      )}

      {/* The console overlay — root's LAST child (overlays-last hit-test rule),
          BOTH modes (the fold's union). Absolute over the top portion (CS
          style): the Scene3D underneath keeps its exact size — nothing
          reflows; the game keeps playing under it. */}
      {consoleOpen && (
        <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, height: CONSOLE_UI.heightPercent, backgroundColor: CONSOLE_UI.backdrop, borderBottomWidth: 2, borderBottomColor: '#334155', paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 8 }}>
          <Box style={{ flexGrow: 1, justifyContent: 'flex-end', overflow: 'hidden', gap: 2 }}>
            {gameConsole.session.scrollOffset() > 0 && (
              <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>
                {`— scrollback (${gameConsole.session.scrollOffset()} lines up) · PgDn to return —`}
              </Text>
            )}
            {gameConsole.session.visibleTail(CONSOLE_UI.maxVisibleLines).map((line) => (
              <Text key={line.id} fontSize={12} color={CONSOLE_UI.lineColor[line.kind]} style={{ fontFamily: 'monospace', lineHeight: 16 }}>
                {line.text}
              </Text>
            ))}
          </Box>
          <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#1f2937', paddingTop: 6, marginTop: 6 }}>
            <Text fontSize={12} color="#fbbf24" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
              {`] ${gameConsole.session.buffer()}▌`}
            </Text>
            <Text fontSize={10} color="#475569" style={{ fontFamily: 'monospace' }}>
              help · ↑↓ history · PgUp/PgDn scroll
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
