// planetarium — procedural planet generator for TUI + GPU.
//
// Single unified shader renders both the starfield and the planet,
// following the gallery's pattern: absolute-positioned effect fills the
// entire viewport, HUD floats on top.
//
// Click prev / next to cycle planet types. Click regenerate to roll a new
// procedural seed (data buffer update, no shader recompile).

import * as React from 'react';
import { Box, Row, Col, Text, Pressable, Effect } from '@reactjit/primitives';

// ── palette ─────────────────────────────────────────────────────────
const P = {
  bg:     '#02040a',
  panel:  '#0b1020',
  border: '#1e293b',
  ink:    '#e2e8f0',
  dim:    '#64748b',
  accent: '#38bdf8',
  good:   '#34d399',
  warm:   '#fbbf24',
  hot:    '#f87171',
};

// ── planet catalog ──────────────────────────────────────────────────

type PlanetDef = {
  id: number;
  name: string;
  type: string;
  desc: string;
  color: string;
};

const PLANETS: PlanetDef[] = [
  { id: 0, name: 'Borealis',   type: 'gas giant',    desc: 'banded ammonia clouds, cyclonic vortices',          color: '#d4a574' },
  { id: 1, name: 'Tellus',     type: 'terrestrial',  desc: 'nitrogen atmosphere, liquid water, silicate crust', color: '#38bdf8' },
  { id: 2, name: 'Cryos',      type: 'ice world',    desc: 'frozen volatiles, sub-surface ocean',               color: '#a5f3fc' },
  { id: 3, name: 'Pyrrha',     type: 'lava world',   desc: 'tidally locked, silicate magma oceans',             color: '#f87171' },
  { id: 4, name: 'Sirocco',    type: 'desert world', desc: 'iron oxide dunes, minimal atmosphere',              color: '#fbbf24' },
];

// ── unified WGSL shader ─────────────────────────────────────────────
//
// Renders a starfield background with a rotating procedural planet in the
// centre.  params[0] = planet type, params[1..3] = seed xyz.
//
// Tuned for the JS-evaluated TUI path: only 2D noise, low octave counts,
// cheap branching.  The GPU host runs the same source verbatim.

