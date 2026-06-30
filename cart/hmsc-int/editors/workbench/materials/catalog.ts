// editors/workbench/materials/catalog.ts -- live material catalog rows for
// consumers that assign texture ids. The Materials workspace has extra authoring
// rows (new decal, decal edit rows); this list is the assignable subset.

import { TEXTURE_REGISTRY } from '../../../game/textures/registry';
import { loadCustomTextures } from '../../../game/textures/materials';
import { HMSC_SHADERS, shaderSpec } from '../../../game/textures/shaders';
import type { MaterialChoice } from './chooser';

export function assignableMaterialCatalog(): MaterialChoice[] {
  const rows: MaterialChoice[] = [];
  const seen = new Set<string>();
  const push = (row: MaterialChoice): void => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    rows.push(row);
  };

  for (const spec of HMSC_SHADERS) {
    push({ id: spec.id, label: spec.label, group: spec.group, source: 'recipe' });
  }
  for (const t of TEXTURE_REGISTRY) {
    if (t.source.kind === 'shader' && !shaderSpec(t.id)) {
      push({ id: t.id, label: t.label, group: t.group ?? 'Shader Presets', source: 'preset' });
    }
    if (t.source.kind === 'react') push({ id: t.id, label: t.label, group: 'Facades', source: 'react' });
  }
  for (const t of loadCustomTextures()) {
    if (!t.decal && (!t.shaderId || !shaderSpec(t.shaderId))) continue;
    push({
      id: t.id,
      label: t.label,
      group: t.decal ? 'Stored Decals' : 'Stored Materials',
      source: t.decal ? 'stored-decal' : 'stored',
    });
  }
  return rows;
}
