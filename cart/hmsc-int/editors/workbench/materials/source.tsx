// editors/workbench/materials/source.tsx -- MATERIAL WorkbenchSource
// (WBSTEP7-0606). The source fronts the existing texture pipeline and decal
// composer without touching the legacy /textures or /compose routes.

import { useEffect, useRef, useState } from 'react';
import { Box, Col, Effect, Pressable, Row, Scene3D, ScrollView, StaticSurface, Text } from '@reactjit/primitives';
import * as Geometry from '@reactjit/geometries';
import { busOn } from '@reactjit/hooks/useIFTTT';
import type { WorkbenchSource } from '../../../shell/Workbench';
import { TexturePreview } from '../../../TexturePreview';
import { DecalSurface } from '../../../game/textures/decalRender';
import type { DecalNode } from '../../../game/textures/decal';
import { TEXTURE_REGISTRY, textureById } from '../../../game/textures/registry';
import { HMSC_SHADERS, defaultShaderData } from '../../../game/textures/shaders';
import { loadCustomTextures, removeCustomTexture, saveCustomTexture, saveDecalTexture } from '../../../game/textures/materials';
import { accentFor } from '../../../studio.cls';
import { editorChannel } from '../../store';
import { editorSessions, type RouteSession } from '../../sessions';
import { materialsStream, type MaterialsEvent } from '../../materials/stream';
import { readRouteTwigState, writeRouteTwigState } from '../../twigs';
import { pickImageFile } from '../../cutout/sources';
import { LayerStackStrip, type LayerStripAction } from '../../paint/LayerStrip';
import {
  createMaterialStore,
  type ComposeResizeHandle,
  type MaterialLens,
  type MaterialStore,
  type MaterialSubject,
  type MaterialTwigAdapter,
} from './store';

const COMPOSE_STAGE = {
  pad: 28,
  maxScale: 1.6,
  billboardMeters: 5,
} as const;

type ComposeDrag =
  | { kind: 'move'; id: string }
  | { kind: 'resize'; id: string; handle: ComposeResizeHandle };

const COMPOSE_RESIZE_HANDLES: { id: ComposeResizeHandle; x: 0 | 0.5 | 1; y: 0 | 0.5 | 1 }[] = [
  { id: 'nw', x: 0, y: 0 },
  { id: 'n', x: 0.5, y: 0 },
  { id: 'ne', x: 1, y: 0 },
  { id: 'e', x: 1, y: 0.5 },
  { id: 'se', x: 1, y: 1 },
  { id: 's', x: 0.5, y: 1 },
  { id: 'sw', x: 0, y: 1 },
  { id: 'w', x: 0, y: 0.5 },
];

function composeLayerName(node: DecalNode, index: number): string {
  return node.name ?? `${node.kind} ${index + 1}`;
}

function composeLayerMeta(node: DecalNode): string {
  if (node.kind === 'rect') return node.fillShaderId ? `effect · ${node.fillShaderId}` : 'rect · flat fill';
  if (node.kind === 'text') return `text · ${node.text || 'empty'}`;
  return node.src ? `image · ${node.src.split('/').pop()}` : 'image · no source';
}

function composeLayerPreview(node: DecalNode) {
  const previewNode = { ...node, x: 0, y: 0, hidden: undefined } as DecalNode;
  return (
    <DecalSurface
      doc={{ version: 1, width: Math.max(1, node.w), height: Math.max(1, node.h), bg: '#00000000', nodes: [previewNode] }}
      width={34}
      height={24}
    />
  );
}

let liveStore: MaterialStore | null = null;

function liveTwigAdapter(): MaterialTwigAdapter {
  return {
    read: (route, key, initial) => {
      try { return readRouteTwigState(route, key, initial); } catch { return initial; }
    },
    write: (route, key, value) => {
      try { writeRouteTwigState(route, key, value); } catch { /* twigless host */ }
    },
  };
}

function materialWorkbenchStore(): MaterialStore {
  if (liveStore) return liveStore;
  let session: RouteSession<MaterialsEvent> | null = null;
  try {
    session = editorSessions().open('/workbench', editorChannel(materialsStream)) as RouteSession<MaterialsEvent>;
  } catch {
    session = null;
  }
  liveStore = createMaterialStore({
    recipes: () => HMSC_SHADERS,
    reactTextures: () => TEXTURE_REGISTRY.filter((t) => t.source.kind === 'react').map((t) => ({ id: t.id, label: t.label, kind: 'react' })),
    stored: () => loadCustomTextures(),
    saveShader: (label, shaderId, data) => saveCustomTexture(label, shaderId, data),
    saveDecal: (label, doc, existingId) => saveDecalTexture(label, doc, existingId),
    remove: (id) => removeCustomTexture(id),
    pickImage: () => pickImageFile('Pick decal image'),
    session,
    twig: liveTwigAdapter(),
  });
  return liveStore;
}

