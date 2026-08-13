// stage/PlaytestSurface.tsx — the PLAYTEST tab (GLOBALS req_2770).
//
// The editor world mounted EMBODIED: the same WorldLoader node the iso viewport
// uses, but with NO external camera — so the loader's built-in player takes over
// (world_loader.zig stepNow: WASD walk, Shift run, Space jump, third-person
// camera; a missing bound character remains a visible readiness failure). The
// Globals loop: the focus panel edits a value, this surface pushes it through
// __compiled_world_set_physics, and the NEXT physics step runs it — tune jump
// height, jump, feel it, done.
//
// The tab shows the authored world, not a stale bake: placed pieces + authored
// meshes ride in through the SAME live doors the iso viewport pushes
// (world/livePush.ts), and the painted map mirrors host-side automatically.
// Live pieces carry their colliders too; authored Door Walls additionally bring
// the same movable leaf machine used by the compiled world.
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Row, Text } from '@reactjit/primitives';
import { C } from '../workspace.cls';
import { EDITOR_GAME_FILE, EDITOR_STORE_DIR } from './WorldEditorSurface';
import { pushLiveWorld, pushResidentMeshes } from '../world/livePush';
import {
  pushPlayerCharacter,
  playerCharacterPackage,
  resolvePlayerCharacter,
  type PlayerCharacterStage,
} from '../world/playerCharacterLoader';
import { registerPlayWorldNode, unregisterPlayWorldNode } from '../skeleton/motionDocuments';
import {
  buildNpcCharacterSessionRequest,
  buildNpcPlaytestLineup,
  closeNpcCharacterSession,
  dispatchNpcCharacterSession,
} from '../world/npcCharacterSession';
import { packPhysicsGlobals, type WorldGlobals } from '../data/globals';
import type { ModelPackage } from '../data/types';
import type { PlacedPiece } from '../world/pieces';
import type { AuthoredBuildPiece } from '../world/authoredRegistry';
import type { AuthoredFloraSpecies } from '../world/floraSpecies';
import type { WorldFloraPatch } from '../world/surfaceFlora';
import { playerCharacterMountGate } from '../world/playerCharacterGate';

const g: any = globalThis;
const NPC_PLAYTEST_SESSION_ID = 'editor-playtest:npcs';
const NPC_SESSION_MOUNT_RETRY = { intervalMs: 32, maxAttempts: 120 } as const;

type PlaytestSurfaceProps = {
  globals: WorldGlobals;
  pieces: readonly PlacedPiece[];
  authoredPieces: readonly AuthoredBuildPiece[];
  worldFlora: readonly WorldFloraPatch[];
  floraSpecies: readonly AuthoredFloraSpecies[];
  characterPackages: readonly ModelPackage[];
};

type ReadyPlaytestSurfaceProps = PlaytestSurfaceProps & {
  playerCharacter: PlayerCharacterStage;
  npcLineup: ReturnType<typeof buildNpcPlaytestLineup>;
};

export default function PlaytestSurface(props: PlaytestSurfaceProps) {
  // Staging performs the strict native read/hash check. Keeping this boundary
  // above the mounted subtree guarantees a missing or rejected binding cannot
  // create a camera-only WorldLoader (and changing immutable artifacts remounts
  // the loader so it consumes exactly the newly validated stage).
  const playerPackage = useMemo(() => playerCharacterPackage(props.characterPackages), [props.characterPackages]);
  const playerResolution = useMemo(() => resolvePlayerCharacter(playerPackage), [playerPackage]);
  const playerCharacter = useMemo(() => pushPlayerCharacter(playerPackage), [playerPackage]);
  const gate = playerCharacterMountGate(playerResolution, playerCharacter);
  const npcLineup = useMemo(() => buildNpcPlaytestLineup(props.characterPackages), [props.characterPackages]);

  if (!gate.ready) {
    return (
      <C.HW_WorldEditorSurface>
        <Box style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d141f' }}>
          <Box style={{ maxWidth: 560, paddingLeft: 18, paddingRight: 18, paddingTop: 14, paddingBottom: 14, borderWidth: 1, borderColor: '#70433b', borderRadius: 7, backgroundColor: '#271614' }}>
            <Text style={{ color: '#f0aa98', fontSize: 12, fontFamily: 'monospace', fontWeight: '700', textAlign: 'center' }}>
              PLAY BLOCKED — BOUND PLAYER REQUIRED
            </Text>
            <Text style={{ color: '#d6b0a8', fontSize: 10, fontFamily: 'monospace', textAlign: 'center', marginTop: 7 }}>
              {gate.reason}
            </Text>
            <Text style={{ color: '#9f8a86', fontSize: 9, fontFamily: 'monospace', textAlign: 'center', marginTop: 6 }}>
              Fit, bind, and save the welded character before opening runtime play.
            </Text>
          </Box>
        </Box>
      </C.HW_WorldEditorSurface>
    );
  }

  const meshes = playerResolution.ok ? playerResolution.pkg.skeleton?.meshes : undefined;
  const mountKey = playerResolution.ok
    ? `${playerResolution.pkg.id}:${meshes?.kind === 'skinned' ? meshes.geometryPath ?? '' : ''}:${meshes?.kind === 'skinned' ? meshes.binding?.artifactHash ?? '' : ''}`
    : 'blocked';
  return (
    <MountedPlaytestSurface
      key={mountKey}
      {...props}
      playerCharacter={gate.stage as PlayerCharacterStage}
      npcLineup={npcLineup}
    />
  );
}

