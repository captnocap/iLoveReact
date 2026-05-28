// scape3d composition root — a real-3D take on scape. Same world, same systems,
// same movement/camera *behaviour* (click-to-move pathing, A/D orbit, W/S tilt),
// but the ground/buildings/props/people are meshes drawn by one <Scene3D> instead
// of the 2D shader quad + sprites. Picking is a ground-plane raycast that inverts
// the very camera the scene renders with (world/projection.ts).
//
// This file stays a thin shell: 3D scene + the (unchanged) HUD / action menu /
// chat / debug overlays. The sprite frame is still built — only to feed the
// minimap radar shader its data buffer.

import { Box, Filter, Pressable } from '@reactjit/runtime/primitives';
import { Scene } from './render3d/Scene';
import { WaterSurface } from './render3d/WaterSurface';
import { Hud } from './render/Hud';
import { createScapeFrame } from './render/sprites';
import { useScapeWorld } from './state/world';
import { ActionMenu } from './ui/ContextMenu';
import { QuestChatPanel, useQuestChat } from './ui/Chat';
import { PlayerDebug } from './ui/PlayerDebug';

export default function Scape3D() {
  const chat = useQuestChat();
  const world = useScapeWorld(chat);
  // Built only for the minimap radar's data buffer (header + tiles + sprite blips).
  const frame = createScapeFrame({
    sim: world.sim,
    rect: world.rect,
    cam: world.cam,
    winOX: world.winOX,
    winOY: world.winOY,
    winTiles: world.winTiles,
    decorList: world.decorList,
    entities: world.entities,
    inventory: world.inventory,
    doors: world.doors,
  });

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0a0612' }}>
      {/* Offscreen: renders the live A13 <Water> into staticKey "water-a13",
          which the canal heightfield mesh samples via textureKey. */}
      <WaterSurface />
      <Pressable
        onLayout={(lr: any) => {
          world.rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height };
        }}
        onMouseDown={world.onSceneDown}
        onRightClick={world.onSceneRightClick}
        style={{ flexGrow: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#0a0612' }}
      >
        {/* EVERYTHING visual goes inside the chromatic post-process. A filter
            composites in a final pass over its whole rect, so a fullscreen filter
            covers any sibling drawn before it — that's why a scene-only filter ate
            the HUD. With the HUD inside, it reappears; at intensity 0 (sober) the
            chromatic is identity so the HUD stays crisp, and it splits/shimmers
            WITH the view as you peak. Click handlers stay on the outer Pressable,
            so world picking uses raw coords and isn't bent by the filter.
            (Filter MUST get an explicit 100% size or the host crashes at load.) */}
        <Filter
          shader="chromatic"
          intensity={Math.min(1, world.player.high.intensity * 1.15)}
          style={{ position: 'absolute', left: 0, top: 0, width: world.rect.width, height: world.rect.height }}
        >
          <Box style={{ position: 'absolute', left: 0, top: 0, width: world.rect.width, height: world.rect.height }}>
            <Scene
              sim={world.sim}
              cam={world.cam}
              doors={world.doors}
              entities={world.entities}
              worldItems={world.worldItems}
              heldModel={world.inHand?.module.world.model}
            />
          </Box>
          <Hud
            player={world.player}
            inHand={world.inHand}
            data={frame.data}
            examineText={world.examineText}
            clock={world.clock}
          />
          <PlayerDebug player={world.player} actions={world.playerActions} />
          <ActionMenu menu={world.menu} onPick={world.runAction} onClose={world.closeMenu} high={world.player.high.intensity} />
          <QuestChatPanel chat={chat} />
        </Filter>
      </Pressable>
    </Box>
  );
}
