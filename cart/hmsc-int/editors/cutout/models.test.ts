// models.test.ts — P4 behavior tests for /cutout's model texture targets
// (editors/cutout/models.ts, MODELPAINT-0605). The contracts: a painter
// document bakes into exactly the overlay the model documents carry (colors
// from the look, cells from the effective masks, muted layers skipped); the
// bake reopens as the same document (the re-edit law); and the save path
// applies through the doors onto a REAL stream — figure and vehicle
// documents round-trip their painting byte-exact across a store reload.

import { encodeBinaryMask } from '@reactjit/workspace/rle';
import { openStore } from '../../data';
import { createSessionLog } from '../sessions';
import { PAINT_DOC_KIND, PAINT_DOC_VERSION, type PaintDocument } from '../paint/layers';
import {
  bakeOverlayFromDocument, modelCanvasBg, modelCanvasDims, modelWorkId,
  overlayOf, reopenOverlayDocument, MODEL_PAINT,
} from './models';
import { applyBodyPaint, buildBody, parseBody, serializeBody, type BodyDocument } from '../../game/figure/body';
import { charactersStream } from '../../game/figure/stream';
import { PART_IDS, defaultProfile, type PartId } from '../../game/figure/shapes';
import { generateFace } from '../../game/figure/hed';
import { applyVehiclePaint, buildVehicle, makeVehicle, vehiclesStream } from '../../game/vehicle';
import { vehiclePaintTextureKey } from '../../game/painted';
import { assert, assertEqual, finish, test } from '../../game/_testkit';

declare const globalThis: any;

const ROOT = 'zig-out/game/test-cutout-models';

function wipeScratch(): void {
  for (const path of [
    `${ROOT}/streams/characters.jsonl`, `${ROOT}/streams/vehicles.jsonl`, `${ROOT}/streams/sessions.jsonl`,
    `${ROOT}/snapshots/characters.snapshot.json`, `${ROOT}/snapshots/vehicles.snapshot.json`, `${ROOT}/snapshots/sessions.snapshot.json`,
  ]) globalThis.__fs_remove?.(path);
}

/** A hand-built 8×4 document: layer A paints the left half red, layer B
 *  (muted) paints everything, layer C paints one pixel blue. */
function demoDocument(): PaintDocument {
  const w = 8, h = 4, n = w * h;
  const left = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) left[y * w + x] = 255;
  const all = new Uint8Array(n).fill(255);
  const dot = new Uint8Array(n);
  dot[n - 1] = 255;
  const layer = (id: string, mask: Uint8Array, color: string, muted = false) => ({
    id, name: id, groupName: null,
    config: { mode: 'rainbow' as any, blend: 'normal' as any, hueOffset: 0, phaseOffset: 0, muted, colors: [color], dim: 0.85 },
    base: encodeBinaryMask(mask, w, h),
    brush: null,
    clicks: [],
  });
  return {
    kind: PAINT_DOC_KIND, version: PAINT_DOC_VERSION,
    dims: { w, h },
    layers: [layer('A', left, '#ff0000'), layer('B', all, '#00ff00', true), layer('C', dot, '#0000ff')],
    activeLayer: 0, tool: 'brush', mode: 'erase', brushPx: 8,
    defaults: { mode: 'rainbow' as any, colors: ['#ffffff'], hueOffset: 0, phaseOffset: 0, dim: 0.85 },
    customSurfaces: [],
  };
}

function demoBody(): BodyDocument {
  const sculpts = {} as Record<PartId, number[]>;
  const profiles = {} as Record<PartId, number[]>;
  for (const id of PART_IDS) { sculpts[id] = [0]; profiles[id] = defaultProfile(id); }
  return buildBody({ skin: '#caa07a', amount: 0.35, headScaleY: 1.2, sculpts, profiles, headLayers: generateFace(2).layers });
}

test('the bake: look colors + effective masks at the grid, muted layers skipped', () => {
  const doc = demoDocument();
  const overlay = bakeOverlayFromDocument(doc, 777, 4);
  assertEqual(overlay.cols, 4, 'bake grid cols');
  assertEqual(overlay.rows, 4, 'bake grid rows (square — the sampleToCells shape)');
  assertEqual(overlay.stamp, 777, 'the save stamp rides the overlay');
  assertEqual(overlay.layers.length, 2, 'the muted layer bakes to nothing');
  assertEqual(overlay.layers[0].color, '#ff0000', 'layer A keeps its look color');
  // left half of a 4×4 grid = columns 0..1 of every row
  assertEqual(overlay.layers[0].cells.join(','), '0,1,4,5,8,9,12,13', 'cells are the effective mask sampled to the grid');
  assertEqual(overlay.layers[1].color, '#0000ff', 'layer C keeps its look color');
  assertEqual(overlay.layers[1].cells.join(','), '15', 'a single painted pixel lands in its cell');
});

