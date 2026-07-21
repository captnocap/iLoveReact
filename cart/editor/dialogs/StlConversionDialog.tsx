import { Icon } from '../../../runtime/icons/Icon';
import { C, accentFor } from '../workspace.cls';

export default function StlConversionDialog({ filename }: { filename: string }) {
  return (
    <C.HW_DialogScrim>
      <C.HW_StlConversionDialog>
        <C.HW_StlConversionHead>
          <Icon name="RefreshCw" size={16} color={accentFor('primary')} />
          <C.HW_HeadTitle>Converting STL</C.HW_HeadTitle>
          <C.HW_PillOn><C.HW_PillTextOn>LOCAL</C.HW_PillTextOn></C.HW_PillOn>
        </C.HW_StlConversionHead>
        <C.HW_StlConversionBody>
          <C.HW_StlConversionName>{filename}</C.HW_StlConversionName>
          <C.HW_StatusText>Blender is converting this STL to an editor-ready GLB.</C.HW_StatusText>
          <C.HW_StlConversionTrack><C.HW_StlConversionActivity /></C.HW_StlConversionTrack>
          <C.HW_StlConversionHint>This can take a moment for large or detailed meshes. The editor will open it when ready.</C.HW_StlConversionHint>
        </C.HW_StlConversionBody>
      </C.HW_StlConversionDialog>
    </C.HW_DialogScrim>
  );
}
