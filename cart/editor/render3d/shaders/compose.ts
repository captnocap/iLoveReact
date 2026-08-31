// compose.ts — PER-SET WGSL composition over the generated material catalog
// (req_3473; generalizes the req_3400 region pattern to every fill consumer).
//
// The generated dispatch (FILL_FUNCS) is one ~730 KB module: 410 material fns
// plus a 410-way fill_pick. Compiling it stalls the render thread ~90s per
// process (naga + the driver chew the whole catalog) — req_2693 accepted that
// as "once per app run", but the editor paid it at every BOOT, twice (the
// first fill Effect and the painted-ground formula), and the driver cache
// absorbing repeat boots is luck, not contract. A module composed from the
// materials a surface ACTUALLY renders is tens of KB and compiles sub-second,
// so recomposing when a set changes beats one eternal megashader.
//
// This file owns the split of FILL_FUNCS (helpers prelude + each material fn
// body, brace-matched) and the small fill_pick if-chain over a wanted set.
// regionFormula/groundFormula apply their own harness transforms on top; the
// Effect-side fillShaderFor() appends the standard FILL_MAIN fs_main so the
// D[] contract (single rows and packed thumbnail grids) stays byte-compatible.
import { FILL_FUNCS } from './_generated/dispatch';
import { FILL_MAIN_SRC, FILL_SHADER } from './index';
import { MATERIALS } from './_generated/registry';

/** The generated D storage declaration — harness compositions (ground, region)
 *  replace it because their pipelines declare D themselves. */
