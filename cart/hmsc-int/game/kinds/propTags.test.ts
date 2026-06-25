// propTags.test — the tag system + tag-aware search (req_1913). Pins: tokens are
// derived from camelCase + label, many tags per prop, search ranks direct hits
// above related, tag queries surface tagged items, and related expansion pulls in
// items that share tags with what was searched.

import { assert, assertEqual, finish, test } from '../_testkit';
import { tokenize, propTags, propTagSet, searchProps, type PropEntry } from './propTags';

test('tokenize splits camelCase, all-caps runs, and separators', () => {
  assertEqual(tokenize('treeOakGiant').join(','), 'tree,oak,giant', 'camel split');
  assertEqual(tokenize('roadSignSchool').join(','), 'road,sign,school', 'three words');
  assertEqual(tokenize('tvCRT').join(','), 'tv,crt', 'all-caps tail');
  assertEqual(tokenize('Fire Hydrant').join(','), 'fire,hydrant', 'spaced label');
  assert(!tokenize('a1Bc').includes('a'), '1-char noise dropped');
});

test('a prop holds MANY tags: category seed + name tokens + affinity', () => {
  const tags = propTagSet('couch', 'Couch');
  assert(tags.has('furniture'), 'legacy category kept as a tag');
  assert(tags.has('couch'), 'own name token');
  assert(tags.has('seating'), 'functional affinity (couch → seating)');
  assert(tags.size >= 3, 'genuinely many tags');
});

test('affinity cross-links synonyms a name alone would not', () => {
  assert(propTagSet('sofa', 'Sofa').has('seating'), 'sofa → seating');
  assert(propTagSet('barStool', 'Bar Stool').has('seating'), 'stool → seating');
  assert(propTagSet('treeOak', 'Oak Tree').has('nature'), 'tree → nature');
  assert(propTagSet('rockLarge', 'Large Rock').has('stone'), 'rock → stone');
  assert(propTags('floorLamp', 'Floor Lamp').includes('lighting'), 'lamp → lighting');
});

const SAMPLE: PropEntry[] = [
  { id: 'prop.couch', label: 'Couch' },
  { id: 'prop.sofa', label: 'Sofa' },
  { id: 'prop.armchair', label: 'Armchair' },
  { id: 'prop.barStool', label: 'Bar Stool' },
  { id: 'prop.treeOak', label: 'Oak Tree' },
  { id: 'prop.rockLarge', label: 'Large Rock' },
  { id: 'prop.floorLamp', label: 'Floor Lamp' },
];

test('empty query returns every entry as a match, nothing related', () => {
  const r = searchProps('', SAMPLE);
  assertEqual(r.matches.length, SAMPLE.length, 'all are matches');
  assertEqual(r.related.length, 0, 'no related on empty');
});

test('searching a name puts the exact item first', () => {
  const r = searchProps('couch', SAMPLE);
  assertEqual(r.matches[0]?.id, 'prop.couch', 'exact name leads');
  // sofa shares the couch affinity tag → it is a match OR related, never absent.
  const all = [...r.matches, ...r.related].map((e) => e.id);
  assert(all.includes('prop.sofa'), 'sofa surfaces via shared seating/sofa tags');
});

test('searching a TAG surfaces every item carrying it', () => {
  const r = searchProps('seating', SAMPLE);
  const ids = r.matches.map((e) => e.id);
  for (const id of ['prop.couch', 'prop.sofa', 'prop.armchair', 'prop.barStool']) {
    assert(ids.includes(id), `${id} matches the seating tag`);
  }
  assert(!ids.includes('prop.treeOak'), 'a tree is not seating');
});

test('related expansion shows items that share tags with the searched item', () => {
  const r = searchProps('armchair', SAMPLE);
  assertEqual(r.matches[0]?.id, 'prop.armchair', 'the searched item leads');
  const related = r.related.map((e) => e.id);
  assert(related.includes('prop.couch') || related.includes('prop.sofa'), 'other seating is related');
  assert(!related.includes('prop.treeOak'), 'unrelated nature is not pulled in');
});

test('tandem terms: more matched words rank higher', () => {
  const entries: PropEntry[] = [
    { id: 'prop.treeOakGiant', label: 'Giant Oak Tree' },
    { id: 'prop.treePine', label: 'Pine Tree' },
  ];
  const r = searchProps('oak tree', entries);
  assertEqual(r.matches[0]?.id, 'prop.treeOakGiant', 'both words land on the oak');
});

// relevance must be GATED: a lone generic shared tag is not "related". neonSign and
// a lamp share only 'lighting'; the user does not want neon surfaced for "lamp".
const LIGHTS: PropEntry[] = [
  { id: 'prop.floorLamp', label: 'Floor Lamp' },
  { id: 'prop.deskLamp', label: 'Desk Lamp' },
  { id: 'prop.neonSign', label: 'Neon Sign' },
];

test('a single generic shared tag does NOT make something related (derank gate)', () => {
  const r = searchProps('lamp', LIGHTS);
  const ids = [...r.matches, ...r.related].map((e) => e.id);
  assert(ids.includes('prop.floorLamp') && ids.includes('prop.deskLamp'), 'both lamps string-match');
  assert(!ids.includes('prop.neonSign'), 'neon shares only the generic lighting tag → gated out');
});

test('favorites are the top tier: a favorited match leads', () => {
  const fav = new Set(['prop.deskLamp']);
  const r = searchProps('lamp', LIGHTS, fav);
  assertEqual(r.matches[0]?.id, 'prop.deskLamp', 'favorite leads its tier');
});

test('favorites lead even with an empty query (browse mode)', () => {
  const fav = new Set(['prop.rockLarge']);
  const r = searchProps('', SAMPLE, fav);
  assertEqual(r.matches[0]?.id, 'prop.rockLarge', 'favorite floats to front of the catalog');
});

finish('propTags');
