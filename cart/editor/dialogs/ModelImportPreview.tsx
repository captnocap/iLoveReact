import { C } from '../workspace.cls';
import { type ExplorerFile } from '../data/fileExplorer';

export default function ModelImportPreview(props: {
  file: ExplorerFile;
}) {
  const preview = props.file.preview;
  if (!preview) return null;
  return (
    <C.HW_FileModelBlock>
      <C.HW_FileModelViewport>
        <C.HW_ModelViewportTop>
          <C.HW_FileBadge><C.HW_KeyText>NATIVE PREVIEW SLOT</C.HW_KeyText></C.HW_FileBadge>
          <C.HW_Spacer />
          <C.HW_StatusText>{preview.format}</C.HW_StatusText>
        </C.HW_ModelViewportTop>
        <C.HW_ModelStage>
          <C.HW_ModelGround>
            <C.HW_ModelShapeTall />
            <C.HW_ModelShapeWide />
            <C.HW_ModelShapeSmall />
          </C.HW_ModelGround>
        </C.HW_ModelStage>
        <C.HW_ModelViewportFoot>
          <C.HW_StatusText>orbit camera</C.HW_StatusText>
          <C.HW_StatusText>bounds</C.HW_StatusText>
          <C.HW_StatusText>materials</C.HW_StatusText>
        </C.HW_ModelViewportFoot>
      </C.HW_FileModelViewport>
      <C.HW_ModelMetaColumn>
        <C.HW_FileMetaGrid>
          <C.HW_StatCell>
            <C.HW_StatValue>{preview.triangles}</C.HW_StatValue>
            <C.HW_StatLabel>triangles</C.HW_StatLabel>
          </C.HW_StatCell>
          <C.HW_StatCell>
            <C.HW_StatValue>{preview.materials}</C.HW_StatValue>
            <C.HW_StatLabel>materials</C.HW_StatLabel>
          </C.HW_StatCell>
          <C.HW_StatCell>
            <C.HW_StatValue>{preview.upAxis}</C.HW_StatValue>
            <C.HW_StatLabel>up axis</C.HW_StatLabel>
          </C.HW_StatCell>
        </C.HW_FileMetaGrid>
        <C.HW_FileMiniRow>
          <C.HW_FileDot />
          <C.HW_ReadValue>{preview.bounds}</C.HW_ReadValue>
        </C.HW_FileMiniRow>
        <C.HW_FileMiniRow>
          <C.HW_FileDot />
          <C.HW_ReadValue>{preview.importAs}</C.HW_ReadValue>
        </C.HW_FileMiniRow>
        <C.HW_FileTagWrap>
          {preview.textureSlots.map((slot) => <C.HW_TraceChip key={slot}><C.HW_KeyText>{slot}</C.HW_KeyText></C.HW_TraceChip>)}
        </C.HW_FileTagWrap>
      </C.HW_ModelMetaColumn>
    </C.HW_FileModelBlock>
  );
}
