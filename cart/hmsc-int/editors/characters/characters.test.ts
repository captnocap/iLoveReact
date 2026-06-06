// characters.test.ts — P4 behavior tests for the characters editor's
// headless core: the draft↔document exchange, region stamping, seeded
// generation, and the roster (save → stream → snapshot, through a real
// on-disk store in a scratch root — never the live data/).

import { openStore } from '../../data';
import { parseBody, serializeBody, type BodyDocument } from '../../game/figure/body';
import { bakeBodyDocument } from '../../game/figure/bake';
import { buildRigFrame } from '../../game/figure/rig';
import { PART_IDS, PROFILE_N, defaultProfile, type PartId } from '../../game/figure/shapes';
import { HED_GRID_W } from '../../game/figure/hed';
import { GAME_CAMERA } from '../../game/camera';
import {
  GRID_CELLS, draftFromDocument, draftPartGrid, draftToDocument, draftToHed, draftWithFace, emptyDraft, emptyGrid,
} from './draft';
import { SHAPE_REGIONS, applyRegionValues, regionSignature, stampGrid } from './regions';
import { generateCharacterDraft } from './generate';
import { createRoster } from './roster';
import { charactersStream, type CharactersStreamState } from '../../game/figure/stream';
import { createSessionLog } from '../sessions';
// the painter's headless module directly — the door also exports the JSX/hook
// half, which only bundles under the full cart alias set (paint.test.ts does
// the same)
import { createStrokeEngine } from '../paint/strokes';
import { globeSurface } from '@reactjit/geometries';
import { DEPTH_OVERLAY_WGSL, GREATER_POINTS, PAINT_EDITOR_TUNING, SCULPT_CANVAS, bytesFromGrid, depthOverlayData, editorPartParams, gridFromBytes, gridNodeAt, withNodeValue } from './paintKit';
import {
  GRAB_TUNING, applyGrabStamp, buildGrabClouds, cellUv, grabDragAxis, grabInstancesFor, grabPointWorld, gridDeltaFor,
  gridOverlayParams, pickGrab, screenAxisFor, stampRadiusUv, type GrabHit,
} from './grabKit';
import { assert, assertClose, assertEqual, finish, test } from '../../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-characters-editor';

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/store.db`, `${ROOT}/store.db-wal`, `${ROOT}/store.db-shm`, // STOREDB-0606: the scratch store is a DB now
    `${ROOT}/streams/characters.jsonl`,
    `${ROOT}/streams/sessions.jsonl`,
    `${ROOT}/snapshots/characters.snapshot.json`,
    `${ROOT}/snapshots/sessions.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

test('region stamps: smooth ellipse, mirror twin, clamp, zero is identity', () => {
  const grid = emptyGrid();
  stampGrid(grid, 0.25, 0.5, 0.1, 0.2, 0.8, true);
  const at = (u: number, v: number) => grid[Math.floor(v * 24) * HED_GRID_W + Math.floor(u * HED_GRID_W)];
  assert(at(0.25, 0.5) > 0.5, 'the stamp center raises hard');
  assert(at(0.75, 0.5) > 0.5, 'the mirror twin lands across u=0.5');
  assertEqual(at(0.5, 0.05), 0, 'outside the ellipse stays untouched');
  const saturated = emptyGrid();
  for (let i = 0; i < 5; i++) stampGrid(saturated, 0.5, 0.5, 0.4, 0.4, 1);
  assert(Math.max(...saturated) <= 1, 'repeated stamps clamp at the signed range');

  const base = emptyGrid();
  assert(applyRegionValues('head', base, {}) === base, 'all-zero sliders return the base reference (no copy, no re-bake)');
  const stamped = applyRegionValues('head', base, { brow: 0.5 });
  assert(stamped !== base && Math.max(...stamped) > 0, 'a live slider stamps a copy');
  assertEqual(regionSignature({ brow: 0.5 }), 'brow:0.50', 'the signature is stable for dyn keys');
  assertEqual(regionSignature({}), 'r0', 'empty values share the null signature');
  for (const part of PART_IDS) {
    assert(SHAPE_REGIONS[part].length >= 3, `${part} has named regions to slide`);
  }
});

