// AnimatedTextShader — animated text done right.
//
// The other AnimatedText file uses per-frame setState to color/animate
// characters. Each frame, React reconciles ~30 <Text> nodes and
// re-renders strings. On a tile of 4 demos that's ~120 reconciles per
// frame — exactly the kind of work that nukes /character at 60fps.
//
// This file moves all per-pixel animation to a single WGSL fragment
// shader. The text node references the shader by name via the
// `textEffect` prop; the glyph rasterizer samples its pixel buffer per
// glyph pixel. React does ZERO work per frame for the color animation.
//
// Per-scene cost:
//   GradientWave : 1 Effect + 1 Text. Zero React work per frame.
//   Typewriter   : 1 Effect + 1 Text. setState every ~45ms (22cps), not RAF.
//   Streaming    : 1 Effect + 1 Text. setState every ~200ms (5wps), not RAF.
//   Scramble     : 1 Effect + 1 Text. setState every ~50ms (settle frames).
//
// Compare to AnimatedText (the React-driven version):
//   GradientWave : N <Text> nodes (one per char), setState every RAF.
//   Typewriter   : 1 <Text> node, setState every RAF.
//   Streaming    : 1 <Text> node, setState every RAF.
//   Scramble     : 1 <Text> node, setState every RAF.
//
// The big win is GradientWave (per-char nodes → one node) and the
// reveal scenes lose RAF coupling entirely (typing pace ≪ frame pace).

import { useEffect, useRef, useState } from 'react';
import { Box, Col, Effect, Row, Text } from '@reactjit/runtime/primitives';

const TILE_W = 360;
const TILE_H = 150;

const TYPE_TEXT = 'Hello, world. This is a typewriter.';
const STREAM_TEXT = 'Streaming tokens arrive word by word, the way an LLM responds in real time.';
const WAVE_TEXT = 'GRADIENT WAVE * shader-driven color';
const SCRAMBLE_TEXT = 'DECRYPTING PAYLOAD…';

// ── Shaders ───────────────────────────────────────────────────────

// Horizontal animated rainbow gradient. Hue cycles with U.time, varies
// with screen-x. Sampled per glyph pixel — the wave moves across the
// text without React knowing anything happened.
const GRADIENT_WAVE_WGSL = `
fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3f {
  let c = v * s;
  let hp = h * 6.0;
  let x = c * (1.0 - abs((hp % 2.0) - 1.0));
  var rgb = vec3f(0.0);
  if      (hp < 1.0) { rgb = vec3f(c, x, 0.0); }
  else if (hp < 2.0) { rgb = vec3f(x, c, 0.0); }
  else if (hp < 3.0) { rgb = vec3f(0.0, c, x); }
  else if (hp < 4.0) { rgb = vec3f(0.0, x, c); }
  else if (hp < 5.0) { rgb = vec3f(x, 0.0, c); }
  else               { rgb = vec3f(c, 0.0, x); }
  let m = v - c;
  return rgb + vec3f(m);
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let u = in.uv.x;
  let hue = fract(u * 1.4 - U.time * 0.35);
  let rgb = hsv2rgb(hue, 0.85, 1.0);
  return vec4f(rgb, 1.0);
}
`;

// Soft pulsing cyan — for the typewriter. The cursor stays "alive"
// without per-frame React work. Pulse breathes alpha via sin(time).
const TYPE_PULSE_WGSL = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let pulse = 0.65 + 0.35 * sin(U.time * 3.2);
  return vec4f(0.55 * pulse, 0.95, 1.0, 1.0);
}
`;

// Streaming text: subtle warm-to-cool sweep, slow.
const STREAM_SWEEP_WGSL = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let u = in.uv.x;
  let t = fract(u * 0.6 - U.time * 0.12);
  let warm = vec3f(0.95, 0.78, 0.55);
  let cool = vec3f(0.60, 0.78, 0.98);
  let mixed = mix(warm, cool, t);
  return vec4f(mixed, 1.0);
}
`;

