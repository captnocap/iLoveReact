// Run:
//   tools/esbuild cart/editor/agent/seatOracle.test.ts --bundle --outfile=/tmp/editor-seat-oracle.test.js --format=iife --platform=neutral --target=es2022
//   tools/v8cli /tmp/editor-seat-oracle.test.js
//
// The load-bearing behaviour here is REFUSAL. A phase gate that can be talked past is a
// page-turn, and a page-turn changes no agent's behaviour.
import {
  MAX_REGIONS_PER_100_FACES,
  ORACLE_PHASES,
  ORACLE_PLANS,
  PHASE_CHECKLISTS,
  PHASE_CHECKS,
  UNREACHABLE_BUDGET,
  advanceSession,
  askCorpus,
  blockedCount,
  classifyTask,
  evaluatePhase,
  splitSections,
  startSession,
  viewSession,
  type OracleFacts,
} from './seatOracle';

let passed = 0, failed = 0;
const log = (globalThis as any).print ?? ((s: string) => (globalThis as any).__writeStdout?.(`${s}\n`));
function test(name: string, fn: () => void) {
  try { fn(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }

const cleanModel = {
  id: 'prop:bench', faces: 480, unnamed: 0, placeholders: 0, regions: 11, islands: 6, parts: 3,
  auditComputed: true as boolean | undefined, intersectingFaces: 0 as number | undefined, unreachableFaces: 4 as number | undefined,
};
const facts = (over: Partial<OracleFacts> = {}, model: Partial<typeof cleanModel> = {}): OracleFacts => ({
  model: { ...cleanModel, ...model },
  claimed: true, packageInSync: true, packageDirty: false, semanticHealthy: true, attest: {},
  ...over,
});

test('a retopology task loads the retopology plan, not the blockout corridor', () => {
  const { plan } = classifyTask('retopologize this Tripo soup into a skinnable prop');
  assert(plan.id === 'retopo', `classified as ${plan.id}`);
  assert(!plan.phases.includes('blockout'), 'a retopo task loaded the blockout phase');
  assert(plan.phases.join(',') === 'setup,retopo,naming,uv-skin,finish', `phases were ${plan.phases.join(',')}`);
});

test('the longest signal wins when two plans both match', () => {
  // "fix" (revise) and "retexture" (skin) both appear; the specific one must win.
  assert(classifyTask('retexture the fire escape').plan.id === 'skin', 'the longer signal lost');
  assert(classifyTask('fix the door gap').plan.id === 'revise', 'a bare revise signal was misrouted');
});

test('an unclassifiable task falls to a real plan rather than to nothing', () => {
  const { plan, matched } = classifyTask('do the thing with the object');
  assert(matched === null, 'an unmatched task claimed a signal');
  assert(plan.phases.length > 0, 'the fallback plan has no phases');
});

test('every plan phase has both checks and a checklist', () => {
  for (const plan of ORACLE_PLANS) {
    for (const phase of plan.phases) {
      assert((PHASE_CHECKS[phase] ?? []).length > 0, `${plan.id}/${phase} has no exit criteria`);
      assert((PHASE_CHECKLISTS[phase] ?? []).length > 0, `${plan.id}/${phase} has no checklist`);
    }
  }
});

test('every phase in the pool is reachable from some plan', () => {
  const reachable = new Set(ORACLE_PLANS.flatMap((plan) => plan.phases));
  for (const phase of ORACLE_PHASES) assert(reachable.has(phase), `${phase} is defined but no plan reaches it`);
});

test('advance REFUSES with the exact failing checks, and does not move the cursor', () => {
  const session = startSession('model a park bench');
  const blocked = facts({ claimed: false });
  const outcome = advanceSession(session, blocked);
  assert(!outcome.ok, 'the gate let an unclaimed setup phase through');
  if (outcome.ok) return;
  assert(outcome.failing.some((check) => check.id === 'model-claimed'), 'the refusal did not name the failing check');
  assert(/claim the model/.test(outcome.failing.find((c) => c.id === 'model-claimed')!.detail), 'the refusal did not say how to fix it');
  assert(session.phaseIndex === 0, 'a refused advance still moved the phase cursor');
});

test('advance passes only when every criterion passes, and hands back the next doc slice', () => {
  const session = startSession('model a park bench');
  session.attest['scale-declared'] = 'bench is 1.8m x 0.6m x 0.9m';
  const outcome = advanceSession(session, facts({ attest: session.attest }));
  assert(outcome.ok, `the gate refused a clean setup phase: ${outcome.ok ? '' : outcome.reason}`);
  if (!outcome.ok) return;
  assert(outcome.from === 'setup' && outcome.to === 'blockout', `moved ${outcome.from} -> ${outcome.to}`);
  assert(session.phaseIndex === 1, 'the cursor did not move on a passing advance');
});

test('an unmeasured fact BLOCKS — unknown is never treated as passing', () => {
  const session = startSession('model a park bench');
  session.phaseIndex = session.phases.indexOf('topology');
  const unmeasured = facts({ attest: { 'junctions-resolved': 'welded all four legs' } }, { auditComputed: false });
  const checks = evaluatePhase('topology', unmeasured);
  const unreachable = checks.find((check) => check.id === 'unreachable-budget')!;
  assert(unreachable.pass === null, 'an unmeasured audit reported a verdict');
  assert(blockedCount(checks) > 0, 'unknown checks did not block');
  assert(!advanceSession(session, unmeasured).ok, 'the gate advanced past an unmeasured mesh');
});

test('the unreachable budget refuses the shipped-blockout failure and names the real fix', () => {
  const shipped = facts({}, { faces: 1000, unreachableFaces: 430 });
  const check = evaluatePhase('topology', shipped).find((row) => row.id === 'unreachable-budget')!;
  assert(check.pass === false, '43% unreachable passed the budget');
  assert(/part-merge`? resolves none of this/i.test(check.detail), 'the refusal did not name the part-merge trap');
  const fine = facts({}, { faces: 1000, unreachableFaces: Math.floor(1000 * UNREACHABLE_BUDGET) });
  assert(evaluatePhase('topology', fine).find((row) => row.id === 'unreachable-budget')!.pass === true, 'a mesh exactly at budget was refused');
});

test('naming density refuses one-label-per-face noise but passes a real model', () => {
  const model = evaluatePhase('naming', facts({}, { faces: 489, regions: 11 })).find((row) => row.id === 'naming-density')!;
  assert(model.pass === true, `11 regions over 489 triangles was refused: ${model.detail}`);
  const noise = evaluatePhase('naming', facts({}, { faces: 300, regions: 175 })).find((row) => row.id === 'naming-density')!;
  assert(noise.pass === false, '175 regions over 300 triangles passed');
  assert(noise.detail.includes(`${MAX_REGIONS_PER_100_FACES}`), 'the refusal did not state the ceiling');
});

test('a small mesh is not judged on density it cannot express', () => {
  // A 12-triangle cube with its 6 primitive names is 50 per 100 and perfectly correct.
  const cube = evaluatePhase('naming', facts({}, { faces: 12, regions: 6 })).find((row) => row.id === 'naming-density')!;
  assert(cube.pass === true, 'a named cube failed the density ceiling');
});

test('a host-measured check cannot be attested past', () => {
  const session = startSession('model a park bench');
  const view = viewSession(session, facts({ claimed: false }));
  const hostCheck = view.checks.find((check) => check.id === 'model-claimed')!;
  assert(hostCheck.verified === 'host', 'model-claimed is not host-verified');
  // The seat refuses this at the API boundary; the router marks it so that is possible.
  assert(view.checks.filter((check) => check.verified === 'agent-attest').every((check) => check.pass === null),
    'an unattested check reported a verdict');
});

test('each attested check names a future audit rather than passing silently', () => {
  const view = viewSession(startSession('model a park bench'), facts());
  const attest = view.checks.find((check) => check.verified === 'agent-attest')!;
  assert(attest.pass === null, 'an un-attested criterion passed by default');
  assert(/oracle attest/.test(attest.detail), 'the criterion did not say how to attest it');
});

test('the ambient counter reports position and outstanding debt', () => {
  const session = startSession('skin the atm wall');
  const view = viewSession(session, facts({ claimed: false }));
  assert(view.plan === 'skin' && view.phase === 'setup', `view was ${view.plan}/${view.phase}`);
  assert(view.position === '1/6', `position was ${view.position}`);
  assert(view.blocked === blockedCount(view.checks) && view.blocked > 0, 'blocked did not count outstanding checks');
});

test('a completed plan says so instead of pinning to its last phase', () => {
  const session = startSession('rig the player');
  session.phaseIndex = session.phases.length;
  const view = viewSession(session, facts());
  assert(view.complete && view.phase === null, 'a finished plan still reported a phase');
  assert(!advanceSession(session, facts()).ok, 'a completed plan advanced again');
});

test('ask routes to the corpus without touching the plan', () => {
  const docs: Record<string, string> = {
    topology: '## Junctions\nDelete the mating faces on both sides.',
    'uv-skin': '## UV stitch requirements\nStitch islands before export.\n## Atlas budget\nfit is a budget.',
  };
  const session = startSession('model a park bench');
  const before = session.phaseIndex;
  const hits = askCorpus('uv stitch requirements', (name) => docs[name] ?? null);
  assert(hits.length > 0, 'a corpus lookup found nothing');
  assert(hits[0]!.heading === 'UV stitch requirements', `top hit was "${hits[0]!.heading}"`);
  assert(hits[0]!.doc === 'uv-skin', `hit came from ${hits[0]!.doc}`);
  assert(session.phaseIndex === before, 'a lookup moved the phase cursor');
});

test('a heading match outranks a passing body mention', () => {
  const docs: Record<string, string> = {
    topology: '## Weld the seam\nweld weld weld weld',
    naming: '## Naming rules\nNever weld a name.',
  };
  const hits = askCorpus('naming rules', (name) => docs[name] ?? null);
  assert(hits[0]!.heading === 'Naming rules', `top hit was "${hits[0]!.heading}"`);
});

test('section splitting keeps every heading level and drops empty bodies', () => {
  const sections = splitSections('# A\nbody a\n\n### B\n\n## C\nbody c');
  assert(sections.length === 2, `expected 2 sections with bodies, got ${sections.length}`);
  assert(sections[0]!.heading === 'A' && sections[1]!.heading === 'C', sections.map((s) => s.heading).join(','));
});

log(`seatOracle: ${passed} passed${failed ? `, ${failed} FAILED` : ''}`);