test('draft → document → draft is lossless (the editor round-trip)', () => {
  const draft = generateCharacterDraft(424242);
  draft.regions.torso = { belly: 0.4 };
  const doc = draftToDocument(draft, 'round-trip');
  const parsed = parseBody(serializeBody(doc));
  assert(parsed !== null, 'the exported document must parse');
  const back = draftFromDocument(parsed!);

  assertEqual(back.skin, draft.skin, 'skin survives');
  assertEqual(back.clothing, draft.clothing, 'clothing survives');
  assertEqual(back.bottoms, draft.bottoms, 'bottoms survive');
  assertEqual(back.heldItem, draft.heldItem, 'the held item survives');
  assertEqual(back.bodyPose, draft.bodyPose, 'the pose survives');
  assertEqual(JSON.stringify(back.profiles.pipe), JSON.stringify(draft.profiles.pipe), 'dragged outlines survive exactly');
  assertEqual(back.face?.layers.length, draft.face?.layers.length, 'face layers survive');
  // regions baked INTO the sculpt: the loaded torso grid equals the composited
  // grid (to sculpt-byte quantization), and the loaded regions are empty
  const composited = draftPartGrid(draft, 'torso');
  for (const i of [0, 300, 600, 900]) {
    assertClose(back.grids.torso[i], composited[i], 1 / 127, `torso sculpt cell ${i} carries the baked region`);
  }
  assertEqual(Object.keys(back.regions.torso).length, 0, 'regions come back empty — their effect is in the sculpt');
});

test('the .hed coherence law: residue moves into the grid, never doubles', () => {
  const generated = generateCharacterDraft(7);
  const hed = draftToHed(generated, 'face-export');
  assertEqual(hed.sculpt.length, GRID_CELLS, 'the exported face carries the composited head sculpt');

  const fresh = draftWithFace(emptyDraft(), hed);
  assert(fresh.face !== null, 'the face document is kept');
  assertEqual(Math.max(...fresh.face!.sculpt.map(Math.abs)), 0, 'the kept face zeroes its sculpt (no double-count)');
  for (const i of [0, 500, 1000]) {
    assertClose(fresh.grids.head[i], hed.sculpt[i] / 127, 1e-9, `residue cell ${i} lives in the head grid now`);
  }
  assertEqual(fresh.skin, hed.skin, 'knobs ride the document in');
  assertEqual(fresh.headScaleY, hed.scaleY, 'skull stretch rides in');
});

test('seeded generation: deterministic, valid, varied (V2-AMENDED)', () => {
  const a = generateCharacterDraft(1234);
  const b = generateCharacterDraft(1234);
  assertEqual(JSON.stringify(draftToDocument(a, 't').parts), JSON.stringify(draftToDocument(b, 't').parts), 'the same seed reproduces the same character');

  const shapes = new Set<string>();
  const clothes = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    const draft = generateCharacterDraft(seed * 7919);
    shapes.add(draft.bodyShape);
    clothes.add(draft.clothing);
    assert(!(draft.accessories.includes('cap') && draft.accessories.includes('beanie')), 'cap and beanie never stack');
    if (draft.clothing === 'dress') assertEqual(draft.bodyShape, 'female', 'a dress forces the female shape');
    for (const id of PART_IDS) {
      assertEqual(draft.profiles[id].length, PROFILE_N, `${id} outline has PROFILE_N samples`);
      assert(draft.profiles[id].every((v) => v > 0), `${id} outline stays positive`);
      assertEqual(draft.grids[id].length, GRID_CELLS, `${id} grid is 48×24`);
    }
    const doc = draftToDocument(draft, `gen-${seed}`);
    assert(parseBody(serializeBody(doc)) !== null, 'every generated character exports a valid document');
  }
  assert(shapes.size >= 4, `generation varies body shapes (got ${shapes.size})`);
  assert(clothes.size >= 3, `generation varies clothing (got ${clothes.size})`);
});

test('outlines differ by shape: the generator warps the preset silhouette', () => {
  const heavyTorso = generateCharacterDraft(11).bodyShape;
  // find seeds with known shapes deterministically
  let heavy: number[] | null = null;
  let skinny: number[] | null = null;
  for (let seed = 1; seed < 400 && (!heavy || !skinny); seed++) {
    const d = generateCharacterDraft(seed);
    if (d.bodyShape === 'heavy' && d.clothing !== 'dress' && !heavy) heavy = d.profiles.torso;
    if (d.bodyShape === 'skinny' && d.clothing !== 'dress' && !skinny) skinny = d.profiles.torso;
  }
  assert(heavy !== null && skinny !== null, `the seed sweep finds both shapes (heavyTorso probe: ${heavyTorso})`);
  const mid = Math.floor(PROFILE_N / 2);
  assert(heavy![mid] > skinny![mid], 'a heavy torso outline is wider than a skinny one at the waist');
  const preset = defaultProfile('torso');
  assert(heavy!.some((v, i) => Math.abs(v - preset[i]) > 0.01), 'generated outlines leave the preset');
});

