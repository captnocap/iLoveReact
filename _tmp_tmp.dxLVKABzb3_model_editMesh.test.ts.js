(() => {
  // runtime/geometries/_util.ts
  function normalize(x, y, z) {
    const len = Math.sqrt(x * x + y * y + z * z);
    if (len < 1e-6) return [0, 0, 0];
    return [x / len, y / len, z / len];
  }
  var Mesh = class {
    v = [];
    maxR2 = 0;
    /** Push one vertex (position, normal, uv). */
    vert(p, n, uv2) {
      this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], uv2[0], uv2[1]);
      const r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
      if (r2 > this.maxR2) this.maxR2 = r2;
    }
    /** A triangle with per-corner normals + UVs (mirrors Zig addTri). */
    tri(a, na, ua, b, nb, ub, c, nc, uc) {
      this.vert(a, na, ua);
      this.vert(b, nb, ub);
      this.vert(c, nc, uc);
    }
    /** Flat-shaded triangle: one normal, default UVs (mirrors Zig addTriFlat). */
    triFlat(a, b, c, n) {
      this.tri(a, n, [0, 0], b, n, [1, 0], c, n, [1, 1]);
    }
    /**
     * A quad as two triangles with a single face normal. Mirrors Zig addFace
     * exactly: corners run world bottom→top (BL,BR,TR,TL), V is flipped so a
     * texture stays upright on the face, winding is [0,1,2, 0,2,3].
     *
     * `pinUv` collapses all four corner UVs to a single texel so the face samples
     * one flat color instead of stretching the whole texture across it — the
     * "this face isn't textured" path (e.g. the thin edge of a sign). Omit it for
     * the normal upright 0..1 mapping.
     */
    face(v1, v2, v3, v4, n, pinUv) {
      const corners = [v1, v2, v3, v4];
      const uvs = pinUv ? [pinUv, pinUv, pinUv, pinUv] : [[0, 1], [1, 1], [1, 0], [0, 0]];
      const order = [0, 1, 2, 0, 2, 3];
      for (const ti of order) this.vert(corners[ti], n, uvs[ti]);
    }
    build() {
      return {
        positions: new Float32Array(this.v),
        count: this.v.length / 8,
        bounds: { radius: Math.sqrt(this.maxR2) }
      };
    }
  };
  function mesh() {
    return new Mesh();
  }

  // runtime/geometries/Box.ts
  var BOX_DEFAULTS = { width: 1, height: 1, depth: 1 };
  var PIN = [0, 0];
  function generate(p) {
    const hx = p.width * 0.5;
    const hy = p.height * 0.5;
    const hz = p.depth * 0.5;
    const faces = p.texturedFaces;
    const pin = (face) => faces && !faces.includes(face) ? PIN : void 0;
    const g = mesh();
    g.face([-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1], pin("front"));
    g.face([hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [0, 0, -1], pin("back"));
    g.face([hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [1, 0, 0], pin("right"));
    g.face([-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-1, 0, 0], pin("left"));
    g.face([-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz], [0, 1, 0], pin("top"));
    g.face([-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0], pin("bottom"));
    return g.build();
  }

  // runtime/geometries/Sphere.ts
  var SPHERE_DEFAULTS = { radius: 0.5, segments: 24, rings: 16 };
  var PI = Math.PI;
  function pos(r, theta, phi) {
    const st = Math.sin(theta);
    return [r * st * Math.cos(phi), r * Math.cos(theta), r * st * Math.sin(phi)];
  }
  function nrm(theta, phi) {
    const st = Math.sin(theta);
    return [st * Math.cos(phi), Math.cos(theta), st * Math.sin(phi)];
  }
  function uv(n) {
    return [(n[0] + 1) * 0.5, (1 - n[1]) * 0.5];
  }
  function generate2(p) {
    const g = mesh();
    const { radius: r, segments, rings } = p;
    for (let i = 0; i < rings; i++) {
      const t1 = PI * i / rings;
      const t2 = PI * (i + 1) / rings;
      for (let j = 0; j < segments; j++) {
        const p1 = 2 * PI * j / segments;
        const p2 = 2 * PI * (j + 1) / segments;
        const a = pos(r, t1, p1), b = pos(r, t1, p2), c = pos(r, t2, p2), d = pos(r, t2, p1);
        const na = nrm(t1, p1), nb = nrm(t1, p2), nc = nrm(t2, p2), nd = nrm(t2, p1);
        g.tri(a, na, uv(na), c, nc, uv(nc), d, nd, uv(nd));
        g.tri(a, na, uv(na), b, nb, uv(nb), c, nc, uv(nc));
      }
    }
    return g.build();
  }

  // runtime/geometries/Head.ts
  var HEAD_DEFAULTS = { radius: 0.5, segments: 24, rings: 16 };
  var PI2 = Math.PI;
  function pos2(r, theta, phi) {
    const st = Math.sin(theta);
    return [r * st * Math.cos(phi), r * Math.cos(theta), r * st * Math.sin(phi)];
  }
  function nrm2(theta, phi) {
    const st = Math.sin(theta);
    return [st * Math.cos(phi), Math.cos(theta), st * Math.sin(phi)];
  }
  function uvDecal(n) {
    let x = -n[0];
    let y = n[1];
    if (n[2] > 0) {
      const len = Math.hypot(x, y);
      if (len < 1e-6) {
        x = 0;
        y = 1;
      } else {
        x /= len;
        y /= len;
      }
    }
    return [(x + 1) * 0.5, (1 - y) * 0.5];
  }
  function generate3(p) {
    const g = mesh();
    const { radius: r, segments, rings } = p;
    for (let i = 0; i < rings; i++) {
      const t1 = PI2 * i / rings;
      const t2 = PI2 * (i + 1) / rings;
      for (let j = 0; j < segments; j++) {
        const p1 = 2 * PI2 * j / segments;
        const p2 = 2 * PI2 * (j + 1) / segments;
        const a = pos2(r, t1, p1), b = pos2(r, t1, p2), c = pos2(r, t2, p2), d = pos2(r, t2, p1);
        const na = nrm2(t1, p1), nb = nrm2(t1, p2), nc = nrm2(t2, p2), nd = nrm2(t2, p1);
        g.tri(a, na, uvDecal(na), c, nc, uvDecal(nc), d, nd, uvDecal(nd));
        g.tri(a, na, uvDecal(na), b, nb, uvDecal(nb), c, nc, uvDecal(nc));
      }
    }
    return g.build();
  }

  // runtime/geometries/Carve.ts
  var CARVE_DEFAULTS = {
    mask: [1],
    cols: 1,
    rows: 1,
    width: 1,
    height: 1,
    depth: 0.25,
    inflate: 0.6
  };
  function generate4(p) {
    const { cols, rows, width, height, depth, inflate } = p;
    const g = mesh();
    const cellW = width / cols;
    const cellH = height / rows;
    const INF = 1e9;
    const solid = (cx, cy) => cx >= 0 && cy >= 0 && cx < cols && cy < rows && p.mask[cy * cols + cx] > 0.5;
    const dist = new Float64Array(cols * rows);
    for (let i = 0; i < cols * rows; i++) dist[i] = p.mask[i] > 0.5 ? INF : 0;
    const dAt = (cx, cy) => cx < 0 || cy < 0 || cx >= cols || cy >= rows ? 0 : dist[cy * cols + cx];
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;
        if (dist[i] === 0) continue;
        dist[i] = Math.min(dist[i], dAt(cx - 1, cy) + 1, dAt(cx, cy - 1) + 1, dAt(cx - 1, cy - 1) + 1.4, dAt(cx + 1, cy - 1) + 1.4);
      }
    }
    for (let cy = rows - 1; cy >= 0; cy--) {
      for (let cx = cols - 1; cx >= 0; cx--) {
        const i = cy * cols + cx;
        dist[i] = Math.min(dist[i], dAt(cx + 1, cy) + 1, dAt(cx, cy + 1) + 1, dAt(cx + 1, cy + 1) + 1.4, dAt(cx - 1, cy + 1) + 1.4);
      }
    }
    let dmax = 1;
    for (let i = 0; i < cols * rows; i++) {
      if (dist[i] < INF && dist[i] > dmax) dmax = dist[i];
    }
    const cw = cols + 1;
    const half = new Float64Array(cw * (rows + 1));
    for (let cy = 0; cy <= rows; cy++) {
      for (let cx = 0; cx <= cols; cx++) {
        const d = Math.min(dAt(cx - 1, cy - 1), dAt(cx, cy - 1), dAt(cx - 1, cy), dAt(cx, cy));
        const rounded = Math.sqrt(Math.min(d, dmax) / dmax);
        half[cy * cw + cx] = 0.5 * depth * (1 - inflate + inflate * rounded);
      }
    }
    const hAt = (cx, cy) => half[cy * cw + cx];
    const lateral = (cx, cy) => {
      const x0 = Math.max(0, cx - 1), x1 = Math.min(cols, cx + 1);
      const y0 = Math.max(0, cy - 1), y1 = Math.min(rows, cy + 1);
      const dhdx = (hAt(x1, cy) - hAt(x0, cy)) / ((x1 - x0) * cellW);
      const dhdy = (hAt(cx, y1) - hAt(cx, y0)) / ((y1 - y0) * -cellH);
      return [-dhdx, -dhdy];
    };
    const frontN = (cx, cy) => {
      const [lx, ly] = lateral(cx, cy);
      return normalize(lx, ly, -1);
    };
    const backN = (cx, cy) => {
      const [lx, ly] = lateral(cx, cy);
      return normalize(lx, ly, 1);
    };
    const X = (cx) => -width / 2 + cx * cellW;
    const Y = (cy) => height / 2 - cy * cellH;
    const U = (cx) => 1 - cx / cols;
    const V = (cy) => cy / rows;
    const uv2 = (cx, cy) => [U(cx), V(cy)];
    const EPS = 1e-5;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (!solid(cx, cy)) continue;
        const x0 = X(cx), x1 = X(cx + 1);
        const yt = Y(cy), yb = Y(cy + 1);
        const h00 = hAt(cx, cy), h10 = hAt(cx + 1, cy);
        const h01 = hAt(cx, cy + 1), h11 = hAt(cx + 1, cy + 1);
        g.tri(
          [x1, yb, -h11],
          frontN(cx + 1, cy + 1),
          uv2(cx + 1, cy + 1),
          [x0, yb, -h01],
          frontN(cx, cy + 1),
          uv2(cx, cy + 1),
          [x0, yt, -h00],
          frontN(cx, cy),
          uv2(cx, cy)
        );
        g.tri(
          [x1, yb, -h11],
          frontN(cx + 1, cy + 1),
          uv2(cx + 1, cy + 1),
          [x0, yt, -h00],
          frontN(cx, cy),
          uv2(cx, cy),
          [x1, yt, -h10],
          frontN(cx + 1, cy),
          uv2(cx + 1, cy)
        );
        g.tri(
          [x0, yb, h01],
          backN(cx, cy + 1),
          uv2(cx, cy + 1),
          [x1, yb, h11],
          backN(cx + 1, cy + 1),
          uv2(cx + 1, cy + 1),
          [x1, yt, h10],
          backN(cx + 1, cy),
          uv2(cx + 1, cy)
        );
        g.tri(
          [x0, yb, h01],
          backN(cx, cy + 1),
          uv2(cx, cy + 1),
          [x1, yt, h10],
          backN(cx + 1, cy),
          uv2(cx + 1, cy),
          [x0, yt, h00],
          backN(cx, cy),
          uv2(cx, cy)
        );
        const pin = [1 - (cx + 0.5) / cols, (cy + 0.5) / rows];
        if (!solid(cx + 1, cy) && h10 + h11 > EPS) {
          g.face([x1, yb, h11], [x1, yb, -h11], [x1, yt, -h10], [x1, yt, h10], [1, 0, 0], pin);
        }
        if (!solid(cx - 1, cy) && h00 + h01 > EPS) {
          g.face([x0, yb, -h01], [x0, yb, h01], [x0, yt, h00], [x0, yt, -h00], [-1, 0, 0], pin);
        }
        if (!solid(cx, cy - 1) && h00 + h10 > EPS) {
          g.face([x0, yt, h00], [x1, yt, h10], [x1, yt, -h10], [x0, yt, -h00], [0, 1, 0], pin);
        }
        if (!solid(cx, cy + 1) && h01 + h11 > EPS) {
          g.face([x0, yb, -h01], [x1, yb, -h11], [x1, yb, h11], [x0, yb, h01], [0, -1, 0], pin);
        }
      }
    }
    return g.build();
  }

  // runtime/geometries/Globe.ts
  var GLOBE_DEFAULTS = { radius: 0.5, segments: 32, rings: 16, amount: 0, scaleY: 1 };
  var PI3 = Math.PI;
  function globeSurface(p) {
    const { radius } = p;
    const amount = p.amount ?? 0;
    const scaleY = p.scaleY ?? 1;
    const scaleX = p.scaleX ?? 1;
    const scaleZ = p.scaleZ ?? 1;
    const grid = p.displace;
    const dCols = p.dCols ?? 0;
    const dRows = p.dRows ?? 0;
    const hasGrid = !!grid && dCols > 1 && dRows > 1 && amount !== 0;
    const prof = p.profile && p.profile.length > 0 ? p.profile : null;
    const profileAt = (v) => {
      if (!prof) return 1;
      if (prof.length === 1) return prof[0];
      const t = Math.max(0, Math.min(1, v)) * (prof.length - 1);
      const i = Math.min(prof.length - 2, Math.floor(t));
      return prof[i] + (prof[i + 1] - prof[i]) * (t - i);
    };
    let topAvg = 0;
    let botAvg = 0;
    if (hasGrid) {
      for (let x = 0; x < dCols; x++) {
        topAvg += grid[x];
        botAvg += grid[(dRows - 1) * dCols + x];
      }
      topAvg /= dCols;
      botAvg /= dCols;
    }
    const sample = (u, v) => {
      if (!hasGrid) return 0;
      if (v <= 0) return topAvg;
      if (v >= 1) return botAvg;
      const fx = u * dCols - 0.5;
      const fy = v * dRows - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.max(0, Math.min(dRows - 1, Math.floor(fy)));
      const y1 = Math.max(0, Math.min(dRows - 1, y0 + 1));
      const tx = fx - x0;
      const ty = fy - y0;
      const xa = (x0 % dCols + dCols) % dCols;
      const xb = (xa + 1) % dCols;
      const d00 = grid[y0 * dCols + xa], d10 = grid[y0 * dCols + xb];
      const d01 = grid[y1 * dCols + xa], d11 = grid[y1 * dCols + xb];
      return (d00 * (1 - tx) + d10 * tx) * (1 - ty) + (d01 * (1 - tx) + d11 * tx) * ty;
    };
    const shz = p.shiftZ && p.shiftZ.length > 0 ? p.shiftZ : null;
    const shiftAt = (v) => {
      if (!shz) return 0;
      if (shz.length === 1) return shz[0];
      const t = Math.max(0, Math.min(1, v)) * (shz.length - 1);
      const i = Math.min(shz.length - 2, Math.floor(t));
      return shz[i] + (shz[i + 1] - shz[i]) * (t - i);
    };
    const floorCut = p.floorY != null && p.floorY < 1 ? -radius * scaleY * p.floorY : -Infinity;
    const base = (u, v) => {
      const theta = PI3 * v;
      const phi = PI3 / 2 - 2 * PI3 * u;
      const st = Math.sin(theta);
      const rxz = radius * profileAt(v);
      const y = Math.max(floorCut, Math.cos(theta) * radius * scaleY);
      return [
        st * Math.cos(phi) * rxz * scaleX,
        y,
        (st * Math.sin(phi) * rxz + radius * shiftAt(v)) * scaleZ
      ];
    };
    const NEPS = 1e-3;
    const baseNormal = (u, v) => {
      if (v <= NEPS) return [0, 1, 0];
      if (v >= 1 - NEPS) return [0, -1, 0];
      const pu0 = base(u - NEPS, v), pu1 = base(u + NEPS, v);
      const pv0 = base(u, v - NEPS), pv1 = base(u, v + NEPS);
      const tu = [pu1[0] - pu0[0], pu1[1] - pu0[1], pu1[2] - pu0[2]];
      const tv = [pv1[0] - pv0[0], pv1[1] - pv0[1], pv1[2] - pv0[2]];
      return normalize(
        tv[1] * tu[2] - tv[2] * tu[1],
        tv[2] * tu[0] - tv[0] * tu[2],
        tv[0] * tu[1] - tv[1] * tu[0]
      );
    };
    return (u, v, extraDisplace = 0) => {
      const b = base(u, v);
      const d = amount * (sample(u, v) + extraDisplace);
      if (d === 0) return b;
      const n = baseNormal(u, v);
      return [b[0] + n[0] * d, b[1] + n[1] * d, b[2] + n[2] * d];
    };
  }
  function generate5(p) {
    const { segments, rings } = p;
    const surf = globeSurface(p);
    const pos4 = (i, j) => surf(j / segments, i / rings);
    const nrm4 = (i, j) => {
      if (i <= 0) return [0, 1, 0];
      if (i >= rings) return [0, -1, 0];
      const pu0 = pos4(i, j - 1), pu1 = pos4(i, j + 1);
      const pv0 = pos4(i - 1, j), pv1 = pos4(i + 1, j);
      const tu = [pu1[0] - pu0[0], pu1[1] - pu0[1], pu1[2] - pu0[2]];
      const tv = [pv1[0] - pv0[0], pv1[1] - pv0[1], pv1[2] - pv0[2]];
      return normalize(
        tv[1] * tu[2] - tv[2] * tu[1],
        tv[2] * tu[0] - tv[0] * tu[2],
        tv[0] * tu[1] - tv[1] * tu[0]
      );
    };
    const g = mesh();
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segments; j++) {
        const a = pos4(i, j), na = nrm4(i, j);
        const b = pos4(i, j + 1), nb = nrm4(i, j + 1);
        const c = pos4(i + 1, j + 1), nc = nrm4(i + 1, j + 1);
        const d = pos4(i + 1, j), nd = nrm4(i + 1, j);
        const ua = [j / segments, i / rings];
        const ub = [(j + 1) / segments, i / rings];
        const uc = [(j + 1) / segments, (i + 1) / rings];
        const ud = [j / segments, (i + 1) / rings];
        g.tri(a, na, ua, d, nd, ud, c, nc, uc);
        g.tri(a, na, ua, c, nc, uc, b, nb, ub);
      }
    }
    return g.build();
  }

  // runtime/geometries/Plane.ts
  var PLANE_DEFAULTS = { width: 1, depth: 1 };
  function generate6(p) {
    const hx = p.width * 0.5;
    const hz = p.depth * 0.5;
    const g = mesh();
    g.face([-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz], [0, 1, 0]);
    return g.build();
  }

  // runtime/geometries/Cylinder.ts
  var CYLINDER_DEFAULTS = { radius: 0.5, height: 1, segments: 24 };
  var PI4 = Math.PI;
  function generate7(p) {
    const { radius: r, height, segments } = p;
    const hy = height * 0.5;
    const g = mesh();
    for (let j = 0; j < segments; j++) {
      const a1 = 2 * PI4 * j / segments;
      const a2 = 2 * PI4 * (j + 1) / segments;
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const c2 = Math.cos(a2), s2 = Math.sin(a2);
      const a = [r * c1, -hy, r * s1];
      const b = [r * c2, -hy, r * s2];
      const c = [r * c2, hy, r * s2];
      const d = [r * c1, hy, r * s1];
      const n1 = [c1, 0, s1];
      const n2 = [c2, 0, s2];
      g.tri(a, n1, [0, 0], d, n1, [0, 1], c, n2, [1, 1]);
      g.tri(a, n1, [0, 0], c, n2, [1, 1], b, n2, [1, 0]);
      g.triFlat([0, hy, 0], c, d, [0, 1, 0]);
      g.triFlat([0, -hy, 0], a, b, [0, -1, 0]);
    }
    return g.build();
  }

  // runtime/geometries/Cone.ts
  var CONE_DEFAULTS = { radius: 0.5, height: 1, segments: 24 };
  var PI5 = Math.PI;
  function generate8(p) {
    const { radius: r, height, segments } = p;
    const hy = height * 0.5;
    const slope = Math.abs(height) > 1e-3 ? r / height : 1;
    const apex = [0, hy, 0];
    const g = mesh();
    for (let j = 0; j < segments; j++) {
      const a1 = 2 * PI5 * j / segments;
      const a2 = 2 * PI5 * (j + 1) / segments;
      const mid = (a1 + a2) * 0.5;
      const c1 = Math.cos(a1), s1 = Math.sin(a1);
      const c2 = Math.cos(a2), s2 = Math.sin(a2);
      const a = [r * c1, -hy, r * s1];
      const b = [r * c2, -hy, r * s2];
      const n1 = normalize(c1, slope, s1);
      const n2 = normalize(c2, slope, s2);
      const na = normalize(Math.cos(mid), slope, Math.sin(mid));
      g.tri(a, n1, [0, 0], apex, na, [0.5, 1], b, n2, [1, 0]);
      g.triFlat([0, -hy, 0], a, b, [0, -1, 0]);
    }
    return g.build();
  }

  // runtime/geometries/Torus.ts
  var TORUS_DEFAULTS = { radius: 0.5, tube: 0.25, segments: 24, sides: 16 };
  var PI6 = Math.PI;
  function pos3(r, tr, u, v) {
    const ring = r + tr * Math.cos(v);
    return [ring * Math.cos(u), tr * Math.sin(v), ring * Math.sin(u)];
  }
  function nrm3(u, v) {
    return [Math.cos(u) * Math.cos(v), Math.sin(v), Math.sin(u) * Math.cos(v)];
  }
  function generate9(p) {
    const { radius: r, tube: tr, segments, sides } = p;
    const g = mesh();
    for (let i = 0; i < segments; i++) {
      const u1 = 2 * PI6 * i / segments;
      const u2 = 2 * PI6 * (i + 1) / segments;
      for (let j = 0; j < sides; j++) {
        const v1 = 2 * PI6 * j / sides;
        const v2 = 2 * PI6 * (j + 1) / sides;
        const a = pos3(r, tr, u1, v1), b = pos3(r, tr, u2, v1), c = pos3(r, tr, u2, v2), d = pos3(r, tr, u1, v2);
        const na = nrm3(u1, v1), nb = nrm3(u2, v1), nc = nrm3(u2, v2), nd = nrm3(u1, v2);
        g.tri(a, na, [0, 0], d, nd, [0, 1], c, nc, [1, 1]);
        g.tri(a, na, [0, 0], c, nc, [1, 1], b, nb, [1, 0]);
      }
    }
    return g.build();
  }

  // runtime/geometries/Heightfield.ts
  var WAVE_NONE = { amplitude: 0, length: 0, speed: 0, dirX: 1, dirZ: 0, phase: 0 };
  var HEIGHTFIELD_DEFAULTS = {
    width: 1,
    depth: 1,
    base: 0,
    wave: WAVE_NONE,
    t: 0
  };
  var TAU = Math.PI * 2;
  function waveHeight(w, x, z, t) {
    if (Math.abs(w.amplitude) <= 1e-4 || w.length <= 1e-4) return 0;
    const dlen = Math.sqrt(w.dirX * w.dirX + w.dirZ * w.dirZ);
    const dx = dlen > 1e-4 ? w.dirX / dlen : 1;
    const dz = dlen > 1e-4 ? w.dirZ / dlen : 0;
    const cycles = (x * dx + z * dz) / w.length + w.phase + t * w.speed;
    return Math.sin(cycles * TAU) * w.amplitude;
  }
  function generate10(p) {
    const { cols, rows, width: w, depth: h, base, wave, t } = p;
    const hs = p.heights;
    const g = mesh();
    if (cols < 2 || rows < 2) return g.build();
    if (hs.length !== cols * rows) return g.build();
    const dx = w / (cols - 1);
    const dz = h / (rows - 1);
    const x0 = -w * 0.5;
    const z0 = -h * 0.5;
    const cf = cols - 1;
    const rf = rows - 1;
    const at = (i, j) => {
      const x = x0 + i * dx;
      const z = z0 + j * dz;
      return [x, hs[j * cols + i] + waveHeight(wave, x, z, t), z];
    };
    const drop = (pt) => [pt[0], base, pt[2]];
    const heightAt = (i, j) => {
      const ci = Math.min(Math.max(i, 0), cols - 1);
      const cj = Math.min(Math.max(j, 0), rows - 1);
      const x = x0 + ci * dx;
      const z = z0 + cj * dz;
      return hs[cj * cols + ci] + waveHeight(wave, x, z, t);
    };
    const normalAt = (i, j) => {
      const hl = heightAt(i - 1, j);
      const hr = heightAt(i + 1, j);
      const hu = heightAt(i, j - 1);
      const hd = heightAt(i, j + 1);
      return normalize(-(hr - hl) / (2 * dx), 1, -(hd - hu) / (2 * dz));
    };
    for (let j = 0; j + 1 < rows; j++) {
      for (let i = 0; i + 1 < cols; i++) {
        const pa = at(i, j), pb = at(i + 1, j), pc = at(i + 1, j + 1), pd = at(i, j + 1);
        const na = normalAt(i, j), nb = normalAt(i + 1, j), nc = normalAt(i + 1, j + 1), nd = normalAt(i, j + 1);
        const ua = [i / cf, j / rf];
        const ub = [(i + 1) / cf, j / rf];
        const uc = [(i + 1) / cf, (j + 1) / rf];
        const ud = [i / cf, (j + 1) / rf];
        g.vert(pa, na, ua);
        g.vert(pc, nc, uc);
        g.vert(pb, nb, ub);
        g.vert(pa, na, ua);
        g.vert(pd, nd, ud);
        g.vert(pc, nc, uc);
      }
    }
    const skirt = (a, b, c, d, n) => {
      const uv2 = [0, 0];
      g.vert(a, n, uv2);
      g.vert(b, n, uv2);
      g.vert(c, n, uv2);
      g.vert(a, n, uv2);
      g.vert(c, n, uv2);
      g.vert(d, n, uv2);
    };
    for (let i = 0; i + 1 < cols; i++) {
      const tn0 = at(i, 0), tn1 = at(i + 1, 0);
      if (tn0[1] > base || tn1[1] > base) skirt(drop(tn1), drop(tn0), tn0, tn1, [0, 0, -1]);
      const js = rows - 1;
      const ts0 = at(i, js), ts1 = at(i + 1, js);
      if (ts0[1] > base || ts1[1] > base) skirt(drop(ts0), drop(ts1), ts1, ts0, [0, 0, 1]);
    }
    for (let j = 0; j + 1 < rows; j++) {
      const tw0 = at(0, j), tw1 = at(0, j + 1);
      if (tw0[1] > base || tw1[1] > base) skirt(drop(tw0), drop(tw1), tw1, tw0, [-1, 0, 0]);
      const ie = cols - 1;
      const te0 = at(ie, j), te1 = at(ie, j + 1);
      if (te0[1] > base || te1[1] > base) skirt(drop(te1), drop(te0), te0, te1, [1, 0, 0]);
    }
    return g.build();
  }

  // runtime/geometries/Humanoid.ts
  var HUMANOID_DEFAULTS = {
    height: 2,
    shoulderWidth: 0.72,
    hipWidth: 0.46,
    headSize: 0.24,
    limbThickness: 1,
    sides: 8,
    smoothShading: true
  };
  function ringVerts(r, sides) {
    const out = [];
    const t = r.twist ?? 0;
    for (let i = 0; i < sides; i++) {
      const a = -Math.PI / 2 + t + i / sides * Math.PI * 2;
      const x = r.cx + Math.cos(a) * r.rx;
      const z = r.cz + Math.sin(a) * r.rz;
      out.push([x, r.y, z]);
    }
    return out;
  }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }
  function normalize3(v) {
    const L = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / L, v[1] / L, v[2] / L];
  }
  var HUMANOID_ATLAS = {
    head: { u0: 0, u1: 0.5, v0: 0.5, v1: 0 },
    // top-left, flipped (crown→image top)
    arms: { u0: 0.5, u1: 1, v0: 0, v1: 0.5 },
    // top-right (shoulder→top, tip→middle)
    torso: { u0: 0, u1: 0.5, v0: 1, v1: 0.5 },
    // bottom-left, flipped (hip→image bottom)
    legs: { u0: 0.5, u1: 1, v0: 0.5, v1: 1 }
    // bottom-right (hip→middle, toe→image bottom)
  };
  function emitSweep(g, rings, sides, smooth, rect) {
    const ringPts = rings.map((r) => ringVerts(r, sides));
    const numRings = ringPts.length;
    const descending = rings.length >= 2 && rings[1].y <= rings[0].y;
    const faceN = [];
    for (let i = 0; i < numRings - 1; i++) {
      const a = ringPts[i];
      const b = ringPts[i + 1];
      const row = [];
      for (let s = 0; s < sides; s++) {
        const s2 = (s + 1) % sides;
        const p0 = a[s];
        const p1 = a[s2];
        const p3 = b[s];
        const e1 = sub(p1, p0);
        const e2 = sub(p3, p0);
        const n = normalize3(descending ? cross(e1, e2) : cross(e2, e1));
        row.push(n);
      }
      faceN.push(row);
    }
    let vertN = null;
    if (smooth) {
      vertN = [];
      for (let i = 0; i < numRings; i++) {
        const row = [];
        for (let s = 0; s < sides; s++) {
          const sPrev = (s + sides - 1) % sides;
          let nx = 0, ny = 0, nz = 0;
          const acc = (qi, qs) => {
            if (qi < 0 || qi >= faceN.length) return;
            const n = faceN[qi][qs];
            nx += n[0];
            ny += n[1];
            nz += n[2];
          };
          acc(i - 1, sPrev);
          acc(i - 1, s);
          acc(i, sPrev);
          acc(i, s);
          const L = Math.hypot(nx, ny, nz);
          row.push(L > 1e-6 ? [nx / L, ny / L, nz / L] : [0, 1, 0]);
        }
        vertN.push(row);
      }
    }
    const uAt = (s) => rect.u0 + s / sides * (rect.u1 - rect.u0);
    const vAt = (i) => numRings > 1 ? rect.v0 + i / (numRings - 1) * (rect.v1 - rect.v0) : rect.v0;
    for (let i = 0; i < numRings - 1; i++) {
      const a = ringPts[i];
      const b = ringPts[i + 1];
      for (let s = 0; s < sides; s++) {
        const s2 = (s + 1) % sides;
        const p0 = a[s];
        const p1 = a[s2];
        const p2 = b[s2];
        const p3 = b[s];
        const fn = faceN[i][s];
        const n0 = vertN ? vertN[i][s] : fn;
        const n1 = vertN ? vertN[i][s2] : fn;
        const n2 = vertN ? vertN[i + 1][s2] : fn;
        const n3 = vertN ? vertN[i + 1][s] : fn;
        const uv0 = [uAt(s), vAt(i)];
        const uv1 = [uAt(s + 1), vAt(i)];
        const uv2 = [uAt(s + 1), vAt(i + 1)];
        const uv3 = [uAt(s), vAt(i + 1)];
        if (descending) {
          g.tri(p0, n0, uv0, p1, n1, uv1, p2, n2, uv2);
          g.tri(p0, n0, uv0, p2, n2, uv2, p3, n3, uv3);
        } else {
          g.tri(p0, n0, uv0, p3, n3, uv3, p2, n2, uv2);
          g.tri(p0, n0, uv0, p2, n2, uv2, p1, n1, uv1);
        }
      }
    }
  }
  function emitCap(g, ring, sides, up, rect, vEdge) {
    const pts = ringVerts(ring, sides);
    const center = [ring.cx, ring.y, ring.cz];
    const n = up ? [0, 1, 0] : [0, -1, 0];
    const perimeterV = vEdge === "v0" ? rect.v0 : rect.v1;
    const dv = (rect.v1 - rect.v0) * 0.08 * (vEdge === "v0" ? 1 : -1);
    const centerUV = [(rect.u0 + rect.u1) * 0.5, perimeterV + dv];
    const uAt = (s) => rect.u0 + s / sides * (rect.u1 - rect.u0);
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      const uv_s = [uAt(s), perimeterV];
      const uv_s2 = [uAt(s + 1), perimeterV];
      if (up) {
        g.tri(center, n, centerUV, pts[s2], n, uv_s2, pts[s], n, uv_s);
      } else {
        g.tri(center, n, centerUV, pts[s], n, uv_s, pts[s2], n, uv_s2);
      }
    }
  }
  function generate11(p) {
    const g = mesh();
    const sides = Math.max(4, p.sides | 0);
    const t = p.limbThickness;
    const H = p.height;
    const hipY = H * 0.46;
    const waistY = H * 0.54;
    const chestY = H * 0.66;
    const shoulderY = H * 0.74;
    const neckY = H * 0.78;
    const chinY = H * 0.83;
    const faceY = H * 0.92;
    const crownY = H * 1;
    const shoulderHalf = p.shoulderWidth * 0.5;
    const hipHalf = p.hipWidth * 0.5;
    const neckRing = { y: neckY, cx: 0, cz: 0, rx: H * 0.07, rz: H * 0.06 };
    const bodyRings = [
      { y: hipY, cx: 0, cz: 0, rx: hipHalf * 1.08, rz: hipHalf * 0.85 },
      // hip
      { y: waistY, cx: 0, cz: 0, rx: hipHalf * 1.02, rz: hipHalf * 0.82 },
      // waist (no narrowing — straight column)
      { y: shoulderY, cx: 0, cz: 0, rx: shoulderHalf, rz: shoulderHalf * 0.62 },
      // shoulder
      neckRing
    ];
    const headRings = [
      neckRing,
      { y: chinY, cx: 0, cz: 0.01, rx: p.headSize * 0.72, rz: p.headSize * 0.78 },
      // jaw
      { y: faceY, cx: 0, cz: 0.01, rx: p.headSize * 1, rz: p.headSize * 1 },
      // face (widest)
      { y: H * 0.96, cx: 0, cz: 0, rx: p.headSize * 0.7, rz: p.headSize * 0.7 },
      // upper-skull dome
      { y: crownY, cx: 0, cz: 0, rx: p.headSize * 0.22, rz: p.headSize * 0.22 }
      // crown (near-point)
    ];
    emitSweep(g, bodyRings, sides, p.smoothShading, HUMANOID_ATLAS.torso);
    emitSweep(g, headRings, sides, p.smoothShading, HUMANOID_ATLAS.head);
    emitCap(g, headRings[headRings.length - 1], sides, true, HUMANOID_ATLAS.head, "v0");
    const legRings = (sx) => [
      { y: hipY + 0.04, cx: sx, cz: 0, rx: H * 0.085 * t, rz: H * 0.085 * t },
      // root inside trunk
      { y: hipY - H * 0.05, cx: sx, cz: 0, rx: H * 0.085 * t, rz: H * 0.085 * t },
      // upper thigh
      { y: hipY - H * 0.18, cx: sx, cz: 0, rx: H * 0.078 * t, rz: H * 0.078 * t },
      // knee
      { y: hipY - H * 0.34, cx: sx, cz: 0.01, rx: H * 0.07 * t, rz: H * 0.07 * t },
      // ankle
      { y: hipY - H * 0.39, cx: sx, cz: 0.06, rx: H * 0.07 * t, rz: H * 0.14 * t },
      // foot (forward-stretched, no X widen)
      { y: hipY - H * 0.4, cx: sx, cz: 0.1, rx: H * 0.05 * t, rz: H * 0.09 * t }
      // toe (taper forward + down)
    ];
    const legXOffset = hipHalf * 0.55;
    for (const sx of [-legXOffset, legXOffset]) {
      const rings = legRings(sx);
      emitSweep(g, rings, sides, p.smoothShading, HUMANOID_ATLAS.legs);
      emitCap(g, rings[rings.length - 1], sides, false, HUMANOID_ATLAS.legs, "v1");
    }
    const armRings = (sx) => [
      { y: shoulderY, cx: sx * 0.55, cz: 0, rx: H * 0.07 * t, rz: H * 0.07 * t },
      // root inside trunk
      { y: shoulderY - H * 0.04, cx: sx, cz: 0, rx: H * 0.07 * t, rz: H * 0.07 * t },
      // shoulder bulge
      { y: shoulderY - H * 0.16, cx: sx, cz: 0, rx: H * 0.062 * t, rz: H * 0.062 * t },
      // bicep
      { y: shoulderY - H * 0.3, cx: sx, cz: 0, rx: H * 0.055 * t, rz: H * 0.055 * t },
      // forearm
      { y: shoulderY - H * 0.4, cx: sx, cz: 0, rx: H * 0.045 * t, rz: H * 0.045 * t },
      // wrist
      { y: shoulderY - H * 0.43, cx: sx, cz: 0, rx: H * 0.02 * t, rz: H * 0.02 * t }
      // arm end (near-point)
    ];
    const armX = shoulderHalf * 1.02;
    for (const sx of [-armX, armX]) {
      const rings = armRings(sx);
      emitSweep(g, rings, sides, p.smoothShading, HUMANOID_ATLAS.arms);
      emitCap(g, rings[rings.length - 1], sides, false, HUMANOID_ATLAS.arms, "v1");
    }
    return g.build();
  }

  // runtime/geometries/VoxelMesh.ts
  var FACES = [
    { key: "xp", n: [1, 0, 0], axis: 0, sign: 1, uAxis: 2, vAxis: 1 },
    { key: "xn", n: [-1, 0, 0], axis: 0, sign: -1, uAxis: 2, vAxis: 1 },
    { key: "yp", n: [0, 1, 0], axis: 1, sign: 1, uAxis: 0, vAxis: 2 },
    { key: "yn", n: [0, -1, 0], axis: 1, sign: -1, uAxis: 0, vAxis: 2 },
    { key: "zp", n: [0, 0, 1], axis: 2, sign: 1, uAxis: 0, vAxis: 1 },
    { key: "zn", n: [0, 0, -1], axis: 2, sign: -1, uAxis: 0, vAxis: 1 }
  ];
  function key(x, y, z) {
    return `${x}:${y}:${z}`;
  }
  function blockCoord(block, axis) {
    return axis === 0 ? block.x : axis === 1 ? block.y : block.z;
  }
  function facePlane(block, face) {
    return blockCoord(block, face.axis) + (face.sign > 0 ? 1 : 0);
  }
  function faceCell(block, face) {
    return {
      block,
      face,
      plane: facePlane(block, face),
      u: blockCoord(block, face.uAxis),
      v: blockCoord(block, face.vAxis)
    };
  }
  function bounds(blocks, cell) {
    if (blocks.length === 0) {
      return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], size: [0, 0, 0] };
    }
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const block of blocks) {
      minX = Math.min(minX, block.x - 0.5);
      minY = Math.min(minY, block.y - 0.5);
      minZ = Math.min(minZ, block.z - 0.5);
      maxX = Math.max(maxX, block.x + 0.5);
      maxY = Math.max(maxY, block.y + 0.5);
      maxZ = Math.max(maxZ, block.z + 0.5);
    }
    const min = [minX * cell, minY * cell, minZ * cell];
    const max = [maxX * cell, maxY * cell, maxZ * cell];
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    return { min, max, center, size };
  }
  function sampleDisplace(params, pos4, b) {
    const grid = params.displace;
    const cols = Math.max(1, Math.round(params.dCols ?? 0));
    const rows = Math.max(1, Math.round(params.dRows ?? 0));
    if (!grid || grid.length < cols * rows || !(params.amount && params.amount !== 0)) return 0;
    const sx = b.size[0] > 1e-6 ? (pos4[0] - b.min[0]) / b.size[0] : 0.5;
    const sy = b.size[1] > 1e-6 ? 1 - (pos4[1] - b.min[1]) / b.size[1] : 0.5;
    const gx = Math.max(0, Math.min(cols - 1, Math.round(sx * (cols - 1))));
    const gy = Math.max(0, Math.min(rows - 1, Math.round(sy * (rows - 1))));
    return Math.max(-1, Math.min(1, Number(grid[gy * cols + gx] ?? 0))) * params.amount;
  }
  function point(raw, normal, params, b) {
    const c = [raw[0] - b.center[0], raw[1] - b.center[1], raw[2] - b.center[2]];
    const d = sampleDisplace(params, raw, b);
    return [c[0] + normal[0] * d, c[1] + normal[1] * d, c[2] + normal[2] * d];
  }
  function makeQuad(face, plane2, u0, v0, u1, v1, cell, params, b) {
    const p = (u, v) => {
      const raw = [0, 0, 0];
      raw[face.axis] = (plane2 - 0.5) * cell;
      raw[face.uAxis] = (u - 0.5) * cell;
      raw[face.vAxis] = (v - 0.5) * cell;
      return point(raw, face.n, params, b);
    };
    const a = p(u0, v0);
    const b1 = p(u1, v0);
    const c = p(u1, v1);
    const d = p(u0, v1);
    return face.sign > 0 ? [a, b1, c, d] : [b1, a, d, c];
  }
  function greedyFaces(blocks) {
    const occupied = new Set(blocks.map((b) => key(b.x, b.y, b.z)));
    const buckets = /* @__PURE__ */ new Map();
    for (const block of blocks) {
      for (const face of FACES) {
        const nx = block.x + face.n[0];
        const ny = block.y + face.n[1];
        const nz = block.z + face.n[2];
        if (occupied.has(key(nx, ny, nz))) continue;
        const cell = faceCell(block, face);
        const bucketKey = `${face.key}:${block.kind ?? "voxel"}:${cell.plane}`;
        const arr = buckets.get(bucketKey) ?? [];
        arr.push(cell);
        buckets.set(bucketKey, arr);
      }
    }
    const out = [];
    for (const cells of buckets.values()) {
      const pending = new Set(cells.map((c) => `${c.u}:${c.v}`));
      const byKey = new Map(cells.map((c) => [`${c.u}:${c.v}`, c]));
      const sorted = cells.slice().sort((a, b) => a.v - b.v || a.u - b.u);
      for (const start of sorted) {
        const startKey = `${start.u}:${start.v}`;
        if (!pending.has(startKey)) continue;
        let width = 1;
        while (pending.has(`${start.u + width}:${start.v}`)) width++;
        let height = 1;
        outer: while (true) {
          for (let du = 0; du < width; du++) {
            if (!pending.has(`${start.u + du}:${start.v + height}`)) break outer;
          }
          height++;
        }
        for (let dv = 0; dv < height; dv++) {
          for (let du = 0; du < width; du++) pending.delete(`${start.u + du}:${start.v + dv}`);
        }
        const first = byKey.get(startKey);
        out.push({ face: first.face, plane: first.plane, u0: start.u, v0: start.v, u1: start.u + width, v1: start.v + height });
      }
    }
    return out;
  }
  var VOXEL_MESH_DEFAULTS = Object.freeze({
    blocks: [],
    cellSizeMeters: 1,
    amount: 0
  });
  function generate12(params) {
    const blocks = params.blocks ?? [];
    const cell = Math.max(1e-3, Number(params.cellSizeMeters ?? 1));
    const b = bounds(blocks, cell);
    const m = mesh();
    for (const q of greedyFaces(blocks)) {
      const [a, c, d, e] = makeQuad(q.face, q.plane, q.u0, q.v0, q.u1, q.v1, cell, params, b);
      m.face(a, c, d, e, q.face.n, [0.5, 0.5]);
    }
    return m.build();
  }

  // runtime/geometries/GrassBlade.ts
  var GRASS_BLADE_DEFAULTS = { blades: 3, width: 0.14, tipTaper: 0.25 };
  function generate13(p) {
    const g = mesh();
    const halfW = p.width * 0.5;
    const tipHalfW = halfW * p.tipTaper;
    const count = Math.max(1, Math.floor(p.blades));
    for (let b = 0; b < count; b += 1) {
      const theta = (b + 0.5) / count * Math.PI;
      const dx = Math.cos(theta);
      const dz = Math.sin(theta);
      const n = [dz, 0, -dx];
      const nBack = [-dz, 0, dx];
      const bl = [-dx * halfW, 0, -dz * halfW];
      const br = [dx * halfW, 0, dz * halfW];
      const tr = [dx * tipHalfW, 1, dz * tipHalfW];
      const tl = [-dx * tipHalfW, 1, -dz * tipHalfW];
      g.tri(bl, n, [0, 0], br, n, [1, 0], tr, n, [1, 1]);
      g.tri(bl, n, [0, 0], tr, n, [1, 1], tl, n, [0, 1]);
      g.tri(bl, nBack, [0, 0], tr, nBack, [1, 1], br, nBack, [1, 0]);
      g.tri(bl, nBack, [0, 0], tl, nBack, [0, 1], tr, nBack, [1, 1]);
    }
    return g.build();
  }

  // runtime/geometries/BushClump.ts
  var BUSH_CLUMP_DEFAULTS = { cards: 5, width: 0.5, tipTaper: 0.3, splay: 0.5 };
  function generate14(p) {
    const g = mesh();
    const halfW = p.width * 0.5;
    const tipHalfW = halfW * p.tipTaper;
    const count = Math.max(1, Math.floor(p.cards));
    for (let b = 0; b < count; b += 1) {
      const theta = (b + 0.5) / count * Math.PI * 2;
      const dx = Math.cos(theta);
      const dz = Math.sin(theta);
      const perpX = -dz;
      const perpZ = dx;
      const n = [dx, 0.6, dz];
      const nBack = [-dx, 0.6, -dz];
      const tipX = dx * p.splay;
      const tipZ = dz * p.splay;
      const bl = [-perpX * halfW, 0, -perpZ * halfW];
      const br = [perpX * halfW, 0, perpZ * halfW];
      const tr = [tipX + perpX * tipHalfW, 1, tipZ + perpZ * tipHalfW];
      const tl = [tipX - perpX * tipHalfW, 1, tipZ - perpZ * tipHalfW];
      g.tri(bl, n, [0, 0], br, n, [1, 0], tr, n, [1, 1]);
      g.tri(bl, n, [0, 0], tr, n, [1, 1], tl, n, [0, 1]);
      g.tri(bl, nBack, [0, 0], tr, nBack, [1, 1], br, nBack, [1, 0]);
      g.tri(bl, nBack, [0, 0], tl, nBack, [0, 1], tr, nBack, [1, 1]);
    }
    return g.build();
  }

  // runtime/geometries/FlowerHead.ts
  var FLOWER_HEAD_DEFAULTS = { cards: 3, radius: 1 };
  function generate15(p) {
    const g = mesh();
    const count = Math.max(1, Math.floor(p.cards));
    const r = Math.max(0.01, p.radius);
    const u0 = 10, u1 = 11, v0 = 10, v1 = 11;
    for (let b = 0; b < count; b += 1) {
      const theta = (b + 0.5) / count * Math.PI;
      const dx = Math.cos(theta);
      const dz = Math.sin(theta);
      const n = [dz, 0, -dx];
      const nb = [-dz, 0, dx];
      const bl = [-dx * r, -r, -dz * r];
      const br = [dx * r, -r, dz * r];
      const tr = [dx * r, r, dz * r];
      const tl = [-dx * r, r, -dz * r];
      g.tri(bl, n, [u0, v0], br, n, [u1, v0], tr, n, [u1, v1]);
      g.tri(bl, n, [u0, v0], tr, n, [u1, v1], tl, n, [u0, v1]);
      g.tri(bl, nb, [u0, v0], tr, nb, [u1, v1], br, nb, [u1, v0]);
      g.tri(bl, nb, [u0, v0], tl, nb, [u0, v1], tr, nb, [u1, v1]);
    }
    return g.build();
  }

  // runtime/geometries/Frond.ts
  var FROND_DEFAULTS = { style: "feathered", width: 0.5, tipTaper: 0.1, arc: 0.8, sag: 0.18, segments: 12 };
  var STYLE_OFFSET = { feathered: 0, broad: 10 };
  function generate16(p) {
    const g = mesh();
    const segs = Math.max(2, Math.floor(p.segments));
    const uOff = STYLE_OFFSET[p.style] ?? 0;
    const spine = (t) => ({
      y: t - p.sag * t * t,
      z: p.arc * t * t,
      halfW: p.width * 0.5 * (1 - (1 - p.tipTaper) * t)
    });
    for (let s = 0; s < segs; s += 1) {
      const t0 = s / segs;
      const t1 = (s + 1) / segs;
      const a = spine(t0);
      const b = spine(t1);
      const slope = normalize(0, b.y - a.y, b.z - a.z);
      const nf = normalize(0, -slope[2], slope[1]);
      const nb = [-nf[0], -nf[1], -nf[2]];
      const bl = [-a.halfW, a.y, a.z];
      const br = [a.halfW, a.y, a.z];
      const tr = [b.halfW, b.y, b.z];
      const tl = [-b.halfW, b.y, b.z];
      const uL = uOff + 0;
      const uR = uOff + 1;
      g.tri(bl, nf, [uL, t0], br, nf, [uR, t0], tr, nf, [uR, t1]);
      g.tri(bl, nf, [uL, t0], tr, nf, [uR, t1], tl, nf, [uL, t1]);
      g.tri(bl, nb, [uL, t0], tr, nb, [uR, t1], br, nb, [uR, t0]);
      g.tri(bl, nb, [uL, t0], tl, nb, [uL, t1], tr, nb, [uR, t1]);
    }
    return g.build();
  }

  // runtime/geometries/PalmTrunk.ts
  var PALM_TRUNK_DEFAULTS = {
    baseRadius: 0.13,
    topRadius: 0.08,
    curve: 0.16,
    rings: 11,
    ringDepth: 0.12,
    sides: 10,
    segments: 28
  };
  var TAU2 = Math.PI * 2;
  function generate17(p) {
    const g = mesh();
    const segs = Math.max(2, Math.floor(p.segments));
    const sides = Math.max(3, Math.floor(p.sides));
    const at = (t) => {
      const taper = p.baseRadius + (p.topRadius - p.baseRadius) * t;
      const bulge = 1 + 0.18 * Math.exp(-((t - 0.12) * (t - 0.12)) / 0.01);
      const ring = 1 + p.ringDepth * Math.cos(t * p.rings * TAU2);
      const r = taper * bulge * ring;
      const cx = p.curve * (t * t * 0.7 + Math.sin(t * 2.8) * 0.05);
      return { r, cx };
    };
    const ringVerts2 = (t) => {
      const { r, cx } = at(t);
      const out = [];
      for (let s = 0; s <= sides; s += 1) {
        const a = s / sides * TAU2;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        out.push({ pos: [cx + dx * r, t, dz * r], nrm: normalize(dx, 0.15, dz), u: s / sides });
      }
      return out;
    };
    let lower = ringVerts2(0);
    for (let i = 1; i <= segs; i += 1) {
      const t = i / segs;
      const upper = ringVerts2(t);
      const v0 = (i - 1) / segs;
      const v1 = t;
      for (let s = 0; s < sides; s += 1) {
        const bl = lower[s], br = lower[s + 1], tr = upper[s + 1], tl = upper[s];
        g.tri(bl.pos, bl.nrm, [bl.u, v0], tl.pos, tl.nrm, [tl.u, v1], tr.pos, tr.nrm, [tr.u, v1]);
        g.tri(bl.pos, bl.nrm, [bl.u, v0], tr.pos, tr.nrm, [tr.u, v1], br.pos, br.nrm, [br.u, v0]);
      }
      lower = upper;
    }
    return g.build();
  }

  // runtime/geometries/PathTube.ts
  var PATH_TUBE_DEFAULTS = {
    // a gently S-curved default trunk spine, base→tip
    spine: [0, 0, 0.02, 0.25, 0.08, 0.5, 0.06, 0.75, 0.12, 1],
    baseRadius: 0.12,
    tipRadius: 0.07,
    sides: 10
  };
  var TAU3 = Math.PI * 2;
  function generate18(p) {
    const g = mesh();
    const sp = p.spine;
    const n = Math.floor(sp.length / 2);
    if (n < 2) return g.build();
    const sides = Math.max(3, Math.floor(p.sides));
    const tangent = (i) => {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const tx = sp[b * 2] - sp[a * 2];
      const ty = sp[b * 2 + 1] - sp[a * 2 + 1];
      const L = Math.hypot(tx, ty) || 1;
      return [tx / L, ty / L];
    };
    const ring = (i) => {
      const cx = sp[i * 2];
      const cy = sp[i * 2 + 1];
      const t = i / (n - 1);
      const r = p.baseRadius + (p.tipRadius - p.baseRadius) * t;
      const [tx, ty] = tangent(i);
      const nx = -ty, ny = tx;
      const out = [];
      for (let s = 0; s <= sides; s += 1) {
        const ang = s / sides * TAU3;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        out.push({ pos: [cx + r * ca * nx, cy + r * ca * ny, r * sa], nrm: normalize(ca * nx, ca * ny, sa), u: s / sides });
      }
      return out;
    };
    let lower = ring(0);
    for (let i = 1; i < n; i += 1) {
      const upper = ring(i);
      const v0 = (i - 1) / (n - 1);
      const v1 = i / (n - 1);
      for (let s = 0; s < sides; s += 1) {
        const bl = lower[s], br = lower[s + 1], tr = upper[s + 1], tl = upper[s];
        g.tri(bl.pos, bl.nrm, [bl.u, v0], br.pos, br.nrm, [br.u, v0], tr.pos, tr.nrm, [tr.u, v1]);
        g.tri(bl.pos, bl.nrm, [bl.u, v0], tr.pos, tr.nrm, [tr.u, v1], tl.pos, tl.nrm, [tl.u, v1]);
      }
      lower = upper;
    }
    return g.build();
  }

  // runtime/geometries/index.ts
  function def(id, generate19, defaults) {
    return { id, generate: generate19, defaults };
  }
  var Box = def("Box", generate, BOX_DEFAULTS);
  var Sphere = def("Sphere", generate2, SPHERE_DEFAULTS);
  var Head = def("Head", generate3, HEAD_DEFAULTS);
  var Carve = def("Carve", generate4, CARVE_DEFAULTS);
  var Globe = def("Globe", generate5, GLOBE_DEFAULTS);
  var Plane = def("Plane", generate6, PLANE_DEFAULTS);
  var Cylinder = def("Cylinder", generate7, CYLINDER_DEFAULTS);
  var Cone = def("Cone", generate8, CONE_DEFAULTS);
  var Torus = def("Torus", generate9, TORUS_DEFAULTS);
  var Heightfield = { ...def("Heightfield", generate10, HEIGHTFIELD_DEFAULTS), hostKind: "heightfield" };
  var Humanoid = def("Humanoid", generate11, HUMANOID_DEFAULTS);
  var VoxelMesh = def("VoxelMesh", generate12, VOXEL_MESH_DEFAULTS);
  var GrassBlade = def("GrassBlade", generate13, GRASS_BLADE_DEFAULTS);
  var BushClump = def("BushClump", generate14, BUSH_CLUMP_DEFAULTS);
  var FlowerHead = def("FlowerHead", generate15, FLOWER_HEAD_DEFAULTS);
  var Frond = def("Frond", generate16, FROND_DEFAULTS);
  var PalmTrunk = def("PalmTrunk", generate17, PALM_TRUNK_DEFAULTS);
  var PathTube = def("PathTube", generate18, PATH_TUBE_DEFAULTS);

  // cart/editor/model/editMesh.ts
  function cloneMesh(m) {
    const out = {
      verts: m.verts.map((v) => [v[0], v[1], v[2]]),
      faces: m.faces.map((f) => {
        const nf = { loop: f.loop.slice() };
        if (f.diagonal) nf.diagonal = [f.diagonal[0], f.diagonal[1]];
        if (f.uv) nf.uv = f.uv.map((u) => [u[0], u[1]]);
        if (f.material != null) nf.material = f.material;
        if (f.glass != null) nf.glass = f.glass;
        if (f.tag != null) nf.tag = f.tag;
        return nf;
      })
    };
    if (m.mounts) out.mounts = m.mounts.map((mt) => {
      const nm = { ...mt, position: [mt.position[0], mt.position[1], mt.position[2]] };
      if (mt.axis) nm.axis = [mt.axis[0], mt.axis[1], mt.axis[2]];
      if (mt.limit) nm.limit = { ...mt.limit };
      return nm;
    });
    if (m.pivot) out.pivot = [m.pivot[0], m.pivot[1], m.pivot[2]];
    if (m.slots) out.slots = m.slots.map((s) => ({ ...s }));
    if (m.lights) out.lights = m.lights.map((l) => ({
      ...l,
      position: [l.position[0], l.position[1], l.position[2]],
      ...l.dir ? { dir: [l.dir[0], l.dir[1], l.dir[2]] } : {}
    }));
    return out;
  }
  function mirrorMesh(m, axis) {
    const out = cloneMesh(m);
    for (const v of out.verts) v[axis] = -v[axis];
    for (let fi = 0; fi < out.faces.length; fi += 1) {
      const f = out.faces[fi];
      const source = m.faces[fi];
      if (source.loop.length === 4) f.diagonal = quadDiagonalVertices(m, source);
      reverseFaceLoopKeepingAnchor(f);
    }
    if (out.mounts) for (const mt of out.mounts) {
      mt.position[axis] = -mt.position[axis];
      if (mt.axis) mt.axis[axis] = -mt.axis[axis];
    }
    if (out.pivot) out.pivot[axis] = -out.pivot[axis];
    if (out.lights) for (const l of out.lights) {
      l.position[axis] = -l.position[axis];
      if (l.dir) l.dir[axis] = -l.dir[axis];
    }
    return out;
  }
  var MOUNT_AXIS_LETTER = ["x", "y", "z"];
  function mirrorMount(mount, axes, c = 0) {
    const position = [mount.position[0], mount.position[1], mount.position[2]];
    const axis = mount.axis ? [mount.axis[0], mount.axis[1], mount.axis[2]] : void 0;
    let suffix = "";
    for (const a of axes) {
      position[a] = 2 * c - position[a];
      if (axis) axis[a] = -axis[a];
      suffix += MOUNT_AXIS_LETTER[a];
    }
    return axis ? { ...mount, name: `${mount.name}_${suffix}`, position, axis } : { ...mount, name: `${mount.name}_${suffix}`, position };
  }
  function symmetrize(m, axis, keepPositive, c = 0, eps = 1e-5) {
    const cut = cutMeshByPlane(m, axis, c);
    const keepSign = keepPositive ? 1 : -1;
    const verts = [];
    const byPos = /* @__PURE__ */ new Map();
    const key2 = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)},${p[2].toFixed(5)}`;
    const intern = (p) => {
      const k = key2(p);
      let i = byPos.get(k);
      if (i == null) {
        i = verts.length;
        verts.push([p[0], p[1], p[2]]);
        byPos.set(k, i);
      }
      return i;
    };
    const reflect = (p) => {
      const r = [p[0], p[1], p[2]];
      r[axis] = 2 * c - r[axis];
      return r;
    };
    const faces = [];
    for (const f of cut.faces) {
      if (f.loop.length < 3) continue;
      let cs = 0;
      for (const vi of f.loop) cs += cut.verts[vi][axis];
      cs = cs / f.loop.length - c;
      if (cs * keepSign < -eps) continue;
      const sourceDiagonal = f.loop.length === 4 ? quadDiagonalVertices(cut, f) : void 0;
      const keptBySource = /* @__PURE__ */ new Map();
      const keptLoop = f.loop.map((vi) => {
        const id = intern(cut.verts[vi]);
        keptBySource.set(vi, id);
        return id;
      });
      faces.push({
        ...f,
        loop: keptLoop,
        uv: f.uv ? f.uv.map((u) => [u[0], u[1]]) : void 0,
        diagonal: sourceDiagonal ? [keptBySource.get(sourceDiagonal[0]), keptBySource.get(sourceDiagonal[1])] : void 0
      });
      if (Math.abs(cs) > eps) {
        const twinBySource = /* @__PURE__ */ new Map();
        const twin = {
          ...f,
          loop: f.loop.map((vi) => {
            const id = intern(reflect(cut.verts[vi]));
            twinBySource.set(vi, id);
            return id;
          }),
          uv: f.uv ? f.uv.map((u) => [u[0], u[1]]) : void 0,
          diagonal: sourceDiagonal ? [twinBySource.get(sourceDiagonal[0]), twinBySource.get(sourceDiagonal[1])] : void 0
        };
        reverseFaceLoopKeepingAnchor(twin);
        faces.push(twin);
      }
    }
    const keptMounts = (m.mounts ?? []).filter((mt) => (mt.position[axis] - c) * keepSign >= -eps);
    const taken = new Set(keptMounts.map((mt) => mt.name));
    const uniq = (base) => {
      let f = base;
      for (let k = 2; taken.has(f); k += 1) f = `${base}_${k}`;
      taken.add(f);
      return f;
    };
    const mirroredMounts = keptMounts.filter((mt) => Math.abs(mt.position[axis] - c) > eps).map((mt) => {
      const r = mirrorMount(mt, [axis], c);
      return { ...r, name: uniq(r.name) };
    });
    const mounts = [...keptMounts, ...mirroredMounts];
    return { ...m, verts, faces, mounts: mounts.length ? mounts : m.mounts };
  }
  function sub2(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }
  function cross2(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  function faceNormal(m, face) {
    let nx = 0, ny = 0, nz = 0;
    const loop = face.loop;
    for (let i = 0; i < loop.length; i += 1) {
      const cur = m.verts[loop[i]];
      const nxt = m.verts[loop[(i + 1) % loop.length]];
      nx += (cur[1] - nxt[1]) * (cur[2] + nxt[2]);
      ny += (cur[2] - nxt[2]) * (cur[0] + nxt[0]);
      nz += (cur[0] - nxt[0]) * (cur[1] + nxt[1]);
    }
    const len = Math.hypot(nx, ny, nz);
    return len < 1e-9 ? [0, 1, 0] : [nx / len, ny / len, nz / len];
  }
  var SMOOTH_CREASE_DEG = 40;
  function quadTriPositions(m, face) {
    const L = face.loop;
    if (face.diagonal) {
      const [a, b] = face.diagonal;
      const ai = L.indexOf(a), bi = L.indexOf(b);
      if (ai >= 0 && bi >= 0 && ((ai + 2) % 4 === bi || (bi + 2) % 4 === ai)) {
        const useAC2 = ai % 2 === 0;
        return useAC2 ? [[0, 1, 2], [0, 2, 3]] : [[1, 2, 3], [1, 3, 0]];
      }
    }
    const v = (li) => m.verts[L[li]];
    const normal = faceNormal(m, face);
    const triOk = (i, j, k) => dot(cross2(sub2(v(j), v(i)), sub2(v(k), v(i))), normal) > 0;
    const acConvex = triOk(0, 1, 2) && triOk(0, 2, 3);
    const bdConvex = triOk(1, 2, 3) && triOk(1, 3, 0);
    let useAC;
    if (acConvex !== bdConvex) useAC = acConvex;
    else {
      const d2 = (i, j) => {
        const e = sub2(v(j), v(i));
        return dot(e, e);
      };
      useAC = d2(0, 2) <= d2(1, 3);
    }
    return useAC ? [[0, 1, 2], [0, 2, 3]] : [[1, 2, 3], [1, 3, 0]];
  }
  function quadDiagonalVertices(m, face) {
    const first = quadTriPositions(m, face)[0];
    return [face.loop[first[0]], face.loop[first[2]]];
  }
  function reverseFaceLoopKeepingAnchor(face) {
    if (face.loop.length > 1) face.loop = [face.loop[0], ...face.loop.slice(1).reverse()];
    if (face.uv && face.uv.length > 1) face.uv = [face.uv[0], ...face.uv.slice(1).reverse()];
  }
  function editMeshToGeometry(m, includeFace, faceGroupsOut) {
    const g = mesh();
    const flat = [0.5, 0.5];
    const faceN = m.faces.map((f) => f.loop.length >= 3 ? faceNormal(m, f) : [0, 1, 0]);
    const vertFaces = /* @__PURE__ */ new Map();
    m.faces.forEach((f, fi) => {
      if (f.loop.length < 3) return;
      for (const vi of f.loop) {
        let a = vertFaces.get(vi);
        if (!a) {
          a = [];
          vertFaces.set(vi, a);
        }
        a.push(fi);
      }
    });
    const cosCrease = Math.cos(SMOOTH_CREASE_DEG * Math.PI / 180);
    const normalAt = (vi, fi) => {
      const fn = faceN[fi];
      let nx = 0, ny = 0, nz = 0;
      for (const gf of vertFaces.get(vi) ?? [fi]) {
        const gn = faceN[gf];
        if (gn[0] * fn[0] + gn[1] * fn[1] + gn[2] * fn[2] >= cosCrease) {
          nx += gn[0];
          ny += gn[1];
          nz += gn[2];
        }
      }
      const L = Math.hypot(nx, ny, nz) || 1;
      return [nx / L, ny / L, nz / L];
    };
    for (let fi = 0; fi < m.faces.length; fi += 1) {
      const face = m.faces[fi];
      if (includeFace && !includeFace(face)) continue;
      if (face.loop.length < 3) continue;
      const uv2 = face.uv;
      const corner = (li) => {
        const vi = face.loop[li];
        return [m.verts[vi], normalAt(vi, fi), uv2?.[li] ?? flat];
      };
      const tris = face.loop.length === 4 ? quadTriPositions(m, face) : Array.from({ length: face.loop.length - 2 }, (_, i) => [0, i + 1, i + 2]);
      for (const [l0, l1, l2] of tris) {
        const [pa, na, ua] = corner(l0);
        const [pb, nb, ub] = corner(l1);
        const [pc, nc, uc] = corner(l2);
        g.tri(pa, na, ua, pb, nb, ub, pc, nc, uc);
        faceGroupsOut?.push(fi);
      }
    }
    return g.build();
  }
  var SHAPE_SIDES_MIN = 3;
  var SHAPE_SIDES_MAX = 48;
  function clampSides(n) {
    return Math.max(SHAPE_SIDES_MIN, Math.min(SHAPE_SIDES_MAX, Math.round(n)));
  }
  function cylinder(radius, height, segments = 16) {
    const seg = clampSides(segments);
    const y = height / 2;
    const verts = [];
    for (let i = 0; i < seg; i += 1) {
      const a = i / seg * Math.PI * 2;
      const cx = Math.cos(a) * radius, cz = Math.sin(a) * radius;
      verts.push([cx, -y, cz]);
      verts.push([cx, y, cz]);
    }
    const bottom = (i) => i % seg * 2;
    const top = (i) => i % seg * 2 + 1;
    const faces = [];
    for (let i = 0; i < seg; i += 1) {
      faces.push({ loop: [bottom(i), top(i), top(i + 1), bottom(i + 1)] });
    }
    const bottomCenter = verts.length;
    verts.push([0, -y, 0]);
    const topCenter = verts.length;
    verts.push([0, y, 0]);
    for (let i = 0; i < seg; i += 1) {
      faces.push({ loop: [top(i), topCenter, top(i + 1)] });
      faces.push({ loop: [bottom(i), bottom(i + 1), bottomCenter] });
    }
    return fullFaceUV({ verts, faces });
  }
  function plane(width, depth) {
    const x = width / 2, z = depth / 2;
    const verts = [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]];
    return fullFaceUV({ verts, faces: [{ loop: [0, 3, 2, 1] }] });
  }
  function projectVert(v, axis) {
    if (axis === "x") return [v[2], v[1]];
    if (axis === "y") return [v[0], v[2]];
    return [v[0], v[1]];
  }
  function faceSquareUV(verts, loop) {
    const n = faceNormal({ verts, faces: [] }, { loop });
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    const axis = ax >= ay && ax >= az ? "x" : ay >= az ? "y" : "z";
    const pts = loop.map((i) => projectVert(verts[i], axis));
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const [u, v] of pts) {
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const du = maxU - minU || 1, dv = maxV - minV || 1;
    return pts.map(([u, v]) => [(u - minU) / du, (v - minV) / dv]);
  }
  function fullFaceUV(m) {
    return {
      ...m,
      faces: m.faces.map((face) => face.loop.length < 3 ? face : { ...face, uv: faceSquareUV(m.verts, face.loop) })
    };
  }
  var POS_KEY_DP = 5;
  function cutMeshByPlane(m, axis, c, eps = 1e-6) {
    const verts = m.verts.map((v) => [v[0], v[1], v[2]]);
    const keyOf = (p) => `${p[0].toFixed(POS_KEY_DP)},${p[1].toFixed(POS_KEY_DP)},${p[2].toFixed(POS_KEY_DP)}`;
    const vmap = /* @__PURE__ */ new Map();
    verts.forEach((v, i) => vmap.set(keyOf(v), i));
    const internVert = (p) => {
      const k = keyOf(p);
      let i = vmap.get(k);
      if (i == null) {
        i = verts.length;
        verts.push(p);
        vmap.set(k, i);
      }
      return i;
    };
    const faces = [];
    for (const face of m.faces) {
      const loop = face.loop;
      const side = loop.map((vi) => {
        const d = verts[vi][axis] - c;
        return d < -eps ? -1 : d > eps ? 1 : 0;
      });
      if (!(side.some((s) => s < 0) && side.some((s) => s > 0))) {
        faces.push(face);
        continue;
      }
      const negLoop = [];
      const posLoop = [];
      const uv2 = face.uv;
      const negUV = uv2 ? [] : null;
      const posUV = uv2 ? [] : null;
      const lerpUV = (i, j, t) => [uv2[i][0] + (uv2[j][0] - uv2[i][0]) * t, uv2[i][1] + (uv2[j][1] - uv2[i][1]) * t];
      for (let i = 0; i < loop.length; i += 1) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        const sa = side[i], sb = side[(i + 1) % loop.length];
        if (sa <= 0) {
          negLoop.push(a);
          negUV?.push(uv2[i]);
        }
        if (sa >= 0) {
          posLoop.push(a);
          posUV?.push(uv2[i]);
        }
        if (sa < 0 && sb > 0 || sa > 0 && sb < 0) {
          const va = verts[a], vb = verts[b];
          const t = (c - va[axis]) / (vb[axis] - va[axis]);
          const p = [va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t, va[2] + (vb[2] - va[2]) * t];
          p[axis] = c;
          const xi = internVert(p);
          negLoop.push(xi);
          posLoop.push(xi);
          if (uv2) {
            const cuv = lerpUV(i, (i + 1) % loop.length, t);
            negUV.push(cuv);
            posUV.push(cuv);
          }
        }
      }
      if (negLoop.length >= 3) faces.push({ loop: negLoop, uv: negUV ?? void 0, material: face.material, tag: face.tag });
      if (posLoop.length >= 3) faces.push({ loop: posLoop, uv: posUV ?? void 0, material: face.material, tag: face.tag });
    }
    return { ...m, verts, faces };
  }
  var cloneCutFace = (face) => ({
    ...face,
    loop: face.loop.slice(),
    uv: face.uv?.map((p) => [p[0], p[1]])
  });
  function loopCutFromFace(m, options) {
    const start = m.faces[options.face];
    if (!start || start.loop.length < 2) return m;
    const verts = m.verts.map((v) => [v[0], v[1], v[2]]);
    const faces = m.faces.map(cloneCutFace);
    const processed = /* @__PURE__ */ new Set();
    const centers = /* @__PURE__ */ new Map();
    const cutCount = Math.max(1, Math.round(options.cuts));
    const startLoop = start.loop;
    const startSide = [
      startLoop[options.direction % startLoop.length],
      startLoop[(options.direction + 1) % startLoop.length]
    ];
    const selectedFaces = new Set(options.selectedFaces ?? [options.face]);
    aligned: for (let edge = 0; edge < startLoop.length; edge += 1) {
      const candidate = [startLoop[edge], startLoop[(edge + 1) % startLoop.length]];
      for (const faceIndex of selectedFaces) {
        if (faceIndex === options.face) continue;
        const other = faces[faceIndex];
        if (other?.loop.includes(candidate[0]) && other.loop.includes(candidate[1])) {
          startSide[0] = candidate[0];
          startSide[1] = candidate[1];
          break aligned;
        }
      }
    }
    const startLength = Math.hypot(
      verts[startSide[1]][0] - verts[startSide[0]][0],
      verts[startSide[1]][1] - verts[startSide[0]][1],
      verts[startSide[1]][2] - verts[startSide[0]][2]
    );
    if (startLength < 1e-9) return m;
    const offsetRatio = Math.max(0, Math.min(1, options.offset / startLength));
    const uvAt = (face, vi) => {
      const i = face.loop.indexOf(vi);
      const uv2 = i >= 0 ? face.uv?.[i] : void 0;
      return uv2 ? [uv2[0], uv2[1]] : [0.5, 0.5];
    };
    const centerVertex = (edge, ratio) => {
      const key2 = edge[0] < edge[1] ? `${edge[0]}.${edge[1]}` : `${edge[1]}.${edge[0]}`;
      const existing = centers.get(key2);
      if (existing != null) return existing;
      const a = verts[edge[0]], b = verts[edge[1]];
      const id = verts.length;
      verts.push([
        a[0] + (b[0] - a[0]) * ratio,
        a[1] + (b[1] - a[1]) * ratio,
        a[2] + (b[2] - a[2]) * ratio
      ]);
      centers.set(key2, id);
      return id;
    };
    const neighbor = (current, edge) => {
      for (let fi = 0; fi < faces.length; fi += 1) {
        if (fi === current || processed.has(fi) || faces[fi].loop.length < 3) continue;
        if (faces[fi].loop.includes(edge[0]) && faces[fi].loop.includes(edge[1])) return fi;
      }
      return void 0;
    };
    const ratioAt = (cutNo) => cutCount > 1 ? 1 - offsetRatio * 2 / (cutCount + 1 - cutNo) : offsetRatio;
    const lerpUV = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const splitFace = (faceIndex, sideInput, doubleSide, cutNo) => {
      const source = faces[faceIndex];
      if (!source || source.loop.length < 2) return false;
      processed.add(faceIndex);
      const side = [sideInput[0], sideInput[1]];
      const sideDiff = source.loop.indexOf(side[0]) - source.loop.indexOf(side[1]);
      if (sideDiff === -1 || sideDiff > 2) side.reverse();
      const ratio = Math.max(0, Math.min(1, ratioAt(cutNo)));
      if (source.loop.length === 4) {
        const opposite = source.loop.filter((vi) => !side.includes(vi));
        if (opposite.length !== 2) return false;
        const oppositeDiff = source.loop.indexOf(opposite[0]) - source.loop.indexOf(opposite[1]);
        if (oppositeDiff === 1 || oppositeDiff < -2) opposite.reverse();
        const centerSide = centerVertex(side, ratio);
        const centerOpposite = centerVertex(opposite, ratio);
        const sideUV = lerpUV(uvAt(source, side[0]), uvAt(source, side[1]), ratio);
        const oppositeUV = lerpUV(uvAt(source, opposite[0]), uvAt(source, opposite[1]), ratio);
        faces[faceIndex] = {
          ...source,
          // Blockbench's MeshFace stores the literal reference array as a vertex set
          // and getSortedVertices() restores polygon order. EditMesh loops are already
          // ordered, so write the sorted order directly and avoid a bow-tie quad.
          loop: [opposite[0], centerOpposite, centerSide, side[0]],
          uv: [uvAt(source, opposite[0]), oppositeUV, sideUV, uvAt(source, side[0])]
        };
        faces.push({
          ...source,
          loop: [side[1], centerSide, centerOpposite, opposite[1]],
          uv: [uvAt(source, side[1]), sideUV, oppositeUV, uvAt(source, opposite[1])]
        });
        if (cutNo + 1 < cutCount) splitFace(faceIndex, [centerSide, side[0]], doubleSide, cutNo + 1);
        if (cutNo !== 0) return true;
        const next = neighbor(faceIndex, opposite);
        if (next != null) splitFace(next, opposite, faces[next].loop.length === 4, 0);
        if (doubleSide) {
          const previous = neighbor(faceIndex, side);
          if (previous != null) {
            const previousOpposite = faces[previous].loop.filter((vi) => !side.includes(vi));
            if (previousOpposite.length === 2) {
              splitFace(previous, previousOpposite, faces[previous].loop.length === 4, 0);
            } else if (previousOpposite.length === 1) {
              splitFace(previous, side, false, 0);
            }
          }
        }
        return true;
      }
      if (source.loop.length === 3) {
        const opposed = source.loop.find((vi) => !side.includes(vi));
        if (opposed == null) return false;
        if (options.direction > 2) {
          const opposite = [side[options.direction % side.length], opposed];
          const oppositeDiff = source.loop.indexOf(opposite[0]) - source.loop.indexOf(opposite[1]);
          if (oppositeDiff === 1 || oppositeDiff < -2) opposite.reverse();
          const centerSide = centerVertex(side, ratio);
          const centerOpposite = centerVertex(opposite, ratio);
          const sideUV = lerpUV(uvAt(source, side[0]), uvAt(source, side[1]), ratio);
          const oppositeUV = lerpUV(uvAt(source, opposite[0]), uvAt(source, opposite[1]), ratio);
          const otherQuad = side.find((vi) => !opposite.includes(vi));
          const otherTri = side.find((vi) => opposite.includes(vi));
          const sourceNormal = faceNormal({ verts, faces: [] }, source);
          faces[faceIndex] = {
            ...source,
            loop: [opposed, centerOpposite, centerSide, otherQuad],
            uv: [uvAt(source, opposed), oppositeUV, sideUV, uvAt(source, otherQuad)]
          };
          const newFaceIndex = faces.length;
          faces.push({
            ...source,
            loop: [otherTri, centerSide, centerOpposite],
            uv: [uvAt(source, otherTri), sideUV, oppositeUV]
          });
          for (const fi of [faceIndex, newFaceIndex]) {
            if (dot(faceNormal({ verts, faces: [] }, faces[fi]), sourceNormal) < 0) {
              faces[fi].loop.reverse();
              faces[fi].uv?.reverse();
            }
          }
          if (cutNo + 1 < cutCount) splitFace(faceIndex, [centerSide, otherQuad], doubleSide, cutNo + 1);
          if (cutNo !== 0) return true;
          const next = neighbor(faceIndex, opposite);
          if (next != null) splitFace(next, opposite, faces[next].loop.length === 4, 0);
          if (doubleSide) {
            const previous = neighbor(faceIndex, side);
            if (previous != null) {
              const previousOpposite = faces[previous].loop.filter((vi) => !side.includes(vi));
              if (previousOpposite.length === 2) splitFace(previous, previousOpposite, faces[previous].loop.length === 4, 0);
            }
          }
          return true;
        }
        const center = centerVertex(side, ratio);
        const centerUV = lerpUV(uvAt(source, side[0]), uvAt(source, side[1]), ratio);
        faces[faceIndex] = {
          ...source,
          loop: [opposed, center, side[0]],
          uv: [uvAt(source, opposed), centerUV, uvAt(source, side[0])]
        };
        faces.push({
          ...source,
          loop: [side[1], center, opposed],
          uv: [uvAt(source, side[1]), centerUV, uvAt(source, opposed)]
        });
        if (options.direction % 3 === 2) {
          faces[faceIndex].loop.reverse();
          faces[faceIndex].uv?.reverse();
          faces[faces.length - 1].loop.reverse();
          faces[faces.length - 1].uv?.reverse();
        }
        return true;
      }
      return false;
    };
    if (!splitFace(options.face, startSide, start.loop.length === 4 || options.direction > 2, 0)) return m;
    return { ...m, verts, faces };
  }

  // cart/editor/model/editMesh.test.ts
  var passed = 0;
  var failed = 0;
  var log = globalThis.print ?? ((s) => globalThis.__writeStdout?.(`${s}
