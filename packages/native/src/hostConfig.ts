/**
 * React-reconciler host config for the native (QuickJS FFI) renderer.
 *
 * Ported from reactor01's renderer.js to TypeScript.
 * Emits mutation commands (CREATE, APPEND, UPDATE, etc.) that get serialized
 * as JSON and sent to Lua via __hostFlush.
 */

import type { HostConfig } from 'react-reconciler';
import { reportError } from './errorReporter';

// ── Types ────────────────────────────────────────────────

export interface Instance {
  id: number;
  type: string;
  props: Record<string, any>;
  handlers: Record<string, Function>;
  children: Instance[];
}

export interface TextInstance {
  id: number;
  text: string;
}

type Container = { id: number };
type Props = Record<string, any>;
type UpdatePayload = Record<string, any> | null;

interface Command {
  op: string;
  [key: string]: any;
}

// ── Globals / FFI bridge ─────────────────────────────────

declare const globalThis: {
  __hostFlush: (commands: Command[]) => void;
  __hostGetEvents: () => any[];
  _pollAndDispatchEvents?: () => void;
  [key: string]: any;
};

// ── State ────────────────────────────────────────────────

let nodeIdCounter = 0;
const pendingCommands: Command[] = [];

/**
 * Registry of event handlers keyed by nodeId.
 * Handlers never cross the bridge — they stay in JS.
 * Lua sends events referencing targetId, and we dispatch here.
 */
export const handlerRegistry = new Map<number, Record<string, Function>>();

// ── Helpers ──────────────────────────────────────────────

function emit(cmd: Command): void {
  pendingCommands.push(cmd);
}

/**
 * Merge multiple UPDATE commands targeting the same node into a single command.
 * Non-UPDATE commands and UPDATEs for distinct nodes pass through unchanged.
 */
function coalesceCommands(commands: Command[]): Command[] {
  const updateMap = new Map<number, number>(); // nodeId -> index in output
  const output: Command[] = [];

  for (const cmd of commands) {
    if (cmd.op === 'UPDATE' && cmd.id != null) {
      const existingIdx = updateMap.get(cmd.id);
      if (existingIdx !== undefined) {
        const existing = output[existingIdx];
        // Merge props
        existing.props = { ...existing.props, ...cmd.props };
        // Merge style sub-objects
        if (existing.props.style && cmd.props.style) {
          existing.props.style = { ...existing.props.style, ...cmd.props.style };
        }
        // Merge removal arrays
        if (cmd.removeKeys) {
          existing.removeKeys = [...(existing.removeKeys || []), ...cmd.removeKeys];
        }
        if (cmd.removeStyleKeys) {
          existing.removeStyleKeys = [...(existing.removeStyleKeys || []), ...cmd.removeStyleKeys];
        }
        // Latest hasHandlers wins
        if (cmd.hasHandlers !== undefined) {
          existing.hasHandlers = cmd.hasHandlers;
        }
        continue;
      }
      updateMap.set(cmd.id, output.length);
    }
    output.push({ ...cmd });
  }

  return output;
}

export function flushToHost(): void {
  if (pendingCommands.length === 0) return;
  const coalesced = coalesceCommands(pendingCommands);
  try {
    globalThis.__hostFlush(coalesced);
  } catch (e) {
    reportError(e, 'flushToHost (' + coalesced.length + ' commands)');
  }
  pendingCommands.length = 0;
}

/**
 * Separate on* handler props from regular props.
 * Handlers stay in JS; only clean props cross the bridge.
 */
export function extractHandlers(
  props: Props
): { clean: Record<string, any>; handlers: Record<string, Function> } {
  const clean: Record<string, any> = {};
  const handlers: Record<string, Function> = {};

  for (const key of Object.keys(props)) {
    if (key === 'children') continue;
    if (key.startsWith('on') && typeof props[key] === 'function') {
      handlers[key] = props[key];
    } else {
      clean[key] = props[key];
    }
  }

  return { clean, handlers };
}

/**
 * Shallow equality check for prop diffing.
 */
