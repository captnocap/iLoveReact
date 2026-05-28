// geometry_demo — a tour of @reactjit/geometries.
//
//   ./scripts/ship geometry_demo   →   zig-out/bin/geometry_demo
//
// Two things:
//   1. HAND-AUTHORED shapes (Pyramid / Octahedron / Prism), displayed in a row.
//      Each is just a `{ id, defaults, generate(params) }` def — a pure function
//      that pushes triangles into mesh(). The framework knows none of these names;
//      it interns the verts and draws them like any built-in.
//   2. A BUTTON that generates a COMPLEX RANDOM shape — a seeded-noise blob. Each
//      press picks a new seed, which changes the params, which re-runs the
//      generator (the runtime/dynamic path) and re-interns a brand-new mesh.
import { useState } from 'react';
import { Box, Col, Row, Text, Pressable, Scene3D } from '@reactjit/runtime/primitives';
import { mesh, normalize, type GeometryData, type Vec3 } from '@reactjit/geometries';

// ── tiny vector helper: outward face normal from a triangle's winding ──────────
function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  return normalize(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}
function flat(g: ReturnType<typeof mesh>, a: Vec3, b: Vec3, c: Vec3) {
  g.triFlat(a, b, c, faceNormal(a, b, c));
}

// ════════════════════════════════════════════════════════════════════════════
// 1. Hand-authored shapes — each a pure generate(params) → GeometryData.
// ════════════════════════════════════════════════════════════════════════════

// Square pyramid: a 4-sided cone, wound the same way (corner → apex → next corner,
// CCW around +Y) so the faces front outward.
const Pyramid = {
  id: 'demo:pyramid',
  defaults: { size: 1.4, height: 1.8 },
  generate({ size, height }: { size: number; height: number }): GeometryData {
    const g = mesh();
    const r = size / 2;
    const apex: Vec3 = [0, height, 0];
    // base corners CCW around +Y (viewed from above)
    const c: Vec3[] = [[r, 0, r], [-r, 0, r], [-r, 0, -r], [r, 0, -r]];
    for (let i = 0; i < 4; i++) {
      const p = c[i]!, q = c[(i + 1) % 4]!;
      flat(g, p, apex, q); // side
      flat(g, [0, 0, 0], q, p); // base wedge (normal faces -Y via winding)
    }
    return g.build();
  },
};

// Octahedron (a faceted diamond): top + bottom 4-sided cones sharing an equator.
const Octahedron = {
  id: 'demo:octahedron',
  defaults: { radius: 1.0 },
  generate({ radius }: { radius: number }): GeometryData {
    const g = mesh();
    const top: Vec3 = [0, radius, 0], bot: Vec3 = [0, -radius, 0];
    const eq: Vec3[] = [[radius, 0, 0], [0, 0, radius], [-radius, 0, 0], [0, 0, -radius]];
    for (let i = 0; i < 4; i++) {
      const a = eq[i]!, b = eq[(i + 1) % 4]!;
      flat(g, a, top, b); // upper face
      flat(g, b, bot, a); // lower face
    }
    return g.build();
  },
};

// Triangular prism: two end caps + three rectangular sides (via mesh.face, the
// proven box-face winding).
const Prism = {
  id: 'demo:prism',
  defaults: { radius: 0.9, length: 1.8 },
  generate({ radius: r, length: L }: { radius: number; length: number }): GeometryData {
    const g = mesh();
    const hl = L / 2;
    // triangle profile in XZ, swept along Y
    const prof: Vec3[] = [
      [0, 0, r],
      [r * 0.866, 0, -r * 0.5],
      [-r * 0.866, 0, -r * 0.5],
    ];
    const top = prof.map((p) => [p[0], hl, p[2]] as Vec3);
    const bot = prof.map((p) => [p[0], -hl, p[2]] as Vec3);
    flat(g, top[0]!, top[1]!, top[2]!); // top cap (+Y)
    flat(g, bot[2]!, bot[1]!, bot[0]!); // bottom cap (-Y)
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const n = faceNormal(bot[i]!, bot[j]!, top[j]!);
      g.face(bot[i]!, bot[j]!, top[j]!, top[i]!, n); // BL,BR,TR,TL
    }
    return g.build();
  },
};

// ════════════════════════════════════════════════════════════════════════════
// 2. The complex random shape — a seeded-noise blob (proven UV-sphere winding,
//    radius modulated by a seeded sum-of-waves so each seed is a new creature).
// ════════════════════════════════════════════════════════════════════════════