function MountedPlaytestSurface(props: ReadyPlaytestSurfaceProps) {
  const loaderRef = useRef<any>(null);
  const npcSessionRef = useRef({ nodeId: 0, revision: 0, active: false });
  const [npcSessionStatus, setNpcSessionStatus] = useState<{ count: number; error: string | null }>({ count: 0, error: null });
  // The host binary predates the physics door → say so instead of silently
  // ignoring every edit (the panel still edits + saves; only the live feel waits
  // on a rebuilt host).
  const doorMissing = typeof g.__compiled_world_set_physics !== 'function';

  // The wrapper has already staged and validated this exact saved player. This
  // subtree owns the WorldLoader lifetime and cannot exist for a failed gate.
  const { playerCharacter, npcLineup } = props;

  // Push the live tuning on mount and on every globals change; retry until the
  // loader node exists (it lands a few frames after mount — the resident-mesh
  // retry pattern). Clear on unmount so the world tab's iso loader — same file,
  // different node — is never left running stale test values.
  useEffect(() => {
    const push = (): boolean => {
      const nodeId = Number(loaderRef.current?.id ?? 0);
      if (!nodeId || typeof g.__compiled_world_set_physics !== 'function') return false;
      g.__compiled_world_set_physics(nodeId, packPhysicsGlobals(props.globals.physics));
      return true;
    };
    if (push()) return;
    let tries = 0;
    const t = setInterval(() => { tries += 1; if (push() || tries > 120) clearInterval(t); }, 32);
    return () => clearInterval(t);
  }, [props.globals]);

  useEffect(() => () => {
    const nodeId = Number(loaderRef.current?.id ?? 0);
    if (!nodeId) return;
    const npcSession = npcSessionRef.current;
    if (npcSession.active && npcSession.nodeId === nodeId) {
      const closed = closeNpcCharacterSession({
        nodeId,
        sessionId: NPC_PLAYTEST_SESSION_ID,
        expectedRevision: npcSession.revision,
      });
      if (!closed) console.error('[playtest] NPC character session did not close cleanly');
      npcSessionRef.current = { nodeId: 0, revision: closed?.revision ?? npcSession.revision, active: false };
    }
    if (typeof g.__compiled_world_clear_physics === 'function') g.__compiled_world_clear_physics(nodeId);
    if (typeof g.__compiled_world_unmount === 'function') g.__compiled_world_unmount(nodeId);
  }, []);

  // The bounded NPC specimen lineup is an active `/play` staging consumer, not
  // a dormant helper. It opens only after this exact WorldLoader mounts, then
  // replaces atomically when the current package roster changes. Native owns
  // every CharacterAsset, saved-weight validation, FK state, and GPU palette.
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const push = (): boolean => {
      const nodeId = Number(loaderRef.current?.id ?? 0);
      if (!nodeId) return false;
      if (npcSessionRef.current.nodeId !== nodeId) {
        npcSessionRef.current = { nodeId, revision: 0, active: false };
      }
      const current = npcSessionRef.current;
      const built = buildNpcCharacterSessionRequest({
        op: current.active ? 'replace' : 'open',
        nodeId,
        sessionId: NPC_PLAYTEST_SESSION_ID,
        expectedRevision: current.revision,
        placements: npcLineup.placements,
        packages: npcLineup.packages,
      });
      if (!built.ok) {
        if (!cancelled) setNpcSessionStatus({ count: 0, error: built.error });
        return true;
      }
      const staged = dispatchNpcCharacterSession(built.request);
      if (!staged.ok) {
        if (staged.error === 'WorldLoaderNotMounted') return false;
        if (!cancelled) setNpcSessionStatus({ count: 0, error: staged.error });
        return true;
      }
      npcSessionRef.current = { nodeId, revision: staged.snapshot.revision, active: staged.snapshot.active };
      if (!cancelled) setNpcSessionStatus({ count: staged.snapshot.instanceCount, error: null });
      return true;
    };
    if (push()) return;
    const timer = setInterval(() => {
      attempts += 1;
      if (push() || attempts > NPC_SESSION_MOUNT_RETRY.maxAttempts) {
        clearInterval(timer);
        if (!cancelled && attempts > NPC_SESSION_MOUNT_RETRY.maxAttempts) {
          setNpcSessionStatus({ count: 0, error: 'WorldLoader did not mount before NPC staging deadline' });
        }
      }
    }, NPC_SESSION_MOUNT_RETRY.intervalMs);
    return () => { cancelled = true; clearInterval(timer); };
  }, [npcLineup]);

  // Register this mounted world as the motion workbench's /play target
  // (req_4285): the MotionDock's PLAY button puts documents on this player.
  useEffect(() => {
    let registered = 0;
    const claim = () => {
      const nodeId = Number(loaderRef.current?.id ?? 0);
      if (!nodeId) return false;
      registered = nodeId;
      registerPlayWorldNode(nodeId);
      return true;
    };
    if (claim()) return () => unregisterPlayWorldNode(registered);
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (claim() || tries > 120) clearInterval(timer);
    }, 32);
    return () => {
      clearInterval(timer);
      if (registered) unregisterPlayWorldNode(registered);
    };
  }, []);

  // The authored world rides in through the shared live doors (world/livePush).
  useEffect(() => {
    const push = () => pushLiveWorld(Number(loaderRef.current?.id ?? 0), props.pieces, props.authoredPieces, props.worldFlora, props.floraSpecies);
    if (push()) return;
    let tries = 0;
    const t = setInterval(() => { tries += 1; if (push() || tries > 120) clearInterval(t); }, 32);
    return () => clearInterval(t);
  }, [props.pieces, props.authoredPieces, props.worldFlora, props.floraSpecies]);
  useEffect(() => {
    const push = () => pushResidentMeshes(Number(loaderRef.current?.id ?? 0), props.authoredPieces, props.floraSpecies);
    if (push()) return;
    let tries = 0;
    const t = setInterval(() => { tries += 1; if (push() || tries > 120) clearInterval(t); }, 32);
    return () => clearInterval(t);
  }, [props.authoredPieces, props.floraSpecies]);

  return (
    <C.HW_WorldEditorSurface>
      <Box style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#0d141f' }}>
        {createElement('WorldLoader', {
          ref: loaderRef,
          gameFile: EDITOR_GAME_FILE,
          storeDir: EDITOR_STORE_DIR,
          testID: 'editor-playtest-viewport',
          style: { width: '100%', height: '100%' },
        })}
        {doorMissing ? (
          <Row style={{ position: 'absolute', left: 0, right: 0, top: 0, paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, backgroundColor: 'rgba(120,32,32,0.88)', alignItems: 'center' }}>
            <Text style={{ color: '#ffd9d9', fontSize: 11, fontFamily: 'monospace' }}>
              {'this host build has no __compiled_world_set_physics door — edits save but will not apply live until the editor is re-shipped'}
            </Text>
          </Row>
        ) : null}
        <Row style={{ position: 'absolute', left: 8, bottom: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, backgroundColor: 'rgba(10,12,16,0.82)', borderRadius: 6, alignItems: 'center', gap: 10 }}>
          <Text style={{ color: '#9fc1ee', fontSize: 10, fontFamily: 'monospace' }}>
            {`player character: ${playerCharacter.name} · ${playerCharacter.boneIds.length} stable bones · saved weights`}
          </Text>
          <Text style={{ color: npcSessionStatus.error || npcLineup.skipped.length ? '#e0b866' : '#9fc1ee', fontSize: 10, fontFamily: 'monospace' }}>
            {npcSessionStatus.error
              ? `NPC lineup refused: ${npcSessionStatus.error}`
              : `NPC lineup: ${npcSessionStatus.count} saved-weight specimen${npcSessionStatus.count === 1 ? '' : 's'}${npcLineup.skipped.length ? ` · ${npcLineup.skipped.length} skipped/unready (${npcLineup.skipped[0]!.name}: ${npcLineup.skipped[0]!.reason})` : ''}`}
          </Text>
        </Row>
      </Box>
    </C.HW_WorldEditorSurface>
  );
}
