// FacePainter — the build view's paint panel (req_0478 → req_0702 → req_1929).
// Restructured top-to-bottom to the user's spec (req_1929): the SELECTED ITEM
// first (name + location), then the FACES/PARTS it can be skinned on, then a
// PAGED skin grid that behaves exactly like the prop menu (railThumbGrid), then a
// stored/used/hex COLOR palette, then two icon doors (open image · paint a
// texture). Gone for good: the NEON-from-SVG blob, the tube-colour input, and the
// "make portable" button — portability now happens automatically on every upload.
//
// The face row IS the piece's real skin slots (front/back/sides — a plate reads
// top/bottom/edges), each shown wearing its ACTUAL look. Click a face to TARGET
// it; with a target set, picking a skin paints only that slot. With NO target,
// picking a skin paints every slot (req_0758). A selection of ONLY prop pieces
// skins by named PART instead (PROPSKIN-0766). Commits pieceSkinSet /
// piecePartTextureSet events — ids stay stable, so the selection survives.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Effect, Pressable, Text, TextInput } from '@reactjit/primitives';
import { Icon } from '@reactjit/icons/Icon';
import { GAME_BUILD } from '@game';
import { propTakesText } from '../../game/kinds';
import type { BuildFaceSkin, BuildFaceSlot, BuildSkinSet, PlacedBuildPiece, WorldEvent } from '@game';
import type { WorldProp } from '../../design';
import { allTextures, type TextureDef } from '@game/textures/registry';
import { useCustomTextures, removeCustomTexture } from '@game/textures/materials';
import { propParts } from '../../render3d/propParts';
import { isTextureable, type Part } from '../../render3d/parts';
import { uploadFaceTexture } from './uploadFaceTexture';
import { stampEdit } from './editLatency';
import { migrateImagesIntoRepo } from './migrateImagesIntoRepo';
import { useFittedGrid, RailPager, thumbCellH } from '../../railThumbGrid';

// PROPSKIN-0766: a placed PROP piece (pieceId 'prop.<kind>') skins by NAMED PART.
// Its texturable parts come from the SAME propParts the renderer + bake use.
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

// The stored colour palette — the always-available swatches. "Used" colours come
// from the recent row, custom ones from the hex field (req_1929).
const BRUSH_SWATCHES = [
  '#d8cdb8', '#9aa3ad', '#8a4a3a', '#506a85', '#2d3b4e', '#c8b06a',
  '#7a8b6f', '#e0e5ea', '#1a1d24', '#8a6a45', '#b04a3a', '#3a6b8a',
];

const TEX_TILE_W = 66;
const TEX_TILE_H = 38;

/** The skin a slot wears across the selection: one skin, 'mixed', or null. */
function slotWear(pieces: readonly PlacedBuildPiece[], slot: BuildFaceSlot): BuildFaceSkin | 'mixed' | null {
  let seen: BuildFaceSkin | null | undefined;
  for (const p of pieces) {
    const s = (p.skin as BuildSkinSet | undefined)?.[slot] ?? null;
    if (seen === undefined) seen = s;
    else if (matKey2(seen) !== matKey2(s)) return 'mixed';
  }
  return seen ?? null;
}

const SWATCH_FILL = { width: '100%', height: '100%' } as const;
const SWATCH_CTX = { widthMeters: 3, heightMeters: 3, cols: 1, floors: 1, perception: { high: 0 } as any };

function matKey(skin: BuildFaceSkin): string {
  return skin.kind === 'color' ? `c:${skin.value}` : `m:${skin.id}`;
}

