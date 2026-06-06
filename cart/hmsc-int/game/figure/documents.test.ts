// documents.test.ts — P4 behavior tests for the .hed and .body documents.
//
// The contracts under test: documents round-trip and reject impostors; color
// and relief come from the SAME shapes (the .hed coherence law); generated
// faces are seeded variety (same seed, same face — V2-AMENDED); animations
// are pure deterministic transforms; pre-finger .body files stay valid.

import {
  HED_ANIM_FRAMES, HED_GRID_H, HED_GRID_W, animateHed, buildHed, generateFace,
  hedDepthGrid, parseHed, serializeHed,
} from './hed';
import { applyBodyPaint, buildBody, parseBody, partsWithPelvisFallback, serializeBody } from './body';
import {
  PAINT_TARGET_BY_BONE, PAINT_TARGET_IDS, PAINT_TARGET_NO_PART_FALLBACK, PAINT_TARGET_PART,
  PART_IDS, PROFILE_N, defaultProfile, paintTargetForInstance, paintTargetPart, type PartId,
} from './shapes';
import type { PaintedOverlay } from '../painted';
import { assert, assertClose, assertEqual, finish, test } from '../_testkit';

function gridAt(grid: number[], u: number, v: number): number {
  const gx = Math.min(HED_GRID_W - 1, Math.floor(u * HED_GRID_W));
  const gy = Math.min(HED_GRID_H - 1, Math.floor(v * HED_GRID_H));
  return grid[gy * HED_GRID_W + gx];
}

test('.hed round-trips and rejects impostors', () => {
  const doc = generateFace(7);
  const back = parseHed(serializeHed(doc));
  assert(back !== null, 'a serialized document must parse');
  assertEqual(JSON.stringify(back), JSON.stringify(doc), 'round-trip must be lossless');
  assertEqual(parseHed('{"kind":"sqi","version":1}'), null, 'wrong kind must be rejected');
  assertEqual(parseHed('{"kind":"hed","version":2}'), null, 'unknown version must be rejected');
  assertEqual(parseHed('not json'), null, 'garbage must be rejected');
  const torn = { ...doc, sculpt: doc.sculpt.slice(0, 5) };
  assertEqual(parseHed(JSON.stringify(torn)), null, 'a wrong-size sculpt grid must be rejected');
});

test('color and relief agree: the nose bulges, the sockets carve (one-shape law)', () => {
  const doc = generateFace(1234, { style: 'masculine' });
  const grid = hedDepthGrid(doc);
  assertEqual(grid.length, HED_GRID_W * HED_GRID_H, 'the grid covers the unwrap');
  const nose = doc.layers.find((l) => l.id === 'nose')!;
  const sockets = doc.layers.find((l) => l.id === 'sockets')!;
  assert(gridAt(grid, nose.shapes[0].cx, nose.shapes[0].cy) > 0.1, 'the nose must bulge outward');
  assert(gridAt(grid, sockets.shapes[0].cx, sockets.shapes[0].cy) < -0.02, 'the eye sockets must carve inward');
  // mirror twin: the OTHER socket (across u=0.5) carves too
  assert(gridAt(grid, 1 - sockets.shapes[0].cx, sockets.shapes[0].cy) < -0.02, 'mirrored shapes must stamp both sides');
  for (const v of grid) assert(v >= -1 && v <= 1, 'depth must stay clamped signed');
});

test('faces are seeded variety: same seed same face, new seed new face', () => {
  const a = generateFace(42);
  const b = generateFace(42);
  const stripDate = (d: any) => ({ ...d, metadata: { ...d.metadata, createdAt: 0 } });
  assertEqual(JSON.stringify(stripDate(a)), JSON.stringify(stripDate(b)), 'same seed must regenerate the same face');
  assertEqual(a.metadata?.seed, 42, 'the seed must ride the document');
  const c = generateFace(43);
  assert(JSON.stringify(stripDate(a)) !== JSON.stringify(stripDate(c)), 'a different seed must vary the face');
  const fem = generateFace(99, { style: 'feminine' });
  assertClose(fem.scaleY, 1.14, 1e-9, 'the style option must steer generation');
});

