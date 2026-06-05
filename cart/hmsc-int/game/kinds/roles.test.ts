// Behavior tests for the NPC role registry (P4): assert the TABLE'S MEANING.

import {
  DEFAULT_NPC_ROLE,
  NPC_ROLE_DEFINITIONS,
  NPC_ROLES,
  isNpcRole,
  npcRole,
} from './roles';
import { assert, assertEqual, report, test } from './testKit';

test('unknown role ids never crash — they fall back to none', () => {
  const r = npcRole('some-future-designation');
  assertEqual(r.id, 'none', 'unknown role resolves to none');
  assert(!isNpcRole('some-future-designation'), 'but is not claimed as known');
  assertEqual(npcRole('').id, 'none', 'empty id falls back too');
});

test('the default role is none: unmarked, harmless, no interactions', () => {
  const r = npcRole(DEFAULT_NPC_ROLE);
  assertEqual(r.id, 'none', 'default role id');
  assert(!r.hostileOnSight, 'none is not hostile');
  assert(!r.objective, 'none is not an objective');
  assertEqual(r.interactions.length, 0, 'none adds no interactions');
});

test('target is the Hitman mark: an objective you eliminate, not an attacker', () => {
  const t = npcRole('target');
  assert(t.objective, 'target is mission-tracked');
  assert(t.interactions.includes('eliminate'), 'target surfaces eliminate');
  // Role is orthogonal to faction: wearing `target` marks the NPC for the
  // PLAYER; it does not make the NPC engage on sight.
  assert(!t.hostileOnSight, 'a mark does not attack just for being marked');
});

test('only target is an objective in the base table', () => {
  for (const id of NPC_ROLES) {
    assertEqual(npcRole(id).objective, id === 'target', `${id} objective flag`);
  }
});

test('no base role overrides faction to engage-on-sight (the override exists for future roles)', () => {
  for (const id of NPC_ROLES) {
    assert(!npcRole(id).hostileOnSight, `${id} does not engage on sight`);
  }
});

test('every informational role surfaces action-menu interactions', () => {
  assertEqual(npcRole('personOfInterest').interactions.join(','), 'observe,tail', 'personOfInterest verbs');
  assertEqual(npcRole('informant').interactions.join(','), 'question,bribe', 'informant verbs');
  assertEqual(npcRole('witness').interactions.join(','), 'intimidate,silence', 'witness verbs');
  assertEqual(npcRole('contact').interactions.join(','), 'talk,trade', 'contact verbs');
});

test('marker colors are theme tokens, never raw hex', () => {
  for (const id of NPC_ROLES) {
    assert(npcRole(id).markerColor.startsWith('theme:'), `${id} markerColor is a theme token`);
  }
});

test('the table is well-formed and open by data', () => {
  for (const id of NPC_ROLES) {
    const r = NPC_ROLE_DEFINITIONS[id];
    assertEqual(r.id, id, `${id} id field matches its key`);
    assert(r.label.length > 0, `${id} label`);
    assert(isNpcRole(id), `isNpcRole(${id})`);
  }
  assertEqual(NPC_ROLES.join(','), 'none,personOfInterest,target,informant,witness,contact', 'base role set');
});

report('kinds/roles');