// One skin tile in the paged grid — the texture's own preview (shader recipes
// render their Effect; facades/decals render clipped). A custom skin carries an
// arm-then-confirm delete. Only the visible PAGE mounts, so the live <Effect>
// count stays bounded — the same discipline the prop grid keeps.
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
      <Box style={{ width: TEX_TILE_W, gap: 2 }}>
        <Box style={{ width: TEX_TILE_W, height: TEX_TILE_H, borderRadius: 4, borderWidth: props.active ? 2 : 1, borderColor: props.active ? '#7dd3fc' : '#3a4f6b', backgroundColor: '#0f1a2e', overflow: 'hidden', position: 'relative' }}>
          {def.source.kind === 'shader'
            ? <Effect shader={def.source.shader} data={def.source.data} style={SWATCH_FILL} />
            : def.source.render(SWATCH_CTX)}
          {canDelete ? (
            <Pressable
              onPress={() => (props.deleteArmed ? props.onDelete(def.id) : props.onArmDelete(def.id))}
              hoverable
              tooltip={deleteTip}
              style={{ position: 'absolute', right: 2, top: 2, minWidth: props.deleteArmed ? 38 : 16, height: 16, borderRadius: 3, borderWidth: 1, borderColor: props.deleteArmed ? '#ef4444' : '#475569', backgroundColor: props.deleteArmed ? '#3a1414' : '#07111fdd', alignItems: 'center', justifyContent: 'center', paddingLeft: props.deleteArmed ? 4 : 0, paddingRight: props.deleteArmed ? 4 : 0 }}
            >
              {props.deleteArmed
                ? <Text fontSize={8} color="#fca5a5" style={{ fontFamily: 'monospace', fontWeight: 700 }}>delete</Text>
                : <Icon name="Trash2" size={10} color="#cbd5e1" />}
            </Pressable>
          ) : null}
        </Box>
        <Text fontSize={8} color={props.active ? '#7dd3fc' : '#a8b6c8'} numberOfLines={1} style={{ fontFamily: 'monospace', width: TEX_TILE_W }}>{short}</Text>
      </Box>
    </Pressable>
  );
});

// The HELD item before placement (req_1937). A subset of IsoAuthor's Armed —
// duplicated here as a narrow shape so this panel doesn't import the iso module.
export type HeldItem = { kind: 'piece' | 'prefab'; id: string } | { kind: 'tower' } | { kind: 'water'; id: string } | null;

export interface FacePainterProps {
  pieces: readonly PlacedBuildPiece[];
  selectedIds: ReadonlySet<string>;
  // The held/armed item — holding IS a selection, so the top header shows it when
  // nothing placed is selected (req_1937).
  armed?: HeldItem;
  commitBatch: (items: ReadonlyArray<{ event: WorldEvent; label: string }>) => void;
  onOpenPainter?: () => void;
}

