// runtime/tools — shared tool surface for every cart in the project.
//
// Carts register tool definitions here; the chat infrastructure in
// cart/app/tools/{dispatch,permissions} handles permission gating and
// dispatch; the claudewrap bridge advertises the union via MCP.
//
// Permission semantics (grant store, checkPermission, etc.) stay in
// cart/app/tools/permissions because they depend on the cart's pg
// layer. Carts that need the gated dispatcher import from
// cart/app/tools (via its barrel) as before — that barrel re-exports
// from here for the runtime-shared pieces.

export type { Tool, ToolCall, ToolResult, ToolScope, ToolPermission } from './types';
export { register, unregister, get, listTools } from './registry';
