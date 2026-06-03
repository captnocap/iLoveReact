import { useState } from 'react';
import { Box, Pressable, Text } from '@reactjit/primitives';
import type { EvidenceAxis, LifeState, Player, VisualSignature } from '../design';
import type { PlayerDebugActions } from '../state/world';
import { UI } from '../render/palette';

const AXES: { key: EvidenceAxis; label: string }[] = [
  { key: 'visual', label: 'VIS' },
  { key: 'fund', label: 'FUND' },
  { key: 'pattern', label: 'PAT' },
  { key: 'digital', label: 'DIG' },
  { key: 'location', label: 'LOC' },
];

const LIFE_STATES: LifeState[] = ['free', 'hospital', 'jail'];

// `color` here is the player's garment color (game data, matched on swap) — not chrome.
const COSTUMES: Array<VisualSignature & { label: string }> = [
  { label: 'tee', silhouette: 'avg', color: '#2e6da4', accessory: 'none' },
  { label: 'hood', silhouette: 'slim', color: '#3f4b3a', accessory: 'hood' },
  { label: 'mask', silhouette: 'bulky', color: '#5c4a68', accessory: 'mask' },
];

function TinyButton({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        minWidth: 28,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? UI.border : UI.userBubble,
        borderWidth: 1,
        borderColor: active ? UI.borderCyan : UI.borderDim,
        paddingLeft: 6,
        paddingRight: 6,
      }}
    >
      <Text style={{ color: active ? '#ffffff' : UI.text, fontSize: 9, fontWeight: active ? '700' : '500' }}>{label}</Text>
    </Pressable>
  );
}

function Row({ label, value, children }: { label: string; value: string; children: any }) {
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 }}>
      <Text style={{ color: UI.textDim, fontSize: 9, width: 46 }}>{label}</Text>
      <Text style={{ color: UI.text, fontSize: 9, width: 46 }}>{value}</Text>
      <Box style={{ flexDirection: 'row', gap: 3 }}>{children}</Box>
    </Box>
  );
}

export function PlayerDebug({ player, actions }: { player: Player; actions: PlayerDebugActions }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box style={{ position: 'absolute', left: 18, bottom: 18, width: 252, backgroundColor: UI.panelBg, borderWidth: 2, borderColor: UI.borderDim, padding: 8, gap: 5 }}>
      <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: UI.border, fontSize: 11, fontWeight: '700' }}>PLAYER</Text>
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: UI.textDim, fontSize: 9 }}>{`tile ${player.tile.x},${player.tile.y}`}</Text>
          <TinyButton label={expanded ? 'less' : 'more'} active={expanded} onPress={() => setExpanded((v) => !v)} />
        </Box>
      </Box>

      <Row label="health" value={`${player.health}/${player.maxHealth}`}>
        <TinyButton label="-10" onPress={() => actions.adjustHealth(-10)} />
        <TinyButton label="+10" onPress={() => actions.adjustHealth(10)} />
      </Row>
      <Row label="armor" value={`${player.armor}/${player.maxArmor}`}>
        <TinyButton label="-25" onPress={() => actions.adjustArmor(-25)} />
        <TinyButton label="+25" onPress={() => actions.adjustArmor(25)} />
      </Row>
      <Row label="money" value={`$${player.money}`}>
        <TinyButton label="-100" onPress={() => actions.adjustMoney(-100)} />
        <TinyButton label="+100" onPress={() => actions.adjustMoney(100)} />
      </Row>
      <Row label="high" value={`${Math.round(player.high.intensity * 100)}% ${player.high.phase}`}>
        <TinyButton label="-10" onPress={() => actions.adjustHigh(-0.1)} />
        <TinyButton label="+25" onPress={() => actions.adjustHigh(0.25)} />
      </Row>

      <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <Text style={{ color: UI.textDim, fontSize: 9 }}>{`heat ${Math.round(player.notoriety)} · ${player.lifeState}`}</Text>
        <Text style={{ color: UI.textDim, fontSize: 9 }}>{`${player.costume.accessory} ${player.costume.color}`}</Text>
      </Box>

      {expanded ? (
        <>
          <Box style={{ height: 1, backgroundColor: UI.borderDim, marginTop: 1, marginBottom: 1 }} />

          {AXES.map((axis) => (
            <Row key={axis.key} label={axis.label} value={String(player.suspicion[axis.key])}>
              <TinyButton label="-10" onPress={() => actions.adjustSuspicionAxis(axis.key, -10)} />
              <TinyButton label="+10" onPress={() => actions.adjustSuspicionAxis(axis.key, 10)} />
            </Row>
          ))}

          <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 }}>
            <Text style={{ color: UI.textDim, fontSize: 9, width: 46 }}>life</Text>
            <Box style={{ flexDirection: 'row', gap: 3 }}>
              {LIFE_STATES.map((state) => (
                <TinyButton key={state} label={state} active={player.lifeState === state} onPress={() => actions.setLifeState(state)} />
              ))}
            </Box>
          </Box>

          <Box style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 }}>
            <Text style={{ color: UI.textDim, fontSize: 9, width: 46 }}>costume</Text>
            <Box style={{ flexDirection: 'row', gap: 3 }}>
              {COSTUMES.map((costume) => (
                <TinyButton
                  key={costume.label}
                  label={costume.label}
                  active={player.costume.color === costume.color && player.costume.accessory === costume.accessory}
                  onPress={() => actions.setCostume(costume)}
                />
              ))}
            </Box>
          </Box>
        </>
      ) : null}
    </Box>
  );
}