test('the roster: save → stream → snapshot; the saved doc bakes (the full chain)', () => {
  wipeScratch();
  const roster = createRoster(openStore(ROOT));
  const doc: BodyDocument = draftToDocument(generateCharacterDraft(555), 'roster-hero');
  roster.save('hero', doc);
  const checkpoint = roster.undoPoint();
  roster.save('extra', draftToDocument(generateCharacterDraft(556), 'extra'));
  roster.remove('extra');
  assertEqual(roster.state().order.join(','), 'hero', 'the roster folds saves and removals');
  assertEqual(roster.stateAt(checkpoint).order.join(','), 'hero', 'the checkpoint sees only hero');

  // save() materialized the snapshot in the same breath — a fresh store reads it
  const snapshot = openStore(ROOT).loadSnapshot<{ characters: Record<string, BodyDocument>; order: string[] }>('characters');
  assert(snapshot !== null, 'save() left a fresh snapshot for the compile');
  const restored = snapshot!.state.characters.hero;
  assertEqual(JSON.stringify(restored), JSON.stringify(doc), 'the snapshot doc is byte-exact');
  const baked = bakeBodyDocument(restored);
  assertEqual(baked.kind, 'baked-figure', 'the snapshot doc bakes into a figure');
  assert(baked.hitboxes.length > 0, 'the baked figure carries hit volumes');
});

test('the paint session: strokes note, saves commit — one labeled undo chain', () => {
  wipeScratch();
  const store = openStore(ROOT);
  const channel = store.defineStream(charactersStream);
  const log = createSessionLog(store);
  const ses = log.open('/characters', channel);

  // the shared painter's fidelity law the route leans on: at the no-pressure
  // fallback, a dab's radius IS the brush knob value — and mirror twins land
  // across the meridian (the route passes mirrorAxisX = PAINT_W / 2)
  const engine = createStrokeEngine({ brushPx: 14, mirrorAxisX: 96 });
  engine.begin();
  const dabs = engine.move(48, 40);
  assert(dabs.length >= 2, 'a mirrored stroke emits the dab and its twin');
  assertClose(dabs[0].radius, 14, 1e-9, 'fallback-pressure radius equals the brush knob');
  assertClose(dabs[1].x, 144, 1e-9, 'the twin lands mirrored across the meridian');
  engine.end();

  // route behavior: stroke release → note; Save → commit with the document
  ses.note('sculpt stroke · raise · 14px · torso');
  const doc = draftToDocument(generateCharacterDraft(777), 'painted-hero');
  ses.commit({ kind: 'authored', id: 'hero', doc }, 'painted-hero: saved');
  ses.close();

  const history = log.state();
  assertEqual(history.order.length, 1, 'one session this visit');
  const record = history.sessions[history.order[0]];
  assertEqual(record.route, '/characters', 'the session knows its route');
  assertEqual(record.commits.map((c) => c.label).join(' | '), 'sculpt stroke · raise · 14px · torso | painted-hero: saved', 'every interaction is a labeled commit, in order');
  assertEqual(record.commits[0].at, null, 'a stroke note is marker-only (content lands at save)');
  assert(record.commits[1].at !== null, 'the save carries its content event position');
  assert(record.closedSeq !== null, 'the session closed');

  // the undo chain: as of the stroke note hero does not exist; as of the save he does
  assert(!('hero' in channel.stateAt(record.commits[0].seq).characters), 'stateAt(the stroke) predates the save');
  assertEqual(JSON.stringify(channel.stateAt(record.commits[1].seq).characters.hero), JSON.stringify(doc), 'stateAt(the save) is the saved document');

  // the commit re-materialized the snapshot — the compile's view is fresh
  const snapshot = openStore(ROOT).loadSnapshot<CharactersStreamState>('characters');
  assert(snapshot !== null, 'the save left a fresh characters snapshot');
  assertEqual(JSON.stringify(snapshot!.state.characters.hero), JSON.stringify(doc), 'the snapshot doc is byte-exact');
});

