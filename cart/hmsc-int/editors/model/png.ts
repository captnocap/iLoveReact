// editors/model/png.ts — a tiny, dependency-free PNG encoder (req_1072). Encodes a
// tight RGBA buffer to PNG bytes using STORED (uncompressed) DEFLATE — no zlib
// dependency, deterministic, and small enough for sprite-sheet / slice export. Pure
// + headless so it runs under v8cli (no host, no DOM). The sprite-sheet export
// (textureize.ts rasterizeAtlas → here → base64 → fs) feeds the PNG to disk.

/** CRC-32 (PNG chunk checksum) — the standard IEEE table. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Adler-32 (the zlib stream checksum). */
function adler32(bytes: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i += 1) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

function be32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** A PNG chunk: length + type + data + CRC(type+data). */
function chunk(type: string, data: number[]): number[] {
  const typeBytes = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)];
  const body = typeBytes.concat(data);
  const crc = crc32(Uint8Array.from(body));
  return be32(data.length).concat(body, be32(crc));
}

/** zlib stream wrapping STORED deflate blocks (BTYPE=00) — no compression, always
 *  correct. Each block ≤ 65535 bytes: header byte (BFINAL bit) + LEN + ~LEN + data. */
function zlibStored(raw: Uint8Array): number[] {
  const out: number[] = [0x78, 0x01]; // CMF + FLG (no preset dict, fastest)
  let i = 0;
  while (i < raw.length) {
    const len = Math.min(65535, raw.length - i);
    const last = i + len >= raw.length ? 1 : 0;
    out.push(last);                       // BFINAL in bit0, BTYPE=00
    out.push(len & 0xff, (len >>> 8) & 0xff);          // LEN (LE)
    out.push(~len & 0xff, (~len >>> 8) & 0xff);        // NLEN (LE)
    for (let k = 0; k < len; k += 1) out.push(raw[i + k]);
    i += len;
  }
  const ad = adler32(raw);
  out.push(...be32(ad));
  return out;
}

/** Encode a tight RGBA buffer (width*height*4 bytes, row-major) to PNG bytes. */
export function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  // raw scanlines: each row prefixed with filter byte 0 (None).
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const ihdr = be32(width).concat(be32(height), [8, 6, 0, 0, 0]); // 8-bit, RGBA, no interlace
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const bytes = sig.concat(chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND', []));
  return Uint8Array.from(bytes);
}
