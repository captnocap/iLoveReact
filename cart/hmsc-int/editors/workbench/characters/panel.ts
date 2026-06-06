// editors/workbench/characters/panel.ts — the CHARACTER source's HEADLESS
// half (WBCHAR-0606): the generated PanelSpec + the source core (roster,
// actions, lenses) — everything except the stage's JSX, so the P4 suite
// bundles without the React half (the characters.test.ts law). source.tsx
// wraps this core and adds the stage.

import type { WorkbenchSource, RosterRow, ActionSpec } from '../../../shell/Workbench';
import type { PanelSpec, FieldSpec } from '../../../shell/fields';
import type { LensSpec } from '../../../shell/stage';
import { characterWorkbenchStore, type CharacterStore, type CharacterLens } from './store';
import { DRAFT_DEFAULTS } from '../../characters/draft';
import { SHAPE_REGIONS } from '../../characters/regions';
import { PAINT_EDITOR_TUNING } from '../../characters/paintKit';
import { ANIM_PRESETS, DEFAULT_ANIM_SCRIPT } from '../../characters/animPresets';
import {
  BODY_POSES, BODY_SHAPES, BOTTOMS, CLOTHING, CLOTHING_ACCESSORIES, CLOTHING_SKINS, PART_IDS, PART_PRESETS,
  type BodyPoseId, type BodyShapeId, type BottomsId, type ClothingAccessoryId, type ClothingId, type ClothingSkinId, type PartId,
} from '../../../game/figure/shapes';
import { GAME_ITEMS } from '../../../game/items';
import type { HedAnimation } from '../../../game/figure/hed';

const TUNE = PAINT_EDITOR_TUNING;
const FACE_ANIMS = ['off', 'talk', 'chew', 'cry', 'yell'];

export const CHARACTER_LENSES: LensSpec[] = [
  { id: 'figure', label: 'FIGURE' },
  { id: 'part', label: 'PART' },
  { id: 'sculpt', label: 'SCULPT' },
  { id: 'paint', label: 'PAINT' },
];

/** The panel SPEC — regenerated per render, every getter live (parity rows
 *  B1, B4-B6, C1, D8-D9, E2-E4, F1-F7, G1-G5, H1-H2). */
export function characterPanel(s: CharacterStore): PanelSpec {
  const d = s.draft;
  const v = s.view;
  const isHead = v.selPart === 'head';

  // held-prop options: none + the item registry + ◆ sculpted /items (F7/J4)
  const props: Array<{ id: string; label: string }> = [
    { id: 'none', label: 'none' },
    ...GAME_ITEMS.definitions.map((it: { id: string; label: string }) => ({ id: it.id, label: it.label })),
    ...s.sculptedItems().map((it) => ({ id: it.id, label: `◆ ${it.label}` })),
  ];

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
      { k: 'clothes', t: 'enum', opts: Object.keys(CLOTHING), get: () => s.draft.clothing, set: (x) => s.setClothing(x as ClothingId) },
      { k: 'bottoms', t: 'enum', opts: Object.keys(BOTTOMS), get: () => s.draft.bottoms, set: (x) => s.setBottoms(x as BottomsId) },
      { k: 'print', t: 'enum', opts: Object.keys(CLOTHING_SKINS), get: () => s.draft.clothingSkin, set: (x) => s.setClothingSkin(x as ClothingSkinId) },
    ],
  });

  groups.push({
    title: 'EXTRAS',
    fields: (Object.keys(CLOTHING_ACCESSORIES) as ClothingAccessoryId[]).map((id): FieldSpec => ({
      k: CLOTHING_ACCESSORIES[id].label,
      t: 'bool',
      get: () => s.draft.accessories.includes(id),
      set: () => s.toggleAccessory(id), // route semantics: a press toggles (cap⇄beanie exclusivity inside)
    })),
  });

  groups.push({
    title: 'PROP',
    fields: [{
      k: 'held', t: 'enum',
      opts: props.map((p) => p.label),
      get: () => props.find((p) => p.id === s.draft.heldItem)?.label ?? s.draft.heldItem,
      set: (label) => s.setHeldItem(props.find((p) => p.label === label)?.id ?? 'none'),
    }],
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

  const animFields: FieldSpec[] = [
    { k: 'rig', t: 'enum', opts: Object.keys(BODY_POSES), get: () => s.draft.bodyPose, set: (x) => s.setBodyPose(x as BodyPoseId) },
    { k: 'anim', t: 'bool', get: () => s.view.bodyRigAnim, set: (x) => { s.setBodyRigAnim(x); s.setLens('figure'); } },
  ];
  if (isHead && d.face) {
    animFields.push({
      k: 'face anim', t: 'enum', opts: FACE_ANIMS,
      get: () => s.view.faceAnim ?? 'off',
      set: (x) => s.setFaceAnim(x === 'off' ? null : (x as HedAnimation)),
    });
  }
  animFields.push(
    { k: 'script', t: 'text', width: 200, get: () => s.view.animScript, set: (t) => s.setAnimScript(t) },
    { k: 'play', t: 'bool', get: () => s.view.scriptPlaying, set: (x) => { s.setScriptPlaying(x); s.setBodyRigAnim(false); s.setLens('figure'); } },
    { k: 'reset script', t: 'act', run: () => s.setAnimScript(DEFAULT_ANIM_SCRIPT) },
    ...Object.entries(ANIM_PRESETS).map(([label, script]): FieldSpec => ({
      k: label, t: 'act', tone: 'warning',
      run: () => { s.setAnimScript(script); s.setScriptPlaying(true); s.setBodyRigAnim(false); s.setLens('figure'); },
    })),
  );
  groups.push({ title: 'ANIMATION', fields: animFields });

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

  return { groups };
}

export function characterSourceCore(store?: CharacterStore): Omit<WorkbenchSource<CharacterStore>, 'stage'> & { store: CharacterStore } {
  const s = store ?? characterWorkbenchStore();
  return {
    store: s,
    id: 'character',
    icon: 'User',
    kicker: 'CHARACTERS',

    list(): RosterRow[] {
      const st = s.rosterState();
      return st.order.map((id) => ({ id, label: st.characters[id]?.metadata?.title ?? id }));
    },
    // AUTOSAVE-0605 mount restore (A3): the working draft, else the LAST entry
    defaultRow: (rows) => (s.draftId && rows.some((r) => r.id === s.draftId) ? s.draftId : rows[rows.length - 1]?.id),
    onPick: (id) => s.loadFromRoster(id),
    select: () => s,
    subscribe: (fn) => s.subscribe(fn),

    panel: () => characterPanel(s),

    lenses: () => CHARACTER_LENSES,
    activeLens: () => s.view.lens,
    onLens: (_subject, id) => s.setLens(id as CharacterLens),

    actions(): ActionSpec[] {
      return [
        { id: 'save', label: 'Save', icon: 'Check', run: () => s.saveToRoster() },
        { id: 'generate', label: 'Generate', icon: 'Sparkles', run: () => s.generateWholeCharacter() },
        { id: 'export', label: '.body', icon: 'Package', run: () => s.exportBody() },
        ...(s.draftId ? [{ id: 'remove', label: 'Remove', icon: 'Trash2', run: () => s.removeFromRoster(s.draftId!) }] : []),
      ];
    },

  };
}
