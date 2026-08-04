// meshPortParity.ts — reference half of tools/mesh-port-parity.
// Run through the wrapper; it supplies a resident-mesh RJMD fixture and compares
// the observable contract, never normals/UVs or triangle ordering.
import {
  detachPanel, editMeshToGeometry, extrudeEdge, extrudeFace,
  mergeFaces, solidifyFaces, subMeshFromFaces, type EditMesh, type V3,
} from './editMesh';

type Doc = { vertices: Float32Array; groups: Uint32Array };
type Contract = { groups: number; identities: string[]; vertices: number; triangleEdges: number; editableEdges: number; geometry: string[] };
const EPS = 1e-4;

const argvRaw: unknown = typeof __argv === 'function' ? __argv() : __argv;
const argv: string[] = (Array.isArray(argvRaw) ? argvRaw as string[] : JSON.parse(String(argvRaw ?? '[]'))).slice(1);
const [seedPath, nativePath, nativeJournalPath, label] = argv;
const op = label?.split(':').at(-1);
if (!seedPath || !nativePath || !nativeJournalPath || !op) throw new Error('usage: meshPortParity <seed.rjmd> <native.rjmd> <native.json> <fixture:solidify|merge|loopcut|cut>');

function b64bytes(value: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const clean = value.replace(/\s+/g, ''); const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = chars.indexOf(clean[i] ?? 'A'), b = chars.indexOf(clean[i + 1] ?? 'A'); const c = clean[i + 2] === '=' ? -1 : chars.indexOf(clean[i + 2] ?? 'A'), d = clean[i + 3] === '=' ? -1 : chars.indexOf(clean[i + 3] ?? 'A');
    if (a < 0 || b < 0 || (c < 0 && clean[i + 2] !== '=') || (d < 0 && clean[i + 3] !== '=')) throw new Error('invalid base64');
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d); out.push((n >>> 16) & 255); if (c >= 0) out.push((n >>> 8) & 255); if (d >= 0) out.push(n & 255);
  }
  return new Uint8Array(out);
}
function doc(path: string): Doc {
  // v8cli's filesystem bridge intentionally exposes text only; the shell wrapper
  // produces this adjacent base64 text artifact from the host-written RJMD.
  const b64 = __fs_read(path); if (!b64) throw new Error(`missing ${path}`);
  const bytes = b64bytes(b64); const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  // RJMD v4 (v8_bindings_core.zig hostModelMeshdocWrite is the format owner):
  // header u32×10 [magic, version, vertCount, faceCount, hasGroups, rangeCount,
  // glassFirstVertex, hasMaterials, hasSemantics, semanticJsonBytes]; the parity
  // contract needs only verts + authored groups, so the later sections stay unread.
  const h = new Uint32Array(buf, 0, 10);
  if (h[0] !== 0x444d4a52 || h[1] !== 4 || !h[4]) throw new Error(`${path}: expected grouped RJMD v4`);
  const at = 40 + h[2] * 32;
  return { vertices: new Float32Array(buf, 40, h[2] * 8), groups: new Uint32Array(buf, at, h[3]) };
}
function key(p: V3): string { return `${Math.round(p[0] / EPS)},${Math.round(p[1] / EPS)},${Math.round(p[2] / EPS)}`; }
function fromDoc(d: Doc): EditMesh {
  const verts: V3[] = []; const index = new Map<string, number>();
  const vi = (p: V3) => { const k = key(p); const old = index.get(k); if (old != null) return old; const n = verts.length; verts.push(p); index.set(k, n); return n; };
  const grouped = new Map<number, number[]>();
  for (let t = 0; t < d.groups.length; t += 1) { const a = grouped.get(d.groups[t]!) ?? []; a.push(t); grouped.set(d.groups[t]!, a); }
  const faces: EditMesh['faces'] = [];
  for (const triangles of grouped.values()) {
    const boundary = new Map<string, [number, number]>();
    for (const t of triangles) for (let c = 0; c < 3; c += 1) {
      const base = (t * 3 + c) * 8; const a = vi([d.vertices[base]!, d.vertices[base + 1]!, d.vertices[base + 2]!]);
      const nb = (t * 3 + ((c + 1) % 3)) * 8; const b = vi([d.vertices[nb]!, d.vertices[nb + 1]!, d.vertices[nb + 2]!]);
      const undirected = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (boundary.has(undirected)) boundary.delete(undirected); else boundary.set(undirected, [a, b]);
    }
    const next = new Map<number, number>(); for (const [a, b] of boundary.values()) next.set(a, b);
    const start = next.keys().next().value as number | undefined; if (start == null) continue;
    const loop = [start]; for (let p = start, guard = 0; guard < boundary.size; guard += 1) { const n = next.get(p); if (n == null || n === start) break; loop.push(n); p = n; }
    if (loop.length >= 3) faces.push({ loop });
  }
  return { verts, faces };
}
function edgeContract(vertices: Float32Array, groups: Uint32Array): Pick<Contract, 'vertices' | 'triangleEdges' | 'editableEdges'> {
  const verts = new Map<string, number>(); const edges = new Map<string, { groups: Set<number>; uses: number }>();
  const id = (at: number) => { const p: V3 = [vertices[at]!, vertices[at + 1]!, vertices[at + 2]!]; const k = key(p); if (!verts.has(k)) verts.set(k, verts.size); return verts.get(k)!; };
  for (let t = 0; t < groups.length; t += 1) for (let c = 0; c < 3; c += 1) { const a = id((t * 3 + c) * 8), b = id((t * 3 + ((c + 1) % 3)) * 8); const k = a < b ? `${a}:${b}` : `${b}:${a}`; const edge = edges.get(k) ?? { groups: new Set<number>(), uses: 0 }; edge.groups.add(groups[t]!); edge.uses += 1; edges.set(k, edge); }
  // An editable edge is a boundary of authored identities; triangulation diagonals
  // stay absent because both triangles have the same group.
  let editable = 0; for (const edge of edges.values()) if (edge.groups.size > 1 || edge.uses === 1 || edge.uses > 2) editable += 1;
  return { vertices: verts.size, triangleEdges: edges.size, editableEdges: editable };
}
function contractFromSoup(vertices: Float32Array, groups: Uint32Array): Contract {
  const identities = new Map<number, string[]>(); const geometry: string[] = [];
  for (let t = 0; t < groups.length; t += 1) { const tri = [0, 1, 2].map((c) => key([vertices[(t * 3 + c) * 8]!, vertices[(t * 3 + c) * 8 + 1]!, vertices[(t * 3 + c) * 8 + 2]!])).sort().join('|'); geometry.push(tri); const a = identities.get(groups[t]!) ?? []; a.push(tri); identities.set(groups[t]!, a); }
  return { groups: identities.size, identities: [...identities.values()].map((x) => x.sort().join(',')).sort(), geometry: geometry.sort(), ...edgeContract(vertices, groups) };
}
function lowered(m: EditMesh): Contract { const g: number[] = []; const geo = editMeshToGeometry(m, undefined, g); return contractFromSoup(geo.positions, new Uint32Array(g)); }
function reference(seed: EditMesh): EditMesh {
  // Keep every pure source operation instantiated here. The native comparison cases
  // below select their direct resident equivalents; these probes keep the unsupported
  // result shapes (edge extrusion, panel detach/submesh) in the same conformance entry.
  if (op === 'solidify') return solidifyFaces(seed, [0], 0.125);
  if (op === 'merge') return mergeFaces(seed, [0, 1]) ?? seed;
  // Type-level/live calls make any future mapping add a real expected form rather
  // than an eyeballed fixture. They are intentionally not native assertions yet.
  if (op === 'extrudeface') return extrudeFace(seed, 0, 0.25);
  if (op === 'extrudeedge') return extrudeEdge(seed, [seed.faces[0]!.loop[0]!, seed.faces[0]!.loop[1]!], 0.25);
  if (op === 'detach') return detachPanel(seed, [0], 0.125).panel;
  if (op === 'submesh') return subMeshFromFaces(seed, [0]);
  throw new Error(`unknown op ${op}`);
}
const seedDoc = doc(seedPath);
const nativeDoc = doc(nativePath);
const actual = contractFromSoup(nativeDoc.vertices, nativeDoc.groups);
// The journal owns the native vocabulary: triangleEdges is the welded render
// topology and editableEdges is the click/select boundary graph. Keep the
// independently-derived JS values only for the pure reference side.
const nativeJournal = JSON.parse(__fs_read(nativeJournalPath));
if (nativeJournal?.topology) {
  actual.vertices = nativeJournal.topology.weldedVertices;
  actual.triangleEdges = nativeJournal.topology.triangleEdges;
  actual.editableEdges = nativeJournal.topology.editableEdges;
}
const digest = (values: string[]) => {
  let h = 2166136261; for (const value of values) for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return `${values.length}@${(h >>> 0).toString(16)}`;
};
const numbers = (c: Contract) => `groups=${c.groups} verts=${c.vertices} triangleEdges=${c.triangleEdges} editableEdges=${c.editableEdges} identities=${digest(c.identities)} geometry=${digest(c.geometry)}`;
const positions = (d: Doc): Map<string, V3> => {
  const out = new Map<string, V3>();
  for (let v = 0; v < d.vertices.length / 8; v += 1) { const p: V3 = [d.vertices[v * 8]!, d.vertices[v * 8 + 1]!, d.vertices[v * 8 + 2]!]; out.set(key(p), p); }
  return out;
};
const triangleKey = (d: Doc, t: number): string => [0, 1, 2].map((c) => key([d.vertices[(t * 3 + c) * 8]!, d.vertices[(t * 3 + c) * 8 + 1]!, d.vertices[(t * 3 + c) * 8 + 2]!])).sort().join('|');
const triangleCounts = (d: Doc): Map<string, number> => {
  const out = new Map<string, number>();
  for (let t = 0; t < d.groups.length; t += 1) { const k = triangleKey(d, t); out.set(k, (out.get(k) ?? 0) + 1); }
  return out;
};
const groupTriangleCounts = (groups: Uint32Array): number[] => {
  const counts = new Map<number, number>(); for (const gid of groups) counts.set(gid, (counts.get(gid) ?? 0) + 1); return [...counts.values()].sort((a, b) => a - b);
};
const loweredDoc = (m: EditMesh): Doc => { const groups: number[] = []; const geo = editMeshToGeometry(m, undefined, groups); return { vertices: geo.positions, groups: new Uint32Array(groups) }; };
/** No output edge may run straight THROUGH another output vertex (req_3125) — a
 *  surviving T-junction means some face kept one unsplit edge over a cut point
 *  (the slab rim's "one big edge" against the cut face's two segments). */
