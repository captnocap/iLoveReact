// FacePainter — the build view's paint-faces panel (req_0478 v1 → req_0483 →
// req_0702: moved off the iso map into the top-right PAINT tab — the panel fills
// its pane instead of floating over the world, so the map stays uncrowded and
// the full material browser gets real estate).
//
// The face row IS the piece's real skin slots (front/back/sides — a plate reads
// top/bottom/edges), each shown wearing its ACTUAL look. Click a face to TARGET
// it; with a target set, picking a skin paints only that slot. With NO target,
// picking a skin paints every slot (req_0758). Commits pieceSkinSet events — ids
// stay stable, so the selection survives and you paint face after face.
//
// Extracted from IsoAuthor (the "extend = modularize preemptively" ruling) and
// rebuilt around material NAVIGATION: the v1 blind ◀ ▶ cycler becomes grouped,
// previewed material swatches (groups follow the workbench chooser's
// materialFamily contract, with the user's Materialized customs first), plus a
// custom #rrggbb brush, a recently-used row, a visible current-brush readout,
// and a per-face readout of what the selection currently wears.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Effect, Pressable, ScrollView, Text, TextInput, TextArea } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { GAME_BUILD } from '@game';
import { propTakesText } from '../../game/kinds';
import type { BuildFaceSkin, BuildFaceSlot, BuildSkinSet, PlacedBuildPiece, WorldEvent } from '@game';
import type { WorldProp } from '../../design';
import { allTextures, type TextureDef } from '@game/textures/registry';
import { useCustomTextures, saveDecalTexture, removeCustomTexture } from '@game/textures/materials';
import { neonDecalDoc } from '@game/textures/neon';
import { materialFamily } from '../workbench/materials/chooser';
import { propParts } from '../../render3d/propParts';
import { isTextureable, type Part } from '../../render3d/parts';
import { uploadFaceTexture } from './uploadFaceTexture';
import { migrateImagesIntoRepo, summarizeMigration } from './migrateImagesIntoRepo';

// PROPSKIN-0766: a placed PROP piece (pieceId 'prop.<kind>') skins by NAMED PART,
// not by front/back/sides. Its texturable parts come from the SAME propParts the
// renderer + bake use, so part.id (a panel's partId, else 'partN') is the exact
// key piecePartTextureSet writes and the prop wears. null = the piece is not a prop.
function propPieceParts(piece: PlacedBuildPiece): Part[] | null {
  const def = GAME_BUILD.catalog.get(piece.pieceId);
  if (def.kind !== 'prop' || !def.propKind) return null;
  const prop: WorldProp = {
    id: piece.id,
    kind: def.propKind as WorldProp['kind'],
    x: piece.x, y: piece.y, z: piece.z,
    yawDegrees: piece.yawDegrees,
    partTextures: piece.partTextures,
    createdByCommand: 'hmsc-int:paint-parts',
  };
  return propParts(prop).filter(isTextureable);
}

// ── Faces: the piece's REAL skin slots (front / back / sides), kind-labelled (a
//    plate reads top / bottom / edges). The row shows each slot wearing its
//    ACTUAL look; click one to target it, leave none selected to paint them all
//    (req_0758 — "click a face to change it, otherwise edit every face"). The old
//    N/E/S/W compass mapping is gone: each slot already owns its own look, so the
//    row IS the slots (USER req_0762: "each already owns its own slot").

const BRUSH_SWATCHES = [
  '#d8cdb8', '#9aa3ad', '#8a4a3a', '#506a85', '#2d3b4e', '#c8b06a',
  '#7a8b6f', '#e0e5ea', '#1a1d24', '#8a6a45', '#b04a3a', '#3a6b8a',
];

/** The skin a slot wears across the selection: one skin, 'mixed', or null
 *  (unpainted). Drives the per-face thumbnail and what a re-pick would replace. */
function slotWear(pieces: readonly PlacedBuildPiece[], slot: BuildFaceSlot): BuildFaceSkin | 'mixed' | null {
  let seen: BuildFaceSkin | null | undefined; // undefined = none seen yet
  for (const p of pieces) {
    const s = (p.skin as BuildSkinSet | undefined)?.[slot] ?? null;
    if (seen === undefined) seen = s;
    else if (matKey2(seen) !== matKey2(s)) return 'mixed';
  }
  return seen ?? null;
}

// ── Material groups: the workbench chooser's family contract, customs first ──

type MatGroup = { name: string; items: TextureDef[] };