test('the re-edit law: a baked overlay reopens as the document it came from', () => {
  const doc = demoDocument();
  const overlay = bakeOverlayFromDocument(doc, 1);
  // through JSON — exactly how it rides a model document on the stream
  const reopened = reopenOverlayDocument(JSON.parse(JSON.stringify(overlay)));
  assert(reopened !== null, 'the overlay carries its document');
  assertEqual(JSON.stringify(reopened), JSON.stringify(doc), 'reopen is lossless');
  assertEqual(reopenOverlayDocument({ ...overlay, paintDoc: undefined }), null, 'a bake-only overlay reopens as a fresh canvas');
});

test('bindings: dims, bg, work ids, overlay lookup', () => {
  const fig = { family: 'figure' as const, docId: 'chr-1', part: 'head' as const };
  const veh = { family: 'vehicle' as const, docId: 'car-1', part: 'hood' as const };
  assertEqual(modelCanvasDims(fig).w, 512, 'figure parts paint the kit unwrap');
  assertEqual(modelCanvasDims(fig).h, 256, 'figure unwrap is 2:1');
  assertEqual(modelCanvasDims(veh).w, MODEL_PAINT.vehicleCanvasPx, 'vehicle parts paint the square canvas');
  assertEqual(modelCanvasBg(fig, { skin: '#112233' }), '#112233', 'figure canvas sits on the skin');
  assertEqual(modelCanvasBg(veh, makeVehicle(5)), makeVehicle(5).color, 'vehicle canvas sits on the body color');
  assertEqual(modelWorkId(fig), 'model-figure-chr-1-head', 'work ids are stable per slot');
  const overlay = bakeOverlayFromDocument(demoDocument(), 9, 4);
  assertEqual(overlayOf(fig, { head: overlay })?.stamp, 9, 'overlayOf finds the part slot');
  assertEqual(overlayOf(fig, { torso: overlay }), null, 'other slots do not leak');
  assertEqual(overlayOf(fig, undefined), null, 'paintless models read null');
});

test('save applies through the doors: figure + vehicle round-trip a real store reload', () => {
  wipeScratch();
  const docPaint = bakeOverlayFromDocument(demoDocument(), 31337, 4);
  {
    const store = openStore(ROOT);
    const log = createSessionLog(store);
    const figures = store.defineStream(charactersStream);
    const vehicles = store.defineStream(vehiclesStream);
    const sesF = log.open('/cutout', figures);
    const sesV = log.open('/cutout', vehicles);
    // the /cutout save path: apply through the door, upsert the result
    sesF.commit({ kind: 'authored', id: 'chr-1', doc: applyBodyPaint(demoBody(), 'head', docPaint) }, 'chr-1: head painted');
    sesV.commit({ kind: 'authored', id: 'car-1', doc: applyVehiclePaint(makeVehicle(5), 'hood', docPaint) }, 'car-1: hood painted');
    sesF.close(); sesV.close();
  }
  {
    // a fresh process folds the streams — the painting is in the documents
    const store = openStore(ROOT);
    const figures = store.defineStream(charactersStream);
    const vehicles = store.defineStream(vehiclesStream);
    const chr = figures.state().characters['chr-1'];
    assert(chr !== undefined, 'the figure survived the reload');
    // byte fidelity through the document family's own serialize/parse
    const reparsed = parseBody(serializeBody(chr));
    assertEqual(JSON.stringify(reparsed?.paint?.head), JSON.stringify(docPaint), 'the figure overlay is byte-exact after reload + reparse');
    assertEqual(JSON.stringify(reopenOverlayDocument(reparsed!.paint!.head!)), JSON.stringify(demoDocument()), 'the painting reopens for re-editing off the reloaded model');
    const car = vehicles.state().vehicles['car-1'];
    assertEqual(JSON.stringify(car.paint?.hood), JSON.stringify(docPaint), 'the vehicle overlay is byte-exact after reload');
    const build = buildVehicle(car);
    assert(build.meshes.some((m) => m.textureKey === vehiclePaintTextureKey('hood', 31337)), 'the reloaded vehicle builds with the painted texture key');
  }
});

finish('cutout-models');
