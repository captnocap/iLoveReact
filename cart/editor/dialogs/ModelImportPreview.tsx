import { useEffect, useRef, useState } from 'react';
import { Pressable, Scene3D } from '../../../runtime/primitives';
import { C } from '../workspace.cls';
import { type ExplorerFile } from '../data/fileExplorer';

const host = globalThis as any;

type PreviewMesh = { key: string; count: number; radius: number };

function loadPreview(path: string): PreviewMesh | null {
  const fn = host.__mesh_preview_file;
  if (typeof fn !== 'function') return null;
  const json = fn(path);
  if (typeof json !== 'string' || json.length === 0) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed.key !== 'string') return null;
    return {
      key: parsed.key,
      count: Number(parsed.count) || 0,
      radius: Number(parsed.radius) || 1,
    };
  } catch {
    return null;
  }
}

// Real facts about a model file (from the fs stat that indexed it) plus the honest
// import contract: .glb/.obj load through the native host importer (__mesh_load_file)
// when opened; .gltf/.fbx are indexed but the host parser doesn't read them.
export default function ModelImportPreview(props: {
  file: ExplorerFile;
}) {
  const [mesh, setMesh] = useState<PreviewMesh | null>(null);
  const [failed, setFailed] = useState(false);
  const dragRef = useRef<{ down: boolean; x: number; y: number }>({ down: false, x: 0, y: 0 });

  useEffect(() => {
    dragRef.current = { down: false, x: 0, y: 0 };
    if (!props.file.importable) {
      setMesh(null);
      setFailed(false);
      return;
    }
    const next = loadPreview(props.file.path);
    setMesh(next);
    setFailed(!next);
  }, [props.file.path, props.file.importable]);

  const beginDrag = (event: any) => {
    dragRef.current = { down: true, x: Number(event?.x) || 0, y: Number(event?.y) || 0 };
    event?.preventDefault?.();
  };
  const moveDrag = (event: any) => {
    const drag = dragRef.current;
    if (!drag.down) return;
    const x = Number(event?.x) || drag.x;
    const y = Number(event?.y) || drag.y;
    const dx = x - drag.x;
    const dy = y - drag.y;
    dragRef.current = { down: true, x, y };
    if (dx || dy) host.__model_orbit_drag?.(dx, dy);
    event?.preventDefault?.();
  };
  const endDrag = (event: any) => {
    dragRef.current.down = false;
    event?.preventDefault?.();
  };
  const zoom = (event: any) => {
    host.__model_orbit_zoom?.(Number(event?.deltaY) || 0);
    event?.preventDefault?.();
  };

  return (
    <C.HW_FileModelBlock>
      <C.HW_FileModelViewport>
        <C.HW_ModelViewportTop>
          <C.HW_KeyText>MODEL PREVIEW</C.HW_KeyText>
          <C.HW_Spacer />
          <C.HW_FileStat>{mesh ? `${Math.floor(mesh.count / 3).toLocaleString()} tris` : props.file.kind.toUpperCase()}</C.HW_FileStat>
        </C.HW_ModelViewportTop>
        <C.HW_ModelStage>
          {mesh ? (
            <>
              <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor="#0b0d12" showGrid={false} showAxes={false}>
                <Scene3D.Camera orbit fov={46} />
                <Scene3D.Fog enabled={false} />
                <Scene3D.AmbientLight color="#ffffff" intensity={0.68} />
                <Scene3D.DirectionalLight direction={[-0.45, -0.8, -0.4]} color="#ffffff" intensity={0.62} />
                <Scene3D.Mesh hostKey={mesh.key} material="#d9e4f2" />
              </Scene3D>
              <Pressable
                tooltip="Orbit preview"
                onMouseDown={beginDrag}
                onMouseMove={moveDrag}
                onMouseUp={endDrag}
                onScroll={zoom}
                style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
              />
            </>
          ) : (
            <C.HW_StatusText>{failed ? 'preview unavailable' : props.file.importable ? 'loading preview' : 'not importable'}</C.HW_StatusText>
          )}
        </C.HW_ModelStage>
        <C.HW_ModelViewportFoot>
          <C.HW_FileStat>{props.file.sizeLabel}</C.HW_FileStat>
          <C.HW_FileStat>{props.file.modifiedLabel}</C.HW_FileStat>
        </C.HW_ModelViewportFoot>
      </C.HW_FileModelViewport>
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
