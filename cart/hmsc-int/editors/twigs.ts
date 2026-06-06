// editors/twigs.ts — route working-state persistence.
//
// Branch/session commits are for authored edits and create undo points. Twigs
// are the route-local "how I was holding the tool" state: camera, brush, active
// tab, selected part, palette choice. They survive hot reload through the host
// hot-state store and never append to the V20 undo chain.

import { useCallback, useMemo } from 'react';
import { useHotState } from '@reactjit/hooks';
import { mkdir, readFile, writeFile } from '@reactjit/hooks/fs';

type Updater<T> = T | ((prev: T) => T);
type TwigFile = { version: 1; routes: Record<string, Record<string, unknown>> };

const TWIG_DIR = 'cart/hmsc-int/sessions';
const TWIG_PATH = `${TWIG_DIR}/_route-twigs.json`;

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9._/-]+/gi, '-').replace(/^-+|-+$/g, '') || 'root';
}

export function routeTwigKey(route: string, name: string): string {
  return `hmsc-int:twig:${safeSegment(route)}:${safeSegment(name)}`;
}

function emptyTwigFile(): TwigFile {
  return { version: 1, routes: {} };
}

function readTwigFile(): TwigFile {
  const text = readFile(TWIG_PATH);
  if (!text) return emptyTwigFile();
  try {
    const parsed = JSON.parse(text);
    if (!parsed || parsed.version !== 1 || typeof parsed.routes !== 'object') return emptyTwigFile();
    return parsed as TwigFile;
  } catch {
    return emptyTwigFile();
  }
}

function writeTwigFile(file: TwigFile): void {
  mkdir(TWIG_DIR);
  writeFile(TWIG_PATH, JSON.stringify(file));
}

export function readRouteTwigState<T>(route: string, name: string, initial: T): T {
  const file = readTwigFile();
  const routeKey = safeSegment(route);
  const value = file.routes[routeKey]?.[safeSegment(name)];
  return value === undefined ? initial : value as T;
}

export function writeRouteTwigState<T>(route: string, name: string, value: T): void {
  const file = readTwigFile();
  const routeKey = safeSegment(route);
  const nameKey = safeSegment(name);
  file.routes[routeKey] = { ...(file.routes[routeKey] ?? {}), [nameKey]: value as unknown };
  writeTwigFile(file);
}

export function patchRouteTwig<T extends Record<string, unknown>>(base: T, prev: Partial<T> | undefined, patch: Partial<T>): T {
  return { ...base, ...(prev ?? {}), ...patch };
}

export function useRouteTwigState<T>(route: string, name: string, initial: T): [T, (value: Updater<T>) => void] {
  const seed = useMemo(() => readRouteTwigState(route, name, initial), []);
  const [value, setValue] = useHotState<T>(routeTwigKey(route, name), seed);
  const set = useCallback((nextValue: Updater<T>) => {
    setValue((prev) => {
      const next = typeof nextValue === 'function' ? (nextValue as (p: T) => T)(prev) : nextValue;
      writeRouteTwigState(route, name, next);
      return next;
    });
  }, [name, route, setValue]);
  return [value, set];
}

export function useRouteTwig<T extends Record<string, unknown>>(
  route: string,
  name: string,
  initial: T,
): [T, (patch: Partial<T> | ((prev: T) => Partial<T>)) => void] {
  const seed = useMemo(() => readRouteTwigState<Partial<T>>(route, name, initial), []);
  const [raw, setRaw] = useHotState<Partial<T>>(routeTwigKey(route, name), seed);
  const value = useMemo(() => patchRouteTwig(initial, raw, {}), [initial, raw]);
  const patch = (nextPatch: Partial<T> | ((prev: T) => Partial<T>)): void => {
    setRaw((prev) => {
      const normalized = patchRouteTwig(initial, prev, {});
      const resolved = typeof nextPatch === 'function' ? nextPatch(normalized) : nextPatch;
      const next = patchRouteTwig(initial, normalized, resolved);
      writeRouteTwigState(route, name, next);
      return next;
    });
  };
  return [value, patch];
}
