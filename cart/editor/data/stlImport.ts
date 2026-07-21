// editor/data/stlImport.ts — STL enters the editor as a locally converted GLB.
// The native viewer deliberately owns only GLB/OBJ parsing; keeping conversion
// here makes STL a first-class import option without widening that hot path.
import { exists } from '../../../runtime/hooks/fs';
import { execAsync } from '../../../runtime/hooks/process';

const BLENDER_COMMAND = 'blender';
const CONVERSION_DIRECTORY = '/tmp';

export function isStlFile(path: string): boolean {
  return path.toLowerCase().endsWith('.stl');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function outputPathFor(sourcePath: string): string {
  const leaf = sourcePath.split('/').pop()?.replace(/\.stl$/i, '') || 'model';
  const safeLeaf = leaf.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'model';
  return `${CONVERSION_DIRECTORY}/reactjit-stl-${Date.now()}-${safeLeaf}.glb`;
}

/** The Blender invocation is pure local conversion: no upload, no external service. */
export function stlToGlbCommand(sourcePath: string, outputPath: string): string {
  const script = [
    'import bpy',
    'bpy.ops.wm.read_factory_settings(use_empty=True)',
    `bpy.ops.wm.stl_import(filepath=${JSON.stringify(sourcePath)})`,
    "bpy.ops.object.select_all(action='SELECT')",
    `bpy.ops.export_scene.gltf(filepath=${JSON.stringify(outputPath)}, export_format='GLB', export_apply=True)`,
  ].join('; ');
  return `${BLENDER_COMMAND} --background --factory-startup --python-expr ${shellQuote(script)} 2>&1`;
}

export type StlConversion =
  | { ok: true; outputPath: string }
  | { ok: false; error: string };

export async function convertStlToGlb(sourcePath: string): Promise<StlConversion> {
  if (!isStlFile(sourcePath)) return { ok: false, error: 'not an STL file' };
  const outputPath = outputPathFor(sourcePath);
  const result = await execAsync(stlToGlbCommand(sourcePath, outputPath));
  if (result.code === 0 && exists(outputPath)) return { ok: true, outputPath };
  const detail = result.stdout.trim().split('\n').filter(Boolean).slice(-1)[0];
  return { ok: false, error: detail || 'Blender could not convert this STL' };
}
