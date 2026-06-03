// Re-export shim. The real registry (and its module-level Map) now
// lives in runtime/tools/registry so every cart in this bundle shares
// the same registered-tools set, and the claudewrap bridge can
// advertise them via MCP without a cross-cart import. Local importers
// keep their `from './registry'` lines unchanged — this file just
// forwards.
export * from '@reactjit/tools/registry';
