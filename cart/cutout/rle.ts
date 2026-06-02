// rle.ts — re-export shim.
//
// The row-RLE grid codec that began here has been promoted to the shared
// workspace layer (runtime/workspace/rle.ts) so every workspace cart —
// cutout, hmsc-int, ... — uses ONE codec, not parallel copies. This file
// stays so cutout's existing `from './rle'` imports keep resolving.
export * from '@reactjit/workspace/rle';
