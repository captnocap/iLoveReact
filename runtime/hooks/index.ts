/**
 * runtime/hooks — per-domain FFI wrappers for framework capabilities.
 *
 * Usage:
 *   import { fs, sqlite, http } from '../../runtime/hooks';
 *   const text = fs.readFile('/etc/hostname');
 *   const db = sqlite.Db.open('app.db');
 *   const r = await http.getAsync('https://example.com');
 */

export * as fs from './fs';
export { math, listZigCallable } from './math';
export type { Vec2, Vec3, BBox2, BBox3, SmoothDampResult } from './math';
export * as sqlite from './sqlite';
export * as pg from './pg';
export * as embed from './embed';
export * as fetch from './fetch';
export * as process from './process';
export * as localstore from './localstore';
export * as clipboard from './clipboard';
export * as websocket from './websocket';
export * as media from './media';
export { useFetchBrowser, fetchPageAsync } from './useFetchBrowser';
export type { BrowserPageResponse } from './useFetchBrowser';
export { useBrowse, browseRequest, setBrowsePort } from './useBrowse';
export type { BrowseHandle, BrowseOptions, PageContent as BrowsePageContent } from './useBrowse';
export { useHotState, getHotState, setHotState, removeHotState, clearHotState, hotStateKeys } from './useHotState';
export { useRerender } from './useRerender';
export { usePointerDevice, getPointerDevice } from './usePointerDevice';
export type { PointerDevice } from './usePointerDevice';
export { useInterval } from './useInterval';
export { useDuring } from './useDuring';
export type { DuringBody, DuringLifetime, UseDuringHandle } from './useDuring';
export { useIFTTT, busOn, busEmit, getSharedState, setSharedState, dispatchClaudeEvent } from './useIFTTT';
export type { IFTTTTrigger, IFTTTAction, IFTTTResult } from './useIFTTT';
export {
  registerIfttSource,
  registerIfttAction,
  setIfttFallback,
  resolveTrigger,
  dispatchAction,
  listIfttSources,
  listIfttActions,
} from './ifttt/registry';
export type { IfttSource, IfttSubscription, IfttActionRunner } from './ifttt/registry';
export { compileTrigger, isComposable, substituteAction } from './ifttt/compose';
export type { IFTTTComposable, IFTTTLeaf } from './ifttt/compose';
export { useHost } from './useHost';
export type {
  HostSpec,
  HostHandle,
  HttpHostSpec,
  HttpHostHandle,
  WsHostSpec,
  WsHostHandle,
  HttpRequest,
  HttpResponder,
  HttpRouteSpec,
  HostState,
} from './useHost';
export { useProcess } from './useProcess';
export type { UseProcessSpec, UseProcessHandle, ProcessState } from './useProcess';
export { useConnection } from './useConnection';
export type {
  ConnectionSpec,
  ConnectionHandle,
  ConnectionState,
  TransportHandle,
  WsConnectionSpec,
  WsConnectionHandle,
  TcpConnectionSpec,
  TcpConnectionHandle,
  UdpConnectionSpec,
  UdpConnectionHandle,
  WireGuardConnectionSpec,
  WireGuardConnectionHandle,
  WireGuardConfig,
  TorConnectionSpec,
  TorConnectionHandle,
  Socks5ConnectionSpec,
  Socks5ConnectionHandle,
  StunConnectionSpec,
  StunConnectionHandle,
  PeerConnectionSpec,
  PeerConnectionHandle,
  HttpConnectionSpec,
  HttpConnectionHandle,
  SseConnectionSpec,
  SseConnectionHandle,
  SseEvent,
  RconConnectionSpec,
  RconConnectionHandle,
  A2sConnectionSpec,
  A2sConnectionHandle,
  A2sInfo,
  A2sPlayer,
} from './useConnection';
export {
  fuzzyScore,
  fuzzySearch,
  scoreFuzzyItem,
  useFuzzySearch,
} from './useFuzzySearch';
export type {
  FuzzyMode,
  FuzzySearchCandidate,
  FuzzySearchOptions,
  FuzzySearchResult,
} from './useFuzzySearch';
export { usePrivacy } from './usePrivacy';
export type {
  Backend as PrivacyBackend,
  PrivacyOptions,
  PrivacyAPI,
  Manifest,
  ManifestEntry,
  VerifyResult,
  KeyType,
  KeyringEntryView,
  GenerateKeyOpts,
  IsolatedCredential,
  NoiseInitiateResult,
  SecureBufferMode,
} from './usePrivacy';
export { useTelemetry } from './useTelemetry';
export { useMeasure } from './useMeasure';
export type { MeasuredRect, UseMeasureResult } from './useMeasure';
export type {
  TelemetrySpec,
  TelemetryResult,
  ScalarKind as TelemetryScalarKind,
  JsonKind as TelemetryJsonKind,
  NodeKind as TelemetryNodeKind,
  ScalarTelemetrySpec,
  JsonTelemetrySpec,
  NodeTelemetrySpec,
  ScalarTelemetryResult,
  JsonTelemetryResult,
} from './useTelemetry';
export { useCRUD } from './useCRUD';
export { useMedia } from './useMedia';
export { useVideo, videoControl } from './useVideo';
export type { VideoStatus, VideoControl, UseVideoResult } from './useVideo';
export { useVoiceInput } from './useVoiceInput';
export type { VoiceInputOptions, VoiceInputResult } from './useVoiceInput';
export { useAudioInput };
export type { AudioInputDevice, AudioInputHandle, AudioInputOptions } from './useAudioInput';
export { useMIDI, subscribeMIDI };
export type { MIDIHandle, MIDIOptions, MidiEvent, MidiEventType, MidiLearnTarget, MidiMapping, MidiPort } from './useMIDI';
export { useDeej, subscribeDeej } from './useDeej';
export type { DeejHandle, DeejMove, DeejOptions, DeejState } from './useDeej';
export { useFileDrop } from './useFileDrop';
export { pickFile, pickFiles } from './pickFile';
export type { FileFilter, PickFileOptions } from './pickFile';
export { useFileWatch, attachWatcher } from './useFileWatch';
export { useEmbed } from './useEmbed';
export type { UseEmbedOpts, QueryOpts as EmbedQueryOpts, EmbedHit } from './useEmbed';
export { usePostgres } from './usePostgres';
export type { UsePostgresOpts } from './usePostgres';
export type { FileWatchEvent, FileWatchOptions } from './useFileWatch';

