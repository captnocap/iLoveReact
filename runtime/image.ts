// runtime/image.ts — @reactjit/image: a Sharp-style image transcode API.
//
// We have no node/bun, so there's no `sharp`. This door fronts the Zig codec
// (framework/image/codec.zig via __imageops_*): decode → resize → encode for
// PNG / JPEG / WebP. The heavy raw RGBA NEVER crosses into JS — you hand
// compressed bytes (or a base64 string straight from an image model) in and
// get a small compressed buffer back. A 4K generation goes from ~30MB of
// base64 to ~150KB of WebP in one call.
//
// Importing this module is the metafile-gate trigger for -Dhas-imageops
// (sdk/dependency-registry.json "imageops"): the binding compiles in iff a
// shipped file imports this door. Carts that never touch it pay zero.
//
//   import { image } from '@reactjit/image';
//   const webp = image(b64FromModel).resize(1024).webp({ quality: 80 }).toBuffer();
//   image(pngBytes).resize(512, 512, { fit: 'cover' }).jpeg().toFile('thumb.jpg');
//   const { width, height, format } = image(bytes).metadata();

import { callHost } from './ffi';

/** Compressed source: raw bytes, or a base64 string (with or without a
 *  `data:image/...;base64,` prefix — image models emit both). */
export type ImageInput = Uint8Array | string;

export type Format = 'png' | 'jpeg' | 'webp';

/** How a resize fits the box when BOTH width and height are given. Matches
 *  sharp's `fit`. With only one dimension set, aspect is always preserved. */
export type Fit = 'fill' | 'inside' | 'outside' /* sharp aliases below */ | 'cover' | 'contain';

export interface ResizeOptions {
  fit?: Fit;
  /** Never scale up past the source size (sharp's withoutEnlargement). */
  withoutEnlargement?: boolean;
}

export interface JpegOptions {
  quality?: number; // 1..100, default 80
}
export interface WebpOptions {
  quality?: number; // 1..100, default 80 (ignored when lossless)
  lossless?: boolean;
}

export interface ImageMetadata {
  width: number;
  height: number;
  channels: number;
  format: string; // 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'unknown'
}

export interface RawImage {
  width: number;
  height: number;
  rgba: Uint8Array; // tight width*height*4 bytes
}

// sharp's fit aliases → our codec's three modes.
function normalizeFit(fit?: Fit): 'fill' | 'inside' | 'outside' {
  if (fit === 'cover') return 'outside';
  if (fit === 'contain') return 'inside';
  if (fit === 'fill' || fit === 'inside' || fit === 'outside') return fit;
  return 'inside';
}

type Op =
  | { width: number | null; height: number | null; fit: 'fill' | 'inside' | 'outside'; withoutEnlargement: boolean };

/** Chainable pipeline. Resize ops accumulate; a terminal (toBuffer / toFile /
 *  metadata / raw) makes exactly ONE host call that runs the whole pipeline
 *  inside Zig. */
export class ImagePipeline {
  #input: ImageInput;
  #resize: Op | null = null;
  #format: Format = 'jpeg';
  #quality = 80;
  #lossless = false;
  #formatSet = false;

  constructor(input: ImageInput) {
    this.#input = input;
  }

