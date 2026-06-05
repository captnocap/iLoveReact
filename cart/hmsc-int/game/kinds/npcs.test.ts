// Behavior tests for the NPC kind + faction registries (P4): assert the
// TABLES' MEANING.

import {
  FACTION_REGARD,
  NPC_KIND_DEFINITIONS,
  NPC_KINDS,
  factionRegard,
  isHostileTo,
  isNpcKind,
  npcKindDefinition,
  type NpcFaction,
  type RegardTarget,
} from './npcs';
import { assert, assertEqual, finish, test } from '../_testkit';

const def = npcKindDefinition;
const FACTIONS: NpcFaction[] = ['civilian', 'gang', 'police'];
const TARGETS: RegardTarget[] = ['civilian', 'gang', 'police', 'player'];

test('civilians and paramedics are bodies that flee, not combatants', () => {
  for (const k of ['civilian', 'paramedic'] as const) {
    assert(!def(k).canFight, `${k} never returns fire`);
    assertEqual(def(k).weaponDamage, 0, `${k} carries no weapon damage`);
    assertEqual(def(k).defaultFaction, 'civilian', `${k} defaults to the civilian faction`);
  }
});

test('thug and police are the armed kinds', () => {
  for (const k of ['thug', 'police'] as const) {
    assert(def(k).canFight, `${k} can fight`);
    assert(def(k).weaponDamage > 0, `${k} weapon damage positive`);
  }
  assert(def('police').weaponDamage > def('thug').weaponDamage, 'police hit harder than thugs');
});

test('perception sharpens up the escalation ladder (civilian → thug → police)', () => {
  const c = def('civilian').perception;
  const t = def('thug').perception;
  const p = def('police').perception;
  assert(p.visionRangeMeters > t.visionRangeMeters && t.visionRangeMeters > c.visionRangeMeters,
    'vision range escalates');
  assert(p.visionFovDegrees > t.visionFovDegrees && t.visionFovDegrees > c.visionFovDegrees,
    'field of view widens');
  assert(p.reactionSeconds < t.reactionSeconds && t.reactionSeconds < c.reactionSeconds,
    'reaction quickens');
  assertEqual(p.hearingAcuity, 1.0, 'police hear at full acuity');
});

test('every kind has a forward cone, not eyes in the back of the head', () => {
  for (const k of NPC_KINDS) {
    const per = def(k).perception;
    assert(per.visionFovDegrees < 360, `${k} FoV is a cone`);
    assert(per.visionFovDegrees > 0 && per.visionRangeMeters > 0, `${k} can see`);
    assert(per.hearingAcuity > 0 && per.hearingAcuity <= 1, `${k} hearing acuity in (0,1]`);
    assert(per.reactionSeconds > 0, `${k} reaction takes time`);
  }
});

test('everyone runs faster than they walk; health is positive', () => {
  for (const k of NPC_KINDS) {
    const d = def(k);
    assert(d.runSpeedMetersPerSecond > d.walkSpeedMetersPerSecond, `${k} run > walk`);
    assert(d.maxHealth > 0, `${k} health positive`);
    assertEqual(d.kind, k, `${k} kind field`);
  }
});

test('gang and police are mutually hostile; nobody else opens fire by default', () => {
  assert(isHostileTo('gang', 'police'), 'gang engages police');
  assert(isHostileTo('police', 'gang'), 'police engage gang');
  for (const viewer of FACTIONS) {
    for (const subject of TARGETS) {
      const expectHostile = (viewer === 'gang' && subject === 'police') || (viewer === 'police' && subject === 'gang');
      assertEqual(isHostileTo(viewer, subject), expectHostile, `${viewer} vs ${subject} hostility`);
    }
  }
});

test('civilians are wary of gangs — wary means flee, not fight', () => {
  assertEqual(factionRegard('civilian', 'gang'), 'wary', 'civilian regards gang');
  assert(!isHostileTo('civilian', 'gang'), 'wary is not hostile');
});

test('the player starts neutral to every faction (wanted level shifts it later)', () => {
  for (const viewer of FACTIONS) {
    assertEqual(factionRegard(viewer, 'player'), 'neutral', `${viewer} regards the player`);
  }
});

test('the regard matrix is total: every viewer × target pair is defined', () => {
  for (const viewer of FACTIONS) {
    for (const subject of TARGETS) {
      const r = FACTION_REGARD[viewer][subject];
      assert(r === 'hostile' || r === 'wary' || r === 'neutral' || r === 'friendly',
        `${viewer} × ${subject} defined`);
    }
  }
  // 'player' is a regard target only — never a faction with its own row.
  assert(!Object.prototype.hasOwnProperty.call(FACTION_REGARD, 'player'), 'player has no viewer row');
});

test('every faction is friendly to itself', () => {
  for (const f of FACTIONS) assertEqual(factionRegard(f, f), 'friendly', `${f} self-regard`);
});

test('isNpcKind accepts every kind and rejects strangers', () => {
  for (const k of NPC_KINDS) assert(isNpcKind(k), `isNpcKind(${k})`);
  assert(!isNpcKind('soldier'), 'no soldier kind');
  assertEqual(NPC_KINDS.length, Object.keys(NPC_KIND_DEFINITIONS).length, 'kind list covers the table');
});

finish('kinds/npcs');