// ── mesh grabbing (GRABSHAPE-0605) ───────────────────────────────────────────

const GRAB_RECT = { x: 0, y: 0, width: 800, height: 600 };

function grabParamsFor(draft = emptyDraft()) {
  return (id: PartId) => editorPartParams(id, draft, draft.grids[id]) as any;
}

test('mesh grab: the pick resolves to the right part (figure + part view)', () => {
  const paramsFor = grabParamsFor();
  const rig = buildRigFrame('neutral', 'stand');
  const instances = grabInstancesFor('figure', 'head', rig.assembly);
  const clouds = buildGrabClouds(instances, paramsFor);
  const cam = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: [0, 1.05, 0], yaw: 0, pitch: 5, dist: 4.2, fov: 45 });

  const pickAtBone = (world: [number, number, number]): GrabHit | null => {
    const s = GAME_CAMERA.worldToScreen(world, GRAB_RECT, cam);
    assert(s !== null, 'the probe point projects onto the screen');
    return pickGrab(s!.x, s!.y, GRAB_RECT, cam, clouds);
  };

  const head = pickAtBone(rig.bones.head.position as [number, number, number]);
  assertEqual(head?.part, 'head', 'a ray at the head grabs the head');
  const arm = pickAtBone(rig.bones.lForearm.position as [number, number, number]);
  assertEqual(arm?.part, 'pipe', 'a ray at the forearm grabs the limb pipe');
  const foot = pickAtBone(rig.bones.lFoot.position as [number, number, number]);
  assertEqual(foot?.part, 'foot', 'a ray at the foot grabs the foot');
  assertEqual(pickGrab(2, 2, GRAB_RECT, cam, clouds), null, 'empty space grabs nothing — no fake handles');

  // part view: the lone part placement picks the selected part
  const partInstances = grabInstancesFor('part', 'torso', rig.assembly);
  assertEqual(partInstances.length, 1, 'part view exposes exactly the selected part');
  const partClouds = buildGrabClouds(partInstances, paramsFor);
  const pcam = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: [0, 1.4, 0], yaw: 20, pitch: 12, dist: 4.2, fov: 45 });
  const s = GAME_CAMERA.worldToScreen([0, 1.4, 0], GRAB_RECT, pcam)!;
  assertEqual(pickGrab(s.x, s.y, GRAB_RECT, pcam, partClouds)?.part, 'torso', 'part view grabs the selected part');

  // GRABQOL-0605 angle fix: a VISIBLE cell's own pixel picks THAT cell —
  // nearest-to-the-ray inside the first-hit window, not min-t (which favored
  // silhouette cells nearer the camera at oblique views: "funky on angles").
  // Only camera-facing cells assert (a back cell's pixel correctly picks the
  // front surface in front of it — that's occlusion, not the bug).
  let visibleProbes = 0;
  for (const [gx, gy] of [[20, 8], [24, 12], [28, 16], [22, 6], [26, 10]] as Array<[number, number]>) {
    const i = (gy * HED_GRID_W + gx) * 3;
    const cw: [number, number, number] = [partClouds[0].points[i], partClouds[0].points[i + 1], partClouds[0].points[i + 2]];
    const cp = GAME_CAMERA.worldToScreen(cw, GRAB_RECT, pcam);
    if (!cp) continue;
    const ray = GAME_CAMERA.screenRay(cp.x, cp.y, GRAB_RECT, pcam);
    const facing = partClouds[0].outward[i] * ray.dir[0] + partClouds[0].outward[i + 1] * ray.dir[1] + partClouds[0].outward[i + 2] * ray.dir[2];
    if (facing > -0.35) continue; // edge-on or back-facing from this view
    visibleProbes++;
    const hit = pickGrab(cp.x, cp.y, GRAB_RECT, pcam, partClouds);
    assertEqual(hit && `${hit.gx},${hit.gy}`, `${gx},${gy}`, `the pixel of visible cell ${gx},${gy} picks exactly that cell`);
  }
  assert(visibleProbes >= 2, `the probe set saw the front of the torso (${visibleProbes} visible)`);
});

