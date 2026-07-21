import { useState } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView, TextInput } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { useTelemetry } from '../../../runtime/hooks/useTelemetry';
import type { MapDocumentSummary } from '../data/mapDocuments';

const PANEL = '#17181b';
const CARD = '#1f2126';
const BORDER = '#2a2c31';
const TEXT = '#e8e8ea';
const DIM = '#9a9ea6';
const FAINT = '#70747d';
const ACCENT = '#6ea8fe';
const DANGER = '#e06c75';
const MONO = 'ui-monospace';

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return `${value}`;
}

function formatEditTime(ms: number): string {
  if (ms <= 0) return 'never';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: new Date(ms).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const iconButtonStyle = {
  width: 28,
  height: 28,
  borderRadius: 6,
  borderWidth: 1,
  borderColor: BORDER,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

export default function MapDocumentsDialog(props: {
  current: string;
  documents: readonly MapDocumentSummary[];
  measureCurrentTriangles: boolean;
  onOpen: (stem: string, currentTriangles: number | null) => void;
  onNew: (name: string, currentTriangles: number | null) => void;
  onGenerateCoastal: (name: string, seed: number, currentTriangles: number | null) => void;
  onRename: (stem: string, name: string, currentTriangles: number | null) => boolean;
  onDelete: (stem: string) => boolean;
  onClose: (currentTriangles: number | null) => void;
}) {
  const [name, setName] = useState('untitled');
  const [coastalSeed, setCoastalSeed] = useState('18473');
  const [renamingStem, setRenamingStem] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteStem, setDeleteStem] = useState<string | null>(null);
  const { data: gpu } = useTelemetry<{ scene3d_triangles?: number }>({ kind: 'gpu', pollMs: 500 });
  const measuredTriangles = props.measureCurrentTriangles
    && typeof gpu?.scene3d_triangles === 'number'
    && Number.isFinite(gpu.scene3d_triangles)
    && gpu.scene3d_triangles > 0
      ? Math.trunc(gpu.scene3d_triangles)
      : null;
  const parsedCoastalSeed = /^\d+$/.test(coastalSeed.trim())
    ? Number(coastalSeed.trim())
    : Number.NaN;
  const coastalSeedValid = Number.isSafeInteger(parsedCoastalSeed)
    && parsedCoastalSeed >= 0
    && parsedCoastalSeed <= 0xffff_ffff;

  const beginRename = (document: MapDocumentSummary) => {
    setDeleteStem(null);
    setRenamingStem(document.stem);
    setRenameDraft(document.name);
  };

  const finishRename = (stem: string) => {
    const triangles = stem === props.current ? measuredTriangles : null;
    if (props.onRename(stem, renameDraft, triangles)) setRenamingStem(null);
  };

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,5,7,0.68)', alignItems: 'center', justifyContent: 'center' }}>
      <Col style={{ width: 660, height: 650, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, borderRadius: 14, overflow: 'hidden' }}>
        <Row style={{ height: 46, alignItems: 'center', gap: 9, paddingLeft: 14, paddingRight: 12, borderBottomWidth: 1, borderBottomColor: BORDER }}>
          <Icon name="Map" size={16} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 14, fontWeight: '700' }}>Map Workspaces</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: DIM, fontSize: 10, fontFamily: MONO }}>{props.documents.length} saved</Text>
          <Pressable onPress={() => props.onClose(measuredTriangles)} style={{ padding: 6 }}><Icon name="X" size={14} color={DIM} /></Pressable>
        </Row>

        <Col style={{ padding: 14, gap: 12, flexGrow: 1, minHeight: 0 }}>
          <Col style={{ gap: 7 }}>
            <Text style={{ color: DIM, fontSize: 10, fontFamily: MONO }}>NEW MAP — the current map is flushed before the clean document opens</Text>
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <TextInput
                value={name}
                onChange={setName}
                placeholder="map name"
                style={{ flexGrow: 1, height: 32, color: TEXT, backgroundColor: '#101114', borderWidth: 1, borderColor: BORDER, borderRadius: 7, paddingLeft: 10, paddingRight: 10, fontSize: 12 }}
              />
              <Pressable onPress={() => props.onNew(name, measuredTriangles)} style={{ height: 32, paddingLeft: 14, paddingRight: 14, borderRadius: 7, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#0b1018', fontSize: 11, fontWeight: '800' }}>Create clean map</Text>
              </Pressable>
            </Row>
            <Row style={{ gap: 8, alignItems: 'center' }}>
              <TextInput
                value={coastalSeed}
                onChange={setCoastalSeed}
                placeholder="uint32 seed"
                style={{ width: 116, height: 32, color: coastalSeedValid ? TEXT : DANGER, backgroundColor: '#101114', borderWidth: 1, borderColor: coastalSeedValid ? BORDER : DANGER, borderRadius: 7, paddingLeft: 10, paddingRight: 10, fontSize: 12, fontFamily: MONO }}
              />
              <Text style={{ color: FAINT, fontSize: 10, flexGrow: 1 }}>
                25×25 coastal city · 3 km × 3 km of terrain, water, roads, rail, and floor anchors
              </Text>
              <Pressable
                onPress={() => { if (coastalSeedValid) props.onGenerateCoastal(name, parsedCoastalSeed, measuredTriangles); }}
                style={{ height: 32, paddingLeft: 12, paddingRight: 12, borderRadius: 7, backgroundColor: '#70b58a', opacity: coastalSeedValid ? 1 : 0.4, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: '#09130d', fontSize: 11, fontWeight: '800' }}>Generate coastal baseline</Text>
              </Pressable>
            </Row>
          </Col>

          <Text style={{ color: DIM, fontSize: 10, fontFamily: MONO }}>OPEN MAP — painting, pieces, and markers switch as one document</Text>
          <ScrollView style={{ flexGrow: 1, minHeight: 0 }} showScrollbar>
            <Col style={{ gap: 7 }}>
              {props.documents.map((document) => {
                const active = document.stem === props.current;
                const renaming = renamingStem === document.stem;
                const confirmingDelete = deleteStem === document.stem;
                const triangles = active ? (measuredTriangles ?? document.renderTriangles) : document.renderTriangles;
                return (
                  <Col
                    key={document.stem}
                    style={{ minHeight: confirmingDelete ? 112 : 70, gap: 8, padding: 10, borderRadius: 8, backgroundColor: active ? '#20344f' : CARD, borderWidth: 1, borderColor: active ? ACCENT : BORDER }}
                  >
                    <Row style={{ alignItems: 'center', gap: 9 }}>
                      <Icon name={active ? 'MapPinned' : 'Map'} size={15} color={active ? ACCENT : DIM} />
                      {renaming ? (
                        <TextInput
                          value={renameDraft}
                          onChange={setRenameDraft}
                          placeholder="map name"
                          style={{ flexGrow: 1, height: 28, color: TEXT, backgroundColor: '#101114', borderWidth: 1, borderColor: ACCENT, borderRadius: 6, paddingLeft: 8, paddingRight: 8, fontSize: 12 }}
                        />
                      ) : (
                        <Text style={{ color: TEXT, fontSize: 12, fontWeight: '700', fontFamily: MONO, flexGrow: 1 }}>{document.name}</Text>
                      )}
                      {renaming ? (
                        <>
                          <Pressable tooltip="Save map name" onPress={() => finishRename(document.stem)} style={{ ...iconButtonStyle, borderColor: ACCENT }}><Icon name="Check" size={13} color={ACCENT} /></Pressable>
                          <Pressable tooltip="Cancel rename" onPress={() => setRenamingStem(null)} style={iconButtonStyle}><Icon name="X" size={13} color={DIM} /></Pressable>
                        </>
                      ) : (
                        <>
                          <Pressable tooltip="Rename map" onPress={() => beginRename(document)} style={iconButtonStyle}><Icon name="Pencil" size={12} color={DIM} /></Pressable>
                          {active
                            ? <Pressable tooltip="Open another map before deleting the active one" style={{ ...iconButtonStyle, opacity: 0.35 }}><Icon name="Trash2" size={12} color={DIM} /></Pressable>
                            : <Pressable tooltip="Delete map" onPress={() => { setRenamingStem(null); setDeleteStem(document.stem); }} style={iconButtonStyle}><Icon name="Trash2" size={12} color={DANGER} /></Pressable>}
                          {active ? (
                            <Text style={{ width: 50, color: ACCENT, fontSize: 10, fontFamily: MONO, textAlign: 'right' }}>ACTIVE</Text>
                          ) : (
                            <Pressable onPress={() => props.onOpen(document.stem, measuredTriangles)} style={{ height: 28, paddingLeft: 12, paddingRight: 12, borderRadius: 6, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ color: DIM, fontSize: 10, fontWeight: '700', fontFamily: MONO }}>OPEN</Text>
                            </Pressable>
                          )}
                        </>
                      )}
                    </Row>

                    <Row style={{ alignItems: 'center', gap: 12, paddingLeft: 24 }}>
                      <Text style={{ color: DIM, fontSize: 10, fontFamily: MONO }}>
                        {triangles === null ? '— tris' : `${formatCount(triangles)} tris ${active && measuredTriangles !== null ? 'live' : 'last render'}`}
                      </Text>
                      <Text style={{ color: DIM, fontSize: 10, fontFamily: MONO }}>{document.chunkCount === null ? '— chunks' : `${document.chunkCount} chunk${document.chunkCount === 1 ? '' : 's'}`}</Text>
                      <Text style={{ color: FAINT, fontSize: 10, fontFamily: MONO }}>{`modified ${formatEditTime(document.modifiedMs)}`}</Text>
                    </Row>

                    {confirmingDelete ? (
                      <Row style={{ alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 4, paddingTop: 7, borderTopWidth: 1, borderTopColor: '#553039' }}>
                        <Text style={{ color: DANGER, fontSize: 10, flexGrow: 1 }}>{`Delete “${document.name}” and all of its terrain, flora, pieces, and markers?`}</Text>
                        <Pressable onPress={() => setDeleteStem(null)} style={{ height: 26, paddingLeft: 9, paddingRight: 9, borderRadius: 5, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: DIM, fontSize: 10 }}>Cancel</Text>
                        </Pressable>
                        <Pressable onPress={() => { if (props.onDelete(document.stem)) setDeleteStem(null); }} style={{ height: 26, paddingLeft: 10, paddingRight: 10, borderRadius: 5, backgroundColor: '#6e303a', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: '#fff4f5', fontSize: 10, fontWeight: '800' }}>Delete entirely</Text>
                        </Pressable>
                      </Row>
                    ) : null}
                  </Col>
                );
              })}
            </Col>
          </ScrollView>
        </Col>
      </Col>
    </Box>
  );
}
