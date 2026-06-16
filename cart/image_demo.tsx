// image_demo — exercises @reactjit/image (the Sharp-style codec door).
//
// Generates a 512×512 RGBA gradient in-cart, encodes it to PNG, then runs the
// decode→resize→re-encode pipeline to JPEG and WebP at a smaller size — the
// exact shape of "a model handed me a huge image, shrink + recompress it."
// Renders the before/after byte sizes so `rjit shot` shows the win at a glance.

import { useEffect, useMemo, useState } from 'react';
import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
import { image, encode, webpAvailable } from '@reactjit/image';

const SRC = 512; // source edge (px)
const DST = 128; // resized edge (px)

type ResultRow = { label: string; bytes: number; note: string; ok: boolean };

function makeGradient(size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  let i = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / (size / 2);
      px[i++] = Math.round((x / size) * 255); // R ramps across
      px[i++] = Math.round((y / size) * 255); // G ramps down
      px[i++] = Math.round(Math.max(0, 1 - d) * 255); // B = radial falloff
      px[i++] = 255;
    }
  }
  return px;
}

function kb(n: number): string {
  return (n / 1024).toFixed(1) + ' KB';
}

export default function ImageDemo() {
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [meta, setMeta] = useState<string>('');
  const hasWebp = useMemo(() => webpAvailable(), []);

  useEffect(() => {
    const out: ResultRow[] = [];

    // 1. raw RGBA → PNG (encode of generated pixels)
    const pixels = makeGradient(SRC);
    const png = encode(pixels, SRC, SRC, { format: 'png' });
    out.push({
      label: `${SRC}² RGBA → PNG`,
      bytes: png ? png.length : 0,
      note: png ? `from ${kb(pixels.length)} raw` : 'FAILED',
      ok: !!png,
    });

    if (png) {
      // metadata round-trips without a full decode
      const m = image(png).metadata();
      if (m) setMeta(`source: ${m.width}×${m.height} ${m.format}, ${m.channels}ch`);

      // 2. PNG → resize 128 → JPEG q80
      const jpg = image(png).resize(DST).jpeg({ quality: 80 }).toBuffer();
      out.push({
        label: `PNG → resize ${DST} → JPEG q80`,
        bytes: jpg ? jpg.length : 0,
        note: jpg ? 'lossy' : 'FAILED',
        ok: !!jpg,
      });

      // 3. PNG → resize 128 → WebP q80 (the smallest)
      const webp = image(png).resize(DST).webp({ quality: 80 }).toBuffer();
      out.push({
        label: `PNG → resize ${DST} → WebP q80`,
        bytes: webp ? webp.length : 0,
        note: hasWebp ? (webp ? 'lossy' : 'FAILED') : 'libwebp absent',
        ok: hasWebp ? !!webp : true,
      });

      // 4. write one to disk via toFile (self-contained, no fs door)
      const wrote = image(png).resize(DST).jpeg({ quality: 80 }).toFile('/tmp/image_demo_out.jpg');
      out.push({ label: 'toFile /tmp/image_demo_out.jpg', bytes: 0, note: wrote ? 'written' : 'FAILED', ok: wrote });
    }

    setRows(out);
    for (const r of out) console.log(`[image_demo] ${r.label}: ${r.bytes} bytes (${r.note})`);
  }, []);

  const allOk = rows.length > 0 && rows.every((r) => r.ok);

  return (
    <Col style={{ width: '100%', height: '100%', backgroundColor: '#0e1116', padding: 24, gap: 14 }}>
      <Text style={{ color: '#e6edf3', fontSize: 22, fontWeight: 700 }}>@reactjit/image — codec door</Text>
      <Text style={{ color: '#8b949e', fontSize: 13 }}>{meta || 'running…'}</Text>
      <Col style={{ gap: 8, marginTop: 8 }}>
        {rows.map((r, i) => (
          <Row key={i} style={{ gap: 12, alignItems: 'center' }}>
            <Box style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: r.ok ? '#3fb950' : '#f85149' }} />
            <Text style={{ color: '#c9d1d9', fontSize: 14, width: 320 }}>{r.label}</Text>
            <Text style={{ color: '#58a6ff', fontSize: 14, width: 90 }}>{r.bytes ? kb(r.bytes) : '—'}</Text>
            <Text style={{ color: '#8b949e', fontSize: 13 }}>{r.note}</Text>
          </Row>
        ))}
      </Col>
      <Text style={{ color: allOk ? '#3fb950' : '#d29922', fontSize: 16, fontWeight: 700, marginTop: 10 }}>
        {rows.length === 0 ? '' : allOk ? 'ALL PASS' : 'see rows'}
      </Text>
    </Col>
  );
}