test('mesh grab: a drag stamps the grid the paint reads — and they compose (one truth)', () => {
  const { rx, ry } = stampRadiusUv(14, PAINT_EDITOR_TUNING.paint.width);
  const cell = cellUv(12, 12);
  const at = (gx: number, gy: number, g: number[]) => g[gy * HED_GRID_W + gx];

  // drag first
  const base = emptyGrid();
  const dragged = applyGrabStamp(base, cell.cu, cell.cv, rx, ry, 0.6, true);
  assertEqual(Math.max(...base.map(Math.abs)), 0, 'the stamp never mutates the drag-start base');
  assert(at(12, 12, dragged) > 0.4, 'the grabbed cell raises by the drag value');
  assert(at(35, 12, dragged) > 0.4, 'the mirror twin lands across the meridian (mirror toggle honored)');
  assertEqual(at(0, 0, dragged), 0, 'outside the stamp stays untouched');

  // …then paint: the release path uploads bytesFromGrid(dragged) to the paint
  // texture, and the NEXT paint stroke's readback runs gridFromBytes — the
  // drag must survive that round trip or the stroke would clobber it
  const bytes = bytesFromGrid(dragged);
  const afterRoundTrip = gridFromBytes(bytes);
  assertClose(at(12, 12, afterRoundTrip), at(12, 12, dragged), 0.02, 'the drag survives the paint-texture round trip');

  // a paint dab on another cell composes with the drag (texture-space edit,
  // exactly what a brush stroke does)
  const painted = Uint8Array.from(bytes);
  const pw = PAINT_EDITOR_TUNING.paint.width;
  const bx = pw / HED_GRID_W, by = PAINT_EDITOR_TUNING.paint.height / 24;
  for (let oy = 0; oy < by; oy++) for (let ox = 0; ox < bx; ox++) painted[(4 * by + oy) * pw + (40 * bx + ox)] = 255;
  const composed = gridFromBytes(painted);
  assert(at(40, 4, composed) > 0.9, 'the paint stroke lands');
  assertClose(at(12, 12, composed), at(12, 12, dragged), 0.02, 'the earlier drag is still there — one grid, two tools');

  // …and drag-after-paint: stamping onto a painted grid keeps the paint
  const paintedGrid = emptyGrid();
  paintedGrid[4 * HED_GRID_W + 40] = 0.5;
  const both = applyGrabStamp(paintedGrid, cell.cu, cell.cv, rx, ry, -0.7, false);
  assertClose(at(40, 4, both), 0.5, 1e-9, 'a drag leaves painted cells outside its stamp alone');
  assert(at(12, 12, both) < -0.4, 'the carve drag lands on its own cell');
  assertEqual(at(35, 12, both), 0, 'mirror off stamps no twin');
});