export function materialsSource(store?: MaterialStore): WorkbenchSource<MaterialSubject> {
  const s = store ?? materialWorkbenchStore();
  return {
    id: 'materials',
    icon: 'Palette',
    kicker: 'MATERIALS',
    list: () => s.listRows(),
    defaultRow: (rows) => s.defaultRow(rows),
    onPick: (rowId) => s.pick(rowId),
    select: (rowId) => s.select(rowId),
    panel: (subject) => s.panel(subject),
    lenses: (subject) => s.lenses(subject),
    activeLens: () => s.lens,
    onLens: (_subject, id) => s.setLens(id as MaterialLens),
    actions: (subject) => s.actions(subject),
    subscribe: (fn) => s.subscribe(fn),
    stage: (subject, lens) => <MaterialStage subject={subject} lens={lens as MaterialLens} />,
  };
}

function MaterialStage(props: { subject: MaterialSubject; lens: MaterialLens }) {
  if (props.lens === 'shader') return <ShaderLabStage subject={props.subject} />;
  if (props.lens === 'compose') return <ComposeStage store={props.subject.store} />;
  return <PreviewStage subject={props.subject} />;
}

function PreviewStage(props: { subject: MaterialSubject }) {
  const { row, store } = props.subject;
  if (row.kind === 'recipe') {
    const data = row.spec.id === store.currentShader()?.id ? store.currentShaderData() : null;
    return (
      <StageShell caption={`${row.spec.label} · recipe`}>
        <Effect shader={row.spec.shader} data={data ?? defaultShaderData(row.spec)} style={{ width: '100%', height: '100%' }} />
      </StageShell>
    );
  }
  if (row.kind === 'decal') {
    const doc = row.id === 'new' ? store.composeDoc : row.material?.decal;
    return (
      <StageShell caption={`${row.label} · decal`}>
        {doc ? <DecalSurface doc={doc} width={300} height={Math.max(80, Math.round(300 * doc.height / doc.width))} /> : null}
      </StageShell>
    );
  }
  if (row.kind === 'mission') {
    return (
      <StageShell caption={`${row.label} · code`}>
        <DecalSurface doc={row.doc} width={300} height={Math.max(80, Math.round(300 * row.doc.height / row.doc.width))} />
      </StageShell>
    );
  }
  const textureId = row.kind === 'react' ? row.id : row.material.id;
  const def = textureById(textureId);
  if (def) return <TexturePreview def={def} caption={`${def.label} · material`} />;
  return <StageShell caption="missing material"><Text fontSize={12} color={accentFor('textDim')}>unresolved material</Text></StageShell>;
}

function ShaderLabStage(props: { subject: MaterialSubject }) {
  const store = props.subject.store;
  const spec = props.subject.row.kind === 'recipe' ? props.subject.row.spec : store.currentShader();
  const data = store.currentShaderData();
  if (!spec || !data) return <StageShell caption="no shader selected" />;
  return (
    <Row style={{ width: '100%', height: '100%', backgroundColor: accentFor('bg') }}>
      <Col style={{ flexGrow: 1, minWidth: 0, height: '100%', backgroundColor: '#05080f' }}>
        <Box style={{ flexGrow: 1, minHeight: 0, alignItems: 'center', justifyContent: 'center', padding: 12, position: 'relative' }}>
          <Box style={{ width: '100%', height: '100%', borderWidth: 1, borderColor: '#16202f', overflow: 'hidden' }}>
            <Effect shader={spec.shader} data={data} style={{ width: '100%', height: '100%' }} />
          </Box>
          <Text fontSize={8} color="#64748b" style={{ fontFamily: 'monospace', position: 'absolute', left: 16, bottom: 16 }}>{spec.label}</Text>
        </Box>
        <Box style={{ height: 86, borderTopWidth: 1, borderTopColor: '#16202f', backgroundColor: '#0a111d' }}>
          <Text fontSize={9} color="#cbd5e1" style={{ fontWeight: 800, paddingLeft: 10, paddingTop: 6 }}>MATERIAL BANK ({store.bank.length})</Text>
          <ScrollView horizontal style={{ flexGrow: 1 }} contentContainerStyle={{ flexDirection: 'row', gap: 8, padding: 8, alignItems: 'center' }}>
            {store.bank.length === 0 ? (
              <Text fontSize={9} color="#64748b" style={{ fontFamily: 'monospace' }}>Materialize banks the current look here.</Text>
            ) : store.bank.map((m, i) => (
              <Col key={`${m.name}-${i}`} style={{ alignItems: 'center', gap: 3 }}>
                <Box style={{ width: 42, height: 42, borderRadius: 4, borderWidth: 1, borderColor: '#334155', overflow: 'hidden' }}>
                  <Effect shader={spec.shader} data={m.data} style={{ width: '100%', height: '100%' }} />
                </Box>
                <Text fontSize={7} color="#94a3b8" style={{ fontFamily: 'monospace' }}>{m.name}</Text>
              </Col>
            ))}
          </ScrollView>
        </Box>
      </Col>
    </Row>
  );
}

