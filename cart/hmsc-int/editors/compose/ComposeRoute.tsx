// editors/compose/ComposeRoute — /compose: THE DECAL EDITOR (DECALEDIT-0606).
//
// The locked vocabulary's decal source finally gets an authoring surface: a
// look composed from Box/Text/Image and baked to a texture — what building
// facades and street signs always were, except hand-coded. The user's ask:
// "whatever approach will let me make billboards and shit like that easily",
// font-ready for the graffiti work later (text nodes carry fontFamily NOW;
// new faces are a host-side family addition, never a schema change).
//
//   ┌────────────────────────────── toolbar: name · canvas · add · MATERIALIZE
//   ├────────┬───────────────────┬──────────┐
//   │ saved  │   the STAGE       │ LAYERS   │   stage = the doc at fit scale,
//   │ decals │   (drag to move,  │ ─────    │   drag rides the host cursor
//   │ rail   │   click selects)  │ PROPS    │   channel (the QuadSplit wire)
//   │        ├───────────────────┤          │
//   │        │  3D billboard     │          │   live mesh sampling the live
//   └────────┴───────────────────┴──────────┘   StaticSurface — edit re-bakes
//
// Materialize = saveDecalTexture (the doc RIDES the stored material, so a
// saved decal reopens lossless — the re-edit law) + ONE labeled commit on the
// materials channel (the AUTOSAVE-0605 pattern /textures set). The decal
// joins allTextures immediately — assignable everywhere a texture is; the V24
// piece-face and voxel-item slots land on the same registry.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Col, Pressable, Row, Scene3D, ScrollView, StaticSurface, Text, TextInput } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { busOn } from '@reactjit/hooks/useIFTTT';
import { GAME_CHROME } from '@game';
import {
  DECAL_SIZE_PRESETS, emptyDecalDoc, validateDecalDoc,
  type DecalAlign, type DecalDoc, type DecalNode,
} from '../../game/textures/decal';
import { DecalSurface } from '../../game/textures/decalRender';
import { removeCustomTexture, saveDecalTexture, useCustomTextures } from '../../game/textures/materials';
import { accentFor } from '../../studio.cls';
import { editorChannel } from '../store';
import { editorSessions, type RouteSession } from '../sessions';
import { materialsStream, type MaterialsEvent } from '../materials/stream';
import { readRouteTwigState, writeRouteTwigState, useRouteTwigState } from '../twigs';

// ── route feel data (P2: named values) ───────────────────────────────────────
const COMPOSE_UI = {
  stagePad: 28,
  /** working-doc autosave debounce — drags write state per cursor event; the
   *  twig file only after the hand settles */
  draftDebounceMs: 500,
  maxStageScale: 1.6,
  /** the 3D preview billboard's width in meters (height follows the doc ratio) */
  billboardMeters: 5,
  swatchW: 116,
  swatchH: 58,
} as const;

/** Host-mapped family names (v8_app.zig fontFamilyIdFor) — 'default' clears.
 *  A graffiti face later = a new name here + a host face, zero schema work. */
const FONT_FAMILIES = ['default', 'sans-serif', 'serif', 'monospace', 'noto', 'arial', 'inter', 'roboto'];
const FONT_WEIGHTS = [400, 600, 700, 800, 900];
const PALETTE = ['#f8fafc', '#0b1320', '#111827', '#dc2626', '#ea580c', '#f59e0b', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777', '#a16207'];

let nodeSeq = 0;
function mintNodeId(kind: string): string {
  nodeSeq += 1;
  return `${kind}-${Date.now().toString(36)}-${nodeSeq}`;
}

// ── chrome atoms (the studio.cls token family) ───────────────────────────────

function Chip(props: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 5, borderWidth: 1, borderColor: props.on ? accentFor('primary') : accentFor('border'), backgroundColor: props.on ? accentFor('bgElevated') : accentFor('bgAlt') }}>
      <Text fontSize={10} color={props.on ? accentFor('text') : accentFor('textDim')} style={{ fontWeight: 700 }}>{props.label}</Text>
    </Pressable>
  );
}

function PanelTitle(props: { title: string }) {
  return (
    <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', fontWeight: 800, letterSpacing: 1, paddingLeft: 10, paddingTop: 8, paddingBottom: 4 }}>{props.title}</Text>
  );
}