`));
  function test(name, fn) {
    try {
      fn();
      passed += 1;
      log(`  ok  ${name}`);
    } catch (error) {
      failed += 1;
      log(`FAIL  ${name}: ${error.message}`);
    }
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }
  function faceNormalMagnitude(mesh2, loop) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < loop.length; i += 1) {
      const a = mesh2.verts[loop[i]], b = mesh2.verts[loop[(i + 1) % loop.length]];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return Math.hypot(nx, ny, nz);
  }
  function renderedQuadDiagonal(mesh2, faceIndex) {
    const face = mesh2.faces[faceIndex];
    const geometry = editMeshToGeometry(mesh2, (candidate) => candidate === face);
    const counts = /* @__PURE__ */ new Map();
    for (let corner = 0; corner < 6; corner += 1) {
      const at = corner * 8;
      const position = [geometry.positions[at], geometry.positions[at + 1], geometry.positions[at + 2]];
      const key2 = position.map((value) => value.toFixed(6)).join(",");
      const entry = counts.get(key2);
      if (entry) entry.count += 1;
      else counts.set(key2, { position, count: 1 });
    }
    return [...counts.values()].filter((entry) => entry.count === 2).map((entry) => entry.position);
  }
  var positionSetKey = (positions) => positions.map((position) => position.map((value) => value.toFixed(6)).join(",")).sort().join("|");
  test("the plane primitive is one intact indexed quad before host append", () => {
    const source = plane(2, 3);
    assert(source.verts.length === 4, `plane should have four vertices, got ${source.verts.length}`);
    assert(
      source.faces.length === 1 && source.faces[0].loop.length === 4,
      `plane should be one quad, got ${source.faces.map((face) => face.loop.length).join(",")}`
    );
    assert(source.verts.every((vertex) => vertex[1] === 0), "plane vertices left the XZ plane");
    const lowered = editMeshToGeometry(source);
    assert(lowered.positions.length === 6 * 8, `one quad should lower to two render triangles, got ${lowered.positions.length / 8} vertices`);
    for (let vertex = 0; vertex < 6; vertex += 1) {
      assert(lowered.positions[vertex * 8 + 1] === 0, `lowered plane vertex ${vertex} has y=${lowered.positions[vertex * 8 + 1]}`);
    }
  });
  test("equal-length non-planar mirror quads carry the same physical diagonal", () => {
    const source = {
      verts: [[1, -1, -1], [2, -1, 1], [1, 1, 1], [2, 1, -1]],
      faces: [{ loop: [0, 1, 2, 3] }]
    };
    const sourceDiagonal = renderedQuadDiagonal(source, 0);
    assert(sourceDiagonal.length === 2, `source did not lower to one diagonal: ${sourceDiagonal.length}`);
    const mirrored = mirrorMesh(source, 0);
    const mirroredDiagonal = renderedQuadDiagonal(mirrored, 0);
    const reflectedSource = sourceDiagonal.map(([x, y, z]) => [-x, y, z]);
    assert(
      positionSetKey(mirroredDiagonal) === positionSetKey(reflectedSource),
      `mirror chose the other physical diagonal: ${positionSetKey(mirroredDiagonal)} != ${positionSetKey(reflectedSource)}`
    );
    const paired = symmetrize(source, 0, true);
    assert(paired.faces.length === 2, `symmetrize should emit a kept face and twin, got ${paired.faces.length}`);
    const keptDiagonal = renderedQuadDiagonal(paired, 0);
    const twinDiagonal = renderedQuadDiagonal(paired, 1);
    const reflectedKept = keptDiagonal.map(([x, y, z]) => [-x, y, z]);
    assert(
      positionSetKey(twinDiagonal) === positionSetKey(reflectedKept),
      `symmetrize twin chose the other physical diagonal: ${positionSetKey(twinDiagonal)} != ${positionSetKey(reflectedKept)}`
    );
  });
  function taperedRing() {
    const bottom = [[-4, 0, -4], [4, 0, -4], [4, 0, 4], [-4, 0, 4]];
    const top = [[-1, 2, -1], [1, 2, -1], [1, 2, 1], [-1, 2, 1]];
    return {
      verts: [...bottom, ...top],
      faces: [0, 1, 2, 3].map((i) => ({ loop: [i, (i + 1) % 4, 4 + (i + 1) % 4, 4 + i] }))
    };
  }
  test("loop cut follows the closed tapered quad ring by vertex identity", () => {
    const source = taperedRing();
    const cut = loopCutFromFace(source, { face: 0, direction: 1, cuts: 1, offset: Math.sqrt(22) / 2 });
    assert(cut.faces.length === 8, `four quads should become eight, got ${cut.faces.length}`);
    assert(cut.verts.length === 12, `the four shared ring edges should mint four vertices, got ${cut.verts.length}`);
    for (const v of cut.verts.slice(source.verts.length)) assert(v[1] === 1, `tapered cut drifted off the edge ratio: y=${v[1]}`);
    for (const face of cut.faces) assert(faceNormalMagnitude(cut, face.loop) > 1e-6, `cut emitted a crossed/degenerate face: ${face.loop.join(",")}`);
  });
  test("the cylinder primitive has reference fan caps that loop cut can enter", () => {
    const segments = 16;
    const source = cylinder(1, 2, segments);
    assert(source.verts.length === segments * 2 + 2, `cylinder is missing its cap centers: ${source.verts.length}`);
    assert(source.faces.length === segments * 3, `cylinder does not have side quads plus two cap fans: ${source.faces.length}`);
    assert(source.faces.slice(segments).every((face) => face.loop.length === 3), "a cylinder cap remained an n-gon");
    const cut = loopCutFromFace(source, { face: 0, direction: 1, cuts: 1, offset: Math.sin(Math.PI / segments) });
    assert(cut.faces.length === source.faces.length + 3, `side + two cap triangles should each split once, got ${cut.faces.length}`);
    assert(cut.verts.length === source.verts.length + 2, `shared top/bottom rim cuts should mint two vertices, got ${cut.verts.length}`);
    for (const face of cut.faces) assert(faceNormalMagnitude(cut, face.loop) > 1e-6, `cap traversal emitted a degenerate face: ${face.loop.join(",")}`);
  });
  test("a terminal triangle is split and traversal stops there", () => {
    const mesh2 = {
      verts: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0.5, 2, 0]],
      faces: [{ loop: [0, 1, 2, 3] }, { loop: [3, 2, 4] }]
    };
    const cut = loopCutFromFace(mesh2, { face: 0, direction: 0, cuts: 1, offset: 0.5 });
    assert(cut.faces.length === 4, `quad + terminal tri should become four faces, got ${cut.faces.length}`);
    assert(cut.verts.length === 7, `the shared terminal edge should reuse its cut vertex, got ${cut.verts.length - mesh2.verts.length}`);
  });
  test("a boundary is a successful partial ring, never a plane-style full slice", () => {
    const mesh2 = {
      verts: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0]],
      faces: [{ loop: [0, 1, 2, 3] }, { loop: [1, 4, 5, 2] }]
    };
    const cut = loopCutFromFace(mesh2, { face: 0, direction: 0, cuts: 1, offset: 0.5 });
    assert(cut.faces.length === 3, `the walk should stop at the first face boundary, got ${cut.faces.length} faces`);
    assert(cut.faces.some((face) => face.loop.includes(4) && face.loop.includes(5)), "the unrelated neighbor was unexpectedly sliced");
  });
  test("direction above two uses the reference triangle edge-to-edge split", () => {
    const mesh2 = { verts: [[0, 0, 0], [2, 0, 0], [0, 2, 0]], faces: [{ loop: [0, 1, 2] }] };
    const cut = loopCutFromFace(mesh2, { face: 0, direction: 3, cuts: 1, offset: 1 });
    assert(cut.faces.length === 2, `triangle should split into two faces, got ${cut.faces.length}`);
    assert(cut.faces.some((face) => face.loop.length === 4), "direction 3 must leave the reference quad remainder");
    assert(cut.faces.some((face) => face.loop.length === 3), "direction 3 must emit the reference terminal triangle");
  });
  test("multiple cuts use the reference recursive amended-offset spacing", () => {
    const mesh2 = {
      verts: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      faces: [{ loop: [0, 1, 2, 3] }]
    };
    const cut = loopCutFromFace(mesh2, { face: 0, direction: 0, cuts: 2, offset: 0.25 });
    const xs = cut.verts.slice(mesh2.verts.length).map((vertex) => vertex[0]);
    assert(xs.some((x) => Math.abs(x - 0.16666667) < 1e-6), `missing recursive near cut: ${xs.join(", ")}`);
    assert(xs.some((x) => Math.abs(x - 0.375) < 1e-6), `missing recursive far cut: ${xs.join(", ")}`);
  });
  test("a shared selected edge overrides the direction slider like the reference", () => {
    const mesh2 = {
      verts: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0]],
      faces: [{ loop: [0, 1, 2, 3] }, { loop: [1, 4, 5, 2] }]
    };
    const cut = loopCutFromFace(mesh2, { face: 0, direction: 0, cuts: 1, offset: 0.5, selectedFaces: [0, 1] });
    assert(cut.faces.length === 4, `both selected quads should split across their shared edge, got ${cut.faces.length}`);
  });
  log(`
${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} test(s) failed`);
})();