test('face animations are pure deterministic document transforms', () => {
  const doc = generateFace(5);
  const before = JSON.stringify(doc);
  const talk2a = animateHed(doc, 'talk', 2);
  const talk2b = animateHed(doc, 'talk', 2);
  assertEqual(JSON.stringify(talk2a), JSON.stringify(talk2b), 'same (anim, phase) must give the same document');
  assertEqual(JSON.stringify(doc), before, 'the source document must never mutate');
  assert(talk2a.layers.some((l) => l.id === 'teeth'), 'the open talk frame must show teeth');
  assertEqual(animateHed(doc, 'talk', 0).layers.some((l) => l.id === 'teeth'), false, 'the closed frame must not');
  const cry = animateHed(doc, 'cry', 1);
  assert(cry.layers.some((l) => l.id === 'tears'), 'cry must shed tears');
  assert(cry.layers.some((l) => l.id === 'nose'), 'untargeted layers must survive the transform');
  for (const anim of Object.keys(HED_ANIM_FRAMES) as (keyof typeof HED_ANIM_FRAMES)[]) {
    assert(HED_ANIM_FRAMES[anim] > 0, `${anim} must declare its loop length`);
  }
});

test('.body round-trips, quantizes sculpts, and keeps pre-finger files valid', () => {
  const sculpts = {} as Record<PartId, number[]>;
  const profiles = {} as Record<PartId, number[]>;
  for (const id of PART_IDS) {
    sculpts[id] = [0.5, -1, 1, 0.004];
    profiles[id] = defaultProfile(id);
  }
  const doc = buildBody({
    skin: '#caa07a', amount: 0.35, headScaleY: 1.2, sculpts, profiles,
    headLayers: generateFace(3).layers, bodyShape: 'female', clothing: 'dress', title: 'test subject',
  });
  assertEqual(doc.parts.torso.sculpt.join(','), '64,-127,127,1', 'sculpt floats must quantize to signed bytes');
  assertEqual(doc.parts.head.profile, undefined, 'the head wears doc scale, not a dragged outline');
  assertEqual(doc.parts.pipe.profile?.length, PROFILE_N, 'limb outlines must carry the dragged grid');
  const back = parseBody(serializeBody(doc));
  assert(back !== null, 'a serialized body must parse');
  assertEqual(back!.clothing, 'dress', 'wardrobe must round-trip');

  // a pre-finger document (no parts.finger) must stay valid forever
  const legacy: any = JSON.parse(serializeBody(doc));
  delete legacy.parts.finger;
  assert(parseBody(JSON.stringify(legacy)) !== null, 'legacy part sets must keep parsing (evolution by addition)');
  assertEqual(parseBody('{"kind":"body","version":1}'), null, 'a body without parts must be rejected');
});

test('painted overlays are additive: pre-paint documents byte-unaffected, apply round-trips (MODELPAINT-0605)', () => {
  const sculpts = {} as Record<PartId, number[]>;
  const profiles = {} as Record<PartId, number[]>;
  for (const id of PART_IDS) {
    sculpts[id] = [0];
    profiles[id] = defaultProfile(id);
  }
  const doc = buildBody({
    skin: '#caa07a', amount: 0.35, headScaleY: 1.2, sculpts, profiles,
    headLayers: generateFace(11).layers, title: 'paint subject',
  });
  // a pre-paint document parses to EXACTLY itself — the channel is invisible
  // until used (old data unaffected, the ruling's bar)
  assertEqual(JSON.stringify(parseBody(serializeBody(doc))), JSON.stringify(doc), 'paintless documents are byte-unaffected');
  assert(!('paint' in doc), 'buildBody never mints the channel');

  const overlay: PaintedOverlay = {
    version: 1, stamp: 99, cols: 4, rows: 2,
    layers: [{ color: '#ff0000', cells: [0, 7] }],
    paintDoc: { kind: 'paint-doc' },
  };
  const painted = applyBodyPaint(doc, 'head', overlay);
  assertEqual(JSON.stringify(doc.paint), undefined, 'apply is pure — the source document never mutates');
  assertEqual(painted.paint?.head?.stamp, 99, 'the overlay lands on its part');
  const back = parseBody(serializeBody(painted));
  assertEqual(JSON.stringify(back?.paint?.head), JSON.stringify(overlay), 'a painted document round-trips its overlay losslessly');

  // a torn overlay degrades to unpainted — never a rejected document
  const torn: any = JSON.parse(serializeBody(painted));
  torn.paint.head.cols = 0;
  const degraded = parseBody(JSON.stringify(torn));
  assert(degraded !== null, 'a torn overlay must not reject the document');
  assert(degraded!.paint === undefined, 'the torn overlay degrades away');

  // removal: null deletes the slot; the last removal drops the channel
  const cleared = applyBodyPaint(painted, 'head', null);
  assert(!('paint' in cleared), 'removing the last overlay removes the channel (byte-parity with pre-paint)');
  assertEqual(JSON.stringify(cleared), JSON.stringify(doc), 'paint → unpaint is a perfect round trip');
});