function materialGroups(materials: readonly TextureDef[]): MatGroup[] {
  const mine: TextureDef[] = [];
  const byFamily = new Map<string, TextureDef[]>();
  for (const t of materials) {
    if (t.id.startsWith('custom:')) { mine.push(t); continue; }
    const fam = materialFamily(t.id);
    const list = byFamily.get(fam);
    if (list) list.push(t); else byFamily.set(fam, [t]);
  }
  const out: MatGroup[] = [];
  if (mine.length) out.push({ name: 'my materials', items: mine });
  for (const [name, items] of byFamily) out.push({ name, items });
  return out;
}

// ── Swatch preview: the texture's own source, small — shader recipes render
//    their Effect, react facades/decals render clipped (they fill 100%). Only
//    the OPEN group mounts these, so ~a dozen live at once, never the registry.

const SWATCH_FILL = { width: '100%', height: '100%' } as const;
const SWATCH_CTX = { widthMeters: 3, heightMeters: 3, cols: 1, floors: 1, perception: { high: 0 } as any };

function matKey(skin: BuildFaceSkin): string {
  return skin.kind === 'color' ? `c:${skin.value}` : `m:${skin.id}`;
}

const MatSwatch = memo(function MatSwatch(props: {
  def: TextureDef;
  active: boolean;
  deleteArmed: boolean;
  onPick: (id: string) => void;
  onArmDelete: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { def } = props;
  const short = def.label.length > 11 ? `${def.label.slice(0, 10)}…` : def.label;
  const canDelete = def.id.startsWith('custom:');
  const deleteTip = props.deleteArmed ? `delete ${def.label}` : `arm delete for ${def.label}`;
  return (
    <Pressable onPress={() => props.onPick(def.id)} hoverable tooltip={def.label}>
      <Box style={{ width: 66, gap: 2 }}>
        <Box style={{ width: 66, height: 38, borderRadius: 4, borderWidth: props.active ? 2 : 1, borderColor: props.active ? '#7dd3fc' : '#3a4f6b', backgroundColor: '#0f1a2e', overflow: 'hidden', position: 'relative' }}>
          {def.source.kind === 'shader'
            ? <Effect shader={def.source.shader} data={def.source.data} style={SWATCH_FILL} />
            : def.source.render(SWATCH_CTX)}
          {canDelete ? (
            <Pressable
              onPress={() => (props.deleteArmed ? props.onDelete(def.id) : props.onArmDelete(def.id))}
              hoverable
              tooltip={deleteTip}
              style={{
                position: 'absolute',
                right: 2,
                top: 2,
                minWidth: props.deleteArmed ? 38 : 16,
                height: 16,
                borderRadius: 3,
                borderWidth: 1,
                borderColor: props.deleteArmed ? '#ef4444' : '#475569',
                backgroundColor: props.deleteArmed ? '#3a1414' : '#07111fdd',
                alignItems: 'center',
                justifyContent: 'center',
                paddingLeft: props.deleteArmed ? 4 : 0,
                paddingRight: props.deleteArmed ? 4 : 0,
              }}
            >
              {props.deleteArmed
                ? <Text fontSize={8} color="#fca5a5" style={{ fontFamily: 'monospace', fontWeight: 700 }}>delete</Text>
                : <Icon name="Trash2" size={10} color="#cbd5e1" />}
            </Pressable>
          ) : null}
        </Box>
        <Text fontSize={8} color={props.active ? '#7dd3fc' : '#a8b6c8'} style={{ fontFamily: 'monospace' }}>{short}</Text>
      </Box>
    </Pressable>
  );
});

// ── The panel ────────────────────────────────────────────────────────────────

export interface FacePainterProps {
  // The RAW placed pieces (commit basis — ids and skins as the stream holds them).
  pieces: readonly PlacedBuildPiece[];
  selectedIds: ReadonlySet<string>;
  // The iso pane's batched commit: many pieceSkinSet events as ONE undo step.
  commitBatch: (items: ReadonlyArray<{ event: WorldEvent; label: string }>) => void;
  // req_0749: open the full texture painter (the /workbench PAINT source) for
  // drawing/layered editing — the cart routes there; whatever you save to the
  // library appears in the browser below to apply. Omitted = the button hides.
  onOpenPainter?: () => void;
}

export const FacePainter = memo(function FacePainter(props: FacePainterProps) {
  const selPieces = useMemo(
    () => props.pieces.filter((p) => props.selectedIds.has(p.id)),
    [props.pieces, props.selectedIds],
  );
  // Live refs for the press handlers (Pressable onPress closures freeze at first
  // mount — read state through refs, never the captured variable).
  const selRef = useRef(selPieces);
  selRef.current = selPieces;
  const commitRef = useRef(props.commitBatch);
  commitRef.current = props.commitBatch;

  const [brush, setBrush] = useState<BuildFaceSkin>({ kind: 'color', value: '#d8cdb8' });
  // The last few brushes actually painted with — one click back to a mix you were using.
  const [recent, setRecent] = useState<BuildFaceSkin[]>([]);
  // Custom color draft: any valid #rrggbb becomes the brush as you type.
  const [hexDraft, setHexDraft] = useState('');
  const hexValid = /^#[0-9a-fA-F]{6}$/.test(hexDraft);

  // Registry materials (built-in + Materialized customs), grouped for
  // navigation. Subscribed to the custom-texture store (req_0749) so an image
  // uploaded right here — or a texture saved in the painter — appears in the
  // browser the moment it lands, no reload. Only the open group's (or the
  // search hits') swatch previews mount — never the whole registry at once,
  // which is a live <Effect> apiece.
  const customTextures = useCustomTextures();
  const materials = useMemo(() => allTextures(), [customTextures]);
  const materialById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  // The 'all' group (req_0711) heads the list so the ENTIRE textures menu is one
  // click away from the workspace — no trip to the Objects tab. It's opt-in
  // (selecting it mounts every preview), the families keep browsing bounded.
  const groups = useMemo<MatGroup[]>(() => [{ name: 'all', items: materials }, ...materialGroups(materials)], [materials]);
  const [openGroupName, setOpenGroupName] = useState<string | null>(null);
  // Default to the first REAL group (my materials / a family), never 'all' — the
  // 'all' view mounts every live preview and must stay an explicit click.
  const openGroup = groups.find((g) => g.name === openGroupName) ?? groups.find((g) => g.name !== 'all') ?? groups[0] ?? null;
  // Live filter across EVERY texture (req_0711): type a name and the whole menu
  // narrows to the hits, flat — the fast path to any texture without scrolling
  // families. Only the hits mount, so the search view stays cheap.
  const [query, setQuery] = useState('');
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const matchHits = useMemo(
    () => (q ? materials.filter((m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : null),
    [q, materials],
  );

  // The TARGETED slot, or null = paint every slot. Clicking a face in the row
  // toggles it; read through a ref in the (frozen) press closures.
  const [selectedSlot, setSelectedSlot] = useState<BuildFaceSlot | null>(null);
  const selectedSlotRef = useRef(selectedSlot);
  selectedSlotRef.current = selectedSlot;

  // The slots this selection exposes + their kind labels (front/back/sides, or a
  // plate's top/bottom/edges). Labels follow the first selected piece's kind.
  const slots = GAME_BUILD.skins.slots;
  const slotLabels = useMemo(
    () => GAME_BUILD.skins.slotLabels(selPieces[0] ? GAME_BUILD.catalog.get(selPieces[0].pieceId).kind : 'wall'),
    [selPieces],
  );

  // What each slot currently WEARS across the selection (its real look or 'mixed'),
  // so the row can show every face as it actually appears.
  const slotWears = useMemo(
    () => Object.fromEntries(slots.map((s) => [s, slotWear(selPieces, s)])) as Record<BuildFaceSlot, BuildFaceSkin | 'mixed' | null>,
    [selPieces, slots],
  );

  // ── PROP MODE (PROPSKIN-0766): a selection of ONLY prop pieces skins by named
  // PART, not by face slot. The parts row replaces the slot row; a texture pick
  // writes piecePartTextureSet to the targeted part (or every part) per piece.
  const propMode = selPieces.length > 0 && selPieces.every((p) => GAME_BUILD.catalog.get(p.pieceId).kind === 'prop');
  const propModeRef = useRef(propMode);
  propModeRef.current = propMode;
  // The texturable parts of the FIRST selected prop (same-kind props share them).
  const propPartList = useMemo(() => (propMode && selPieces[0] ? (propPieceParts(selPieces[0]) ?? []) : []), [propMode, selPieces]);
  // The targeted part id, or null = skin every part.
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const selectedPartRef = useRef(selectedPart);
  selectedPartRef.current = selectedPart;
  // What each part wears across the selection: a texture id, 'mixed', or null.
  const partWears = useMemo(() => {
    const wear: Record<string, string | 'mixed' | null> = {};
    for (const part of propPartList) {
      let seen: string | null | undefined;
      for (const p of selPieces) {
        const t = p.partTextures?.[part.id] ?? null;
        if (seen === undefined) seen = t;
        else if (seen !== t) { seen = 'mixed'; break; }
      }
      wear[part.id] = seen ?? null;
    }
    return wear;
  }, [propPartList, selPieces]);

  // ── PARAMETRIC props (req_0893): a selection of text-driven props (block
  // letters, …) gets a text field that retypes the sign. Typing only edits the
  // DRAFT; an explicit Apply button commits it (req_0898 — per-keystroke commits
  // spammed undo and the user expected a button). The draft re-syncs when the
  // selection changes. Commits one pieceTextSet per piece, the stable-id pattern
  // the skin/part events use.
  const textProp = propMode && selPieces.length > 0
    && selPieces.every((p) => { const k = GAME_BUILD.catalog.get(p.pieceId).propKind; return !!k && propTakesText(k); });
  const [textDraft, setTextDraft] = useState('');
  const selSig = selPieces.map((p) => p.id).join(',');
  useEffect(() => { setTextDraft(selPieces[0]?.text ?? ''); }, [selSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const committedText = selPieces[0]?.text ?? '';
  const textDirty = textDraft !== committedText;
  const applyText = () => {
    const sel = selRef.current;
    if (!sel.length) return;
    commitRef.current(sel.map((p) => ({ event: { kind: 'pieceTextSet', id: p.id, text: textDraft } as WorldEvent, label: 'sign text' })));
  };

  // ── PARAMETRIC neon (req_0893, ask #2): paste a logo's SVG path `d` (or draw
  // one), pick the tube color, and bake it to a NEON decal material. It lands in
  // the library below the moment it saves (useCustomTextures is subscribed), then
  // skin a neonLogo / neonLogoDouble face with it — the normal part-skin flow, so
  // no bespoke apply path. Works on any face, not just neon props.
  const [neonSvg, setNeonSvg] = useState('');
  const [neonColor, setNeonColor] = useState(''); // blank = each path keeps its own fill color
  const makeNeon = () => {
    const input = neonSvg.trim();
    if (!input) return;
    // A full <svg>/<path …> paste OR a single path `d`; blank color → logo's fills.
    const doc = neonDecalDoc(input, { stroke: neonColor.trim() || undefined });
    if (doc.nodes.length === 0) return; // nothing parsed — leave the field for a retry
    const tex = saveDecalTexture('Neon', doc);
    if (tex) { setNeonSvg(''); applyPropTexture(tex.id); }
  };

  const pushRecent = (b: BuildFaceSkin) => {
    setRecent((list) => [b, ...list.filter((x) => matKey(x) !== matKey(b))].slice(0, 8));
  };

  // Apply a skin to the TARGETED slot if one is selected, else every slot (the
  // Sims expectation — click a material, the whole piece wears it). One batch =
  // one undo step; ids stay stable so the selection (and target) survive.
  const applyBrush = (b: BuildFaceSkin) => {
    setBrush(b);
    const sel = selRef.current;
    if (!sel.length) return;
    const slot = selectedSlotRef.current;
    const patch: BuildSkinSet = slot ? { [slot]: b } : { front: b, back: b, sides: b };
    const label = slot ? `painted ${slot}` : 'painted piece';
    commitRef.current(sel.map((p) => ({ event: { kind: 'pieceSkinSet', id: p.id, skin: patch } as WorldEvent, label })));
    pushRecent(b);
  };

  // Apply a TEXTURE to the targeted prop PART (or every part) across the selection
  // — one piecePartTextureSet per (piece, part), one batch. Reads refs so it stays
  // correct when called from a frozen swatch closure (the applyBrush pattern).
  const applyPropTexture = (textureId: string) => {
    const sel = selRef.current;
    if (!sel.length) return;
    const target = selectedPartRef.current;
    const items: { event: WorldEvent; label: string }[] = [];
    for (const p of sel) {
      const partIds = target ? [target] : (propPieceParts(p) ?? []).map((part) => part.id);
      for (const partId of partIds) {
        items.push({ event: { kind: 'piecePartTextureSet', id: p.id, partId, textureId } as WorldEvent, label: target ? `skinned ${target}` : 'skinned prop' });
      }
    }
    if (items.length) { commitRef.current(items); pushRecent({ kind: 'material', id: textureId }); }
  };

  // A texture pick routes by mode: a prop's PART, or a build piece's face slot.
  const pickMaterial = (id: string) => {
    setArmedDeleteId(null);
    if (propModeRef.current) applyPropTexture(id); else applyBrush({ kind: 'material', id });
  };

  const deleteMaterial = (id: string) => {
    if (!id.startsWith('custom:')) return;
    removeCustomTexture(id);
    setArmedDeleteId(null);
    setRecent((list) => list.filter((b) => b.kind !== 'material' || b.id !== id));
    setBrush((b) => (b.kind === 'material' && b.id === id ? { kind: 'color', value: '#d8cdb8' } : b));
  };

  // Upload an image (req_0749): the picker → a stored decal material → set as
  // the BRUSH (not auto-painted onto every side — an uploaded image is usually
  // for ONE face, like a poster, so the next click is a face button). It's in
  // the browser too (useCustomTextures), where its swatch covers all sides if
  // that's what you want. `uploading` guards the native picker double-open.
  const [uploading, setUploading] = useState(false);
  const onUploadImage = () => {
    if (uploading) return;
    setUploading(true);
    void uploadFaceTexture()
      .then((r) => {
        if (!r) return;
        // In prop mode the upload skins the targeted part directly; in piece mode
        // it becomes the brush (the next face click drops it on one side).
        if (propModeRef.current) { applyPropTexture(r.id); return; }
        const b: BuildFaceSkin = { kind: 'material', id: r.id };
        setBrush(b);
        pushRecent(b);
      })
      .finally(() => setUploading(false));
  };

  // PORTABILITY (req_1774): older uploads stored this machine's absolute file
  // path, which breaks on rename and on another computer. This pulls every such
  // image's bytes into the repo (content-addressed) and rewrites the refs, so
  // after a commit + push the textures travel. Run it here, where the source
  // files still exist; a moved/deleted source can't be recovered (reported).
  const [migrateMsg, setMigrateMsg] = useState('');
  const onMakePortable = () => {
    try {
      const r = migrateImagesIntoRepo();
      setMigrateMsg(summarizeMigration(r));
    } catch (e) {
      setMigrateMsg(`migration failed: ${String(e)}`);
    }
  };

  const brushLabel = brush.kind === 'color' ? brush.value : (materialById.get(brush.id)?.label ?? brush.id);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b1220', padding: 10, gap: 7 }}>
      <Text fontSize={9} color="#7dd3fc" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
        {propMode
          ? `PAINT — ${selPieces.length} prop${selPieces.length === 1 ? '' : 's'} · ${selectedPart ? `part: ${selectedPart}` : 'a texture skins every part'}`
          : `PAINT — ${selPieces.length} piece${selPieces.length === 1 ? '' : 's'} · ${selectedSlot ? `face: ${slotLabels[selectedSlot]}` : 'a skin paints every face'}`}
      </Text>
      {selPieces.length === 0 ? (
        <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>
          {'nothing selected — click pieces in the build pane below; the brush you set here is ready when you do'}
        </Text>
      ) : null}

      {/* PARAMETRIC props (req_0893): the sign's text. Type, then APPLY to retype
          the sign (req_0898 — an explicit button; the recipe rebuilds from the word). */}
      {textProp ? (
        <Box style={{ gap: 3 }}>
          <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>SIGN TEXT</Text>
          <Box style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
            <TextInput
              text={textDraft}
              placeholder="business name…"
              onChangeText={setTextDraft}
              onSubmitEditing={applyText}
              style={{ flexGrow: 1, backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: textDirty ? '#fbbf24' : '#38bdf8', borderRadius: 3, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }}
            />
            <Pressable onPress={applyText} hoverable tooltip="apply the typed text to the selected sign(s)">
              <Box style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: textDirty ? '#fbbf24' : '#3a4f6b', backgroundColor: textDirty ? '#3a2f12' : '#16233a' }}>
                <Text fontSize={9} color={textDirty ? '#fbbf24' : '#64748b'} style={{ fontFamily: 'monospace' }}>{textDirty ? 'apply' : 'applied'}</Text>
              </Box>
            </Pressable>
          </Box>
        </Box>
      ) : null}

      {/* the row: a build piece's FACES (front/back/sides) or a prop's PARTS — each
          shows its REAL look. Click one to target it (a skin then covers only it);
          click again — or leave none — to skin every face/part. */}
      <Box style={{ gap: 3 }}>
        <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>
          {selPieces.length === 0
            ? (propMode ? 'PARTS' : 'FACES')
            : propMode
              ? (selectedPart
                  ? `PARTS · targeting ${selectedPart} — a texture skins just this · click again for all`
                  : 'PARTS · a texture skins all · click one to refine it')
              : selectedSlot
                ? `FACES · targeting ${slotLabels[selectedSlot]} — a skin paints just this · click again for all`
                : 'FACES · a skin paints all · click one to refine it'}
        </Text>
        <Box style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
          {propMode
            ? propPartList.map((part) => {
                const wear = partWears[part.id];
                const active = selectedPart === part.id;
                const def = wear && wear !== 'mixed' ? materialById.get(wear) : undefined;
                const wearName = wear === 'mixed' ? 'mixed' : wear === null ? `${part.material} (default)` : (materialById.get(wear)?.label ?? wear);
                const fill = wear === 'mixed' ? '#475569' : wear === null ? part.material : '#0f1a2e';
                return (
                  <Pressable key={part.id} onPress={() => setSelectedPart((cur) => (cur === part.id ? null : part.id))} hoverable tooltip={`${part.label} · now: ${wearName} · click to skin just this part`}>
                    <Box style={{ width: 60, gap: 2 }}>
                      <Box style={{ width: 60, height: 44, borderRadius: 4, borderWidth: active ? 2 : 1, borderColor: active ? '#7dd3fc' : '#3a4f6b', backgroundColor: fill, overflow: 'hidden' }}>
                        {def ? (def.source.kind === 'shader'
                          ? <Effect shader={def.source.shader} data={def.source.data} style={SWATCH_FILL} />
                          : def.source.render(SWATCH_CTX)) : null}
                      </Box>
                      <Text fontSize={8} color={active ? '#7dd3fc' : '#a8b6c8'} style={{ fontFamily: 'monospace' }}>{part.label}</Text>
                    </Box>
                  </Pressable>
                );
              })
            : slots.map((slot) => {
                const wear = slotWears[slot];
                const active = selectedSlot === slot;
                const def = wear && wear !== 'mixed' && wear.kind === 'material' ? materialById.get(wear.id) : undefined;
                const wearName = wear === 'mixed' ? 'mixed' : wear === null ? 'unpainted' : wear.kind === 'color' ? wear.value : (materialById.get(wear.id)?.label ?? wear.id);
                const fill = wear === null ? '#0b1220' : wear === 'mixed' ? '#475569' : wear.kind === 'color' ? wear.value : '#0f1a2e';
                return (
                  <Pressable key={slot} onPress={() => setSelectedSlot((cur) => (cur === slot ? null : slot))} hoverable tooltip={`${slotLabels[slot]} · now: ${wearName} · click to refine just this face`}>
                    <Box style={{ width: 60, gap: 2 }}>
                      <Box style={{ width: 60, height: 44, borderRadius: 4, borderWidth: active ? 2 : 1, borderColor: active ? '#7dd3fc' : '#3a4f6b', backgroundColor: fill, overflow: 'hidden' }}>
                        {def ? (def.source.kind === 'shader'
                          ? <Effect shader={def.source.shader} data={def.source.data} style={SWATCH_FILL} />
                          : def.source.render(SWATCH_CTX)) : null}
                      </Box>
                      <Text fontSize={8} color={active ? '#7dd3fc' : '#a8b6c8'} style={{ fontFamily: 'monospace' }}>{slotLabels[slot]}</Text>
                    </Box>
                  </Pressable>
                );
              })}
        </Box>
      </Box>

      {/* the current brush — face mode only (a prop part takes a texture directly,
          there is no colour brush to pre-load). */}
      {!propMode ? (
      <Box style={{ flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: '#0f1a2e', borderRadius: 4, paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 4 }}>
        <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>BRUSH</Text>
        {brush.kind === 'color' ? (
          <Box style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: brush.value, borderWidth: 1, borderColor: '#3a4f6b' }} />
        ) : (
          <Box style={{ width: 28, height: 16, borderRadius: 3, borderWidth: 1, borderColor: '#7dd3fc', backgroundColor: '#0f1a2e', overflow: 'hidden' }}>
            {(() => {
              const def = materialById.get(brush.id);
              if (!def) return null;
              return def.source.kind === 'shader'
                ? <Effect shader={def.source.shader} data={def.source.data} style={SWATCH_FILL} />
                : def.source.render(SWATCH_CTX);
            })()}
          </Box>
        )}
        <Text fontSize={9} color="#eaf4ff" style={{ fontFamily: 'monospace' }}>{brushLabel}</Text>
      </Box>
      ) : null}

      {/* recently used — one click back. A material re-applies (routed by mode);
          a colour only re-applies in face mode. */}
      {recent.length > 0 ? (
        <Box style={{ flexDirection: 'row', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>RECENT</Text>
          {recent.filter((b) => !propMode || b.kind === 'material').map((b) => (
            <Pressable key={matKey(b)} onPress={() => (b.kind === 'material' ? pickMaterial(b.id) : applyBrush(b))} hoverable tooltip={b.kind === 'color' ? b.value : (materialById.get(b.id)?.label ?? b.id)}>
              {b.kind === 'color' ? (
                <Box style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: b.value, borderWidth: 1, borderColor: '#3a4f6b' }} />
              ) : (
                <Box style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: '#16233a', borderWidth: 1, borderColor: '#7dd3fc', alignItems: 'center', justifyContent: 'center' }}>
                  <Text fontSize={7} color="#7dd3fc" style={{ fontFamily: 'monospace' }}>M</Text>
                </Box>
              )}
            </Pressable>
          ))}
        </Box>
      ) : null}

      {/* colors: the fixed swatches + any #rrggbb you type. Face mode only — a
          prop part wears a texture, not a flat colour. */}
      {!propMode ? (
      <Box style={{ flexDirection: 'row', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        {BRUSH_SWATCHES.map((c) => (
          <Pressable key={c} onPress={() => applyBrush({ kind: 'color', value: c })}>
            <Box style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: c, borderWidth: brush.kind === 'color' && brush.value === c ? 2 : 1, borderColor: brush.kind === 'color' && brush.value === c ? '#7dd3fc' : '#3a4f6b' }} />
          </Pressable>
        ))}
        <TextInput
          text={hexDraft}
          placeholder="#rrggbb"
          onChangeText={(v: string) => { setHexDraft(v); if (/^#[0-9a-fA-F]{6}$/.test(v)) applyBrush({ kind: 'color', value: v }); }}
          style={{ width: 66, backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: hexDraft.length === 0 ? '#27364a' : hexValid ? '#34d399' : '#b04a3a', borderRadius: 3, paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }}
        />
      </Box>
      ) : null}

      {/* PARAMETRIC neon (req_0893/req_0899): paste a whole logo SVG (every
          <path> becomes a glowing tube in its own fill color) OR a single path
          `d`. The logo is fit to the face; blank color keeps the logo's colors.
          Bakes a NEON decal into the library + (in prop mode) skins the face. */}
      <Box style={{ gap: 3 }}>
        <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>NEON FROM SVG · paste a logo's SVG or one path d</Text>
        <TextArea
          text={neonSvg}
          placeholder={'<svg>…</svg>  or  M10,10 L90,90 …'}
          onChangeText={setNeonSvg}
          style={{ width: '100%', height: 56, backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: neonSvg.trim() ? '#ff3bd0' : '#27364a', borderRadius: 3, paddingLeft: 5, paddingRight: 5, paddingTop: 3, paddingBottom: 3, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }}
        />
        <Box style={{ flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextInput
            text={neonColor}
            placeholder="tube color (blank = logo colors)"
            onChangeText={setNeonColor}
            style={{ width: 200, backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: '#3a4f6b', borderRadius: 3, paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }}
          />
          <Pressable onPress={makeNeon} hoverable tooltip="bake the SVG into a glowing neon decal — saved to the library; in prop mode it skins the selected face too">
            <Box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: neonSvg.trim() ? '#ff3bd0' : '#3a4f6b', backgroundColor: '#16233a' }}>
              <Text fontSize={9} color={neonSvg.trim() ? '#ff8fe0' : '#64748b'} style={{ fontFamily: 'monospace' }}>make neon</Text>
            </Box>
          </Pressable>
        </Box>
      </Box>

      {/* textures from here (req_0749): upload an image straight onto the piece,
          or open the full painter to draw/layer one — both feed the SAME library
          the browser below reads, so what you make lands as a usable swatch. */}
      <Box style={{ flexDirection: 'row', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>TEXTURE</Text>
        <Pressable onPress={onUploadImage} hoverable tooltip="pick an image — it becomes your brush; click a face button (N/E/S/W/Top/In) to put it on just that side, or its swatch below to cover all sides">
          <Box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: '#3a4f6b', backgroundColor: uploading ? '#1e293b' : '#16233a' }}>
            <Text fontSize={9} color={uploading ? '#64748b' : '#7dd3fc'} style={{ fontFamily: 'monospace' }}>{uploading ? 'opening…' : 'open image…'}</Text>
          </Box>
        </Pressable>
        {props.onOpenPainter ? (
          <Pressable onPress={props.onOpenPainter} hoverable tooltip="open the texture painter — draw, layer, smart-select, save to library">
            <Box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: '#3a4f6b', backgroundColor: '#16233a' }}>
              <Text fontSize={9} color="#a8b6c8" style={{ fontFamily: 'monospace' }}>paint a texture…</Text>
            </Box>
          </Pressable>
        ) : null}
        <Pressable onPress={onMakePortable} hoverable tooltip="copy your uploaded images into the repo so they travel with git/another machine (run before committing). Renamed/moved sources can't be recovered — re-upload those.">
          <Box style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 4, borderWidth: 1, borderColor: '#3a4f6b', backgroundColor: '#16233a' }}>
            <Text fontSize={9} color="#a8b6c8" style={{ fontFamily: 'monospace' }}>make portable</Text>
          </Box>
        </Pressable>
        {migrateMsg ? <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace', flexBasis: '100%' }}>{migrateMsg}</Text> : null}
      </Box>

      {/* materials: the ENTIRE textures menu, in the workspace (req_0711). A live
          search narrows EVERY texture flat; else family chips ('all' heads them)
          browse one group. The browser takes the pane's remaining height. */}
      {groups.length > 0 ? (
        <Box style={{ gap: 4, flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
          <TextInput
            text={query}
            placeholder="search every texture…"
            onChangeText={setQuery}
            style={{ backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: q ? '#38bdf8' : '#27364a', borderRadius: 3, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }}
          />
          {matchHits ? (
            // Search view: flat hits across the whole registry — only these mount.
            <>
              <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>{`${matchHits.length} match${matchHits.length === 1 ? '' : 'es'}`}</Text>
              <ScrollView style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
                <Box style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
                  {matchHits.map((def) => (
                    <MatSwatch
                      key={def.id}
                      def={def}
                      active={brush.kind === 'material' && brush.id === def.id}
                      deleteArmed={armedDeleteId === def.id}
                      onPick={pickMaterial}
                      onArmDelete={setArmedDeleteId}
                      onDelete={deleteMaterial}
                    />
                  ))}
                </Box>
                {matchHits.length === 0 ? (
                  <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace', paddingTop: 6 }}>{'no texture by that name'}</Text>
                ) : null}
              </ScrollView>
            </>
          ) : (
            // Browse view: family chips, 'all' first — open one group at a time.
            <>
              <Box style={{ flexDirection: 'row', gap: 3, flexWrap: 'wrap' }}>
                {groups.map((g) => (
                  <Pressable key={g.name} onPress={() => setOpenGroupName(g.name)}>
                    <Box style={{ paddingLeft: 7, paddingRight: 7, paddingTop: 3, paddingBottom: 3, borderRadius: 4, backgroundColor: openGroup?.name === g.name ? '#2563eb' : '#1e293b' }}>
                      <Text fontSize={9} color={openGroup?.name === g.name ? '#eaf4ff' : '#a8b6c8'} style={{ fontFamily: 'monospace' }}>{`${g.name} (${g.items.length})`}</Text>
                    </Box>
                  </Pressable>
                ))}
              </Box>
              {openGroup ? (
                <ScrollView style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}>
                  <Box style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
                    {openGroup.items.map((def) => (
                      <MatSwatch
                        key={def.id}
                        def={def}
                        active={brush.kind === 'material' && brush.id === def.id}
                        deleteArmed={armedDeleteId === def.id}
                        onPick={pickMaterial}
                        onArmDelete={setArmedDeleteId}
                        onDelete={deleteMaterial}
                      />
                    ))}
                  </Box>
                </ScrollView>
              ) : null}
            </>
          )}
        </Box>
      ) : null}
    </Box>
  );
});

// slotWear's comparator: like matKey but null-tolerant (an unpainted slot).
function matKey2(skin: BuildFaceSkin | null): string {
  return skin === null ? 'none' : matKey(skin);
}