/** Small labelled number field — live-applies any finite parse. */
function NumField(props: { label: string; value: number; onChange: (n: number) => void; width?: number }) {
  return (
    <Row style={{ alignItems: 'center', gap: 5 }}>
      <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', width: 12 }}>{props.label}</Text>
      <TextInput
        value={String(Math.round(props.value * 100) / 100)}
        onChangeText={(t: string) => {
          if (t.trim() === '') return; // mid-edit clear must not snap to 0
          const n = Number(t);
          if (Number.isFinite(n)) props.onChange(n);
        }}
        style={{ width: props.width ?? 52, backgroundColor: accentFor('bg'), borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 4, color: accentFor('text'), fontSize: 11, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3 }}
      />
    </Row>
  );
}

function ColorField(props: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <Col style={{ gap: 4 }}>
      <Row style={{ alignItems: 'center', gap: 6 }}>
        <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', width: 44 }}>{props.label}</Text>
        <Box style={{ width: 16, height: 16, borderRadius: 3, borderWidth: 1, borderColor: accentFor('border'), backgroundColor: props.value || '#00000000' }} />
        <TextInput
          value={props.value}
          onChangeText={props.onChange}
          placeholder="#rrggbb ('' = none)"
          style={{ flexGrow: 1, backgroundColor: accentFor('bg'), borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 4, color: accentFor('text'), fontSize: 11, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3 }}
        />
      </Row>
      <Row style={{ gap: 3, flexWrap: 'wrap' }}>
        {PALETTE.map((c) => (
          <Pressable key={c} onPress={() => props.onChange(c)} style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: c, borderWidth: 1, borderColor: props.value === c ? accentFor('primary') : accentFor('border') }} />
        ))}
      </Row>
    </Col>
  );
}

// ── the route ────────────────────────────────────────────────────────────────

