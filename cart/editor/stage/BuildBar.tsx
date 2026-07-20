// stage/BuildBar.tsx — the Sims-style build palette (req_2563).
//
// Pinned to the bottom of the world viewport while Build (Place) mode is active.
// A category header row (Wall / Floor / Roof / …) swaps which of the host's 36
// catalog pieces show; a tray of piece tiles below arms the picked one.
// Clicking a piece calls onArm — AppFrame sets state.armedPieceId (the piece the
// next click drops) AND opens the focus panel on that piece definition.
//
// Every tile carries a REAL thumbnail (req_2651, req_2621 gap Y) — "hundreds of
// floors and walls" cannot be told apart by a colour chip. Authored (model:)
// pieces photograph their own stored mesh; catalog pieces photograph their
// pieceShapes decomposition (window cutout + pane, door leaf, roof slopes),
// triangulated by pieceThumbMesh. Both go through the ONE product-shot pipeline
// (library/modelThumb): a static Scene3D with the auto-framed 3/4 orbit camera.
import { useEffect, useMemo, useState } from 'react';
import { Scene3D } from '@reactjit/primitives';
import { C } from '../workspace.cls';
import { placeablesByKind, placeableKind, authoredPieceFor, type PlaceableEntry, type PlaceableKind } from '../world/authoredRegistry';
import { catalogPieceThumbParts } from '../world/pieceThumbMesh';
import { authoredMeshData } from '../world/authoredMesh';
import { buildPartsThumbView, type PartsThumbView } from '../library/modelThumb';
import { stampWorldPrefab, type WorldPrefab } from '../world/prefabs';
import type { PlacedPiece } from '../world/pieces';

// Same shot backdrop as the model gallery (library/ModelThumbnail.tsx).
const THUMB_BG = '#0e1622';

// Catalog geometry is static and authored meshes cache in authoredMesh.ts, so
// each entry's product-shot view is built ONCE per session. A null (an authored
// piece whose geometry is host-only / not resident yet) is NOT cached — it may
// become resolvable once its package loads.
const VIEW_CACHE = new Map<string, PartsThumbView>();

function thumbViewFor(entry: PlaceableEntry): PartsThumbView | null {
  const hit = VIEW_CACHE.get(entry.id);
  if (hit) return hit;
  let view: PartsThumbView | null = null;
  if (entry.authored) {
    const piece = authoredPieceFor(entry.id);
    const vertices = piece ? authoredMeshData(piece.modelId, piece.pkgId) : null;
    if (piece && vertices) {
      view = buildPartsThumbView([
        { key: `authored:${piece.modelId}`, vertices, count: Math.floor(vertices.length / 8), color: entry.hex },
      ]);
    }
  } else {
    view = buildPartsThumbView(catalogPieceThumbParts(entry.id));
  }
  if (view) VIEW_CACHE.set(entry.id, view);
  return view;
}

/** The tile's picture: a static product-shot Scene3D of the piece's REAL
 *  geometry. Falls back to the flat swatch ONLY when no vertices are resident
 *  (a host-only authored mesh) — an honest fallback, not the default look. */
function PieceThumb({ entry }: { entry: PlaceableEntry }) {
  const view = useMemo(() => thumbViewFor(entry), [entry.id]);
  if (!view) return <C.HW_BuildPieceThumb style={{ backgroundColor: entry.hex }} />;
  return (
    <C.HW_BuildPieceThumb>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={THUMB_BG} showGrid={false} showAxes={false}>
        <Scene3D.Camera position={view.cam.pos} target={view.cam.target} fov={view.cam.fov} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.5} />
        <Scene3D.DirectionalLight direction={[0.4, 1, -0.35]} color="#ffffff" intensity={0.85} />
        {view.meshes.map((m, i) => (
          <Scene3D.Mesh
            key={i}
            geometry={m.geometry}
            params={{}}
            material={m.opacity !== undefined ? { color: m.color, opacity: m.opacity } : m.color}
            position={[0, 0, 0]}
          />
        ))}
      </Scene3D>
    </C.HW_BuildPieceThumb>
  );
}

function transformThumbVertices(vertices: Float32Array, piece: PlacedPiece): Float32Array {
  const out = new Float32Array(vertices.length);
  const yaw = piece.yawDegrees * Math.PI / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  for (let at = 0; at + 7 < vertices.length; at += 8) {
    const x = vertices[at]!;
    const z = vertices[at + 2]!;
    const nx = vertices[at + 3]!;
    const nz = vertices[at + 5]!;
    out[at] = piece.x + x * cos + z * sin;
    out[at + 1] = piece.y + vertices[at + 1]!;
    out[at + 2] = piece.z - x * sin + z * cos;
    out[at + 3] = nx * cos + nz * sin;
    out[at + 4] = vertices[at + 4]!;
    out[at + 5] = -nx * sin + nz * cos;
    out[at + 6] = vertices[at + 6]!;
    out[at + 7] = vertices[at + 7]!;
  }
  return out;
}

