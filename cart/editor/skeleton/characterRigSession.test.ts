// cart/editor/skeleton/characterRigSession.test.ts
//
//   ROOT=/home/siah/creative/reactjit
//   tools/esbuild cart/editor/skeleton/characterRigSession.test.ts --bundle \
//     --outfile=/tmp/character-rig-session.test.js --format=iife \
//     --platform=neutral --target=es2022
//   tools/v8cli /tmp/character-rig-session.test.js

import type {
  CharacterRigSessionRequest,
  CharacterRigSnapshot,
  CharacterRigVertexProbe,
  SkinBindingRef,
} from '../../../runtime/skeleton';
import { characterRigPackagePath } from './characterRigPackagePath';
import {
  CharacterRigSessionFault,
  createCharacterRigApi,
} from './characterRigSession';

let passed = 0;
let failed = 0;
const log = (globalThis as any).print ?? ((text: string) => (globalThis as any).__writeStdout?.(`${text}\n`));
function test(name: string, run: () => void) {
  try { run(); passed += 1; log(`  ok  ${name}`); }
  catch (error) { failed += 1; log(`FAIL  ${name}: ${(error as Error).message}`); }
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

function snapshot(revision: number): CharacterRigSnapshot {
  return {
    sessionId: 'rig:one',
    revision,
    state: revision >= 2 ? 'bound' : 'draft',
    externalProvenance: null,
    viewportActive: false,
    specimenSeparation: 2.5,
    bodyTopology: null,
    semanticCoverage: null,
    selectedBoneId: null,
    selectedVertex: null,
    bones: [],
    semanticBindings: [],
    objectBindings: [{ objectId: 'body', mode: 'body' }],
    overlay: { bindMesh: true, deformedMesh: true, axes: true, names: true, heatmap: false },
    testPose: { name: 'bind' },
    exercise: null,
    history: { canUndo: false, canRedo: false, undoDepth: 0, redoDepth: 0 },
    readiness: [],
    weightsStale: false,
    fitNeedsReview: false,
    bindNeedsReview: false,
  };
}

test('attach preflight uses the same deep door without opening a session', () => {
  const requests: CharacterRigSessionRequest[] = [];
  const api = createCharacterRigApi(() => (json) => {
    const request = JSON.parse(json) as CharacterRigSessionRequest;
    requests.push(request);
    if (request.op !== 'preflightAttach') throw new Error(`unexpected ${request.op}`);
    return { ok: true, value: {
      accepted: false,
      candidateBodyObjectId: 'part:hat',
      recommendedBodyObjectId: 'part:body',
      objects: [
        { objectId: 'part:hat', rank: 0, components: 1, triangles: 12, largestConnectedTriangles: 12, largestConnectedVertices: 8 },
        { objectId: 'part:body', rank: 1, components: 1, triangles: 900, largestConnectedTriangles: 900, largestConnectedVertices: 480 },
      ],
    } };
  });
  const result = api.preflightAttach(['part:hat', 'part:body']);
  assert(!result.accepted && result.recommendedBodyObjectId === 'part:body',
    'attach preflight hid the native BODY recommendation');
  assert(requests[0]?.op === 'preflightAttach' && requests[0].payload.rangeObjectIds.join(',') === 'part:hat,part:body',
    'attach preflight bypassed the deep rig door or changed stable object order');
  assert(api.currentSnapshot() === null, 'attach preflight fabricated an open rig session');
});

test('open and commands serialize one opaque revisioned door', () => {
  const requests: CharacterRigSessionRequest[] = [];
  let revision = 0;
  const api = createCharacterRigApi(() => (json) => {
    const request = JSON.parse(json) as CharacterRigSessionRequest;
    requests.push(request);
    if (request.op === 'open') return JSON.stringify({ ok: true, value: snapshot(revision) });
    if (request.op === 'command') {
      assert(request.expectedRevision === revision, 'command omitted the current revision');
      revision += 1;
      return JSON.stringify({ ok: true, value: snapshot(revision) });
    }
    if (request.op === 'close') return JSON.stringify({ ok: true, value: null });
    throw new Error(`unexpected ${request.op}`);
  });
  api.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' });
  const next = api.command({ kind: 'selectBone', boneId: 'pelvis' });
  assert(next.revision === 1, 'command snapshot revision was not retained');
  assert(requests[1]?.op === 'command' && requests[1].payload.kind === 'selectBone', 'command payload shape drifted');
  api.close();
  assert(api.currentSnapshot() === null, 'close retained a stale snapshot');
});

test('inspection is revision-pinned and never replaces the compact session snapshot', () => {
  const requests: CharacterRigSessionRequest[] = [];
  const probe: CharacterRigVertexProbe = {
    logicalVertexId: 12,
    renderDuplicateCount: 3,
    modelPosition: [0.25, 1.1, -0.4],
    influences: [
      { boneId: 'upper_arm_left', weight: 0.75 },
      { boneId: 'lower_arm_left', weight: 0.25 },
      { boneId: null, weight: 0 },
      { boneId: null, weight: 0 },
    ],
  };
  const api = createCharacterRigApi(() => (json) => {
    const request = JSON.parse(json) as CharacterRigSessionRequest;
    requests.push(request);
    if (request.op === 'open') return { ok: true, value: snapshot(3) };
    if (request.op === 'inspect') return { ok: true, value: probe };
    throw new Error(`unexpected ${request.op}`);
  });
  api.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' });
  const before = api.currentSnapshot();
  const inspected = api.inspect<CharacterRigVertexProbe>({ kind: 'probe', logicalVertexId: 12 });
  assert(inspected.logicalVertexId === 12 && inspected.influences[0].weight === 0.75,
    'inspection result was not returned exactly');
  assert(requests[1]?.op === 'inspect' && requests[1].sessionId === 'rig:one' &&
    requests[1].expectedRevision === 3 && requests[1].payload.kind === 'probe' &&
    requests[1].payload.logicalVertexId === 12, 'inspection bypassed the revision-pinned read door');
  assert(api.currentSnapshot() === before && api.currentSnapshot()?.revision === 3,
    'read-only inspection replaced or advanced the compact snapshot');
});

test('commitSave acknowledges an exact binding without inventing an authored revision', () => {
  const requests: CharacterRigSessionRequest[] = [];
  const binding: SkinBindingRef = {
    path: 'mesh/skin-a.rjsk',
    format: 'RJSK',
    version: 1,
    artifactHash: '11'.repeat(32),
    topologyHash: '22'.repeat(32),
    semanticHash: '33'.repeat(32),
    skeletonHash: '44'.repeat(32),
    objectBindingHash: '55'.repeat(32),
    logicalVertexCount: 48,
    maxInfluences: 4,
  };
  const api = createCharacterRigApi(() => (json) => {
    const request = JSON.parse(json) as CharacterRigSessionRequest;
    requests.push(request);
    if (request.op === 'open') return { ok: true, value: { ...snapshot(6), weightsStale: true } };
    if (request.op === 'commitSave') return {
      ok: true,
      value: { ...snapshot(6), weightsStale: false },
    };
    throw new Error(`unexpected ${request.op}`);
  });
  api.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' });
  const committed = api.commitSave(binding);
  assert(!committed.weightsStale && committed.revision === 6,
    'save acknowledgement did not adopt native durability truth at the same authored revision');
  assert(requests[1]?.op === 'commitSave' && requests[1].sessionId === 'rig:one' &&
    requests[1].expectedRevision === 6 && requests[1].payload.binding?.artifactHash === binding.artifactHash,
    'save acknowledgement lost its session, revision, or exact binding reference');
  api.commitSave(null);
  assert(requests[2]?.op === 'commitSave' && requests[2].payload.binding === null && requests[2].expectedRevision === 6,
    'draft save acknowledgement could not explicitly clear the durable binding');
});

test('undo and redo are revision-pinned commands with native history truth', () => {
  const requests: CharacterRigSessionRequest[] = [];
  let revision = 4;
  let history = { canUndo: true, canRedo: false, undoDepth: 2, redoDepth: 0 };
  const current = (): CharacterRigSnapshot => ({ ...snapshot(revision), history });
  const api = createCharacterRigApi(() => (json) => {
    const request = JSON.parse(json) as CharacterRigSessionRequest;
    requests.push(request);
    if (request.op === 'open') return { ok: true, value: current() };
    if (request.op === 'command') {
      assert(request.expectedRevision === revision, `${request.payload.kind} used a stale revision`);
      if (request.payload.kind === 'undo') {
        revision += 1;
        history = { canUndo: true, canRedo: true, undoDepth: 1, redoDepth: 1 };
        return { ok: true, value: current() };
      }
      if (request.payload.kind === 'redo') {
        revision += 1;
        history = { canUndo: true, canRedo: false, undoDepth: 2, redoDepth: 0 };
        return { ok: true, value: current() };
      }
    }
    throw new Error(`unexpected ${request.op}`);
  });
  api.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' });
  const undone = api.undo();
  assert(undone.revision === 5 && undone.history.undoDepth === 1 && undone.history.redoDepth === 1,
    'undo did not adopt native history availability');
  const redone = api.redo();
  assert(redone.revision === 6 && redone.history.undoDepth === 2 && redone.history.redoDepth === 0,
    'redo did not adopt native history availability');
  assert(requests[1]?.op === 'command' && requests[1].expectedRevision === 4 && requests[1].payload.kind === 'undo',
    'undo bypassed the revision-pinned command door');
  assert(requests[2]?.op === 'command' && requests[2].expectedRevision === 5 && requests[2].payload.kind === 'redo',
    'redo bypassed the revision-pinned command door');
});

test('failed open retains exact fault and retries the same immutable payload', () => {
  const requests: CharacterRigSessionRequest[] = [];
  let opens = 0;
  const api = createCharacterRigApi(() => (json) => {
    const request = JSON.parse(json) as CharacterRigSessionRequest;
    requests.push(request);
    if (request.op !== 'open') throw new Error(`unexpected ${request.op}`);
    opens += 1;
    if (opens === 1) return { ok: false, error: 'stable object ids do not match resident ranges' };
    return { ok: true, value: snapshot(0) };
  });
  const payload = {
    documentId: 'doc', modelId: 'model', packagePath: 'models/model',
    modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}',
  };
  let fault: CharacterRigSessionFault | null = null;
  try { api.open(payload); } catch (error) { fault = error as CharacterRigSessionFault; }
  assert(fault?.message === 'stable object ids do not match resident ranges', 'open fault was rewritten');
  assert(api.currentOpenFault() === fault.message, 'open fault was not retained for presentation');
  assert(api.currentOpenTarget() === null, 'failed open was exposed as the active native target');

  payload.rangeObjectIds[0] = 'mutated-after-open';
  const retried = api.retryOpen();
  assert(retried.sessionId === 'rig:one', 'retry did not accept the native snapshot');
  assert(api.currentOpenFault() === null, 'successful retry retained the prior fault');
  assert(api.currentOpenTarget()?.modelId === 'model' && api.currentOpenTarget()?.modelSourceKey === 'source',
    'successful retry did not retain its model-scoped active target');
  assert(
    requests[1]?.op === 'open' && requests[1].payload.rangeObjectIds[0] === 'body',
    'retry payload was changed by its caller after the first open',
  );
});

