// Module-level tool registry. Tools register at boot via
// `registerBuiltinTools()` (cart/app/tools/builtins). Cart-specific
// tools can register their own surface by importing `register()` and
// calling it once at module load.
//
// Lookups are cheap; we keep a Map. Listing is rare (only the
// `list-tools` introspection tool calls it) so we don't memoize.
//
// This module lives in runtime/ (was cart/app/tools/registry.ts) so
// any cart can register tools into one shared surface and the
// claudewrap bridge can advertise the union via MCP without a
// cross-cart import. The cart/app/tools/registry.ts file is now a
// re-export shim that points here, so existing imports stay unbroken
// AND every importer (within a single bundle) shares the same Map.

import type { Tool } from './types';

const _registry = new Map<string, Tool<any, any>>();

export function register(tool: Tool<any, any>): void {
  if (_registry.has(tool.name)) {
    throw new Error(`tool: '${tool.name}' already registered`);
  }
  _registry.set(tool.name, tool);
}

export function unregister(name: string): void {
  _registry.delete(name);
}

export function get(name: string): Tool<any, any> | undefined {
  return _registry.get(name);
}

export function listTools(): Tool<any, any>[] {
  return Array.from(_registry.values());
}
