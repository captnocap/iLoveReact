// FacePainter — the iso build pane's paint-faces panel (req_0478 v1 → req_0483).
//
// A selection is a box in space with 6 faces. N/E/S/W paint each selected
// piece's EXTERIOR-facing major slot on that side (exterior = the front/back
// slot pointing away from the selection's centre, so it works on towers and
// hand-built shells alike), Top paints plate tops, In paints every
// interior-facing slot. Commits pieceSkinSet events — ids stay stable, so the
// selection survives and you paint face after face without re-selecting.
//
// Extracted from IsoAuthor (the "extend = modularize preemptively" ruling) and
// rebuilt around material NAVIGATION: the v1 blind ◀ ▶ cycler becomes grouped,
// previewed material swatches (groups follow the workbench chooser's
// materialFamily contract, with the user's Materialized customs first), plus a
// custom #rrggbb brush, a recently-used row, a visible current-brush readout,
// and a per-face readout of what the selection currently wears.

import { memo, useMemo, useRef, useState } from 'react';
import { Box, Effect, Pressable, ScrollView, Text, TextInput } from '@reactjit/primitives';
import { GAME_BUILD } from '@game';
import type { BuildFaceSkin, BuildFaceSlot, PlacedBuildPiece, WorldEvent } from '@game';
import { allTextures, type TextureDef } from '@game/textures/registry';
import { materialFamily } from '../workbench/materials/chooser';

// ── Face classification: which slot a compass face means on a piece ─────────

export type FaceId = 'N' | 'E' | 'S' | 'W' | 'top' | 'in';

const FACE_BUTTONS: { id: FaceId; label: string; title: string }[] = [
  { id: 'N', label: 'N', title: 'Paint the north-facing exterior' },
  { id: 'E', label: 'E', title: 'Paint the east-facing exterior' },
  { id: 'S', label: 'S', title: 'Paint the south-facing exterior' },
  { id: 'W', label: 'W', title: 'Paint the west-facing exterior' },
  { id: 'top', label: 'Top', title: 'Paint floor/roof plate tops' },
  { id: 'in', label: 'In', title: 'Paint every interior-facing side' },
];

const BRUSH_SWATCHES = [
  '#d8cdb8', '#9aa3ad', '#8a4a3a', '#506a85', '#2d3b4e', '#c8b06a',
  '#7a8b6f', '#e0e5ea', '#1a1d24', '#8a6a45', '#b04a3a', '#3a6b8a',
];

/** front (+v) world direction per quarter yaw — matches localOffset(0,1,yaw) */
function frontDirOf(quarter: number): { dx: number; dz: number } {
  return quarter === 0 ? { dx: 0, dz: 1 } : quarter === 1 ? { dx: 1, dz: 0 } : quarter === 2 ? { dx: 0, dz: -1 } : { dx: -1, dz: 0 };
}

/** The slot `face` lands on for this piece given the selection centre (cx,cz),
 *  or null when the piece has no such face (a plate has no N wall, a free-yaw
 *  wall has no cardinal face). Plates: front=top / back=bottom by skin contract. */
