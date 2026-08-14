// editor/stage/LabLibraryView.tsx — the Material Lab's LIBRARY tab (req_4395):
// an actual library. The full catalog as a batched thumbnail GRID (one Effect
// per 48-cell page, req_3473 per-page composition), filterable by board /
// kind / author + text search; click opens the material as a Lab base. The
// color-picker content that squatted here moved into the Lab's inline popover;
// what remains of color is the compact management of the REAL persisted sets.
import { useMemo, useState } from 'react';
import { Box, Col, Pressable, Row, Text, TextInput, StaticSurface } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import ShaderGridBatch, {
  SHADER_GRID_TUNING,
  isBatchableFillData,
  packFillShaderGridData,
  shaderGridDimensions,
} from '../shell/ShaderGridBatch';
import ShaderThumb from '../shell/ShaderThumb';
import { MATERIALS, type MaterialKind } from '../render3d/shaders/_generated/registry';
import { shaderGroups, defaultShaderData, type ShaderSpec } from '../textures/shaders';
import { oklchToHex, type OklchColor } from '../../../runtime/paint/colors';
import type { SpinePaletteSet } from '../data/colorSpine';

const LINE = '#242a33', TEXT = '#e8edf6', DIM = '#8b93a3', FAINT = '#6b7280', ACCENT = '#6ea8fe';
const PAGE_SIZE = SHADER_GRID_TUNING.maxCells;
const COLS = SHADER_GRID_TUNING.columns;

const KIND_FILTERS: Array<{ id: MaterialKind | 'all' | 'lab'; label: string }> = [
  { id: 'all', label: 'ALL' },
  { id: 'surface', label: 'SURFACES' },
  { id: 'composition', label: 'COMPOSITIONS' },
  { id: 'gradient', label: 'GRADIENTS' },
  { id: 'lab', label: 'LAB-MADE' },
];