test('failed close clears the local session and rethrows the exact host fault', () => {
  let calls = 0;
  const api = createCharacterRigApi(() => (json) => {
    const request = JSON.parse(json) as CharacterRigSessionRequest;
    calls += 1;
    if (request.op === 'open') return { ok: true, value: snapshot(1) };
    if (request.op === 'close') return { ok: false, error: 'native close refused revision 1' };
    throw new Error(`unexpected ${request.op}`);
  });
  api.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' });
  let fault: CharacterRigSessionFault | null = null;
  try { api.close(); } catch (error) { fault = error as CharacterRigSessionFault; }
  assert(fault?.message === 'native close refused revision 1', 'close fault was swallowed or rewritten');
  assert(api.currentSnapshot() === null, 'failed close retained the native session snapshot');
  assert(api.currentOpenTarget() === null, 'failed close retained the active open target');
  let localFault: CharacterRigSessionFault | null = null;
  try { api.snapshot(); } catch (error) { localFault = error as CharacterRigSessionFault; }
  assert(localFault?.message === 'character rig session is not open', 'failed close retained local session identity');
  assert(calls === 2, 'local snapshot check called the host after failed close');
});

test('prepareSave is pinned to the exact open revision', () => {
  const api = createCharacterRigApi(() => (json) => {
    const request = JSON.parse(json) as CharacterRigSessionRequest;
    if (request.op === 'open') return { ok: true, value: snapshot(4) };
    if (request.op === 'prepareSave') return { ok: true, value: {
      sessionId: 'rig:one', revision: 4, logicalVertexCount: 8,
      topologyHash: 'topology', semanticHash: 'semantic', skeletonHash: 'skeleton', objectBindingHash: 'objects',
      geometry: { temporaryPath: '/tmp/geometry', artifactHash: 'geometry-hash', byteLength: 10 },
      skeleton: { id: 'model', bones: [{ id: 'root' }] },
      descriptor: { version: 1, state: 'draft', semanticBindings: [], objectBindings: [], fit: {}, shapeHash: '' },
    } };
    if (request.op === 'close') return { ok: true, value: null };
    throw new Error(`unexpected ${request.op}`);
  });
  api.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' });
  assert(api.prepareSave().revision === 4, 'save revision drifted');
});

