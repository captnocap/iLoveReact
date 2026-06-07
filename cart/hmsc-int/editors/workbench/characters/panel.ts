// editors/workbench/characters/panel.ts — the character FAMILY's HEADLESS
// half (WBCHAR-0606 + CLOTHSPLIT-0606 phase 2): the generated PanelSpecs +
// the source cores (roster, actions, lenses) — everything except the stages'
// JSX, so the P4 suite bundles without the React half (the characters.test.ts
// law). source.tsx / animationSource.tsx wrap these cores and add their
// stages.
//
// TWO contexts over ONE store (req_0040, amended by CLOTHFLIP-0607):
//   characterPanel — MESH ONLY: identity, part, body shape, face mesh,
//                    sculpt, regions. No wardrobe, no animation commands.
//   animationPanel — the rig/posing context: pose, face anim, rig anim,
//                    script + presets (parity rows A1-A7).
// (the wardrobe cosplay context died — CLOTHFLIP-0607; clothing lives at
// editors/workbench/clothing/, the GARMENT source.)

import type { WorkbenchSource, RosterRow, ActionSpec } from '../../../shell/Workbench';
import type { PanelSpec, FieldSpec } from '../../../shell/fields';
import type { LensSpec } from '../../../shell/stage';
import { characterWorkbenchStore, type CharacterStore, type CharacterLens } from './store';
import { DRAFT_DEFAULTS } from '../../characters/draft';
import { SHAPE_REGIONS } from '../../characters/regions';
import { PAINT_EDITOR_TUNING } from '../../characters/paintKit';
import { ANIM_PRESETS, DEFAULT_ANIM_SCRIPT } from '../../characters/animPresets';
import {
  BODY_POSES, BODY_SHAPES, FOOT_SHAPE_DEFAULTS, FOOT_SHAPE_SPECS, PART_IDS, PART_PRESETS,
  type BodyPoseId, type BodyShapeId, type FootShape, type PartId,
} from '../../../game/figure/shapes';
import type { HedAnimation } from '../../../game/figure/hed';

const TUNE = PAINT_EDITOR_TUNING;
const FACE_ANIMS = ['off', 'talk', 'chew', 'cry', 'yell'];

export const CHARACTER_LENSES: LensSpec[] = [
  { id: 'figure', label: 'FIGURE' },
  { id: 'part', label: 'PART' },
  { id: 'sculpt', label: 'SCULPT' },
  { id: 'paint', label: 'PAINT' },
];

/** The MESH context's panel SPEC — regenerated per render, every getter live
 *  (parity rows B1, B4-B6, C1, D8-D9, E2-E3, F1, F6, H1-H2). CLOTHSPLIT-0606:
 *  wardrobe and animation fields live in clothingPanel/animationPanel now;
 *  body SHAPE stays here (it reshapes the skeleton — mesh truth, row W1). */
