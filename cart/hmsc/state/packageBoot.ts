// packageBoot.ts — hmsc mod-side parser for opaque package ENTITIES text.

import type { GameState } from '../design';
import { reviveGameState } from './gameState';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToText(value: string): string {
  const clean = value.replace(/\s+/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = BASE64.indexOf(clean[i] ?? 'A');
    const c1 = BASE64.indexOf(clean[i + 1] ?? 'A');
    const c2 = clean[i + 2] === '=' ? -1 : BASE64.indexOf(clean[i + 2] ?? 'A');
    const c3 = clean[i + 3] === '=' ? -1 : BASE64.indexOf(clean[i + 3] ?? 'A');
    if (c0 < 0 || c1 < 0) throw new Error('invalid package base64');
    const n = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
    bytes.push((n >>> 16) & 255);
    if (c2 >= 0) bytes.push((n >>> 8) & 255);
    if (c3 >= 0) bytes.push(n & 255);
  }
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return decodeURIComponent(escape(out));
}

export function readPackagedGameState(): GameState | null {
  const pkg = (globalThis as any).__rjpkg;
  const text = typeof pkg?.entitiesText === 'string' ? pkg.entitiesText : '';
  if (!text) return null;
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq) !== 'state_json_base64') continue;
    return reviveGameState(base64ToText(line.slice(eq + 1)));
  }
  return null;
}
