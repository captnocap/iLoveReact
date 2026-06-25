// editors/decal/DecalNodeFields.tsx — the shared DECAL field controls
// (req_1730/req_1831). The per-node inspector (rect / text / image / neon) +
// the add-node action chips + the canvas fields, as data-field protocol specs
// (shell/fields). The materials composer AND the studio painter both build their
// panels from these, so the rich text/fill/font/image vocabulary lives once
// ([[feedback_rule_of_two_no_magic_values]]).

import type { FieldSpec, PickOption } from '../../shell/fields';
import { defaultShaderData, type ShaderSpec } from '../../game/textures/shaders';
import { DECAL_SIZE_PRESETS, type DecalAlign, type DecalDoc, type DecalNode } from '../../game/textures/decal';
import {
  ALIGN_OPTS, FONT_FAMILIES, FONT_WEIGHTS,
  newImage, newPath, newRect, newText, parseWeight,
} from './decalEdit';

/** Effect-fill recipes are the `a-`..`j-` fragment fills (game/textures/shaders). */
export function isEffectFillSpec(spec: ShaderSpec): boolean {
  return /^[a-j]-/.test(spec.id);
}
export function effectFillOptions(recipes: ShaderSpec[]): PickOption[] {
  return recipes.filter(isEffectFillSpec).map((spec) => ({ id: spec.id, label: spec.label, group: spec.group }));
}
export function effectFillLabel(recipes: ShaderSpec[], id: string): string {
  return recipes.find((spec) => spec.id === id)?.label ?? id;
}

function presetLabel(doc: DecalDoc): string {
  return DECAL_SIZE_PRESETS.find((p) => p.width === doc.width && p.height === doc.height)?.label ?? 'custom';
}

export type DecalNodeFieldDeps = {
  doc: DecalDoc;
  selectedId: string | null;
  recipes: ShaderSpec[];
  patchNode(id: string, patch: Partial<DecalNode>): void;
  patchDoc(patch: Partial<DecalDoc>): void;
  pickImageForNode(id: string): void;
};

/** The per-node inspector when a node is selected, else the canvas (size/bg)
 *  fields — the exact control set the composer's `canvasOrNodeFields` built. */
