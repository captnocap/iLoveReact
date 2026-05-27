// pixel_icon_gallery — load every icon saved in cart/pixel_icons/ and render
// them in a grid. Static icons render once. Animation icons (filename ends in
// `.64.anim.json`) play in a loop at their stored fps.
//
// Scans the directory at mount, decodes the rows-of-runs format back into a
// flat pixel matrix for PixelIcon. Pick a scale (1/2/3/4 px per cell) to see
// how the icons hold up at different display sizes.

import { useEffect, useState } from 'react';
import { Box, Col, Row, Pressable, Text } from '@reactjit/runtime/primitives';
import { readFile, listDir } from '@reactjit/runtime/hooks/fs';
import { type PixelMatrix } from './pixel_icons/PixelIcon';
import { ShaderPixelIcon, ShaderAnimIcon } from './pixel_icons/ShaderPixelIcon';

const ICON_DIR = 'cart/pixel_icons';

const BG = '#0b1018';
const INK = '#e8eef8';
const DIM = '#7f93b1';
const ACCENT = '#3da9ff';
const CARD = '#11182a';

type EncodedRunEntry = number | null | [number, number | null];
type EncodedMatrix = { size: number; palette: string[]; rows: EncodedRunEntry[][] };
type EncodedAnim   = { size: number; palette: string[]; fps: number; frames: Array<{ rows: EncodedRunEntry[][] }> };

function decodeMatrix(obj: EncodedMatrix): PixelMatrix {
  const { size, palette, rows } = obj;
  const pixels: Array<number | null> = new Array(size * size).fill(null);
  for (let y = 0; y < size; y++) {
    let x = 0;
    const row = rows[y] || [];
    for (const entry of row) {
      if (Array.isArray(entry)) {
        const [count, v] = entry;
        for (let i = 0; i < count; i++) pixels[y * size + x++] = v;
      } else {
        pixels[y * size + x++] = entry;
      }
    }
  }
  return { size, palette, pixels };
}

type StaticIcon = { kind: 'static'; filename: string; stem: string; matrix: PixelMatrix };
type AnimIconData = {
  kind: 'anim'; filename: string; stem: string;
  size: number; palette: string[]; fps: number;
  frames: Array<{ pixels: Array<number | null> }>;
};
type Loaded = StaticIcon | AnimIconData;

function stemOf(filename: string): string {
  return filename.replace(/\.64(\.anim)?\.json$/, '');
}

function loadIcons(): { items: Loaded[]; errors: string[] } {
  const errors: string[] = [];
  const items: Loaded[] = [];
  const files = listDir(ICON_DIR);
  if (!files || files.length === 0) return { items, errors };

  const sorted = [...files].sort();
  for (const fn of sorted) {
    if (!/\.64(\.anim)?\.json$/.test(fn)) continue;
    const path = `${ICON_DIR}/${fn}`;
    const txt = readFile(path);
    if (!txt) { errors.push(`could not read ${path}`); continue; }
    try {
      const obj = JSON.parse(txt);
      if (Array.isArray(obj.frames)) {
        const anim = obj as EncodedAnim;
        const frames = anim.frames.map((f) =>
          decodeMatrix({ size: anim.size, palette: anim.palette, rows: f.rows }),
        );
        items.push({
          kind: 'anim',
          filename: fn,
          stem: stemOf(fn),
          size: anim.size,
          palette: anim.palette,
          fps: anim.fps || 12,
          frames: frames.map((m) => ({ pixels: m.pixels })),
        });
      } else {
        items.push({ kind: 'static', filename: fn, stem: stemOf(fn), matrix: decodeMatrix(obj) });
      }
    } catch (e: any) {
      errors.push(`parse ${fn}: ${e?.message ?? e}`);
    }
  }
  return { items, errors };
}

// Gallery now renders every icon — static and animated — through a single
// fragment shader (see ShaderPixelIcon). One quad per icon, palette lookup
// in WGSL, animation = swap the pixels slice of the storage buffer. The old
// box-per-cell renderer is left in place for the editor cart where
// individual cell hit-targets matter.

const SCALES = [1, 2, 3, 4, 6];

export default function PixelIconGallery() {
  const [scale, setScale] = useState<number>(3);
  const [loaded, setLoaded] = useState<{ items: Loaded[]; errors: string[] }>({ items: [], errors: [] });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoaded(loadIcons());
  }, [reloadKey]);

  const { items, errors } = loaded;
  const animCount = items.filter((i) => i.kind === 'anim').length;

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: BG, padding: 24, gap: 16 }}>
      <Col style={{ gap: 4 }}>
        <Text style={{ color: INK, fontSize: 22, fontWeight: '700' }}>
          Icon gallery
        </Text>
        <Text style={{ color: DIM, fontSize: 13 }}>
          Reading every <Text style={{ color: ACCENT }}>cart/pixel_icons/*.64*.json</Text>.
          {' '}{items.length} icon{items.length === 1 ? '' : 's'} ({animCount} animated).
        </Text>
      </Col>

      <Row style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Text style={{ color: DIM, fontSize: 12 }}>scale</Text>
        {SCALES.map((s) => (
          <Pressable key={s} onPress={() => setScale(s)}>
            <Box style={{
              paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4,
              backgroundColor: scale === s ? ACCENT : '#1a2332',
            }}>
              <Text style={{ color: scale === s ? '#0b1018' : INK, fontSize: 12, fontWeight: '600' }}>
                {s}×
              </Text>
            </Box>
          </Pressable>
        ))}
        <Box style={{ width: 12 }} />
        <Pressable onPress={() => setReloadKey((k) => k + 1)}>
          <Box style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4, backgroundColor: '#1a2332' }}>
            <Text style={{ color: INK, fontSize: 12 }}>reload</Text>
          </Box>
        </Pressable>
      </Row>

      {errors.length > 0 ? (
        <Box style={{ padding: 8, backgroundColor: '#2a1820', borderRadius: 6 }}>
          {errors.slice(0, 5).map((e, i) => (
            <Text key={i} style={{ color: '#ff8080', fontSize: 11 }}>{e}</Text>
          ))}
        </Box>
      ) : null}

      <Row style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {items.map((it) => (
          <Col key={it.filename} style={{ gap: 6, alignItems: 'center' }}>
            <Box style={{ padding: 6, backgroundColor: CARD, borderRadius: 6 }}>
              <Box style={{ width: 64 * scale, height: 64 * scale }}>
                {it.kind === 'static'
                  ? <ShaderPixelIcon data={it.matrix} pixelSize={scale} />
                  : <ShaderAnimIcon data={it} pixelSize={scale} />}
              </Box>
            </Box>
            <Text style={{ color: INK, fontSize: 11, fontWeight: '600' }}>{it.stem}</Text>
            <Text style={{ color: DIM, fontSize: 10 }}>
              {it.kind === 'anim' ? `${it.frames.length}f @ ${it.fps}fps` : 'static'}
            </Text>
          </Col>
        ))}
      </Row>

      {items.length === 0 ? (
        <Text style={{ color: DIM, fontSize: 13 }}>
          No icons yet — run pixel_icon_demo, pick an image, save it.
        </Text>
      ) : null}
    </Col>
  );
}