export const D_DECL = '@group(0) @binding(1) var<storage, read> D: array<f32>;';
// Every catalog material is generated with this exact signature (build-shaders
// validates fn name == @material and the fill contract fixes the params).
const MAT_FN_SIG = /fn ([A-Za-z0-9_]+)\(uv: vec2f, px: vec2f, variant: f32, seed: f32\) -> vec3f \{/g;

// The three atom-kind signatures (build-shaders.ts ATOM_KINDS, enforced at
// generation). Atoms are emitted AFTER the material bodies, so scanning from
// the first material fn onward can never capture a prelude helper.
const ATOM_FN_SIGS = [
  /fn ([A-Za-z0-9_]+)\(uv: vec2f, px: vec2f, seed: f32\) -> f32 \{/g, // field
  /fn ([A-Za-z0-9_]+)\(uv: vec2f, seed: f32, amount: f32\) -> vec2f \{/g, // warp
  /fn ([A-Za-z0-9_]+)\(col: vec3f, uv: vec2f, px: vec2f, seed: f32, amount: f32\) -> vec3f \{/g, // colormod
];
// Surface modules (Surface Packages v1) — emitted after the atoms, split by
// the same enforced-signature discipline. An appearance adapter's material
// body calls its module, so resolution treats surfaces exactly like atoms.
const SURFACE_FN_SIG = /fn (surface_[A-Za-z0-9_]+)\(sp: vec2f, seed: f32\) -> SurfaceSample \{/g;

/** Brace-matched fn body starting at `start` (the regex match index). */
function braceMatchedBody(source: string, start: number, headerLength: number): { text: string; end: number } {
  let depth = 0;
  let at = start + headerLength - 1; // the opening brace
  for (; at < source.length; at += 1) {
    const ch = source[at];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        at += 1;
        break;
      }
    }
  }
  return { text: source.slice(start, at), end: at };
}

/** FILL_FUNCS split once: the helpers prelude (helpers.wgsl + mat_pal reader +
 *  quality/road helpers — everything before the first material fn), each
 *  material fn's body, and each atom fn's body (field/warp/colormod — emitted
 *  after the materials), all brace-matched. fill_pick has a different
 *  signature, so it never lands in either map — composed modules emit their
 *  own small chain. The prelude is returned RAW (D declaration intact);
 *  callers whose harness declares D apply their own replace. Throws on
 *  generator drift so a build-shaders.ts output change fails LOUD. */
let cachedSplit: { prelude: string; bodies: Map<string, string>; atoms: Map<string, string>; surfaces: Map<string, string> } | null = null;
export function splitFillDispatch(): { prelude: string; bodies: Map<string, string>; atoms: Map<string, string>; surfaces: Map<string, string> } {
  if (cachedSplit) return cachedSplit;
  if (!FILL_FUNCS.includes(D_DECL)) {
    throw new Error('[compose] dispatch drift: D declaration not found — re-check build-shaders.ts output');
  }
  const bodies = new Map<string, string>();
  let firstAt = -1;
  MAT_FN_SIG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MAT_FN_SIG.exec(FILL_FUNCS))) {
    const start = match.index;
    if (firstAt < 0) firstAt = start;
    const body = braceMatchedBody(FILL_FUNCS, start, match[0].length);
    bodies.set(match[1]!, body.text);
    MAT_FN_SIG.lastIndex = body.end;
  }
  if (firstAt < 0 || bodies.size === 0) {
    throw new Error('[compose] dispatch drift: no material fn bodies found — re-check build-shaders.ts output');
  }
  const atoms = new Map<string, string>();
  for (const sig of ATOM_FN_SIGS) {
    sig.lastIndex = firstAt;
    while ((match = sig.exec(FILL_FUNCS))) {
      const body = braceMatchedBody(FILL_FUNCS, match.index, match[0].length);
      atoms.set(match[1]!, body.text);
      sig.lastIndex = body.end;
    }
  }
  const surfaces = new Map<string, string>();
  SURFACE_FN_SIG.lastIndex = firstAt;
  while ((match = SURFACE_FN_SIG.exec(FILL_FUNCS))) {
    const body = braceMatchedBody(FILL_FUNCS, match.index, match[0].length);
    surfaces.set(match[1]!, body.text);
    SURFACE_FN_SIG.lastIndex = body.end;
  }
  cachedSplit = { prelude: FILL_FUNCS.slice(0, firstAt), bodies, atoms, surfaces };
  return cachedSplit;
}

/** One fn's body out of any of the three split maps — the ONE lookup every
 *  composer must use when joining resolved fns into a module. Joining through
 *  `bodies` alone silently stringifies `undefined` into the WGSL for any
 *  resolved atom or surface fn (the exact drift this helper exists to kill). */
export function fnBody(fn: string): string | undefined {
  const { bodies, atoms, surfaces } = splitFillDispatch();
  return bodies.get(fn) ?? atoms.get(fn) ?? surfaces.get(fn);
}

const MATERIAL_BY_FN = new Map(MATERIALS.map((m) => [m.fn, m]));
const MATERIAL_BY_ROW = new Map(MATERIALS.map((m) => [`${m.materialId}:${m.boardIndex}`, m]));

/** The fn name behind a (materialId, boardIndex) data row — how packed grid
 *  rows name materials. null for an unknown pair (caller decides fallback). */
export function fnForMaterialRow(materialId: number, boardIndex: number): string | null {
  return MATERIAL_BY_ROW.get(`${Math.round(materialId)}:${Math.round(boardIndex)}`)?.fn ?? null;
}

/** Wanted fns plus every material AND atom fn their bodies call (compositions
 *  layering surfaces; recipes calling field/warp/colormod atoms), deduped +
 *  sorted so equal sets compose byte-identical modules. Returns null (loudly,
 *  once per unknown name — a drifted caller can request the same bad fn
 *  hundreds of times per boot) when a fn is missing from the generated
 *  dispatch, so callers never compose a module the shader would miscompile. */
const reportedUnknownFns = new Set<string>();
export function resolveMaterialFns(fns: readonly string[]): string[] | null {
  const { bodies, atoms, surfaces } = splitFillDispatch();
  const wanted = [...new Set(fns)].sort();
  const need: string[] = [];
  const queue = [...wanted];
  while (queue.length > 0) {
    const fn = queue.shift()!;
    if (need.includes(fn)) continue;
    const body = fnBody(fn);
    if (!body) {
      if (!reportedUnknownFns.has(fn)) {
        reportedUnknownFns.add(fn);
        console.error(`[compose] material fn '${fn}' not found in the generated dispatch — module not composed`);
      }
      return null;
    }
    need.push(fn);
    for (const other of [...bodies.keys(), ...atoms.keys(), ...surfaces.keys()]) {
      if (other !== fn && !need.includes(other) && !queue.includes(other) && new RegExp(`\\b${other}\\s*\\(`).test(body)) {
        queue.push(other);
      }
    }
  }
  return need;
}

/** fill_pick over ONLY the given fns — same signature and fallback (black) as
 *  the generated 410-way chain, so composed modules stay drop-in for every
 *  caller of fill_pick(material, board, …). */
export function fillPickFor(fns: readonly string[]): string {
  const arms = fns
    .map((fn) => MATERIAL_BY_FN.get(fn))
    .filter((m): m is NonNullable<typeof m> => m != null)
    .map((m) => `  if (material == ${m.materialId} && i32(board + 0.5) == ${m.boardIndex}) { col = ${m.fn}(uv, px, variant, seed); }`)
    .join('\n');
  return `
fn fill_pick(material: i32, board: f32, uv: vec2f, px: vec2f, variant: f32, seed: f32) -> vec3f {
  var col = vec3f(0.0, 0.0, 0.0);
${arms}
  return col;
}`;
}

const composedFillShaders = new Map<string, string>();

/** The standard tile-local fill shader (fs_main + packed-grid envelope, the
 *  exact FILL_SHADER D[] contract) restricted to a material set. Memoized per
 *  set. An unknown fn falls back to the full-catalog module — a picker or
 *  registry drift renders correctly while the console error names it. */
export function fillShaderFor(fns: readonly (string | null | undefined)[]): string {
  const wanted = [...new Set(fns.filter((fn): fn is string => typeof fn === 'string' && fn.length > 0))].sort();
  const key = wanted.join(',');
  const hit = composedFillShaders.get(key);
  if (hit) return hit;
  const resolved = resolveMaterialFns(wanted);
  // The fallback memoizes too — a drifted set must not re-resolve (and re-log)
  // on every mount of every consumer.
  const src = resolved
    ? [splitFillDispatch().prelude, ...resolved.map((fn) => fnBody(fn)!), fillPickFor(resolved), FILL_MAIN_SRC].join('\n')
    : FILL_SHADER;
  composedFillShaders.set(key, src);
  return src;
}