export default function LabLibraryView(props: {
  sets: SpinePaletteSet[];
  savedTray: OklchColor[];
  onOpenInLab: (specId: string) => void;
  onLoadSet: (name: string, colors: OklchColor[]) => void;
  onCreateSet: () => void;
  onDeleteSet: (index: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MaterialKind | 'all' | 'lab'>('all');
  const [board, setBoard] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const registryByFn = useMemo(() => new Map(MATERIALS.map((m) => [m.fn, m])), []);
  const catalog = useMemo(
    () => shaderGroups().flatMap((group) => group.specs).filter((spec) => spec.fillFn),
    [],
  );
  const boards = useMemo(() => [...new Set(MATERIALS.map((m) => m.board))], []);

  const needle = query.trim().toLowerCase();
  const hits = catalog.filter((spec) => {
    const mat = registryByFn.get(spec.fillFn!);
    if (!mat) return false;
    if (kind === 'lab' && mat.author !== 'lab') return false;
    if (kind !== 'all' && kind !== 'lab' && mat.kind !== kind) return false;
    if (board && mat.board !== board) return false;
    if (needle && !`${spec.label} ${spec.group} ${spec.id} ${mat.tags.join(' ')} ${mat.author}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const maxPage = Math.max(0, Math.ceil(hits.length / PAGE_SIZE) - 1);
  const p = Math.min(page, maxPage);
  const pageSpecs = hits.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);

  const cells = pageSpecs.map((spec) => {
    const data = defaultShaderData(spec);
    return { spec, data, batched: isBatchableFillData(data) };
  });
  const gridSize = shaderGridDimensions(cells.length);
  const packed = packFillShaderGridData(cells.map((cell) => (cell.batched ? cell.data : null)));
  const rows: Array<typeof cells> = [];
  for (let index = 0; index < cells.length; index += COLS) rows.push(cells.slice(index, index + COLS));

  return (
    <Col style={{ flexGrow: 1, minHeight: 0, padding: 14, gap: 10 }}>
      <Row style={{ alignItems: 'center', gap: 6 }}>
        <Icon name="Search" size={12} color={DIM} />
        <TextInput
          value={query}
          onChange={(next: string) => { setQuery(next); setPage(0); }}
          placeholder="Search 400+ materials by name, tag, board, author..."
          style={{ flexGrow: 1, minWidth: 0, height: 28, paddingLeft: 8, paddingRight: 8, borderRadius: 7, borderWidth: 1, borderColor: LINE, backgroundColor: '#0d1015', color: TEXT, fontSize: 11 }}
        />
        <Text style={{ color: DIM, fontSize: 10, fontFamily: 'ui-monospace' }}>{hits.length} materials · {p + 1}/{maxPage + 1}</Text>
        <Pressable onPress={() => setPage(Math.max(0, p - 1))} style={{ width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
          <Icon name="ChevronLeft" size={11} color={DIM} />
        </Pressable>
        <Pressable onPress={() => setPage(Math.min(maxPage, p + 1))} style={{ width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
          <Icon name="ChevronRight" size={11} color={DIM} />
        </Pressable>
      </Row>
      <Row style={{ alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {KIND_FILTERS.map((filter) => (
          <Pressable key={filter.id} onPress={() => { setKind(filter.id); setPage(0); }}
            style={{ paddingLeft: 8, paddingRight: 8, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: kind === filter.id ? '#e8e8ea' : '#141518', borderWidth: 1, borderColor: kind === filter.id ? '#e8e8ea' : LINE }}>
            <Text style={{ color: kind === filter.id ? '#0d0e10' : DIM, fontSize: 8, fontWeight: '800' }}>{filter.label}</Text>
          </Pressable>
        ))}
        <Box style={{ width: 10 }} />
        {boards.map((slug) => (
          <Pressable key={slug} onPress={() => { setBoard(board === slug ? null : slug); setPage(0); }}
            style={{ paddingLeft: 7, paddingRight: 7, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderColor: board === slug ? ACCENT : LINE }}>
            <Text style={{ color: board === slug ? ACCENT : FAINT, fontSize: 8, fontWeight: '700' }}>{slug.replace(/_/g, ' ')}</Text>
          </Pressable>
        ))}
      </Row>

      <StaticSurface style={{ flexDirection: 'column', gap: 4 }}>
        {cells.length > 0 ? (
          <Box style={{ position: 'relative', width: gridSize.width, height: gridSize.height }}>
            {cells.some((cell) => cell.batched) ? <ShaderGridBatch data={packed} width={gridSize.width} height={gridSize.height} /> : null}
            <Col style={{ position: 'absolute', left: 0, top: 0, gap: SHADER_GRID_TUNING.gap }}>
              {rows.map((row, rowIndex) => (
                <Row key={rowIndex} style={{ gap: SHADER_GRID_TUNING.gap }}>
                  {row.map((cell, columnIndex) => (
                    <Pressable
                      key={columnIndex}
                      tooltip={`${cell.spec.label} — ${cell.spec.group} · open in the Lab`}
                      onPress={() => props.onOpenInLab(cell.spec.id)}
                      style={{ width: SHADER_GRID_TUNING.cellSize, height: SHADER_GRID_TUNING.cellSize, padding: 1, borderRadius: SHADER_GRID_TUNING.cornerRadius, alignItems: 'center', justifyContent: 'center' }}
                    >
                      {cell.batched ? null : <ShaderThumb shader={cell.spec.shader} data={cell.data} size={SHADER_GRID_TUNING.thumbnailSize} />}
                    </Pressable>
                  ))}
                </Row>
              ))}
            </Col>
          </Box>
        ) : (
          <Text style={{ color: FAINT, fontSize: 11 }}>{`no material matches "${query}"`}</Text>
        )}
      </StaticSurface>

      {/* compact color-set management — the REAL store (colorSpineSets) */}
      <Col style={{ gap: 5, paddingTop: 8, borderTopWidth: 1, borderTopColor: LINE }}>
        <Row style={{ alignItems: 'center', gap: 6 }}>
          <Icon name="Palette" size={12} color={DIM} />
          <Text style={{ color: FAINT, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>COLOR SETS</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable tooltip={props.savedTray.length ? `Bank the ${props.savedTray.length}-color SAVED tray as a new set` : 'SAVED is empty — save colors in any picker first'} onPress={props.onCreateSet}
            style={{ paddingLeft: 8, paddingRight: 8, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
            <Text style={{ color: TEXT, fontSize: 9, fontWeight: '700' }}>+ set from saved</Text>
          </Pressable>
        </Row>
        {props.sets.length === 0 ? (
          <Text style={{ color: FAINT, fontSize: 10 }}>no saved sets — bank the SAVED tray to start one</Text>
        ) : props.sets.map((set, index) => (
          <Row key={`${index}-${set.name}`} style={{ alignItems: 'center', gap: 6 }}>
            <Pressable tooltip="Load into SAVED" onPress={() => props.onLoadSet(set.name, set.colors)} style={{ width: 110 }}>
              <Text numberOfLines={1} noWrap style={{ color: TEXT, fontSize: 10, fontWeight: '700' }}>{set.name}</Text>
            </Pressable>
            <Row style={{ gap: 4 }}>
              {set.colors.map((color, at) => (
                <Box key={at} style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: oklchToHex(color), borderWidth: 1, borderColor: LINE }} />
              ))}
            </Row>
            <Box style={{ flexGrow: 1 }} />
            <Pressable tooltip={`Delete set "${set.name}"`} onPress={() => props.onDeleteSet(index)}
              style={{ width: 20, height: 20, borderRadius: 5, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: LINE }}>
              <Icon name="X" size={10} color={DIM} />
            </Pressable>
          </Row>
        ))}
      </Col>
    </Col>
  );
}
