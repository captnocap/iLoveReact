// editors/workbench/characters/store.ts — the character source's state truth
// (WBCHAR-0606; parity rows A1-A9, C4, E5-E6, I10 in ../WBCHAR.CAPTURE.md).
//
// CharactersRoute.tsx's state machinery extracted into a headless store so
// gutter 3 (PanelSpec getters/setters) and column 4 (the stage) read/write
// ONE truth. Pure logic — no React, no GPU; the stage owns paintables and
// syncs them off `seqs`/`installRev`. Every door is the route's, line-true:
//
//   editDraft / editDraftCoalesced  — Route.tsx:251-259 (history + autosave)
//   installDraft / restoreDraft     — Route.tsx:234-239, 260-268
//   autosave (debounced commits)    — Route.tsx:185-211 (AUTOSAVE-0605)
//   mount restore (last = working)  — Route.tsx:273-286
//   save/load/remove roster         — Route.tsx:567-596
//   generate face / whole character — Route.tsx:548-565
//   export .hed / .body, file drops — Route.tsx:598-635
//   region set / resets             — Route.tsx:477-488, 533-536, 793-799
//
// View state rides the SAME '/characters' twig keys the route persisted
// (parity C4) — saved camera poses, brush, part selection all carry across.
//
// Persistence: the V20 'characters' channel via a RouteSession opened on
// '/workbench' — same stream, same labeled commits, its own session row on
// the bus. The store persists NOTHING itself (the Workbench law).

import {
  draftFromDocument, draftToDocument, draftToHed, draftWithFace, emptyDraft, emptyGrid,
  type CharacterDraft,
} from '../../characters/draft';
import { generateCharacterDraft } from '../../characters/generate';
import { mintCharacterId } from '../../characters/roster';
import { PAINT_EDITOR_TUNING, type SculptMode } from '../../characters/paintKit';
import { DEFAULT_ANIM_SCRIPT } from '../../characters/animPresets';
import { defaultProfile, DEFAULT_BOTTOMS, PART_IDS, type ClothingAccessoryId, type ClothingId, type PartId } from '../../../game/figure/shapes';
import { generateFace, parseHed, serializeHed, type HedAnimation, type HedDocument } from '../../../game/figure/hed';
import { parseBody, serializeBody, type BodyDocument } from '../../../game/figure/body';
import { charactersStream, type CharactersEvent, type CharactersStreamState } from '../../../game/figure/stream';
import { applyBodyPaint } from '../../../game/figure/body';
import type { PaintTargetId } from '../../../game/figure/shapes';
import type { PaintedOverlay } from '../../../game/painted';
import { createPaintHistory } from '../../paint/history';
import { readRouteTwigState, writeRouteTwigState } from '../../twigs';
import { editorChannel } from '../../store';
import { editorSessions, type RouteSession } from '../../sessions';
import { itemsStream } from '../../items/stream';
import { sculptedItemDefinition } from '../../items/bake';
import { readFile, writeFile, mkdir } from '@reactjit/hooks/fs';

const TUNE = PAINT_EDITOR_TUNING;
const TWIG_ROUTE = '/characters'; // parity C4 — the route's keys, carried

export type CharacterLens = 'figure' | 'part' | 'sculpt' | 'paint';
export type SculptTab = 'outline' | 'detail';
export type Photo = { path: string; stamp: number }; // preview.tsx's shape (headless copy)

export type SculptedItemRef = { id: string; label: string; tone: string };

/** TWIGSTATE-0606: tests inject a bag-backed adapter to prove the round-trip
 *  (set state → fresh store over the same bag → identical view fields). */
export type TwigAdapter = {
  read<T>(key: string, initial: T): T;
  write<T>(key: string, value: T): void;
};

