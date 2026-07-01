// editor/library/ModelPaintVariants.tsx — the real PAINT VARIANTS section of the Model Focus
// dock. A variant is a whole saved painting of the model, stored in the editor's own store
// (paintVariants.ts), read LIVE here — not the fabricated palette-slot swatches this section
// used to show. Save reads the model's current paint atlas from the host (__model_atlas_read)
// and persists it; loading a variant blits it back (__model_atlas_apply). Honest-empty until
// the first painting is saved.
import { useState } from 'react';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { listPaintVariants, savePaintVariant, removePaintVariant } from '../data/paintVariants';

const host = globalThis as any;

export default function ModelPaintVariants({ modelId }: { modelId: string }) {
  const [rev, setRev] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const variants = listPaintVariants(modelId);
  const refresh = () => setRev((r) => r + 1);

  const onSave = () => {
    // Read the model's live atlas from the host. "" = no paint target (open + paint the model
    // first); undefined = the host predates the door (rebuild). Both get an honest note, never
    // a fake save.
    const json = host.__model_atlas_read?.();
    if (typeof json !== 'string' || json.length === 0) {
      setNote('Open this model in the viewer and paint it before saving a variant.');
      return;
    }
    try {
      const atlas = JSON.parse(json) as { w: number; h: number; detail: number; data: string };
      const v = savePaintVariant(modelId, atlas);
      setNote(`Saved ${v.name}.`);
      refresh();
    } catch {
      setNote('Could not read the current painting.');
    }
  };

  const onLoad = (id: string) => {
    const v = listPaintVariants(modelId).find((x) => x.id === id);
    if (!v) return;
    const ok = host.__model_atlas_apply?.(v.detail, v.data) === 1;
    setNote(ok ? `Loaded ${v.name} onto the model.` : `Couldn't load ${v.name} (open this model in the viewer first).`);
  };

  const onDelete = (id: string) => {
    removePaintVariant(modelId, id);
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
