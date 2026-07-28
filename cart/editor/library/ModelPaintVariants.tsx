// editor/library/ModelPaintVariants.tsx — the PAINT VARIANTS section of the Model Focus dock.
// A variant is the model's whole saved LOOK, stored ON DISK in the model's package: the
// stroke program (paints/paint_N.json, GUIDING_LIGHT "store the strokes, not the pixels"),
// the rasterized substrate (paint_N.png), and — since req_3439 — the full-look restore
// record (exact UV geometry + raster base), so an imported texture atlas mapped over the
// mesh is a saveable look even with ZERO brush strokes. Loading goes through the viewer
// bridge and brings the whole look back: texture, UV layout, and strokes.
//
// Save-BACK (req_2531): loading a variant makes it the ACTIVE painting, and Save then writes
// BACK to it (update-in-place) instead of forking a new one. A separate "New" always forks.
import { useState } from 'react';
import { ScrollView } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { listPaintVariants, savePaintVariant, updatePaintVariant, removePaintVariant, writePaintVariantMeshBlob } from '../data/paintVariants';
import { exactUvCornersFromAtlasTriangles, writeModelArtifacts } from '../data/modelPackageStore';
import type { ModelPackage } from '../data/types';
import type { ModelFocusBridge } from '../stage/ModelView';

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

export default function ModelPaintVariants({ model, bridge = null, hidden = false }: { model: ModelPackage; bridge?: ModelFocusBridge | null; hidden?: boolean }) {
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

  // Read the model's current LOOK: the stroke PROGRAM (may be empty — an imported
  // texture atlas mapped over the mesh is a look with zero strokes, req_3439), the
  // atlas readback (metadata + composite RGBA for the .png substrate), the exact
  // per-face UV geometry, and the raster baseline beneath any strokes. null (with a
  // note) only when there is genuinely nothing to keep.
  const readCurrentPaint = (): { prog: string; w: number; h: number; detail: number; rgba?: string; cornerUv: number[] | null; baseline: string } | null => {
    const progValue = host.__model_paint_program_read?.();
    const prog = typeof progValue === 'string' ? progValue : '';
    let atlas: { w: number; h: number; detail: number; data?: string; triangles?: unknown } = { w: 0, h: 0, detail: 1 };
    try { atlas = { ...atlas, ...JSON.parse(host.__model_atlas_read?.() || '{}') }; } catch { /* metadata is optional */ }
    const cornerUv = exactUvCornersFromAtlasTriangles(atlas.triangles, atlas.w, atlas.h);
    const baselineValue = host.__model_paint_baseline_read?.();
    const baseline = typeof baselineValue === 'string' ? baselineValue : '';
    const hasLook = !!cornerUv && !!(baseline || atlas.data);
    if (!prog && !hasLook) {
      setNote('Nothing to keep yet — paint the model, or import a texture in the UV panel above, then Save.');
      return null;
    }
    return { prog, w: atlas.w, h: atlas.h, detail: atlas.detail, rgba: atlas.data, cornerUv, baseline };
  };

  const saveNew = () => {
    const cur = readCurrentPaint();
    if (!cur) return;
    const v = savePaintVariant(model, { w: cur.w, h: cur.h, detail: cur.detail, data: cur.prog, format: 'program', atlasRgba: cur.rgba, cornerUv: cur.cornerUv, baselineRgba: cur.baseline });
    if (!v.data && !v.rasterBase) {
      // A strokeless look that failed to land its raster restores NOTHING — never
      // list a dud that would load as a blank model.
      removePaintVariant(model, v.id);
      console.error(`[paint-variants] ${model.name}: save captured no program and no raster base — variant discarded`);
      setNote('Save failed — the atlas raster could not be written to disk.');
      refresh();
      return;
    }
    writeModelArtifacts(model); // the painting implies a mesh + atlas — populate those folders too
    setActiveId(v.id);
    setNote(`Saved ${v.name} to ${model.name}/paints/ — texture, UV layout, and strokes captured.`);
    refresh();
  };

  // Save BACK to the active variant; if none is loaded (or it was deleted), fork a new one.
  const saveBack = () => {
    if (!activeId) return saveNew();
    const cur = readCurrentPaint();
    if (!cur) return;
    const v = updatePaintVariant(model, activeId, { w: cur.w, h: cur.h, detail: cur.detail, data: cur.prog, format: 'program', atlasRgba: cur.rgba, cornerUv: cur.cornerUv, baselineRgba: cur.baseline });
    if (!v) return saveNew(); // the active variant vanished — don't lose the work
    writeModelArtifacts(model); // keep mesh/ + atlases/ in step with the update
    setNote(`Updated ${v.name}.`);
    refresh();
  };

  const onLoad = (id: string) => {
    const v = variants.find((x) => x.id === id);
    if (!v) return;
    // The viewer bridge owns the restore (req_3439): it re-tessellates to the saved
    // detail, imports the raster base, applies the exact UV geometry, replays strokes,
    // and refreshes the UV panel — a full look needs all of that, not an atlas blit.
    const ok = bridge ? bridge.loadPaintVariant(v) : false;
    if (ok) {
      setActiveId(id); // now Save writes back to this one
      // The variant is now the APPLIED painting — persist its paint-space mesh blob
      // (req_2834), healing pre-blob variants into placeable skins on first load.
      writePaintVariantMeshBlob(model, id);
    }
    setNote(ok ? `Loaded ${v.name} — its texture, UV layout, and strokes are live. Save now updates it.` : `Couldn't load ${v.name} (open this model in the viewer first).`);
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
            <C.HW_VerbPrimary tooltip={`Save the current look (texture, UV layout, strokes) back into ${activeVariant.name}`} onPress={saveBack}>
              <Icon name="Save" size={11} color={accentFor('primary')} />
              <C.HW_VerbText>{`Update ${activeVariant.name}`}</C.HW_VerbText>
            </C.HW_VerbPrimary>
            <C.HW_VerbFixed tooltip={`Keep the current look as a NEW variant (${activeVariant.name} stays as saved)`} onPress={saveNew}>
              <Icon name="Plus" size={11} color={accentFor('textDim')} />
              <C.HW_VerbText>New</C.HW_VerbText>
            </C.HW_VerbFixed>
          </>
        ) : (
          <C.HW_VerbPrimary tooltip="Save the model's whole current look — texture, UV layout, and strokes — as a variant" onPress={saveNew}>
            <Icon name="Save" size={11} color={accentFor('primary')} />
            <C.HW_VerbText>Save Painting</C.HW_VerbText>
          </C.HW_VerbPrimary>
        )}
      </C.HW_VerbRow>

      {variants.length === 0 ? (
        <C.HW_ToolHint>One mesh, many looks — Save keeps the current look (texture, UV layout, strokes) as a variant. Import a new texture, remap, Save again for another; loading a variant brings its whole look back.</C.HW_ToolHint>
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
                  {/* What this variant restores: a full LOOK carries its own texture +
                      UV layout (req_3439); older records replay strokes/pixels only. */}
                  <C.HW_MaterialStat>{v.rasterBase && v.cornerUv?.length ? `texture + uv${v.data ? ' + strokes' : ''}` : v.format === 'program' ? 'strokes' : 'pixels'}</C.HW_MaterialStat>
                </C.HW_ModelMetaRow>
              </C.HW_ModelCardMain>
              <C.HW_IconMiniButton tooltip={`Load ${v.name} — restores its texture, UV layout, and strokes (Save then updates it)`} onPress={() => onLoad(v.id)}>
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
