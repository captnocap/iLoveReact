// credentials.ts — TEMPORARY token store for source adapters.
//
// ⚠️  Placeholder. The real data layer (proper secrets handling, per-user
//     config, OAuth token refresh) lands in the next iteration. For now we
//     stash provider tokens in the runtime localstore under one namespace so
//     development can proceed without blocking on the secrets design.
//
// Everything goes through the CredentialStore interface, so swapping the
// backing store later is a one-file change — adapters call `getToken()` and
// never touch localstore directly.

import { nsGet, nsSet, nsDelete } from '@reactjit/runtime/hooks/localstore';
import type { SourceId } from './types';

/** localstore namespace for the temporary token stash. */
const NS = 'composer.sources.credentials';

export interface CredentialStore {
  /** Read a provider's API token / client id. null when unset. */
  getToken(provider: SourceId): string | null;
  /** Persist a provider's token. */
  setToken(provider: SourceId, token: string): void;
  /** Forget a provider's token. */
  clearToken(provider: SourceId): void;
}

/** The active store. Backed by localstore today; reassign in the next
 *  iteration to point at the real data layer without touching adapters. */
export const credentials: CredentialStore = {
  getToken(provider) {
    // nsGet returns '' on miss — normalize to null so callers branch cleanly.
    const v = nsGet(NS, provider);
    return v ? v : null;
  },
  setToken(provider, token) {
    nsSet(NS, provider, token);
  },
  clearToken(provider) {
    nsDelete(NS, provider);
  },
};

/** Convenience for adapters. */
export function getToken(provider: SourceId): string | null {
  return credentials.getToken(provider);
}
