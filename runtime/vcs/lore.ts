/**
 * Low-level declarative door to the native Lore snapshot chain.
 *
 * The backend owns request validation and response schemas. This module keeps
 * React/UI code out of the host-global namespace while deliberately preserving
 * the JSON-object boundary until the version-browser UI defines its views.
 * Importing this file is also the source-driven `has-lore` build signal.
 */

import { callHostJson } from '../ffi';

declare module '../ffi' {
  interface HostCalls {
    __lore_snapshot(requestJson: string): string;
    __lore_history(requestJson: string): string;
    __lore_preview(requestJson: string): string;
    __lore_restore(requestJson: string): string;
    __lore_pin(requestJson: string): string;
    __lore_server_status(requestJson: string): string;
  }
}

export type LoreRequest = Readonly<Record<string, unknown>>;

export type LoreResponse = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

const unavailable: LoreResponse = {
  ok: false,
  error: 'Lore host capability is unavailable',
};

function request(name: string, payload: LoreRequest = {}): LoreResponse {
  return callHostJson<LoreResponse>(name, unavailable, JSON.stringify(payload));
}

/** Capture the exact native-resident model document, independent of normal Save. */
export function loreSnapshot(payload: LoreRequest): LoreResponse {
  return request('__lore_snapshot', payload);
}

export function loreHistory(payload: LoreRequest): LoreResponse {
  return request('__lore_history', payload);
}

/** Read a historical model without checking it out or disturbing the live session. */
export function lorePreview(payload: LoreRequest): LoreResponse {
  return request('__lore_preview', payload);
}

export function loreRestore(payload: LoreRequest): LoreResponse {
  return request('__lore_restore', payload);
}

export function lorePin(payload: LoreRequest): LoreResponse {
  return request('__lore_pin', payload);
}

export function loreServerStatus(payload: LoreRequest = {}): LoreResponse {
  return request('__lore_server_status', payload);
}
