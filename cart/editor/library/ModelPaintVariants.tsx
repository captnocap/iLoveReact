// editor/library/ModelPaintVariants.tsx — the real PAINT VARIANTS section of the Model Focus
// dock. A variant is a whole saved painting of the model, stored in the editor's own store
// (paintVariants.ts), read LIVE here — not the fabricated palette-slot swatches this section
// used to show. Save persists the model's STROKE PROGRAM (__model_paint_program_read) — the
// durable recipe, not the rasterized atlas (GUIDING_LIGHT: store the strokes, not the pixels);
// loading replays it (__model_paint_program_apply). Legacy atlas variants still load via
// __model_atlas_apply. Honest-empty until the first painting is saved.
import { useState } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { listPaintVariants, savePaintVariant, removePaintVariant } from '../data/paintVariants';
import type { ModelPackage } from '../data/types';

const host = globalThis as any;

export default function ModelPaintVariants({ model }: { model: ModelPackage }) {
  const [rev, setRev] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const variants = listPaintVariants(model);
  const refresh = () => setRev((r) => r + 1);

  const onSave = () => {
    // The durable form is the STROKE PROGRAM (recipe), not the rasterized atlas. "" = nothing
    // painted (open + paint first); undefined = the host predates the door (rebuild). Both get an
    // honest note, never a fake save.
    const prog = host.__model_paint_program_read?.();
    if (typeof prog !== 'string' || prog.length === 0) {
      setNote('Open this model in the viewer and paint it before saving a variant.');
      return;
    }
    // The atlas readback gives display metadata (w/h/detail) AND the rasterized RGBA pixels
    // (base64 `data`) — the latter becomes the on-disk .png editing substrate/preview.
    let atlas: { w: number; h: number; detail: number; data?: string } = { w: 0, h: 0, detail: 1 };
    try { atlas = { ...atlas, ...JSON.parse(host.__model_atlas_read?.() || '{}') }; } catch { /* metadata is optional */ }
    const v = savePaintVariant(model, { w: atlas.w, h: atlas.h, detail: atlas.detail, data: prog, format: 'program', atlasRgba: atlas.data });
    setNote(`Saved ${v.name} to ${model.name}/paints/.`);
    refresh();
  };

  const onLoad = (id: string) => {
    const v = listPaintVariants(model).find((x) => x.id === id);
    if (!v) return;
    // Replay the stroke program; legacy atlas variants blit their pixels.
    const ok = v.format === 'program'
      ? host.__model_paint_program_apply?.(v.data) === 1
      : host.__model_atlas_apply?.(v.detail, v.data) === 1;
    setNote(ok ? `Loaded ${v.name} onto the model.` : `Couldn't load ${v.name} (open this model in the viewer first).`);
  };

  const onDelete = (id: string) => {
    removePaintVariant(model, id);
    setNote(null);
    refresh();
  };

  return (
    <C.HW_ModelSection>
      <C.HW_ModelSectionHead>
        <Icon name="Brush" size={12} color={accentFor('primary')} />
        <C.HW_GroupText>PAINT VARIANTS</C.HW_GroupText>
        <C.HW_Spacer />
        <C.HW_Pill tooltip="Save the model's current painting as a variant" onPress={onSave}>
          <Icon name="Save" size={11} color={accentFor('primary')} />
          <C.HW_PillText>Save</C.HW_PillText>
        </C.HW_Pill>
      </C.HW_ModelSectionHead>

      {variants.length === 0 ? (
        <C.HW_ToolHint>No paintings saved yet — paint the model, then Save to keep this look as a variant.</C.HW_ToolHint>
      ) : (
        variants.map((v) => (
          <C.HW_ModelAtlasCard key={v.id}>
            <C.HW_ModelCardMain>
              <C.HW_MaterialTitleRow>
                <C.HW_ToolValue>{v.name}</C.HW_ToolValue>
                <C.HW_Spacer />
                <C.HW_MaterialStat>{v.detail <= 1 ? 'fill' : `${v.detail}px`}</C.HW_MaterialStat>
              </C.HW_MaterialTitleRow>
              <C.HW_ModelMetaRow>
                <C.HW_MaterialStat>{v.w}×{v.h}</C.HW_MaterialStat>
              </C.HW_ModelMetaRow>
            </C.HW_ModelCardMain>
            <C.HW_IconButton tooltip={`Load ${v.name} onto the model`} onPress={() => onLoad(v.id)}>
              <Icon name="CornerDownLeft" size={13} color={accentFor('primary')} />
            </C.HW_IconButton>
            <C.HW_IconButton tooltip={`Delete ${v.name}`} onPress={() => onDelete(v.id)}>
              <Icon name="Trash2" size={13} color={accentFor('textDim')} />
            </C.HW_IconButton>
          </C.HW_ModelAtlasCard>
        ))
      )}

      {note ? <C.HW_ToolHint>{note}</C.HW_ToolHint> : null}
    </C.HW_ModelSection>
  );
}