// Scramble: aggressive flicker — green→white→green, with horizontal
// scanlines. Reads as "decrypting" without per-char react churn.
const SCRAMBLE_WGSL = `
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let scan = 0.6 + 0.4 * sin(in.uv.y * 80.0 + U.time * 18.0);
  let flick = 0.7 + 0.3 * sin(U.time * 11.0 + in.uv.x * 6.0);
  let green = vec3f(0.40, 1.00, 0.55);
  let white = vec3f(0.95, 1.00, 0.95);
  let mixed = mix(green, white, flick);
  return vec4f(mixed * scan, 1.0);
}
`;

// ── Reveal hooks (interval-paced, not RAF-paced) ───────────────────

// Typewriter at N chars/sec. Uses setInterval at 1000/cps — for 22cps
// that's 45ms ticks, ~14× less work than RAF.
function useTypewriterText(text: string, opts: { cps: number; loopHoldMs: number; cursor?: string }): string {
  const [n, setN] = useState(0);
  useEffect(() => {
    let id: any = null;
    let count = 0;
    let holding = false;
    const tick = () => {
      if (holding) {
        holding = false;
        count = 0;
        setN(0);
        id = setTimeout(tick, 1000 / opts.cps);
        return;
      }
      count += 1;
      setN(count);
      if (count >= text.length) {
        holding = true;
        id = setTimeout(tick, opts.loopHoldMs);
      } else {
        id = setTimeout(tick, 1000 / opts.cps);
      }
    };
    id = setTimeout(tick, 1000 / opts.cps);
    return () => { if (id != null) clearTimeout(id); };
  }, [text, opts.cps, opts.loopHoldMs]);
  const cursor = opts.cursor ?? '';
  return text.slice(0, n) + cursor;
}

// Streaming words at N words/sec. setInterval-paced.
function useStreamingTextWords(text: string, opts: { wordsPerSec: number; loopHoldMs: number }): string {
  const [n, setN] = useState(0);
  const words = text.split(' ');
  useEffect(() => {
    let id: any = null;
    let count = 0;
    let holding = false;
    const tick = () => {
      if (holding) {
        holding = false;
        count = 0;
        setN(0);
        id = setTimeout(tick, 1000 / opts.wordsPerSec);
        return;
      }
      count += 1;
      setN(count);
      if (count >= words.length) {
        holding = true;
        id = setTimeout(tick, opts.loopHoldMs);
      } else {
        id = setTimeout(tick, 1000 / opts.wordsPerSec);
      }
    };
    id = setTimeout(tick, 1000 / opts.wordsPerSec);
    return () => { if (id != null) clearTimeout(id); };
  }, [text, opts.wordsPerSec, opts.loopHoldMs]);
  return words.slice(0, n).join(' ');
}

// Scramble: settles char-by-char left-to-right over durationMs. Ticks
// at 50ms (~20fps), shader handles the per-pixel flicker so we don't
// need a higher tick rate.
const SCRAMBLE_GLYPHS = '!@#$%^&*()_+-={}[]<>?/\\|~`';
function useScrambleText(text: string, opts: { durationMs: number; loopHoldMs: number }): string {
  const [tick, setTick] = useState(0);
  const startRef = useRef<number>(0);
  useEffect(() => {
    startRef.current = Date.now();
    const id = setInterval(() => setTick((t) => t + 1), 50);
    return () => clearInterval(id);
  }, [text, opts.durationMs, opts.loopHoldMs]);
  void tick;
  const cycle = opts.durationMs + opts.loopHoldMs;
  const elapsed = (Date.now() - startRef.current) % cycle;
  if (elapsed >= opts.durationMs) return text;
  const settled = Math.floor((elapsed / opts.durationMs) * text.length);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    if (i < settled || text[i] === ' ') {
      out += text[i];
    } else {
      const r = Math.floor(Math.random() * SCRAMBLE_GLYPHS.length);
      out += SCRAMBLE_GLYPHS[r];
    }
  }
  return out;
}

// ── Tile UI ────────────────────────────────────────────────────────

