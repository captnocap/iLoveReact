// The selected-MODEL detail card (req_3137): the model twin of the material
// detail card — product-shot thumbnail, name + favorite, kind/path and
// geometry meta, and the open verb. Shown whenever the dock's selection
// resolves to a model (tree home row, model subdir, or the open document).
import { C, accentFor } from '../workspace.cls';
import { Icon } from '../../../runtime/icons/Icon';
import type { ModelPackage } from '../data/types';
import { readModelPackageFacts } from '../data/modelPackageFacts';
import ModelThumbnail from './ModelThumbnail';

export default function ModelDetailCard({
  model,
  onOpen,
  onFavorite,
}: {
  model: ModelPackage;
  onOpen: (model: ModelPackage) => void;
  onFavorite: (id: string) => void;
}) {
  const facts = readModelPackageFacts(model);
  const triangles = facts.triangles === null ? '?' : facts.triangles.toLocaleString();
  return (
    <C.HW_DetailCard>
      <C.HW_DetailTop>
        <C.HW_DetailThumb style={{ backgroundColor: model.color }}>
          <ModelThumbnail model={model} />
        </C.HW_DetailThumb>
        <C.HW_DetailText>
          <C.HW_DetailNameRow>
            <C.HW_MaterialName numberOfLines={1} noWrap style={{ flexGrow: 1, minWidth: 0 }}>{model.name}</C.HW_MaterialName>
            <C.HW_IconMiniButton onPress={() => onFavorite(model.id)}>
              <Icon name="Star" size={13} color={accentFor(model.favorite ? 'warning' : 'textFaint')} />
            </C.HW_IconMiniButton>
          </C.HW_DetailNameRow>
          <C.HW_DetailMeta>{model.kind} · {model.path}</C.HW_DetailMeta>
          <C.HW_DetailMeta>{triangles} tris · {facts.paints} paint{facts.paints === 1 ? '' : 's'} · {facts.atlases} atlas{facts.atlases === 1 ? '' : 'es'} · {model.stage}</C.HW_DetailMeta>
        </C.HW_DetailText>
      </C.HW_DetailTop>
      <C.HW_VerbRow>
        <C.HW_VerbPrimary onPress={() => onOpen(model)}>
          <Icon name="Box" size={12} color={accentFor('primary')} />
          <C.HW_VerbText>open model</C.HW_VerbText>
        </C.HW_VerbPrimary>
      </C.HW_VerbRow>
    </C.HW_DetailCard>
  );
}
