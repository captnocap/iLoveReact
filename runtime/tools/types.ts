// Assistant tool surface — shape definitions.
//
// A Tool is a named action the assistant can invoke (read user data,
// edit data, navigate, etc.). Tools are registered at module load time
// via runtime/tools/registry and looked up by name at dispatch.
//
// This module lives in runtime/ (was cart/app/tools/types.ts) so any
// cart — chat host, claudewrap bridge, hmsc-int, the test labs — can
// share a single tool surface. The original cart/app/tools/types.ts
// is now a re-export shim that points here, so existing imports stay
// unbroken.
//
// Permission semantics still live in cart/app/tools/permissions because
// they depend on the cart's pg-backed grant store. The dispatcher in
// cart/app/tools/dispatch glues registry (here) + permissions (cart) +
// handlers (anywhere) together.

/** Required permission for a tool call. The dispatcher derives this
 *  from the call's args (e.g. `update-entity` with `entity=task` →
 *  `{ tool: 'update-entity', scope: 'task' }`). The user grants
 *  permissions as `(tool, scope)` pairs; matching is wildcard-aware
 *  (see cart/app/tools/permissions). */
export interface ToolScope {
  tool: string;
  scope: string; // '*' for any, or a tool-specific identifier
}

export interface Tool<Args = any, Value = any> {
  /** Unique tool name. Used as the lookup key and the permission
   *  `tool` field. Convention: lowercase-dashed (`list-entity`). */
  name: string;
  /** One-line description shown to the model via `list-tools`. */
  description: string;
  /** Args schema as a human-readable string for now (e.g.
   *  "{ name: string, query?: { where?, orderBy?, limit?, offset? } }").
   *  Fed into the system prompt so the model knows how to call. */
  argsSchema: string;
  /** Derive the permission scope from a specific call's args. The
   *  dispatcher passes the call to checkPermission(tool, scope). For a
   *  pure read tool with no per-target gating, return `'*'`. */
  scopeOf: (args: Args) => string;
  /** The actual work. Throw to surface an error to the assistant. */
  handler: (args: Args) => Promise<Value> | Value;
}

export interface ToolCall<Args = any> {
  name: string;
  args: Args;
}

export type ToolResult<Value = any> =
  | { ok: true; value: Value }
  | {
      ok: false;
      error: string;
      /** Set when the failure was specifically a missing grant. The
       *  provider uses this to render a one-tap grant card and queue
       *  the original call to re-fire after grant. */
      requires?: ToolScope;
    };

/** A permission grant. Stored in the `user` bucket as entity
 *  `tool-permission`. Matching is wildcard-aware via the rules in
 *  cart/app/tools/permissions:matchesGrant. */
export interface ToolPermission {
  id: string;
  /** Tool name to grant. Use `'*'` to grant any tool. */
  tool: string;
  /** Scope expression. Exact string, `'*'` (any), or a tool-specific
   *  pattern (path prefix for navigate; entity name for *-entity). */
  scope: string;
  /** ISO. Set on grant. */
  granted_at: string;
  /** ISO. Optional auto-revoke. Null = forever. */
  expires_at?: string | null;
  /** Free-text the user wrote when granting (or auto-filled by the
   *  grant card). Useful for the "what did I grant?" rail later. */
  note?: string;
}
