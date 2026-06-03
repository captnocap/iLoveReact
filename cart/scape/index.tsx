// Scape composition root. World math, runtime state, shaders, sprites, HUD, and
// chat live in focused modules; this file only wires them together.

import { Box, Effect, Pressable } from '@reactjit/primitives';
import { GROUND_WGSL } from './render/ground.wgsl';
import { Hud } from './render/Hud';
import { Player } from './render/Player';
import { createScapeFrame } from './render/sprites';
import { useScapeWorld } from './state/world';
import { ActionMenu } from './ui/ContextMenu';
import { QuestChatPanel, useQuestChat } from './ui/Chat';
import { PlayerDebug } from './ui/PlayerDebug';

export default function Scape() {
  const chat = useQuestChat();
  const world = useScapeWorld(chat);
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
      <Pressable
        onLayout={(lr: any) => {
          world.rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height };
        }}
        onMouseDown={world.onSceneDown}
        onRightClick={world.onSceneRightClick}
        style={{ flexGrow: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#0a0612' }}
      >
        <Effect key="ground" shader={GROUND_WGSL} data={frame.data} style={{ position: 'absolute', left: 0, top: 0, width: world.rect.width, height: world.rect.height }} />
        <Player key="player" cx={frame.playerCx} cy={frame.playerCy} rel={frame.playerRel} bob={frame.bob} />
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
      </Pressable>
    </Box>
  );
}
