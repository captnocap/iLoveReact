// editor/dialogs/AddChunkDialog.tsx — Map → Add Chunk… (req_2703).
//
// The world grows by CHUNKS (fixed 120 m × 120 m map-engine pages). The old
// editor grew them from a 2D topology view with "+" buttons at the open ends —
// this is that view, rebuilt over the host doors: __map_chunk_list draws the
// occupancy grid, every empty slot 4-adjacent to a grown chunk renders a "+"
// (clamped to the engine's address window), and pressing one grows the chunk
// host-side (__map_grow_chunk) and saves the painting so the new ground
// survives a restart. The live viewport mirrors the new chunk next frame — no
// reload, no re-seed.
import { useState } from 'react';
import { Box, Col, Row, Text, Pressable, ScrollView } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { mapChunkList, mapChunkListLive, mapGrowChunk, mapHostLive } from '../../../runtime/game/map';
import { saveMapFile } from '../stage/mapPaint';

const PANEL = '#17181b', BORDER = '#2a2c31', TEXT = '#e8e8ea', DIM = '#9a9ea6', ACCENT = '#6ea8fe', BTN_BG = '#1f2126';
const MONO = 'ui-monospace';
/** Chunk edge in meters (chunks.zig CHUNK_TILES · 1 tile = 1 m) — readout only. */
const CHUNK_M = 120;

type Topology = {
  maxCol: number;
  maxRow: number;
  occupied: Set<string>;
  chunkCount: number;
};

const key = (cx: number, cz: number) => `${cx},${cz}`;

function readTopology(): Topology {
  const list = mapChunkList();
  return {
    maxCol: list.maxCol,
    maxRow: list.maxRow,
    occupied: new Set(list.chunks.map((c) => key(c.cx, c.cz))),
    chunkCount: list.chunks.length,
  };
}

export default function AddChunkDialog({ onClose }: { onClose: () => void }) {
  const [topo, setTopo] = useState<Topology>(readTopology);
  const hostLive = mapHostLive();

  const grow = (cx: number, cz: number) => {
    if (!mapGrowChunk(cx, cz)) return;
    saveMapFile(); // structural change — persist so the new ground survives a restart
    setTopo(readTopology());
  };

  // View bounds: the painted extent padded one slot each way (that's where the
  // "+" ends live), clamped to the engine's address window.
  let minX = Number.MAX_SAFE_INTEGER, maxX = 0, minZ = Number.MAX_SAFE_INTEGER, maxZ = 0;
  for (const k of topo.occupied) {
    const [cx, cz] = k.split(',').map(Number) as [number, number];
    minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
    minZ = Math.min(minZ, cz); maxZ = Math.max(maxZ, cz);
  }
  if (topo.occupied.size === 0) { minX = 0; maxX = 0; minZ = 0; maxZ = 0; }
  const x0 = Math.max(0, minX - 1), x1 = Math.min(topo.maxCol, maxX + 1);
  const z0 = Math.max(0, minZ - 1), z1 = Math.min(topo.maxRow, maxZ + 1);
  const cols = x1 - x0 + 1, rows = z1 - z0 + 1;
  const cell = Math.max(16, Math.min(40, Math.floor(560 / cols), Math.floor(320 / rows)));

  const openSlot = (cx: number, cz: number) =>
    !topo.occupied.has(key(cx, cz)) && (
      topo.occupied.has(key(cx - 1, cz)) || topo.occupied.has(key(cx + 1, cz)) ||
      topo.occupied.has(key(cx, cz - 1)) || topo.occupied.has(key(cx, cz + 1))
    );

  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(4,5,7,0.6)', alignItems: 'center', justifyContent: 'center' }}>
      <Col style={{ width: 640, backgroundColor: PANEL, borderWidth: 1, borderColor: BORDER, borderRadius: 14, padding: 18, gap: 12 }}>
        <Row style={{ alignItems: 'center', gap: 8 }}>
          <Icon name="Grid2x2Plus" size={15} color={ACCENT} />
          <Text style={{ color: TEXT, fontSize: 14, fontWeight: '700' }}>Add Chunk</Text>
          <Box style={{ flexGrow: 1 }} />
          <Text style={{ color: DIM, fontSize: 11, fontFamily: MONO }}>
            {topo.chunkCount} chunk{topo.chunkCount === 1 ? '' : 's'} · {CHUNK_M} m each · window {topo.maxCol + 1}×{topo.maxRow + 1}
          </Text>
        </Row>

        {!hostLive ? (
          <Text style={{ color: DIM, fontSize: 12 }}>The map host is not live in this build (-Dhas-game-map) — no chunks to show.</Text>
        ) : !mapChunkListLive() ? (
          <Text style={{ color: DIM, fontSize: 12 }}>This binary predates the chunk-list door (__map_chunk_list) — rebuild the host to use Add Chunk.</Text>
        ) : (
          <Col style={{ gap: 4 }}>
            <Text style={{ color: DIM, fontSize: 11 }}>
              Filled squares are the map's chunks; press a + to grow the world at that end. X runs east, Z runs south.
            </Text>
            <ScrollView style={{ maxHeight: 340 }}>
              <Col style={{ gap: 3, alignItems: 'center', paddingTop: 6, paddingBottom: 6 }}>
                {Array.from({ length: rows }, (_, rz) => {
                  const cz = z0 + rz;
                  return (
                    <Row key={`z${cz}`} style={{ gap: 3 }}>
                      {Array.from({ length: cols }, (_, rx) => {
                        const cx = x0 + rx;
                        if (topo.occupied.has(key(cx, cz))) {
                          return (
                            <Box key={`c${cx}`} tooltip={`chunk (${cx}, ${cz})`}
                              style={{ width: cell, height: cell, borderRadius: 4, backgroundColor: '#2b4a75', borderWidth: 1, borderColor: ACCENT }} />
                          );
                        }
                        if (openSlot(cx, cz)) {
                          return (
                            <Pressable key={`c${cx}`} tooltip={`add chunk (${cx}, ${cz}) — ${CHUNK_M} m × ${CHUNK_M} m`} onPress={() => grow(cx, cz)}
                              style={{ width: cell, height: cell, borderRadius: 4, backgroundColor: BTN_BG, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ color: ACCENT, fontSize: Math.max(11, Math.floor(cell * 0.5)), fontWeight: '700' }}>+</Text>
                            </Pressable>
                          );
                        }
                        return <Box key={`c${cx}`} style={{ width: cell, height: cell, borderRadius: 4, backgroundColor: '#101114' }} />;
                      })}
                    </Row>
                  );
                })}
              </Col>
            </ScrollView>
          </Col>
        )}

        <Row style={{ alignItems: 'center' }}>
          <Text style={{ color: DIM, fontSize: 10 }}>Growth saves the painting; the viewport shows the new ground immediately.</Text>
          <Box style={{ flexGrow: 1 }} />
          <Pressable onPress={onClose}
            style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 6, paddingBottom: 6, borderRadius: 8, backgroundColor: '#e8e8ea' }}>
            <Text style={{ color: '#0d0e10', fontSize: 12, fontWeight: '700' }}>Done</Text>
          </Pressable>
        </Row>
      </Col>
    </Box>
  );
}