export const FacePainter = memo(function FacePainter(props: FacePainterProps) {
  const selPieces = useMemo(
    () => props.pieces.filter((p) => props.selectedIds.has(p.id)),
    [props.pieces, props.selectedIds],
  );
  const selRef = useRef(selPieces); selRef.current = selPieces;
  const commitRef = useRef(props.commitBatch); commitRef.current = props.commitBatch;

  const [brush, setBrush] = useState<BuildFaceSkin>({ kind: 'color', value: '#d8cdb8' });
  const [recent, setRecent] = useState<BuildFaceSkin[]>([]);
  const [hexDraft, setHexDraft] = useState('');
  const hexValid = /^#[0-9a-fA-F]{6}$/.test(hexDraft);

  const customTextures = useCustomTextures();
  const materials = useMemo(() => allTextures(), [customTextures]);
  const materialById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  const [query, setQuery] = useState('');
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  // The flat skin list the grid pages — narrowed by search, exactly like the prop
  // menu. No family chips: search + paging IS the navigation now (req_1929).
  const texList = useMemo(
    () => (q ? materials.filter((m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : materials),
    [q, materials],
  );

  // The TARGETED slot, or null = paint every slot.
  const [selectedSlot, setSelectedSlot] = useState<BuildFaceSlot | null>(null);
  const selectedSlotRef = useRef(selectedSlot); selectedSlotRef.current = selectedSlot;

  const slots = GAME_BUILD.skins.slots;
  const slotLabels = useMemo(
    () => GAME_BUILD.skins.slotLabels(selPieces[0] ? GAME_BUILD.catalog.get(selPieces[0].pieceId).kind : 'wall'),
    [selPieces],
  );
  const slotWears = useMemo(
    () => Object.fromEntries(slots.map((s) => [s, slotWear(selPieces, s)])) as Record<BuildFaceSlot, BuildFaceSkin | 'mixed' | null>,
    [selPieces, slots],
  );

  // PROP MODE: a selection of ONLY prop pieces skins by named PART.
  const propMode = selPieces.length > 0 && selPieces.every((p) => GAME_BUILD.catalog.get(p.pieceId).kind === 'prop');
  const propModeRef = useRef(propMode); propModeRef.current = propMode;
  const propPartList = useMemo(() => (propMode && selPieces[0] ? (propPieceParts(selPieces[0]) ?? []) : []), [propMode, selPieces]);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const selectedPartRef = useRef(selectedPart); selectedPartRef.current = selectedPart;
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

  // PARAMETRIC props (req_0893): a text-driven prop (block letters, signs) gets a
  // text field that retypes it; an explicit Apply commits (req_0898).
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

  const pushRecent = (b: BuildFaceSkin) => {
    setRecent((list) => [b, ...list.filter((x) => matKey(x) !== matKey(b))].slice(0, 8));
  };

  const applyBrush = (b: BuildFaceSkin) => {
    setBrush(b);
    const sel = selRef.current;
    if (!sel.length) return;
    const slot = selectedSlotRef.current;
    const patch: BuildSkinSet = slot ? { [slot]: b } : { front: b, back: b, sides: b };
    const label = slot ? `painted ${slot}` : 'painted piece';
    stampEdit('skin');
    commitRef.current(sel.map((p) => ({ event: { kind: 'pieceSkinSet', id: p.id, skin: patch } as WorldEvent, label })));
    pushRecent(b);
  };

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
    if (items.length) { stampEdit('skin'); commitRef.current(items); pushRecent({ kind: 'material', id: textureId }); }
  };

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

  // Upload an image → a stored decal material → the BRUSH (an uploaded image is
  // usually for ONE face). PORTABILITY (req_1929): a moved/renamed source can't be
  // recovered, so we pull the bytes into the repo RIGHT NOW, automatically — no
  // "make portable" button to remember. Idempotent (already-migrated refs skip).
  const [uploading, setUploading] = useState(false);
  const onUploadImage = () => {
    if (uploading) return;
    setUploading(true);
    void uploadFaceTexture()
      .then((r) => {
        if (!r) return;
        try { migrateImagesIntoRepo(); } catch { /* best-effort; source may be gone */ }
        if (propModeRef.current) { applyPropTexture(r.id); return; }
        const b: BuildFaceSkin = { kind: 'material', id: r.id };
        setBrush(b);
        pushRecent(b);
      })
      .finally(() => setUploading(false));
  };

  const brushLabel = brush.kind === 'color' ? brush.value : (materialById.get(brush.id)?.label ?? brush.id);

  // The HELD item (armed, pre-placement) resolved to a name + sub-line — holding
  // IS a selection (req_1937), so the header shows it when nothing placed is
  // selected. No location yet (it isn't in the world); the sub says how to place.
  const heldInfo = useMemo(() => {
    const a = props.armed;
    if (!a) return null;
    if (a.kind === 'tower') return { label: 'Tower', sub: 'holding · drag in the build pane to place' };
    if (a.kind === 'water') return { label: 'Water', sub: 'holding · place it in the build pane' };
    try {
      const def = GAME_BUILD.catalog.get(a.id);
      return { label: def.label, sub: `${def.kind} · holding — click in the build pane to place` };
    } catch { return { label: a.id, sub: 'holding — click in the build pane to place' }; }
  }, [props.armed]);

  // The paged skin grid — sized to fill its measured area, paged by whole rows.
  const grid = useFittedGrid({ total: texList.length, tileW: TEX_TILE_W, cellH: thumbCellH(TEX_TILE_H) });
  const pageItems = texList.slice(grid.start, grid.end);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b1220', padding: 10, gap: 7, flexDirection: 'column', minHeight: 0 }}>
      {/* 1 — THE SELECTION, first (req_1929/req_1937). A placed-and-selected piece
          shows its name + location; with nothing placed selected, the HELD item
          (armed before placement) shows instead — holding is a selection too. */}
      {selPieces.length === 1 ? (
        (() => {
          const p = selPieces[0];
          const def = GAME_BUILD.catalog.get(p.pieceId);
          return (
            <Box style={{ gap: 2 }}>
              <Text fontSize={11} color="#eaf4ff" style={{ fontFamily: 'monospace', fontWeight: 700 }}>{def.label}</Text>
              <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>{`${def.kind} · x ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}  z ${p.z.toFixed(1)} · yaw ${Math.round(p.yawDegrees)}°`}</Text>
            </Box>
          );
        })()
      ) : selPieces.length > 1 ? (
        <Text fontSize={11} color="#eaf4ff" style={{ fontFamily: 'monospace', fontWeight: 700 }}>{`${selPieces.length} pieces selected`}</Text>
      ) : heldInfo ? (
        <Box style={{ gap: 2 }}>
          <Text fontSize={11} color="#7dd3fc" style={{ fontFamily: 'monospace', fontWeight: 700 }}>{heldInfo.label}</Text>
          <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>{heldInfo.sub}</Text>
        </Box>
      ) : (
        <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>no selection — hold a piece or prop, or click a placed one</Text>
      )}

      {/* PARAMETRIC props: the sign's text (type, then Apply). */}
      {textProp ? (
        <Box style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
          <TextInput
            text={textDraft}
            placeholder="sign text…"
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
      ) : null}

      {/* 2 — FACES / PARTS that can be skinned. Click one to target it; none = all. */}
      <Box style={{ gap: 3 }}>
        <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>
          {propMode
            ? (selectedPart ? `PARTS · ${selectedPart}` : 'PARTS')
            : (selectedSlot ? `FACES · ${slotLabels[selectedSlot]}` : 'FACES')}
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

      {/* 3 — SKINS: search + a paged grid that pages exactly like the prop menu. */}
      <TextInput
        text={query}
        placeholder="search skins…"
        onChangeText={(t: string) => { setQuery(t); grid.setPage(0); }}
        style={{ backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: q ? '#38bdf8' : '#27364a', borderRadius: 3, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }}
      />
      <Box style={grid.containerStyle} onLayout={(rect: any) => grid.onLayout(rect)}>
        <Box style={grid.rowStyle}>
          {pageItems.map((def) => (
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
          {texList.length === 0 ? (
            <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace', paddingTop: 6 }}>no skin by that name</Text>
          ) : null}
        </Box>
      </Box>
      <RailPager pageCount={grid.pageCount} cur={grid.cur} setPage={grid.setPage} />

      {/* 4 — COLOR palette: stored swatches + recently used + a #hex add. Face mode
          only — a prop part wears a texture, not a flat colour. */}
      {!propMode ? (
        <Box style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <Box style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: brush.kind === 'color' ? brush.value : '#16233a', borderWidth: 1, borderColor: '#7dd3fc' }} />
          {BRUSH_SWATCHES.map((c) => (
            <Pressable key={c} onPress={() => applyBrush({ kind: 'color', value: c })}>
              <Box style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: c, borderWidth: brush.kind === 'color' && brush.value === c ? 2 : 1, borderColor: brush.kind === 'color' && brush.value === c ? '#7dd3fc' : '#3a4f6b' }} />
            </Pressable>
          ))}
          {recent.filter((b) => b.kind === 'color').map((b) => (
            <Pressable key={matKey(b)} onPress={() => applyBrush(b)} hoverable tooltip={b.kind === 'color' ? b.value : ''}>
              <Box style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: b.kind === 'color' ? b.value : '#16233a', borderWidth: 1, borderColor: '#475569' }} />
            </Pressable>
          ))}
          <TextInput
            text={hexDraft}
            placeholder="#hex"
            onChangeText={(v: string) => { setHexDraft(v); if (/^#[0-9a-fA-F]{6}$/.test(v)) applyBrush({ kind: 'color', value: v }); }}
            style={{ width: 60, backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: hexDraft.length === 0 ? '#27364a' : hexValid ? '#34d399' : '#b04a3a', borderRadius: 3, paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }}
          />
        </Box>
      ) : null}

      {/* 5 — TEXTURE doors: open an image · paint a texture. Icons, not strings. */}
      <Box style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        <Pressable onPress={onUploadImage} hoverable tooltip="open an image — it becomes your brush; click a face to place it, or its swatch to cover all sides">
          <Box style={{ width: 30, height: 26, borderRadius: 4, borderWidth: 1, borderColor: '#3a4f6b', backgroundColor: uploading ? '#1e293b' : '#16233a', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="Image" size={15} color={uploading ? '#64748b' : '#7dd3fc'} />
          </Box>
        </Pressable>
        {props.onOpenPainter ? (
          <Pressable onPress={props.onOpenPainter} hoverable tooltip="paint a texture — draw, layer, smart-select, save to the skin library">
            <Box style={{ width: 30, height: 26, borderRadius: 4, borderWidth: 1, borderColor: '#3a4f6b', backgroundColor: '#16233a', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="Paintbrush" size={15} color="#a8b6c8" />
            </Box>
          </Pressable>
        ) : null}
        <Text fontSize={8} color="#475569" style={{ fontFamily: 'monospace' }}>{brushLabel}</Text>
      </Box>
    </Box>
  );
});

// slotWear's comparator: like matKey but null-tolerant (an unpainted slot).
function matKey2(skin: BuildFaceSkin | null): string {
  return skin === null ? 'none' : matKey(skin);
}
