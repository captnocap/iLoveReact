// editor/library/ModelPaintVariants.tsx — the PAINT VARIANTS section of the Model Focus dock.
// A variant is a whole saved painting of the model, stored ON DISK in the model's package
// (paints/paint_N.json = the STROKE PROGRAM, GUIDING_LIGHT "store the strokes, not the pixels";
// paints/paint_N.png = the rasterized substrate). Loading replays the program
// (__model_paint_program_apply); legacy atlas variants blit their pixels (__model_atlas_apply).
//
// Save-BACK (req_2531): loading a variant makes it the ACTIVE painting, and Save then writes
// BACK to it (update-in-place) instead of forking a new one. A separate "New" always forks.
import { useState } from 'react';
import { ScrollView } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { listPaintVariants, savePaintVariant, updatePaintVariant, removePaintVariant, writePaintVariantMeshBlob } from '../data/paintVariants';
import { writeModelArtifacts } from '../data/modelPackageStore';
import type { ModelPackage } from '../data/types';

const host = globalThis as any;

// The section's space budget inside the FIXED focus panel (req_2627): the
// variant list is a bounded nested scroll — at most this many rows tall, the
// list scrolls inside its slice instead of stretching the panel.
const VARIANT_ROW_HEIGHT = 34; // HW_ModelAtlasCard height
const VARIANT_ROW_GAP = 4;
const VARIANT_ROWS_VISIBLE = 4;

function variantListHeight(count: number): number {
  const rows = Math.min(count, VARIANT_ROWS_VISIBLE);
  return rows * VARIANT_ROW_HEIGHT + Math.max(0, rows - 1) * VARIANT_ROW_GAP;
}

