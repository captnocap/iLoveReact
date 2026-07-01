// editor/library/ModelDetailBody.tsx — the focused-model detail content
// (header, folder contract, atlas sets, paint variants). Pure real-data display
// from the model package; renders in the right inspector when a model is in
// focus. (The old "captured references" section and open/paint/save action row
// were god-file-clone cruft that was never asked for — removed.)
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { ModelPackage } from '../data/types';
import ModelThumbnail from './ModelThumbnail';

export default function ModelDetailBody({ model }: { model: ModelPackage }) {
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
          <C.HW_ModelPath>{model.path}</C.HW_ModelPath>
          <C.HW_ModelMetaRow>
            <C.HW_MaterialStat>{model.triangles > 0 ? `${formatCount(model.triangles)} tris` : 'tris —'}</C.HW_MaterialStat>
            <C.HW_MaterialStat>{model.semanticKind ?? model.kind}</C.HW_MaterialStat>
            <C.HW_MaterialStat>{model.sourceKind ?? 'indexed'}</C.HW_MaterialStat>
          </C.HW_ModelMetaRow>
        </C.HW_ModelCardMain>
      </C.HW_ModelTop>

      <C.HW_ModelSection>
        <C.HW_ModelSectionHead>
          <Icon name="PackageCheck" size={12} color={accentFor('primary')} />
          <C.HW_GroupText>FOLDER CONTRACT</C.HW_GroupText>
        </C.HW_ModelSectionHead>
        {[
          ['source model', model.source],
          ['rig data', model.rig],
          ['manifest', model.data],
        ].map(([label, value]) => (
          <C.HW_ModelDataRow key={label}>
            <C.HW_ToolLabel>{label}</C.HW_ToolLabel>
            <C.HW_ToolValue>{value}</C.HW_ToolValue>
          </C.HW_ModelDataRow>
        ))}
      </C.HW_ModelSection>

      <C.HW_ModelSection>
        <C.HW_ModelSectionHead>
          <Icon name="Layers" size={12} color={accentFor('primary')} />
          <C.HW_GroupText>ATLAS SETS</C.HW_GroupText>
        </C.HW_ModelSectionHead>
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
                <C.HW_MaterialStat>{atlas.paints} paints</C.HW_MaterialStat>
              </C.HW_ModelMetaRow>
            </C.HW_ModelCardMain>
          </C.HW_ModelAtlasCard>
        ))}
      </C.HW_ModelSection>

      <C.HW_ModelSection>
        <C.HW_ModelSectionHead>
          <Icon name="Brush" size={12} color={accentFor('primary')} />
          <C.HW_GroupText>PAINT VARIANTS</C.HW_GroupText>
        </C.HW_ModelSectionHead>
        <C.HW_ModelPaintGrid>
          {model.paints.map((paint) => (
            <C.HW_ModelPaintCard key={paint.id}>
              <C.HW_SelectedVariantSwatch style={{ backgroundColor: paint.color }} />
              <C.HW_ToolValue>{paint.name}</C.HW_ToolValue>
              <C.HW_ToolHint>{paint.atlas}</C.HW_ToolHint>
            </C.HW_ModelPaintCard>
          ))}
        </C.HW_ModelPaintGrid>
      </C.HW_ModelSection>

    </>
  );
}

function formatCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}
