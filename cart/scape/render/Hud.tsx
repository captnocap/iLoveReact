import { Box, Effect, Text } from '@reactjit/runtime/primitives';
import { MINIMAP_WGSL } from './minimap.wgsl';
import { UI } from './palette';
import { WIN } from '../world/window';
import type { Player } from '../design';
import type { InventorySlot } from '../systems/inventory';

export function Hud({
  px,
  py,
  deg,
  spriteN,
  pathLength,
  player,
  inHand,
  data,
  examineText,
}: {
  px: number;
  py: number;
  deg: number;
  spriteN: number;
  pathLength: number;
  player: Player;
  inHand: InventorySlot | null;
  data: number[];
  examineText: string | null;
}) {
  const status = `${pathLength ? 'WALKING' : 'IDLE'}${player.high > 0.05 ? `   ◈ HIGH ${Math.round(player.high * 100)}%` : ''}`;
  const hand = inHand ? inHand.module.type.label : 'empty';
  return (
    <>
      <Box key="hud" style={{ position: 'absolute', left: 20, top: 20, width: 232, backgroundColor: UI.panelBg, borderWidth: 2, borderColor: UI.border, padding: 10, gap: 5 }}>
        <Text style={{ color: UI.border, fontSize: 15, fontWeight: '700' }}>SCAPE</Text>
        <Text style={{ color: UI.textDim, fontSize: 11 }}>{`POS ${Math.floor(px)}, ${Math.floor(py)}   CAM ${String(deg).padStart(3, '0')}°`}</Text>
        <Text style={{ color: UI.text, fontSize: 11 }}>{`HP ${player.health}/${player.maxHealth}   $${player.money}   HEAT ${Math.round(player.notoriety)}`}</Text>
        <Text style={{ color: UI.text, fontSize: 11 }}>{`HAND ${hand}`}</Text>
        <Text style={{ color: UI.textDim, fontSize: 11 }}>{`SPR ${spriteN}  ·  WIN ${WIN}²  ·  CITY 52×44`}</Text>
        <Text style={{ color: pathLength ? UI.accent : UI.textFaint, fontSize: 11 }}>{`${status}   ${player.lifeState.toUpperCase()}`}</Text>
        <Text style={{ color: UI.textFaint, fontSize: 10 }}>click move · right-click actions · A/D orbit · W/S tilt · H bump</Text>
      </Box>

      {examineText ? (
        <Box key="examine" style={{ position: 'absolute', left: 0, right: 0, bottom: 24, alignItems: 'center' }}>
          <Box style={{ backgroundColor: UI.panelBg, borderWidth: 2, borderColor: UI.borderCyan, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}>
            <Text style={{ color: UI.text, fontSize: 13 }}>{examineText}</Text>
          </Box>
        </Box>
      ) : null}

      <Box key="minimap" style={{ position: 'absolute', right: 20, top: 20, width: 140, height: 140, borderWidth: 2, borderColor: UI.border, overflow: 'hidden' }}>
        <Effect shader={MINIMAP_WGSL} data={data} style={{ width: 136, height: 136 }} />
      </Box>
    </>
  );
}
