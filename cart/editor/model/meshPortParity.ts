// meshPortParity.ts — reference half of tools/mesh-port-parity.
// Run through the wrapper; it supplies a resident-mesh RJMD fixture and compares
// the observable contract, never normals/UVs or triangle ordering.
import {
  detachPanel, editMeshToGeometry, extrudeEdge, extrudeFace, loopCutRange,
  mergeFaces, solidifyFaces, subMeshFromFaces, type EditMesh, type V3,
} from './editMesh';

type Doc = { vertices: Float32Array; groups: Uint32Array };
type Contract = { groups: number; identities: string[]; vertices: number; triangleEdges: number; editableEdges: number; geometry: string[] };
const EPS = 1e-4;

const argvRaw: unknown = typeof __argv === 'function' ? __argv() : __argv;
const argv: string[] = (Array.isArray(argvRaw) ? argvRaw as string[] : JSON.parse(String(argvRaw ?? '[]'))).slice(1);
const [seedPath, nativePath, nativeJournalPath, label] = argv;
const op = label?.split(':').at(-1);
if (!seedPath || !nativePath || !nativeJournalPath || !op) throw new Error('usage: meshPortParity <seed.rjmd> <native.rjmd> <native.json> <fixture:solidify|merge|loopcut>');

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
  const h = new Uint32Array(buf, 0, 7);
  if (h[0] !== 0x444d4a52 || h[1] !== 2 || !h[4]) throw new Error(`${path}: expected grouped RJMD v2`);
  const at = 28 + h[2] * 32;
  return { vertices: new Float32Array(buf, 28, h[2] * 8), groups: new Uint32Array(buf, at, h[3]) };
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
  const verts = new Map<string, number>(); const edges = new Map<string, Set<number>>();
  const id = (at: number) => { const p: V3 = [vertices[at]!, vertices[at + 1]!, vertices[at + 2]!]; const k = key(p); if (!verts.has(k)) verts.set(k, verts.size); return verts.get(k)!; };
  for (let t = 0; t < groups.length; t += 1) for (let c = 0; c < 3; c += 1) { const a = id((t * 3 + c) * 8), b = id((t * 3 + ((c + 1) % 3)) * 8); const k = a < b ? `${a}:${b}` : `${b}:${a}`; const s = edges.get(k) ?? new Set<number>(); s.add(groups[t]!); edges.set(k, s); }
  // An editable edge is a boundary of authored identities; triangulation diagonals
  // stay absent because both triangles have the same group.
  let editable = 0; for (const s of edges.values()) if (s.size !== 1) editable += 1;
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
  if (op === 'loopcut') { const f = seed.faces[0]!; const xs = f.loop.map((i) => seed.verts[i]![0]); const lo = Math.min(...xs), hi = Math.max(...xs); return loopCutRange(seed, 0, lo, hi, 2, (lo + hi) / 2); }
  // Type-level/live calls make any future mapping add a real expected form rather
  // than an eyeballed fixture. They are intentionally not native assertions yet.
  if (op === 'extrudeface') return extrudeFace(seed, 0, 0.25);
  if (op === 'extrudeedge') return extrudeEdge(seed, [seed.faces[0]!.loop[0]!, seed.faces[0]!.loop[1]!], 0.25);
  if (op === 'detach') return detachPanel(seed, [0], 0.125).panel;
  if (op === 'submesh') return subMeshFromFaces(seed, [0]);
  throw new Error(`unknown op ${op}`);
}
const expected = lowered(reference(fromDoc(doc(seedPath))));
const actual = contractFromSoup(doc(nativePath).vertices, doc(nativePath).groups);
// The journal owns the native vocabulary: triangleEdges is the welded render
// topology and editableEdges is the click/select boundary graph. Keep the
// independently-derived JS values only for the pure reference side.
const nativeJournal = JSON.parse(__fs_read(nativeJournalPath));
if (nativeJournal?.topology) {
  actual.vertices = nativeJournal.topology.weldedVertices;
  actual.triangleEdges = nativeJournal.topology.triangleEdges;
  actual.editableEdges = nativeJournal.topology.editableEdges;
}
const equal = JSON.stringify(expected) === JSON.stringify(actual);
const digest = (values: string[]) => {
  let h = 2166136261; for (const value of values) for (let i = 0; i < value.length; i += 1) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return `${values.length}@${(h >>> 0).toString(16)}`;
};
const numbers = (c: Contract) => `groups=${c.groups} verts=${c.vertices} triangleEdges=${c.triangleEdges} editableEdges=${c.editableEdges} identities=${digest(c.identities)} geometry=${digest(c.geometry)}`;
console.log(`[mesh-port-parity] ${label} ${equal ? 'PASS' : 'FAIL'} expected{${numbers(expected)}} actual{${numbers(actual)}}`);
if (!equal) throw new Error(`${op} contract diverged`);
