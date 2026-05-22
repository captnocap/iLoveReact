// ShaderQuadImage — loader/renderer for .sqi.json files.
//
// Drop-in component that consumes a parsed SqiDocument (or a path/url to one)
// and renders the merged cutout + shader-FX layers as a stack of <Effect>
// quads in a fixed-size box. No external assets, no per-cell DOM — the whole
// composite is N+1 GPU draws (1 base ShaderPixelIcon + N FX MaskQuads).
//
// Stacking order: base pixel image at the bottom, then FX layers in document
// order, so layer[0] paints over the base, layer[1] over layer[0], etc.
// Muted layers are skipped at render time (preserves them in the file so
// they round-trip on re-export).

import { useEffect, useMemo, useState } from 'react';
import { Box, Effect } from '@reactjit/runtime/primitives';
import { readFile } from '@reactjit/runtime/hooks/fs';
import {
  decodeMaskRows,
  decodeMatrix,
  parseSqi,
  type SqiDocument,
  type SqiLayer,
} from '../sqi';
import { MaskQuad, type SurfaceId } from './MaskQuad';

interface Props {
  /** A pre-parsed document. Use this if you already have the JSON in memory. */
  doc?: SqiDocument;
  /** Filesystem path to a .sqi.json file. Read at mount, parsed once. */
  src?: string;
  /** Rendered pixel size of the square quad. Defaults to size * 4 (icon-ish). */
  size?: number;
}

export function ShaderQuadImage({ doc: docProp, src, size }: Props) {
  const [loaded, setLoaded] = useState<SqiDocument | null>(docProp ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (docProp) { setLoaded(docProp); setLoadError(null); return; }
    if (!src) return;
    const text = readFile(src);
    if (!text) { setLoadError(`could not read ${src}`); return; }
    const parsed = parseSqi(text);
    if (!parsed) { setLoadError(`not a valid .sqi file: ${src}`); return; }
    setLoaded(parsed);
    setLoadError(null);
  }, [docProp, src]);

  if (loadError) {
    return (
      <Box style={{
        width: size ?? 256,
        height: size ?? 256,
        borderWidth: 1,
        borderColor: '#5a2630',
        backgroundColor: '#1a0d12',
      }} />
    );
  }
  if (!loaded) {
    return (
      <Box style={{
        width: size ?? 256,
        height: size ?? 256,
        backgroundColor: '#0a0c14',
      }} />
    );
  }

  const dim = size ?? loaded.size * 4;
  return (
    <Box style={{ width: dim, height: dim, position: 'relative' }}>
      <BaseQuad doc={loaded} dim={dim} />
      {loaded.layers.map((layer) =>
        layer.muted ? null : (
          <LayerQuad key={layer.id} doc={loaded} layer={layer} dim={dim} />
        )
      )}
    </Box>
  );
}

// ── Base pixel matrix quad ────────────────────────────────────────────
// Same shader as cart/pixel_icons/ShaderPixelIcon (palette LUT in storage
// buffer). Inlined here so ShaderQuadImage is self-contained and doesn't
// need the consuming cart to also pull the pixel_icons subtree.

const BASE_SHADER = `
@group(0) @binding(1) var<storage, read> data: array<f32>;

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let size = data[0];
  let pal_count = u32(data[1]);
  let isize = u32(size);
  let cx_f = floor(in.uv.x * size);
  let cy_f = floor(in.uv.y * size);
  let cx = u32(clamp(cx_f, 0.0, size - 1.0));
  let cy = u32(clamp(cy_f, 0.0, size - 1.0));
  let pixel_idx = cy * isize + cx;
  let p_offset = 2u + pal_count * 3u;
  let raw = data[p_offset + pixel_idx];
  if (raw < 0.0) { return vec4f(0.0, 0.0, 0.0, 0.0); }
  let pal_idx = u32(raw);
  let base = 2u + pal_idx * 3u;
  let r = data[base];
  let g = data[base + 1u];
  let b = data[base + 2u];
  return vec4f(r, g, b, 1.0);
}
`;

function paletteToFloats(palette: string[]): number[] {
  const out = new Array<number>(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    const hex = palette[i];
    out[i * 3 + 0] = parseInt(hex.slice(1, 3), 16) / 255;
    out[i * 3 + 1] = parseInt(hex.slice(3, 5), 16) / 255;
    out[i * 3 + 2] = parseInt(hex.slice(5, 7), 16) / 255;
  }
  return out;
}

function BaseQuad({ doc, dim }: { doc: SqiDocument; dim: number }) {
  const packed = useMemo(() => {
    const pixels = decodeMatrix(doc.base);
    const palFloats = paletteToFloats(doc.base.palette);
    const out = new Array<number>(2 + palFloats.length + pixels.length);
    out[0] = doc.base.size;
    out[1] = doc.base.palette.length;
    for (let i = 0; i < palFloats.length; i++) out[2 + i] = palFloats[i];
    const off = 2 + palFloats.length;
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i];
      out[off + i] = p == null ? -1 : p;
    }
    return out;
  }, [doc]);

  return (
    <Effect
      shader={BASE_SHADER}
      data={packed}
      style={{ position: 'absolute', left: 0, top: 0, width: dim, height: dim }}
    />
  );
}

// ── Layer quad ────────────────────────────────────────────────────────
// Reuses MaskQuad — same data layout, same shader machinery cutout's
// Inspector already exercises. Just wires the decoded mask cells + the
// per-layer surface into a single Effect at the document's render box.

function LayerQuad({ doc, layer, dim }: { doc: SqiDocument; layer: SqiLayer; dim: number }) {
  const cells = useMemo(() => decodeMaskRows(layer.mask, doc.size), [layer.mask, doc.size]);
  const { mode, customShader } = layerSurface(layer);
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, width: dim, height: dim }}>
      <MaskQuad
        cells={cells}
        gridSize={doc.size}
        worldW={dim}
        worldH={dim}
        dim={layer.dim}
        mode={mode}
        customShader={customShader}
        hueOffset={layer.hueOffset}
        phaseOffset={layer.phaseOffset}
        colors={layer.colors}
      />
    </Box>
  );
}

function layerSurface(layer: SqiLayer): { mode: SurfaceId; customShader?: string } {
  if (layer.surface.kind === 'builtin') return { mode: layer.surface.name };
  return { mode: `custom:${layer.id}`, customShader: layer.surface.wgsl };
}