function Tile(props: { title: string; subtitle: string; children: any }) {
  return (
    <Col
      style={{
        width: TILE_W,
        height: TILE_H,
        padding: 14,
        backgroundColor: 'theme:bg',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: 'theme:bg2',
        gap: 8,
      }}
    >
      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ fontSize: 12, color: 'theme:atch', fontFamily: 'monospace' }}>{props.title}</Text>
        <Text style={{ fontSize: 10, color: 'theme:inkDimmer' }}>{props.subtitle}</Text>
      </Row>
      <Box style={{ flexGrow: 1, justifyContent: 'center' }}>
        {props.children}
      </Box>
    </Col>
  );
}

// Each demo gets a unique effect name so they don't collide. Pattern:
// the Effect node provides the color buffer; the Text node samples it
// via textEffect="<name>".
//
// The Effect is positioned absolutely with the dimensions of the text
// region — the texture tiles modulo its size, so we want it large
// enough that no visible repetition happens within the text.

function FxLayer(props: { name: string; shader: string; w?: number; h?: number }) {
  return (
    <Effect
      name={props.name}
      shader={props.shader}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: props.w ?? TILE_W,
        height: props.h ?? TILE_H,
      }}
    />
  );
}

function TypewriterShaderDemo() {
  const text = useTypewriterText(TYPE_TEXT, { cps: 22, loopHoldMs: 1600, cursor: '▌' });
  return (
    <Box style={{ position: 'relative' }}>
      <FxLayer name="atxs-type" shader={TYPE_PULSE_WGSL} />
      <Text textEffect="atxs-type" style={{ fontSize: 15, fontFamily: 'monospace' }}>
        {text}
      </Text>
    </Box>
  );
}

function StreamingShaderDemo() {
  const text = useStreamingTextWords(STREAM_TEXT, { wordsPerSec: 5, loopHoldMs: 2000 });
  return (
    <Box style={{ position: 'relative' }}>
      <FxLayer name="atxs-stream" shader={STREAM_SWEEP_WGSL} />
      <Text textEffect="atxs-stream" style={{ fontSize: 14, lineHeight: 18 }}>
        {text}
      </Text>
    </Box>
  );
}

function GradientWaveShaderDemo() {
  return (
    <Box style={{ position: 'relative' }}>
      <FxLayer name="atxs-wave" shader={GRADIENT_WAVE_WGSL} />
      <Text textEffect="atxs-wave" style={{ fontSize: 18, fontWeight: 'bold', fontFamily: 'monospace' }}>
        {WAVE_TEXT}
      </Text>
    </Box>
  );
}

function ScrambleShaderDemo() {
  const text = useScrambleText(SCRAMBLE_TEXT, { durationMs: 1600, loopHoldMs: 1800 });
  return (
    <Box style={{ position: 'relative' }}>
      <FxLayer name="atxs-scram" shader={SCRAMBLE_WGSL} />
      <Text textEffect="atxs-scram" style={{ fontSize: 16, fontFamily: 'monospace', letterSpacing: 1 }}>
        {text}
      </Text>
    </Box>
  );
}

export type AnimatedTextShaderProps = {};

export function AnimatedTextShader(_props: AnimatedTextShaderProps) {
  return (
    <Col style={{ gap: 16, padding: 16, alignItems: 'center' }}>
      <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'theme:ink' }}>Animated Text (Shader)</Text>
      <Text style={{ fontSize: 12, color: 'theme:inkDimmer' }}>
        Same four scenes — colors driven by WGSL fragment shaders via `textEffect`. Reveal logic decoupled from RAF.
      </Text>
      <Row style={{ flexWrap: 'wrap', gap: 12, justifyContent: 'center', maxWidth: TILE_W * 2 + 40 }}>
        <Tile title="typewriter (shader pulse)" subtitle="22 cps · 45ms tick">
          <TypewriterShaderDemo />
        </Tile>
        <Tile title="streaming (shader sweep)" subtitle="5 wps · 200ms tick">
          <StreamingShaderDemo />
        </Tile>
        <Tile title="gradient wave (pure shader)" subtitle="0 React/frame">
          <GradientWaveShaderDemo />
        </Tile>
        <Tile title="scramble (shader scanlines)" subtitle="1.6s settle · 50ms tick">
          <ScrambleShaderDemo />
        </Tile>
      </Row>
    </Col>
  );
}
