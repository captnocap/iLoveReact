// Barrel export for the assistant tool surface.

export type {
  Tool,
  ToolCall,
  ToolResult,
  ToolScope,
  ToolPermission,
} from './types';
export { register, unregister, get, listTools } from './registry';
export {
  ensureGrantsLoaded,
  reloadGrants,
  checkPermission,
  grantPermission,
  revokePermission,
  activeGrants,
  useGrants,
} from './permissions';
export type { GrantOptions } from './permissions';
export {
  invokeTool,
  encodeToolReply,
  parseToolReply,
  encodeGrantReply,
  parseGrantReply,
} from './dispatch';
export type { ParsedGrant } from './dispatch';
export { registerBuiltinTools, setRouteRef } from './builtins';
export { registerBrowseTools } from './browse';
