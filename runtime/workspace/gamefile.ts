// gamefile.ts — the platform game-file writer (PLATMOD §2-4, V28/V29).
//
// A shipped game is DATA: an asset vocabulary (content-addressed blobs) plus
// THREE RLE streams that compose those assets BY REFERENCE:
//   (a) game-logic  — parameters the stateless behavior capabilities read
//   (b) game-map    — tiles/heights/zones/placements (a nested RJMP map container)
//   (c) items/skins — custom author-made assets
//
// This module is the WRITER half. It lays the three streams + the asset
// manifest + the asset blobs into one top-level RJMP container (lumps.ts). The
// Zig loader (framework/world/gamefile.zig) is the reader half: it ingests the
// streams, installs every asset into the content store keyed by sha256, and
// resolves every reference before anything is constructed. NO constructor here.
//
// Wire contract: docs/game/RLE_FORMAT.md §7.

import { writeLumpContainer, type LumpInput } from './lumps';
import { sha256 } from './sha256';

// Top-level game-file lump type ids (distinct range from the map sub-lumps 1-6).
export const GAME_LUMP = {
  STREAM_LOGIC: 16,
  STREAM_MAP: 17,
  STREAM_SKINS: 18,
  ASSET_MANIFEST: 19,
  ASSET_BLOB: 20,
} as const;

export const ASSET_MANIFEST_ENTRY_BYTES = 44; // key(4) kind(2) rsv(2) length(4) hash(32)
export const ASSET_HASH_BYTES = 32;

/** One content-addressed vocabulary asset (a building, texture, model, skin…). */
export interface GameAsset {
  key: number; // stable id the streams reference
  kind: number; // asset-kind tag (building/texture/model/skin…)
  bytes: Uint8Array; // the baked payload; its sha256 IS its address
  embed?: boolean; // false when the bake preinstalls this content-addressed asset
}

/** A composed stream: the asset keys it references + its own RLE/container data. */
export interface GameStream {
  refs: number[];
  data: Uint8Array;
}

export interface GameFileInput {
  logic: GameStream;
  map: GameStream; // map.data is a nested RJMP map container (lumps.ts)
  skins: GameStream;
  assets: GameAsset[];
}

// ── stream payload: refCount | refs[] | dataLen | data ────────────────────

export function encodeStream(stream: GameStream): Uint8Array {
  const refCount = stream.refs.length;
  const out = new Uint8Array(4 + refCount * 4 + 4 + stream.data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, refCount, true);
  let at = 4;
  for (const ref of stream.refs) {
    view.setUint32(at, ref >>> 0, true);
    at += 4;
  }
  view.setUint32(at, stream.data.byteLength, true);
  at += 4;
  out.set(stream.data, at);
  return out;
}

// ── asset manifest: count | { key, kind, rsv, length, hash[32] } × count ──

export function encodeManifest(assets: GameAsset[]): Uint8Array {
  const out = new Uint8Array(4 + assets.length * ASSET_MANIFEST_ENTRY_BYTES);
  const view = new DataView(out.buffer);
  view.setUint32(0, assets.length, true);
  let at = 4;
  for (const asset of assets) {
    const hash = sha256(asset.bytes);
    view.setUint32(at + 0, asset.key >>> 0, true);
    view.setUint16(at + 4, asset.kind & 0xffff, true);
    view.setUint16(at + 6, 0, true);
    view.setUint32(at + 8, asset.bytes.byteLength, true);
    out.set(hash, at + 12);
    at += ASSET_MANIFEST_ENTRY_BYTES;
  }
  return out;
}

// ── asset blob: claimedHash[32] | payload ─────────────────────────────────

export function encodeBlob(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(ASSET_HASH_BYTES + bytes.byteLength);
  out.set(sha256(bytes), 0);
  out.set(bytes, ASSET_HASH_BYTES);
  return out;
}

/** Lay the three streams + asset vocabulary into one top-level RJMP container. */
export function writeGameFile(input: GameFileInput): Uint8Array {
  const lumps: LumpInput[] = [
    { type: GAME_LUMP.STREAM_LOGIC, encoding: 'raw', data: encodeStream(input.logic) },
    { type: GAME_LUMP.STREAM_MAP, encoding: 'raw', data: encodeStream(input.map) },
    { type: GAME_LUMP.STREAM_SKINS, encoding: 'raw', data: encodeStream(input.skins) },
    { type: GAME_LUMP.ASSET_MANIFEST, encoding: 'raw', data: encodeManifest(input.assets) },
  ];
  for (const asset of input.assets) {
    if (asset.embed === false) continue;
    lumps.push({ type: GAME_LUMP.ASSET_BLOB, encoding: 'raw', data: encodeBlob(asset.bytes) });
  }
  return writeLumpContainer(lumps);
}