// Scene3D — the JS-side scene-graph hook (`useScene3D`) used to live here.
// Removed when `<Scene3D>` was rewritten to emit straight to the host's
// wgpu pipeline (framework/gpu/3d.zig). The previous registry + CPU painter
// is moved aside under runtime/scene3d_dead/. Carts that need camera /
// light / mesh introspection should subscribe to layout-tree events via
// the existing host hooks, not a parallel JS scene graph.

// Audio — declarative wrapper around framework/audio.zig. The <Audio>
// primitive lives in runtime/audio.tsx; useAudio() is the imperative
// façade for note-on/note-off/setParam (events that don't fit a tree).
export { useAudio, AUDIO_MODULE_TYPE, AUDIO_SOUND } from '../audio';
export type { AudioHandle, AudioModuleType, AudioSound } from '../audio';

export * from '../ffi';

/**
 * Install ALL browser-shim globals so copy-pasted React code works:
 *   globalThis.fetch       → http
 *   globalThis.localStorage → localstore
 *   globalThis.WebSocket   → websocket
 *   globalThis.EventSource → http (streaming SSE)
 *
 * Also wires the viewport-resize bridge so classifier `bp:` overrides
 * become live. See `installResizeBridge` below.
 *
 * Call once at the top of your cart entry (before <App /> mounts). Leaving
 * the shims OFF by default keeps things explicit — opt in per cart.
 */
export function installBrowserShims(): void {
  const fetchMod = require('./fetch') as typeof import('./fetch');
  fetchMod.installFetchShim();
  fetchMod.installEventSourceShim();
  (require('./localstore') as typeof import('./localstore')).installLocalStorageShim();
  (require('./websocket') as typeof import('./websocket')).installWebSocketShim();
  installResizeBridge();
}

/**
 * Seed the JS-side theme store with the host's initial viewport width so
 * `useBreakpoint()` resolves to the correct tier on first render. This is
 * a one-shot read, NOT a live bridge — the engine-side resize push was
 * removed because it caused multi-layer round-trips (Zig→V8 eval→IFTTT
 * bus→React store→Zig primitive props→Zig layout) on every pixel of an
 * active drag, and locked up the engine.
 *
 * The proper architecture for live breakpoint reactivity is for the
 * layout engine in Zig to resolve classifier `bp:` variants directly from
 * `framework/breakpoint.zig`'s active tier — no JS round-trip. That's a
 * separate piece of work; until then, classifier bp variants only apply
 * to the size the window had at app launch. The browser-shim path keeps
 * a `window.resize` listener for DOM-hosted carts, where the round-trip
 * is one boundary, not two.
 *
 * Idempotent — calling it twice is safe.
 */
let _resizeBridgeInstalled = false;
export function installResizeBridge(): void {
  if (_resizeBridgeInstalled) return;
  _resizeBridgeInstalled = true;

  const themeMod = require('../theme') as typeof import('../theme');
  const ifttt = require('./useIFTTT') as typeof import('./useIFTTT');
  const ffi = require('../ffi') as typeof import('../ffi');
  // `host` here mixes Zig FFI (__viewport_width) with browser globals
  // (innerWidth, addEventListener); the latter aren't on HostGlobals.
  const host = globalThis as any;

  // Seed initial width — try the native host fn first, fall back to the
  // browser path. If neither responds, the theme store stays at its
  // default (1280 / lg) which is fine for the first frame.
  let initialW = 0;
  if (ffi.hasHost('__viewport_width')) {
    initialW = Number(ffi.callHost('__viewport_width', 0)) || 0;
  } else if (typeof host.innerWidth === 'number') {
    initialW = host.innerWidth;
  }
  if (initialW > 0) themeMod.setViewportWidth(initialW);

  // Live channel — Zig fires __ifttt_onSystemResize on tier crossings,
  // which the IFTTT registry forwards as 'system:resize'. We subscribe
  // here and push into the theme store so useBreakpoint() reflects the
  // actual window size, not just the install-time seed.
  ifttt.busOn('system:resize', (payload: any) => {
    const w = typeof payload?.w === 'number' ? payload.w : 0;
    if (w > 0) themeMod.setViewportWidth(w);
  });

  // Browser-shim path — DOM-hosted carts react to window.resize directly,
  // since the IFTTT bus event only fires from the native V8 path.
  if (typeof host.addEventListener === 'function') {
    try {
      host.addEventListener('resize', () => {
        const w = typeof host.innerWidth === 'number' ? host.innerWidth : 0;
        if (w > 0) themeMod.setViewportWidth(w);
      });
    } catch { /* ignore */ }
  }
}