function ComposeStage(props: { store: MaterialStore }) {
  const s = props.store;
  const doc = s.composeDoc;
  const selectedId = s.composeSelectedId;
  const selectedNode = selectedId ? doc.nodes.find((n) => n.id === selectedId) ?? null : null;
  const dragRef = useRef<ComposeDrag | null>(null);
  const scaleRef = useRef(1);
  const [stageBox, setStageBox] = useState({ w: 1, h: 1 });
  const scale = Math.min(
    COMPOSE_STAGE.maxScale,
    (stageBox.w - COMPOSE_STAGE.pad * 2) / doc.width,
    (stageBox.h - COMPOSE_STAGE.pad * 2) / doc.height,
  );
  scaleRef.current = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const stageW = doc.width * scaleRef.current;
  const stageH = doc.height * scaleRef.current;
  const billboardH = (COMPOSE_STAGE.billboardMeters * doc.height) / doc.width;
  const endDrag = () => { dragRef.current = null; };
  const layerRows = doc.nodes.map((n, i) => ({ node: n, index: i })).reverse().map(({ node, index }) => ({
    id: node.id,
    name: composeLayerName(node, index),
    meta: composeLayerMeta(node),
    active: selectedId === node.id,
    muted: !!node.hidden,
    preview: composeLayerPreview(node),
    canMoveUp: index < doc.nodes.length - 1,
    canMoveDown: index > 0,
  }));
  const onLayerAction = (id: string, action: LayerStripAction) => {
    if (action === 'visibility') s.toggleComposeNodeHidden(id);
    else if (action === 'duplicate') s.duplicateComposeNode(id);
    else if (action === 'move-up') s.moveComposeNodeLayer(id, 1);
    else if (action === 'move-down') s.moveComposeNodeLayer(id, -1);
    else if (action === 'delete') s.removeComposeNode(id);
  };

  useEffect(() => busOn('system:cursor:move', (e: any) => {
    const drag = dragRef.current;
    if (!drag) return;
    const scaleNow = scaleRef.current || 1;
    const dx = Number(e?.dx ?? 0) / scaleNow;
    const dy = Number(e?.dy ?? 0) / scaleNow;
    if (dx === 0 && dy === 0) return;
    if (drag.kind === 'move') s.moveComposeNode(drag.id, dx, dy);
    else s.resizeComposeNode(drag.id, drag.handle, dx, dy);
  }), [s]);

  return (
    <Box style={{ width: '100%', height: '100%', flexDirection: 'column', backgroundColor: accentFor('bg') }} onMouseUp={endDrag}>
      <Row style={{ flexGrow: 1, minHeight: 0 }}>
        <Box
          onLayout={(lr: any) => {
            const w = Math.max(1, Number(lr?.width ?? 1));
            const h = Math.max(1, Number(lr?.height ?? 1));
            setStageBox((p) => (p.w === w && p.h === h ? p : { w, h }));
          }}
          style={{ flexGrow: 1, minWidth: 0, minHeight: 0, alignItems: 'center', justifyContent: 'center', position: 'relative' }}
        >
          <Pressable onPress={() => s.selectComposeNode(null)} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: '#00000001' }} />
          <Box style={{ width: stageW, height: stageH, borderWidth: 1, borderColor: accentFor('border') }}>
            <DecalSurface doc={doc} width={stageW} height={stageH} />
            <Box style={{ position: 'absolute', left: 0, top: 0, width: stageW, height: stageH }}>
              {doc.nodes.map((n) => (
                <Pressable
                  key={n.id}
                  onMouseDown={() => { s.selectComposeNode(n.id); dragRef.current = { kind: 'move', id: n.id }; }}
                  onMouseUp={endDrag}
                  style={{
                    position: 'absolute',
                    left: n.x * scaleRef.current,
                    top: n.y * scaleRef.current,
                    width: Math.max(6, n.w * scaleRef.current),
                    height: Math.max(6, n.h * scaleRef.current),
                    backgroundColor: '#00000001',
                    borderWidth: selectedId === n.id ? 1 : 0,
                    borderColor: accentFor('primary'),
                  }}
                />
              ))}
              {selectedNode ? COMPOSE_RESIZE_HANDLES.map((h) => {
                const handleSize = 10;
                const left = (selectedNode.x + selectedNode.w * h.x) * scaleRef.current - handleSize / 2;
                const top = (selectedNode.y + selectedNode.h * h.y) * scaleRef.current - handleSize / 2;
                return (
                  <Pressable
                    key={`resize-${h.id}`}
                    onMouseDown={() => {
                      s.selectComposeNode(selectedNode.id);
                      dragRef.current = { kind: 'resize', id: selectedNode.id, handle: h.id };
                    }}
                    onMouseUp={endDrag}
                    style={{
                      position: 'absolute',
                      left,
                      top,
                      width: handleSize,
                      height: handleSize,
                      borderRadius: 2,
                      borderWidth: 1,
                      borderColor: '#f8fafc',
                      backgroundColor: accentFor('primary'),
                    }}
                  />
                );
              }) : null}
            </Box>
          </Box>
          <Text fontSize={9} color={accentFor('textFaint')} style={{ fontFamily: 'monospace', marginTop: 6 }}>
            {`${doc.width}x${doc.height} · drag to move · handles resize`}
          </Text>
        </Box>
        <Box style={{ width: 330, height: '100%', minHeight: 0, borderLeftWidth: 1, borderLeftColor: accentFor('border'), backgroundColor: '#05080f', padding: 10 }}>
          <LayerStackStrip
            rows={layerRows}
            height="100%"
            emptyText="No layers - add a rect, text, or image."
            onSelect={(id) => s.selectComposeNode(id)}
            onRename={(id, name) => s.renameComposeNode(id, name)}
            onAction={onLayerAction}
          />
        </Box>
      </Row>
      {s.show3d ? (
        <Box style={{ height: 210, flexShrink: 0, borderTopWidth: 1, borderTopColor: accentFor('border') }}>
          <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0a0f18" showGrid={false} showAxes={false}>
            <Scene3D.Camera position={[0, 2.2, 7.5]} target={[0, 1.8, 0]} fov={42} />
            <Scene3D.Fog enabled={false} />
            <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[7, 0.2, 4]} position={[0, -0.1, 0]} material="#1f2937" />
            <Scene3D.Mesh geometry={Geometry.Box} params={{ width: 1, height: 1, depth: 1 }} scale={[0.18, 3.4, 0.18]} position={[0, 1.6, 0]} material="#475569" />
            <Scene3D.Mesh
              geometry={Geometry.Box}
              params={{ width: 1, height: 1, depth: 1, texturedFaces: ['front', 'back'] }}
              scale={[COMPOSE_STAGE.billboardMeters, billboardH, 0.12]}
              position={[0, 2 + billboardH / 2, 0]}
              material="#ffffff"
              textureKey="workbench:materials:compose"
            />
          </Scene3D>
          <StaticSurface staticKey="workbench:materials:compose" style={{ position: 'absolute', left: -99999, top: 0, width: doc.width, height: doc.height }}>
            <DecalSurface doc={doc} />
          </StaticSurface>
        </Box>
      ) : null}
    </Box>
  );
}

function StageShell(props: { caption: string; children?: any }) {
  return (
    <Box style={{ flexGrow: 1, minHeight: 0, padding: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: accentFor('bg') }}>
      <Box style={{ width: 300, height: 300, borderWidth: 1, borderColor: accentFor('border'), overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        {props.children}
      </Box>
      <Text fontSize={11} color={accentFor('textDim')} style={{ fontFamily: 'monospace', marginTop: 12 }}>{props.caption}</Text>
    </Box>
  );
}
