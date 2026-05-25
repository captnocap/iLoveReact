// Scape composition root. World math, runtime state, shaders, sprites, HUD, and
// chat live in focused modules; this file only wires them together.

import { Box, Effect, Pressable } from '@reactjit/runtime/primitives';
import { GROUND_WGSL } from './render/ground.wgsl';
import { Hud } from './render/Hud';
import { Player } from './render/Player';
import { createScapeFrame } from './render/sprites';
import { useScapeWorld } from './state/world';
import { QuestChatPanel, useQuestChat } from './ui/Chat';
import { PlayerDebug } from './ui/PlayerDebug';
import { Wheel } from './ui/Wheel';

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
  });

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0a0612' }}>
      <Pressable
        onLayout={(lr: any) => {
          world.rectRef.current = { x: lr.x, y: lr.y, width: lr.width, height: lr.height };
        }}
        onMouseDown={world.onSceneDown}
        style={{ flexGrow: 1, position: 'relative', overflow: 'hidden', backgroundColor: '#0a0612' }}
      >
        <Effect key="ground" shader={GROUND_WGSL} data={frame.data} style={{ position: 'absolute', left: 0, top: 0, width: world.rect.width, height: world.rect.height }} />
        <Player key="player" cx={frame.playerCx} cy={frame.playerCy} rel={frame.playerRel} bob={frame.bob} />
        <Hud
          px={world.sim.px}
          py={world.sim.py}
          deg={frame.deg}
          spriteN={frame.spriteN}
          pathLength={world.sim.path.length}
          player={world.player}
          inHand={world.inHand}
          data={frame.data}
          examineText={world.examineText}
        />
        <PlayerDebug player={world.player} actions={world.playerActions} />
        <Wheel slots={world.inventorySlots} inHand={world.inHand} actions={world.inventoryActions} />
        <QuestChatPanel chat={chat} />
      </Pressable>
    </Box>
  );
}
