import { Box, Effect, Text } from '@reactjit/primitives';
import { MINIMAP_WGSL } from './minimap.wgsl';
import { ITEM_ICON_WGSL } from './itemIcon.wgsl';
import { UI } from './palette';
import type { Player } from '../design';
import type { InventorySlot } from '../systems/inventory';

// The player interface: a GTA III / Vice City readout repainted to TONE.md's neon
// dusk. LED clock, zero-padded green cash, heart health/armor, a wanted-star row,
// and a neon weapon box showing the actual held-item sprite. Dev telemetry lives in
// the PlayerDebug panel; this surface is the player-facing chrome only.

// One LED glyph run: a hard near-black drop-shadow under a mono, tracked-out face —
// the readout signature of the era. (The runtime has no textShadow, so we layer.)
function Led({ text, color, size, track = 1 }: { text: string; color: string; size: number; track?: number }) {
  const base = { fontFamily: 'mono' as const, fontSize: size, fontWeight: '700' as const, letterSpacing: track };
  return (
    <Box style={{ position: 'relative' }}>
      <Text style={{ ...base, position: 'absolute', left: 2, top: 2, color: UI.ledShadow }}>{text}</Text>
      <Text style={{ ...base, color }}>{text}</Text>
    </Box>
  );
}

// A shadowed heart glyph (health / armor) followed by its LED value.
function HeartStat({ value, color }: { value: number; color: string }) {
  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Box style={{ position: 'relative' }}>
        <Text style={{ position: 'absolute', left: 1, top: 1, fontSize: 20, color: UI.ledShadow }}>♥</Text>
        <Text style={{ fontSize: 20, color }}>♥</Text>
      </Box>
      <Led text={String(value)} color={color} size={22} />
    </Box>
  );
}

// Notoriety → up to six lit stars. The dim row always shows so the meter reads.
function WantedStars({ lit }: { lit: number }) {
  return (
    <Box style={{ flexDirection: 'row', gap: 1 }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Box key={i} style={{ position: 'relative' }}>
          <Text style={{ position: 'absolute', left: 1, top: 1, fontSize: 16, color: UI.ledShadow }}>★</Text>
          <Text style={{ fontSize: 16, color: i < lit ? UI.star : UI.starDim }}>★</Text>
        </Box>
      ))}
    </Box>
  );
}

// The current-weapon box: a two-tone neon frame (pink outer, cyan inner) around the
// real held-item sprite (rendered by itemIcon.wgsl from the same SDF the world uses).
// Charges show as a small LED count, bottom-right. Empty hand = FISTS.
function WeaponBox({ inHand }: { inHand: InventorySlot | null }) {
  const kind = inHand ? inHand.module.world.spriteKind : -1;
  const tint = inHand ? inHand.module.world.tint ?? 0 : 0;
  const charges = inHand?.instance.charges;
  return (
    <Box style={{ width: 92, height: 92, borderRadius: 16, borderWidth: 2, borderColor: UI.border, backgroundColor: UI.surround, padding: 3 }}>
      <Box style={{ width: '100%', height: '100%', borderRadius: 12, borderWidth: 2, borderColor: UI.borderCyan, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
        {inHand ? (
          <Effect shader={ITEM_ICON_WGSL} data={[kind, tint, 0, 0]} style={{ width: 78, height: 78 }} />
        ) : (
          <Text style={{ color: UI.textFaint, fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>FISTS</Text>
        )}
        {charges != null ? (
          <Box style={{ position: 'absolute', right: 3, bottom: 2 }}>
            <Led text={String(charges)} color={UI.text} size={14} track={0} />
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

export function Hud({
  player,
  inHand,
  data,
  examineText,
  clock,
}: {
  player: Player;
  inHand: InventorySlot | null;
  data: number[];
  examineText: string | null;
  clock: string;
}) {
  const money = String(player.money).padStart(8, '0');
  const wanted = Math.min(6, Math.round((player.notoriety / 100) * 6));
  return (
    <>
      {/* top-right: the stat stack with the weapon box on the corner */}
      <Box key="stats" style={{ position: 'absolute', right: 18, top: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <Box style={{ alignItems: 'flex-end', gap: 4 }}>
          <Led text={clock} color={UI.accent} size={32} />
          <Led text={`$${money}`} color={UI.money} size={24} />
          <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            {player.armor > 0 ? <HeartStat value={player.armor} color={UI.armor} /> : null}
            <HeartStat value={player.health} color={UI.health} />
          </Box>
          <WantedStars lit={wanted} />
        </Box>
        <WeaponBox inHand={inHand} />
      </Box>

      {/* top-left: the high pill (Spun signal) + the controls hint */}
      <Box key="topleft" style={{ position: 'absolute', left: 18, top: 16, gap: 6, alignItems: 'flex-start' }}>
        {player.high.intensity > 0.05 ? (
          <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: UI.panelBg, borderWidth: 1, borderColor: UI.high, borderRadius: 4, paddingLeft: 8, paddingRight: 8, paddingTop: 3, paddingBottom: 3 }}>
            <Text style={{ color: UI.high, fontSize: 12, fontWeight: '700' }}>{`◈ ${player.high.phase.toUpperCase()}`}</Text>
            <Text style={{ color: UI.text, fontSize: 12, fontFamily: 'mono' }}>{`${Math.round(player.high.intensity * 100)}%`}</Text>
          </Box>
        ) : null}
        <Text style={{ color: UI.textFaint, fontSize: 10 }}>click move · right-click actions · A/D orbit · W/S tilt · H bump</Text>
      </Box>

      {examineText ? (
        <Box key="examine" style={{ position: 'absolute', left: 0, right: 0, bottom: 132, alignItems: 'center' }}>
          <Box style={{ backgroundColor: UI.panelBg, borderWidth: 2, borderColor: UI.borderCyan, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}>
            <Text style={{ color: UI.text, fontSize: 13 }}>{examineText}</Text>
          </Box>
        </Box>
      ) : null}

      {/* circular neon radar, bottom-right corner */}
      <Box key="minimap" style={{ position: 'absolute', right: 18, bottom: 18, width: 150, height: 150, borderRadius: 75, borderWidth: 3, borderColor: UI.border, backgroundColor: UI.surround, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Effect shader={MINIMAP_WGSL} data={data} style={{ width: 144, height: 144 }} />
      </Box>
    </>
  );
}