test('mesh grab: the drag axis points outward and mouse motion maps onto it', () => {
  const paramsFor = grabParamsFor();
  const instances = grabInstancesFor('part', 'torso', []);
  const clouds = buildGrabClouds(instances, paramsFor);
  const cam = GAME_CAMERA.solve(GAME_CAMERA.rigs.Orbit, { target: [0, 1.4, 0], yaw: 0, pitch: 5, dist: 4.2, fov: 45 });

  // grab a SIDE cell (u≈0.25 → the torso's +X flank) so the radial axis is
  // lateral on screen (a front cell's axis points at the camera — the
  // degenerate case the screen-axis floor exists for)
  const sideWorld = ((): [number, number, number] => {
    const i = (12 * HED_GRID_W + 12) * 3;
    return [clouds[0].points[i], clouds[0].points[i + 1], clouds[0].points[i + 2]];
  })();
  const sp = GAME_CAMERA.worldToScreen(sideWorld, GRAB_RECT, cam);
  assert(sp !== null, 'the flank cell projects');

  // worldToScreen is screenRay's exact inverse: the ray back through that
  // pixel passes through the point
  const ray = GAME_CAMERA.screenRay(sp!.x, sp!.y, GRAB_RECT, cam);
  const wx = sideWorld[0] - ray.origin[0], wy = sideWorld[1] - ray.origin[1], wz = sideWorld[2] - ray.origin[2];
  const t = wx * ray.dir[0] + wy * ray.dir[1] + wz * ray.dir[2];
  const miss = Math.sqrt(Math.max(0, wx * wx + wy * wy + wz * wz - t * t));
  assert(miss < 1e-3, `worldToScreen inverts screenRay (miss ${miss})`);

  const hit = pickGrab(sp!.x, sp!.y, GRAB_RECT, cam, clouds);
  assert(hit !== null, 'the flank cell is grabbable');
  const params = paramsFor('torso');
  const axis = grabDragAxis(hit!, params, instances[0]);
  // outward at the flank: away from the part's axis (the hit sits at +/-X)
  assert(axis[0] * hit!.world[0] > 0 || Math.abs(axis[0]) > Math.abs(axis[2]), 'the axis points out the flank');
  // |axis| per +1.0 grid value is the depth amount (radial displacement law)
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  assertClose(len, 0.35, 0.05, 'one grid unit of drag moves the surface by the depth amount');
  // doubling amount doubles the axis — the knob scales the drag like the brush
  const twice = grabDragAxis(hit!, { ...params, amount: 0.7 }, instances[0]);
  assertClose(Math.hypot(twice[0], twice[1], twice[2]), len * 2, 0.02, 'the depth-amount knob scales the drag axis');

  // mouse motion exactly along the screen axis = exactly that many grid units
  const sa = screenAxisFor(hit!.world, axis, GRAB_RECT, cam);
  assert(sa.len2 > 24 * 24, 'a lateral axis projects above the degeneracy floor');
  assertClose(gridDeltaFor(sa.x, sa.y, sa), 1, 1e-6, 'one axis-length of mouse travel = one grid unit');
  assertClose(gridDeltaFor(-sa.y, sa.x, sa), 0, 1e-6, 'perpendicular mouse travel maps to zero');
  // sensitivity floor: no part ever drags hotter than minPxPerUnit (the
  // head-easier-than-torso fix — small parts used to be hair-trigger + mushy)
  assert(Math.sqrt(sa.len2) >= 56 - 1e-6, 'px-per-unit never drops below the floor');

  // a camera-facing axis (the torso's flat front) has no usable screen
  // direction — the mapping falls back to drag-up-pulls-out at a fixed feel
  const toCam: [number, number, number] = [
    (cam.pos[0] - hit!.world[0]), (cam.pos[1] - hit!.world[1]), (cam.pos[2] - hit!.world[2]),
  ];
  const tl = Math.hypot(toCam[0], toCam[1], toCam[2]);
  const atCam: [number, number, number] = [toCam[0] / tl * 0.35, toCam[1] / tl * 0.35, toCam[2] / tl * 0.35];
  const fb = screenAxisFor(hit!.world, atCam, GRAB_RECT, cam);
  assertEqual(fb.x, 0, 'the degenerate fallback is pure screen-vertical');
  assertClose(gridDeltaFor(0, -90, fb), 1, 1e-6, 'a 90px upward drag = +1.0 (pull out) at the fallback feel');
  assertClose(gridDeltaFor(0, 90, fb), -1, 1e-6, 'a 90px downward drag = −1.0 (carve in)');
});

test('displacement grows along the surface normal — a chest pull comes out the chest (NORMALPULL-0605)', () => {
  const paramsFor = grabParamsFor();
  const inst = grabInstancesFor('part', 'torso', [])[0];
  const torso = paramsFor('torso');

  // a chest cell TWO columns off the front meridian (u=0.5), mid-torso
  const gx = 26, gy = 8;
  const { cu, cv } = cellUv(gx, gy);
  const hit = { part: 'torso', instanceIndex: 0, gx, gy, cu, cv, world: [0, 0, 0], grabRadius: 0.1, t: 1 } as GrabHit;
  const axis = grabDragAxis(hit, torso, inst);
  const ax = Math.abs(axis[0]), az = Math.abs(axis[2]);
  assert(az > 0, 'the chest axis points forward at all');

  // the OLD radial law pushed along the core ray, whose sideways fraction the
  // torso's scaleZ flatten amplifies — the user's "directional split". The
  // radial direction at this cell (analytic, scaleZ-squashed):
  const phi = Math.PI / 2 - 2 * Math.PI * cu;
  const rx = Math.abs(Math.cos(phi) * 1.0); // scaleX 1
  const rz = Math.abs(Math.sin(phi) * 0.62); // the torso flatten
  const radialVeer = rx / rz;
  const normalVeer = ax / az;
  assert(normalVeer < radialVeer * 0.75, `the normal pull veers far less than the radial did (${normalVeer.toFixed(3)} vs ${radialVeer.toFixed(3)})`);

  // sphere sanity: with no profile and uniform scale, the normal IS the
  // radius — heads sculpt exactly as before
  const sphere = { radius: 1, segments: 16, rings: 8, displace: emptyGrid(), dCols: HED_GRID_W, dRows: 24, amount: 0.35 } as any;
  const sAxis = grabDragAxis(hit, sphere, inst);
  const sLen = Math.hypot(sAxis[0], sAxis[1], sAxis[2]);
  const theta = Math.PI * cv;
  const radial = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
  const dot = (sAxis[0] * radial[0] + sAxis[1] * radial[1] + sAxis[2] * radial[2]) / sLen;
  assertClose(dot, 1, 1e-3, 'on a sphere the normal pull IS the radial pull (heads unchanged)');
  assertClose(sLen, 0.35, 0.01, 'displacement stays world-units (one grid unit = the depth amount)');
});

