// panelGrammar.test.ts — P4 behavior tests for the panel grammar
// (PANELGRAMMAR-0610, review §11.4). The contract: the laws are mechanical
// spec analysis — repeated group shapes, swatch dumps, chip walls, and
// re-emitted shell verbs are DETECTED, named, and cited; a clean panel
// produces zero violations.

import { panelGrammarViolations, groupSignature, PANEL_GRAMMAR_CAPS } from './panelGrammar';
import type { FieldSpec, PanelSpec } from './fields';
import { assert, assertEqual, finish, test } from '../game/_testkit';

const val = (k: string): FieldSpec => ({ k, t: 'val', get: () => '' });
const act = (k: string): FieldSpec => ({ k, t: 'act', run: () => {} });
const color = (k: string, opts?: string[], extra?: Partial<Extract<FieldSpec, { t: 'color' }>>): FieldSpec =>
  ({ k, t: 'color', get: () => '#fff', opts, ...extra } as FieldSpec);

test('a clean panel has zero violations', () => {
  const spec: PanelSpec = { groups: [
    { title: 'IDENTITY', fields: [val('id'), val('kind')] },
    { title: 'TUNING', fields: [val('speed'), act('reset')] },
  ] };
  assertEqual(panelGrammarViolations(spec).length, 0, 'nothing to flag');
});

test('G1: two groups with one field signature demand factoring (the buildings shape)', () => {
  const skinFields = (): FieldSpec[] => [val('target'), color('color'), val('material'), act('browse'), act('paint'), act('clear')];
  const spec: PanelSpec = { groups: [
    { title: 'WALLS · GLOBAL', fields: skinFields() },
    { title: 'ROOFS · GLOBAL', fields: skinFields() },
    { title: 'FLOORS · GLOBAL', fields: skinFields() },
  ] };
  const hits = panelGrammarViolations(spec).filter((v) => v.law === 'G1');
  assertEqual(hits.length, 1, 'one violation naming the whole duplicate family');
  assert(hits[0].detail.includes('WALLS · GLOBAL') && hits[0].detail.includes('FLOORS · GLOBAL'), 'every twin is named');
  // one-field groups may collide honestly (a lone status row)
  const lone: PanelSpec = { groups: [
    { title: 'A', fields: [val('status')] },
    { title: 'B', fields: [val('status')] },
  ] };
  assertEqual(panelGrammarViolations(lone).filter((v) => v.law === 'G1').length, 0, 'single-field groups are exempt');
});

test('G2: swatch dumps and panel-wide color sprawl are flagged; wheel/range graduates', () => {
  const many = Array.from({ length: PANEL_GRAMMAR_CAPS.QUICK_PICK_CAP + 1 }, (_, i) => `#${i}`);
  const dump: PanelSpec = { groups: [{ title: 'LOOK', fields: [color('skin', many)] }] };
  assertEqual(panelGrammarViolations(dump).filter((v) => v.law === 'G2').length, 1, 'an over-cap palette with no wheel is flagged');
  const graduated: PanelSpec = { groups: [{ title: 'LOOK', fields: [color('skin', many, { wheel: true })] }] };
  assertEqual(panelGrammarViolations(graduated).filter((v) => v.law === 'G2').length, 0, 'wheel opts the palette out');
  const sprawl: PanelSpec = { groups: [{
    title: 'LOOK',
    fields: Array.from({ length: PANEL_GRAMMAR_CAPS.COLOR_FIELD_CAP + 1 }, (_, i) => color(`c${i}`)),
  }] };
  assert(panelGrammarViolations(sprawl).some((v) => v.law === 'G2' && v.detail.includes('one color system')), 'panel-wide color sprawl is flagged');
});

test('G3: a chip wall of verbs demands the chooser (req_0184)', () => {
  const wall: PanelSpec = { groups: [{
    title: 'ACTIONS',
    fields: Array.from({ length: PANEL_GRAMMAR_CAPS.ACT_CAP + 1 }, (_, i) => act(`verb${i}`)),
  }] };
  const hits = panelGrammarViolations(wall).filter((v) => v.law === 'G3');
  assertEqual(hits.length, 1, 'the over-cap group is flagged');
  assert(hits[0].detail.includes('pick'), 'the fix is named');
});

test('G4: panels never re-emit the shell verbs', () => {
  const dupes: PanelSpec = { groups: [{ title: 'EDIT', fields: [act('undo'), act('redo')] }] };
  const hits = panelGrammarViolations(dupes).filter((v) => v.law === 'G4');
  assertEqual(hits.length, 2, 'undo and redo each flagged');
});

test('groupSignature is the ordered (type:label) shape', () => {
  assertEqual(
    groupSignature({ title: 'X', fields: [val('a'), act('b')] }),
    'val:a,act:b',
    'signature is order-sensitive and type-qualified',
  );
});

finish('shell/panelGrammar');
