import { C } from '../workspace.cls';
import type { ModelPackage } from '../data/types';
import ModelDetailBody from './ModelDetailBody';

export default function ModelPackageDetail({ model, onAction, onOpen }: { model: ModelPackage; onAction: (label: string) => void; onOpen: () => void }) {
  return (
    <C.HW_ModelBrowser>
      <C.HW_ModelHomePanel>
        <ModelDetailBody model={model} onAction={onAction} onOpen={onOpen} />
      </C.HW_ModelHomePanel>
    </C.HW_ModelBrowser>
  );
}
