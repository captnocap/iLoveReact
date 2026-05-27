// sdk/bindings-schema.ts - strict types for the bindings registry.

export type HostFn = {
  js: `__${string}` | string;
  zig: string;
};

export type FnPresence = 'noop' | 'real';

type Common = {
  module: `framework/v8_bindings_${string}.zig`;
  registerSuffix: string;
  hostFns: HostFn[];
  tickDrain?: FnPresence;
  init?: FnPresence;
  grepPrefix?: string;
  needs?: string[];
};

export type BindingSpec = (Common & { required: true }) | (Common & { required: false });
export type BindingRegistry = Record<string, BindingSpec>;

export function defineBindings<T extends BindingRegistry>(registry: T): T {
  return registry;
}
