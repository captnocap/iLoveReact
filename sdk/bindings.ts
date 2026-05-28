// sdk/bindings.ts - seed registry for the codegen-bindings slice.
//
// The live slice-5 emitter currently derives from framework/v8_ingredients.zig
// so it tracks the existing catalog without changing runtime wiring. This
// registry file exists now so hook files can import `type Binding`; a later
// slice can promote it to the primary source of truth.

import { defineBindings } from './bindings-schema';

export default defineBindings({
  core: { required: true, module: 'framework/v8_bindings_core.zig', registerSuffix: 'Core', hostFns: [] },
  eventbus: { required: true, module: 'framework/v8_bindings_eventbus.zig', registerSuffix: 'EventBus', hostFns: [] },
  ifttt: { required: true, module: 'framework/v8_bindings_ifttt.zig', registerSuffix: 'IFTTT', hostFns: [] },
  env: { required: true, module: 'framework/v8_bindings_env.zig', registerSuffix: 'Env', hostFns: [] },
  window: { required: true, module: 'framework/v8_bindings_window.zig', registerSuffix: 'Window', hostFns: [] },
  inspector: { required: true, module: 'framework/v8_bindings_inspector.zig', registerSuffix: 'Inspector', hostFns: [] },
  lua: { required: true, module: 'framework/v8_bindings_lua.zig', registerSuffix: 'Lua', hostFns: [] },
  input_bench: { required: true, module: 'framework/v8_bindings_input_bench.zig', registerSuffix: 'InputBench', hostFns: [] },
  fs: { required: false, module: 'framework/v8_bindings_fs.zig', registerSuffix: 'Fs', grepPrefix: '__fs_', hostFns: [] },
  websocket: { required: false, module: 'framework/v8_bindings_websocket.zig', registerSuffix: 'WebSocket', grepPrefix: '__ws_', hostFns: [] },
  telemetry: { required: false, module: 'framework/v8_bindings_telemetry.zig', registerSuffix: 'Telemetry', grepPrefix: '__tel_', hostFns: [] },
  zigcall: { required: false, module: 'framework/v8_bindings_zigcall.zig', registerSuffix: 'ZigCall', grepPrefix: '__zig_call', hostFns: [] },
  zigcall_list: { required: false, module: 'framework/v8_bindings_zigcall.zig', registerSuffix: 'ZigCallList', grepPrefix: '__zig_call', hostFns: [] },
  process: { required: false, module: 'framework/v8_bindings_process.zig', registerSuffix: 'Process', grepPrefix: '__proc_', hostFns: [] },
  httpsrv: { required: false, module: 'framework/v8_bindings_httpserver.zig', registerSuffix: 'HttpServer', grepPrefix: '__httpsrv_', hostFns: [] },
  wssrv: { required: false, module: 'framework/v8_bindings_wsserver.zig', registerSuffix: 'WsServer', grepPrefix: '__wssrv_', hostFns: [] },
  net: { required: false, module: 'framework/v8_bindings_net.zig', registerSuffix: 'Net', grepPrefix: '__tcp_', hostFns: [] },
  gameserver: { required: false, module: 'framework/v8_bindings_gameserver.zig', registerSuffix: 'GameServer', grepPrefix: '__rcon_', hostFns: [] },
  tor: { required: false, module: 'framework/v8_bindings_tor.zig', registerSuffix: 'Tor', grepPrefix: '__tor_', hostFns: [] },
  privacy: { required: false, module: 'framework/v8_bindings_privacy.zig', registerSuffix: 'Privacy', grepPrefix: '__priv_', hostFns: [] },
  sdk: { required: false, module: 'framework/v8_bindings_sdk.zig', registerSuffix: 'Sdk', grepPrefix: '__http_request_', hostFns: [] },
  voice: { required: false, module: 'framework/v8_bindings_voice.zig', registerSuffix: 'Voice', grepPrefix: '__voice_', hostFns: [] },
  audio_input: { required: false, module: 'framework/v8_bindings_audio_input.zig', registerSuffix: 'AudioInput', grepPrefix: '__rawCapture_', hostFns: [] },
  whisper: { required: false, module: 'framework/v8_bindings_whisper.zig', registerSuffix: 'Whisper', grepPrefix: '__whisper_', hostFns: [] },
  onnx: { required: false, module: 'framework/v8_bindings_onnx.zig', registerSuffix: 'Onnx', grepPrefix: '__onnx_', hostFns: [] },
  pg: { required: false, module: 'framework/v8_bindings_pg.zig', registerSuffix: 'Pg', grepPrefix: '__pg_', hostFns: [] },
  embed: { required: false, module: 'framework/v8_bindings_embed.zig', registerSuffix: 'Embed', grepPrefix: '__embed_', hostFns: [] },
  video: { required: false, module: 'framework/v8_bindings_video.zig', registerSuffix: 'Video', grepPrefix: '__video_', hostFns: [] },
  audio: { required: false, module: 'framework/v8_bindings_audio.zig', registerSuffix: 'Audio', grepPrefix: '__audio_', hostFns: [] },
  midi: { required: false, module: 'framework/v8_bindings_midi.zig', registerSuffix: 'Midi', grepPrefix: '__midi_', hostFns: [] },
  vterm: { required: false, module: 'framework/v8_bindings_vterm.zig', registerSuffix: 'Vterm', grepPrefix: '__vterm_', hostFns: [] },
  doom: { required: false, module: 'framework/v8_bindings_doom.zig', registerSuffix: 'Doom', grepPrefix: '__doom_', hostFns: [] },
  paintable: { required: false, module: 'framework/v8_bindings_paintable.zig', registerSuffix: 'Paintable', grepPrefix: '__paintable_', hostFns: [] },
});