export type CharacterStoreDeps = {
  channel: { state(): CharactersStreamState } | null;
  session: Pick<RouteSession<CharactersEvent>, 'commit' | 'note'> | null;
  error: string | null;
  /** sculpted /items registry read (J4); null → none (tests, no fs host) */
  items?: (() => SculptedItemRef[]) | null;
  /** autosave debounce; <= 0 commits synchronously (tests) */
  autosaveMs?: number;
  /** false → no view persistence · adapter → tests' twig bag · default → the
   *  route twig file ('/characters' keys, C4 parity) */
  twig?: boolean | TwigAdapter;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const perPartSeqs = (): Record<PartId, number> =>
  Object.fromEntries(PART_IDS.map((id) => [id, 0])) as Record<PartId, number>;

export function createCharacterStore(deps: CharacterStoreDeps) {
  const tw = deps.twig !== false;
  const autosaveMs = deps.autosaveMs ?? TUNE.autosaveDebounceMs;

  // ── state ──────────────────────────────────────────────────────────────────
  let draft: CharacterDraft = emptyDraft();
  let draftId: string | null = null;
  let draftName = 'new character';
  let status: string | null = null;
  let rosterRev = 0;
  /** per-part sculpt versions — the stage regenerates that part's dyn mesh */
  let seqs = perPartSeqs();
  /** bumps when the WHOLE draft re-installs — the stage re-uploads every grid */
  let installRev = 0;

  const listeners = new Set<() => void>();
  const emit = () => { for (const fn of [...listeners]) fn(); };

  // ── view state on the route's own twig keys (C4 + TWIGSTATE-0606) ─────────
  const adapter: TwigAdapter | null = typeof deps.twig === 'object' ? deps.twig : null;
  const twigRead = <T>(key: string, initial: T): T => {
    if (!tw) return initial;
    if (adapter) return adapter.read(key, initial);
    try { return readRouteTwigState(TWIG_ROUTE, key, initial); } catch { return initial; }
  };
  const twigWrite = <T>(key: string, value: T): void => {
    if (!tw) return;
    if (adapter) { adapter.write(key, value); return; }
    try { writeRouteTwigState(TWIG_ROUTE, key, value); } catch { /* twigless host */ }
  };
  const view = {
    lens: twigRead<CharacterLens>('wbLens', 'part'),
    selPart: twigRead<PartId>('selPart', 'head'),
    sculptTab: twigRead<SculptTab>('editTab', 'outline'),
    sculptMode: twigRead<SculptMode>('sculptMode', 'raise'),
    mirror: twigRead('mirror', true),
    brush: twigRead('brush', 14),
    strength: twigRead('strength', 0.5),
    photo: twigRead<Photo | null>('photo', null),
    photoScale: twigRead('photoScale', 0.4),
    photoY: twigRead('photoY', 0),
    showHitboxes: twigRead('showHitboxes', false),
    faceAnim: twigRead<HedAnimation | null>('faceAnim', null),
    bodyRigAnim: twigRead('bodyRigAnim', false),
    animScript: twigRead('animScript', DEFAULT_ANIM_SCRIPT),
    scriptPlaying: twigRead('scriptPlaying', false),
    showGrabGrid: twigRead('showGrabGrid', true),
  };
  const setViewKey = <K extends keyof typeof view>(key: K, twigKey: string) => (value: (typeof view)[K]) => {
    view[key] = value;
    twigWrite(twigKey, value);
    emit();
  };

  // TWIGSTATE-0606: the WORKING ROW survives hot reloads too — without this,
  // a reload re-created the store and mount-restored the LAST roster entry,
  // yanking the user off the character they were on. Every draftId change
  // writes through; the factory restore below prefers it.
  const assignDraftId = (id: string | null) => {
    draftId = id;
    twigWrite('wbDraftId', id);
  };

  // ── autosave (Route.tsx:185-211 — AUTOSAVE-0605, V20 micro-saves) ─────────
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  const commitAutosave = () => {
    if (!deps.session) return;
    const id = draftId ?? mintCharacterId();
    assignDraftId(id);
    deps.session.commit({ kind: 'authored', id, doc: draftToDocument(draft, draftName) }, `autosave · ${draftName}`);
    rosterRev += 1;
  };
  const scheduleAutosave = () => {
    if (!deps.session) return;
    if (autosaveMs <= 0) { commitAutosave(); return; }
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { autosaveTimer = null; commitAutosave(); emit(); }, autosaveMs);
  };

  // ── the draft doors (Route.tsx:226-268) ───────────────────────────────────
  const setDraft = (next: CharacterDraft, opts?: { autosave?: boolean }) => {
    draft = next;
    if (opts?.autosave !== false) scheduleAutosave();
    emit();
  };
  const snapDraft = (): CharacterDraft => JSON.parse(JSON.stringify(draft)) as CharacterDraft;
  const history = createPaintHistory<CharacterDraft>();
  /** a discrete undoable edit (chip picks, resets, stroke/drag releases) */
  const editDraft = (updater: (d: CharacterDraft) => CharacterDraft) => {
    history.commit(snapDraft);
    setDraft(updater(draft));
  };
  /** knob-style bursts coalesce — undo returns to the value before the drag */
  const editDraftCoalesced = (updater: (d: CharacterDraft) => CharacterDraft) => {
    history.commitCoalesced(snapDraft);
    setDraft(updater(draft));
  };
  const bumpSeq = (id: PartId) => { seqs = { ...seqs, [id]: seqs[id] + 1 }; };
  /** a sculpt-grid write (stroke release readback, grab drag, fill/soften) */
  const setPartGrid = (id: PartId, g: number[]) => {
    bumpSeq(id);
    setDraft({ ...draft, grids: { ...draft.grids, [id]: g } });
  };
  /** whole-draft replace; the stage re-uploads every paint texture + mesh.
   *  autosave defaults OFF (restoring is not an edit) — generated/imported
   *  content passes {autosave: true} (Route.tsx:543,558,620 skip-flag law). */
  const installDraft = (next: CharacterDraft, opts?: { autosave?: boolean }) => {
    seqs = Object.fromEntries(PART_IDS.map((id) => [id, seqs[id] + 1])) as Record<PartId, number>;
    installRev += 1;
    setDraft(next, { autosave: opts?.autosave ?? false });
  };

  const setStatus = (s: string | null) => { status = s; emit(); };
  const note = (label: string) => deps.session?.note(label);

  // ── undo/redo (Route.tsx:241-271 — GRABQOL-0605) ──────────────────────────
  const restoreDraft = (state: CharacterDraft | null, label: string) => {
    if (!state) { setStatus(`nothing to ${label}`); return; }
    installDraft(state, { autosave: true }); // the restored state IS the working draft
    setStatus(label);
    note(label);
  };
  const undo = () => restoreDraft(history.undo(snapDraft), 'undo');
  const redo = () => restoreDraft(history.redo(snapDraft), 'redo');

  // ── roster (Route.tsx:567-596) ────────────────────────────────────────────
  const rosterState = (): CharactersStreamState =>
    deps.channel?.state() ?? { characters: {}, order: [] };

  const saveToRoster = () => {
    if (!deps.session) { setStatus(`save unavailable — ${deps.error ?? 'no session'}`); return; }
    const id = draftId ?? mintCharacterId();
    deps.session.commit({ kind: 'authored', id, doc: draftToDocument(draft, draftName) }, `${draftName}: saved`);
    assignDraftId(id);
    rosterRev += 1;
    setStatus(`saved "${draftName}" to the roster + snapshot (the game's view is fresh)`);
  };

  const loadFromRoster = (id: string, opts?: { history?: boolean; keepView?: boolean }) => {
    const doc = rosterState().characters[id];
    if (!doc) return;
    // the mount restore is NOT an edit — no undo step back to the blank draft
    if (opts?.history !== false) history.commit(snapDraft);
    installDraft(draftFromDocument(doc));
    assignDraftId(id);
    draftName = doc.metadata?.title ?? id;
    // keepView (TWIGSTATE-0606): the RESTORE path must not flip the lens —
    // a reload mid-painting returns to PAINT, never to the figure view.
    if (!opts?.keepView) {
      view.lens = 'figure';
      twigWrite('wbLens', 'figure');
    }
    setStatus(`loaded "${draftName}" from the roster`);
  };

  const removeFromRoster = (id: string) => {
    if (!deps.session) return;
    deps.session.commit({ kind: 'removed', id }, `${id}: removed`);
    rosterRev += 1;
    if (draftId === id) assignDraftId(null);
    setStatus('removed from the roster (its history stays in the log)');
  };

  // ── generation / face (Route.tsx:539-565) ─────────────────────────────────
  const applyFaceDoc = (doc: HedDocument, label: string) => {
    history.commit(snapDraft);
    installDraft(draftWithFace(draft, doc), { autosave: true });
    view.selPart = 'head';
    twigWrite('selPart', 'head');
    setStatus(label);
  };

  const generateFaceOnly = () => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0;
    applyFaceDoc(generateFace(seed), `generated face ${seed} — sculpt over it, or generate again`);
  };

  const generateWholeCharacter = () => {
    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffff)) >>> 0;
    const next = generateCharacterDraft(seed);
    history.commit(snapDraft);
    installDraft(next, { autosave: true });
    assignDraftId(null); // a NEW character, not an overwrite of the loaded one
    draftName = `character ${seed.toString(36)}`;
    view.selPart = 'head';
    view.lens = 'figure';
    view.bodyRigAnim = false;
    twigWrite('selPart', 'head');
    twigWrite('wbLens', 'figure');
    twigWrite('bodyRigAnim', false);
    setStatus(`generated character ${seed}`);
  };

  // ── exports + file drops (Route.tsx:598-635) ──────────────────────────────
  const exportHead = () => {
    try {
      mkdir('cart/heads');
      const stamp = Date.now();
      writeFile(`cart/heads/head_${stamp}.hed.json`, serializeHed(draftToHed(draft, `head ${stamp}`)));
      setStatus(`exported cart/heads/head_${stamp}.hed.json — drop it back in to reload`);
    } catch (e) { setStatus(`export failed — ${String(e)}`); }
  };

  const exportBody = () => {
    try {
      mkdir('cart/heads');
      const stamp = Date.now();
      writeFile(`cart/heads/body_${stamp}.body.json`, serializeBody(draftToDocument(draft, `body ${stamp}`)));
      setStatus(`exported cart/heads/body_${stamp}.body.json — the whole character`);
    } catch (e) { setStatus(`export failed — ${String(e)}`); }
  };

  /** drop: .body.json = whole character, .hed.json = a head, else face photo */
  const dropFile = (path: string) => {
    if (path.endsWith('.body.json')) {
      const text = readFile(path);
      const doc = text ? parseBody(text) : null;
      if (!doc) { setStatus(`${path.split('/').pop()} is not a .body document`); return; }
      history.commit(snapDraft);
      installDraft(draftFromDocument(doc), { autosave: true });
      assignDraftId(null);
      draftName = doc.metadata?.title ?? 'imported character';
      setStatus(`loaded ${path.split('/').pop()}`);
      return;
    }
    if (path.endsWith('.json')) {
      const text = readFile(path);
      const doc = text ? parseHed(text) : null;
      if (!doc) { setStatus(`${path.split('/').pop()} is not a .hed head document`); return; }
      applyFaceDoc(doc, `loaded ${path.split('/').pop()}`);
      return;
    }
    view.selPart = 'head';
    twigWrite('selPart', 'head');
    setViewKey('photo', 'photo')({ path, stamp: Date.now() });
  };

  // ── part resets + regions (Route.tsx:477-488, 533-536, 793-799, 1055) ─────
  const resetPart = () => {
    const part = view.selPart;
    editDraft((d) => ({
      ...d,
      grids: { ...d.grids, [part]: emptyGrid() },
      profiles: { ...d.profiles, [part]: defaultProfile(part) },
      regions: { ...d.regions, [part]: {} },
    }));
    installRev += 1; // the stage re-uploads (an empty grid IS the neutral clear)
    note(`reset part · ${part}`);
    setStatus(`${part} reset — sculpt, outline, and region sliders back to default (ctrl+z undoes)`);
  };

  const resetOutline = () => {
    const part = view.selPart;
    editDraft((d) => ({ ...d, profiles: { ...d.profiles, [part]: defaultProfile(part) } }));
    bumpSeq(part);
  };

  const resetRegions = () => {
    const part = view.selPart;
    editDraft((d) => ({ ...d, regions: { ...d.regions, [part]: {} } }));
  };

  const setRegion = (part: PartId, regionId: string, value: number) => {
    editDraftCoalesced((d) => ({
      ...d,
      regions: { ...d.regions, [part]: { ...(d.regions[part] ?? {}), [regionId]: Math.abs(value) < 0.01 ? 0 : clamp(value, -1, 1) } },
    }));
    note(`region · ${regionId} ${value.toFixed(2)} · ${part}`);
  };

  // ── wardrobe setters (Route.tsx:853-907 — picks flip to the figure) ───────
  const wearLens = () => { view.lens = 'figure'; twigWrite('wbLens', 'figure'); };
  const setBodyShape = (id: CharacterDraft['bodyShape']) => { editDraft((d) => ({ ...d, bodyShape: id })); wearLens(); };
  const setClothing = (id: ClothingId) => { editDraft((d) => ({ ...d, clothing: id, bottoms: DEFAULT_BOTTOMS[id] })); wearLens(); };
  const setBottoms = (id: CharacterDraft['bottoms']) => { editDraft((d) => ({ ...d, bottoms: id })); wearLens(); };
  const setClothingSkin = (id: CharacterDraft['clothingSkin']) => { editDraft((d) => ({ ...d, clothingSkin: id })); wearLens(); };
  const setBodyPose = (id: CharacterDraft['bodyPose']) => { editDraft((d) => ({ ...d, bodyPose: id })); wearLens(); };
  const setHeldItem = (id: string) => { editDraft((d) => ({ ...d, heldItem: id })); wearLens(); };
  /** accessory toggle with the cap⇄beanie exclusivity (Route.tsx:880-888) */
  const toggleAccessory = (id: ClothingAccessoryId) => {
    editDraft((d) => {
      const cur = d.accessories;
      if (cur.includes(id)) return { ...d, accessories: cur.filter((x) => x !== id) };
      const cleaned = id === 'cap' ? cur.filter((x) => x !== 'beanie') : id === 'beanie' ? cur.filter((x) => x !== 'cap') : cur;
      return { ...d, accessories: cleaned.concat(id) };
    });
    wearLens();
  };

  // ── the PAINT lens save (K3 — cutout's saveModelPaint figure branch):
  // bake happened lens-side; here the overlay applies through the door,
  // commits ONE labeled authored event, and the working draft adopts the
  // committed paint (no re-autosave — the commit already landed). ──────────
  const savePaintedModel = (part: PaintTargetId, overlay: PaintedOverlay | null) => {
    if (!deps.session) { setStatus(`save unavailable — ${deps.error ?? 'no session'}`); return; }
    const id = draftId;
    if (!id) { setStatus('save to the roster first — PAINT works on the SAVED character'); return; }
    const model = rosterState().characters[id];
    if (!model) { setStatus(`figure ${id} unavailable`); return; }
    const next = applyBodyPaint(model, part, overlay);
    deps.session.commit({ kind: 'authored', id, doc: next }, `${id}: ${part} ${overlay ? 'painted' : 'paint cleared'}`);
    setDraft({ ...draft, paint: next.paint }, { autosave: false });
    rosterRev += 1;
    setStatus(overlay ? `painted ${part} saved to ${id}` : `cleared ${part} paint on ${id}`);
  };

  /** ADOPT-ONLY (AGNOSTICPAINT-0606): the agnostic bench committed a figure
   *  save on its own session — the open draft just follows the committed
   *  paint (no re-commit, no autosave echo). */
  const adoptPaintedDocument = (next: BodyDocument) => {
    setDraft({ ...draft, paint: next.paint }, { autosave: false });
    rosterRev += 1;
  };

  // ── mount restore (A3 + TWIGSTATE-0606): reopen EXACTLY where the user
  // was — the twig'd working row when it still exists, else the newest entry.
  // keepView: every twig'd view field (lens/part/brush/...) stays authoritative.
  {
    const st = rosterState();
    if (st.order.length > 0) {
      const remembered = twigRead<string | null>('wbDraftId', null);
      const id = remembered && st.characters[remembered] ? remembered : st.order[st.order.length - 1];
      loadFromRoster(id, { history: false, keepView: true });
      status = `restored "${draftName}" — the draft autosaves as you work`;
    }
  }

  return {
    // subscription
    subscribe(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); },
    // state reads
    get draft() { return draft; },
    get draftId() { return draftId; },
    get draftName() { return draftName; },
    get status() { return status; },
    get rosterRev() { return rosterRev; },
    get seqs() { return seqs; },
    get installRev() { return installRev; },
    get view() { return view; },
    get sessionError() { return deps.error; },
    rosterState,
    sculptedItems: (): SculptedItemRef[] => { try { return deps.items?.() ?? []; } catch { return []; } },
    // draft doors (the stage + panel write through these — ONE truth)
    snapDraft, editDraft, editDraftCoalesced, setPartGrid, installDraft,
    history, undo, redo,
    setStatus, note,
    setDraftName: (v: string) => { draftName = v; emit(); },
    // roster / generation / io
    saveToRoster, loadFromRoster, removeFromRoster,
    generateFaceOnly, generateWholeCharacter, applyFaceDoc,
    exportHead, exportBody, dropFile,
    // sculpt-context edits
    resetPart, resetOutline, resetRegions, setRegion,
    // wardrobe
    setBodyShape, setClothing, setBottoms, setClothingSkin, setBodyPose, setHeldItem, toggleAccessory,
    setSkin: (skin: string) => editDraft((d) => ({ ...d, skin })),
    setAmount: (amount: number) => editDraftCoalesced((d) => ({ ...d, amount })),
    setHeadScaleY: (headScaleY: number) => editDraftCoalesced((d) => ({ ...d, headScaleY })),
    removeFace: () => { editDraft((d) => ({ ...d, face: null })); view.faceAnim = null; twigWrite('faceAnim', null); setStatus(null); },
    savePaintedModel, adoptPaintedDocument,
    // view setters (twig write-through; the route's keys)
    setLens: setViewKey('lens', 'wbLens'),
    setSelPart: setViewKey('selPart', 'selPart'),
    setSculptTab: setViewKey('sculptTab', 'editTab'),
    setSculptMode: setViewKey('sculptMode', 'sculptMode'),
    setMirror: setViewKey('mirror', 'mirror'),
    setBrush: setViewKey('brush', 'brush'),
    setStrength: setViewKey('strength', 'strength'),
    setPhoto: setViewKey('photo', 'photo'),
    setPhotoScale: setViewKey('photoScale', 'photoScale'),
    setPhotoY: setViewKey('photoY', 'photoY'),
    setShowHitboxes: setViewKey('showHitboxes', 'showHitboxes'),
    setFaceAnim: setViewKey('faceAnim', 'faceAnim'),
    setBodyRigAnim: setViewKey('bodyRigAnim', 'bodyRigAnim'),
    setAnimScript: setViewKey('animScript', 'animScript'),
    setScriptPlaying: setViewKey('scriptPlaying', 'scriptPlaying'),
    setShowGrabGrid: setViewKey('showGrabGrid', 'showGrabGrid'),
  };
}

export type CharacterStore = ReturnType<typeof createCharacterStore>;

// ── the live singleton (the /workbench mount's deps) ──────────────────────────

let liveStore: CharacterStore | null = null;

export function characterWorkbenchStore(): CharacterStore {
  if (liveStore) return liveStore;
  let deps: CharacterStoreDeps;
  try {
    const channel = editorChannel(charactersStream);
    deps = {
      channel,
      session: editorSessions().open('/workbench', channel) as RouteSession<CharactersEvent>,
      error: null,
      items: () => readSculptedItems(),
    };
  } catch (e) {
    deps = { channel: null, session: null, error: String(e), items: null };
  }
  // the factory's TWIGSTATE-0606 mount restore reopens the twig'd row in the
  // twig'd view — nothing extra to do here.
  liveStore = createCharacterStore(deps);
  return liveStore;
}

// the sculpted /items registry read (J4) — guarded like the route's
function readSculptedItems(): SculptedItemRef[] {
  const s = editorChannel(itemsStream).state();
  return s.order.filter((id: string) => s.items[id]).map((id: string) => sculptedItemDefinition(id, s.items[id]));
}
