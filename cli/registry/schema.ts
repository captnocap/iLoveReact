// cli/registry/schema.ts - typed mirror of sdk/dependency-registry.json.

export interface Registry {
  schemaVersion: 1;
  description: string;
  cliPayload: CliPayload;
  nativeLibraries: Record<string, NativeLibrarySpec>;
  features: Record<string, FeatureSpec>;
  shipGate: { flagOrder: ShipGateFlag[] };
}

export interface CliPayload {
  tools: Record<string, ToolSpec>;
  jsPackages: Record<string, JsPackageSpec>;
}

export type Phase = 'scaffold' | 'build' | 'ship' | 'scripts';

export interface ToolSpec {
  kind: 'toolchain' | 'host-tool' | 'bundler';
  requiredFor: Phase[];
  version?: string;
  payloadPath: string;
  supportPaths?: string[];
  packPolicy: 'required' | 'optional';
  status: 'present' | 'missing';
}

export interface JsPackageSpec {
  requiredFor: Phase[];
  vendorPath: string;
  packPolicy: 'required' | 'optional';
}

export type LinkPolicy = 'engine-v8' | 'foundational' | 'system-assumed' | 'feature-gated' | 'never' | 'deprecated';
export type BundlePolicy = 'always' | 'feature-gated' | 'vendored-source' | 'never';
export type NativeLibKind =
  | 'static-library'
  | 'dynamic-library'
  | 'zig-package'
  | 'vendored-c-source'
  | 'vendored-library'
  | 'platform-library'
  | 'platform-framework';

export interface NativeLibrarySpec {
  kind: NativeLibKind;
  payloadPath?: string | string[];
  knownPayloads?: string[];
  systemNames?: string[];
  frameworks?: string[];
  buildImport?: string;
  linkPolicy: LinkPolicy;
  bundlePolicy: BundlePolicy;
  buildFlag?: string;
  includePaths?: string[];
  sources?: string[];
  platforms?: ('linux' | 'macos' | 'windows')[];
  note?: string;
}

export type TriggerKind = 'metafileInput' | 'metafileInputPrefix' | 'featureMarker';

export interface Trigger {
  kind: TriggerKind;
  input: string;
}

export interface FeatureSpec {
  triggers?: Trigger[];
  buildOptions?: string[];
  v8Bindings?: string[];
  nativeLibraries?: string[];
  tools?: string[];
  jsPackages?: string[];
  requiredFor?: Phase[];
  shipGate?: ShipGateFlag;
  note?: string;
}

export const SHIP_GATE_FLAGS = [
  'privacy',
  'useHost',
  'useConnection',
  'fs',
  'websocket',
  'telemetry',
  'zigcall',
  'sdk',
  'voice',
  'audio_input',
  'whisper',
  'paintable',
  'onnx',
  'pg',
  'embed',
  'sqlite',
  'terminal',
  'process',
  'window',
  'doom',
] as const;

export type ShipGateFlag = typeof SHIP_GATE_FLAGS[number];
export type GateFlags = Record<ShipGateFlag, boolean>;

export function emptyGateFlags(): GateFlags {
  const out = {} as GateFlags;
  for (const flag of SHIP_GATE_FLAGS) out[flag] = false;
  return out;
}

export function gateFlagsToPositional(gates: Partial<Record<string, boolean>>, order: readonly string[]): string {
  return order.map((name) => (gates[name] ? '1' : '0')).join(' ');
}