const UNIFIED_WGSL = `
@group(0) @binding(1) var<storage, read> params: array<f32>;

// ── hash / noise (2D only, cheap) ──
fn hash2(p: vec2f) -> f32 {
  let d = sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453;
  return d - floor(d);
}
fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash2(i);
  let b = hash2(i + vec2f(1.0, 0.0));
  let c = hash2(i + vec2f(0.0, 1.0));
  let d = hash2(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm2(p: vec2f, octaves: f32) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var x = p;
  for (var i = 0.0; i < octaves; i = i + 1.0) {
    v = v + a * noise2(x);
    x = x * 2.0;
    a = a * 0.5;
  }
  return v;
}

// ── starfield ──
fn starField(uv: vec2f, t: f32) -> vec3f {
  var bright = 0.0;
  for (var layer = 0.0; layer < 3.0; layer = layer + 1.0) {
    let scale = 22.0 + layer * 16.0;
    let spd = 0.06 + layer * 0.04;
    let p = uv * scale + vec2f(t * spd, t * spd * 0.25);
    let h = hash2(floor(p));
    let sz = step(0.975 - layer * 0.005, h);
    let tw = sin(t * 1.5 + h * 15.0) * 0.5 + 0.5;
    bright = bright + sz * tw * (0.4 + layer * 0.3);
  }
  return vec3f(bright * 0.85, bright * 0.9, bright);
}

// ── planet colour by type ──
fn planetColor(ptype: f32, lon: f32, lat: f32, t: f32, seed: vec3f) -> vec3f {
  let rot = lon + t * 0.12;
  let sp = vec2f(rot, lat) * 3.0 + seed.xy;

  // ── gas giant ──
  if (ptype < 0.5) {
    let bands = sin(lat * 7.0 + seed.x) * 0.5 + 0.5;
    let turb = fbm2(sp * 1.5, 3.0);
    let spot = smoothstep(0.4, 0.0, length(vec2f(rot * 0.3 - 0.2, lat * 0.8 - 0.15)));
    let storm = spot * 0.35 * (sin(t * 0.4) * 0.5 + 0.5);
    let c1 = vec3f(0.72, 0.52, 0.32);
    let c2 = vec3f(0.48, 0.33, 0.20);
    let c3 = vec3f(0.82, 0.68, 0.48);
    var col = mix(c1, c2, bands);
    col = mix(col, c3, turb * 0.5);
    col = col + vec3f(0.55, 0.20, 0.08) * storm;
    return col;
  }
  // ── terrestrial ──
  else if (ptype < 1.5) {
    let n = fbm2(sp * 1.8, 4.0);
    let n2 = fbm2(sp * 4.0 + 20.0, 2.0);
    let ocean = smoothstep(0.40, 0.55, n);
    let land = 1.0 - ocean;
    let mountain = smoothstep(0.68, 0.88, n);
    let deepOc = vec3f(0.04, 0.14, 0.32);
    let shallow = vec3f(0.10, 0.35, 0.55);
    let sand = vec3f(0.55, 0.50, 0.30);
    let grass = vec3f(0.15, 0.45, 0.15);
    let forest = vec3f(0.08, 0.30, 0.10);
    let rock = vec3f(0.40, 0.35, 0.30);
    let snow = vec3f(0.90, 0.92, 0.95);
    var ter = mix(deepOc, shallow, smoothstep(0.0, 0.35, ocean));
    ter = mix(ter, sand, smoothstep(0.3, 0.5, ocean) * land);
    ter = mix(ter, grass, smoothstep(0.4, 0.6, n) * land);
    ter = mix(ter, forest, smoothstep(0.55, 0.75, n) * land);
    ter = mix(ter, rock, mountain * land);
    ter = mix(ter, snow, smoothstep(0.78, 0.95, n));
    let cloud = smoothstep(0.45, 0.65, fbm2(sp * 3.0 + vec2f(t * 0.04, 0.0), 3.0));
    ter = mix(ter, vec3f(0.95, 0.95, 0.95), cloud * 0.65);
    return ter;
  }
  // ── ice world ──
  else if (ptype < 2.5) {
    let n = fbm2(sp * 2.0, 4.0);
    let crack = fbm2(sp * 6.0 + 50.0, 2.0);
    let crackLine = 1.0 - smoothstep(0.46, 0.54, crack);
    let ice1 = vec3f(0.75, 0.85, 0.92);
    let ice2 = vec3f(0.45, 0.60, 0.75);
    let ice3 = vec3f(0.90, 0.93, 0.95);
    let deep = vec3f(0.15, 0.25, 0.40);
    var surf = mix(ice2, ice1, smoothstep(0.3, 0.7, n));
    surf = mix(surf, ice3, smoothstep(0.6, 0.9, n));
    surf = mix(surf, deep, crackLine * 0.55);
    return surf;
  }
  // ── lava world ──
  else if (ptype < 3.5) {
    let n = fbm2(sp * 1.5, 3.0);
    let crack = fbm2(sp * 5.0 + 30.0, 2.0);
    let crackLine = 1.0 - smoothstep(0.47, 0.53, crack);
    let glow = fbm2(sp * 3.0 + vec2f(t * 0.06, 0.0), 2.0);
    let crust = vec3f(0.08, 0.06, 0.05);
    let lava1 = vec3f(1.0, 0.35, 0.05);
    let lava2 = vec3f(1.0, 0.60, 0.10);
    var surf = crust;
    surf = mix(surf, lava1, crackLine * smoothstep(0.3, 0.7, glow));
    surf = mix(surf, lava2, crackLine * smoothstep(0.5, 0.8, glow) * 0.5);
    surf = surf + lava1 * crackLine * (sin(t * 1.5 + rot * 8.0) * 0.5 + 0.5) * 0.25;
    return surf;
  }
  // ── desert world ──
  else {
    let n = fbm2(sp * 1.6, 4.0);
    let dune = fbm2(sp * 3.5 + 20.0, 3.0);
    let rock = fbm2(sp * 5.5 + 40.0, 2.0);
    let sand1 = vec3f(0.75, 0.50, 0.25);
    let sand2 = vec3f(0.55, 0.35, 0.15);
    let rockCol = vec3f(0.40, 0.25, 0.15);
    let dust = vec3f(0.90, 0.70, 0.40);
    var surf = mix(sand2, sand1, smoothstep(0.2, 0.6, n));
    surf = mix(surf, dust, smoothstep(0.5, 0.8, dune) * 0.4);
    surf = mix(surf, rockCol, smoothstep(0.55, 0.75, rock) * 0.5);
    return surf;
  }
}

@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let ptype = params[0];
  let seed  = vec3f(params[1], params[2], params[3]);
  let t = U.time;
  let uv = in.uv;

  // Aspect-corrected disk for a round planet in both TUI and GPU.
  let aspect = U.size_w / max(U.size_h, 1.0);
  let pc = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.0;
  let pr2 = dot(pc, pc);

  // Starfield everywhere.
  var col = starField(uv, t);

  // Planet disk.
  if (pr2 < 1.0) {
    let z = sqrt(1.0 - pr2);
    let normal = vec3f(pc.x, pc.y, z);

    // Lighting.
    let lightDir = normalize(vec3f(0.6, 0.25, 0.8));
    let lit = max(0.0, dot(normal, lightDir));
    let halfLit = max(0.0, dot(normal, normalize(lightDir + vec3f(0.0, 0.0, 1.0))));

    // Rim atmosphere.
    let rim = 1.0 - max(0.0, normal.z);
    let atmosphere = pow(rim, 3.0);

    // Spherical coords for surface noise.
    let lon = atan2(pc.y, pc.x);
    let lat = acos(clamp(z, 0.0, 1.0));

    var pcol = planetColor(ptype, lon, lat, t, seed);

    // Type-specific atmosphere tint.
    var atmo = vec3f(0.3, 0.5, 0.9);
    if (ptype < 0.5)       { atmo = vec3f(0.75, 0.50, 0.30); }
    else if (ptype < 1.5)  { atmo = vec3f(0.30, 0.55, 0.90); }
    else if (ptype < 2.5)  { atmo = vec3f(0.40, 0.60, 0.80); }
    else if (ptype < 3.5)  { atmo = vec3f(0.80, 0.20, 0.05); }
    else                   { atmo = vec3f(0.70, 0.40, 0.15); }

    // Apply lighting + atmosphere.
    pcol = pcol * (0.1 + lit * 0.9);
    pcol = pcol + atmo * atmosphere * 0.5;

    // Ice specular glint.
    if (ptype > 1.5 && ptype < 2.5) {
      pcol = pcol + vec3f(pow(halfLit, 24.0) * 0.35);
    }

    // Soft planet edge.
    let edge = 1.0 - smoothstep(0.88, 1.0, pr2);
    col = mix(col, pcol, edge);
  }

  return vec4f(col.x, col.y, col.z, 1.0);
}
`;