export function decalNodeFields(d: DecalNodeFieldDeps): FieldSpec[] {
  const selected = d.selectedId ? d.doc.nodes.find((n) => n.id === d.selectedId) ?? null : null;
  if (!selected) {
    return [
      { k: 'width', t: 'num', min: 8, max: 4096, step: 8, precision: 0, get: () => d.doc.width, set: (v) => d.patchDoc({ width: Math.max(8, Math.round(v)) }) },
      { k: 'height', t: 'num', min: 8, max: 4096, step: 8, precision: 0, get: () => d.doc.height, set: (v) => d.patchDoc({ height: Math.max(8, Math.round(v)) }) },
      { k: 'bg', t: 'color', wheel: true, get: () => d.doc.bg, set: (v) => d.patchDoc({ bg: v }) },
    ];
  }
  const fields: FieldSpec[] = [
    { k: 'x', t: 'num', min: -4096, max: 4096, step: 1, precision: 0, get: () => selected.x, set: (v) => d.patchNode(selected.id, { x: v }) },
    { k: 'y', t: 'num', min: -4096, max: 4096, step: 1, precision: 0, get: () => selected.y, set: (v) => d.patchNode(selected.id, { y: v }) },
    { k: 'w', t: 'num', min: 1, max: 4096, step: 1, precision: 0, get: () => selected.w, set: (v) => d.patchNode(selected.id, { w: Math.max(1, v) }) },
    { k: 'h', t: 'num', min: 1, max: 4096, step: 1, precision: 0, get: () => selected.h, set: (v) => d.patchNode(selected.id, { h: Math.max(1, v) }) },
    { k: 'opacity', t: 'slider', min: 0.05, max: 1, show: (v) => v.toFixed(2), get: () => selected.opacity ?? 1, set: (v) => d.patchNode(selected.id, { opacity: v }) },
  ];
  if (selected.kind === 'rect') {
    fields.push(
      { k: 'flat fill', t: 'color', wheel: true, get: () => selected.bg, set: (v) => d.patchNode(selected.id, { bg: v }) },
      {
        k: 'effect fill', t: 'pick',
        get: () => selected.fillShaderId ?? null,
        opts: () => effectFillOptions(d.recipes),
        show: (id) => effectFillLabel(d.recipes, id),
        clearLabel: 'flat color',
        set: (id) => {
          const spec = id ? d.recipes.find((s) => s.id === id) : null;
          d.patchNode(selected.id, spec ? { fillShaderId: spec.id, fillData: defaultShaderData(spec) } : { fillShaderId: undefined, fillData: undefined });
        },
      },
      { k: 'radius', t: 'num', min: 0, max: 128, step: 1, precision: 0, get: () => selected.borderRadius ?? 0, set: (v) => d.patchNode(selected.id, { borderRadius: v }) },
      { k: 'border', t: 'num', min: 0, max: 32, step: 1, precision: 0, get: () => selected.borderWidth ?? 0, set: (v) => d.patchNode(selected.id, { borderWidth: v }) },
      { k: 'b.color', t: 'color', wheel: true, get: () => selected.borderColor ?? '#000000', set: (v) => d.patchNode(selected.id, { borderColor: v }) },
    );
  } else if (selected.kind === 'text') {
    fields.push(
      { k: 'text', t: 'text', width: 166, get: () => selected.text, set: (v) => d.patchNode(selected.id, { text: v }) },
      { k: 'color', t: 'color', wheel: true, get: () => selected.color, set: (v) => d.patchNode(selected.id, { color: v }) },
      { k: 'size', t: 'num', min: 6, max: 320, step: 1, precision: 0, get: () => selected.fontSize, set: (v) => d.patchNode(selected.id, { fontSize: v }) },
      { k: 'tracking', t: 'num', min: -4, max: 32, step: 0.5, precision: 1, get: () => selected.letterSpacing ?? 0, set: (v) => d.patchNode(selected.id, { letterSpacing: v }) },
      { k: 'weight', t: 'enum', opts: FONT_WEIGHTS, get: () => String(selected.fontWeight ?? 400), set: (v) => d.patchNode(selected.id, { fontWeight: parseWeight(v) }) },
      { k: 'family', t: 'enum', opts: FONT_FAMILIES, get: () => selected.fontFamily ?? 'default', set: (v) => d.patchNode(selected.id, { fontFamily: v === 'default' ? undefined : v }) },
      { k: 'align', t: 'enum', opts: ALIGN_OPTS, get: () => selected.align ?? 'left', set: (v) => d.patchNode(selected.id, { align: v as DecalAlign }) },
    );
  } else if (selected.kind === 'path') {
    fields.push(
      { k: 'path d', t: 'text', width: 200, get: () => selected.d, set: (v) => d.patchNode(selected.id, { d: v }) },
      { k: 'tube', t: 'color', wheel: true, get: () => selected.stroke, set: (v) => d.patchNode(selected.id, { stroke: v }) },
      { k: 'width', t: 'num', min: 1, max: 64, step: 0.5, precision: 1, get: () => selected.strokeWidth, set: (v) => d.patchNode(selected.id, { strokeWidth: v }) },
      { k: 'glow', t: 'color', wheel: true, get: () => selected.glow ?? selected.stroke, set: (v) => d.patchNode(selected.id, { glow: v }) },
      { k: 'glow amt', t: 'slider', min: 0, max: 1, show: (v) => v.toFixed(2), get: () => selected.glowOpacity ?? 0.5, set: (v) => d.patchNode(selected.id, { glowOpacity: v }) },
      { k: 'body fill', t: 'color', wheel: true, get: () => selected.fill ?? '#000000', set: (v) => d.patchNode(selected.id, { fill: v }) },
    );
  } else {
    fields.push(
      { k: 'pick file…', t: 'act', run: () => d.pickImageForNode(selected.id) },
      { k: 'src', t: 'text', width: 174, get: () => selected.src, set: (v) => d.patchNode(selected.id, { src: v }) },
      { k: 'radius', t: 'num', min: 0, max: 128, step: 1, precision: 0, get: () => selected.borderRadius ?? 0, set: (v) => d.patchNode(selected.id, { borderRadius: v }) },
    );
  }
  return fields;
}

export type DecalAddDeps = {
  doc: DecalDoc;
  addNode(node: DecalNode): void;
  pickImageForNode(id: string): void;
};

/** The "+ rect / + text / + image / + neon" action chips. Image also opens the
 *  file picker straight after minting (matching the composer's addImageNode). */
export function decalAddFields(d: DecalAddDeps): FieldSpec[] {
  return [
    { k: '+ rect', t: 'act', run: () => d.addNode(newRect(d.doc)) },
    { k: '+ text', t: 'act', run: () => d.addNode(newText(d.doc)) },
    { k: '+ image', t: 'act', run: () => { const node = newImage(d.doc); d.addNode(node); d.pickImageForNode(node.id); } },
    { k: '+ neon', t: 'act', run: () => d.addNode(newPath(d.doc)) },
  ];
}

/** Canvas size-preset + custom-dimension fields, shared by composer + painter. */
export function decalCanvasFields(doc: DecalDoc, patchDoc: (patch: Partial<DecalDoc>) => void): FieldSpec[] {
  return [
    { k: 'size', t: 'enum', opts: DECAL_SIZE_PRESETS.map((p) => p.label), get: () => presetLabel(doc), set: (label) => {
      const p = DECAL_SIZE_PRESETS.find((x) => x.label === label);
      if (p) patchDoc({ width: p.width, height: p.height });
    } },
  ];
}
