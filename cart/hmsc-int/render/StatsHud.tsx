// render/StatsHud.tsx — the COMPLETE player-stats readout (the package).
//
// One component renders the whole stat set from GAME_STATS: vitals (health,
// armor, energy), money (total + cash/crypto/assets), the 6-star wanted level,
// carry capacity (the factored sum, shown as its parts), the outfit slots, and
// the four gained skills (level + xp toward the next). Every derived number
// comes through GAME_STATS so there is ONE derivation, not a HUD copy — the
// in-world Hud and the player-stats lab both render this.
//
// Dev/test only (React). The compiled game stays React-free; its native HUD is a
// deliberate later effort, not a JS-in-the-loop port of this file.

import { Box, Col, Row, Text } from '@reactjit/primitives';
import { GAME_STATS, type SkillId } from '@game';
import type { PlayerState } from '../design';

const C = {
  panel: '#0c0614f2',
  border: '#ff2d95',
  ink: '#ffd8ec',
  dim: '#9a7f93',
  faint: '#5e4a5a',
  health: '#ff5ea0',
  armor: '#8a6cff',
  energy: '#5fe0c8',
  money: '#5fe08c',
  star: '#18e0d8',
  starDim: '#3a2540',
  track: '#241327',
  skill: '#ffb347',
};

const SKILL_LABEL: Record<SkillId, string> = {
  stamina: 'stamina',
  vehicle: 'vehicle',
  aim: 'aim',
  stealth: 'stealth',
};

function Bar(props: { label: string; value: number; max: number; color: string }) {
  const frac = props.max > 0 ? Math.max(0, Math.min(1, props.value / props.max)) : 0;
  return (
    <Row style={{ alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <Text style={{ width: 30, color: C.dim, fontSize: 11, fontFamily: 'mono' }}>{props.label}</Text>
      <Box style={{ flexGrow: 1, height: 10, borderRadius: 5, backgroundColor: C.track, overflow: 'hidden' }}>
        <Box style={{ width: `${Math.round(frac * 100)}%`, height: '100%', backgroundColor: props.color }} />
      </Box>
      <Text style={{ width: 34, textAlign: 'right', color: C.ink, fontSize: 11, fontFamily: 'mono' }}>{Math.round(props.value)}</Text>
    </Row>
  );
}

function SectionLabel(props: { text: string }) {
  return <Text style={{ color: C.faint, fontSize: 9, letterSpacing: 1, marginTop: 8, marginBottom: 4 }}>{props.text.toUpperCase()}</Text>;
}

function WantedStars(props: { lit: number }) {
  const max = GAME_STATS.maxWantedStars;
  return (
    <Row style={{ gap: 2 }}>
      {Array.from({ length: max }, (_, i) => (
        <Text key={i} style={{ fontSize: 16, color: i < props.lit ? C.star : C.starDim }}>*</Text>
      ))}
    </Row>
  );
}

function MoneyLine(props: { label: string; value: number; color: string }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Text style={{ color: C.dim, fontSize: 11 }}>{props.label}</Text>
      <Text style={{ color: props.color, fontSize: 11, fontFamily: 'mono' }}>{`$${Math.round(props.value).toLocaleString()}`}</Text>
    </Row>
  );
}

function SkillRow(props: { id: SkillId; xp: number }) {
  const level = GAME_STATS.skillLevel(props.xp);
  const progress = GAME_STATS.skillProgress(props.xp);
  return (
    <Row style={{ alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <Text style={{ width: 54, color: C.dim, fontSize: 11 }}>{SKILL_LABEL[props.id]}</Text>
      <Box style={{ flexGrow: 1, height: 8, borderRadius: 4, backgroundColor: C.track, overflow: 'hidden' }}>
        <Box style={{ width: `${Math.round(progress * 100)}%`, height: '100%', backgroundColor: C.skill }} />
      </Box>
      <Text style={{ width: 44, textAlign: 'right', color: C.ink, fontSize: 11, fontFamily: 'mono' }}>{`L${level}`}</Text>
    </Row>
  );
}

/** The complete stat readout for a player. Pass `style` to place it. */
export function StatsHud(props: { player: PlayerState; style?: any }) {
  const player = props.player;
  const stats = player.stats;
  const total = GAME_STATS.moneyTotal(stats.wallet);
  const wanted = GAME_STATS.wantedFromNotoriety(Math.max(0, player.heat));
  const capacity = GAME_STATS.inventoryCapacity(stats.outfit);
  const used = player.inventory.length;
  const hands = GAME_STATS.tuning.inventory.handsSlots;
  const pocket = GAME_STATS.pocketCapacity(stats.outfit.pants);
  const pack = GAME_STATS.packCapacity(stats.outfit.backpack);

  return (
    <Col style={{ width: 268, padding: 12, borderRadius: 10, borderWidth: 2, borderColor: C.border, backgroundColor: C.panel, gap: 0, ...(props.style ?? {}) }}>
      <SectionLabel text="vitals" />
      <Bar label="HP" value={player.health} max={GAME_STATS.healthMax} color={C.health} />
      <Bar label="AR" value={stats.armor} max={GAME_STATS.tuning.armor.max} color={C.armor} />
      <Bar label="EN" value={stats.energy} max={GAME_STATS.energyMax} color={C.energy} />

      <SectionLabel text="money" />
      <MoneyLine label="total" value={total} color={C.money} />
      <MoneyLine label="cash" value={stats.wallet.cash} color={C.dim} />
      <MoneyLine label="crypto" value={stats.wallet.crypto} color={C.dim} />
      <MoneyLine label={`assets (${stats.wallet.assets.length})`} value={GAME_STATS.assetsValue(stats.wallet)} color={C.dim} />

      <SectionLabel text="wanted" />
      <WantedStars lit={wanted} />

      <SectionLabel text={`carry · ${used}/${capacity}`} />
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={{ color: C.faint, fontSize: 10 }}>{`hands ${hands} + pockets ${pocket} + pack ${pack}`}</Text>
      </Row>

      <SectionLabel text="outfit" />
      <Row style={{ flexWrap: 'wrap', gap: 4 }}>
        {(['head', 'shirt', 'pants', 'backpack', 'shoes'] as const).map((slot) => (
          <Box key={slot} style={{ paddingLeft: 6, paddingRight: 6, paddingTop: 2, paddingBottom: 2, borderRadius: 4, backgroundColor: C.track }}>
            <Text style={{ color: C.dim, fontSize: 9 }}>{`${slot}: ${stats.outfit[slot]}`}</Text>
          </Box>
        ))}
      </Row>

      <SectionLabel text="skills" />
      {GAME_STATS.skillIds.map((id) => (
        <SkillRow key={id} id={id} xp={stats.skills[id].xp} />
      ))}
    </Col>
  );
}