test('the grid shell floats a constant lift above the skin — no bend swallows it (GRIDSHELL-0605)', () => {
  // a skin with a deep carve AND a bump, so concave and convex bends both probe
  const draft = emptyDraft();
  stampGrid(draft.grids.torso, 0.5, 0.6, 0.12, 0.18, -0.95, false);
  stampGrid(draft.grids.torso, 0.3, 0.3, 0.1, 0.12, 0.85, true);
  const params = editorPartParams('torso', draft, draft.grids.torso) as any;
  const shell = gridOverlayParams(params);
  const skin = globeSurface(params);
  const over = globeSurface(shell as any);
  // a constant added to every cell survives the bilinear sample and the pole
  // averages, so the shell sits EXACTLY lift along the local normal — in the
  // carve bowl, on the bump, mid-flank, and at the pole rows alike (the
  // center-scale inflate dipped under the carve: the swallowed-lattice report)
  for (const [u, v] of [[0.5, 0.6], [0.53, 0.66], [0.3, 0.3], [0.7, 0.3], [0.1, 0.5], [0.5, 0.02], [0.5, 0.98]] as Array<[number, number]>) {
    const s = skin(u, v);
    const o = over(u, v);
    const gap = Math.hypot(o[0] - s[0], o[1] - s[1], o[2] - s[2]);
    assertClose(gap, GRAB_TUNING.grid.lift, GRAB_TUNING.grid.lift * 0.02, `constant lift at (${u}, ${v})`);
  }
});

test('a /characters save never wipes /cutout paint: the draft carries overlays opaque (MODELPAINT-0605)', () => {
  const draft = generateCharacterDraft(77);
  const doc = draftToDocument(draft, 'painted subject');
  assert(!('paint' in doc), 'an unpainted draft saves without the channel');
  // /cutout painted the head and torso on the SAVED document
  const overlay = { version: 1 as const, stamp: 5150, cols: 4, rows: 4, layers: [{ color: '#dc2626', cells: [0, 5] }] };
  const painted: BodyDocument = { ...doc, paint: { head: overlay, torso: { ...overlay, stamp: 5151 } } };
  // the roster load → edit → save cycle (the wipe hazard under test)
  const reloaded = draftFromDocument(parseBody(serializeBody(painted))!);
  const resaved = draftToDocument({ ...reloaded, skin: '#112233' }, 'edited after painting');
  assertEqual(JSON.stringify(resaved.paint), JSON.stringify(painted.paint), 'sculpt/wardrobe edits in /characters never wipe the painting');
  assertEqual(resaved.skin, '#112233', 'the edit itself still lands');
});