export function shallowEqual(
  a: Record<string, any>,
  b: Record<string, any>
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Compare two handler maps by reference equality of each handler.
 */
function handlersEqual(a: Record<string, Function>, b: Record<string, Function>): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Compute a partial diff between two style objects.
 * Returns changed keys (with new values) and removed keys.
 */
function diffStyleObjects(
  oldStyle: Record<string, any>,
  newStyle: Record<string, any>
): { changed: Record<string, any> | null; removed: string[] } {
  const changed: Record<string, any> = {};
  const removed: string[] = [];
  let hasChanged = false;

  for (const key of Object.keys(newStyle)) {
    if (oldStyle[key] !== newStyle[key]) {
      changed[key] = newStyle[key];
      hasChanged = true;
    }
  }

  for (const key of Object.keys(oldStyle)) {
    if (!(key in newStyle)) {
      removed.push(key);
    }
  }

  return {
    changed: hasChanged ? changed : null,
    removed,
  };
}

/**
 * Compute a minimal diff between two clean prop objects.
 * Returns the changed props (with partial style diff), removed top-level keys,
 * and removed style keys. Returns null if nothing changed.
 */
function diffCleanProps(
  oldClean: Record<string, any>,
  newClean: Record<string, any>
): { diff: Record<string, any>; removeKeys: string[]; removeStyleKeys: string[] } | null {
  const diff: Record<string, any> = {};
  const removeKeys: string[] = [];
  let removeStyleKeys: string[] = [];
  let hasDiff = false;

  for (const key of Object.keys(newClean)) {
    const oldVal = oldClean[key];
    const newVal = newClean[key];

    if (key === 'style') {
      const styleDiff = diffStyleObjects(oldVal || {}, newVal || {});
      if (styleDiff.changed) {
        diff.style = styleDiff.changed;
        hasDiff = true;
      }
      removeStyleKeys = styleDiff.removed;
      if (removeStyleKeys.length > 0) hasDiff = true;
    } else if (oldVal !== newVal) {
      diff[key] = newVal;
      hasDiff = true;
    }
  }

  for (const key of Object.keys(oldClean)) {
    if (key === 'style') continue; // handled above
    if (!(key in newClean)) {
      removeKeys.push(key);
      hasDiff = true;
    }
  }

  return hasDiff ? { diff, removeKeys, removeStyleKeys } : null;
}

// ── DefaultEventPriority ────────────────────────────────

const DefaultEventPriority = 0b0000000000000000000000000010000;

// ── Host Config ──────────────────────────────────────────

export const hostConfig: HostConfig<
  string,         // Type
  Props,          // Props
  Container,      // Container
  Instance,       // Instance
  TextInstance,    // TextInstance
  never,          // SuspenseInstance
  never,          // HydratableInstance
  Instance,       // PublicInstance
  {},             // HostContext
  UpdatePayload,  // UpdatePayload
  unknown,        // ChildSet
  number,         // TimeoutHandle
  number           // NoTimeout
> = {
  // ── Feature flags ────────────────────────────────────

  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,

  // ── Context ──────────────────────────────────────────

  getRootHostContext() {
    return {};
  },

  getChildHostContext(_parentContext: {}) {
    return {};
  },

  // ── Instance creation ────────────────────────────────

  createInstance(type: string, props: Props): Instance {
    const id = ++nodeIdCounter;
    const { clean, handlers } = extractHandlers(props);

    const hasHandlers = Object.keys(handlers).length > 0;

    emit({
      op: 'CREATE',
      id,
      type,
      props: clean,
      hasHandlers,
    });

    if (hasHandlers) {
      handlerRegistry.set(id, handlers);
    }

    return { id, type, props: clean, handlers, children: [] };
  },

  createTextInstance(text: string): TextInstance {
    const id = ++nodeIdCounter;
    emit({ op: 'CREATE_TEXT', id, text });
    return { id, text };
  },

  // ── Tree building (pre-commit) ──────────────────────

  appendInitialChild(parent: Instance, child: Instance | TextInstance) {
    (parent.children as any[]).push(child);
    emit({ op: 'APPEND', parentId: parent.id, childId: child.id });
  },

  finalizeInitialChildren() {
    return false;
  },

  // ── Mutations ────────────────────────────────────────

  appendChild(parent: Instance, child: Instance | TextInstance) {
    (parent.children as any[]).push(child);
    emit({ op: 'APPEND', parentId: parent.id, childId: child.id });
  },

  appendChildToContainer(container: Container, child: Instance | TextInstance) {
    emit({ op: 'APPEND_TO_ROOT', childId: child.id });
  },

  removeChild(parent: Instance, child: Instance | TextInstance) {
    const idx = (parent.children as any[]).indexOf(child);
    if (idx !== -1) (parent.children as any[]).splice(idx, 1);
    emit({ op: 'REMOVE', parentId: parent.id, childId: child.id });
    cleanupHandlers(child);
  },

  removeChildFromContainer(_container: Container, child: Instance | TextInstance) {
    emit({ op: 'REMOVE_FROM_ROOT', childId: child.id });
    cleanupHandlers(child);
  },

  insertBefore(
    parent: Instance,
    child: Instance | TextInstance,
    before: Instance | TextInstance
  ) {
    const arr = parent.children as any[];
    const idx = arr.indexOf(before);
    if (idx !== -1) {
      arr.splice(idx, 0, child);
    } else {
      arr.push(child);
    }
    emit({
      op: 'INSERT_BEFORE',
      parentId: parent.id,
      childId: child.id,
      beforeId: before.id,
    });
  },

  insertInContainerBefore(
    _container: Container,
    child: Instance | TextInstance,
    before: Instance | TextInstance
  ) {
    emit({
      op: 'INSERT_BEFORE_ROOT',
      childId: child.id,
      beforeId: before.id,
    });
  },

  // ── Updates ──────────────────────────────────────────

  prepareUpdate(
    _instance: Instance,
    _type: string,
    oldProps: Props,
    newProps: Props
  ): UpdatePayload {
    const { clean: oldClean, handlers: oldH } = extractHandlers(oldProps);
    const { clean: newClean, handlers: newH } = extractHandlers(newProps);

    const handlersChanged = !handlersEqual(oldH, newH);
    const propsDiff = diffCleanProps(oldClean, newClean);

    if (!propsDiff && !handlersChanged) return null;

    if (!propsDiff && handlersChanged) {
      return { __handlersOnly: true };
    }

    return propsDiff; // { diff, removeKeys, removeStyleKeys }
  },

  commitUpdate(
    instance: Instance,
    updatePayload: UpdatePayload,
    _type: string,
    _oldProps: Props,
    newProps: Props
  ) {
    const { clean, handlers } = extractHandlers(newProps);

    // Update handler registry
    if (Object.keys(handlers).length > 0) {
      handlerRegistry.set(instance.id, handlers);
    } else {
      handlerRegistry.delete(instance.id);
    }

    instance.handlers = handlers;
    instance.props = clean;

    if (updatePayload && !(updatePayload as any).__handlersOnly) {
      const hasHandlers = Object.keys(handlers).length > 0;
      const payload = updatePayload as { diff: Record<string, any>; removeKeys: string[]; removeStyleKeys: string[] };

      const cmd: any = {
        op: 'UPDATE',
        id: instance.id,
        props: payload.diff,
        hasHandlers,
      };

      if (payload.removeKeys.length > 0) {
        cmd.removeKeys = payload.removeKeys;
      }
      if (payload.removeStyleKeys.length > 0) {
        cmd.removeStyleKeys = payload.removeStyleKeys;
      }

      emit(cmd);
    } else if (updatePayload && (updatePayload as any).__handlersOnly) {
      // Still need to inform Lua about hasHandlers change
      const hasHandlers = Object.keys(handlers).length > 0;
      emit({
        op: 'UPDATE',
        id: instance.id,
        props: {},
        hasHandlers,
      });
    }
  },

  commitTextUpdate(_textInstance: TextInstance, _oldText: string, newText: string) {
    _textInstance.text = newText;
    emit({ op: 'UPDATE_TEXT', id: _textInstance.id, text: newText });
  },

  // ── Commit lifecycle ─────────────────────────────────

  prepareForCommit() {
    return null;
  },

  resetAfterCommit() {
    flushToHost();
  },

  // ── Misc required methods ────────────────────────────

  shouldSetTextContent() {
    return false;
  },

  getPublicInstance(instance: Instance) {
    return instance;
  },

  preparePortalMount() {},

  scheduleTimeout: setTimeout,
  cancelTimeout: clearTimeout,
  noTimeout: -1,

  getCurrentEventPriority() {
    return DefaultEventPriority;
  },

  getInstanceFromNode() {
    return null;
  },

  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},

  prepareScopeUpdate() {},
  getInstanceFromScope() {
    return null;
  },

  detachDeletedInstance() {},

  clearContainer() {},
};

// ── Internal helpers ─────────────────────────────────────

function cleanupHandlers(node: Instance | TextInstance): void {
  if ('id' in node) {
    handlerRegistry.delete(node.id);
  }
  if ('children' in node) {
    for (const child of (node as Instance).children) {
      cleanupHandlers(child);
    }
  }
}
