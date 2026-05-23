// session.ts — composer-specific session constants.
//
// The envelope shape and persistence machinery live in
// runtime/workspace/; this module just nails down the per-cart names
// (CART_NAME, VERSION) and re-exports the paths bound to them for
// convenience.

import {
  sessionsDirFor,
  sessionPathFor,
  lastPointerPath,
} from '@reactjit/runtime/workspace';

export const CART_NAME = 'composer';
export const SESSION_VERSION = 1;

export const SESSION_DIR = sessionsDirFor(CART_NAME);
export const SESSION_LAST_POINTER = lastPointerPath(CART_NAME);
export function sessionPath(stem: string): string {
  return sessionPathFor(CART_NAME, stem);
}

/** Where sample WAVs for a given project live on disk. Sidecar to the
 *  session JSON; one folder per project so unrelated projects don't
 *  mingle their assets. */
export function samplesDirFor(stem: string): string {
  return `cart/${CART_NAME}/samples/${stem}`;
}

export function samplePathFor(stem: string, id: string): string {
  return `${samplesDirFor(stem)}/${id}.wav`;
}
