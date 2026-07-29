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
import { useRef, useState } from 'react';
import { ScrollView, TextInput } from '../../../runtime/primitives';
import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';
import { listPaintVariants, renamePaintVariant, savePaintVariant, updatePaintVariant, removePaintVariant, writePaintVariantMeshBlob, type PaintVariant } from '../data/paintVariants';
import { exactUvCornersFromAtlasTriangles, writeModelArtifacts } from '../data/modelPackageStore';
import { hasUvCoverageRasterWriter } from '../data/uvCoverageRaster';
import { compilePaintAtlas, paintAtlasCompileStatus, type PaintAtlasCompileProgress } from '../data/paintAtlasCompiler';
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function coverageNote(v: PaintVariant): string {
  const c = v.uvCoverage;
  if (!c || c.totalPixels <= 0) return '';
  const percent = Math.round(c.clearedPixels / c.totalPixels * 100);
  const bytes = c.pngBytes + (c.basePngBytes ?? 0);
  return ` UV cleanup discarded ${percent}% of unsampled texels; ${formatBytes(bytes)} written with a ${c.gutterTexels}px filter gutter.`;
}

export default function ModelPaintVariants({ model, bridge = null, hidden = false }: { model: ModelPackage; bridge?: ModelFocusBridge | null; hidden?: boolean }) {
  const [rev, setRev] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [compileProgress, setCompileProgress] = useState<PaintAtlasCompileProgress | null>(null);
  const savingRef = useRef(false);
  const compilingRef = useRef(false);
  // The variant Save writes back to. null = nothing loaded, so Save forks a NEW painting and
  // the button reads "Save". It becomes non-null ONLY when you explicitly Load a variant (or
  // just saved one) — that's when the button becomes "Update <name>". We must NOT presume the
  // latest is loaded: with nothing painted, "Update Painting 3" is a lie (req_2532).
  const [activeId, setActiveId] = useState<string | null>(null);
  const variants = listPaintVariants(model);
  const compiled = paintAtlasCompileStatus(model);
  const activeVariant = activeId ? variants.find((v) => v.id === activeId) ?? null : null;
  const refresh = () => setRev((r) => r + 1);
  const recompileNote = compiled.state === 'none'
    ? ''
    : ' The shared atlas is now out of date; Recompile when this source set is ready.';
  const queueSave = (action: () => void) => {
    if (savingRef.current || compilingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setNote('Scanning UV coverage and writing optimized texture files…');
    // Yield one frame so a large imported atlas presents an honest busy state before
    // native mask rasterization + PNG encoding occupy this synchronous save boundary.
    setTimeout(() => {
      try { action(); }
      finally {
        savingRef.current = false;
        setSaving(false);
      }
    }, 0);
  };

  const compileSources = async () => {
    if (savingRef.current || compilingRef.current) return;
    compilingRef.current = true;
    setCompiling(true);
    setCompileProgress({ phase: 'scanning', completed: 0, total: variants.length + 1, label: 'Scanning editable paint sources…' });
    setNote('The individual painting files stay editable; this writes a separate shared atlas.');
    try {
      const result = await compilePaintAtlas(model, setCompileProgress);
      if (!result.ok) {
        setNote(`Atlas compile stopped — ${result.error}`);
        return;
      }
      const stats = result.manifest.stats;
      const savedPercent = stats.sourcePixels > 0
        ? Math.max(0, Math.round((stats.sourcePixels - stats.atlasPixels) / stats.sourcePixels * 100))
        : 0;
      const aliasNote = stats.uniqueTileCount < stats.lookCount
        ? ` ${stats.lookCount - stats.uniqueTileCount} byte-identical look${stats.lookCount - stats.uniqueTileCount === 1 ? '' : 's'} reused an existing tile.`
        : '';
      setNote(
        `Compiled ${stats.lookCount} look${stats.lookCount === 1 ? '' : 's'} into one ${result.manifest.atlas.width}×${result.manifest.atlas.height} PNG (${formatBytes(result.manifest.atlas.pngBytes)}, ${savedPercent}% fewer runtime atlas pixels). Sources were not changed.${aliasNote}`,
      );
    } finally {
      compilingRef.current = false;
      setCompiling(false);
      setCompileProgress(null);
      refresh();
    }
  };

  // Read the model's current LOOK: the stroke PROGRAM (may be empty — an imported
  // texture atlas mapped over the mesh is a look with zero strokes, req_3439), the
  // atlas metadata + exact per-face UV geometry, and (on a legacy host) the composite
  // RGBA/baseline. The native finalizer reads large rasters without crossing JS.
  // null (with a note) only when there is genuinely nothing to keep.
  const readCurrentPaint = (): { prog: string; w: number; h: number; detail: number; rgba?: string; cornerUv: number[] | null; baseline: string } | null => {
    const progValue = host.__model_paint_program_read?.();
    const prog = typeof progValue === 'string' ? progValue : '';
    const nativeCoverageWrite = hasUvCoverageRasterWriter();
    let atlas: { w: number; h: number; detail: number; data?: string; triangles?: unknown } = { w: 0, h: 0, detail: 1 };
    // Native finalization reads resident pixels directly. Asking only for geometry avoids
    // a ~32 MiB base64 string for a 2000×3000 import; old hosts retain the legacy read.
    try { atlas = { ...atlas, ...JSON.parse(host.__model_atlas_read?.(nativeCoverageWrite ? 0 : 1) || '{}') }; } catch { /* metadata is optional */ }
    const cornerUv = exactUvCornersFromAtlasTriangles(atlas.triangles, atlas.w, atlas.h);
    const baselineValue = nativeCoverageWrite ? '' : host.__model_paint_baseline_read?.();
    const baseline = typeof baselineValue === 'string' ? baselineValue : '';
    const hasLook = !!cornerUv && atlas.w > 0 && atlas.h > 0 && !!(nativeCoverageWrite || baseline || atlas.data);
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
    setNote(`Saved ${v.name} to ${model.name}/paints/ — texture, UV layout, and strokes captured.${coverageNote(v)}${recompileNote}`);
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
    setNote(`Updated ${v.name}.${coverageNote(v)}${recompileNote}`);
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
    setNote(compiled.state === 'none'
      ? null
      : 'Painting deleted. Its individual files are gone; the shared atlas is now out of date and can be rebuilt when ready.');
    refresh();
  };

  // Inline rename (req_3448) — the Outliner's idiom: pencil opens a draft in the
  // row, Enter/check commits, Escape cancels. Rename touches the LABEL only; the
  // painting, its files, and any placed instances wearing it are untouched.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const startRename = (v: PaintVariant) => { setRenamingId(v.id); setRenameDraft(v.name); };
  const cancelRename = () => { setRenamingId(null); setRenameDraft(''); };
  const commitRename = (v: PaintVariant) => {
    const name = renameDraft.trim();
    if (name && name !== v.name) {
      const renamed = renamePaintVariant(model, v.id, name);
      setNote(renamed ? `Renamed ${v.name} → ${renamed.name}.` : `Couldn't rename ${v.name}.`);
    }
    cancelRename();
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
            <C.HW_VerbPrimary tooltip={`Update ${activeVariant.name} and discard texels outside the current UV coverage`} onPress={saving || compiling ? undefined : () => queueSave(saveBack)}>
              <Icon name={saving ? 'Loader2' : 'Save'} size={11} color={accentFor('primary')} />
              <C.HW_VerbText>{saving ? 'Optimizing UV…' : `Update ${activeVariant.name}`}</C.HW_VerbText>
            </C.HW_VerbPrimary>
            <C.HW_VerbFixed tooltip={`Keep the current look as a NEW coverage-trimmed variant (${activeVariant.name} stays as saved)`} onPress={saving || compiling ? undefined : () => queueSave(saveNew)}>
              <Icon name="Plus" size={11} color={accentFor('textDim')} />
              <C.HW_VerbText>New</C.HW_VerbText>
            </C.HW_VerbFixed>
          </>
        ) : (
          <C.HW_VerbPrimary tooltip="Save the whole current look and discard imported texels outside its UV coverage (a filter gutter stays intact)" onPress={saving || compiling ? undefined : () => queueSave(saveNew)}>
            <Icon name={saving ? 'Loader2' : 'Save'} size={11} color={accentFor('primary')} />
            <C.HW_VerbText>{saving ? 'Optimizing UV…' : 'Save Painting'}</C.HW_VerbText>
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
                  {renamingId === v.id ? (
                    <TextInput
                      value={renameDraft}
                      onChange={setRenameDraft}
                      onKeyDown={(event: any) => {
                        if (event?.key === 'Enter') commitRename(v);
                        if (event?.key === 'Escape') cancelRename();
                      }}
                      placeholder={v.name}
                      style={{ flexGrow: 1, minWidth: 0, height: 18, paddingLeft: 4, paddingRight: 4, borderRadius: 3, borderWidth: 1, borderColor: accentFor('primary'), backgroundColor: '#111a29', color: accentFor('text'), fontSize: 11 }}
                    />
                  ) : (
                    <>
                      <C.HW_ToolValue>{v.name}</C.HW_ToolValue>
                      {v.id === activeId ? <C.HW_MaterialStat style={{ color: accentFor('primary') }}>editing</C.HW_MaterialStat> : null}
                      <C.HW_Spacer />
                      <C.HW_MaterialStat>{v.detail <= 1 ? 'fill' : `${v.detail}px`}</C.HW_MaterialStat>
                    </>
                  )}
                </C.HW_MaterialTitleRow>
                <C.HW_ModelMetaRow>
                  <C.HW_MaterialStat>{`${v.w}×${v.h}`}</C.HW_MaterialStat>
                  {/* What this variant restores: a full LOOK carries its own texture +
                      UV layout (req_3439); older records replay strokes/pixels only. */}
                  <C.HW_MaterialStat>{v.rasterBase && v.cornerUv?.length ? `texture + uv${v.data ? ' + strokes' : ''}` : v.format === 'program' ? 'strokes' : 'pixels'}</C.HW_MaterialStat>
                  {v.uvCoverage ? <C.HW_MaterialStat>{`${Math.round(v.uvCoverage.clearedPixels / v.uvCoverage.totalPixels * 100)}% trimmed`}</C.HW_MaterialStat> : null}
                </C.HW_ModelMetaRow>
              </C.HW_ModelCardMain>
              <C.HW_IconMiniButton
                tooltip={renamingId === v.id ? 'Save the new name (Enter) · Esc cancels' : `Rename ${v.name}`}
                onPress={() => (renamingId === v.id ? commitRename(v) : startRename(v))}
              >
                <Icon name={renamingId === v.id ? 'Check' : 'Pencil'} size={13} color={accentFor(renamingId === v.id ? 'primary' : 'textDim')} />
              </C.HW_IconMiniButton>
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

      <C.HW_VerbRow>
        <C.HW_VerbPrimary
          tooltip="Compile the saved model look and every individual paint variant into one lossless, best-fit atlas. Sources remain separate so you can add more and compile again."
          onPress={saving || compiling ? undefined : () => { void compileSources(); }}
        >
          <Icon name={compiling ? 'Loader2' : 'PackageCheck'} size={11} color={accentFor('primary')} />
          <C.HW_VerbText>
            {compiling
              ? compileProgress?.label ?? 'Compiling Atlas…'
              : compiled.state === 'none'
                ? 'Compile Shared Atlas'
                : 'Recompile Shared Atlas'}
          </C.HW_VerbText>
        </C.HW_VerbPrimary>
      </C.HW_VerbRow>

      {!note && compiled.state === 'fresh' ? (
        <C.HW_ToolHint>{`Shared atlas is current: ${compiled.lookCount} look${compiled.lookCount === 1 ? '' : 's'} · ${compiled.width}×${compiled.height} · ${formatBytes(compiled.pngBytes ?? 0)}. Individual sources remain editable.`}</C.HW_ToolHint>
      ) : !note && compiled.state === 'stale' ? (
        <C.HW_ToolHint>Shared atlas is out of date. The saved individual looks are intact; Recompile when you want the latest set packed together.</C.HW_ToolHint>
      ) : null}

      {note ? <C.HW_ToolHint>{note}</C.HW_ToolHint> : null}
    </C.HW_ModelSection>
  );
}