export function characterPanel(s: CharacterStore): PanelSpec {
  const d = s.draft;
  const v = s.view;
  const isHead = v.selPart === 'head';

  const groups: PanelSpec['groups'] = [];

  groups.push({
    title: 'IDENTITY',
    fields: [
      { k: 'name', t: 'text', width: 150, get: () => s.draftName, set: (x) => s.setDraftName(x) },
      {
        k: 'skin', t: 'color', opts: DRAFT_DEFAULTS.skins.slice(),
        // SKINRANGE-0606 ("end the race war"): the full melanin continuum —
        // presets above for fast picks, every tone reachable in the grid
        range: { stops: ['#f9ece1', '#e8c5a8', '#c89066', '#8d5a3c', '#5d3a26', '#2b1a10'], cols: 14, rows: 5, warmth: 16 },
        get: () => s.draft.skin, set: (c) => s.setSkin(c),
      },
    ],
  });

  groups.push({
    title: 'PART',
    fields: [
      { k: 'part', t: 'enum', opts: PART_IDS.slice(), get: () => s.view.selPart, set: (p) => s.setSelPart(p as PartId) },
      { k: 'reset part', t: 'act', tone: 'error', run: () => s.resetPart() },
    ],
  });

  groups.push({
    title: 'BODY',
    fields: [
      { k: 'shape', t: 'enum', opts: Object.keys(BODY_SHAPES), get: () => s.draft.bodyShape, set: (x) => s.setBodyShape(x as BodyShapeId) },
    ],
  });

  if (isHead) {
    const fields: FieldSpec[] = [
      { k: 'generate face', t: 'act', tone: 'success', run: () => s.generateFaceOnly() },
      { k: 'export .hed', t: 'act', run: () => s.exportHead() },
    ];
    if (d.face) fields.push({ k: 'remove face', t: 'act', run: () => s.removeFace() });
    fields.push(
      { k: 'skull stretch', t: 'num', ...TUNE.knobs.skull, get: () => s.draft.headScaleY, set: (x) => s.setHeadScaleY(x) },
      { k: 'photo size', t: 'slider', min: TUNE.knobs.photoScale.min, max: TUNE.knobs.photoScale.max, show: (x) => x.toFixed(2), get: () => s.view.photoScale, set: (x) => s.setPhotoScale(x) },
      { k: 'photo up/down', t: 'slider', min: TUNE.knobs.photoY.min, max: TUNE.knobs.photoY.max, show: (x) => x.toFixed(0), get: () => s.view.photoY, set: (x) => s.setPhotoY(x) },
    );
    groups.push({ title: 'FACE', fields });
  }

  groups.push({
    title: 'SCULPT',
    fields: [{ k: 'depth amount', t: 'num', ...TUNE.knobs.amount, get: () => s.draft.amount, set: (x) => s.setAmount(x) }],
  });

  groups.push({
    title: `REGION · ${PART_PRESETS[v.selPart].label.toUpperCase()}`,
    fields: [
      ...SHAPE_REGIONS[v.selPart].map((region): FieldSpec => ({
        k: region.label, t: 'slider', min: -1, max: 1,
        show: (x) => x.toFixed(2),
        get: () => s.draft.regions[s.view.selPart]?.[region.id] ?? 0,
        set: (x) => s.setRegion(s.view.selPart, region.id, x),
      })),
      { k: 'reset regions', t: 'act', run: () => s.resetRegions() },
    ],
  });

  // FOOTMESH-0606: the foot's anatomy dials — generated straight from the
  // spec table (one truth: shapes.ts FOOT_SHAPE_SPECS); conditional-render
  // law, the group earns its space only on the foot part.
  if (v.selPart === 'foot') {
    groups.push({
      title: 'FOOT',
      fields: (Object.keys(FOOT_SHAPE_SPECS) as Array<keyof FootShape>).map((dial): FieldSpec => ({
        k: FOOT_SHAPE_SPECS[dial].label, t: 'num',
        min: FOOT_SHAPE_SPECS[dial].min, max: FOOT_SHAPE_SPECS[dial].max,
        step: FOOT_SHAPE_SPECS[dial].step, precision: FOOT_SHAPE_SPECS[dial].precision,
        get: () => (s.draft.footShape ?? FOOT_SHAPE_DEFAULTS)[dial],
        set: (x) => s.setFootShape({ [dial]: x }),
      })),
    });
  }

  return { groups };
}

// (clothingPanel — the wardrobe cosplay context (OUTFIT/EXTRAS/PROP) — is
// DELETED by CLOTHFLIP-0607 (req_0234), USER verbatim: "The clothing route
// is still doing a character cosplay … not this shit where its asking me
// about a prop". The garment source (editors/workbench/clothing/) IS the
// clothing authority; outfit-assembly/props are character/play domain and
// their draft DOORS (setClothing/toggleAccessory/setHeldItem + the
// BodyDocument.outfit channel) live on in store.ts for that future home.)

/** The ANIMATION context's panel — pose + face anim + script (parity A1-A7).
 *  The pre-split setLens('figure') flips are gone: this context's stage IS
 *  the animating figure (WBCLOTH row F1). Clock exclusivity stays. */
export function animationPanel(s: CharacterStore): PanelSpec {
  const d = s.draft;
  const groups: PanelSpec['groups'] = [];

  const poseFields: FieldSpec[] = [
    { k: 'rig', t: 'enum', opts: Object.keys(BODY_POSES), get: () => s.draft.bodyPose, set: (x) => s.setBodyPose(x as BodyPoseId) },
    { k: 'anim', t: 'bool', get: () => s.view.bodyRigAnim, set: (x) => s.setBodyRigAnim(x) },
  ];
  groups.push({ title: 'POSE', fields: poseFields });

  // gated on the FACE, not the selected part — part selection is a mesh
  // concern the animation context doesn't have (parity A3)
  if (d.face) {
    groups.push({
      title: 'FACE',
      fields: [{
        k: 'face anim', t: 'enum', opts: FACE_ANIMS,
        get: () => s.view.faceAnim ?? 'off',
        set: (x) => s.setFaceAnim(x === 'off' ? null : (x as HedAnimation)),
      }],
    });
  }

  groups.push({
    title: 'SCRIPT',
    fields: [
      { k: 'script', t: 'text', width: 200, get: () => s.view.animScript, set: (t) => s.setAnimScript(t) },
      { k: 'play', t: 'bool', get: () => s.view.scriptPlaying, set: (x) => { s.setScriptPlaying(x); s.setBodyRigAnim(false); } },
      { k: 'reset script', t: 'act', run: () => s.setAnimScript(DEFAULT_ANIM_SCRIPT) },
      ...Object.entries(ANIM_PRESETS).map(([label, script]): FieldSpec => ({
        k: label, t: 'act', tone: 'warning',
        run: () => { s.setAnimScript(script); s.setScriptPlaying(true); s.setBodyRigAnim(false); },
      })),
    ],
  });

  return { groups };
}