test('LIMBPAINT: segments resolve per bone, documents round-trip segment paint', () => {
  // the user's ruling: "left upper arm, lower arm, upper leg, lower leg"
  assertEqual(paintTargetForInstance('pipe', 'lUpperArm'), 'lUpperArm', 'left upper arm is its own target');
  assertEqual(paintTargetForInstance('pipe', 'lForearm'), 'lLowerArm', 'the forearm is the lower arm');
  assertEqual(paintTargetForInstance('pipe', 'lWrist'), 'lLowerArm', 'a forearm tattoo runs to the wrist');
  assertEqual(paintTargetForInstance('pipe', 'rShin'), 'rLowerLeg', 'right shin is the right lower leg');
  assertEqual(paintTargetForInstance('hand', 'rHand'), 'rHand', 'hands split left/right');
  assertEqual(paintTargetForInstance('foot', 'lFoot'), 'lFoot', 'feet split left/right');
  // PELVISMESH-0606: the pelvis is a real PART — its instance resolves
  // through the part path, and a stray pelvis bone on the torso is just torso
  assertEqual(paintTargetForInstance('pelvis', 'pelvis'), 'pelvis', 'the pelvis part is its own target');
  assertEqual(paintTargetForInstance('torso', 'pelvis'), 'torso', 'no pelvis segment exists anymore — the torso stays torso');
  assertEqual(paintTargetForInstance('torso', 'torso'), 'torso', 'the torso instance stays the torso');
  assertEqual(paintTargetForInstance('hand', 'lUpperArm'), 'hand', 'a joint blob on a limb bone keeps its plain part (the part guard)');
  assertEqual(paintTargetForInstance('pipe', undefined), 'pipe', 'boneless instances keep the part');
  // every mapped segment names a real part + appears in the id list
  for (const bone of Object.keys(PAINT_TARGET_BY_BONE)) {
    const segment = PAINT_TARGET_BY_BONE[bone];
    assert((PAINT_TARGET_IDS as readonly string[]).includes(segment), `${segment} is a registered target`);
    assert((PART_IDS as readonly string[]).includes(PAINT_TARGET_PART[segment]), `${segment} paints a real part`);
  }
  assertEqual(paintTargetPart('lUpperLeg'), 'pipe', 'segments paint the pipe unwrap');
  assertEqual(paintTargetPart('torso'), 'torso', 'parts are their own unwrap');
  assertEqual(paintTargetPart('pelvis'), 'pelvis', 'the pelvis paints its OWN unwrap (PELVISMESH-0606)');
  assertEqual(PAINT_TARGET_NO_PART_FALLBACK.size, 0, 'the no-fallback set emptied — the pelvis mesh split killed the cascade structurally');
  assert(!PAINT_TARGET_NO_PART_FALLBACK.has('lLowerArm'), 'limbs keep the all-limbs fallback');

  // segment paint rides the document exactly like part paint
  const sculpts = {} as Record<PartId, number[]>;
  const profiles = {} as Record<PartId, number[]>;
  for (const id of PART_IDS) { sculpts[id] = [0]; profiles[id] = defaultProfile(id); }
  const doc = buildBody({ skin: '#caa07a', amount: 0.35, headScaleY: 1.2, sculpts, profiles, headLayers: [] });
  const overlay = { version: 1 as const, stamp: 7, cols: 4, rows: 4, layers: [{ color: '#16a34a', cells: [3] }] };
  const painted = applyBodyPaint(applyBodyPaint(doc, 'lLowerArm', overlay), 'pelvis', { ...overlay, stamp: 8 });
  const back = parseBody(serializeBody(painted));
  assertEqual(back?.paint?.lLowerArm?.stamp, 7, 'a segment overlay round-trips');
  assertEqual(back?.paint?.pelvis?.stamp, 8, 'the pelvis overlay round-trips');
  assertEqual(JSON.stringify(parseBody(serializeBody(doc))), JSON.stringify(doc), 'pre-segment documents stay byte-unaffected');
});

