import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { ModelPackage } from '../data/types';
import ModelView from '../../modelview';
import { cookedMeshBlobData, cookedMeshRefForAsset } from '../data/hmscAssetCatalog';

export default function ModelDocumentSurface({ model }: { model: ModelPackage | null }) {
  if (!model) {
    return (
      <C.HW_ModelDocument>
        <C.HW_ModelDocEmpty>
          <Icon name="SearchX" size={18} color={accentFor('textFaint')} />
          <C.HW_StageSocketTitle>MODEL NOT FOUND</C.HW_StageSocketTitle>
        </C.HW_ModelDocEmpty>
      </C.HW_ModelDocument>
    );
  }

  if (model.viewerPath) {
    return (
      <C.HW_ModelDocument>
        <ModelView key={model.id} initialPath={model.viewerPath} initialTitle={model.name} allowFilePicker={false} trackAttribution={false} />
      </C.HW_ModelDocument>
    );
  }

  const meshRef = viewerMeshRefFor(model);
  if (meshRef) {
    const vertices = cookedMeshBlobData(meshRef);
    if (vertices) {
      return (
        <C.HW_ModelDocument>
          <ModelView
            key={model.id}
            initialTitle={model.name}
            initialMesh={{
              key: meshRef,
              name: model.name,
              vertices,
              count: Math.floor(vertices.length / 8),
            }}
            allowFilePicker={false}
            trackAttribution={false}
          />
        </C.HW_ModelDocument>
      );
    }
    return (
      <C.HW_ModelDocument>
        <C.HW_ModelDocEmpty>
          <Icon name="SearchX" size={18} color={accentFor('textFaint')} />
          <C.HW_StageSocketTitle>MODEL TRIANGLE DATA MISSING</C.HW_StageSocketTitle>
          <C.HW_StatusText>{meshRef}</C.HW_StatusText>
        </C.HW_ModelDocEmpty>
      </C.HW_ModelDocument>
    );
  }

  return (
    <C.HW_ModelDocument>
      <C.HW_ModelDocShell>
        <C.HW_ModelDocHeader>
          <C.HW_ModelDocThumb style={{ backgroundColor: model.color }} />
          <C.HW_ModelDocTitleBlock>
            <C.HW_ModelDocTitle numberOfLines={1} noWrap>{model.name}</C.HW_ModelDocTitle>
            <C.HW_ModelDocPath numberOfLines={1} noWrap>{model.path}</C.HW_ModelDocPath>
          </C.HW_ModelDocTitleBlock>
          <C.HW_Spacer />
          <C.HW_ModelDocBadge><C.HW_MaterialStat>{model.stage}</C.HW_MaterialStat></C.HW_ModelDocBadge>
        </C.HW_ModelDocHeader>
        <C.HW_ModelDocStats>
          <DocStat label="kind" value={model.semanticKind ?? model.kind} />
          <DocStat label="source" value={model.sourceKind ?? 'indexed'} />
          <DocStat label="tris" value={model.triangles > 0 ? formatCount(model.triangles) : '-'} />
          <DocStat label="atlases" value={String(model.atlases.length)} />
        </C.HW_ModelDocStats>
        <C.HW_ModelDocGrid>
          <C.HW_ModelDocPanel>
            <C.HW_ModelDocPanelHead>
              <Icon name="PackageCheck" size={13} color={accentFor('primary')} />
              <C.HW_GroupText>STORED MODEL DATA</C.HW_GroupText>
            </C.HW_ModelDocPanelHead>
            {[
              ['source model', model.source],
              ['rig data', model.rig],
              ['manifest', model.data],
              ['lods', String(model.lods)],
            ].map(([label, value]) => <DocRow key={label} label={label} value={value} />)}
          </C.HW_ModelDocPanel>
          <C.HW_ModelDocPanel>
            <C.HW_ModelDocPanelHead>
              <Icon name="Layers" size={13} color={accentFor('primary')} />
              <C.HW_GroupText>TEXTURE / ATLAS DATA</C.HW_GroupText>
            </C.HW_ModelDocPanelHead>
            {model.atlases.length ? model.atlases.map((atlas) => (
              <DocRow key={atlas.id} label={atlas.label} value={`${atlas.scope} / ${atlas.resolution}`} swatch={atlas.color} />
            )) : <DocRow label="atlas" value="none stored" />}
          </C.HW_ModelDocPanel>
        </C.HW_ModelDocGrid>
        <C.HW_ModelDocPanel>
          <C.HW_ModelDocPanelHead>
            <Icon name="Workflow" size={13} color={accentFor('primary')} />
            <C.HW_GroupText>DECOMPOSITION</C.HW_GroupText>
          </C.HW_ModelDocPanelHead>
          <C.HW_ChipRow>
            {model.decompositions.map((item) => (
              <C.HW_TraceChip key={item}><C.HW_MaterialStat>{item}</C.HW_MaterialStat></C.HW_TraceChip>
            ))}
          </C.HW_ChipRow>
        </C.HW_ModelDocPanel>
      </C.HW_ModelDocShell>
    </C.HW_ModelDocument>
  );
}

function viewerMeshRefFor(model: ModelPackage): string | null {
  if (model.viewerMeshRef) return model.viewerMeshRef;
  const assetId = cookedAssetId(model);
  return assetId ? cookedMeshRefForAsset(assetId) : null;
}

function cookedAssetId(model: ModelPackage): string | null {
  if (model.sourceKind !== 'cooked-asset') return null;
  return model.id.startsWith('cooked:') ? model.id.slice('cooked:'.length) : model.id;
}

function DocStat({ label, value }: { label: string; value: string }) {
  return (
    <C.HW_ModelDocStat>
      <C.HW_StatValue>{value}</C.HW_StatValue>
      <C.HW_StatLabel>{label}</C.HW_StatLabel>
    </C.HW_ModelDocStat>
  );
}

function DocRow({ label, value, swatch }: { label: string; value: string; swatch?: string }) {
  return (
    <C.HW_ModelDocRow>
      {swatch ? <C.HW_VariantSwatch style={{ backgroundColor: swatch }} /> : null}
      <C.HW_ToolLabel>{label}</C.HW_ToolLabel>
      <C.HW_ToolValue numberOfLines={1} noWrap>{value}</C.HW_ToolValue>
    </C.HW_ModelDocRow>
  );
}

function formatCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}
