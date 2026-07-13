// Native-application settings: one declaration produces validation,
// persistence, reset behavior, search metadata, and Preferences controls.

import { configDir, readFile, writeFileBytesAtomic } from '../hooks/fs';

export type SettingValue = boolean | number | string;
export type SettingKind = 'boolean' | 'number' | 'enum';

export type SettingOption = Readonly<{ value: string; label: string }>;

export type SettingDefinition<T extends SettingValue = SettingValue> = Readonly<{
  id: string;
  section: string;
  label: string;
  description: string;
  kind: SettingKind;
  defaultValue: T;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly SettingOption[];
}>;

export interface SettingsBackend {
  readonly location: string | null;
  read(): string | null;
  write(text: string): boolean;
}

type SettingsEnvelope = {
  version: 1;
  values: Record<string, SettingValue>;
};

const REGISTRIES = new WeakMap<SettingRegistry, Map<string, SettingDefinition>>();

function definitionsFor(registry: SettingRegistry): Map<string, SettingDefinition> {
  const defs = REGISTRIES.get(registry);
  if (!defs) throw new Error('settings: invalid registry');
  return defs;
}

function normalize(def: SettingDefinition, candidate: unknown): SettingValue | undefined {
  if (def.kind === 'boolean') return typeof candidate === 'boolean' ? candidate : undefined;
  if (def.kind === 'enum') {
    if (typeof candidate !== 'string') return undefined;
    return def.options?.some((option) => option.value === candidate) ? candidate : undefined;
  }
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return undefined;
  const min = def.min ?? Number.NEGATIVE_INFINITY;
  const max = def.max ?? Number.POSITIVE_INFINITY;
  const clamped = Math.min(max, Math.max(min, candidate));
  const step = def.step && def.step > 0 ? def.step : 0;
  if (!step || !Number.isFinite(min)) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(8))));
}

export class SettingRegistry {
  constructor() { REGISTRIES.set(this, new Map()); }

  register<T extends SettingValue>(definition: SettingDefinition<T>): SettingDefinition<T> {
    const defs = definitionsFor(this);
    const id = definition.id.trim();
    if (!id) throw new Error('settings: id cannot be empty');
    if (defs.has(id)) throw new Error(`settings: duplicate id '${id}'`);
    if (!definition.section.trim() || !definition.label.trim()) throw new Error(`settings: '${id}' needs section and label`);
    if (definition.kind === 'enum' && (!definition.options?.length || definition.options.some((option) => !option.value))) {
      throw new Error(`settings: enum '${id}' needs non-empty options`);
    }
    const options = definition.options
      ? Object.freeze(definition.options.map((option) => Object.freeze({ ...option })))
      : undefined;
    const frozen = Object.freeze({ ...definition, id, options }) as SettingDefinition<T>;
    if (normalize(frozen, frozen.defaultValue) !== frozen.defaultValue) {
      throw new Error(`settings: default for '${id}' is invalid`);
    }
    defs.set(id, frozen);
    return frozen;
  }

  definition(id: string): SettingDefinition | undefined { return definitionsFor(this).get(id); }
  list(): readonly SettingDefinition[] { return Object.freeze([...definitionsFor(this).values()]); }
}

export type SettingsListener = (id: string, value: SettingValue) => void;

export class SettingsStore {
  private readonly values = new Map<string, SettingValue>();
  private readonly listeners = new Set<SettingsListener>();

  constructor(readonly registry: SettingRegistry, readonly backend: SettingsBackend) {
    for (const def of registry.list()) this.values.set(def.id, def.defaultValue);
  }

  load(): void {
    const text = this.backend.read();
    if (!text) return;
    try {
      const envelope = JSON.parse(text) as Partial<SettingsEnvelope>;
      if (envelope.version !== 1 || !envelope.values || typeof envelope.values !== 'object') return;
      for (const def of this.registry.list()) {
        const value = normalize(def, envelope.values[def.id]);
        if (value !== undefined) this.values.set(def.id, value);
      }
    } catch { /* malformed config keeps defaults and stays available for reset */ }
  }

  get<T extends SettingValue>(definition: SettingDefinition<T>): T {
    return (this.values.get(definition.id) ?? definition.defaultValue) as T;
  }

  set<T extends SettingValue>(definition: SettingDefinition<T>, candidate: unknown): boolean {
    const value = normalize(definition, candidate);
    if (value === undefined) return false;
    if (this.values.get(definition.id) === value) return true;
    this.values.set(definition.id, value);
    this.persist();
    for (const listener of this.listeners) listener(definition.id, value);
    return true;
  }

  reset(definition: SettingDefinition): void { this.set(definition, definition.defaultValue); }

  resetAll(): void {
    const changed: Array<[string, SettingValue]> = [];
    for (const def of this.registry.list()) {
      if (this.values.get(def.id) !== def.defaultValue) changed.push([def.id, def.defaultValue]);
      this.values.set(def.id, def.defaultValue);
    }
    this.persist();
    for (const [id, value] of changed) for (const listener of this.listeners) listener(id, value);
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): Readonly<Record<string, SettingValue>> {
    return Object.freeze(Object.fromEntries(this.values));
  }

  private persist(): boolean {
    const envelope: SettingsEnvelope = { version: 1, values: { ...this.snapshot() } };
    return this.backend.write(JSON.stringify(envelope, null, 2));
  }
}

function utf8(text: string): Uint8Array {
  const Encoder = (globalThis as any).TextEncoder;
  if (typeof Encoder === 'function') return new Encoder().encode(text);
  const binary = unescape(encodeURIComponent(text));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i) & 255;
  return out;
}

export function jsonFileSettingsBackend(appId: string, filename = 'settings.json'): SettingsBackend {
  const dir = configDir(appId);
  const location = dir ? `${dir}/${filename}` : null;
  return {
    location,
    read: () => location ? readFile(location) : null,
    write: (text) => location ? writeFileBytesAtomic(location, utf8(text)) : false,
  };
}

export function memorySettingsBackend(initial: string | null = null): SettingsBackend & { text(): string | null } {
  let current = initial;
  return {
    location: null,
    read: () => current,
    write: (text) => { current = text; return true; },
    text: () => current,
  };
}