// ── helpers ─────────────────────────────────────────────────────────

function randSeed(): [number, number, number] {
  return [
    Math.random() * 100,
    Math.random() * 100,
    Math.random() * 100,
  ];
}

// ── app ─────────────────────────────────────────────────────────────

export default function Planetarium() {
  const [idx, setIdx] = React.useState(0);
  const [seed, setSeed] = React.useState<[number, number, number]>(randSeed);
  const planet = PLANETS[idx];

  const data = React.useMemo(() => {
    return new Float32Array([planet.id, seed[0], seed[1], seed[2], 0, 0]);
  }, [planet.id, seed]);

  const prev = () => setIdx((i) => (i - 1 + PLANETS.length) % PLANETS.length);
  const next = () => setIdx((i) => (i + 1) % PLANETS.length);
  const regen = () => setSeed(randSeed());

  return (
    <Box style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: P.bg }}>
      {/* Full-bleed effect — same pattern as gallery FxPage */}
      <PlanetSurface key={`${planet.id}-${seed.join(',')}`} data={data} />

      {/* HUD floats on top */}
      <Hud planet={planet} onPrev={prev} onNext={next} onRegen={regen} />
    </Box>
  );
}

function PlanetSurface({ data }: { data: Float32Array }) {
  return (
    <Box style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}>
      <Effect shader={UNIFIED_WGSL} data={data} style={{ width: '100%', height: '100%' }} />
    </Box>
  );
}

function Hud({
  planet,
  onPrev,
  onNext,
  onRegen,
}: {
  planet: PlanetDef;
  onPrev: () => void;
  onNext: () => void;
  onRegen: () => void;
}) {
  return (
    <Col style={{ position: 'absolute', left: 0, bottom: 0, width: '100%' }}>
      <Row style={{
        backgroundColor: P.panel,
        borderTopWidth: 1,
        borderColor: P.border,
        paddingLeft: 1,
        paddingRight: 1,
        paddingTop: 0,
        paddingBottom: 0,
        gap: 1,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <Pressable onPress={onPrev}>
          <Box style={{ paddingLeft: 1, paddingRight: 1 }}>
            <Text style={{ color: P.accent, fontWeight: 'bold' }}>◀ prev</Text>
          </Box>
        </Pressable>

        <Col style={{ paddingLeft: 1, paddingRight: 1 }}>
          <Row style={{ gap: 1, alignItems: 'center' }}>
            <Text style={{ color: planet.color, fontWeight: 'bold' }}>{planet.name}</Text>
            <Text style={{ color: P.dim }}>({planet.type})</Text>
          </Row>
          <Text style={{ color: P.dim }}>{planet.desc}</Text>
        </Col>

        <Box style={{ flexGrow: 1 }} />

        <Pressable onPress={onRegen}>
          <Box style={{ backgroundColor: P.border, paddingLeft: 1, paddingRight: 1 }}>
            <Text style={{ color: P.warm, fontWeight: 'bold' }}>↻ regenerate</Text>
          </Box>
        </Pressable>

        <Pressable onPress={onNext}>
          <Box style={{ paddingLeft: 1, paddingRight: 1 }}>
            <Text style={{ color: P.accent, fontWeight: 'bold' }}>next ▶</Text>
          </Box>
        </Pressable>
      </Row>
    </Col>
  );
}