test('PELVISMESH-0606: the pelvis is a real part; old documents map torso → pelvis deterministically', () => {
  // the roster: the pelvis is a first-class part everywhere parts enumerate
  assert((PART_IDS as readonly string[]).includes('pelvis'), 'the pelvis is in the part roster');
  assertEqual(PAINT_TARGET_IDS.filter((id) => id === 'pelvis').length, 1, 'exactly one pelvis target (part, not segment)');
  assertEqual(defaultProfile('pelvis').length, PROFILE_N, 'the pelvis carries a sculptable outline');

  const sculpts = {} as Record<PartId, number[]>;
  const profiles = {} as Record<PartId, number[]>;
  for (const id of PART_IDS) { sculpts[id] = [0.25, -0.5]; profiles[id] = defaultProfile(id); }
  const doc = buildBody({ skin: '#caa07a', amount: 0.35, headScaleY: 1.2, sculpts, profiles, headLayers: [] });
  assert(!!doc.parts.pelvis, 'new saves carry the pelvis part');
  assertEqual(JSON.stringify(partsWithPelvisFallback(doc.parts)), JSON.stringify(doc.parts), 'docs with a pelvis pass through untouched');
  assert(partsWithPelvisFallback(doc.parts) === doc.parts, 'untouched means the SAME reference (no re-bake churn)');

  // a PRE-SPLIT document (no parts.pelvis): the old pelvis socket wore the
  // torso, so the deterministic mapping is a torso copy — old saves render
  // exactly as they always did
  const old: any = JSON.parse(serializeBody(doc));
  old.parts.torso.sculpt = [9, -9, 3];
  delete old.parts.pelvis;
  const parsed = parseBody(JSON.stringify(old));
  assert(parsed !== null, 'pre-split documents keep parsing (V20)');
  assertEqual(parsed!.parts.pelvis.sculpt.join(','), '9,-9,3', 'the pelvis inherits the torso sculpt');
  assertEqual(parsed!.parts.pelvis.profile?.join(','), old.parts.torso.profile.join(','), 'the pelvis inherits the torso outline');
  assertEqual(parsed!.parts.pelvis.layers.length, 0, 'no face layers ride the pelvis');
  // the copy is a COPY — sculpting one must not echo into the other
  parsed!.parts.pelvis.sculpt[0] = 99;
  assertEqual(parsed!.parts.torso.sculpt[0], 9, 'pelvis and torso are separate arrays after the split');

  // old pelvis SEGMENT paint maps 1:1 onto the new mesh: the target id is
  // unchanged and its unwrap dims are the same 512×256 contract every part
  // shares, so a saved overlay lands on the pelvis mesh exactly where it
  // landed on the socket
  const overlay: PaintedOverlay = { version: 1, stamp: 11, cols: 4, rows: 2, layers: [{ color: '#ff0000', cells: [1] }] };
  const oldPainted: any = JSON.parse(serializeBody(applyBodyPaint(doc, 'pelvis', overlay)));
  delete oldPainted.parts.pelvis;
  const reparsed = parseBody(JSON.stringify(oldPainted));
  assertEqual(reparsed?.paint?.pelvis?.stamp, 11, 'pre-split pelvis paint survives onto the pelvis part');
  assertEqual(paintTargetPart('pelvis'), 'pelvis', 'and resolves onto the pelvis mesh, not the torso');
});

finish('game/figure/documents');