  /** Resize. `image(x).resize(1024)` scales to 1024px wide, aspect preserved
   *  — the common downscale. Pass both dims + a `fit` to control the box. */
  resize(width?: number | null, height?: number | null, opts: ResizeOptions = {}): this {
    this.#resize = {
      width: width == null ? null : Math.max(1, Math.round(width)),
      height: height == null ? null : Math.max(1, Math.round(height)),
      fit: normalizeFit(opts.fit),
      withoutEnlargement: !!opts.withoutEnlargement,
    };
    return this;
  }

  png(): this {
    this.#format = 'png';
    this.#formatSet = true;
    return this;
  }
  jpeg(opts: JpegOptions = {}): this {
    this.#format = 'jpeg';
    if (opts.quality != null) this.#quality = clampQuality(opts.quality);
    this.#formatSet = true;
    return this;
  }
  webp(opts: WebpOptions = {}): this {
    this.#format = 'webp';
    if (opts.quality != null) this.#quality = clampQuality(opts.quality);
    if (opts.lossless != null) this.#lossless = !!opts.lossless;
    this.#formatSet = true;
    return this;
  }
  /** Pick the output format by name (e.g. from a file extension). */
  toFormat(format: Format): this {
    this.#format = format;
    this.#formatSet = true;
    return this;
  }

  #opts(): string {
    const o: any = { format: this.#format, quality: this.#quality, lossless: this.#lossless };
    if (this.#resize) o.resize = this.#resize;
    return JSON.stringify(o);
  }

  /** Run the pipeline; returns the encoded bytes (null on failure — e.g.
   *  webp() requested but libwebp absent, or an undecodable source). */
  toBuffer(): Uint8Array | null {
    if (this.#format === 'webp' && !webpAvailable()) return null;
    return callHost<Uint8Array | null>('__imageops_transcode', null, this.#input, this.#opts());
  }

  /** Run the pipeline and write the result to `path`. Returns true on
   *  success. If no format was chosen, it's inferred from the extension. */
  toFile(path: string): boolean {
    if (!this.#formatSet) {
      const inferred = formatFromPath(path);
      if (inferred) this.#format = inferred;
    }
    const buf = this.toBuffer();
    if (!buf) return false;
    return callHost<boolean>('__imageops_write_file', false, path, buf);
  }

  /** Dimensions + format of the SOURCE, without a full pixel decode. */
  metadata(): ImageMetadata | null {
    const json = callHost<string | null>('__imageops_info', null, this.#input);
    if (!json) return null;
    try {
      return JSON.parse(json) as ImageMetadata;
    } catch {
      return null;
    }
  }

  /** Decode the source to raw RGBA pixels (ignores any resize/format set on
   *  the pipeline). For feeding a Canvas / shader / StaticSurface. */
  raw(): RawImage | null {
    const out = callHost<Uint8Array | null>('__imageops_decode_raw', null, this.#input);
    if (!out || out.length < 8) return null;
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const width = view.getUint32(0, true);
    const height = view.getUint32(4, true);
    if (width === 0 || height === 0 || out.length !== 8 + width * height * 4) return null;
    return { width, height, rgba: out.subarray(8) };
  }
}

/** Start a pipeline from compressed bytes or a base64 string. */
export function image(input: ImageInput): ImagePipeline {
  return new ImagePipeline(input);
}

/** Encode raw RGBA pixels straight to PNG/JPEG/WebP (the inverse of `.raw()`
 *  — e.g. pixels read back from a StaticSurface or generated in-cart). */
export function encode(
  rgba: Uint8Array,
  width: number,
  height: number,
  opts: { format?: Format; quality?: number; lossless?: boolean } = {},
): Uint8Array | null {
  const format = opts.format ?? 'png';
  if (format === 'webp' && !webpAvailable()) return null;
  const o = JSON.stringify({ format, quality: clampQuality(opts.quality ?? 80), lossless: !!opts.lossless });
  return callHost<Uint8Array | null>('__imageops_encode_raw', null, rgba, width | 0, height | 0, o);
}

/** Whether WebP encode/decode is available (libwebp resolved in this host). */
export function webpAvailable(): boolean {
  return callHost<boolean>('__imageops_webp_available', false);
}

/** Median-cut palette quantization (host, no dithering) — the pixel-texture
 *  import probe. Returns the host's binary layout
 *  [w u32][h u32][k u32][mse f32][palette k*3][indices w*h] or null; callers
 *  parse it with their format module (the editor's textures/pixelTexture.ts). */
export function quantize(input: ImageInput, colors = 64, maxSize = 128): Uint8Array | null {
  return callHost<Uint8Array | null>('__imageops_quantize', null, input, colors | 0, maxSize | 0);
}

function clampQuality(q: number): number {
  return Math.max(1, Math.min(100, Math.round(q)));
}

function formatFromPath(path: string): Format | null {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  if (ext === 'png') return 'png';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg';
  if (ext === 'webp') return 'webp';
  return null;
}
