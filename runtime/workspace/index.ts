// runtime/workspace — stateless-cart-over-disk for workspace-style carts.
//
// Extract of the persistence/history/restore pattern from cart/cutout/,
// generalized so any iterative cart (composer, editor, sketchpad) can
// inherit the same shape:
//
//   const ws = useWorkspace<MyPayload>({
//     cartName: 'mycart',
//     version: 1,
//     buildPayload: () => ({ /* current state */ }),
//     applyPayload: (env) => { /* restore from env.payload */ },
//     deps: [/* state slices that should trigger autosave */],
//   });
//
// File format spec (see envelope.ts):
//   { kind, version, savedAt, stem, payload }
//
// Disk layout (see paths.ts):
//   cart/<cartName>/sessions/_last.txt
//   cart/<cartName>/sessions/<stem>.session.json

export { useWorkspace } from './useWorkspace';
export type { WorkspaceArgs, WorkspaceControls } from './useWorkspace';
export { workspaceHotCurrentKey, workspaceHotHistoryKey } from './useWorkspace';
export { createHistoryModel, useHistory } from './history';
export type { HistoryControls, HistorySnapshot } from './history';
export {
  buildEnvelope,
  parseEnvelope,
  serializeEnvelope,
} from './envelope';
export type { SessionEnvelope, BuildEnvelopeArgs, ParseEnvelopeArgs } from './envelope';
export {
  sessionsDirFor,
  sessionPathFor,
  lastPointerPath,
} from './paths';
export {
  encodeGrid,
  decodeGrid,
  encodeRleRow,
  decodeRleRow,
} from './rle';
export type { RleEntry, RleRows, RleGrid } from './rle';
export {
  LUMP_MAGIC,
  LUMP_FORMAT_VERSION,
  LUMP_ALIGNMENT,
  LUMP_HEADER_BYTES,
  LUMP_DIRECTORY_ENTRY_BYTES,
  LUMP_ENCODING,
  MAP_LUMP,
  textBytes,
  bytesText,
  bytesToBase64,
  base64ToBytes,
  writeLumpContainer,
  readLumpContainer,
  findLump,
  encodeBinaryRleGrid,
  decodeBinaryRleGrid,
  quantizeHeightfield,
  dequantizeHeightfield,
} from './lumps';
export type { LumpEncoding, LumpInput, LumpDirectoryEntry, LumpRecord, QuantizedHeightfield } from './lumps';
