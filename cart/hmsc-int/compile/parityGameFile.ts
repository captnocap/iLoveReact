// parityGameFile.ts - TypeScript side of the hmsc compile parity benchmark.
//
// This does not read the live editor stores. It reads one deterministic source
// spec, generates the same large world data the Zig parity compiler generates,
// and writes the platform game-file with the existing TS workspace writer.

import { readFile, writeFileBytesAtomic } from '@reactjit/hooks/fs';
import {
  MAP_LUMP,
  encodeBinaryRleGrid,
  textBytes,
  writeLumpContainer,
} from '@reactjit/workspace/lumps';
import { encodeGrid } from '@reactjit/workspace/rle';
import { writeGameFile, type GameAsset } from '@reactjit/workspace/gamefile';

declare const globalThis: any;

type Spec = {
  width: number;
  height: number;
  seed: number;
  assetCount: number;
  assetBytes: number;
};

const STRINGS = ['null', 'road', 'grass', 'asphalt', 'sidewalk', 'mud', 'sand', 'water', 'foliage'];

function nowMs(): number {
  return typeof globalThis.__nowMs === 'function' ? globalThis.__nowMs() : Date.now();
}

function argValue(name: string): string | null {
  const argv: string[] = globalThis.process?.argv ?? [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1]) return String(argv[i + 1]);
    const prefix = `${name}=`;
    if (String(argv[i]).startsWith(prefix)) return String(argv[i]).slice(prefix.length);
  }
  return null;
}

function parseSource(text: string): Spec {
  const values = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    values.set(line.slice(0, eq), line.slice(eq + 1));
  }
  if (values.get('format') !== 'hmsc.parity.v0') throw new Error('parity source format must be hmsc.parity.v0');
  const intValue = (key: string, fallback: number): number => {
    const parsed = Number(values.get(key) ?? fallback);
    if (!Number.isFinite(parsed)) throw new Error(`invalid parity source ${key}`);
    return Math.floor(parsed);
  };
  return {
    width: intValue('width', 1536),
    height: intValue('height', 1536),
    seed: intValue('seed', 0x5eed1234) >>> 0,
    assetCount: intValue('asset_count', 8),
    assetBytes: intValue('asset_bytes', 4096),
  };
}

function cellHash(x: number, y: number, seed: number): number {
  let h = (Math.imul((x + 0x9e3779b9) | 0, 0x85ebca6b) ^ Math.imul((y + 0xc2b2ae35) | 0, 0x27d4eb2d) ^ (seed | 0)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

function tileValue(x: number, y: number, seed: number): number | null {
  if ((x % 64) === 0 || (y % 64) === 0) return 1; // road
  const h = cellHash(x, y, seed);
  if ((h & 0x3f) === 0) return null;
  return 2 + (h % 7);
}

function heightValue(x: number, y: number, seed: number): number {
  return cellHash(Math.floor(x / 4), Math.floor(y / 4), seed ^ 0xa511e9b3) & 0x03ff;
}

function assetPayload(index: number, bytes: number, seed: number): Uint8Array {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < out.length; i += 1) out[i] = cellHash(index, i, seed ^ 0x51ed1234) & 0xff;
  return out;
}

function gridValues(spec: Spec, fn: (x: number, y: number, seed: number) => number | null): Array<number | null> {
  const values = new Array<number | null>(spec.width * spec.height);
  let at = 0;
  for (let y = 0; y < spec.height; y += 1) {
    for (let x = 0; x < spec.width; x += 1) values[at++] = fn(x, y, spec.seed);
  }
  return values;
}

function stringsText(): string {
  return STRINGS.map((value, index) => `${index}\t${value}`).join('\n') + '\n';
}

function boundsJson(spec: Spec): string {
  return `{"depth":${spec.height},"minX":0,"minZ":0,"width":${spec.width}}`;
}

function compile(spec: Spec): Uint8Array {
  const tiles = encodeBinaryRleGrid(encodeGrid(gridValues(spec, tileValue), spec.width, spec.height), 16);
  const heights = encodeBinaryRleGrid(encodeGrid(gridValues(spec, heightValue), spec.width, spec.height), 16);
  const bounds = boundsJson(spec);
  const mapContainer = writeLumpContainer([
    { type: MAP_LUMP.STRINGS, encoding: 'text', data: textBytes(stringsText()) },
    { type: MAP_LUMP.TILES, encoding: 'rle16', data: tiles },
    { type: MAP_LUMP.HEIGHTS, encoding: 'rle16', data: heights },
    { type: MAP_LUMP.ZONES, encoding: 'text', data: textBytes(`{"bounds":${bounds},"zones":[]}`) },
    { type: MAP_LUMP.PLACEMENTS, encoding: 'text', data: textBytes('{"landforms":[],"placedCells":[],"props":[]}') },
    {
      type: MAP_LUMP.ENTITIES,
      encoding: 'text',
      data: textBytes(`format=hmsc.parity.v0\nwidth=${spec.width}\nheight=${spec.height}\nseed=${spec.seed}\n`),
    },
  ]);

  const assets: GameAsset[] = [];
  const refs: number[] = [];
  for (let i = 0; i < spec.assetCount; i += 1) {
    const key = 1000 + i;
    refs.push(key);
    assets.push({ key, kind: 30 + (i % 4), bytes: assetPayload(i, spec.assetBytes, spec.seed), embed: true });
  }

  return writeGameFile({
    logic: { refs: [], data: textBytes(`format=hmsc.logic.parity.v0\nseed=${spec.seed}\n`) },
    map: { refs, data: mapContainer },
    skins: { refs: [], data: textBytes(`format=hmsc.skins.parity.v0\nassets=${spec.assetCount}\n`) },
    assets,
  });
}

function main(): number {
  const sourcePath = argValue('--source');
  const outPath = argValue('--out');
  if (!sourcePath || !outPath) {
    console.error('usage: v8cli parityGameFile.js --source <spec> --out <gamefile>');
    return 2;
  }
  const t0 = nowMs();
  const source = readFile(sourcePath);
  if (source === null) throw new Error(`could not read parity source: ${sourcePath}`);
  const spec = parseSource(source);
  const file = compile(spec);
  if (!writeFileBytesAtomic(outPath, file)) throw new Error(`could not write parity game-file: ${outPath}`);
  const elapsedMs = nowMs() - t0;
  console.log(JSON.stringify({
    compiler: 'typescript',
    source: sourcePath,
    out: outPath,
    width: spec.width,
    height: spec.height,
    cells: spec.width * spec.height,
    bytes: file.byteLength,
    compileMs: elapsedMs,
  }));
  return 0;
}

const code = main();
const exit = globalThis.__exit;
if (typeof exit === 'function') exit(code);