export function faceSlotOf(piece: PlacedBuildPiece, face: FaceId, cx: number, cz: number): BuildFaceSlot | null {
  const kind = GAME_BUILD.catalog.get(piece.pieceId).kind;
  const plate = kind === 'floor' || kind === 'roof' || kind === 'ramp' || kind === 'stairs';
  if (plate) return face === 'top' ? 'front' : face === 'in' ? 'back' : null;
  if (face === 'top') return null;
  const yaw = ((piece.yawDegrees % 360) + 360) % 360;
  const quarter = Math.round(yaw / 90) % 4;
  if (Math.abs(yaw - quarter * 90) > 1e-6 && Math.abs(yaw - 360) > 1e-6) return null; // free-yaw: no cardinal face
  const front = frontDirOf(quarter);
  const outward = front.dx * (piece.x - cx) + front.dz * (piece.z - cz) >= 0; // front faces away from the centre?
  if (face === 'in') return outward ? 'back' : 'front';
  const ext = outward ? front : { dx: -front.dx, dz: -front.dz };
  const onFace = face === 'N' ? ext.dz > 0.5 : face === 'S' ? ext.dz < -0.5 : face === 'E' ? ext.dx > 0.5 : ext.dx < -0.5;
  return onFace ? (outward ? 'front' : 'back') : null;
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

const MatSwatch = memo(function MatSwatch(props: { def: TextureDef; active: boolean; onPick: (id: string) => void }) {
  const { def } = props;
  const short = def.label.length > 11 ? `${def.label.slice(0, 10)}…` : def.label;
  return (
    <Pressable onPress={() => props.onPick(def.id)} hoverable tooltip={def.label}>
      <Box style={{ width: 66, gap: 2 }}>
        <Box style={{ width: 66, height: 38, borderRadius: 4, borderWidth: props.active ? 2 : 1, borderColor: props.active ? '#7dd3fc' : '#3a4f6b', backgroundColor: '#0f1a2e', overflow: 'hidden' }}>
          {def.source.kind === 'shader'
            ? <Effect shader={def.source.shader} data={def.source.data} style={SWATCH_FILL} />
            : def.source.render(SWATCH_CTX)}
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
  const brushRef = useRef(brush);
  brushRef.current = brush;
  // The last few brushes actually painted with — one click back to a mix you were using.
  const [recent, setRecent] = useState<BuildFaceSkin[]>([]);
  // Custom color draft: any valid #rrggbb becomes the brush as you type.
  const [hexDraft, setHexDraft] = useState('');
  const hexValid = /^#[0-9a-fA-F]{6}$/.test(hexDraft);

  // Registry materials (built-in + Materialized customs; read at mount — a
  // material stored mid-session appears after the next reload), grouped for
  // navigation. Only the open group's swatch previews mount.
  const materials = useMemo(() => allTextures(), []);
  const materialById = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const groups = useMemo(() => materialGroups(materials), [materials]);
  const [openGroupName, setOpenGroupName] = useState<string | null>(null);
  const openGroup = groups.find((g) => g.name === openGroupName) ?? groups[0] ?? null;

  // The selection's centroid — exterior/interior is judged against it.
  const centroid = useMemo(() => {
    let cx = 0, cz = 0;
    for (const p of selPieces) { cx += p.x; cz += p.z; }
    const n = Math.max(1, selPieces.length);
    return { cx: cx / n, cz: cz / n };
  }, [selPieces]);

  // What each face currently WEARS across the selection: nothing, one skin, or a
  // mix — surfaced as a dot on each face button so painted state is visible.
  const faceWear = useMemo(() => {
    const wear: Partial<Record<FaceId, BuildFaceSkin | 'mixed' | null>> = {};
    for (const f of FACE_BUTTONS) {
      let seen: BuildFaceSkin | null | undefined; // undefined = none yet
      let mixed = false;
      for (const p of selPieces) {
        const slot = faceSlotOf(p, f.id, centroid.cx, centroid.cz);
        if (!slot) continue;
        const s = (p.skin as Partial<Record<BuildFaceSlot, BuildFaceSkin>> | undefined)?.[slot] ?? null;
        if (seen === undefined) seen = s;
        else if (matKey2(seen) !== matKey2(s)) { mixed = true; break; }
      }
      wear[f.id] = mixed ? 'mixed' : seen ?? null;
    }
    return wear as Record<FaceId, BuildFaceSkin | 'mixed' | null>;
  }, [selPieces, centroid]);

  const pushRecent = (b: BuildFaceSkin) => {
    setRecent((list) => [b, ...list.filter((x) => matKey(x) !== matKey(b))].slice(0, 8));
  };

  // Apply the brush to one compass face of the selection — one pieceSkinSet per
  // classified piece, one batch (one undo step). Ids stay stable.
  const paintFace = (face: FaceId) => {
    const sel = selRef.current;
    if (!sel.length) return;
    let cx = 0, cz = 0;
    for (const p of sel) { cx += p.x; cz += p.z; }
    cx /= sel.length; cz /= sel.length;
    const b = brushRef.current;
    const items: { event: WorldEvent; label: string }[] = [];
    for (const p of sel) {
      const slot = faceSlotOf(p, face, cx, cz);
      if (!slot) continue;
      items.push({ event: { kind: 'pieceSkinSet', id: p.id, skin: { [slot]: b } } as WorldEvent, label: `painted ${face} face` });
    }
    if (items.length) { commitRef.current(items); pushRecent(b); }
  };

  const pickMaterial = (id: string) => setBrush({ kind: 'material', id });

  const brushLabel = brush.kind === 'color' ? brush.value : (materialById.get(brush.id)?.label ?? brush.id);

  return (
    <Box style={{ position: 'absolute', right: 8, top: 36, backgroundColor: '#0b1220fa', borderWidth: 1, borderColor: '#1e3a5f', borderRadius: 6, padding: 8, gap: 6, width: 248 }}>
      <Text fontSize={9} color="#7dd3fc" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
        {`PAINT FACES — ${selPieces.length} piece${selPieces.length === 1 ? '' : 's'} · click a side`}
      </Text>

      {/* faces: big targets, each with a dot of what that face currently wears */}
      <Box style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
        {FACE_BUTTONS.map((f) => {
          const wear = faceWear[f.id];
          const dot = wear === 'mixed'
            ? { backgroundColor: '#475569', borderColor: '#94a3b8' }
            : wear === null
              ? { backgroundColor: '#0b1220', borderColor: '#2a3a52' }
              : wear.kind === 'color'
                ? { backgroundColor: wear.value, borderColor: '#3a4f6b' }
                : { backgroundColor: '#ffffff', borderColor: '#7dd3fc' };
          const wearName = wear === 'mixed' ? 'mixed' : wear === null ? 'unpainted' : wear.kind === 'color' ? wear.value : (materialById.get(wear.id)?.label ?? wear.id);
          return (
            <Pressable key={f.id} onPress={() => paintFace(f.id)} hoverable tooltip={`${f.title} · now: ${wearName}`}>
              <Box style={{ width: 73, paddingTop: 5, paddingBottom: 5, borderRadius: 4, borderWidth: 1, borderColor: '#3a4f6b', backgroundColor: '#16233a', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                <Text fontSize={11} color="#dbe6f3" style={{ fontFamily: 'monospace' }}>{f.label}</Text>
                <Box style={{ width: 9, height: 9, borderRadius: 5, borderWidth: 1, ...dot }} />
              </Box>
            </Pressable>
          );
        })}
      </Box>

      {/* the current brush — always visible, so you know what a face click drops */}
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

      {/* recently painted-with brushes — one click back */}
      {recent.length > 0 ? (
        <Box style={{ flexDirection: 'row', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace' }}>RECENT</Text>
          {recent.map((b) => (
            <Pressable key={matKey(b)} onPress={() => setBrush(b)} hoverable tooltip={b.kind === 'color' ? b.value : (materialById.get(b.id)?.label ?? b.id)}>
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

      {/* colors: the fixed swatches + any #rrggbb you type */}
      <Box style={{ flexDirection: 'row', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        {BRUSH_SWATCHES.map((c) => (
          <Pressable key={c} onPress={() => setBrush({ kind: 'color', value: c })}>
            <Box style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: c, borderWidth: brush.kind === 'color' && brush.value === c ? 2 : 1, borderColor: brush.kind === 'color' && brush.value === c ? '#7dd3fc' : '#3a4f6b' }} />
          </Pressable>
        ))}
        <TextInput
          text={hexDraft}
          placeholder="#rrggbb"
          onChangeText={(v: string) => { setHexDraft(v); if (/^#[0-9a-fA-F]{6}$/.test(v)) setBrush({ kind: 'color', value: v }); }}
          style={{ width: 66, backgroundColor: '#0f1a2e', borderWidth: 1, borderColor: hexDraft.length === 0 ? '#27364a' : hexValid ? '#34d399' : '#b04a3a', borderRadius: 3, paddingLeft: 5, paddingRight: 5, paddingTop: 2, paddingBottom: 2, color: '#e2e8f0', fontSize: 9, fontFamily: 'monospace' }}
        />
      </Box>

      {/* materials: grouped accordion — open a group, see its swatches */}
      {groups.length > 0 ? (
        <Box style={{ gap: 4 }}>
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
            <ScrollView style={{ height: 150 }}>
              <Box style={{ flexDirection: 'row', gap: 5, flexWrap: 'wrap' }}>
                {openGroup.items.map((def) => (
                  <MatSwatch key={def.id} def={def} active={brush.kind === 'material' && brush.id === def.id} onPick={pickMaterial} />
                ))}
              </Box>
            </ScrollView>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
});

// faceWear's comparator: like matKey but null-tolerant (an unpainted slot).
function matKey2(skin: BuildFaceSkin | null): string {
  return skin === null ? 'none' : matKey(skin);
}
