// assist3d/scene.ts — the scene model the assistant authors and the hot surface
// reads. One JSON file on disk is the single source of truth (hmsc-int's
// "disk = truth" pattern); the route writes it through claude, every reader
// (the route's surface, the Objects explorer) watches it.
//
// A MeshSpec is a raw @reactjit/geometries primitive — NOT an hmsc building/prop
// kind. That keeps the assistant's vocabulary tiny (6 shapes) and decoupled from
// the game's kind registries; bridging generated meshes INTO real placements is a
// separate, deliberate step, not an accident of sharing a type.

import * as Geometry from '@reactjit/geometries';
import type { Vec3 } from '@reactjit/cameras';
import { callHost, hasHost } from '@reactjit/ffi';

export type { Vec3 };

export interface MeshSpec {
  id: string;
  geometry: string;                 // 'Box' | 'Sphere' | 'Cylinder' | 'Cone' | 'Torus' | 'Plane'
  params: Record<string, number>;
  material: string;                 // hex
  position: Vec3;
  rotation?: Vec3;                  // degrees
  scale?: number;
}

export interface SceneSpec {
  background: string;
  meshes: MeshSpec[];
}

export const EMPTY_SCENE: SceneSpec = { background: '#0a111d', meshes: [] };

// In-process bus event fired when the cart writes scene.json itself — lets every
// useAssistScene reload instantly instead of waiting on the per-frame file watcher.
export const SCENE_WRITTEN_EVENT = 'assist3d:scene-written';

// The set of geometry names the assistant is allowed to emit (and the explorer
// can render). Anything else is dropped on parse.
export const ALLOWED_GEOMETRY = ['Box', 'Sphere', 'Cylinder', 'Cone', 'Torus', 'Plane'] as const;

export function processCwd(): string {
  if (hasHost('__cwd')) {
    try {
      const v = callHost<string>('__cwd', '');
      if (typeof v === 'string' && v.length > 0) return v;
    } catch { /* ignore */ }
  }
  return '/home/siah/creative/reactjit';
}

// Absolute path both the claude subprocess (cwd-relative write) and the in-cart
// watcher agree on.
export function sceneFilePath(cwd: string = processCwd()): string {
  return `${cwd}/cart/hmsc-int/assist3d/scene.json`;
}

export function parseScene(text: string): SceneSpec | null {
  try {
    const j = JSON.parse(text);
    if (!j || !Array.isArray(j.meshes)) return null;
    const meshes: MeshSpec[] = j.meshes
      .filter((m: any) => m && typeof m.geometry === 'string' && Geometry.GEOMETRIES[m.geometry])
      .map((m: any, i: number) => ({
        id: typeof m.id === 'string' && m.id ? m.id : `mesh-${i}`,
        geometry: m.geometry,
        params: (m.params && typeof m.params === 'object') ? m.params : {},
        material: typeof m.material === 'string' ? m.material : '#cccccc',
        position: Array.isArray(m.position) ? [Number(m.position[0]) || 0, Number(m.position[1]) || 0, Number(m.position[2]) || 0] : [0, 0, 0],
        rotation: Array.isArray(m.rotation) ? [Number(m.rotation[0]) || 0, Number(m.rotation[1]) || 0, Number(m.rotation[2]) || 0] : [0, 0, 0],
        scale: Number.isFinite(m.scale) ? Number(m.scale) : 1,
      }));
    return { background: typeof j.background === 'string' ? j.background : '#0a111d', meshes };
  } catch {
    return null;
  }
}

// A tight enclosing-sphere radius per geometry — mirrors the generators closely
// enough for click-rate picking and camera framing.
export function boundingRadius(geometry: string, p: Record<string, number>): number {
  switch (geometry) {
    case 'Sphere': return p.radius ?? 0.5;
    case 'Box': return 0.5 * Math.hypot(p.width ?? 1, p.height ?? 1, p.depth ?? 1);
    case 'Cylinder':
    case 'Cone': return Math.hypot(p.radius ?? 0.5, (p.height ?? 1) / 2);
    case 'Torus': return (p.radius ?? 0.5) + (p.tube ?? 0.2);
    case 'Plane': return 0.5 * Math.hypot(p.width ?? 1, p.height ?? 1);
    default: return 0.6;
  }
}

// The scene schema + authoring rules, shared by every backend's instruction
// preamble (claude writes a file; HTTP/local backends call a tool — same schema).
export const SCENE_SCHEMA_TEXT = [
  'Schema:',
  '{',
  '  "background": "#rrggbb",',
  '  "meshes": [',
  '    { "id": "short-lowercase-name", "geometry": "Box|Sphere|Cylinder|Cone|Torus|Plane",',
  '      "params": { ... }, "material": "#rrggbb",',
  '      "position": [x, y, z], "rotation": [degX, degY, degZ] }',
  '  ]',
  '}',
  '',
  'Params by geometry:',
  '  Box: {width,height,depth}   Sphere: {radius}   Cylinder/Cone: {radius,height}',
  '  Torus: {radius,tube}        Plane: {width,height}',
].join('\n');

export const SCENE_RULES = [
  'Rules: +Y is up, 1 unit = 1 meter. The meshes ARE the model — author ONLY the',
  'object(s) the user asked for. Do NOT add a ground, floor, base slab, grass plane,',
  'or backdrop: the viewer already draws its own reference floor, and anything you add',
  'would ship with the model on export. The model rests on or above y=0 (its lowest',
  'point near y=0 so it sits ON the viewer floor). Use 4-25 meshes so the result is',
  'recognizable. Give every mesh a unique descriptive id and a tasteful hex color.',
].join('\n');

// The instruction contract for the claude_code backend (it writes the file with
// its own Write tool — no system-prompt opt, so it rides the first turn). The
// session persists, so later turns carry only the request + a path reminder.
export function buildPreamble(scenePath: string): string {
  return [
    'You drive a live, hot-reloaded 3D viewer by writing ONE file.',
    `Whenever I ask for a scene or an edit, OVERWRITE this exact file with the full scene as JSON (use your Write tool, replace the entire file): ${scenePath}`,
    '',
    SCENE_SCHEMA_TEXT,
    '',
    SCENE_RULES,
    '',
    'Do NOT print the JSON in chat — just write the file and end with a one-line summary.',
  ].join('\n');
}

export function round(n: number): number { return Math.round(n * 1000) / 1000; }