test('stale revisions fail visibly and are never retried', () => {
  let calls = 0;
  const api = createCharacterRigApi(() => (json) => {
    const request = JSON.parse(json) as CharacterRigSessionRequest;
    calls += 1;
    if (request.op === 'open') return { ok: true, value: snapshot(2) };
    return { ok: false, error: 'stale revision', currentRevision: 3 };
  });
  api.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' });
  let fault: CharacterRigSessionFault | null = null;
  try { api.command({ kind: 'fitSkeleton' }); } catch (error) { fault = error as CharacterRigSessionFault; }
  assert(fault?.message === 'stale revision' && fault.currentRevision === 3, 'stale revision detail was hidden');
  assert(calls === 2, `stale command was retried ${calls - 1} times`);
});

test('unavailable and malformed doors fail closed', () => {
  const unavailable = createCharacterRigApi(() => undefined);
  assert(!unavailable.available(), 'missing door reported available');
  let missingFailed = false;
  try { unavailable.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' }); }
  catch { missingFailed = true; }
  assert(missingFailed, 'missing door did not fail');

  const malformed = createCharacterRigApi(() => () => '[]');
  let malformedFailed = false;
  try { malformed.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' }); }
  catch { malformedFailed = true; }
  assert(malformedFailed, 'malformed reply did not fail');

  const malformedHistory = createCharacterRigApi(() => () => ({
    ok: true,
    value: { ...snapshot(0), history: { canUndo: true, canRedo: false, undoDepth: 0, redoDepth: 0 } },
  }));
  let historyFailed = false;
  try { malformedHistory.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' }); }
  catch { historyFailed = true; }
  assert(historyFailed, 'inconsistent native history availability was accepted');

  const malformedTopology = createCharacterRigApi(() => () => ({
    ok: true,
    value: {
      ...snapshot(0),
      bodyTopology: {
        componentCount: 2,
        mainLogicalVertexCount: 40,
        mainTriangleCount: 60,
        detachedLogicalVertexCount: 3,
        detachedTriangleCount: 2,
        detachedFaceIndices: [61],
        detachedSelectionComplete: true,
      },
    },
  }));
  let topologyFailed = false;
  try { malformedTopology.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' }); }
  catch { topologyFailed = true; }
  assert(topologyFailed, 'incomplete detached-face diagnostics were accepted as a complete selection');
});

test('absent exercise normalizes to null; malformed exercise blocks fail closed', () => {
  // Hot-reload skew (req_4323): a cold host predating the exercise block simply
  // has nothing mounted, never a malformed snapshot.
  const legacyValue = { ...snapshot(0) } as Record<string, unknown>;
  delete legacyValue.exercise;
  const legacy = createCharacterRigApi(() => () => ({ ok: true, value: legacyValue }));
  const opened = legacy.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' });
  assert(opened.exercise === null, 'absent exercise block was not normalized to null');

  const mounted = createCharacterRigApi(() => () => ({
    ok: true,
    value: {
      ...snapshot(0),
      exercise: {
        source: 'clip:walk',
        name: 'walk',
        durationSeconds: 1.2,
        looping: true,
        playing: true,
        playheadSeconds: 0.4,
        channelCount: 12,
        matchedChannelCount: 12,
      },
    },
  }));
  const withExercise = mounted.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' });
  assert(withExercise.exercise?.source === 'clip:walk', 'well-formed exercise block was rejected');

  const overMatched = createCharacterRigApi(() => () => ({
    ok: true,
    value: {
      ...snapshot(0),
      exercise: {
        source: 'clip:walk',
        name: 'walk',
        durationSeconds: 1.2,
        looping: true,
        playing: false,
        playheadSeconds: 0.4,
        channelCount: 12,
        matchedChannelCount: 13,
      },
    },
  }));
  let overMatchedFailed = false;
  try { overMatched.open({ documentId: 'doc', modelId: 'model', packagePath: 'models/model', modelSourceKey: 'source', rangeObjectIds: ['body'], skeletonJson: '{}' }); }
  catch { overMatchedFailed = true; }
  assert(overMatchedFailed, 'an exercise matching more channels than the document speaks was accepted');
});

test('cold rig open uses the resolved package home instead of its display path', () => {
  const hydrated = { kind: 'character' as const, id: 'character:one', path: '/cart/editor/data/models/characters/One' };
  const resolved = characterRigPackagePath(hydrated, () => 'cart/editor/data/models/characters/One');
  assert(resolved === 'cart/editor/data/models/characters/One', 'resolved package directory was not forwarded exactly');
  const fallback = characterRigPackagePath(hydrated, () => null);
  assert(fallback === 'cart/editor/data/models/characters/One', 'display-path fallback remained cwd-absolute');
  assert(
    characterRigPackagePath({ ...hydrated, path: 'character/player' }, () => null) === 'character/player',
    'fresh relative starter path changed',
  );
});

log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILED`} (${passed} passed)`);
if (failed > 0) throw new Error(`${failed} character rig session tests failed`);
