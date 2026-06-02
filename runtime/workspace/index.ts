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
export { useHistory } from './history';
export type { HistoryControls } from './history';
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