test('the sculpt canvas is a measurement surface: fixed palette, guides always read (SCULPTSPLIT-0606)', () => {
  // the palette is constants — no field of it derives from character data
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  assert(/^#[0-9a-f]{6}$/i.test(SCULPT_CANVAS.base), 'base is a fixed hex token');
  assert(/^#[0-9a-f]{6}$/i.test(SCULPT_CANVAS.silhouette), 'silhouette is a fixed hex token');
  const inkLum = 0.2126 * SCULPT_CANVAS.guideInk[0] + 0.7152 * SCULPT_CANVAS.guideInk[1] + 0.0722 * SCULPT_CANVAS.guideInk[2];
  assert(inkLum - lum(SCULPT_CANVAS.base) >= 0.4, `guide ink reads on the base (Δlum ${(inkLum - lum(SCULPT_CANVAS.base)).toFixed(2)})`);
  assert(lum(SCULPT_CANVAS.silhouette) - lum(SCULPT_CANVAS.base) >= 0.1, 'the lathe silhouette reads on the base');
  // the shader's gridline ink IS the palette's — one truth, no drift
  assert(DEPTH_OVERLAY_WGSL.includes(`vec3f(${SCULPT_CANVAS.guideInk.join(', ')})`), 'the overlay shader embeds the palette guide ink');
});

test('the overlay data[] contract: 10 floats always, rest is zeros, aiming is chunky (SCULPTSPLIT+GRIDNODES)', () => {
  // a short array reads out of bounds in the shader — the builder is the law
  assertEqual(JSON.stringify(depthOverlayData()), JSON.stringify([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 'rest state is 10 zeros (smooth display, no footprint, no selection)');
  const aiming = depthOverlayData({ hover: { u: 0.25, v: 0.5 }, brushPx: 16, mode: 'lower', mirror: true });
  assertEqual(aiming.length, 10, 'aiming state is 10 floats');
  assertEqual(aiming[0], 1, 'aiming snaps the display chunky');
  assertEqual(aiming[5], 1, 'carve maps to mode 1 (ring tint)');
  assertEqual(aiming[6], 1, 'mirror rides to the twin footprint');
  assert(aiming[4] > 0 && aiming[4] < 0.5, 'brush radius lands in sane v units');
  // a live node selection alone (no hover) still snaps chunky + rings
  const sel = depthOverlayData({ hover: null, brushPx: 16, mode: 'raise', mirror: false, selected: { u: 0.3, v: 0.4 } });
  assertEqual(sel[0], 1, 'selection snaps the display chunky');
  assertEqual(sel[1], 0, 'no footprint without hover');
  assertEqual(sel[7], 1, 'selection ring on');
  assertClose(sel[8], 0.3, 1e-9, 'sel u rides');
  assertClose(sel[9], 0.4, 1e-9, 'sel v rides');
});

test('grid nodes: click→node mapping, one-cell value edits, greater points sit on the guides (GRIDNODES-0606)', () => {
  const { width: GW, height: GH } = PAINT_EDITOR_TUNING.grid;
  // a click maps to the cell under it; the node's u/v is that cell's CENTER
  const n = gridNodeAt(0.26, 0.52);
  assertEqual(n.gx, Math.floor(0.26 * GW), 'node column');
  assertEqual(n.gy, Math.floor(0.52 * GH), 'node row');
  assertEqual(n.idx, n.gy * GW + n.gx, 'node index');
  assertClose(n.u, (n.gx + 0.5) / GW, 1e-9, 'center u');
  assertClose(n.v, (n.gy + 0.5) / GH, 1e-9, 'center v');
  assertEqual(gridNodeAt(n.u, n.v).idx, n.idx, 'center → the same node (round-trip)');
  // the value edit: pure, clamped, exactly one cell moves
  const grid = new Array(GW * GH).fill(0);
  const out = withNodeValue(grid, n.idx, 1.7);
  assertEqual(out[n.idx], 1, 'clamped to the signed depth range');
  assertEqual(out.filter((x) => x !== 0).length, 1, 'exactly one node moved');
  assertEqual(grid[n.idx], 0, 'pure — the source grid is untouched');
  // greater points: ON the guide crossings, distinct colors, and the canvas
  // dot + the 3D flag ride the SAME uv (flagWorld takes p.u/p.v raw)
  assertEqual(GREATER_POINTS.length, 3, 'three meridian × equator crossings');
  for (const p of GREATER_POINTS) {
    assert([0.25, 0.5, 0.75].includes(p.u) && p.v === 0.5, `(${p.u}, ${p.v}) sits on a meridian × the equator`);
    assert(DEPTH_OVERLAY_WGSL.includes(`vec3f(${p.ink.join(', ')})`), 'the canvas dot color is baked in the shader');
    // color IDENTITY across views: the 3D flag's hex IS the canvas dot's ink
    const n = parseInt(p.color.slice(1), 16);
    const rgb = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    for (let c = 0; c < 3; c++) {
      assertClose(p.ink[c], rgb[c], 0.011, `${p.color} channel ${c}: one token on both sides`);
    }
  }
  assertEqual(new Set(GREATER_POINTS.map((p) => p.color)).size, 3, 'distinct flag colors');
  // 2D↔3D consistency: the same uv resolves to a finite world flag position
  const draft = generateCharacterDraft(7);
  const params = editorPartParams('torso', draft, draft.grids.torso);
  const inst = grabInstancesFor('part', 'torso', [])[0];
  for (const p of GREATER_POINTS) {
    const w = grabPointWorld(params as any, inst, p.u, p.v);
    assert((w as number[]).every(Number.isFinite), 'the 3D flag resolves at the canvas dot uv');
  }
});

finish('editors/characters');
