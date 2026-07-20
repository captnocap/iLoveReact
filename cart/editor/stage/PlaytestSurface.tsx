// stage/PlaytestSurface.tsx — the PLAYTEST tab (GLOBALS req_2770).
//
// The editor world mounted EMBODIED: the same WorldLoader node the iso viewport
// uses, but with NO external camera — so the loader's built-in player takes over
// (world_loader.zig stepNow: WASD walk, Shift run, Space jump, third-person
// camera; a blank world gets the stand-in figure). The point of this tab is the
// Globals loop: the focus panel edits a value, this surface pushes it through
// __compiled_world_set_physics, and the NEXT physics step runs it — tune jump
// height, jump, feel it, done.
//
// The tab shows the authored world, not a stale bake: placed pieces + authored
// meshes ride in through the SAME live doors the iso viewport pushes
// (world/livePush.ts), and the painted map mirrors host-side automatically.
// Live pieces carry their colliders too; authored Door Walls additionally bring
// the same movable leaf machine used by the compiled world.
import { createElement, useEffect, useMemo, useRef } from 'react';
import { Box, Row, Text } from '@reactjit/primitives';
import { C } from '../workspace.cls';
import { EDITOR_GAME_FILE, EDITOR_STORE_DIR } from './WorldEditorSurface';
import { pushLiveWorld, pushResidentMeshes } from '../world/livePush';
import { pushPlayerModel, playerCharacterPackage } from '../world/playerModelPush';
import { packPhysicsGlobals, type WorldGlobals } from '../data/globals';
import type { PlacedPiece } from '../world/pieces';
import type { AuthoredBuildPiece } from '../world/authoredRegistry';
import type { AuthoredFloraSpecies } from '../world/floraSpecies';
import type { WorldFloraPatch } from '../world/surfaceFlora';

const g: any = globalThis;

export default function PlaytestSurface(props: {
  globals: WorldGlobals;
  pieces: readonly PlacedPiece[];
  authoredPieces: readonly AuthoredBuildPiece[];
  worldFlora: readonly WorldFloraPatch[];
  floraSpecies: readonly AuthoredFloraSpecies[];
}) {
  const loaderRef = useRef<any>(null);
  // The host binary predates the physics door → say so instead of silently
  // ignoring every edit (the panel still edits + saves; only the live feel waits
  // on a rebuilt host).
  const doorMissing = typeof g.__compiled_world_set_physics !== 'function';

  // The EXPORTED player model (req_2780): staged DURING FIRST RENDER — the
  // door is process-global and the loader consumes it at construct, which is
  // strictly after this render's mount, so ordering needs no retry loop. No
  // player-role export ⇒ the staging clears and the stand-in figure mounts.
  const playerModel = useMemo(() => pushPlayerModel(), []);

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
    if (typeof g.__compiled_world_clear_physics === 'function') g.__compiled_world_clear_physics(nodeId);
    if (typeof g.__compiled_world_unmount === 'function') g.__compiled_world_unmount(nodeId);
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
        <Row style={{ position: 'absolute', left: 8, bottom: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, backgroundColor: 'rgba(10,12,16,0.82)', borderRadius: 6, alignItems: 'center' }}>
          <Text style={{ color: playerModel ? '#9fc1ee' : '#e0b866', fontSize: 10, fontFamily: 'monospace' }}>
            {playerModel
              ? `player model: ${playerModel.name} · ${playerModel.groups} parts`
              : playerCharacterPackage()
                ? 'player model unreadable — re-export it (File → Export → Player Model) · wearing the stand-in'
                : 'no model declared as THE player — File → Export → Player Model · wearing the stand-in'}
          </Text>
        </Row>
      </Box>
    </C.HW_WorldEditorSurface>
  );
}