// ── the source cores ──────────────────────────────────────────────────────────

/** The roster doors all three contexts share: the outfit/animation are
 *  per-character (the clothing roster IS the character roster — one store,
 *  one working draft, one autosave chain). */
function rosterDoors(s: CharacterStore) {
  return {
    list(): RosterRow[] {
      const st = s.rosterState();
      return st.order.map((id) => ({ id, label: st.characters[id]?.metadata?.title ?? id }));
    },
    // AUTOSAVE-0605 mount restore (A3): the working draft, else the LAST entry
    defaultRow: (rows: RosterRow[]) => (s.draftId && rows.some((r) => r.id === s.draftId) ? s.draftId : rows[rows.length - 1]?.id),
    onPick: (id: string) => s.loadFromRoster(id),
    select: () => s,
    subscribe: (fn: () => void) => s.subscribe(fn),
  };
}

const newCharacterAction = (s: CharacterStore): ActionSpec =>
  ({ id: 'new', label: 'New', icon: 'Plus', run: () => s.newCharacter() });

export type CharacterPaintActions = { saveCurrent(): void; undo(): void; redo(): void };

function saveCharacterContext(s: CharacterStore, paint?: CharacterPaintActions): void {
  if (s.view.lens === 'paint' && paint) { paint.saveCurrent(); return; }
  s.saveToRoster();
}

function undoCharacterContext(s: CharacterStore, paint?: CharacterPaintActions): void {
  if (s.view.lens === 'paint' && paint) { paint.undo(); return; }
  s.undo();
}

function redoCharacterContext(s: CharacterStore, paint?: CharacterPaintActions): void {
  if (s.view.lens === 'paint' && paint) { paint.redo(); return; }
  s.redo();
}

export function characterSourceCore(store?: CharacterStore, paintActions?: CharacterPaintActions): Omit<WorkbenchSource<CharacterStore>, 'stage'> & { store: CharacterStore } {
  const s = store ?? characterWorkbenchStore();
  return {
    store: s,
    id: 'character',
    icon: 'User',
    kicker: 'CHARACTERS',
    ...rosterDoors(s),

    panel: () => characterPanel(s),

    lenses: () => CHARACTER_LENSES,
    activeLens: () => s.view.lens,
    onLens: (_subject, id) => s.setLens(id as CharacterLens),

    actions(): ActionSpec[] {
      return [
        newCharacterAction(s),
        { id: 'save', label: 'Save', icon: 'Check', run: () => saveCharacterContext(s, paintActions) },
        { id: 'undo', label: 'Undo', icon: 'Undo2', run: () => undoCharacterContext(s, paintActions) },
        { id: 'redo', label: 'Redo', icon: 'Redo2', run: () => redoCharacterContext(s, paintActions) },
        { id: 'generate', label: 'Generate', icon: 'Sparkles', run: () => s.generateWholeCharacter() },
        { id: 'export', label: '.body', icon: 'Package', run: () => s.exportBody() },
        ...(s.draftId ? [{ id: 'remove', label: 'Remove', icon: 'Trash2', run: () => s.removeFromRoster(s.draftId!) }] : []),
      ];
    },
    emptyActions(): ActionSpec[] {
      return [newCharacterAction(s)];
    },

  };
}

// (clothingSourceCore is DELETED by CLOTHFLIP-0607 — the cosplay clothing
// context died with its panel; see the note above clothingPanel's grave.)

/** ANIMATION — the rig/posing context (where animation commands live). */
export function animationSourceCore(store?: CharacterStore): Omit<WorkbenchSource<CharacterStore>, 'stage'> & { store: CharacterStore } {
  const s = store ?? characterWorkbenchStore();
  return {
    store: s,
    id: 'animation',
    icon: 'Clapperboard',
    kicker: 'ANIMATION',
    ...rosterDoors(s),
    panel: () => animationPanel(s),
    actions(): ActionSpec[] {
      return [
        { id: 'save', label: 'Save', icon: 'Check', run: () => s.saveToRoster() },
        { id: 'undo', label: 'Undo', icon: 'Undo2', run: () => s.undo() },
        { id: 'redo', label: 'Redo', icon: 'Redo2', run: () => s.redo() },
      ];
    },
  };
}
