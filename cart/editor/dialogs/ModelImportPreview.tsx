import { C } from '../workspace.cls';
import { type ExplorerFile } from '../data/fileExplorer';

// Real facts about a model file (from the fs stat that indexed it) plus the honest
// import contract: .glb/.obj load through the native host importer (__mesh_load_file)
// when opened; .gltf/.fbx are indexed but the host parser doesn't read them.
export default function ModelImportPreview(props: {
  file: ExplorerFile;
}) {
  return (
    <C.HW_FileModelBlock>
      <C.HW_ModelMetaColumn>
        <C.HW_FileMetaGrid>
          <C.HW_StatCell>
            <C.HW_StatValue>{props.file.kind.toUpperCase()}</C.HW_StatValue>
            <C.HW_StatLabel>format</C.HW_StatLabel>
          </C.HW_StatCell>
          <C.HW_StatCell>
            <C.HW_StatValue>{props.file.sizeLabel}</C.HW_StatValue>
            <C.HW_StatLabel>size</C.HW_StatLabel>
          </C.HW_StatCell>
          <C.HW_StatCell>
            <C.HW_StatValue>{props.file.modifiedLabel}</C.HW_StatValue>
            <C.HW_StatLabel>modified</C.HW_StatLabel>
          </C.HW_StatCell>
        </C.HW_FileMetaGrid>
        <C.HW_FileMiniRow>
          <C.HW_FileDot />
          <C.HW_ReadValue>
            {props.file.importable
              ? 'opens through the native GLB/OBJ importer'
              : `.${props.file.kind} is not importable — convert to .glb or .obj`}
          </C.HW_ReadValue>
        </C.HW_FileMiniRow>
      </C.HW_ModelMetaColumn>
    </C.HW_FileModelBlock>
  );
}
