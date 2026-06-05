// TestRoute — /test: walk the authored map. The FIRST real consumer of the
// @game ground floor (contract: TestRoute.REWIRE.md, committed before this
// rewrite). The embodied drop-in itself — input, native camera, physics,
// world colliders, the figure — lives in ./Embodied (SUBSTRATE-0605: one
// substrate, shared with /build; this lineage is the authority it was
// extracted from). This route keeps only its mode layer:
//
//   GAME_COMMANDS the backtick console session (CS idiom) over the live route
//                 — gv_speed drives the real walk/run, pv_teleport adopts back
//                 into the embodied pose.
//   RMB ADS aim   the jump-aim playground opts into the substrate's aim layer.
//   probe         the [probe-player-model] gait/rig continuity diagnostic.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/primitives';
import { GAME_COMMANDS, GAME_FIGURE, GAME_INPUT, GAME_LOOP } from '@game';
import type { GameState } from '../hmsc/design'; // GAP: the editor GameState type retires when hmsc becomes compile/'s output (V15)
import {
  EmbodiedCaptures, EmbodiedMouseSurface, EmbodiedScene, normalizeYawDegrees,
  useEmbodiedPlayer, type PlayerPose,
} from './Embodied';

// Console overlay presentation (route chrome; the SESSION is captured —
// GAME_COMMANDS.createConsoleSession owns toggle/dispatch/transcript).
const CONSOLE_UI = {
  heightPercent: '46%',
  backdrop: '#0b1220e8',
  maxVisibleLines: 22,
  lineColor: { input: '#93c5fd', output: '#d1fae5', error: '#fb7185' } as Record<string, string>,
} as const;

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

export function TestRoute(props: { state: GameState; mapName: string; onExit: () => void }) {
  // The embodied substrate: drop-in player + native camera + host physics
  // over the authored world. The console is this route's live speed owner
  // (P2: gv_speed drives the real walk/run) and its open state gates keys.
  const embodied = useEmbodiedPlayer({
    state: props.state,
    figureCartKey: 'hmscint.test.player',
    logTag: '[test]',
    aim: true,
    isTyping: () => gameConsole.session.isOpen(),
    speeds: () => gameConsole.ctx.player,
  });
  const { player, playerRef, rig, figureOffset, pointerWire } = embodied;
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

  // The in-game console (CS idiom): backtick toggles an overlay; the session
  // is the captured GAME_COMMANDS console over a per-mount GameCommandState
  // seeded from the authored map (world slice COPIED — the console edits its
  // own copy; rendered-world unification is the world lane's integration
  // ticket). Pose syncs in before each command (pv_where tells the truth) and
  // position changes adopt back out (pv_teleport/pv_respawn move the player).
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

  useEffect(() => {
    const probe = playerProbeRef.current;
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
  }, [figureOffset, player.yaw, rig]);

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#080d16' }}>
      <EmbodiedCaptures embodied={embodied} />
      <EmbodiedScene embodied={embodied} />

      <EmbodiedMouseSurface embodied={embodied} />

      <Box style={{ position: 'absolute', left: 12, top: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable onPress={props.onExit} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
          <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>Back</Text>
        </Pressable>
        <Pressable onPress={embodied.resetPlayer} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f1a2e' }}>
          <Text fontSize={11} color="#cbd5e1" style={{ fontWeight: 700 }}>Drop in</Text>
        </Pressable>
        <Text fontSize={10} color="#64748b" style={{ fontFamily: 'monospace' }}>
          {`${props.mapName} · WASD move · Space jump · Shift run · mouse look (${embodied.mouseCaptured ? 'Esc frees the mouse' : 'click to capture'}) · \` console · ${pointerWire.complete ? 'RMB aim' : `aim unavailable (host missing: ${pointerWire.missing.join(', ')})`}`}
        </Text>
      </Box>

      {/* The console overlay — root's LAST child (overlays-last hit-test rule).
          Absolute over the top portion (CS style): the Scene3D underneath keeps
          its exact size — nothing reflows; the game keeps playing under it. */}
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