const tJunctionFree = (d: Doc): boolean => {
  const verts = [...positions(d).values()];
  for (let t = 0; t < d.groups.length; t += 1) for (let c = 0; c < 3; c += 1) {
    const a: V3 = [d.vertices[(t * 3 + c) * 8]!, d.vertices[(t * 3 + c) * 8 + 1]!, d.vertices[(t * 3 + c) * 8 + 2]!];
    const n = (c + 1) % 3;
    const b: V3 = [d.vertices[(t * 3 + n) * 8]!, d.vertices[(t * 3 + n) * 8 + 1]!, d.vertices[(t * 3 + n) * 8 + 2]!];
    const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    if (len2 < 1e-12) continue;
    for (const p of verts) {
      const s = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2;
      if (!(s > 1e-3 && s < 1 - 1e-3)) continue;
      const q: V3 = [a[0] + ab[0] * s, a[1] + ab[1] * s, a[2] + ab[2] * s];
      if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-4) return false;
    }
  }
  return true;
};

let expectedText = '';
let details = '';
let equal = false;
if (op === 'merge') {
  const expected = lowered(reference(fromDoc(seedDoc)));
  equal = JSON.stringify(expected) === JSON.stringify(actual);
  expectedText = numbers(expected);
} else if (op === 'solidify') {
  const expectedDoc = loweredDoc(reference(fromDoc(seedDoc)));
  const expected = contractFromSoup(expectedDoc.vertices, expectedDoc.groups);
  const seedPositions = positions(seedDoc); const nativePositions = positions(nativeDoc);
  const seedsSurvive = [...seedPositions.keys()].every((k) => nativePositions.has(k));
  const faceGroup = seedDoc.groups[0]!; const planes: { p: V3; n: V3 }[] = [];
  for (let t = 0; t < seedDoc.groups.length; t += 1) {
    if (seedDoc.groups[t] !== faceGroup) continue;
    const p: V3[] = [0, 1, 2].map((c) => [seedDoc.vertices[(t * 3 + c) * 8]!, seedDoc.vertices[(t * 3 + c) * 8 + 1]!, seedDoc.vertices[(t * 3 + c) * 8 + 2]!] as V3);
    const ab: V3 = [p[1]![0] - p[0]![0], p[1]![1] - p[0]![1], p[1]![2] - p[0]![2]]; const ac: V3 = [p[2]![0] - p[0]![0], p[2]![1] - p[0]![1], p[2]![2] - p[0]![2]];
    const cross: V3 = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]; const len = Math.hypot(...cross);
    if (len > 0) planes.push({ p: p[0]!, n: [cross[0] / len, cross[1] / len, cross[2] / len] });
  }
  let newCount = 0; let thicknessOk = true;
  for (const [k, p] of nativePositions) {
    if (seedPositions.has(k)) continue; newCount += 1;
    const near = planes.some((plane) => { const d = Math.abs((p[0] - plane.p[0]) * plane.n[0] + (p[1] - plane.p[1]) * plane.n[1] + (p[2] - plane.p[2]) * plane.n[2]); return d >= 0.0875 && d <= 0.1625; });
    if (!near) thicknessOk = false;
  }
  const scalarOk = expected.groups === actual.groups && expected.vertices === actual.vertices && expected.triangleEdges === actual.triangleEdges && expected.editableEdges === actual.editableEdges;
  const groupCountsOk = JSON.stringify(groupTriangleCounts(expectedDoc.groups)) === JSON.stringify(groupTriangleCounts(nativeDoc.groups));
  equal = scalarOk && seedsSurvive && thicknessOk && groupCountsOk;
  expectedText = numbers(expected); details = ` seedVertices=${seedPositions.size} newVertices=${newCount} seedsSurvive=${seedsSurvive ? 1 : 0} thickness=${thicknessOk ? 1 : 0} groupTriangles=${groupCountsOk ? 1 : 0}`;
} else if (op === 'loopcut' || op === 'cut') {
  const seedPositions = positions(seedDoc); const nativePositions = positions(nativeDoc);
  const weldedEdges = new Map<string, [V3, V3]>();
  for (let t = 0; t < seedDoc.groups.length; t += 1) for (let c = 0; c < 3; c += 1) {
    const a: V3 = [seedDoc.vertices[(t * 3 + c) * 8]!, seedDoc.vertices[(t * 3 + c) * 8 + 1]!, seedDoc.vertices[(t * 3 + c) * 8 + 2]!]; const n = (c + 1) % 3;
    const b: V3 = [seedDoc.vertices[(t * 3 + n) * 8]!, seedDoc.vertices[(t * 3 + n) * 8 + 1]!, seedDoc.vertices[(t * 3 + n) * 8 + 2]!]; const ka = key(a), kb = key(b); weldedEdges.set(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`, [a, b]);
  }
  let newCount = 0; let fractionsOk = true;
  for (const [k, p] of nativePositions) {
    if (seedPositions.has(k)) continue; newCount += 1;
    const onCut = [...weldedEdges.values()].some(([a, b]) => { const ab: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const len2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2; if (len2 === 0) return false; const t = ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / len2; const q: V3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= 1e-3 && (Math.abs(t - 1 / 3) <= 1e-3 || Math.abs(t - 2 / 3) <= 1e-3); });
    if (!onCut) fractionsOk = false;
  }
  const outputTriangles = triangleCounts(nativeDoc); const seedGroups = new Map<number, number[]>();
  for (let t = 0; t < seedDoc.groups.length; t += 1) { const tris = seedGroups.get(seedDoc.groups[t]!) ?? []; tris.push(t); seedGroups.set(seedDoc.groups[t]!, tris); }
  let subdivided = 0; let untouchedOk = true;
  for (const tris of seedGroups.values()) {
    const need = new Map<string, number>(); for (const t of tris) { const k = triangleKey(seedDoc, t); need.set(k, (need.get(k) ?? 0) + 1); }
    const survives = [...need].every(([k, n]) => (outputTriangles.get(k) ?? 0) >= n); if (!survives) subdivided += 1; else untouchedOk = untouchedOk && survives;
  }
  const derivedEditable = edgeContract(nativeDoc.vertices, nativeDoc.groups).editableEdges; const journalEditable = nativeJournal?.topology?.editableEdges;
  const editableOk = journalEditable === derivedEditable; const fixture = label!.split(':')[0]!; const seedGroupCount = new Set(seedDoc.groups).size;
  // pyramid: the loop cut seeds a SIDE TRIANGLE, so the plane-comb fallback runs
  // (non-quad path). Two level +Y planes cross all four triangle sides (3 pieces
  // each) and never touch the base: S=4, groups=13, and every new vert sits at a
  // span-third fraction of a slant edge — the anti-lopsided contract (req_3115).
  // cut: the basic cut subdivides ONLY face 0 (+2 groups), but its cut points land
  // on edges shared with UNCUT neighbors — the de-T-junction pass (req_3125)
  // re-fans those neighbors in place (same groups, more triangles), so they lose
  // byte-identity: S = 1 cut face + 2 re-fanned neighbors (3 when a crossed edge
  // carries the bridge flap too).
  const shapeOk = op === 'cut'
    ? subdivided >= 3 && subdivided <= 4 && actual.groups === seedGroupCount + 2
    : fixture === 'bridge' ? subdivided >= 3 && subdivided <= 5 && actual.groups === 7 + 2 * subdivided
    : fixture === 'pyramid' ? subdivided === 4 && actual.groups === 13
    : subdivided === 4 && actual.groups === 14;
  const noTJunctions = tJunctionFree(nativeDoc);
  equal = fractionsOk && untouchedOk && editableOk && shapeOk && noTJunctions;
  expectedText = `groups=${op === 'cut' ? seedGroupCount + 2 : fixture === 'bridge' ? `7+2*S` : fixture === 'pyramid' ? 13 : 14} S=${op === 'cut' ? '3..4' : fixture === 'bridge' ? '3..5' : 4} tjunctions=0`;
  details = ` S=${subdivided} newVertices=${newCount} fractions=${fractionsOk ? 1 : 0} untouched=${untouchedOk ? 1 : 0} editable=${journalEditable}/${derivedEditable} tjunctionFree=${noTJunctions ? 1 : 0}`;
} else if (op === 'loopcutmix') {
  // req_3119 (pyramid only): one horizontal band cut, then a vertical cut seeded on
  // a band QUAD. The vertical belt ring CLOSES around the four frustum bands while
  // the apex triangles and base sit in the planes' path, so the coverage gate must
  // hand the cut to the plane comb for the full slice. After the horizontal cut the
  // model is 9 groups; the vertical plane at x=0.1 crosses front/back bands,
  // front/back/right apex triangles, and the base: 9 + 6 splits = 15 groups. Of
  // each split apex triangle only ONE piece keeps the apex vertex, so exactly 4
  // output groups touch the apex: the three apex-side pieces + the whole left apex.
  const apex = key([0, 1, 0] as V3);
  const touching = new Set<number>();
  for (let t = 0; t < nativeDoc.groups.length; t += 1) {
    if ([0, 1, 2].some((c) => key([nativeDoc.vertices[(t * 3 + c) * 8]!, nativeDoc.vertices[(t * 3 + c) * 8 + 1]!, nativeDoc.vertices[(t * 3 + c) * 8 + 2]!]) === apex)) touching.add(nativeDoc.groups[t]!);
  }
  const derivedEditable = edgeContract(nativeDoc.vertices, nativeDoc.groups).editableEdges;
  const journalEditable = nativeJournal?.topology?.editableEdges;
  const noTJunctions = tJunctionFree(nativeDoc);
  equal = actual.groups === 15 && touching.size === 4 && journalEditable === derivedEditable && noTJunctions;
  expectedText = 'groups=15 apexGroups=4 tjunctions=0';
  details = ` apexGroups=${touching.size} editable=${journalEditable}/${derivedEditable} tjunctionFree=${noTJunctions ? 1 : 0}`;
} else {
  throw new Error(`unknown op ${op}`);
}
console.log(`[mesh-port-parity] ${label} ${equal ? 'PASS' : 'FAIL'} expected{${expectedText}} actual{${numbers(actual)}}${details}`);
if (!equal) throw new Error(`${op} contract diverged`);