export function ComposeRoute() {
  // The working doc: STATE while editing (drags update per cursor event), the
  // '/compose' twig only debounced — a drag must never storm the twig file.
  const [doc, setDoc] = useState<DecalDoc>(() => validateDecalDoc(readRouteTwigState('/compose', 'doc', null as any)) ?? emptyDecalDoc());
  const [selId, setSelId] = useState<string | null>(null);
  // The material id being re-edited (null = composing a new decal). Twig so a
  // hot reload mid-edit keeps Materialize updating the SAME stored decal.
  const [editingId, setEditingId] = useRouteTwigState<string | null>('/compose', 'editingId', null);
  const [name, setName] = useRouteTwigState('/compose', 'name', '');
  const [show3d, setShow3d] = useRouteTwigState('/compose', 'show3d', true);
  const docRef = useRef(doc);
  docRef.current = doc;
  useEffect(() => {
    const t = setTimeout(() => writeRouteTwigState('/compose', 'doc', docRef.current), COMPOSE_UI.draftDebounceMs);
    return () => clearTimeout(t);
  }, [doc]);

  // ── the V20 channel + this visit's session (the /textures pattern) ────────
  const live = useMemo(() => {
    try {
      const channel = editorChannel(materialsStream);
      return { channel, session: editorSessions().open('/compose', channel) as RouteSession<MaterialsEvent>, error: null as string | null };
    } catch (e) {
      return { channel: null, session: null, error: String(e) };
    }
  }, []);
  useEffect(() => () => live.session?.close(), [live]);

  const customs = useCustomTextures();
  const savedDecals = useMemo(() => customs.filter((t) => t.decal), [customs]);

  const selected = doc.nodes.find((n) => n.id === selId) ?? null;

  const patchDoc = (patch: Partial<DecalDoc>) => setDoc((d) => ({ ...d, ...patch }));
  const patchNode = (id: string, patch: Partial<DecalNode>) =>
    setDoc((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as DecalNode) : n)) }));

  const addNode = (node: DecalNode) => {
    setDoc((d) => ({ ...d, nodes: [...d.nodes, node] }));
    setSelId(node.id);
  };
  const addRect = () => addNode({ id: mintNodeId('rect'), kind: 'rect', x: doc.width / 4, y: doc.height / 4, w: doc.width / 2, h: doc.height / 2, bg: '#2563eb', borderRadius: 8 });
  const addText = () => addNode({ id: mintNodeId('text'), kind: 'text', x: doc.width / 8, y: doc.height / 3, w: (doc.width * 3) / 4, h: doc.height / 3, text: 'BILLBOARD', color: '#f8fafc', fontSize: Math.round(doc.height / 4), fontWeight: 800, align: 'center' });
  const addImage = () => addNode({ id: mintNodeId('image'), kind: 'image', x: doc.width / 4, y: doc.height / 4, w: doc.width / 2, h: doc.height / 2, src: '' });

  const removeNode = (id: string) => {
    setDoc((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== id) }));
    setSelId((s) => (s === id ? null : s));
  };
  const duplicateNode = (id: string) => {
    const src = docRef.current.nodes.find((n) => n.id === id);
    if (!src) return;
    addNode({ ...src, id: mintNodeId(src.kind), x: src.x + 16, y: src.y + 16 } as DecalNode);
  };
  /** paint-order move: +1 = toward the front (later in the array) */
  const reorderNode = (id: string, dir: 1 | -1) => {
    setDoc((d) => {
      const i = d.nodes.findIndex((n) => n.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.nodes.length) return d;
      const nodes = [...d.nodes];
      [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
      return { ...d, nodes };
    });
  };

  // ── stage: fit scale + cursor-channel drag (the QuadSplit wire — no
  //    per-node capture gaps; mouse-up anywhere ends the gesture) ────────────
  const [stageBox, setStageBox] = useState({ w: 1, h: 1 });
  const scale = Math.min(
    COMPOSE_UI.maxStageScale,
    (stageBox.w - COMPOSE_UI.stagePad * 2) / doc.width,
    (stageBox.h - COMPOSE_UI.stagePad * 2) / doc.height,
  );
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const dragRef = useRef<string | null>(null);
  useEffect(() => busOn('system:cursor:move', (e: any) => {
    const id = dragRef.current;
    if (!id) return;
    const s = scaleRef.current || 1;
    const dx = Number(e?.dx ?? 0) / s;
    const dy = Number(e?.dy ?? 0) / s;
    if (dx === 0 && dy === 0) return;
    const node = docRef.current.nodes.find((n) => n.id === id);
    if (node) patchNode(id, { x: node.x + dx, y: node.y + dy });
  }), []);
  const endDrag = () => { dragRef.current = null; };

  // ── Materialize: the doc rides the material; one labeled commit ───────────
  const materialize = () => {
    const label = name.trim() || 'decal';
    const saved = saveDecalTexture(label, docRef.current, editingId ?? undefined);
    if (!saved) return;
    live.session?.commit(
      { kind: 'materialized', material: { id: saved.id, label: saved.label, decal: saved.decal } },
      `materialized · ${saved.label} (decal)`,
    );
    setEditingId(saved.id);
    setName(saved.label);
  };
  const openDecal = (id: string) => {
    const record = savedDecals.find((t) => t.id === id);
    const opened = record?.decal ? validateDecalDoc(JSON.parse(JSON.stringify(record.decal))) : null;
    if (!record || !opened) return;
    setDoc(opened);
    setName(record.label);
    setEditingId(record.id);
    setSelId(null);
  };
  const deleteDecal = (id: string) => {
    removeCustomTexture(id);
    live.session?.commit({ kind: 'removed', id }, `${id}: deleted`);
    if (editingId === id) setEditingId(null);
  };
  const newDecal = () => {
    setDoc(emptyDecalDoc(doc.width, doc.height));
    setName('');
    setEditingId(null);
    setSelId(null);
  };

  const stageW = doc.width * scale;
  const stageH = doc.height * scale;
  const billboardH = (COMPOSE_UI.billboardMeters * doc.height) / doc.width;

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, flexDirection: 'column', backgroundColor: accentFor('bg') }} onMouseUp={endDrag}>
      {/* toolbar */}
      <Row style={{ height: 38, flexShrink: 0, alignItems: 'center', gap: 8, paddingLeft: 10, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: accentFor('border'), backgroundColor: accentFor('bgAlt') }}>
        <Text fontSize={10} color={accentFor('textDim')} style={{ fontFamily: 'monospace', fontWeight: 800, letterSpacing: 1 }}>DECALS</Text>
        <TextInput value={name} onChangeText={setName} placeholder="decal name…" style={{ width: 170, backgroundColor: accentFor('bg'), borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 4, color: accentFor('text'), fontSize: 11, paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }} />
        {editingId && <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>{`editing ${editingId}`}</Text>}
        <Box style={{ width: 1, height: 18, backgroundColor: accentFor('border') }} />
        {DECAL_SIZE_PRESETS.map((p) => (
          <Chip key={p.label} label={`${p.width}×${p.height}`} on={doc.width === p.width && doc.height === p.height} onPress={() => patchDoc({ width: p.width, height: p.height })} />
        ))}
        <Box style={{ flexGrow: 1 }} />
        <Chip label="+ rect" onPress={addRect} />
        <Chip label="+ text" onPress={addText} />
        <Chip label="+ image" onPress={addImage} />
        <Chip label="3D" on={show3d} onPress={() => setShow3d((s) => !s)} />
        <Pressable onPress={materialize} style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 5, paddingBottom: 5, borderRadius: 6, borderWidth: 1, borderColor: '#3f6f4a', backgroundColor: '#13351f' }}>
          <Text fontSize={11} color="#bbf7d0" style={{ fontWeight: 700 }}>{editingId ? 'Materialize (update)' : 'Materialize'}</Text>
        </Pressable>
      </Row>

      <Row style={{ flexGrow: 1, minHeight: 0 }}>
        {/* saved decals rail */}
        <Box style={{ width: 150, height: '100%', borderRightWidth: 1, borderRightColor: accentFor('border'), backgroundColor: accentFor('bgAlt') }}>
          <PanelTitle title={`SAVED DECALS · ${savedDecals.length}`} />
          <Box style={{ paddingLeft: 10, paddingBottom: 4 }}>
            <Chip label="+ new decal" onPress={newDecal} />
          </Box>
          <ScrollView style={{ flexGrow: 1 }} contentContainerStyle={{ padding: 8, gap: 8 }}>
            {savedDecals.length === 0 ? (
              <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>compose, then Materialize →</Text>
            ) : savedDecals.map((t) => (
              <Col key={t.id} style={{ gap: 3 }}>
                <Pressable onPress={() => openDecal(t.id)} style={{ width: COMPOSE_UI.swatchW, height: COMPOSE_UI.swatchH, borderRadius: 4, borderWidth: 1, borderColor: editingId === t.id ? accentFor('primary') : accentFor('border'), overflow: 'hidden' }}>
                  {t.decal ? <DecalSurface doc={t.decal} width={COMPOSE_UI.swatchW} height={COMPOSE_UI.swatchH} /> : null}
                </Pressable>
                <Row style={{ alignItems: 'center', gap: 4 }}>
                  <Text fontSize={8} color={accentFor('text')} style={{ fontFamily: 'monospace', flexGrow: 1 }} numberOfLines={1}>{t.label}</Text>
                  <Pressable onPress={() => deleteDecal(t.id)}>
                    <Text fontSize={8} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>del</Text>
                  </Pressable>
                </Row>
              </Col>
            ))}
          </ScrollView>
        </Box>

        {/* stage column */}
        <Col style={{ flexGrow: 1, minWidth: 0 }}>
          <Box
            onLayout={(lr: any) => {
              const w = Math.max(1, Number(lr?.width ?? 1));
              const h = Math.max(1, Number(lr?.height ?? 1));
              setStageBox((p) => (p.w === w && p.h === h ? p : { w, h }));
            }}
            style={{ flexGrow: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center' }}
          >
            {/* click-away deselect under the doc */}
            <Pressable onPress={() => setSelId(null)} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }} />
            <Box style={{ width: stageW, height: stageH, borderWidth: 1, borderColor: accentFor('border') }}>
              <DecalSurface doc={doc} width={stageW} height={stageH} />
              {/* hit/selection overlay — one rect per node, scaled; front-most
                  last so overlapping nodes pick like they paint */}
              <Box style={{ position: 'absolute', left: 0, top: 0, width: stageW, height: stageH }}>
                {doc.nodes.map((n) => (
                  <Pressable
                    key={n.id}
                    onMouseDown={() => { setSelId(n.id); dragRef.current = n.id; }}
                    onMouseUp={endDrag}
                    style={{
                      position: 'absolute',
                      left: n.x * scale,
                      top: n.y * scale,
                      width: Math.max(6, n.w * scale),
                      height: Math.max(6, n.h * scale),
                      backgroundColor: '#00000001',
                      borderWidth: selId === n.id ? 1 : 0,
                      borderColor: accentFor('primary'),
                    }}
                  />
                ))}
              </Box>
            </Box>
            <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', marginTop: 6 }}>
              {`${doc.width}×${doc.height} · drag to move · click to select`}
            </Text>
          </Box>

          {/* the live 3D billboard — proof on a mesh face: the mesh samples
              the live StaticSurface; edits mutate the captured subtree, so the
              engine re-bakes it (subtree_last_mutated_frame invalidation) */}
          {show3d && (
            <Box style={{ height: 220, flexShrink: 0, borderTopWidth: 1, borderTopColor: accentFor('border') }}>
              <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0a0f18" showGrid={false} showAxes={false}>
                <Scene3D.Camera position={[0, 2.2, 7.5]} target={[0, 1.8, 0]} fov={42} />
                <Scene3D.Fog enabled={false} />
                <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[7, 0.2, 4]} position={[0, -0.1, 0]} material="#1f2937" />
                <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.18, 3.4, 0.18]} position={[0, 1.6, 0]} material="#475569" />
                <Scene3D.Mesh
                  geometry={Geometry.Box}
                  params={{ width: 1, height: 1, depth: 1, texturedFaces: ['front', 'back'] }}
                  scale={[COMPOSE_UI.billboardMeters, billboardH, 0.12]}
                  position={[0, 2 + billboardH / 2, 0]}
                  material="#ffffff"
                  textureKey="compose:live"
                />
              </Scene3D>
            </Box>
          )}
        </Col>

        {/* layers + properties */}
        <Box style={{ width: 252, height: '100%', borderLeftWidth: 1, borderLeftColor: accentFor('border'), backgroundColor: accentFor('bgAlt') }}>
          <PanelTitle title={`LAYERS · ${doc.nodes.length}`} />
          <ScrollView style={{ maxHeight: 180 }} contentContainerStyle={{ paddingLeft: 8, paddingRight: 8, gap: 2 }}>
            {[...doc.nodes].reverse().map((n) => (
              <Row key={n.id} style={{ alignItems: 'center', gap: 4 }}>
                <Pressable onPress={() => setSelId(n.id)} style={{ flexGrow: 1, paddingLeft: 6, paddingRight: 6, paddingTop: 4, paddingBottom: 4, borderRadius: 4, backgroundColor: selId === n.id ? accentFor('bgElevated') : 'transparent', borderLeftWidth: 2, borderLeftColor: selId === n.id ? accentFor('primary') : '#00000000' }}>
                  <Text fontSize={10} color={selId === n.id ? accentFor('text') : accentFor('textDim')} style={{ fontFamily: 'monospace' }} numberOfLines={1}>
                    {n.kind === 'text' ? `T ${n.text.slice(0, 16)}` : n.kind === 'image' ? `I ${n.src.split('/').pop() || 'image'}` : 'R rect'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => reorderNode(n.id, 1)}><Text fontSize={9} color={accentFor('textFaint')}>▲</Text></Pressable>
                <Pressable onPress={() => reorderNode(n.id, -1)}><Text fontSize={9} color={accentFor('textFaint')}>▼</Text></Pressable>
                <Pressable onPress={() => duplicateNode(n.id)}><Text fontSize={9} color={accentFor('textFaint')}>⧉</Text></Pressable>
                <Pressable onPress={() => removeNode(n.id)}><Text fontSize={9} color="#b45757">✕</Text></Pressable>
              </Row>
            ))}
          </ScrollView>

          <PanelTitle title={selected ? `${selected.kind.toUpperCase()} PROPERTIES` : 'CANVAS'} />
          <ScrollView style={{ flexGrow: 1 }} contentContainerStyle={{ paddingLeft: 10, paddingRight: 10, paddingBottom: 12, gap: 8 }}>
            {!selected ? (
              <>
                <Row style={{ gap: 8 }}>
                  <NumField label="W" value={doc.width} onChange={(n) => patchDoc({ width: Math.max(8, Math.round(n)) })} />
                  <NumField label="H" value={doc.height} onChange={(n) => patchDoc({ height: Math.max(8, Math.round(n)) })} />
                </Row>
                <ColorField label="bg" value={doc.bg} onChange={(c) => patchDoc({ bg: c })} />
                <Text fontSize={8} color={accentFor('textFaint')} style={{ fontFamily: 'monospace' }}>empty bg = transparent (the decal floats)</Text>
              </>
            ) : (
              <>
                <Row style={{ gap: 8, flexWrap: 'wrap' }}>
                  <NumField label="x" value={selected.x} onChange={(n) => patchNode(selected.id, { x: n })} />
                  <NumField label="y" value={selected.y} onChange={(n) => patchNode(selected.id, { y: n })} />
                  <NumField label="w" value={selected.w} onChange={(n) => patchNode(selected.id, { w: Math.max(1, n) })} />
                  <NumField label="h" value={selected.h} onChange={(n) => patchNode(selected.id, { h: Math.max(1, n) })} />
                </Row>
                <GAME_CHROME.Knob label="opacity" value={selected.opacity ?? 1} spec={{ min: 0.05, max: 1, step: 0.05, precision: 2 }} onChange={(v: number) => patchNode(selected.id, { opacity: v })} />
                {selected.kind === 'rect' && (
                  <>
                    <ColorField label="fill" value={selected.bg} onChange={(c) => patchNode(selected.id, { bg: c })} />
                    <GAME_CHROME.Knob label="radius" value={selected.borderRadius ?? 0} spec={{ min: 0, max: 128, step: 1, precision: 0 }} onChange={(v: number) => patchNode(selected.id, { borderRadius: v })} />
                    <GAME_CHROME.Knob label="border" value={selected.borderWidth ?? 0} spec={{ min: 0, max: 32, step: 1, precision: 0 }} onChange={(v: number) => patchNode(selected.id, { borderWidth: v })} />
                    <ColorField label="b.color" value={selected.borderColor ?? ''} onChange={(c) => patchNode(selected.id, { borderColor: c })} />
                  </>
                )}
                {selected.kind === 'text' && (
                  <>
                    <TextInput value={selected.text} onChangeText={(t: string) => patchNode(selected.id, { text: t })} placeholder="text…" style={{ backgroundColor: accentFor('bg'), borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 4, color: accentFor('text'), fontSize: 12, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5 }} />
                    <ColorField label="color" value={selected.color} onChange={(c) => patchNode(selected.id, { color: c })} />
                    <GAME_CHROME.Knob label="size" value={selected.fontSize} spec={{ min: 6, max: 320, step: 1, precision: 0 }} onChange={(v: number) => patchNode(selected.id, { fontSize: v })} />
                    <GAME_CHROME.Knob label="tracking" value={selected.letterSpacing ?? 0} spec={{ min: -4, max: 32, step: 0.5, precision: 1 }} onChange={(v: number) => patchNode(selected.id, { letterSpacing: v })} />
                    <Row style={{ gap: 3, flexWrap: 'wrap' }}>
                      {FONT_WEIGHTS.map((w) => (
                        <Chip key={w} label={String(w)} on={(selected.fontWeight ?? 400) === w} onPress={() => patchNode(selected.id, { fontWeight: w })} />
                      ))}
                    </Row>
                    {/* the font surface — graffiti faces join this list later */}
                    <Row style={{ gap: 3, flexWrap: 'wrap' }}>
                      {FONT_FAMILIES.map((f) => (
                        <Chip key={f} label={f} on={(selected.fontFamily ?? 'default') === f} onPress={() => patchNode(selected.id, { fontFamily: f === 'default' ? undefined : f })} />
                      ))}
                    </Row>
                    <Row style={{ gap: 3 }}>
                      {(['left', 'center', 'right'] as DecalAlign[]).map((a) => (
                        <Chip key={a} label={a} on={(selected.align ?? 'left') === a} onPress={() => patchNode(selected.id, { align: a })} />
                      ))}
                    </Row>
                  </>
                )}
                {selected.kind === 'image' && (
                  <TextInput value={selected.src} onChangeText={(t: string) => patchNode(selected.id, { src: t })} placeholder="path/to/image.png" style={{ backgroundColor: accentFor('bg'), borderWidth: 1, borderColor: accentFor('controlBorder'), borderRadius: 4, color: accentFor('text'), fontSize: 11, paddingLeft: 8, paddingRight: 8, paddingTop: 5, paddingBottom: 5 }} />
                )}
              </>
            )}
            {live.error != null && (
              <Text fontSize={9} color="#fca5a5" style={{ fontFamily: 'monospace' }}>{`persistence host missing — commits disabled (${live.error})`}</Text>
            )}
          </ScrollView>
        </Box>
      </Row>

      {/* the live capture the 3D billboard samples — offscreen, doc-native px;
          memo'd content identity is the doc itself, so an edit (new doc
          identity) re-bakes and an idle frame doesn't (the inline-prop trap) */}
      {show3d && (
        <StaticSurface staticKey="compose:live" style={{ position: 'absolute', left: -99999, top: 0, width: doc.width, height: doc.height }}>
          <DecalSurface doc={doc} />
        </StaticSurface>
      )}
    </Box>
  );
}
