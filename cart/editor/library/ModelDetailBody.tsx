// editor/library/ModelDetailBody.tsx — the focused-model detail content
// (header, folder contract, atlas sets). Pure real-data display from the model
// package; paint variants live in the model's dedicated Paint pane (req_3266).
//
// The card describes the model with facts NOTHING else on screen already shows. The
// OUTLINER (right below) owns the parts and their count — so the card never restates
// "N parts". A model's kind, its package path, and empty contract slots are
// noise, not data: we show the name, stage, real triangle count, and the single real
// source, then gate every section to actual content (req_2406, req_2416).
import { ScrollView } from '../../../runtime/primitives';
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { ModelPackage } from '../data/types';
import ModelThumbnail from './ModelThumbnail';

// A folder-contract value counts as real only if it's present and not the "-" placeholder.
const hasValue = (value?: string): value is string => !!value && value !== '-';

// ATLAS SETS space budget inside the FIXED focus panel (req_2627, the ModelPaintVariants
// treatment): the list is a bounded nested scroll — at most this many rows tall, then it
// scrolls inside its slice instead of stretching (and clipping) the non-scrolling body.
const ATLAS_ROW_HEIGHT = 34; // HW_ModelAtlasCard height
const ATLAS_ROW_GAP = 4;
const ATLAS_ROWS_VISIBLE = 4;

function atlasListHeight(count: number): number {
  const rows = Math.min(count, ATLAS_ROWS_VISIBLE);
  return rows * ATLAS_ROW_HEIGHT + Math.max(0, rows - 1) * ATLAS_ROW_GAP;
}

export default function ModelDetailBody({ model }: { model: ModelPackage }) {
  const isPrimitive = model.sourceKind === 'primitive';
  // Only the contract rows carrying real provenance survive — empty slots are hidden, not
  // shown as dashes. Primitives have no provenance at all, so the whole section drops.
  const contractRows = isPrimitive
    ? []
    : ([['source model', model.source], ['rig data', model.rig], ['manifest', model.data]] as const)
        .filter(([, value]) => hasValue(value));
  return (
    <>
      <C.HW_ModelTop>
        <C.HW_ModelThumb style={{ backgroundColor: model.color }}>
          <ModelThumbnail model={model} />
        </C.HW_ModelThumb>
        <C.HW_ModelCardMain>
          <C.HW_MaterialTitleRow>
            <C.HW_MaterialName>{model.name}</C.HW_MaterialName>
            <C.HW_Spacer />
            <C.HW_MaterialStat>{model.stage}</C.HW_MaterialStat>
          </C.HW_MaterialTitleRow>
          {model.triangles > 0 ? (
            <C.HW_ModelMetaRow>
              <C.HW_MaterialStat>{`${formatCount(model.triangles)} tris`}</C.HW_MaterialStat>
            </C.HW_ModelMetaRow>
          ) : null}
        </C.HW_ModelCardMain>
      </C.HW_ModelTop>

      {contractRows.length > 0 ? (
        <C.HW_ModelSection>
          <C.HW_ModelSectionHead>
            <Icon name="PackageCheck" size={12} color={accentFor('primary')} />
            <C.HW_GroupText>FOLDER CONTRACT</C.HW_GroupText>
          </C.HW_ModelSectionHead>
          {contractRows.map(([label, value]) => (
            <C.HW_ModelDataRow key={label}>
              <C.HW_ToolLabel>{label}</C.HW_ToolLabel>
              <C.HW_ToolValue>{value}</C.HW_ToolValue>
            </C.HW_ModelDataRow>
          ))}
        </C.HW_ModelSection>
      ) : null}

      {model.atlases.length > 0 ? (
        <C.HW_ModelSection>
          <C.HW_ModelSectionHead>
            <Icon name="Layers" size={12} color={accentFor('primary')} />
            <C.HW_GroupText>ATLAS SETS</C.HW_GroupText>
          </C.HW_ModelSectionHead>
          {/* Bounded NESTED scroll (req_2627): a many-atlas model scrolls inside this
              fixed slice instead of stretching past the non-scrolling MODEL FOCUS body;
              explicit height per the layout rules (ScrollView is excluded from fallback). */}
          <ScrollView
            style={{ height: atlasListHeight(model.atlases.length) }}
            contentContainerStyle={{ flexDirection: 'column', gap: ATLAS_ROW_GAP }}
          >
            {model.atlases.map((atlas) => (
              <C.HW_ModelAtlasCard key={atlas.id}>
                <C.HW_VariantSwatch style={{ backgroundColor: atlas.color }} />
                <C.HW_ModelCardMain>
                  <C.HW_MaterialTitleRow>
                    <C.HW_ToolValue>{atlas.label}</C.HW_ToolValue>
                    <C.HW_Spacer />
                    <C.HW_MaterialStat>{atlas.resolution}</C.HW_MaterialStat>
                  </C.HW_MaterialTitleRow>
                  <C.HW_ModelMetaRow>
                    <C.HW_MaterialStat>{atlas.scope}</C.HW_MaterialStat>
                  </C.HW_ModelMetaRow>
                </C.HW_ModelCardMain>
              </C.HW_ModelAtlasCard>
            ))}
          </ScrollView>
        </C.HW_ModelSection>
      ) : null}

    </>
  );
}

function formatCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}