export default function ModelPaintVariants({ model, hidden = false }: { model: ModelPackage; hidden?: boolean }) {
  const [rev, setRev] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  // The variant Save writes back to. null = nothing loaded, so Save forks a NEW painting and
  // the button reads "Save". It becomes non-null ONLY when you explicitly Load a variant (or
  // just saved one) — that's when the button becomes "Update <name>". We must NOT presume the
  // latest is loaded: with nothing painted, "Update Painting 3" is a lie (req_2532).
  const [activeId, setActiveId] = useState<string | null>(null);
  const variants = listPaintVariants(model);
  const activeVariant = activeId ? variants.find((v) => v.id === activeId) ?? null : null;
  const refresh = () => setRev((r) => r + 1);

  // Read the model's current painting: the durable stroke PROGRAM plus the atlas readback
  // (metadata + rasterized RGBA for the .png substrate). null (with a note) when nothing is
  // painted yet or the host predates the door.
  const readCurrentPaint = (): { prog: string; w: number; h: number; detail: number; rgba?: string } | null => {
    const prog = host.__model_paint_program_read?.();
    if (typeof prog !== 'string' || prog.length === 0) {
      setNote('Open this model in the viewer and paint it before saving.');
      return null;
    }
    let atlas: { w: number; h: number; detail: number; data?: string } = { w: 0, h: 0, detail: 1 };
    try { atlas = { ...atlas, ...JSON.parse(host.__model_atlas_read?.() || '{}') }; } catch { /* metadata is optional */ }
    return { prog, w: atlas.w, h: atlas.h, detail: atlas.detail, rgba: atlas.data };
  };

  const saveNew = () => {
    const cur = readCurrentPaint();
    if (!cur) return;
    const v = savePaintVariant(model, { w: cur.w, h: cur.h, detail: cur.detail, data: cur.prog, format: 'program', atlasRgba: cur.rgba });
    writeModelArtifacts(model); // the painting implies a mesh + atlas — populate those folders too
    setActiveId(v.id);
    setNote(`Saved ${v.name} to ${model.name}/paints/.`);
    refresh();
  };

  // Save BACK to the active variant; if none is loaded (or it was deleted), fork a new one.
  const saveBack = () => {
    if (!activeId) return saveNew();
    const cur = readCurrentPaint();
    if (!cur) return;
    const v = updatePaintVariant(model, activeId, { w: cur.w, h: cur.h, detail: cur.detail, data: cur.prog, format: 'program', atlasRgba: cur.rgba });
    if (!v) return saveNew(); // the active variant vanished — don't lose the work
    writeModelArtifacts(model); // keep mesh/ + atlases/ in step with the update
    setNote(`Updated ${v.name}.`);
    refresh();
  };

  const onLoad = (id: string) => {
    const v = variants.find((x) => x.id === id);
    if (!v) return;
    const ok = v.format === 'program'
      ? host.__model_paint_program_apply?.(v.data) === 1
      : host.__model_atlas_apply?.(v.detail, v.data) === 1;
    if (ok) {
      setActiveId(id); // now Save writes back to this one
      // The variant is now the APPLIED painting — persist its paint-space mesh blob
      // (req_2834), healing pre-blob variants into placeable skins on first load.
      writePaintVariantMeshBlob(model, id);
    }
    setNote(ok ? `Loaded ${v.name} — Save now updates it.` : `Couldn't load ${v.name} (open this model in the viewer first).`);
  };

  const onDelete = (id: string) => {
    removePaintVariant(model, id);
    if (activeId === id) setActiveId(null);
    setNote(null);
    refresh();
  };

  // The fixed-region grid layout (req_2627 / req_2626 II): the section header
  // row carries the TITLE only (single line, never wraps); the save verbs live
  // on their own VERB ROW below it — a primary action flexing to the section's
  // one right edge plus a fixed "New" column. Button labels are single-line by
  // law; a long variant name truncates loudly (the tooltip carries it in full).
  return (
    <C.HW_ModelSection style={hidden ? { display: 'none' } : undefined}>
      <C.HW_ModelSectionHead>
        <Icon name="Brush" size={12} color={accentFor('primary')} />
        <C.HW_GroupText>PAINT VARIANTS</C.HW_GroupText>
        <C.HW_Spacer />
        <C.HW_KeyText>{String(variants.length)}</C.HW_KeyText>
      </C.HW_ModelSectionHead>

      <C.HW_VerbRow>
        {activeVariant ? (
          <>
            <C.HW_VerbPrimary tooltip={`Save back to ${activeVariant.name}`} onPress={saveBack}>
              <Icon name="Save" size={11} color={accentFor('primary')} />
              <C.HW_VerbText>{`Update ${activeVariant.name}`}</C.HW_VerbText>
            </C.HW_VerbPrimary>
            <C.HW_VerbFixed tooltip="Save the current painting as a NEW variant" onPress={saveNew}>
              <Icon name="Plus" size={11} color={accentFor('textDim')} />
              <C.HW_VerbText>New</C.HW_VerbText>
            </C.HW_VerbFixed>
          </>
        ) : (
          <C.HW_VerbPrimary tooltip="Save the model's current painting as a variant" onPress={saveNew}>
            <Icon name="Save" size={11} color={accentFor('primary')} />
            <C.HW_VerbText>Save Painting</C.HW_VerbText>
          </C.HW_VerbPrimary>
        )}
      </C.HW_VerbRow>

      {variants.length === 0 ? (
        <C.HW_ToolHint>No paintings saved yet — paint the model, then Save to keep this look as a variant.</C.HW_ToolHint>
      ) : (
        /* Bounded NESTED scroll (req_2627): the list scrolls inside its fixed
           slice of the panel; explicit height per the layout rules. */
        <ScrollView
          style={{ height: variantListHeight(variants.length) }}
          contentContainerStyle={{ flexDirection: 'column', gap: VARIANT_ROW_GAP }}
        >
          {variants.map((v) => (
            <C.HW_ModelAtlasCard key={v.id}>
              <C.HW_ModelCardMain>
                <C.HW_MaterialTitleRow>
                  <C.HW_ToolValue>{v.name}</C.HW_ToolValue>
                  {v.id === activeId ? <C.HW_MaterialStat style={{ color: accentFor('primary') }}>editing</C.HW_MaterialStat> : null}
                  <C.HW_Spacer />
                  <C.HW_MaterialStat>{v.detail <= 1 ? 'fill' : `${v.detail}px`}</C.HW_MaterialStat>
                </C.HW_MaterialTitleRow>
                <C.HW_ModelMetaRow>
                  <C.HW_MaterialStat>{`${v.w}×${v.h}`}</C.HW_MaterialStat>
                </C.HW_ModelMetaRow>
              </C.HW_ModelCardMain>
              <C.HW_IconMiniButton tooltip={`Load ${v.name} onto the model (Save then updates it)`} onPress={() => onLoad(v.id)}>
                <Icon name="CornerDownLeft" size={13} color={accentFor('primary')} />
              </C.HW_IconMiniButton>
              <C.HW_IconMiniButton tooltip={`Delete ${v.name}`} onPress={() => onDelete(v.id)}>
                <Icon name="Trash2" size={13} color={accentFor('textDim')} />
              </C.HW_IconMiniButton>
            </C.HW_ModelAtlasCard>
          ))}
        </ScrollView>
      )}

      {note ? <C.HW_ToolHint>{note}</C.HW_ToolHint> : null}
    </C.HW_ModelSection>
  );
}