function prefabThumbView(prefab: WorldPrefab): PartsThumbView | null {
  const hit = VIEW_CACHE.get(prefab.id);
  if (hit) return hit;
  const parts = stampWorldPrefab(prefab, { x: 0, y: 0, z: 0, floor: 0 }, 0).flatMap((piece, index) => {
    const authored = authoredPieceFor(piece.pieceId);
    if (authored) {
      const vertices = authoredMeshData(authored.modelId, authored.pkgId);
      return vertices ? [{
        key: `${prefab.id}:${index}:authored`,
        vertices: transformThumbVertices(vertices, piece),
        count: Math.floor(vertices.length / 8),
        color: authored.hex,
      }] : [];
    }
    return catalogPieceThumbParts(piece.pieceId).map((part) => ({
      ...part,
      key: `${prefab.id}:${index}:${part.key}`,
      vertices: transformThumbVertices(part.vertices, piece),
    }));
  });
  const view = buildPartsThumbView(parts);
  if (view) VIEW_CACHE.set(prefab.id, view);
  return view;
}

function PrefabThumb({ prefab }: { prefab: WorldPrefab }) {
  const view = useMemo(() => prefabThumbView(prefab), [prefab.id]);
  if (!view) return <C.HW_BuildPieceThumb style={{ backgroundColor: '#4b3b72' }} />;
  return (
    <C.HW_BuildPieceThumb>
      <Scene3D style={{ width: '100%', height: '100%' }} backgroundColor={THUMB_BG} showGrid={false} showAxes={false}>
        <Scene3D.Camera position={view.cam.pos} target={view.cam.target} fov={view.cam.fov} />
        <Scene3D.AmbientLight color="#ffffff" intensity={0.5} />
        <Scene3D.DirectionalLight direction={[0.4, 1, -0.35]} color="#ffffff" intensity={0.85} />
        {view.meshes.map((mesh, index) => (
          <Scene3D.Mesh key={index} geometry={mesh.geometry} params={{}} material={mesh.opacity !== undefined ? { color: mesh.color, opacity: mesh.opacity } : mesh.color} position={[0, 0, 0]} />
        ))}
      </Scene3D>
    </C.HW_BuildPieceThumb>
  );
}

type PaletteKind = PlaceableKind | 'prefabs';

export default function BuildBar(props: { armedPieceId: string | null; prefabs: readonly WorldPrefab[]; onArm: (pieceId: string) => void }) {
  // Catalog pieces + authored (exported-mesh) pieces, grouped by kind.
  const groups = [
    ...placeablesByKind().map((group) => ({ ...group, kind: group.kind as PaletteKind })),
    ...(props.prefabs.length > 0 ? [{ kind: 'prefabs' as const, label: 'Prefabs', entries: [] }] : []),
  ];
  // The visible category defaults to the armed piece's kind (so re-entering Build
  // lands on what you last armed), else the first group. Local state — switching
  // categories is pure browsing; only clicking a PIECE arms (writes EditorState).
  const armedKind: PaletteKind | undefined = props.armedPieceId?.startsWith('prefab.')
    ? 'prefabs'
    : props.armedPieceId ? placeableKind(props.armedPieceId) : undefined;
  const [activeKind, setActiveKind] = useState<PaletteKind>(armedKind ?? groups[0]?.kind ?? 'wall');
  useEffect(() => { if (armedKind) setActiveKind(armedKind); }, [armedKind]);
  const active = groups.find((g) => g.kind === activeKind) ?? groups[0];

  return (
    <C.HW_BuildBar>
      <C.HW_BuildBarRow>
        {groups.map((g) => {
          const on = g.kind === active?.kind;
          const Cat = on ? C.HW_BuildCatOn : C.HW_BuildCat;
          const Txt = on ? C.HW_BuildCatTextOn : C.HW_BuildCatText;
          return (
            <Cat key={g.kind} onPress={() => setActiveKind(g.kind)}>
              <Txt>{g.label}</Txt>
              <C.HW_BuildCatCount>{g.kind === 'prefabs' ? props.prefabs.length : g.entries.length}</C.HW_BuildCatCount>
            </Cat>
          );
        })}
      </C.HW_BuildBarRow>
      <C.HW_BuildTray>
        {active?.kind === 'prefabs' ? props.prefabs.map((prefab) => {
          const on = prefab.id === props.armedPieceId;
          const Tile = on ? C.HW_BuildPieceTileOn : C.HW_BuildPieceTile;
          const Label = on ? C.HW_BuildPieceTileLabelOn : C.HW_BuildPieceTileLabel;
          return (
            <Tile key={prefab.id} onPress={() => props.onArm(prefab.id)}>
              <PrefabThumb prefab={prefab} />
              <C.HW_BuildPieceTileLabelBox>
                <Label>▦ {prefab.label} · {prefab.pieces.length}</Label>
              </C.HW_BuildPieceTileLabelBox>
            </Tile>
          );
        }) : active?.entries.map((entry) => {
          const on = entry.id === props.armedPieceId;
          const Tile = on ? C.HW_BuildPieceTileOn : C.HW_BuildPieceTile;
          const Label = on ? C.HW_BuildPieceTileLabelOn : C.HW_BuildPieceTileLabel;
          // Authored (mesh) pieces get a ◆ marker so they read as real models.
          return (
            <Tile key={entry.id} onPress={() => props.onArm(entry.id)}>
              <PieceThumb entry={entry} />
              <C.HW_BuildPieceTileLabelBox>
                <Label>{entry.authored ? `◆ ${entry.label}` : entry.label}</Label>
              </C.HW_BuildPieceTileLabelBox>
            </Tile>
          );
        })}
      </C.HW_BuildTray>
    </C.HW_BuildBar>
  );
}