function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const RandomBlob = {
  id: 'demo:blob',
  defaults: { seed: 1, segments: 40, rings: 24, lumps: 5, amplitude: 0.45 },
  generate({ seed, segments, rings, lumps, amplitude }: {
    seed: number; segments: number; rings: number; lumps: number; amplitude: number;
  }): GeometryData {
    const rand = rng(seed);
    // A handful of random spatial-frequency waves; their sum displaces the radius.
    const waves = Array.from({ length: lumps }, () => ({
      fx: 1 + Math.floor(rand() * 5),
      fy: 1 + Math.floor(rand() * 5),
      fz: 1 + Math.floor(rand() * 5),
      phase: rand() * Math.PI * 2,
      amp: (0.4 + rand() * 0.6),
    }));
    const displace = (nx: number, ny: number, nz: number) => {
      let d = 0;
      for (const w of waves) d += w.amp * Math.sin(w.fx * nx + w.fy * ny + w.fz * nz + w.phase);
      return 1 + amplitude * (d / lumps);
    };
    const g = mesh();
    const PI = Math.PI;
    const pt = (theta: number, phi: number): { p: Vec3; n: Vec3 } => {
      const st = Math.sin(theta);
      const nx = st * Math.cos(phi), ny = Math.cos(theta), nz = st * Math.sin(phi);
      const r = displace(nx, ny, nz);
      return { p: [r * nx, r * ny, r * nz], n: [nx, ny, nz] };
    };
    for (let i = 0; i < rings; i++) {
      const t1 = (PI * i) / rings, t2 = (PI * (i + 1)) / rings;
      for (let j = 0; j < segments; j++) {
        const p1 = (2 * PI * j) / segments, p2 = (2 * PI * (j + 1)) / segments;
        const a = pt(t1, p1), b = pt(t1, p2), c = pt(t2, p2), d = pt(t2, p1);
        // (a,c,d) + (a,b,c) — outward winding. See Sphere.ts for why this isn't
        // (a,d,c) + (a,c,b) (which is back-facing for `a` = top corner).
        g.tri(a.p, a.n, [0, 0], c.p, c.n, [1, 1], d.p, d.n, [0, 1]);
        g.tri(a.p, a.n, [0, 0], b.p, b.n, [1, 0], c.p, c.n, [1, 1]);
      }
    }
    return g.build();
  },
};

// ════════════════════════════════════════════════════════════════════════════
// Cart
// ════════════════════════════════════════════════════════════════════════════

const HAND = [
  { def: Pyramid, params: { size: 1.4, height: 1.8 }, color: '#ffce54', label: 'Pyramid', x: -4.2 },
  { def: Octahedron, params: { radius: 1.0 }, color: '#5d9cec', label: 'Octahedron', x: -1.4 },
  { def: Prism, params: { radius: 0.9, length: 1.9 }, color: '#a0d468', label: 'Prism', x: 1.4 },
];

export default function GeometryDemo() {
  const [seed, setSeed] = useState(1);

  return (
    <Box style={{ width: '100%', height: '100%', backgroundColor: '#0b0e16' }}>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0b0e16">
        <Scene3D.Camera position={[0, 2.6, 10]} target={[0.4, 0.4, 0]} fov={52} />
        <Scene3D.AmbientLight color="#5a6680" intensity={0.55} />
        <Scene3D.DirectionalLight direction={[0.5, 0.9, 0.6]} color="#fff3e0" intensity={0.95} />
        <Scene3D.DirectionalLight direction={[-0.6, 0.2, -0.4]} color="#3a4a8a" intensity={0.5} />

        {/* hand-authored shapes, spinning slowly on Y so the facets read */}
        {HAND.map((s) => (
          <Scene3D.Mesh key={s.label} geometry={s.def} params={s.params} material={s.color}
            position={[s.x, 0.4, 0]} rotation={[0, 35, 0]} />
        ))}

        {/* the random blob — reseeded by the button */}
        <Scene3D.Mesh geometry={RandomBlob} params={{ seed, segments: 40, rings: 24, lumps: 5, amplitude: 0.45 }}
          material="#ff6b9d" position={[4.4, 0.4, 0]} />
      </Scene3D>

      {/* ── overlay UI ── */}
      <Col style={{ position: 'absolute', left: 18, top: 16, gap: 4 }}>
        <Text style={{ fontSize: 22, color: '#ffffff', fontWeight: 'bold' }}>@reactjit/geometries</Text>
        <Text style={{ fontSize: 13, color: '#8a93ad' }}>hand-authored shapes + a runtime-generated blob</Text>
      </Col>

      {/* labels under each hand shape + the blob */}
      <Row style={{ position: 'absolute', left: 0, bottom: 76, width: '100%', justifyContent: 'center', gap: 26 }}>
        {HAND.map((s) => (
          <Text key={s.label} style={{ fontSize: 12, color: s.color, fontWeight: 'bold' }}>{s.label}</Text>
        ))}
        <Text style={{ fontSize: 12, color: '#ff6b9d', fontWeight: 'bold' }}>{`RandomBlob #${seed}`}</Text>
      </Row>

      <Row style={{ position: 'absolute', left: 0, bottom: 22, width: '100%', justifyContent: 'center' }}>
        <Pressable onPress={() => setSeed(Math.floor(Math.random() * 1_000_000) + 1)}
          style={{ backgroundColor: '#ff6b9d', paddingLeft: 22, paddingRight: 22, paddingTop: 12, paddingBottom: 12, borderRadius: 10 }}>
          <Text style={{ fontSize: 15, color: '#1a0510', fontWeight: 'bold' }}>⟳  Generate random shape</Text>
        </Pressable>
      </Row>
    </Box>
  );
}
